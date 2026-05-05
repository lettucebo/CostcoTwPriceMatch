import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'

export interface Me {
  id: number
  email: string
  name: string | null
  picture: string | null
  notification_email: string | null
  channels: string[]
  line_linked: boolean
  telegram_linked: boolean
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api('/api/me', { allow401: true })
      if (res.status === 401) return null
      return res.json()
    },
    staleTime: 60_000,
  })
}
