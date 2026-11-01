import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type CapView, toView } from '@/lib/model'
import { matchFiles, packagesIn } from '@/lib/oracle/github'
import { emptySignals, meantAsTech, parseRepo, readText, type Tech } from '@/lib/oracle/intent'
import { buildIndex, compose, search, weigh } from '@/lib/oracle/rank'

const root = join(import.meta.dirname, '..')
const techs = new Map<string, Tech>(
  (
    [
      { id: 'react', name: 'React', kind: 'framework' },
      { id: 'nextjs', name: 'Next.js', kind: 'framework', parent: 'react' },
      { id: 'go', name: 'Go', kind: 'language' },
      { id: 'postgresql', name: 'PostgreSQL', kind: 'database' },
      { id: 'github-actions', name: 'GitHub Actions', kind: 'platform' },
      { id: 'rest', name: 'REST', kind: 'practice' },
    ] as Tech[]
  ).map((t) => [t.id, t]),
)
const demo = JSON.parse(readFileSync(join(root, 'fixtures/demo-registry.json'), 'utf8'))
const views: CapView[] = demo.capabilities.map(toView)

describe('intent', () => {
  it('reads GitHub repo URLs and nothing else', () => {
    expect(parseRepo('https://github.com/vercel/next.js')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    })
    expect(parseRepo('github.com/a-b/c_d.git')).toEqual({ owner: 'a-b', repo: 'c_d' })
    expect(parseRepo('react/server-components')).toBeNull()
    expect(parseRepo('https://gitlab.com/a/b')).toBeNull()
  })

  it('does not mistake English for technology', () => {
    expect(meantAsTech('the audit is next week', 'next')).toBe(false)
    expect(meantAsTech('make the UI react to scroll', 'react')).toBe(false)
    expect(meantAsTech("let's go ship it", 'go')).toBe(false)
    expect(meantAsTech('migrate our react app', 'react')).toBe(true)
    expect(meantAsTech('rate limit our Go service', 'go')).toBe(true)
    expect(meantAsTech('design a REST API', 'rest')).toBe(true)
  })

  it('implies parents and says why', () => {
    const s = readText('upgrade the Next.js app router', techs)
    expect(s.techs.get('nextjs')?.source).toMatch(/next\.js/)
    expect(s.techs.get('react')?.source).toBe('implied by Next.js')
    expect(readText('our checkout is slow and the audit is next week', techs).techs.size).toBe(0)
  })
})

describe('stack detection', () => {
  it('reads dependency names from manifests', () => {
    expect(
      packagesIn(
        'package.json',
        JSON.stringify({ dependencies: { next: '1' }, devDependencies: { vitest: '1' } }),
      ),
    ).toEqual(['next', 'vitest'])
    expect(
      packagesIn('requirements.txt', 'Django>=5\n# comment\n-e .\nfastapi[all]==0.1\n'),
    ).toEqual(['django', 'fastapi'])
    expect(
      packagesIn('go.mod', 'module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n)\n'),
    ).toEqual(['github.com/gin-gonic/gin'])
    expect(
      packagesIn(
        'Cargo.toml',
        '[package]\nname = "x"\n[dependencies]\naxum = "0.7"\ntokio = { version = "1" }\n',
      ),
    ).toEqual(['axum', 'tokio'])
    expect(packagesIn('package.json', '{ not json')).toEqual([])
  })

  it('matches taxonomy file signatures', () => {
    const files = ['README.md', 'src/app.css', '.github/workflows/ci.yml', 'deep/a/b/c/x.tf']
    expect(matchFiles('.github/workflows/*.yml', files)).toBe('.github/workflows/ci.yml')
    expect(matchFiles('*.css', files)).toBe('src/app.css')
    expect(matchFiles('*.tf', files)).toBeUndefined()
  })
})

describe('ranking', () => {
  const index = buildIndex(views)
  const ask = (q: string) => {
    const s = readText(q, techs, emptySignals())
    const { hits } = search(index, s, techs)
    return weigh(hits, ['claude-code'])
  }

  it('puts the matching, proven capability first', () => {
    const { ranked } = ask('add a column to a large Postgres table without downtime')
    expect(ranked[0]?.cap.id).toBe('demo/postgres-safe-migrations')
    expect(ranked[0]?.why).toContain('PostgreSQL')
  })

  it('never recommends harmful or revoked capabilities, and says so', () => {
    const { ranked, excluded } = ask('review pull requests and code review for our repo')
    expect(ranked.some((r) => r.cap.uplift === 'harmful' || r.cap.level === 'revoked')).toBe(false)
    expect(excluded.find((r) => r.cap.id === 'demo/pr-review-companion')?.excluded).toBe(
      'measured harmful',
    )
  })

  it('keeps bare word overlaps out when something matched properly', () => {
    const { ranked } = ask('harden our GitHub Actions workflows')
    const loadout = compose(ranked)
    expect(loadout[0]?.cap.id).toBe('demo/github-actions-hardening')
    expect(loadout.map((r) => r.cap.id)).not.toContain('demo/react-server-actions')
  })
})
