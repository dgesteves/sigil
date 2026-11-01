import { type Person, PersonPicker } from './PersonPicker.tsx'

export interface IssueSidebarProps {
  team: Person[]
  onAssign: (person: Person) => void
  onRequestReview: (person: Person) => void
}

/** Right-hand column of the issue page: two pickers on the same screen. */
export function IssueSidebar({ team, onAssign, onRequestReview }: IssueSidebarProps) {
  return (
    <aside className="issue-sidebar">
      <PersonPicker label="Assignee" people={team} onSelect={onAssign} placeholder="Search people" />
      <PersonPicker
        label="Reviewer"
        people={team}
        onSelect={onRequestReview}
        placeholder="Search people"
      />
    </aside>
  )
}
