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
  const [lineId, setLineId] = useState('')
  const [tgId, setTgId] = useState('')
  const [pushOn, setPushOn] = useState(false)

  useEffect(() => {
    if (!me.data) return
    setEmail(me.data.notification_email ?? me.data.email)
    setChannels(me.data.channels)
  }, [me.data])

  useEffect(() => {
    isWebPushSubscribed().then(setPushOn)
  }, [])

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
  const linkLine = useMutation({
    mutationFn: async (id: string | null) => {
      await api('/api/me/link/line', {
        method: 'PATCH',
        body: JSON.stringify({ line_user_id: id }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
  const linkTg = useMutation({
    mutationFn: async (id: string | null) => {
      await api('/api/me/link/telegram', {
        method: 'PATCH',
        body: JSON.stringify({ telegram_chat_id: id }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
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
          將 Bot 加為好友後，從 webhook 取得您的 userId（U 開頭，33 字元），貼在這裡。
          詳見 LINE Messaging API 文件。
        </p>
        <input
          className="w-full rounded bg-white/5 px-3 py-2 font-mono text-xs"
          placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          value={lineId}
          onChange={(e) => setLineId(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="btn btn-primary text-sm"
            onClick={() => linkLine.mutate(lineId.trim() || null)}
          >
            儲存
          </button>
          {me.data.line_linked && (
            <button
              className="btn btn-ghost text-sm"
              onClick={() => {
                setLineId('')
                linkLine.mutate(null)
              }}
            >
              取消連結
            </button>
          )}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Telegram 連結</h2>
        <p className="text-xs text-white/60">
          向您的 Telegram Bot 發 <code>/start</code>，從 getUpdates webhook 取得 chat.id（純數字），貼在這裡。
        </p>
        <input
          className="w-full rounded bg-white/5 px-3 py-2 font-mono text-xs"
          placeholder="123456789"
          value={tgId}
          onChange={(e) => setTgId(e.target.value)}
          inputMode="numeric"
        />
        <div className="flex gap-2">
          <button
            className="btn btn-primary text-sm"
            onClick={() => linkTg.mutate(tgId.trim() || null)}
          >
            儲存
          </button>
          {me.data.telegram_linked && (
            <button
              className="btn btn-ghost text-sm"
              onClick={() => {
                setTgId('')
                linkTg.mutate(null)
              }}
            >
              取消連結
            </button>
          )}
        </div>
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
