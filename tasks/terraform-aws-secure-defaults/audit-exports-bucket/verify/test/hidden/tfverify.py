"""Shared helpers for the hidden verifiers: run the stack against a local AWS emulator and judge it.

The emulator is moto (pinned with hashes in requirements-dev.txt), started in this process with S3
patched to behave like AWS does for buckets created after April 2023: Object Ownership
"bucket owner enforced" (ACLs disabled), all four Block Public Access settings on and SSE-S3 default
encryption. Requests that set a bucket or object ACL on such a bucket fail with
AccessControlListNotSupported, as they do on AWS. Buckets listed as legacy keep moto's pre-2023
defaults, because in the scenario they were created in 2022.

Terraform runs offline with fake credentials and every endpoint pointed at the emulator. IAM, bucket
and key policies are judged with a small policy evaluator (Allow/Deny, wildcards, NotAction,
NotResource, Principal, the common condition operators) so that any policy shape that grants the
right access passes.
"""

from __future__ import annotations

import inspect
import ipaddress
import json
import logging
import os
import re
import socket
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path.cwd()
TF = ROOT / '.tools' / 'terraform'
ACCOUNT = '123456789012'  # moto's account
REGION = 'eu-west-1'
OVERRIDE = ROOT / 'zz_verify_override.tf'
# S3 Control requests go to <account-id>.<endpoint host>, which an IP address cannot express.
S3CONTROL_HOST = 's3control.verify.internal'

ENDPOINT_SERVICES = [
    'cloudwatch', 'dynamodb', 'ec2', 'ecr', 'ecs', 'events', 'iam', 'kms', 'lambda', 'logs', 'rds',
    's3', 's3control', 'secretsmanager', 'sns', 'sqs', 'ssm', 'sts',
]

# --------------------------------------------------------------------------------------------------
# A small HCL scanner: enough to find blocks and attribute expressions, not a full parser.
# --------------------------------------------------------------------------------------------------


class Block:
    def __init__(self, kind, labels, attrs, blocks, file, line, module=''):
        self.kind, self.labels, self.attrs, self.blocks = kind, labels, attrs, blocks
        self.file, self.line, self.module = file, line, module

    def __repr__(self):
        return f'Block({self.kind} {self.labels} in {self.file}:{self.line})'

    @property
    def address(self):
        prefix = f'{self.module}.' if self.module else ''
        if self.kind == 'resource':
            return f'{prefix}{self.labels[0]}.{self.labels[1]}'
        if self.kind == 'data':
            return f'{prefix}data.{self.labels[0]}.{self.labels[1]}'
        if self.kind == 'ephemeral':
            return f'{prefix}ephemeral.{self.labels[0]}.{self.labels[1]}'
        return f'{prefix}{self.kind}.{".".join(self.labels)}'


def _skip_string(s, i):
    """s[i] is a double quote; return the index after the closing quote (template-aware)."""
    i += 1
    depth = 0
    while i < len(s):
        c = s[i]
        if c == '\\':
            i += 2
            continue
        if depth == 0:
            if c == '"':
                return i + 1
            if s.startswith('${', i) or s.startswith('%{', i):
                depth = 1
                i += 2
                continue
        else:
            if c == '"':
                i = _skip_string(s, i)
                continue
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return i


_HEREDOC = re.compile(r'<<-?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\r?\n')


def _skip_noise(s, i):
    """Skip a comment, string or heredoc starting at i; return the new index or None."""
    if s[i] == '#' or s.startswith('//', i):
        j = s.find('\n', i)
        return len(s) if j < 0 else j
    if s.startswith('/*', i):
        j = s.find('*/', i + 2)
        return len(s) if j < 0 else j + 2
    if s[i] == '"':
        return _skip_string(s, i)
    if s.startswith('<<', i):
        m = _HEREDOC.match(s, i)
        if m:
            end = re.compile(rf'^[ \t]*{m.group(1)}[ \t]*$', re.M).search(s, m.end())
            return len(s) if not end else end.end()
    return None


