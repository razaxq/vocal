import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/ipc'

/** 设置窗口打开较晚时，也能取回启动检查已经发现的新版本。 */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let changed = false
    let mounted = true
    const off = window.vocal.onUpdateStatus((s) => { changed = true; setStatus(s) })
    void window.vocal.getUpdateStatus().then((s) => {
      if (mounted && !changed) setStatus(s)
    }).catch(() => {})
    return () => { mounted = false; off() }
  }, [])
  return status
}
