import { shuffle } from './rng.js'
import type { Condition, PlanItem } from './types.js'

/**
 * Every (task, condition, run) once, in a seeded random order, so time of day, API load and cache
 * warmth never line up with one condition. The same seed always yields the same order.
 */
export function buildPlan(
  tasks: readonly { suite: string; task: string }[],
  conditions: readonly Condition[],
  runs: number,
  seed: number,
): PlanItem[] {
  const items: PlanItem[] = []
  for (const t of tasks) {
    for (const condition of conditions) {
      for (let n = 1; n <= runs; n++) items.push({ suite: t.suite, task: t.task, condition, n })
    }
  }
  return shuffle(items, seed)
}

/** Runs `worker` over items with at most `concurrency` in flight, in order of start. */
export async function parallel<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const lanes = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await worker(items[i]!, i)
      }
    },
  )
  await Promise.all(lanes)
  return results
}
