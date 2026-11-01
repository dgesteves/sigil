#!/usr/bin/env node
import { loadLayers } from './config.js'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: quarry <config.yaml>...')
  process.exit(2)
}
console.log(JSON.stringify(loadLayers(files), null, 2))
