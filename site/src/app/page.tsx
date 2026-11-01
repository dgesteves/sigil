import { MachineSource } from '@/components/chrome/Machine'
import { Observatory } from '@/components/observatory/Observatory'
import { registryMarkdown } from '@/lib/machine'
import { getData } from '@/lib/server/data'

export default async function Home() {
  const data = await getData()
  const meta = {
    demo: data.demo,
    source: data.source,
    generatedAt: data.registry.generatedAt,
    ...(data.commit ? { commit: data.commit } : {}),
  }
  return (
    <>
      <MachineSource
        title="Registry"
        href="/llms.txt"
        markdown={registryMarkdown(data.views, meta)}
        json={JSON.stringify({ ...meta, capabilities: data.views }, null, 2)}
      />
      <Observatory caps={data.views} meta={meta} />
    </>
  )
}
