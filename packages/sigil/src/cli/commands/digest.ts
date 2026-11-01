import { resolve } from 'node:path'
import { digestDir } from '../../core/index.js'
import { type Command, fmt } from '../command.js'

export const digest: Command = {
  name: 'digest',
  summary: 'Print the payload digest of a capability (reproducible with shasum)',
  usage: 'sigil digest <path> [--files]',
  options: { files: { type: 'boolean' } },
  async run({ positionals, values }, ctx) {
    const target = positionals[0]
    if (!target) {
      ctx.err(fmt.fail('usage: sigil digest <path>'))
      return 2
    }
    try {
      const { digest, files } = await digestDir(resolve(ctx.cwd, target))
      if (values.files) for (const f of files) ctx.out(`${f.sha256}  ${f.path}`)
      ctx.out(digest)
      return 0
    } catch (e) {
      ctx.err(fmt.fail((e as Error).message))
      return 1
    }
  },
}
