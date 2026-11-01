export type Interest = 'news' | 'events' | 'offers'

export interface NewUser {
  email: string
  password: string
  displayName?: string
  address: {
    line1: string
    line2?: string
    postcode: string
  }
  interests: Interest[]
}

/** Field path ("email", "address.postcode", "interests.1") -> messages shown under that field. */
export type FieldErrors = Record<string, string[]>

export type SignupResult = { ok: true; user: NewUser } | { ok: false; errors: FieldErrors }

// TODO: only covers the first two fields; the rest of the form is not validated server-side yet.
export function validateSignup(body: unknown): SignupResult {
  const input = body as Record<string, any>
  const errors: FieldErrors = {}
  if (!input.email) errors.email = ['Email is required']
  if (!input.password) errors.password = ['Password is required']
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, user: input as NewUser }
}
