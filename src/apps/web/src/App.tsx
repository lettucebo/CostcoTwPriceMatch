import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useMe } from './hooks/useMe.js'
import { LoginPage } from './pages/LoginPage.js'
import { DashboardPage } from './pages/DashboardPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { AppShell } from './components/AppShell.js'

// Recharts is the heaviest single dep; only the product detail page uses it.
// Lazy-loading the page splits Recharts out of the main bundle.
const ProductDetailPage = lazy(() =>
  import('./pages/ProductDetailPage.js').then((m) => ({
    default: m.ProductDetailPage,
  })),
)

export function App() {
  const me = useMe()
  if (me.isLoading) {
    return <FullPageSpinner />
  }
  if (!me.data) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  return (
    <AppShell user={me.data}>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/products/:code" element={<ProductDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-white/60">
      <div className="animate-pulse">載入中...</div>
    </div>
  )
}
