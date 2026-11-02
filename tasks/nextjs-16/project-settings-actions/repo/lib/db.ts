// Data access for Tasklane. Production uses Postgres; locally the tables are JSON files in data/.
// These functions do no permission checks: callers decide who may do what.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type User = { id: string; name: string }
export type Project = { id: string; name: string; ownerId: string; memberIds: string[] }

const file = {
  users: join(process.cwd(), 'data', 'users.json'),
  sessions: join(process.cwd(), 'data', 'sessions.json'),
  projects: join(process.cwd(), 'data', 'projects.json'),
}

async function read<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeProjects(projects: Record<string, Project>): Promise<void> {
  await writeFile(file.projects, `${JSON.stringify(projects, null, 2)}\n`)
}

export async function findUserBySession(token: string): Promise<User | null> {
  const sessions = await read<Record<string, string>>(file.sessions)
  if (!Object.hasOwn(sessions, token)) return null
  const users = await read<Record<string, User>>(file.users)
  return users[sessions[token]!] ?? null
}

export async function getUsers(ids: string[]): Promise<User[]> {
  const users = await read<Record<string, User>>(file.users)
  return ids.flatMap((id) => (users[id] ? [users[id]] : []))
}

export async function getProject(id: string): Promise<Project | null> {
  const projects = await read<Record<string, Project>>(file.projects)
  return Object.hasOwn(projects, id) ? projects[id]! : null
}

export async function listProjectsFor(userId: string): Promise<Project[]> {
  const projects = await read<Record<string, Project>>(file.projects)
  return Object.values(projects).filter((p) => p.ownerId === userId || p.memberIds.includes(userId))
}

export async function updateProjectName(id: string, name: string): Promise<void> {
  const projects = await read<Record<string, Project>>(file.projects)
  if (!projects[id]) throw new Error(`Unknown project ${id}`)
  projects[id].name = name
  await writeProjects(projects)
}

export async function deleteProject(id: string): Promise<void> {
  const projects = await read<Record<string, Project>>(file.projects)
  delete projects[id]
  await writeProjects(projects)
}
