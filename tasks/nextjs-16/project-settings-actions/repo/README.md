# Tasklane web

Team projects for Tasklane, on Next.js 16 (App Router).

```sh
npm run dev
npm run build
npm test        # builds, then runs the integration tests in test/ against `next start`
```

- Sign-in happens in our SSO service, which sets the `session` cookie. `lib/session.ts` resolves it
  to a user. `proxy.ts` sends visitors without a session cookie to `/login`.
- `lib/db.ts` is the data layer (JSON files in `data/` locally). It does no permission checks.
- A project has one owner and any number of members. Members can see a project's settings page;
  only the owner can change settings.
