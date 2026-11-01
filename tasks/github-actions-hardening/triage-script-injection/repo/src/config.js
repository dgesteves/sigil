import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

/** Deep-merges plain objects; arrays and scalars from later layers replace earlier ones. */
export function merge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) out[key] = merge(base[key], value)
  return out
}

/** Loads YAML files in order, later files winning. Missing files are skipped. */
export function loadLayers(paths, read = (p) => readFileSync(p, 'utf8')) {
  let config = {}
  for (const path of paths) {
    let text
    try {
      text = read(path)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    const doc = parse(text) ?? {}
    if (!isPlainObject(doc)) throw new TypeError(`${path}: top level must be a mapping`)
    config = merge(config, doc)
  }
  return config
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
