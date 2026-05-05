import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { api } from '../lib/api.js'

interface Product {
  code: string
  zh_name: string
  en_name: string | null
  current_price: number
  base_price: number | null
  discount_price: number | null
  unit_price: number | null
  unit_type: string | null
  url: string
  image_url: string | null
  in_stock: boolean
  last_checked_at: string
}
interface HistoryRow {
  observed_at: string
  price: number
  base_price: number | null
  discount_price: number | null
}
interface Stats {
  min_price: number | null
  max_price: number | null
  avg_price: number | null
  sample_count: number
}

export function ProductDetailPage() {
  const { code = '' } = useParams()

  const product = useQuery({
    queryKey: ['product', code],
    queryFn: async (): Promise<Product> => {
      const res = await api(`/api/products/${encodeURIComponent(code)}`)
      return res.json()
    },
    enabled: !!code,
  })
  const history = useQuery({
    queryKey: ['product-history', code],
    queryFn: async (): Promise<HistoryRow[]> => {
      const res = await api(
        `/api/products/${encodeURIComponent(code)}/history?days=90`,
      )
      const json = (await res.json()) as { history: HistoryRow[] }
      return json.history
    },
    enabled: !!code,
  })
  const stats = useQuery({
    queryKey: ['product-stats', code],
    queryFn: async (): Promise<Stats> => {
      const res = await api(
        `/api/products/${encodeURIComponent(code)}/stats`,
      )
      return res.json()
    },
    enabled: !!code,
  })

  if (product.isLoading)
    return <div className="card text-white/60">載入中...</div>
  if (product.error || !product.data)
    return (
      <div className="card text-red-400">
        無法載入商品 #{code}：{(product.error as Error)?.message}
      </div>
    )

  const p = product.data
  const chartData =
    history.data?.map((h) => ({
      date: h.observed_at.slice(5, 10), // MM-DD
      price: h.price,
      original: h.base_price ?? h.price,
    })) ?? []

  return (
    <div className="space-y-4">
      <div className="text-sm">
        <Link to="/" className="text-white/60 hover:underline">
          ← 回到追蹤清單
        </Link>
      </div>

      <div className="card flex gap-4">
        {p.image_url && (
          <img
            src={p.image_url}
            alt=""
            className="h-32 w-32 shrink-0 rounded object-cover"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h1 className="flex-1 text-lg font-bold">{p.zh_name}</h1>
            <span
              className={`badge ${p.in_stock ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
            >
              {p.in_stock ? '有貨' : '缺貨'}
            </span>
          </div>
          {p.en_name && (
            <p className="text-sm text-white/50">{p.en_name}</p>
          )}
          <p className="mt-1 text-xs text-white/50">#{p.code}</p>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold">${p.current_price}</span>
            {p.base_price && p.base_price > p.current_price && (
              <span className="text-sm text-white/50 line-through">
                ${p.base_price}
              </span>
            )}
            {p.discount_price && p.discount_price > 0 && (
              <span className="badge bg-orange-500/20 text-orange-300">
                折 ${p.discount_price}
              </span>
            )}
          </div>
          {p.unit_price != null && p.unit_type && (
            <p className="text-sm text-white/60">
              ${p.unit_price} / {p.unit_type}
            </p>
          )}
          <p className="mt-2 text-xs text-white/40">
            最後更新 {new Date(p.last_checked_at).toLocaleString('zh-TW')}
          </p>

          <div className="mt-3 flex gap-2">
            <a
              className="btn btn-primary text-sm"
              href={p.url}
              target="_blank"
              rel="noreferrer"
            >
              在 Costco 開啟 ↗
            </a>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">價格走勢（90 天）</h2>
          {stats.data && stats.data.sample_count > 0 && (
            <div className="text-xs text-white/60">
              低 ${stats.data.min_price} · 高 ${stats.data.max_price} · 平均 $
              {Math.round(stats.data.avg_price ?? 0)}
            </div>
          )}
        </div>
        {chartData.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/50">
            尚無歷史價格紀錄。明天的 cron 跑完之後就會出現第一筆。
          </p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                <XAxis dataKey="date" stroke="#ffffff80" fontSize={11} />
                <YAxis
                  stroke="#ffffff80"
                  fontSize={11}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1a1a2e',
                    border: '1px solid #ffffff20',
                    borderRadius: 8,
                  }}
                  formatter={(v: number) => `$${v}`}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#facc15"
                  strokeWidth={2}
                  dot={false}
                  name="目前價"
                />
                {stats.data?.min_price != null && (
                  <ReferenceLine
                    y={stats.data.min_price}
                    stroke="#22c55e"
                    strokeDasharray="4 4"
                    label={{
                      value: `歷史最低 $${stats.data.min_price}`,
                      fill: '#22c55e',
                      fontSize: 10,
                      position: 'insideBottomRight',
                    }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
