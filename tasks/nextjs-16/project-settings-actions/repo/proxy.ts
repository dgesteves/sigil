import { type NextRequest, NextResponse } from 'next/server'

// Optimistic check only: bounce visitors without a session cookie to the sign-in page.
export function proxy(request: NextRequest) {
  if (!request.cookies.has('session')) {
    const login = new URL('/login', request.url)
    login.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(login)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/projects/:path*'],
}
