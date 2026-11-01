#!/usr/bin/env python3
"""Install the pinned toolchain into .tools/ and initialise Terraform.

- Terraform comes from releases.hashicorp.com and must match the SHA-256 published in
  terraform_<version>_SHA256SUMS (that file is signed by HashiCorp's release key).
- requirements-dev.txt (moto, for offline smoke runs) is installed with --require-hashes.
- Providers are installed by `terraform init` and checked against .terraform.lock.hcl.
"""

import hashlib
import io
import platform
import subprocess
import sys
import urllib.request
import venv
import zipfile
from pathlib import Path

TERRAFORM_VERSION = '1.17.1'
TERRAFORM_SHA256 = {
    'amd64': '4638628058e71a55212b1c563712eac03b902128f40740f3dc8174df12135061',
    'arm64': '988e950a1c23058093b0e66ab2d5fb53fc18345ecfbd5871acf51dbac9325edd',
}

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / '.tools'


def arch():
    machine = platform.machine().lower()
    if machine in ('x86_64', 'amd64'):
        return 'amd64'
    if machine in ('aarch64', 'arm64'):
        return 'arm64'
    sys.exit(f'unsupported architecture: {machine}')


def install_terraform():
    target = TOOLS / 'terraform'
    if target.exists():
        return target
    a = arch()
    url = (
        f'https://releases.hashicorp.com/terraform/{TERRAFORM_VERSION}/'
        f'terraform_{TERRAFORM_VERSION}_linux_{a}.zip'
    )
    data = urllib.request.urlopen(url, timeout=120).read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != TERRAFORM_SHA256[a]:
        sys.exit(f'checksum mismatch for {url}: {digest}')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        target.write_bytes(z.read('terraform'))
    target.chmod(0o755)
    return target


def install_python_tools():
    env = TOOLS / 'venv'
    if not env.exists():
        venv.create(env, with_pip=True)
    pip = env / 'bin' / 'pip'
    subprocess.run(
        [str(pip), 'install', '--quiet', '--disable-pip-version-check', '--require-hashes',
         '--no-deps', '-r', str(ROOT / 'requirements-dev.txt')],
        check=True,
    )


def main():
    TOOLS.mkdir(exist_ok=True)
    terraform = install_terraform()
    install_python_tools()
    subprocess.run(
        [str(terraform), 'init', '-input=false', '-no-color', '-lockfile=readonly'],
        cwd=ROOT,
        check=True,
    )


if __name__ == '__main__':
    main()
