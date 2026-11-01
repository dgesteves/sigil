import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENTS, type AgentId } from '../core/ids.js'
import { AGENT_INFO } from './agents.js'

export interface Detection {
  agent: AgentId
  /** The marker paths that were found. */
  found: string[]
}

/** Which agents a project uses, judged by the config files and folders each one creates. */
export async function detectAgents(root: string): Promise<Detection[]> {
  const out: Detection[] = []
  for (const agent of AGENTS) {
    const found: string[] = []
    for (const marker of AGENT_INFO[agent].markers) {
      try {
        await lstat(join(root, marker))
        found.push(marker)
      } catch {}
    }
    if (found.length) out.push({ agent, found })
  }
  return out
}

export function parseAgentList(value: string): AgentId[] {
  const ids = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const unknown = ids.filter((id) => !(AGENTS as readonly string[]).includes(id))
  if (unknown.length)
    throw new Error(`unknown agent ${unknown.join(', ')}; expected one of ${AGENTS.join(', ')}`)
  return [...new Set(ids)] as AgentId[]
}
