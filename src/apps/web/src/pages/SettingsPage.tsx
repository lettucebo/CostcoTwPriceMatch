import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import type { Me } from '../hooks/useMe.js'
import {
  enableWebPush,
  disableWebPush,
  isWebPushSubscribed,
} from '../lib/webpush.js'

export function SettingsPage() {
  const qc = useQueryClient()
  const me = useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api('/api/me', { allow401: true })
      if (res.status === 401) return null
      return res.json()
    },
  })

  const [email, setEmail] = useState('')
  const [channels, setChannels] = useState<string[]>([])
  const [lineCode, setLineCode] = useState<{ code: string; expires_at: string } | null>(null)
  const [tgLink, setTgLink] = useState<{ code: string; expires_at: string; deep_link: string | null } | null>(null)
  const [pushOn, setPushOn] = useState(false)

  useEffect(() => {
    if (!me.data) return
    setEmail(me.data.notification_email ?? me.data.email)
    setChannels(me.data.channels)
  }, [me.data])

  useEffect(() => {
    isWebPushSubscribed().then(setPushOn)
  }, [])

  // While a link code is pending, poll /api/me every 5s so the UI flips to "已連結"
  // automatically once the bot's webhook claims the code.
  useEffect(() => {
    if (!lineCode && !tgLink) return
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['me'] })
    }, 5000)
    return () => clearInterval(id)
  }, [lineCode, tgLink, qc])

  useEffect(() => {
    if (lineCode && me.data?.line_linked) setLineCode(null)
    if (tgLink && me.data?.telegram_linked) setTgLink(null)
  }, [me.data?.line_linked, me.data?.telegram_linked, lineCode, tgLink])

  const saveNotifications = useMutation({
    mutationFn: async () => {
      await api('/api/me/notifications', {
        method: 'PATCH',
        body: JSON.stringify({
          notification_email: email,
          channels,
        }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
  const startLineLink = useMutation({
    mutationFn: async () => {
      const res = await api('/api/me/link/line/start', { method: 'POST' })
      return (await res.json()) as { code: string; expires_at: string }
    },
    onSuccess: (data) => setLineCode(data),
  })
  const unlinkLine = useMutation({
    mutationFn: async () => {
      await api('/api/me/link/line', { method: 'DELETE' })
    },
    onSuccess: () => {
      setLineCode(null)
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const startTgLink = useMutation({
    mutationFn: async () => {
      const res = await api('/api/me/link/telegram/start', { method: 'POST' })
      return (await res.json()) as {
        code: string
        expires_at: string
        deep_link: string | null
      }
    },
    onSuccess: (data) => setTgLink(data),
  })
  const unlinkTg = useMutation({
    mutationFn: async () => {
      await api('/api/me/link/telegram', { method: 'DELETE' })
    },
    onSuccess: () => {
      setTgLink(null)
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const togglePush = async () => {
    if (pushOn) {
      await disableWebPush()
      setPushOn(false)
    } else {
      const ok = await enableWebPush()
      setPushOn(ok)
    }
  }

  const toggleChannel = (ch: string) => {
    setChannels((cur) =>
      cur.includes(ch) ? cur.filter((c) => c !== ch) : [...cur, ch],
    )
  }

  if (!me.data) return <div className="card">載入中...</div>

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">設定</h1>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">通知 Email</h2>
        <input
          className="w-full rounded bg-white/5 px-3 py-2"
          placeholder="收件 Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <h2 className="text-base font-semibold">通知渠道</h2>
        <div className="space-y-2">
          {[
            { id: 'email', label: 'Email', enabled: true },
            {
              id: 'line',
              label: `LINE${me.data.line_linked ? '（已連結）' : '（需先在下方填入 userId）'}`,
              enabled: me.data.line_linked,
            },
            {
              id: 'telegram',
              label: `Telegram${me.data.telegram_linked ? '（已連結）' : '（需先在下方填入 chat_id）'}`,
              enabled: me.data.telegram_linked,
            },
            {
              id: 'webpush',
              label: 'Web Push（瀏覽器推播）',
              enabled: pushOn,
            },
          ].map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={channels.includes(c.id)}
                onChange={() => toggleChannel(c.id)}
                disabled={!c.enabled && c.id !== 'email'}
                aria-label={c.label}
              />
              <span className={c.enabled ? '' : 'text-white/50'}>
                {c.label}
              </span>
            </label>
          ))}
        </div>
        <button
          className="btn btn-primary text-sm"
          onClick={() => saveNotifications.mutate()}
          disabled={saveNotifications.isPending}
        >
          {saveNotifications.isPending ? '儲存中...' : '儲存通知設定'}
        </button>
      </section>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">LINE 連結</h2>
        <p className="text-xs text-white/60">
          按下「產生連結代碼」後，將代碼以純文字訊息傳送給已加入好友的 LINE Bot。
          系統會在收到訊息後自動完成連結（10 分鐘內有效）。
        </p>
        {me.data.line_linked ? (
          <button
            className="btn btn-ghost text-sm"
            onClick={() => unlinkLine.mutate()}
            disabled={unlinkLine.isPending}
          >
            取消 LINE 連結
          </button>
        ) : lineCode ? (
          <div className="space-y-2">
            <div className="rounded bg-white/10 px-3 py-2 text-center font-mono text-lg tracking-widest">
              {lineCode.code}
            </div>
            <p className="text-xs text-white/60">
              代碼有效至 {new Date(lineCode.expires_at).toLocaleTimeString('zh-TW')}。
              連結成功後此區塊會自動更新。
            </p>
            <button
              className="btn btn-ghost text-xs"
              onClick={() => setLineCode(null)}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className="btn btn-primary text-sm"
            onClick={() => startLineLink.mutate()}
            disabled={startLineLink.isPending}
          >
            {startLineLink.isPending ? '產生中...' : '產生連結代碼'}
          </button>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Telegram 連結</h2>
        <p className="text-xs text-white/60">
          按下「產生連結代碼」後，點擊產生的連結即可在 Telegram 中按下「Start」自動完成連結（10 分鐘內有效）。
        </p>
        {me.data.telegram_linked ? (
          <button
            className="btn btn-ghost text-sm"
            onClick={() => unlinkTg.mutate()}
            disabled={unlinkTg.isPending}
          >
            取消 Telegram 連結
          </button>
        ) : tgLink ? (
          <div className="space-y-2">
            {tgLink.deep_link ? (
              <a
                className="btn btn-primary block w-full text-center text-sm"
                href={tgLink.deep_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                在 Telegram 開啟並完成連結
              </a>
            ) : (
              <div className="rounded bg-white/10 px-3 py-2 font-mono text-xs">
                {`/start ${tgLink.code}`}
              </div>
            )}
            <p className="text-xs text-white/60">
              代碼有效至 {new Date(tgLink.expires_at).toLocaleTimeString('zh-TW')}。
            </p>
            <button
              className="btn btn-ghost text-xs"
              onClick={() => setTgLink(null)}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className="btn btn-primary text-sm"
            onClick={() => startTgLink.mutate()}
            disabled={startTgLink.isPending}
          >
            {startTgLink.isPending ? '產生中...' : '產生連結代碼'}
          </button>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Web Push</h2>
        <p className="text-xs text-white/60">
          啟用瀏覽器推播。iOS 16.4+ 需先「加入主畫面」才能訂閱。
        </p>
        <button className="btn btn-primary text-sm" onClick={togglePush}>
          {pushOn ? '取消訂閱推播' : '啟用瀏覽器推播'}
        </button>
      </section>
    </div>
  )
}
