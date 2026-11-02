import { notFound, redirect } from 'next/navigation'
import { getProject, getUsers } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { deleteProject, renameProject } from './actions'

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const project = await getProject(id)
  if (!project || (project.ownerId !== user.id && !project.memberIds.includes(user.id))) notFound()

  const isOwner = project.ownerId === user.id
  const members = await getUsers([project.ownerId, ...project.memberIds])

  return (
    <main>
      <h1 data-testid="project-name">{project.name}</h1>

      {isOwner ? (
        <form action={renameProject.bind(null, project.id)}>
          <label>
            Project name <input name="name" defaultValue={project.name} />
          </label>
          <button type="submit">Rename</button>
        </form>
      ) : (
        <p>Only the project owner can change these settings.</p>
      )}

      {isOwner && (
        <section>
          <h2>Danger zone</h2>
          <form action={deleteProject.bind(null, project.id)}>
            <button type="submit">Delete project</button>
          </form>
        </section>
      )}

      <h2>Members</h2>
      <ul>
        {members.map((m) => (
          <li key={m.id}>
            {m.name}
            {m.id === project.ownerId ? ' (owner)' : ''}
          </li>
        ))}
      </ul>
    </main>
  )
}