def _expr_end(s, i):
    """End of an attribute expression that starts at i (end of line at nesting depth 0)."""
    depth = 0
    while i < len(s):
        j = _skip_noise(s, i)
        if j is not None:
            if depth == 0 and (s[i] == '#' or s.startswith('//', i)):
                return i
            i = j
            continue
        c = s[i]
        if c in '([{':
            depth += 1
        elif c in ')]}':
            if depth == 0:
                return i
            depth -= 1
        elif c == '\n' and depth == 0:
            return i
        i += 1
    return i


def _match_brace(s, i):
    """s[i] == '{'; return index of the matching '}'."""
    depth = 0
    while i < len(s):
        j = _skip_noise(s, i)
        if j is not None:
            i = j
            continue
        if s[i] == '{':
            depth += 1
        elif s[i] == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(s)


_IDENT = re.compile(r'[A-Za-z_][A-Za-z0-9_-]*')


def _parse_body(s, start, end, file, module):
    attrs, blocks = {}, []
    i = start
    while i < end:
        if s[i] in ' \t\r\n,':
            i += 1
            continue
        j = _skip_noise(s, i)
        if j is not None:
            i = j
            continue
        m = _IDENT.match(s, i)
        if not m:
            i += 1
            continue
        name = m.group(0)
        k = m.end()
        while k < end and s[k] in ' \t':
            k += 1
        if k < end and s[k] == '=' and not s.startswith('==', k):
            e = _expr_end(s, k + 1)
            attrs[name] = s[k + 1 : e].strip()
            i = e
            continue
        labels = []
        while k < end:
            while k < end and s[k] in ' \t':
                k += 1
            if s[k] == '"':
                q = _skip_string(s, k)
                labels.append(s[k + 1 : q - 1])
                k = q
            elif s[k] == '{':
                close = _match_brace(s, k)
                sub_attrs, sub_blocks = _parse_body(s, k + 1, close, file, module)
                line = s.count('\n', 0, i) + 1
                blocks.append(Block(name, labels, sub_attrs, sub_blocks, file, line, module))
                i = close + 1
                break
            else:
                m2 = _IDENT.match(s, k)
                if not m2:
                    i = k + 1
                    break
                labels.append(m2.group(0))
                k = m2.end()
        else:
            i = k
    return attrs, blocks


def parse_dir(directory, module=''):
    """Top-level blocks of every .tf file in a module directory, following local module sources."""
    out = []
    for path in sorted(Path(directory).glob('*.tf')):
        if path.name == OVERRIDE.name:
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        _, blocks = _parse_body(text, 0, len(text), str(path), module)
        out.extend(blocks)
    for b in list(out):
        if b.kind == 'module' and b.labels:
            src = literal(b.attrs.get('source', ''))
            if isinstance(src, str) and src.startswith(('./', '../')):
                child = (Path(directory) / src).resolve()
                if child.is_dir():
                    prefix = f'{module}.module.{b.labels[0]}' if module else f'module.{b.labels[0]}'
                    out.extend(parse_dir(child, prefix))
    return out


def literal(expr):
    """Value of a literal HCL expression (string, number, bool, null), or None when not literal."""
    if expr is None:
        return None
    e = expr.strip()
    if e in ('true', 'false'):
        return e == 'true'
    if e == 'null':
        return None
    if re.fullmatch(r'-?\d+(\.\d+)?', e):
        return float(e) if '.' in e else int(e)
    if len(e) >= 2 and e[0] == '"' and _skip_string(e, 0) == len(e) and '${' not in e:
        body = e[1:-1]
        return re.sub(r'\\(.)', lambda m: {'n': '\n', 't': '\t'}.get(m.group(1), m.group(1)), body)
    return None


def resources(blocks, kind='resource', rtype=None):
    return [b for b in blocks if b.kind == kind and (rtype is None or b.labels[:1] == [rtype])]


