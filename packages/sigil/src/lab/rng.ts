import { randomInt } from 'node:crypto'

/** A 32-bit seed, recorded in the run manifest so the run order can be reproduced exactly. */
export function newSeed(): number {
  return randomInt(1, 2 ** 31)
}

/** mulberry32: tiny, fast and good enough to shuffle a run plan. Not for anything secret. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates with a seeded generator. Returns a new array. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  const next = prng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}
