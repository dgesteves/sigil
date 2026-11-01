/** Trace text limits from the core Trace schema. */
export const EVENT_TEXT_MAX = 2000
export const VERIFY_OUTPUT_MAX = 4000

const MARK = '\n… [truncated] …\n'

/** Keeps the head and the tail: the start says what happened, the end says how it ended. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const room = max - MARK.length
  const head = Math.ceil(room / 2)
  return `${text.slice(0, head)}${MARK}${text.slice(text.length - (room - head))}`
}

/** Keeps the tail: verifier output ends with the summary that explains a failure. */
export function tail(text: string, max: number): string {
  if (text.length <= max) return text
  const lead = '… [truncated] …\n'
  return `${lead}${text.slice(text.length - (max - lead.length))}`
}
