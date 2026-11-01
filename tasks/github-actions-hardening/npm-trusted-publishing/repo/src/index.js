import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const TABLE = parse(readFileSync(new URL('./units.yaml', import.meta.url), 'utf8'))
const DIMENSION = new Map(
  Object.entries(TABLE).flatMap(([dimension, units]) => Object.keys(units).map((u) => [u, dimension])),
)

/** Converts `value` from one unit to another of the same dimension, e.g. convert(3, 'ft', 'm'). */
export function convert(value, from, to) {
  const a = DIMENSION.get(from)
  const b = DIMENSION.get(to)
  if (!a) throw new RangeError(`unknown unit: ${from}`)
  if (!b) throw new RangeError(`unknown unit: ${to}`)
  if (a !== b) throw new TypeError(`cannot convert ${a} (${from}) to ${b} (${to})`)
  return (value * TABLE[a][from]) / TABLE[b][to]
}

export const units = (dimension) => Object.keys(TABLE[dimension] ?? {})
