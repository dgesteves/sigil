import type { Metadata, Viewport } from 'next'
import { Instrument_Serif, Martian_Mono } from 'next/font/google'
import { CommandK } from '@/components/chrome/CommandK'
import { DemoMark } from '@/components/chrome/DemoMark'
import { MachineProvider } from '@/components/chrome/Machine'
import { getData } from '@/lib/server/data'
import { DESCRIPTION, SITE_URL, TAGLINE } from '@/lib/site'
import './globals.css'

// One strict mono for everything measured, one serif for the human voice.
const mono = Martian_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  axes: ['wdth'],
  display: 'swap',
})
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `Sigil — ${TAGLINE}`, template: '%s · Sigil' },
  description: DESCRIPTION,
  applicationName: 'Sigil',
  openGraph: {
    type: 'website',
    siteName: 'Sigil',
    title: `Sigil — ${TAGLINE}`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image' },
  alternates: { types: { 'text/plain': '/llms.txt', 'application/json': '/registry.json' } },
}

export const viewport: Viewport = {
  themeColor: '#050505',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { demo } = await getData()
  return (
    <html lang="en" className={`${mono.variable} ${display.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {demo ? <DemoMark /> : null}
        <MachineProvider>{children}</MachineProvider>
        <CommandK />
      </body>
    </html>
  )
}
