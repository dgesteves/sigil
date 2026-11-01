import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { CartBadge } from './cart-badge'

export const metadata: Metadata = {
  title: 'Corner Shop',
  description: 'Coffee gear, shipped from our corner of the world.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/">Corner Shop</Link>
          <Suspense fallback={<span data-testid="cart">Cart</span>}>
            <CartBadge />
          </Suspense>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
