import * as z from 'zod'

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

// The form parser sends "" for blank inputs; a blank field is a missing field.
const blank = (value: unknown) => (value === '' ? undefined : value)

// Only customise the "missing" case. A schema-level error also covers the schema's own checks,
// so returning a message for every issue would hide the length and format messages.
const requiredText = (message: string) =>
  z.preprocess(blank, z.string({ error: (iss) => (iss.input === undefined ? message : undefined) }))

const optionalText = z.preprocess(blank, z.string().optional())

const SignupFields = z.object({
  // Normalise first, then check the format: z.email().trim() would validate before trimming.
  email: requiredText('Email is required')
    .pipe(z.string().trim().toLowerCase())
    .pipe(z.email('Enter a valid email address')),
  password: requiredText('Password is required').pipe(
    z.string().min(12, 'Password must be at least 12 characters'),
  ),
  confirmPassword: optionalText,
  displayName: z.preprocess(
    blank,
    z
      .string()
      .min(2, 'Display name must be 2 to 30 characters')
      .max(30, 'Display name must be 2 to 30 characters')
      .optional(),
  ),
  address: z.object({
    line1: requiredText('Address line 1 is required'),
    line2: optionalText,
    postcode: requiredText('Postcode is required'),
  }),
  interests: z.array(z.enum(['news', 'events', 'offers'], 'Unknown interest')).default([]),
})

const PasswordPair = SignupFields.pick({ password: true, confirmPassword: true })

const SignupForm = SignupFields.refine((form) => form.password === form.confirmPassword, {
  error: 'Passwords do not match',
  path: ['confirmPassword'],
  // Object refinements are skipped once any field has failed, but the form shows every error at
  // once. Run this one whenever the two password fields parse, whatever happened elsewhere. Checking
  // the value (not just issue paths) keeps it from running on a body that is not even an object.
  when: (payload) => PasswordPair.safeParse(payload.value).success,
}).transform(({ confirmPassword: _confirmPassword, ...user }): NewUser => user)

function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.')
    errors[key] ??= []
    errors[key].push(issue.message)
  }
  return errors
}

export function validateSignup(body: unknown): SignupResult {
  const result = SignupForm.safeParse(body)
  if (!result.success) return { ok: false, errors: toFieldErrors(result.error) }
  return { ok: true, user: result.data }
}
