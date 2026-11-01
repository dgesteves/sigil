# Getting started

Relay forwards webhooks from your payment provider to your own services.

1. Create a project in the dashboard and copy its signing secret.
2. Install the CLI with `npm install -g relay-cli`.
3. Run `relay listen --forward http://localhost:3000/webhooks` to receive events locally.

Every event is signed. Verify the signature before you trust the payload, then deploy your
handler once local testing looks right.
