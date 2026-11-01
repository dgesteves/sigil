import { Marked } from 'marked'
import { REPO_URL } from '../model'

export interface Heading {
  id: string
  text: string
  depth: number
}

/** GitHub-compatible heading anchors, so links like #the-seal keep working. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-')
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]!)

/** Renders repo-authored markdown (trusted input). Relative links resolve to the repo on GitHub. */
export function renderMarkdown(md: string, from = 'spec'): { html: string; headings: Heading[] } {
  const headings: Heading[] = []
  const marked = new Marked({ gfm: true })
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        const text = decode(html.replace(/<[^>]+>/g, ''))
        const id = slugify(text)
        if (depth <= 3) headings.push({ id, text, depth })
        return `<h${depth} id="${id}"><a href="#${id}" aria-hidden="true" tabindex="-1">#</a>${html}</h${depth}>\n`
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens)
        let url = href
        if (!/^[a-z]+:|^#|^\//i.test(href)) {
          const parts = `${from}/${href}`.split('/')
          const out: string[] = []
          for (const p of parts) {
            if (p === '..') out.pop()
            else if (p !== '.') out.push(p)
          }
          url = `${REPO_URL}/blob/main/${out.join('/')}`
        }
        const ext = /^https?:/.test(url) ? ' rel="noopener"' : ''
        return `<a href="${url}"${title ? ` title="${title}"` : ''}${ext}>${text}</a>`
      },
    },
  })
  const html = marked.parse(md, { async: false }) as string
  return { html, headings }
}
