import { readFileSync } from 'node:fs'

export interface Note {
  id: string
  title: string
  body: string
  tags: string[]
  updatedAt: string
}

export interface NoteSummary {
  id: string
  title: string
  updatedAt: string
}

const dataFile = new URL('../data/notes.json', import.meta.url)

export function loadNotes(): Note[] {
  return JSON.parse(readFileSync(dataFile, 'utf8')) as Note[]
}

export function newestFirst(a: Note, b: Note): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
}

export function summarize(note: Note): NoteSummary {
  return { id: note.id, title: note.title, updatedAt: note.updatedAt }
}
