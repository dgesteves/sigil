"""Hidden verifier: the transcoder role can do its job and nothing more.

The stack is applied against the local emulator, then every policy that applies to the role (inline,
attached customer and AWS managed policies, a permissions boundary if any, the bucket policy and the
key policy) is read back from the emulator and evaluated for the requests the service really makes,
and for requests it must not be able to make.
"""

import json
import unittest
from urllib.parse import unquote

import tfverify as tv

ROLE_NAME = 'acme-media-prod-transcoder'
ROLE_ARN = f'arn:aws:iam::{tv.ACCOUNT}:role/{ROLE_NAME}'
BUCKET = 'acme-media-prod'
BUCKET_ARN = f'arn:aws:s3:::{BUCKET}'
OTHER_BUCKET_ARN = 'arn:aws:s3:::acme-billing-prod'
OTHER_KEY_ARN = f'arn:aws:kms:{tv.REGION}:{tv.ACCOUNT}:key/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'


def doc(value):
    if isinstance(value, str):
        value = json.loads(unquote(value))
    return value


class TranscoderLeastPrivilege(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blocks = tv.parse_dir(tv.ROOT)
        cls.emu = tv.Emulator()
        tv.clean_workspace()
        tv.write_override(cls.emu, cls.blocks)
        init = tv.init_if_needed(cls.blocks)
        if init is not None and init.returncode != 0:
            raise AssertionError(f'terraform init failed:\n{init.stdout[-2000:]}{init.stderr[-2000:]}')
        cls.code, cls.messages, cls.raw = tv.apply()
        cls.iam = cls.emu.client('iam')
        cls.s3 = cls.emu.client('s3')
        cls.kms = cls.emu.client('kms')
        cls.loaded = False

    @classmethod
    def tearDownClass(cls):
        cls.emu.stop()

    def load(self):
        if self.code != 0:
            self.fail('terraform apply failed:\n' + tv.describe_errors(self.messages, self.raw))
        cls = type(self)
        if cls.loaded:
            return
        try:
            role = self.iam.get_role(RoleName=ROLE_NAME)['Role']
        except self.iam.exceptions.NoSuchEntityException:
            self.fail(f'the role {ROLE_NAME} no longer exists; the ECS service uses it')
        cls.trust = doc(role['AssumeRolePolicyDocument'])
        policies = []
        for name in self.iam.list_role_policies(RoleName=ROLE_NAME)['PolicyNames']:
            policies.append(doc(self.iam.get_role_policy(RoleName=ROLE_NAME, PolicyName=name)['PolicyDocument']))
        for att in self.iam.list_attached_role_policies(RoleName=ROLE_NAME)['AttachedPolicies']:
            policies.append(self.managed(att['PolicyArn']))
        cls.identity = policies
        boundary = role.get('PermissionsBoundary', {}).get('PermissionsBoundaryArn')
        cls.boundary = self.managed(boundary) if boundary else None
        try:
            cls.bucket_policy = self.s3.get_bucket_policy(Bucket=BUCKET)['Policy']
        except self.s3.exceptions.ClientError:
            cls.bucket_policy = None
        rule = self.s3.get_bucket_encryption(Bucket=BUCKET)['ServerSideEncryptionConfiguration'][
            'Rules'
        ][0]
        key_id = rule['ApplyServerSideEncryptionByDefault']['KMSMasterKeyID']
        meta = self.kms.describe_key(KeyId=key_id)['KeyMetadata']
        cls.key_arn = meta['Arn']
        cls.key_policy = self.kms.get_key_policy(KeyId=meta['KeyId'], PolicyName='default')['Policy']
        cls.loaded = True

    def managed(self, arn):
        pol = self.iam.get_policy(PolicyArn=arn)['Policy']
        ver = self.iam.get_policy_version(PolicyArn=arn, VersionId=pol['DefaultVersionId'])
        return doc(ver['PolicyVersion']['Document'])

    # -- requests --------------------------------------------------------------------------------

    def ctx(self, extra=None):
        c = {
            'aws:SecureTransport': 'true',
            's3:TlsVersion': '1.3',
            'aws:PrincipalArn': ROLE_ARN,
            'aws:PrincipalAccount': tv.ACCOUNT,
            'aws:PrincipalType': 'AssumedRole',
            'aws:PrincipalIsAWSService': 'false',
            'aws:ResourceAccount': tv.ACCOUNT,
            's3:ResourceAccount': tv.ACCOUNT,
        }
        c.update(extra or {})
        return c

    def s3_decision(self, action, resource, extra=None):
        self.load()
        req = {'principal': ROLE_ARN, 'account': tv.ACCOUNT, 'action': action,
               'resource': resource, 'context': self.ctx(extra)}
        return tv.decide(req, identity=self.identity, resource_policy=self.bucket_policy,
                         boundary=self.boundary)

    def kms_decision(self, action, key_arn=None, via_s3=True):
        self.load()
        extra = {'kms:CallerAccount': tv.ACCOUNT}
        if via_s3:
            extra.update({
                'kms:ViaService': f's3.{tv.REGION}.amazonaws.com',
                # With S3 Bucket Keys the encryption context is the bucket ARN, not the object ARN.
                'kms:EncryptionContext:aws:s3:arn': BUCKET_ARN,
                'kms:EncryptionContextKeys': ['aws:s3:arn'],
            })
        req = {'principal': ROLE_ARN, 'account': tv.ACCOUNT, 'action': action,
               'resource': key_arn or self.key_arn, 'context': self.ctx(extra)}
        return tv.decide(req, identity=self.identity, key_policy=self.key_policy,
                         boundary=self.boundary)

    def assert_allowed(self, got, what):
        self.assertEqual(got, 'allow', f'the transcoder can no longer {what} ({got})')

    def assert_refused(self, got, what):
        self.assertNotEqual(got, 'allow', f'the transcoder can still {what}')

    # -- what the service needs ------------------------------------------------------------------

    def test_apply_succeeds(self):
        self.load()

    def test_lists_uploads(self):
        for prefix in ('uploads/', 'uploads/v-20261101-0042/'):
            got = self.s3_decision('s3:ListBucket', BUCKET_ARN, {'s3:prefix': prefix})
            self.assert_allowed(got, f'list objects with Prefix={prefix}')

    def test_reads_sources(self):
        got = self.s3_decision('s3:GetObject', f'{BUCKET_ARN}/uploads/v-20261101-0042/source.mov')
        self.assert_allowed(got, 'download a source upload')
        self.assert_allowed(self.kms_decision('kms:Decrypt'), 'decrypt SSE-KMS objects (kms:Decrypt)')

    def test_writes_renditions(self):
        key = f'{BUCKET_ARN}/renditions/v-20261101-0042/1080p.mp4'
        self.assert_allowed(self.s3_decision('s3:PutObject', key), 'upload a rendition')
        self.assert_allowed(
            self.s3_decision('s3:AbortMultipartUpload', key), 'abort a failed multipart upload'
        )
        self.assert_allowed(
            self.kms_decision('kms:GenerateDataKey'),
            'encrypt uploads with the media key (kms:GenerateDataKey)',
        )

    def test_role_still_assumable_by_ecs(self):
        self.load()
        req = {
            'principal': None, 'account': None, 'service': 'ecs-tasks.amazonaws.com',
            'action': 'sts:AssumeRole', 'resource': ROLE_ARN,
            'context': {'aws:SourceAccount': tv.ACCOUNT,
                        'aws:SourceArn': f'arn:aws:ecs:{tv.REGION}:{tv.ACCOUNT}:task/media/0123456789abcdef'},
        }
        self.assertEqual(tv.decide(req, resource_policy=self.trust), 'allow',
                         'ECS tasks can no longer assume the role')

    # -- what it must not be able to do ----------------------------------------------------------

    def test_cannot_see_contracts(self):
        self.assert_refused(
            self.s3_decision('s3:GetObject', f'{BUCKET_ARN}/contracts/2026/talent-0042.pdf'),
            'read contracts/',
        )
        for extra, label in (
            ({'s3:prefix': 'contracts/'}, 'list contracts/'),
            ({'s3:prefix': 'contracts/2026/'}, 'list contracts/2026/'),
            ({'s3:prefix': ''}, 'list the whole bucket (empty prefix)'),
            ({}, 'list the whole bucket (no prefix)'),
        ):
            self.assert_refused(self.s3_decision('s3:ListBucket', BUCKET_ARN, extra), label)
        for action in ('s3:PutObject', 's3:DeleteObject', 's3:GetObjectVersion'):
            self.assert_refused(
                self.s3_decision(action, f'{BUCKET_ARN}/contracts/2026/talent-0042.pdf'),
                f'{action} on contracts/',
            )

    def test_cannot_delete_or_write_outside_renditions(self):
        for action, key in (
            ('s3:DeleteObject', 'renditions/v-20261101-0042/1080p.mp4'),
            ('s3:DeleteObject', 'uploads/v-20261101-0042/source.mov'),
            ('s3:DeleteObjectVersion', 'uploads/v-20261101-0042/source.mov'),
            ('s3:PutObject', 'uploads/v-20261101-0042/source.mov'),
            ('s3:PutObject', 'index.html'),
        ):
            self.assert_refused(self.s3_decision(action, f'{BUCKET_ARN}/{key}'), f'{action} on {key}')

    def test_cannot_manage_the_bucket(self):
        for action in ('s3:PutBucketPolicy', 's3:DeleteBucketPolicy', 's3:DeleteBucket',
                       's3:PutEncryptionConfiguration', 's3:PutLifecycleConfiguration',
                       's3:PutBucketVersioning'):
            self.assert_refused(self.s3_decision(action, BUCKET_ARN), action)

    def test_cannot_touch_other_buckets(self):
        self.assert_refused(self.s3_decision('s3:GetObject', f'{OTHER_BUCKET_ARN}/uploads/x'),
                            'read another bucket')
        self.assert_refused(
            self.s3_decision('s3:ListBucket', OTHER_BUCKET_ARN, {'s3:prefix': 'uploads/'}),
            'list another bucket',
        )
        self.assert_refused(self.s3_decision('s3:PutObject', f'{OTHER_BUCKET_ARN}/renditions/x'),
                            'write another bucket')

    def test_kms_limited_to_data_operations_on_the_media_key(self):
        self.assert_refused(self.kms_decision('kms:Decrypt', OTHER_KEY_ARN), 'decrypt with another key')
        self.assert_refused(self.kms_decision('kms:GenerateDataKey', OTHER_KEY_ARN),
                            'encrypt with another key')
        for action in ('kms:ScheduleKeyDeletion', 'kms:PutKeyPolicy', 'kms:DisableKey',
                       'kms:CreateGrant', 'kms:DisableKeyRotation'):
            self.assert_refused(self.kms_decision(action, via_s3=False), f'{action} on the media key')

    def test_no_iam_or_other_services(self):
        self.load()
        for action, resource in (
            ('iam:PassRole', f'arn:aws:iam::{tv.ACCOUNT}:role/admin'),
            ('iam:CreateRole', f'arn:aws:iam::{tv.ACCOUNT}:role/x'),
            ('sts:AssumeRole', f'arn:aws:iam::{tv.ACCOUNT}:role/admin'),
            ('dynamodb:Scan', f'arn:aws:dynamodb:{tv.REGION}:{tv.ACCOUNT}:table/orders'),
        ):
            req = {'principal': ROLE_ARN, 'account': tv.ACCOUNT, 'action': action,
                   'resource': resource, 'context': self.ctx()}
            self.assert_refused(tv.decide(req, identity=self.identity, boundary=self.boundary), action)


if __name__ == '__main__':
    unittest.main()
