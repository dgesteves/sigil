'use client'

import type { AgentId } from '@core/ids'
import { useState } from 'react'
import { AGENT_LABEL } from '@/lib/model'
import styles from './install.module.css'

/** One install line per agent. Whether it was compiled for that agent is stated, never implied. */
export function InstallLines({
  id,
  agents,
  compiled,
}: {
  id: string
  agents: AgentId[]
  compiled: Partial<Record<AgentId, boolean>>
}) {
  const [agent, setAgent] = useState<AgentId>(agents[0] ?? 'claude-code')
  const [copied, setCopied] = useState(false)
  const line = `npx sigil add ${id} --agent ${agent}`
  const state = compiled[agent]
  return (
    <div className={styles.install}>
      <div className={styles.tabs} role="tablist" aria-label="Agent">
        {agents.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={a === agent}
            onClick={() => setAgent(a)}
          >
            {AGENT_LABEL[a]}
          </button>
        ))}
      </div>
      <div className={styles.line} role="tabpanel">
        <code>
          <span>$</span> {line}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(line)
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            } catch {}
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <p className={styles.state}>
        {state === true
          ? `Compiled for ${AGENT_LABEL[agent]}.`
          : state === false
            ? `Not compiled for ${AGENT_LABEL[agent]}: sigil add will refuse.`
            : `No compile record for ${AGENT_LABEL[agent]} on this digest.`}{' '}
        Install never runs capability scripts, and refuses on any digest mismatch.
      </p>
    </div>
  )
}
