'use client'

import { enNotacionColombiana } from '@cci/gramatica'
import { Minus, Plus } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const QuantityField = forwardRef<
  HTMLInputElement,
  {
    value: number
    onChange: (value: number) => void
    invalid?: boolean
    id?: string
  }
>(({ value, onChange, invalid, id }, ref) => {
  const set = (n: number) => onChange(Math.max(0, n))

  /**
   * El campo arranca VACÍO, no en cero.
   *
   * Con un `0` pintado, escribir "10" dejaba "010" —o peor, el cursor caía
   * antes del cero y quedaba "100"—: en producción salió un conteo de
   * 22.222.000.080 así. El cero no es un valor que nadie escribió, es un
   * marcador de posición, y un marcador de posición no se edita: se reemplaza.
   */
  const mostrado = value === 0 ? '' : String(value)
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border-2 bg-card p-2 transition-colors focus-within:ring-2 focus-within:ring-primary/20',
        invalid ? 'border-warning-border' : 'border-input focus-within:border-primary',
      )}
    >
      <button
        type="button"
        aria-label="Restar uno"
        onClick={() => set(value - 1)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-muted text-foreground transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        <Minus className="h-5 w-5" />
      </button>
      <input
        ref={ref}
        id={id}
        type="text"
        // `decimal` y no `numeric`: hay artículos en kilos y en litros, y
        // `parseInt` truncaba 2,5 kg a 2 sin avisar. El teclado del móvil trae
        // la coma con este modo.
        inputMode="decimal"
        placeholder="0"
        value={mostrado}
        onChange={(e) => {
          // Notación colombiana: punto de miles, coma decimal.
          //
          // Antes se hacía `.replace(',', '.')` y `parseFloat`, que deja los
          // puntos intactos: escribir **1.500** servilletas registraba **1,5**.
          // Un error de mil veces, sin alerta local (el aviso solo mira > 1000)
          // y con el servidor devolviendo una discrepancia que por diseño no
          // dice hacia dónde — así que el operario no tenía cómo deducirlo.
          //
          // La regla vive en `@cci/gramatica` para que el número tecleado y el
          // dictado se lean igual. Dos copias divergirían.
          const bruto = e.target.value.replace(/[^\d.,]/g, '')
          if (bruto === '') {
            set(0)
            return
          }
          const n = enNotacionColombiana(bruto)
          // `null` mientras se escribe algo a medias ("1,"): se ignora la
          // pulsación en vez de saltar a 0 y perder lo ya escrito.
          if (n !== null) set(n)
        }}
        aria-invalid={invalid}
        className="min-w-0 flex-1 bg-transparent text-center font-display text-2xl font-extrabold text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label="Sumar uno"
        onClick={() => set(value + 1)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-[#00568f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  )
})
QuantityField.displayName = 'QuantityField'
