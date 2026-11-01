import { openLocalDb } from './db.ts'
import { migrate } from './migrate.ts'

const db = openLocalDb()
const applied = await migrate(db, 'migrations', (line) => console.log(line))
if (applied.length === 0) console.log('nothing to apply')
await db.close()
