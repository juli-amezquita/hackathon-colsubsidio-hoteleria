'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useCountStore } from '@/lib/store'
import type { Role } from '@/lib/data'

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const router = useRouter()
  const { session, ready } = useCountStore()

  useEffect(() => {
    if (!ready) return
    if (!session) {
      router.replace('/')
    } else if (session.role !== role) {
      router.replace(session.role === 'afiliado' ? '/afiliado' : '/auditor')
    }
  }, [ready, session, role, router])

  if (!ready || !session || session.role !== role) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Cargando" />
      </div>
    )
  }

  return <>{children}</>
}
