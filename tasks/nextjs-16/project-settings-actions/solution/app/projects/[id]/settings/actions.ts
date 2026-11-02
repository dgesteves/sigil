'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getProject, deleteProject as removeProject, updateProjectName } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'

// Every export here is a public endpoint. The projectId comes from `.bind()`, which the client
// sends back in plain text, so treat it as untrusted input and re-check ownership on every call.
async function requireOwner(projectId: unknown) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')
  const project = typeof projectId === 'string' ? await getProject(projectId) : null
  if (!project || project.ownerId !== user.id) throw new Error('Only the project owner can do that')
  return project
}

export async function renameProject(projectId: string, formData: FormData) {
  const project = await requireOwner(projectId)
  const raw = formData.get('name')
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name.length < 1 || name.length > 80) throw new Error('Project names are 1 to 80 characters')

  await updateProjectName(project.id, name)
  revalidatePath(`/projects/${project.id}/settings`)
}

export async function deleteProject(projectId: string) {
  const project = await requireOwner(projectId)
  await removeProject(project.id)
  revalidatePath('/projects')
  redirect('/projects')
}
