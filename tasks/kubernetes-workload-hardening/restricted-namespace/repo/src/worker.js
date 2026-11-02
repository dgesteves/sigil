import { setTimeout as sleep } from 'node:timers/promises'
import { renderLabel } from './labels.js'

// Placeholder for the queue client: the real one long-polls the batch queue at QUEUE_URL.
async function nextBatch() {
  await sleep(5000)
  return []
}

let stopping = false
process.on('SIGTERM', () => {
  stopping = true
})

while (!stopping) {
  for (const shipment of await nextBatch()) await renderLabel(shipment)
}
