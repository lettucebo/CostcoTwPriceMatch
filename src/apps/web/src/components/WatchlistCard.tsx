import { Link } from 'react-router-dom'
import type { WatchlistItemView } from '@costco/shared'

interface Props {
  item: WatchlistItemView
  onRefresh: () => void
  onDelete: () => void
  refreshing: boolean
}

export function WatchlistCard({ item, onRefresh, onDelete, refreshing }: Props) {
  const { product, purchase_price, days_remaining, price_diff, is_eligible } = item

  const status: { label: string; color: string } =
    days_remaining <= 0
      ? { label: '已過期', color: 'bg-red-500/20 text-red-300' }
      : is_eligible
        ? { label: '可退差價', color: 'bg-green-500/20 text-green-300' }
        : product.discount_price && product.discount_price > 0
          ? { label: '降價中', color: 'bg-orange-500/20 text-orange-300' }
          : { label: '無變動', color: 'bg-white/10 text-white/70' }

  const progress = Math.max(0, Math.min(100, (days_remaining / 30) * 100))

  return (
    <div className="card flex gap-3">
      <Link to={`/products/${product.code}`} className="shrink-0">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt=""
            className="h-24 w-24 rounded object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-24 w-24 rounded bg-white/5" />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <Link
            to={`/products/${product.code}`}
            className="line-clamp-2 flex-1 font-medium hover:underline"
          >
            {product.zh_name}
          </Link>
          <span className={`badge ${status.color}`}>{status.label}</span>
        </div>
        <p className="mt-1 text-xs text-white/50">#{product.code}</p>

        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <div>
            <span className="text-white/50">買入：</span>${purchase_price}
          </div>
          <div>
            <span className="text-white/50">目前：</span>${product.current_price}
          </div>
          {price_diff > 0 && (
            <div className="col-span-2 font-semibold text-green-300">
              可退差價 ${price_diff}
              {product.current_price > 0 && (
                <span className="ml-1 text-xs text-white/60">
                  ({Math.round((price_diff / purchase_price) * 100)}%)
                </span>
              )}
            </div>
          )}
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-white/60">
            <span>退差價剩餘</span>
            <span>{Math.max(0, days_remaining)} / 30 天</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${
                days_remaining <= 7 ? 'bg-red-400' : 'bg-accent'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            disabled={refreshing}
            className="btn btn-ghost text-xs disabled:opacity-50"
            onClick={onRefresh}
          >
            {refreshing ? '更新中...' : '立即更新'}
          </button>
          <a
            className="btn btn-ghost text-xs"
            href={product.url}
            target="_blank"
            rel="noreferrer"
          >
            Costco 連結 ↗
          </a>
          <button
            className="btn btn-ghost ml-auto text-xs text-red-300/80 hover:text-red-300"
            onClick={onDelete}
          >
            移除
          </button>
        </div>
      </div>
    </div>
  )
}
