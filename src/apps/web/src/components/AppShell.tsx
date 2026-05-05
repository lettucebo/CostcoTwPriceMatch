import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Me } from '../hooks/useMe.js'
import { api } from '../lib/api.js'

export function AppShell({ user, children }: { user: Me; children: ReactNode }) {
  const loc = useLocation()
  const isActive = (path: string) =>
    loc.pathname === path ? 'bg-white/10' : 'hover:bg-white/5'
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link to="/" className="text-lg font-bold">
            🛒 CostcoMatch
          </Link>
          <nav className="ml-4 flex gap-1 text-sm">
            <Link to="/" className={`rounded px-3 py-1.5 ${isActive('/')}`}>
              Dashboard
            </Link>
            <Link
              to="/settings"
              className={`rounded px-3 py-1.5 ${isActive('/settings')}`}
            >
              設定
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-white/70 md:inline">
              {user.email}
            </span>
            {user.picture && (
              <img
                src={user.picture}
                alt=""
                className="h-8 w-8 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            <button
              className="btn btn-ghost text-sm"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST', allow401: true })
                location.href = '/login'
              }}
            >
              登出
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 py-8 text-center text-xs text-white/40">
        Costco TW Price Match · Personal Use · Data from costco.com.tw
      </footer>
    </div>
  )
}
