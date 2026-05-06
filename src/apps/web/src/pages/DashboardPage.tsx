import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { WatchlistItemView } from '@costco/shared'
import { api } from '../lib/api.js'
import { AddItemDialog } from '../components/AddItemDialog.js'
import { WatchlistCard } from '../components/WatchlistCard.js'

type SortKey = 'recent' | 'remaining' | 'discount'
type Filter = 'all' | 'eligible'

export function DashboardPage() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [sort, setSort] = useState<SortKey>('recent')
  const [filter, setFilter] = useState<Filter>('all')
  // Track per-item refresh state so clicking refresh on one card does not
  // disable / relabel every other card's refresh button. Previously we used
  // refresh.isPending on a shared mutation, which leaked into all cards.
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set())

  const list = useQuery({
    queryKey: ['watchlist'],
    queryFn: async (): Promise<WatchlistItemView[]> => {
      const res = await api('/api/watchlist')
      const json = (await res.json()) as { items: WatchlistItemView[] }
      return json.items
    },
  })

  const refresh = useMutation({
    mutationFn: async (id: number) => {
      await api(`/api/watchlist/${id}/refresh`, { method: 'POST' })
    },
    onMutate: (id) => {
      setRefreshingIds((prev) => new Set(prev).add(id))
    },
    onSettled: (_data, _err, id) => {
      setRefreshingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      qc.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })
  const remove = useMutation({
    mutationFn: async (id: number) => {
      await api(`/api/watchlist/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }),
  })

  const items = useMemo(() => {
    let arr = list.data ?? []
    if (filter === 'eligible') arr = arr.filter((i) => i.is_eligible)
    arr = [...arr].sort((a, b) => {
      if (sort === 'recent') return b.created_at.localeCompare(a.created_at)
      if (sort === 'remaining') return a.days_remaining - b.days_remaining
      if (sort === 'discount') return b.price_diff - a.price_diff
      return 0
    })
    return arr
  }, [list.data, filter, sort])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">追蹤清單</h1>
        <span className="text-sm text-white/50">
          {list.data?.length ?? 0} 項商品
        </span>
        <div className="ml-auto flex gap-2">
          <select
            aria-label="篩選"
            className="rounded bg-white/5 px-2 py-1 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">全部</option>
            <option value="eligible">可退差價</option>
          </select>
          <select
            aria-label="排序"
            className="rounded bg-white/5 px-2 py-1 text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="recent">最近加入</option>
            <option value="remaining">剩餘天數</option>
            <option value="discount">退差價金額</option>
          </select>
          <button
            className="btn btn-primary text-sm"
            onClick={() => setShowAdd(true)}
          >
            ＋ 新增追蹤
          </button>
        </div>
      </div>

      {list.isLoading && (
        <p className="text-white/60">載入中...</p>
      )}
      {list.error && (
        <p className="text-red-400">載入失敗：{(list.error as Error).message}</p>
      )}
      {!list.isLoading && items.length === 0 && (
        <div className="card text-center text-white/60">
          <p className="mb-3">尚無追蹤商品</p>
          <button
            className="btn btn-primary"
            onClick={() => setShowAdd(true)}
          >
            開始新增
          </button>
        </div>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((it) => (
          <li key={it.id}>
            <WatchlistCard
              item={it}
              onRefresh={() => refresh.mutate(it.id)}
              onDelete={() => {
                if (confirm('確定要移除此追蹤項目？')) remove.mutate(it.id)
              }}
              refreshing={refreshingIds.has(it.id)}
            />
          </li>
        ))}
      </ul>

      {showAdd && (
        <AddItemDialog
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false)
            qc.invalidateQueries({ queryKey: ['watchlist'] })
          }}
        />
      )}
    </div>
  )
}
