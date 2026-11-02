import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listProjectsFor } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'

export default async function ProjectsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const projects = await listProjectsFor(user.id)

  return (
    <main>
      <h1>Your projects</h1>
      <ul>
        {projects.map((p) => (
          <li key={p.id} data-testid="project">
            <Link href={`/projects/${p.id}/settings`}>{p.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
