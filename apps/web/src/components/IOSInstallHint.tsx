import { useEffect, useState } from 'react'

export function IOSInstallHint() {
  const [show, setShow] = useState(false)
  const [dismissed, setDismissed] = useState(() =>
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('ios-install-dismissed') === '1'
      : false,
  )

  useEffect(() => {
    if (typeof navigator === 'undefined' || dismissed) return
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !('MSStream' in window)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari nav-only flag
      // @ts-expect-error legacy
      window.navigator.standalone === true
    setShow(isIOS && !isStandalone)
  }, [dismissed])

  if (!show) return null

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 rounded-lg bg-card p-3 text-sm shadow-lg ring-1 ring-white/10">
      📱 點擊 Safari 底部 <strong>分享</strong> → <strong>加入主畫面</strong> 即可安裝為 App
      <button
        className="ml-2 text-white/60 hover:text-white"
        onClick={() => {
          localStorage.setItem('ios-install-dismissed', '1')
          setDismissed(true)
        }}
        aria-label="關閉"
      >
        ✕
      </button>
    </div>
  )
}
