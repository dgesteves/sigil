#!/usr/bin/env python3
"""Offline smoke run: `terraform apply` the stack against moto in a throwaway copy.

Run with the bootstrap venv: .tools/venv/bin/python scripts/smoke.py
moto is an emulator. It catches wiring mistakes (bad references, missing arguments, provider
validation), not every AWS-side rule, so a green smoke run is not proof that AWS accepts the change.
"""

import os
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVICES = ['ec2', 'iam', 'kms', 'rds', 's3', 'secretsmanager', 'sts']
# S3 Control calls go to <account-id>.<endpoint host>, so it needs a name, not an IP address.
S3CONTROL_HOST = 's3control.smoke.internal'
ACCOUNT = '123456789012'  # moto's default account


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def map_s3control_host():
    names = [S3CONTROL_HOST, f'{ACCOUNT}.{S3CONTROL_HOST}']
    try:
        if all(socket.gethostbyname(n) == '127.0.0.1' for n in names):
            return True
    except OSError:
        pass
    try:
        with open('/etc/hosts', 'a', encoding='utf-8') as f:
            f.write(f"\n127.0.0.1 {' '.join(names)}\n")
        return True
    except OSError:
        print('warning: cannot add the S3 Control host to /etc/hosts; tagged buckets will fail')
        return False


def main():
    import logging

    from moto.moto_server.threaded_moto_server import ThreadedMotoServer

    port = free_port()
    server = ThreadedMotoServer(ip_address='127.0.0.1', port=port, verbose=False)
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    server.start()
    endpoint = f'http://127.0.0.1:{port}'
    s3control = f'http://{S3CONTROL_HOST}:{port}' if map_s3control_host() else endpoint
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for item in ROOT.iterdir():
            if item.suffix == '.tf' or item.name in ('.terraform.lock.hcl', 'modules'):
                copy = shutil.copytree if item.is_dir() else shutil.copy2
                copy(item, work / item.name)
        endpoints = '\n'.join(f'    {s} = "{endpoint}"' for s in SERVICES)
        endpoints += f'\n    s3control = "{s3control}"'
        (work / 'zz_smoke_override.tf').write_text(
            'provider "aws" {\n'
            '  access_key                  = "AKIASMOKETEST0000000"\n'
            '  secret_key                  = "smoke"\n'
            '  skip_credentials_validation = true\n'
            '  skip_metadata_api_check     = true\n'
            '  s3_use_path_style           = true\n'
            '  max_retries                 = 2\n'
            f'  endpoints {{\n{endpoints}\n  }}\n'
            '}\n'
        )
        env = {k: v for k, v in os.environ.items() if not k.startswith('AWS_')}
        env['CHECKPOINT_DISABLE'] = '1'
        tf = str(ROOT / '.tools' / 'terraform')
        plugin_dir = f'-plugin-dir={ROOT / ".terraform" / "providers"}'
        steps = [
            [tf, 'init', '-input=false', '-no-color', '-backend=false', plugin_dir],
            [tf, 'apply', '-auto-approve', '-input=false', '-no-color', *sys.argv[1:]],
        ]
        for cmd in steps:
            result = subprocess.run(cmd, cwd=work, env=env)
            if result.returncode != 0:
                server.stop()
                sys.exit(result.returncode)
    server.stop()
    print('smoke apply against moto: ok')


if __name__ == '__main__':
    main()