# --------------------------------------------------------------------------------------------------
# Emulator
# --------------------------------------------------------------------------------------------------


def _free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def ensure_hosts():
    names = [S3CONTROL_HOST, f'{ACCOUNT}.{S3CONTROL_HOST}']
    try:
        missing = [n for n in names if not _resolves(n)]
        if missing:
            with open('/etc/hosts', 'a', encoding='utf-8') as f:
                f.write(f"\n127.0.0.1 {' '.join(missing)}\n")
    except OSError as exc:
        raise RuntimeError(f'cannot map {names} to 127.0.0.1 in /etc/hosts: {exc}') from exc


def _resolves(name):
    try:
        return socket.gethostbyname(name) == '127.0.0.1'
    except OSError:
        return False


class Emulator:
    def __init__(self, legacy_buckets=()):
        from moto.moto_server.threaded_moto_server import ThreadedMotoServer

        logging.getLogger('werkzeug').setLevel(logging.ERROR)
        ensure_hosts()
        self.legacy = set(legacy_buckets)
        self.secret_writes = []
        _patch_s3(self.legacy)
        _patch_secretsmanager(self.secret_writes)
        self.port = _free_port()
        self.server = ThreadedMotoServer(ip_address='127.0.0.1', port=self.port, verbose=False)
        self.server.start()
        self.endpoint = f'http://127.0.0.1:{self.port}'

    def client(self, service):
        import boto3

        return boto3.client(
            service,
            endpoint_url=self.endpoint,
            region_name=REGION,
            aws_access_key_id='AKIAVERIFY0000000000',
            aws_secret_access_key='verify-secret',
        )

    def stop(self):
        self.server.stop()


_PATCHED = set()


def _patch_s3(legacy):
    if 's3' in _PATCHED:
        return
    _PATCHED.add('s3')
    from moto.s3 import models as m
    from moto.s3 import responses as r
    from moto.s3.exceptions import S3ClientError

    class AccessControlListNotSupported(S3ClientError):
        code = 'AccessControlListNotSupported'

        def __init__(self):
            super().__init__('AccessControlListNotSupported', 'The bucket does not allow ACLs')

    class InvalidBucketAclWithObjectOwnership(S3ClientError):
        code = 'InvalidBucketAclWithObjectOwnership'

        def __init__(self):
            super().__init__(
                'InvalidBucketAclWithObjectOwnership',
                "Bucket cannot have ACLs set with ObjectOwnership's BucketOwnerEnforced setting",
            )

    orig_create = m.S3Backend.create_bucket

    def create_bucket(self, bucket_name, region_name, bucket_namespace=None):
        bucket = orig_create(self, bucket_name, region_name, bucket_namespace)
        if bucket_name not in legacy:
            bucket.ownership_rule = 'BucketOwnerEnforced'
            bucket.public_access_block = m.PublicAccessBlock('true', 'true', 'true', 'true')
            bucket.encryption = {
                'Rule': {
                    'ApplyServerSideEncryptionByDefault': {'SSEAlgorithm': 'AES256'},
                    'BucketKeyEnabled': 'false',
                }
            }
        return bucket

    m.S3Backend.create_bucket = create_bucket

    def enforced(backend, bucket_name):
        try:
            return backend.get_bucket(bucket_name).ownership_rule == 'BucketOwnerEnforced'
        except Exception:
            return False

    def sets_acl(headers):
        return any(h.lower().startswith('x-amz-grant-') for h in headers) or 'x-amz-acl' in headers

    orig_bucket_put = r.S3Response._bucket_response_put

    def bucket_put(self, request, bucket_name, querystring):
        if 'acl' in querystring and enforced(self.backend, bucket_name):
            raise AccessControlListNotSupported()
        if not querystring and bucket_name not in legacy:
            acl = request.headers.get('x-amz-acl')
            ownership = request.headers.get('x-amz-object-ownership', 'BucketOwnerEnforced')
            if ownership == 'BucketOwnerEnforced' and acl and acl != 'private':
                raise InvalidBucketAclWithObjectOwnership()
        return orig_bucket_put(self, request, bucket_name, querystring)

    r.S3Response._bucket_response_put = bucket_put

    orig_key_put = r.S3Response._key_response_put

    def key_put(self, query, key_name):
        headers = self.headers
        if enforced(self.backend, self.bucket_name):
            if 'acl' in query:
                raise AccessControlListNotSupported()
            if sets_acl(headers) and headers.get('x-amz-acl') != 'bucket-owner-full-control':
                raise AccessControlListNotSupported()
        return orig_key_put(self, query, key_name)

    r.S3Response._key_response_put = key_put


