import { MenuButton } from './MenuButton.tsx'

export interface AppHeaderProps {
  userName: string
  onNavigate: (path: string) => void
  onSignOut: () => void
}

export function AppHeader({ userName, onNavigate, onSignOut }: AppHeaderProps) {
  return (
    <header className="app-header">
      <a href="/">Ledger</a>
      <nav aria-label="Main">
        <a href="/invoices">Invoices</a>
        <a href="/customers">Customers</a>
      </nav>
      <MenuButton
        label={userName}
        items={[
          { id: 'profile', label: 'Profile', onSelect: () => onNavigate('/profile') },
          { id: 'settings', label: 'Settings', onSelect: () => onNavigate('/settings') },
          { id: 'billing', label: 'Billing', onSelect: () => onNavigate('/billing') },
          { id: 'sign-out', label: 'Sign out', onSelect: onSignOut },
        ]}
      />
    </header>
  )
}
