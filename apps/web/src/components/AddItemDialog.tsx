import { useState } from 'react'
import { api } from '../lib/api.js'

interface Props {
  onClose: () => void
  onAdded: () => void
}

export function AddItemDialog({ onClose, onAdded }: Props) {
  const [tab, setTab] = useState<'manual' | 'receipt'>('manual')
  const [code, setCode] = useState('')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    setBusy(true)
    try {
      // Allow user to paste a Costco URL — extract /p/{code}
      const codeMatch = code.match(/\/p\/(\d{4,9})/)
      const codeToUse = codeMatch ? codeMatch[1] : code.trim()
      await api('/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({
          code: codeToUse,
          purchase_price: Number(price),
          purchase_date: date,
          notes: notes || undefined,
        }),
      })
      onAdded()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex gap-2 border-b border-white/10">
          <button
            className={`px-3 py-2 text-sm ${tab === 'manual' ? 'border-b-2 border-accent text-accent' : 'text-white/60'}`}
            onClick={() => setTab('manual')}
          >
            手動輸入
          </button>
          <button
            className={`px-3 py-2 text-sm ${tab === 'receipt' ? 'border-b-2 border-accent text-accent' : 'text-white/60'}`}
            onClick={() => setTab('receipt')}
          >
            拍發票（#10）
          </button>
          <button
            className="ml-auto px-2 text-white/50 hover:text-white"
            onClick={onClose}
            aria-label="關閉"
          >
            ✕
          </button>
        </div>

        {tab === 'manual' && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm text-white/70">
                商品代碼 或 Costco 商品連結
              </span>
              <input
                className="w-full rounded bg-white/5 px-3 py-2"
                placeholder="例如 217455 或 https://www.costco.com.tw/.../p/217455"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm text-white/70">購買價 (TWD)</span>
                <input
                  className="w-full rounded bg-white/5 px-3 py-2"
                  type="number"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-white/70">購買日期</span>
                <input
                  className="w-full rounded bg-white/5 px-3 py-2"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm text-white/70">備註（選填）</span>
              <input
                className="w-full rounded bg-white/5 px-3 py-2"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {err && <p className="text-sm text-red-400">{err}</p>}
            <button
              className="btn btn-primary w-full"
              disabled={busy || !code || !price}
              onClick={submit}
            >
              {busy ? '抓取商品中...' : '加入追蹤'}
            </button>
          </div>
        )}
        {tab === 'receipt' && (
          <p className="py-6 text-center text-white/60">
            發票拍照辨識功能將於 issue #10 完成。
          </p>
        )}
      </div>
    </div>
  )
}
