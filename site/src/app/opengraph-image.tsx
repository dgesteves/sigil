import { SIGIL_MARK } from '@/components/Sigil'
import { getData } from '@/lib/server/data'
import { OG_SIZE, ogImage } from '@/lib/server/og'

export const size = OG_SIZE
export const contentType = 'image/png'
export const alt = 'Sigil: every AI agent capability, proven'

export default async function Image() {
  const { views, demo } = await getData()
  const proven = views.filter((v) => v.uplift === 'proven').length
  return ogImage({
    digest: SIGIL_MARK,
    kicker: 'the open proving ground',
    title: 'Every AI agent capability, proven.',
    line: views.length
      ? `${views.length} capabilities in the registry · ${proven} proven by A/B runs on hidden tests`
      : 'A/B runs on hidden tests, a canary sandbox and a sealed digest. Nothing is proven until it is measured.',
    demo,
  })
}
