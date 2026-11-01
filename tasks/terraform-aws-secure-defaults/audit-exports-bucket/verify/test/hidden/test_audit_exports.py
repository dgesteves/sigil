"""Hidden verifier: the audit exports bucket applies on a brand-new bucket and is locked down.

The stack is applied against the local emulator (see tfverify.py), which treats new buckets the way
AWS has since April 2023 (ACLs disabled, Block Public Access on). The statements bucket is the one
pre-2023 bucket in the scenario, so it keeps the old defaults.
"""

import unittest

import tfverify as tv

BUCKET = 'acme-ledger-prod-audit-exports'
LEGACY = 'acme-ledger-prod-statements'
BUCKET_ARN = f'arn:aws:s3:::{BUCKET}'
OBJECT_ARN = f'{BUCKET_ARN}/2026/10/ledger-audit.csv.gz'
EXPORTER = f'arn:aws:iam::{tv.ACCOUNT}:role/ledger-audit-exporter'
EXTERNAL = 'arn:aws:iam::210987654321:role/auditor'
ADMIN_POLICY = {'Statement': [{'Effect': 'Allow', 'Action': 's3:*', 'Resource': '*'}]}


class AuditExportsBucket(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blocks = tv.parse_dir(tv.ROOT)
        cls.emu = tv.Emulator(legacy_buckets=[LEGACY])
        tv.clean_workspace()
        tv.write_override(cls.emu, cls.blocks)
        init = tv.init_if_needed(cls.blocks)
        if init is not None and init.returncode != 0:
            raise AssertionError(f'terraform init failed:\n{init.stdout[-2000:]}{init.stderr[-2000:]}')
        cls.code, cls.messages, cls.raw = tv.apply()
        cls.state = tv.read_state()
        cls.s3 = cls.emu.client('s3')
        cls.kms = cls.emu.client('kms')

    @classmethod
    def tearDownClass(cls):
        cls.emu.stop()

    def require_apply(self):
        if self.code != 0:
            self.fail(
                'terraform apply failed against a fresh account (as the pipeline will run it):\n'
                + tv.describe_errors(self.messages, self.raw)
            )

    def bucket_exists(self):
        self.require_apply()
        names = [b['Name'] for b in self.s3.list_buckets()['Buckets']]
        self.assertIn(BUCKET, names, f'no bucket named {BUCKET} was created (got {names})')

    def test_applies_cleanly(self):
        self.require_apply()

    def test_bucket_created(self):
        self.bucket_exists()

    def test_block_public_access_managed_by_terraform(self):
        self.bucket_exists()
        cfg = self.s3.get_public_access_block(Bucket=BUCKET)['PublicAccessBlockConfiguration']
        for key in ('BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'):
            self.assertTrue(cfg.get(key), f'{key} is not enabled on {BUCKET}')
        managed = [
            attrs
            for _, attrs in tv.state_instances(self.state, 'aws_s3_bucket_public_access_block')
            if attrs.get('bucket') == BUCKET
        ]
        self.assertTrue(
            managed,
            'Block Public Access must be managed in Terraform (an aws_s3_bucket_public_access_block '
            f'for {BUCKET}), otherwise drift is never detected or reverted',
        )
        for attrs in managed:
            for key in ('block_public_acls', 'block_public_policy', 'ignore_public_acls',
                        'restrict_public_buckets'):
                self.assertTrue(attrs.get(key), f'{key} is not true in the Terraform resource')

    def test_acls_disabled(self):
        self.bucket_exists()
        rules = self.s3.get_bucket_ownership_controls(Bucket=BUCKET)['OwnershipControls']['Rules']
        self.assertEqual(
            rules[0]['ObjectOwnership'],
            'BucketOwnerEnforced',
            'Object Ownership must stay "bucket owner enforced" so ACLs are disabled',
        )
        acls = [a for _, a in tv.state_instances(self.state, 'aws_s3_bucket_acl')
                if a.get('bucket') == BUCKET]
        self.assertFalse(acls, 'the bucket must not have an ACL resource: ACLs are disabled')

    def test_versioning_enabled(self):
        self.bucket_exists()
        status = self.s3.get_bucket_versioning(Bucket=BUCKET).get('Status')
        self.assertEqual(status, 'Enabled', 'versioning is not enabled')

    def encryption(self, bucket):
        rules = self.s3.get_bucket_encryption(Bucket=bucket)['ServerSideEncryptionConfiguration'][
            'Rules'
        ]
        return rules[0]

    def test_encrypted_with_its_own_customer_managed_key(self):
        self.bucket_exists()
        rule = self.encryption(BUCKET)
        default = rule.get('ApplyServerSideEncryptionByDefault', {})
        self.assertEqual(default.get('SSEAlgorithm'), 'aws:kms', 'default encryption is not SSE-KMS')
        key_id = default.get('KMSMasterKeyID')
        self.assertTrue(key_id, 'no KMS key is set, so S3 would use the AWS managed aws/s3 key')
        meta = self.kms.describe_key(KeyId=key_id)['KeyMetadata']
        self.assertEqual(meta.get('KeyManager'), 'CUSTOMER', f'{key_id} is not a customer managed key')
        legacy = self.encryption(LEGACY)['ApplyServerSideEncryptionByDefault']['KMSMasterKeyID']
        legacy_id = self.kms.describe_key(KeyId=legacy)['KeyMetadata']['KeyId']
        self.assertNotEqual(meta['KeyId'], legacy_id, 'the bucket must get its own key, not the statements key')
        rotation = self.kms.get_key_rotation_status(KeyId=meta['KeyId'])
        self.assertTrue(rotation.get('KeyRotationEnabled'), 'automatic key rotation is not enabled')
        self.assertTrue(rule.get('BucketKeyEnabled'), 'S3 Bucket Keys are not enabled')

    def bucket_policy(self):
        self.bucket_exists()
        try:
            return self.s3.get_bucket_policy(Bucket=BUCKET)['Policy']
        except self.s3.exceptions.ClientError:
            self.fail('the bucket has no bucket policy, so plain-HTTP requests are not denied')

    def request(self, principal, action, resource, secure):
        account = principal.split(':')[4] if principal else None
        ctx = {
            'aws:SecureTransport': 'true' if secure else 'false',
            'aws:PrincipalIsAWSService': 'false',
            'aws:ResourceAccount': tv.ACCOUNT,
            's3:ResourceAccount': tv.ACCOUNT,
        }
        if principal:
            ctx.update({'aws:PrincipalArn': principal, 'aws:PrincipalAccount': account,
                        'aws:PrincipalType': 'AssumedRole'})
        if secure:
            ctx['s3:TlsVersion'] = '1.3'
        if action == 's3:PutObject':
            rule = self.encryption(BUCKET)['ApplyServerSideEncryptionByDefault']
            ctx['s3:x-amz-server-side-encryption'] = 'aws:kms'
            if rule.get('KMSMasterKeyID'):
                key = self.kms.describe_key(KeyId=rule['KMSMasterKeyID'])['KeyMetadata']['Arn']
                ctx['s3:x-amz-server-side-encryption-aws-kms-key-id'] = key
        if action == 's3:ListBucket':
            ctx['s3:prefix'] = '2026/'
        return {'principal': principal, 'account': account, 'action': action,
                'resource': resource, 'context': ctx}

    PROBES = [
        ('s3:GetObject', OBJECT_ARN),
        ('s3:PutObject', OBJECT_ARN),
        ('s3:DeleteObject', OBJECT_ARN),
        ('s3:ListBucket', BUCKET_ARN),
    ]

    def test_requests_without_tls_are_denied(self):
        policy = self.bucket_policy()
        for principal in (EXPORTER, f'arn:aws:iam::{tv.ACCOUNT}:root', EXTERNAL):
            for action, resource in self.PROBES:
                req = self.request(principal, action, resource, secure=False)
                identity = [ADMIN_POLICY] if principal == EXPORTER else []
                got = tv.decide(req, identity=identity, resource_policy=policy)
                self.assertEqual(
                    got, 'deny',
                    f'{action} over plain HTTP by {principal} is not explicitly denied by the bucket policy',
                )

    def test_tls_requests_still_work(self):
        policy = self.bucket_policy()
        for action, resource in self.PROBES:
            req = self.request(EXPORTER, action, resource, secure=True)
            got = tv.decide(req, identity=[ADMIN_POLICY], resource_policy=policy)
            self.assertEqual(
                got, 'allow',
                f'the bucket policy blocks a normal TLS {action} by a role in the account that IAM allows',
            )

    def test_not_public(self):
        policy = self.bucket_policy()
        for action, resource in self.PROBES:
            req = self.request(None, action, resource, secure=True)
            self.assertNotEqual(
                tv.decide(req, resource_policy=policy), 'allow', f'anonymous {action} is allowed'
            )
        acl = self.s3.get_bucket_acl(Bucket=BUCKET)
        for grant in acl.get('Grants', []):
            uri = grant.get('Grantee', {}).get('URI', '')
            self.assertNotIn('AllUsers', uri, 'the bucket ACL grants public access')
            self.assertNotIn('AuthenticatedUsers', uri, 'the bucket ACL grants public access')

    def test_no_new_deprecated_arguments(self):
        # Deprecation warnings are reported while Terraform validates, before anything is applied.
        found = []
        for d in tv.diagnostics(self.messages, 'warning'):
            text = f"{d.get('summary', '')} {d.get('detail', '')}".lower()
            if 'deprecat' not in text:
                continue
            context = (d.get('snippet') or {}).get('context') or ''
            if '"statements"' in context:
                continue  # the 2022 bucket, out of scope for this change
            where = (d.get('range') or {}).get('filename', '?')
            line = f"{d.get('summary')} ({context or where}): {(d.get('detail') or '')[:300]}"
            if line not in found:
                found.append(line)
        if found:
            self.fail('the change introduces deprecated usage:\n' + '\n'.join(found))


if __name__ == '__main__':
    unittest.main()
