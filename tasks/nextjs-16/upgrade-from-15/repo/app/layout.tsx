import type { Metadata } from 'next'
import { cookies, type UnsafeUnwrappedCookies } from 'next/headers'
import Link from 'next/link'

export const metadata: Metadata = {
  title: { default: 'Field Notes', template: '%s | Field Notes' },
  metadataBase: new URL('https://fieldnotes.dev'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (cookies() as unknown as UnsafeUnwrappedCookies).get('theme')?.value === 'dark' ? 'dark' : 'light'
  return (
    <html lang="en" className={theme}>
      <body>
        <header>
          <Link href="/">Field Notes</Link> <Link href="/posts">Posts</Link>
        </header>
        {children}
      </body>
    </html>
  )
}
