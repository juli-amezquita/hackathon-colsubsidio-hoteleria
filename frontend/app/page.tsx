'use client'

import { Lock, User, Eye, EyeOff, Warehouse } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { BrandLogo } from '@/components/brand-logo'
import { TextField } from '@/components/text-field'
import { Button } from '@/components/ui-button'
import { useCountStore } from '@/lib/store'

export default function LoginPage() {
  const router = useRouter()
  const { login, session, ready } = useCountStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (ready && session) {
      router.replace(session.role === 'afiliado' ? '/afiliado' : '/auditor')
    }
  }, [ready, session, router])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!username || !password) {
      setError('Ingresa usuario y contraseña.')
      return
    }
    setLoading(true)
    // Pequeña espera para mostrar el estado de carga del botón
    setTimeout(() => {
      const result = login(username, password)
      if (!result) {
        setError('Usuario o contraseña incorrectos.')
        setLoading(false)
        return
      }
      router.replace(result.role === 'afiliado' ? '/afiliado' : '/auditor')
    }, 500)
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      {/* Encabezado de marca */}
      <div className="relative overflow-hidden bg-primary px-6 pb-14 pt-12 text-primary-foreground">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-warning/20" aria-hidden="true" />
        <div className="absolute right-16 top-16 h-3 w-3 rounded-full bg-warning" aria-hidden="true" />
        <div className="relative mx-auto max-w-md">
          <BrandLogo showName={false} className="[&>span:last-child]:hidden" />
          <h1 className="mt-6 text-balance font-display text-2xl font-extrabold leading-tight">
            Conteo físico de inventario
          </h1>
          <p className="mt-1 text-sm text-primary-foreground/80">
            Registra y verifica existencias en bodega, guiado por voz.
          </p>
        </div>
      </div>

      {/* Tarjeta de acceso */}
      <div className="mx-auto -mt-8 w-full max-w-md flex-1 px-4 z-10">
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-5 shadow-lg shadow-black/5"
          noValidate
        >

          <TextField
            label="Usuario"
            placeholder="afiliado o auditor"
            autoCapitalize="none"
            autoComplete="username"
            icon={<User className="h-[18px] w-[18px]" />}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              if (error) setError('')
            }}
            error={error && !username ? error : undefined}
          />

          <TextField
            label="Contraseña"
            type={showPass ? 'text' : 'password'}
            placeholder="••••"
            autoComplete="current-password"
            icon={<Lock className="h-[18px] w-[18px]" />}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error) setError('')
            }}
            error={error && username ? error : undefined}
            trailing={
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              >
                {showPass ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            }
          />

          <Button type="submit" size="block" loading={loading} className="mt-2">
            {loading ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>

        {/* Accesos rápidos de demostración */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <DemoCard
            role="Afiliado"
            desc="Cuenta el inventario"
            onClick={() => {
              setUsername('afiliado')
              setPassword('1234')
            }}
          />
          <DemoCard
            role="Auditor"
            desc="Verifica el conteo"
            onClick={() => {
              setUsername('auditor')
              setPassword('1234')
            }}
          />
        </div>
      </div>

      <p className="py-6 text-center text-xs text-muted-foreground">
        Colsubsidio · Gestión de bodegas
      </p>
    </main>
  )
}

function DemoCard({
  role,
  desc,
  onClick,
}: {
  role: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border-2 border-border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="font-display text-sm font-bold text-foreground">{role}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </button>
  )
}
