import { describe, expect, it } from 'vitest'
import { matchesPackage, matchFiles, packagesIn, pickManifests } from '../src/core/stack.js'

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

  it('reads root manifests first and skips vendored ones', () => {
    expect(
      pickManifests([
        'packages/b/package.json',
        'node_modules/x/package.json',
        'examples/demo/package.json',
        'go.mod',
        'package.json',
        'apps/a/package.json',
      ]),
    ).toEqual(['go.mod', 'package.json', 'apps/a/package.json', 'packages/b/package.json'])
  })

  it('matches Maven groups and Go modules by prefix, everything else exactly', () => {
    expect(
      matchesPackage('maven', 'org.springframework.boot:spring-boot', 'org.springframework'),
    ).toBe(true)
    expect(matchesPackage('go', 'github.com/gin-gonic/gin/v2', 'github.com/gin-gonic/gin')).toBe(
      true,
    )
    expect(matchesPackage('npm', 'react-dom', 'react')).toBe(false)
  })
})
