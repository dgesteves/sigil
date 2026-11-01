import type { AgentId } from '../../core/ids.js'
import { claudeCode } from './claude-code.js'
import type { AgentDriver } from './types.js'

/**
 * Agents the lab can run today. Deliberately partial: a driver is added only once its CLI has been
 * run headless here and its stream parsed from real output (Codex, Gemini CLI, OpenCode, Cursor CLI
 * and Copilot CLI are next).
 */
export const DRIVERS: Partial<Record<AgentId, AgentDriver>> = {
  'claude-code': claudeCode,
}

export function driverFor(id: string): AgentDriver | undefined {
  return Object.hasOwn(DRIVERS, id) ? DRIVERS[id as AgentId] : undefined
}
