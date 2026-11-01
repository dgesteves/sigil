import { type NewUser, validateSignup } from './signup.ts'

export interface HttpResponse {
  status: number
  body: unknown
}

export interface UserStore {
  create(user: NewUser): Promise<{ id: string }>
}

/** POST /signup. `form` is the body after our qs-style form parser. */
export async function handleSignup(form: unknown, users: UserStore): Promise<HttpResponse> {
  const result = validateSignup(form)
  if (!result.ok) return { status: 422, body: { errors: result.errors } }
  const { id } = await users.create(result.user)
  return { status: 201, body: { id } }
}
