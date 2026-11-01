import type { Request, Response } from 'express'

export const SESSION_COOKIE = 'sid'

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

export function setCookie(res: Response, name: string, value: string, maxAgeMs: number): void {
  res.cookie(name, value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: maxAgeMs })
}
