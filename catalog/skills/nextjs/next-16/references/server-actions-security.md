# Server actions: authorization patterns and how to test them

For `next@16.4.3`. Measured facts were reproduced with `next build` + `next start`; the guidance
follows `dist/docs/01-app/02-guides/data-security.md` and `03-api-reference/01-directives/use-server.md`.

## What the client controls (measured)

| How the action gets its input | What ends up in the page / request | Can a user change it? |
| --- | --- | --- |
| `action.bind(null, id)` | a hidden field whose value is `[&quot;inv_17&quot;]`, and the same JSON in the POST body | **yes**: editing the value runs the action with any id |
| `<input type="hidden" name="invoiceId">` | plain form field | **yes** |
| `formData.get('…')` from visible inputs | plain form field | yes |
| variable captured by an inline `'use server'` function | a hidden field holding an encrypted blob (key regenerated per build) | not readable or forgeable, but replayable within the build |
| `cookies()` / `headers()` read inside the action | the browser's cookies | only by having that session |

The only trustworthy identity is the session read inside the action. Everything else is a claim to
verify against your data.

## The pattern: authorize the target, inside the action

```ts
// app/invoices/[invoiceId]/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/lib/db'
import { readSession } from '@/lib/auth'

const Memo = z.string().trim().min(1).max(200)

async function invoiceForBillingAdmin(invoiceId: unknown) {
  const session = await readSession()
  if (!session) throw new Error('Not signed in')
  const invoice = typeof invoiceId === 'string' ? await db.invoice.byId(invoiceId) : null
  // Same error for "missing" and "not yours": don't leak which ids exist.
  if (!invoice || !(await db.org.isBillingAdmin(invoice.orgId, session.userId))) {
    throw new Error('Not allowed')
  }
  return invoice
}

export async function voidInvoice(invoiceId: string) {
  const invoice = await invoiceForBillingAdmin(invoiceId)
  await db.invoice.void(invoice.id)
  revalidatePath(`/invoices/${invoice.id}`)
  redirect('/invoices')
}

export async function setInvoiceMemo(invoiceId: string, formData: FormData) {
  const invoice = await invoiceForBillingAdmin(invoiceId)
  const memo = Memo.safeParse(formData.get('memo'))
  if (!memo.success) return { error: 'Memo must be 1-200 characters' }
  await db.invoice.setMemo(invoice.id, memo.data)
  revalidatePath(`/invoices/${invoice.id}`)
  return { error: null }
}
```

Why each piece is there:

- `typeof invoiceId === 'string'`: arguments are decoded from the request and can be any
  serializable value, whatever the TypeScript signature says.
- The permission check runs against the record loaded by id, so a forged id fails the check.
- The helper is not exported: a `'use server'` file may only export async functions (measured
  build error: "Only async functions are allowed to be exported in a "use server" file"), and an
  exported helper would itself be a public endpoint.
- Validation happens on the server with the same rules the form shows.
- `redirect()` comes after the mutation and the cache invalidation, outside any `try/catch`.

A Data Access Layer (`import 'server-only'` module whose functions take ids and check the session
themselves) is the same idea moved one level down, and keeps actions, Route Handlers and pages
consistent.

## Things that look like protection but are not

| Looks safe | Why it isn't |
| --- | --- |
| The page only renders the form for admins | The action is a separate POST endpoint; anyone can send the request |
| `proxy.ts` matcher covers `/admin/:path*` | It checks a cookie exists, not ownership; a matcher change or moving the action silently removes it |
| The id is bound on the server with `.bind()` | Bound arguments round-trip through the client in plain text |
| `isOwner` / `role` passed as an argument | The client sends it back; it can say anything |
| Unguessable action ids | They are in every page that renders the form |
| Same-origin check | Stops cross-site form posts (Next compares `Origin` to the host); does nothing against a signed-in user crafting requests |

## Returning errors

```tsx
'use client'
import { useActionState } from 'react'

export function MemoForm({ action }: { action: (prev: unknown, fd: FormData) => Promise<{ error: string | null }> }) {
  const [state, formAction, pending] = useActionState(action, { error: null })
  return (
    <form action={formAction}>
      <input name="memo" />
      {state.error && <p role="alert">{state.error}</p>}
      <button disabled={pending}>Save</button>
    </form>
  )
}
```

With `useActionState` the action receives `(previousState, formData)`; adjust its signature and
still re-check permissions on every call. Thrown errors become an error boundary on the client and a
500 for a no-JavaScript form post; return values for expected failures, throw for "should never
happen" (forbidden, missing).

## Testing an action without a browser

`next build && next start`, then:

- **No-JavaScript form post (what a plain HTML form does).** Fetch the page with the user's cookie,
  collect every `<input>` of the `<form>` (including the hidden action fields React renders, whose
  names start with a dollar sign and `ACTION_`), change the fields you want, and POST them as
  `multipart/form-data` to the same URL with an `Origin` header matching the host. A redirect comes
  back as `303` with `Location`.
- **To test an attack**, take the form from a resource the attacker legitimately owns and swap in the
  victim's id everywhere it appears; then assert on the database, not on the response.
- **JavaScript-style call.** POST to the page with header `Next-Action: <id>` (ids are in
  `.next/server/server-reference-manifest.json`, keyed by file and export name) and
  `Accept: text/x-component`. Plain arguments go as a JSON array body; a `FormData` argument goes as
  multipart with its fields prefixed `_1_` and, **last**, a root field `0` holding the JSON array of
  arguments, where the FormData is the reference string dollar-K-1 (and a bound id comes first in the
  array). The root field must come last or the decoder sees an empty FormData.

## Other knobs

- `experimental.serverActions.bodySizeLimit` (default 1 MB).
- `experimental.serverActions.allowedOrigins` for hosts in front of the app that don't forward
  `x-forwarded-host`. A request with no `Origin` header is let through with a warning.
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` keeps closure encryption keys stable across instances and
  builds when self-hosting several servers.
- Unused actions are removed from the build, but every action that some page renders is reachable.
