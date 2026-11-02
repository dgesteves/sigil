import { cookies } from 'next/headers'
import { findUserBySession, type User } from './db'

/** The signed-in user, from the `session` cookie set by our SSO callback. */
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get('session')?.value
  return token ? findUserBySession(token) : null
}
