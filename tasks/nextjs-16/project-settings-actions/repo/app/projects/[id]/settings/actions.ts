'use server'

import { revalidatePath } from 'next/cache'
import { updateProjectName } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'

export async function renameProject(projectId: string, formData: FormData) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')

  const name = String(formData.get('name') ?? '')
  await updateProjectName(projectId, name)
  revalidatePath(`/projects/${projectId}/settings`)
}
