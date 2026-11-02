import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cookies } from 'next/headers'

const sessionsFile = join(process.cwd(), 'data', 'staff-sessions.json')

/** The signed-in staff member's email, or null. Staff sign in through the SSO portal, which sets `staff_session`. */
export async function currentEditor(): Promise<string | null> {
  const token = (await cookies()).get('staff_session')?.value
  if (!token) return null
  const sessions: Record<string, string> = JSON.parse(await readFile(sessionsFile, 'utf8'))
  return Object.hasOwn(sessions, token) ? sessions[token]! : null
}
