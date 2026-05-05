import { useRegisterSW } from 'virtual:pwa-register/react'

export function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Check for updates every hour
      if (r) setInterval(() => r.update(), 60 * 60 * 1000)
    },
  })

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg bg-card p-4 shadow-lg ring-1 ring-white/10">
      <p className="mb-3 text-sm">有新版本可用</p>
      <div className="flex gap-2">
        <button
          className="btn btn-primary text-sm"
          onClick={() => updateServiceWorker(true)}
        >
          更新
        </button>
        <button
          className="btn btn-ghost text-sm"
          onClick={() => setNeedRefresh(false)}
        >
          稍後
        </button>
      </div>
    </div>
  )
}
