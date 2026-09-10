import { useEffect, useState, useCallback } from 'react'
import {
  checkSupabaseConnection,
  type SupabaseConnectionStatus,
} from '@/services/supabaseConnection'

export function useSupabaseConnection() {
  const [status, setStatus] = useState<SupabaseConnectionStatus>({
    status: 'checking',
  })

  const refresh = useCallback(async () => {
    setStatus((prev) => ({ ...prev, status: 'checking' }))
    const res = await checkSupabaseConnection()
    setStatus(res)
  }, [])

  useEffect(() => {
    let active = true
    checkSupabaseConnection().then((res) => {
      if (active) {
        setStatus(res)
      }
    })
    return () => {
      active = false
    }
  }, [])

  return {
    ...status,
    refresh,
  }
}