def _patch_secretsmanager(sink):
    if 'secretsmanager' in _PATCHED:
        return
    _PATCHED.add('secretsmanager')
    from moto.secretsmanager import models as sm

    def wrap(name):
        orig = getattr(sm.SecretsManagerBackend, name)
        sig = inspect.signature(orig)

        def wrapper(self, *args, **kwargs):
            result = orig(self, *args, **kwargs)
            try:
                bound = sig.bind(self, *args, **kwargs).arguments
                ident = bound.get('name') or bound.get('secret_id')
                secret = self.secrets.get(ident) if hasattr(self.secrets, 'get') else None
                sink.append(
                    {
                        'op': name,
                        'id': ident,
                        'name': getattr(secret, 'name', ident),
                        'secret_string': bound.get('secret_string'),
                    }
                )
            except Exception as exc:  # recording must never break the emulator
                sink.append({'op': name, 'error': repr(exc)})
            return result

        setattr(sm.SecretsManagerBackend, name, wrapper)

    for name in ('create_secret', 'put_secret_value', 'update_secret'):
        wrap(name)


# --------------------------------------------------------------------------------------------------
# Terraform
# --------------------------------------------------------------------------------------------------


def provider_aliases(blocks):
    return sorted(
        {
            literal(b.attrs.get('alias'))
            for b in blocks
            if b.kind == 'provider' and b.labels[:1] == ['aws'] and not b.module
            and literal(b.attrs.get('alias'))
        }
    )


def write_override(emulator, blocks):
    """Point every aws provider configuration of the root module at the emulator."""
    s3control = emulator.endpoint.replace('127.0.0.1', S3CONTROL_HOST)
    endpoints = '\n'.join(
        f'    {s} = "{s3control if s == "s3control" else emulator.endpoint}"'
        for s in ENDPOINT_SERVICES
    )

    def provider(alias):
        alias_line = f'  alias = "{alias}"\n' if alias else ''
        return (
            'provider "aws" {\n'
            f'{alias_line}'
            '  access_key                  = "AKIAVERIFY0000000000"\n'
            '  secret_key                  = "verify-secret"\n'
            '  skip_credentials_validation = true\n'
            '  skip_metadata_api_check     = true\n'
            '  skip_region_validation      = true\n'
            '  s3_use_path_style           = true\n'
            '  max_retries                 = 2\n'
            f'  endpoints {{\n{endpoints}\n  }}\n'
            '}\n'
        )

    text = provider(None) + ''.join(provider(a) for a in provider_aliases(blocks))
    OVERRIDE.write_text(text, encoding='utf-8')


def clean_workspace():
    """Remove local state or plans the agent may have left so the run starts from nothing."""
    for pattern in ('terraform.tfstate', 'terraform.tfstate.backup', '.terraform.tfstate.lock.info'):
        p = ROOT / pattern
        if p.exists():
            p.rename(ROOT / f'{pattern}.agent-leftover')


def tf(*args, timeout=55):
    env = {k: v for k, v in os.environ.items() if not k.startswith(('AWS_', 'TF_'))}
    env.update(
        CHECKPOINT_DISABLE='1',
        TF_IN_AUTOMATION='1',
        TF_INPUT='0',
        AWS_EC2_METADATA_DISABLED='true',
    )
    return subprocess.run(
        [str(TF), *args], cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout
    )


