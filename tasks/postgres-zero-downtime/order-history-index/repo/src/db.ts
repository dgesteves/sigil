import { PGlite } from '@electric-sql/pglite'

/** Local development database. Production connections are configured by the platform. */
export function openLocalDb(dataDir = '.pglite'): PGlite {
  return new PGlite(dataDir)
}
