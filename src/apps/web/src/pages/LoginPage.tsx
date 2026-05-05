import { API_BASE } from '../lib/api.js'

export function LoginPage() {
  const next = new URLSearchParams(location.search).get('next') ?? '/'
  const loginUrl = `${API_BASE}/auth/google/login?next=${encodeURIComponent(next)}`
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="card w-full max-w-sm text-center">
        <h1 className="mb-2 text-2xl font-bold">🛒 CostcoMatch</h1>
        <p className="mb-6 text-sm text-white/70">
          追蹤 Costco 台灣商品價格<br />
          自動偵測 30 天內降價並提醒申請退差價
        </p>
        <a className="btn btn-primary w-full" href={loginUrl}>
          使用 Google 登入
        </a>
        <p className="mt-4 text-xs text-white/40">個人使用 · 資料留在 Cloudflare 免費額度內</p>
      </div>
    </div>
  )
}