def needs_init(blocks):
    if any(b.kind == 'module' for b in blocks):
        return True
    return any(
        b.kind == 'terraform' and any(sub.kind in ('backend', 'cloud') for sub in b.blocks)
        for b in blocks
    )


def init_if_needed(blocks):
    if not needs_init(blocks):
        return None
    plugin_dir = ROOT / '.terraform' / 'providers'
    return tf('init', '-input=false', '-no-color', '-backend=false', f'-plugin-dir={plugin_dir}')


def json_lines(text):
    out = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('{'):
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def diagnostics(messages, severity=None):
    out = []
    for m in messages:
        d = m.get('diagnostic')
        if d and (severity is None or d.get('severity') == severity):
            out.append(d)
    return out


def describe_errors(messages, raw=''):
    errs = diagnostics(messages, 'error')
    if not errs:
        return raw[-3000:]
    lines = []
    for d in errs[:6]:
        where = d.get('address') or (d.get('range') or {}).get('filename', '')
        lines.append(f"{d.get('summary')}: {(d.get('detail') or '').strip()[:600]} [{where}]")
    return '\n'.join(lines)


def apply():
    """terraform apply -json; returns (exit code, json messages, raw output)."""
    r = tf('apply', '-auto-approve', '-input=false', '-no-color', '-json', timeout=50)
    return r.returncode, json_lines(r.stdout), r.stdout + r.stderr


def read_state():
    p = ROOT / 'terraform.tfstate'
    return json.loads(p.read_text()) if p.exists() else {'resources': []}


def state_instances(state, rtype=None, mode='managed'):
    """[(address, attributes)] from a raw terraform.tfstate."""
    out = []
    for r in state.get('resources', []):
        if r.get('mode') != mode or (rtype and r.get('type') != rtype):
            continue
        prefix = f"{r['module']}." if r.get('module') else ''
        base = f"{prefix}{'data.' if mode == 'data' else ''}{r['type']}.{r['name']}"
        for inst in r.get('instances', []):
            key = inst.get('index_key')
            addr = base if key is None else f'{base}[{json.dumps(key)}]'
            out.append((addr, inst.get('attributes', {})))
    return out


def json_state_resources(module):
    """Flatten a JSON state representation (terraform show -json / test -verbose)."""
    out = list(module.get('resources', []))
    for child in module.get('child_modules', []):
        out.extend(json_state_resources(child))
    return out


# --------------------------------------------------------------------------------------------------
# IAM policy evaluation
# --------------------------------------------------------------------------------------------------


class UnsupportedPolicy(Exception):
    pass


def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _glob(pattern, value, ignore_case=False):
    if ignore_case:
        pattern, value = pattern.lower(), value.lower()
    rx = ''.join('.*' if c == '*' else '.' if c == '?' else re.escape(c) for c in pattern)
    return re.fullmatch(rx, value, re.S) is not None


def _subst(value, ctx):
    if not isinstance(value, str) or '${' not in value:
        return value

    def rep(m):
        key = m.group(1)
        special = {'*': '*', '?': '?', '$': '$'}
        if key in special:
            return special[key]
        got = _ctx_get(ctx, key)
        return got if isinstance(got, str) else m.group(0)

    return re.sub(r'\$\{([^}]+)\}', rep, value)


def _ctx_get(ctx, key):
    lk = key.lower()
    for k, v in ctx.items():
        if k.lower() == lk:
            return v
    return None


NEGATED = {
    'StringNotEquals', 'StringNotEqualsIgnoreCase', 'StringNotLike', 'NumericNotEquals',
    'DateNotEquals', 'NotIpAddress', 'ArnNotEquals', 'ArnNotLike',
}


def _num(x):
    return float(x)


def _date(x):
    x = str(x)
    if re.fullmatch(r'\d+', x):
        return float(x)
    return datetime.fromisoformat(x.replace('Z', '+00:00')).timestamp()


