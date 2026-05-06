import { useState } from 'react'
import { api, API_BASE } from '../lib/api.js'

interface Props {
  onClose: () => void
  onAdded: () => void
}

interface OcrItem {
  code: string | null
  name: string
  price: number
  quantity: number
  matched_product?: {
    code: string
    zh_name: string
    current_price: number
    image_url: string | null
  }
}

export function AddItemDialog({ onClose, onAdded }: Props) {
  const [tab, setTab] = useState<'manual' | 'receipt'>('manual')
  const [code, setCode] = useState('')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Receipt OCR state
  const [ocrItems, setOcrItems] = useState<OcrItem[] | null>(null)
  const [ocrDate, setOcrDate] = useState<string>(date)
  const [ocrSelected, setOcrSelected] = useState<Record<number, boolean>>({})

  const submit = async () => {
    setErr(null)
    setBusy(true)
    try {
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

  const onScan = async (file: File) => {
    setErr(null)
    setBusy(true)
    setOcrItems(null)
    // Workers AI Llama 3.2 Vision rejects images > 8 MB with a 413; fail fast
    // here so the user gets immediate feedback instead of a long upload.
    const MAX_BYTES = 8 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      setErr(
        `圖片太大 (${(file.size / 1024 / 1024).toFixed(1)} MB)，上限 8 MB。請壓縮後再試。`,
      )
      setBusy(false)
      return
    }
    try {
      const fd = new FormData()
      fd.append('image', file)
      // Don't use api() helper — that sets JSON content-type. Use raw fetch.
      const res = await fetch(`${API_BASE}/api/receipts/scan`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`OCR failed: ${res.status} ${body.slice(0, 200)}`)
      }
      const json = (await res.json()) as {
        purchase_date: string | null
        items: OcrItem[]
      }
      setOcrItems(json.items)
      if (json.purchase_date) setOcrDate(json.purchase_date)
      // Pre-select all items with a matched product
      const sel: Record<number, boolean> = {}
      json.items.forEach((it, i) => {
        sel[i] = !!it.matched_product
      })
      setOcrSelected(sel)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirmReceipt = async () => {
    setErr(null)
    setBusy(true)
    try {
      const items =
        ocrItems
          ?.filter((_, i) => ocrSelected[i])
          .map((it) => ({
            code: it.matched_product?.code ?? it.code,
            purchase_price: it.price,
          }))
          .filter((x): x is { code: string; purchase_price: number } => !!x.code) ?? []
      if (items.length === 0) {
        setErr('請至少選擇一個品項')
        return
      }
      const res = await api('/api/receipts/confirm', {
        method: 'POST',
        body: JSON.stringify({
          purchase_date: ocrDate,
          items,
        }),
      })
      const result = (await res.json()) as {
        added: number
        skipped: number
        failed: number
      }
      alert(
        `已加入 ${result.added} 項${result.skipped ? `（${result.skipped} 項已存在）` : ''}${result.failed ? `，${result.failed} 項失敗` : ''}`,
      )
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
        className="card max-h-[90vh] w-full max-w-md overflow-y-auto"
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
            拍發票
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
          <div className="space-y-3">
            {!ocrItems && (
              <>
                <label className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-white/20 p-6">
                  <span className="text-3xl">📷</span>
                  <span className="text-sm text-white/70">
                    拍照或上傳 Costco 紙本發票
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) onScan(f)
                    }}
                  />
                  <span className="btn btn-primary text-sm">選擇圖片</span>
                </label>
                {busy && (
                  <p className="text-center text-sm text-white/60">
                    使用 Workers AI 辨識中（約需 5-15 秒）...
                  </p>
                )}
              </>
            )}

            {ocrItems && (
              <>
                <label className="block">
                  <span className="mb-1 block text-sm text-white/70">購買日期</span>
                  <input
                    className="w-full rounded bg-white/5 px-3 py-2"
                    type="date"
                    value={ocrDate}
                    onChange={(e) => setOcrDate(e.target.value)}
                  />
                </label>
                <p className="text-sm text-white/60">
                  辨識出 {ocrItems.length} 項，已勾選的會加入清單：
                </p>
                <ul className="space-y-2">
                  {ocrItems.map((it, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-2 rounded p-2 ${
                        it.matched_product ? 'bg-white/5' : 'bg-red-500/10'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!!ocrSelected[i]}
                        onChange={(e) =>
                          setOcrSelected((s) => ({
                            ...s,
                            [i]: e.target.checked,
                          }))
                        }
                        className="mt-1"
                        aria-label={`選擇 ${it.name}`}
                        disabled={!it.matched_product && !it.code}
                      />
                      <div className="flex-1 text-sm">
                        <div className="font-medium">
                          {it.matched_product?.zh_name ?? it.name}
                        </div>
                        <div className="text-xs text-white/60">
                          #{it.matched_product?.code ?? it.code ?? '無代碼'}
                          {' · '}買入 ${it.price}
                          {it.matched_product && (
                            <span> · 目前 ${it.matched_product.current_price}</span>
                          )}
                        </div>
                        {!it.matched_product && (
                          <div className="text-xs text-red-300">
                            無法在 Costco 找到此商品，請手動輸入
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {err && <p className="text-sm text-red-400">{err}</p>}
                <div className="flex gap-2">
                  <button
                    className="btn btn-ghost text-sm"
                    onClick={() => setOcrItems(null)}
                  >
                    重新拍
                  </button>
                  <button
                    className="btn btn-primary flex-1 text-sm"
                    disabled={busy}
                    onClick={confirmReceipt}
                  >
                    {busy ? '加入中...' : '加入勾選項目'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
