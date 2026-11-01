import { inflateRawSync } from 'node:zlib'

/**
 * A minimal, bounded ZIP reader. Scanners that skip archives were bypassed with a `.docx` (a ZIP) that
 * carried a shell script; we list every member and read small text members so the same rules apply.
 * Nothing is ever extracted to disk.
 */
export interface ZipMember {
  name: string
  encrypted: boolean
  size: number
  /** Decompressed bytes, when the member is small enough and uses store or deflate. */
  data?: Buffer
}

export interface ZipListing {
  members: ZipMember[]
  /** Set when the archive could not be fully read (corrupt, ZIP64, too many members). */
  incomplete?: string
}

const MAX_MEMBERS = 5000
const MAX_MEMBER_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024

export function readZip(buf: Buffer): ZipListing {
  const eocd = findEocd(buf)
  if (eocd < 0) return { members: [], incomplete: 'no end-of-central-directory record' }
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff)
    return { members: [], incomplete: 'ZIP64 archive' }

  const members: ZipMember[] = []
  let total = 0
  let p = cdOffset
  for (let i = 0; i < Math.min(count, MAX_MEMBERS); i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      return { members, incomplete: 'corrupt central directory' }
    }
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compressed = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen

    const member: ZipMember = { name, encrypted: (flags & 1) === 1, size }
    if (
      !member.encrypted &&
      !name.endsWith('/') &&
      size <= MAX_MEMBER_BYTES &&
      total + size <= MAX_TOTAL_BYTES
    ) {
      const data = memberData(buf, local, compressed, method, size)
      if (data) {
        member.data = data
        total += data.length
      }
    }
    members.push(member)
  }
  return count > MAX_MEMBERS
    ? { members, incomplete: `more than ${MAX_MEMBERS} members` }
    : { members }
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 65_557)
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) return i
  return -1
}

function memberData(
  buf: Buffer,
  local: number,
  compressed: number,
  method: number,
  size: number,
): Buffer | undefined {
  if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return undefined
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
  const raw = buf.subarray(start, start + compressed)
  try {
    if (method === 0) return raw
    if (method === 8) return inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) })
  } catch {
    return undefined
  }
  return undefined
}