def _match_one(op, actual, expected, ctx):
    exp = [_subst(e, ctx) for e in expected]
    a = actual
    if op in ('StringEquals', 'StringNotEquals'):
        hit = any(str(a) == str(e) for e in exp)
    elif op in ('StringEqualsIgnoreCase', 'StringNotEqualsIgnoreCase'):
        hit = any(str(a).lower() == str(e).lower() for e in exp)
    elif op in ('StringLike', 'StringNotLike'):
        hit = any(_glob(str(e), str(a)) for e in exp)
    elif op in ('ArnEquals', 'ArnLike', 'ArnNotEquals', 'ArnNotLike'):
        hit = any(_glob(str(e), str(a)) for e in exp)
    elif op == 'Bool':
        hit = any(str(a).lower() == str(e).lower() for e in exp)
    elif op.startswith('Numeric'):
        cmp = {
            'NumericEquals': lambda x, y: x == y, 'NumericNotEquals': lambda x, y: x == y,
            'NumericLessThan': lambda x, y: x < y, 'NumericLessThanEquals': lambda x, y: x <= y,
            'NumericGreaterThan': lambda x, y: x > y,
            'NumericGreaterThanEquals': lambda x, y: x >= y,
        }[op]
        hit = any(cmp(_num(a), _num(e)) for e in exp)
    elif op.startswith('Date'):
        cmp = {
            'DateEquals': lambda x, y: x == y, 'DateNotEquals': lambda x, y: x == y,
            'DateLessThan': lambda x, y: x < y, 'DateLessThanEquals': lambda x, y: x <= y,
            'DateGreaterThan': lambda x, y: x > y, 'DateGreaterThanEquals': lambda x, y: x >= y,
        }[op]
        hit = any(cmp(_date(a), _date(e)) for e in exp)
    elif op in ('IpAddress', 'NotIpAddress'):
        hit = any(
            ipaddress.ip_address(str(a)) in ipaddress.ip_network(str(e), strict=False) for e in exp
        )
    else:
        raise UnsupportedPolicy(f'condition operator {op}')
    return not hit if op in NEGATED else hit


KNOWN_OPS = {
    'StringEquals', 'StringNotEquals', 'StringEqualsIgnoreCase', 'StringNotEqualsIgnoreCase',
    'StringLike', 'StringNotLike', 'ArnEquals', 'ArnLike', 'ArnNotEquals', 'ArnNotLike', 'Bool',
    'NumericEquals', 'NumericNotEquals', 'NumericLessThan', 'NumericLessThanEquals',
    'NumericGreaterThan', 'NumericGreaterThanEquals', 'DateEquals', 'DateNotEquals',
    'DateLessThan', 'DateLessThanEquals', 'DateGreaterThan', 'DateGreaterThanEquals',
    'IpAddress', 'NotIpAddress', 'Null',
}


def _condition_holds(full_op, key, expected, ctx):
    qualifier = None
    op = full_op
    if ':' in op:
        qualifier, op = op.split(':', 1)
        if qualifier not in ('ForAnyValue', 'ForAllValues'):
            raise UnsupportedPolicy(f'condition qualifier {qualifier}')
    if_exists = op.endswith('IfExists')
    base = op[: -len('IfExists')] if if_exists else op
    if base not in KNOWN_OPS:
        raise UnsupportedPolicy(f'condition operator {full_op}')
    actual = _ctx_get(ctx, key)
    expected = as_list(expected)
    if base == 'Null':
        want_missing = str(expected[0]).lower() == 'true'
        return (actual is None) == want_missing
    if actual is None:
        if if_exists or qualifier == 'ForAllValues':
            return True
        if qualifier == 'ForAnyValue':
            return False
        return base in NEGATED
    values = as_list(actual)
    if qualifier == 'ForAllValues':
        return all(_match_one(base, v, expected, ctx) for v in values)
    return any(_match_one(base, v, expected, ctx) for v in values)


def conditions_hold(cond, ctx):
    for op, kv in (cond or {}).items():
        for key, expected in kv.items():
            if not _condition_holds(op, key, expected, ctx):
                return False
    return True


def _principal_match(spec, req):
    """'direct' when the statement names the caller (or everyone), 'account' for its account."""
    if spec == '*':
        return 'direct'
    if not isinstance(spec, dict):
        return None
    caller = req.get('principal')
    account = req.get('account')
    best = None
    for kind, vals in spec.items():
        for v in as_list(vals):
            if kind == 'AWS':
                if v == '*':
                    return 'direct'
                if caller and v == caller:
                    return 'direct'
                if account and v in (account, f'arn:aws:iam::{account}:root'):
                    best = 'account'
            elif kind == 'Service' and v == req.get('service'):
                return 'direct'
    return best


def _statement_matches(st, req, resource_policy):
    """None if the statement does not apply, else how the principal matched."""
    how = 'identity'
    if resource_policy:
        if 'Principal' in st:
            how = _principal_match(st['Principal'], req)
            if how is None:
                return None
        elif 'NotPrincipal' in st:
            if _principal_match(st['NotPrincipal'], req):
                return None
            how = 'direct'
        else:
            return None
    action = req['action']
    if 'Action' in st:
        if not any(_glob(a, action, ignore_case=True) for a in as_list(st['Action'])):
            return None
    elif 'NotAction' in st:
        if any(_glob(a, action, ignore_case=True) for a in as_list(st['NotAction'])):
            return None
    else:
        return None
    resource = req.get('resource')
    if 'Resource' in st:
        if resource is None or not any(
            _glob(_subst(r, req.get('context', {})), resource) for r in as_list(st['Resource'])
        ):
            return None
    elif 'NotResource' in st:
        if resource is not None and any(
            _glob(_subst(r, req.get('context', {})), resource) for r in as_list(st['NotResource'])
        ):
            return None
    elif not resource_policy:
        return None
    if not conditions_hold(st.get('Condition'), req.get('context', {})):
        return None
    return how


def statements(policy):
    if not policy:
        return []
    if isinstance(policy, str):
        policy = json.loads(policy)
    return as_list(policy.get('Statement'))


def decide(req, identity=(), resource_policy=None, key_policy=None, boundary=None):
    """'allow', 'deny' (explicit) or 'implicit' for one request.

    req: {'principal': arn or None, 'account': id or None, 'action', 'resource', 'context'}
    identity: identity policies of the caller. resource_policy: bucket/secret policy.
    key_policy: a KMS key policy (KMS semantics: IAM policies only count when the key policy
    allows the account).
    """
    ident = [s for p in identity for s in statements(p)]
    res = statements(resource_policy)
    key = statements(key_policy)
    for st in ident:
        if st.get('Effect') == 'Deny' and _statement_matches(st, req, False):
            return 'deny'
    for st in res + key:
        if st.get('Effect') == 'Deny' and _statement_matches(st, req, True):
            return 'deny'
    if boundary is not None:
        bstmts = statements(boundary)
        if any(s.get('Effect') == 'Deny' and _statement_matches(s, req, False) for s in bstmts):
            return 'deny'
        boundary_ok = any(
            s.get('Effect') == 'Allow' and _statement_matches(s, req, False) for s in bstmts
        )
    else:
        boundary_ok = True
    identity_allows = boundary_ok and any(
        st.get('Effect') == 'Allow' and _statement_matches(st, req, False) for st in ident
    )
    if key_policy is not None:
        direct = account = False
        for st in key:
            if st.get('Effect') != 'Allow':
                continue
            how = _statement_matches(st, req, True)
            direct = direct or how == 'direct'
            account = account or how == 'account'
        if direct or (account and identity_allows):
            return 'allow'
        return 'implicit'
    if identity_allows:
        return 'allow'
    for st in res:
        if st.get('Effect') == 'Allow' and _statement_matches(st, req, True) == 'direct':
            return 'allow'
    return 'implicit'
