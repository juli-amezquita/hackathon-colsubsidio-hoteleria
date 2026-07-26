'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { USERS, type Role, type Unit } from '@/lib/data'

export interface CountEntry {
  id: string
  name: string
  quantity: number
  unit: Unit
  order: number
  capturedAt: string
  /** Cantidad marcada como inusual y confirmada por el afiliado. */
  isAnomaly: boolean
  /** El afiliado confirmó agregar un producto que ya había contado. */
  isDuplicate: boolean
  /** El audio no se entendió bien y el afiliado validó manualmente. */
  needsReview: boolean
  transcript: string
  /** Id del clip de audio en IndexedDB (si se grabó por voz). */
  audioId?: string
}

export type ReviewStatus = 'pendiente' | 'aprobado' | 'corregido'

export interface Review {
  status: ReviewStatus
  auditorQuantity: number
  auditorUnit: Unit
  note: string
}

export interface WarehouseCount {
  entries: CountEntry[]
  reviews: Record<string, Review>
  submitted: boolean
  updatedAt: string
}

interface Session {
  username: string
  role: Role
  name: string
}

interface CountState {
  session: Session | null
  activeWarehouseId: string | null
  warehouses: Record<string, WarehouseCount>
}

interface CountContextValue extends CountState {
  ready: boolean
  active: WarehouseCount | null
  login: (username: string, password: string) => Session | null
  logout: () => void
  selectWarehouse: (id: string) => void
  addEntry: (entry: Omit<CountEntry, 'id' | 'order' | 'capturedAt'>) => void
  updateEntry: (id: string, patch: Partial<Omit<CountEntry, 'id' | 'order'>>) => void
  removeEntry: (id: string) => void
  submitCount: () => void
  reopenCount: () => void
  reviewItem: (warehouseId: string, entryId: string, review: Review) => void
  clearWarehouse: (id: string) => void
}

const STORAGE_KEY = 'colsubsidio-conteo-v2'

const CountContext = createContext<CountContextValue | null>(null)

const initialState: CountState = {
  session: null,
  activeWarehouseId: null,
  warehouses: {},
}

function emptyWarehouse(): WarehouseCount {
  return { entries: [], reviews: {}, submitted: false, updatedAt: new Date().toISOString() }
}

function genId() {
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function CountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CountState>(initialState)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setState({ ...initialState, ...JSON.parse(raw) })
    } catch {
      // ignore corrupt state
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ignore quota errors
    }
  }, [state, ready])

  const login = useCallback((username: string, password: string) => {
    const found = USERS.find(
      (u) => u.username === username.trim().toLowerCase() && u.password === password,
    )
    if (!found) return null
    const session: Session = { username: found.username, role: found.role, name: found.name }
    setState((s) => ({ ...s, session }))
    return session
  }, [])

  const logout = useCallback(() => {
    setState((s) => ({ ...s, session: null, activeWarehouseId: null }))
  }, [])

  const selectWarehouse = useCallback((id: string) => {
    setState((s) => {
      const warehouses = s.warehouses[id]
        ? s.warehouses
        : { ...s.warehouses, [id]: emptyWarehouse() }
      return { ...s, activeWarehouseId: id, warehouses }
    })
  }, [])

  const addEntry = useCallback((entry: Omit<CountEntry, 'id' | 'order' | 'capturedAt'>) => {
    setState((s) => {
      const id = s.activeWarehouseId
      if (!id) return s
      const wh = s.warehouses[id] ?? emptyWarehouse()
      const newEntry: CountEntry = {
        ...entry,
        id: genId(),
        order: wh.entries.length,
        capturedAt: new Date().toISOString(),
      }
      return {
        ...s,
        warehouses: {
          ...s.warehouses,
          [id]: { ...wh, entries: [...wh.entries, newEntry], updatedAt: new Date().toISOString() },
        },
      }
    })
  }, [])

  const updateEntry = useCallback(
    (entryId: string, patch: Partial<Omit<CountEntry, 'id' | 'order'>>) => {
      setState((s) => {
        const id = s.activeWarehouseId
        if (!id) return s
        const wh = s.warehouses[id]
        if (!wh) return s
        return {
          ...s,
          warehouses: {
            ...s.warehouses,
            [id]: {
              ...wh,
              entries: wh.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
              updatedAt: new Date().toISOString(),
            },
          },
        }
      })
    },
    [],
  )

  const removeEntry = useCallback((entryId: string) => {
    setState((s) => {
      const id = s.activeWarehouseId
      if (!id) return s
      const wh = s.warehouses[id]
      if (!wh) return s
      const entries = wh.entries
        .filter((e) => e.id !== entryId)
        .map((e, i) => ({ ...e, order: i }))
      return {
        ...s,
        warehouses: {
          ...s.warehouses,
          [id]: { ...wh, entries, updatedAt: new Date().toISOString() },
        },
      }
    })
  }, [])

  const submitCount = useCallback(() => {
    setState((s) => {
      const id = s.activeWarehouseId
      if (!id || !s.warehouses[id]) return s
      return {
        ...s,
        warehouses: {
          ...s.warehouses,
          [id]: { ...s.warehouses[id], submitted: true, updatedAt: new Date().toISOString() },
        },
      }
    })
  }, [])

  const reopenCount = useCallback(() => {
    setState((s) => {
      const id = s.activeWarehouseId
      if (!id || !s.warehouses[id]) return s
      return {
        ...s,
        warehouses: { ...s.warehouses, [id]: { ...s.warehouses[id], submitted: false } },
      }
    })
  }, [])

  const reviewItem = useCallback((warehouseId: string, entryId: string, review: Review) => {
    setState((s) => {
      const wh = s.warehouses[warehouseId]
      if (!wh) return s
      return {
        ...s,
        warehouses: {
          ...s.warehouses,
          [warehouseId]: { ...wh, reviews: { ...wh.reviews, [entryId]: review } },
        },
      }
    })
  }, [])

  const clearWarehouse = useCallback((id: string) => {
    setState((s) => {
      const next = { ...s.warehouses }
      delete next[id]
      return { ...s, warehouses: next }
    })
  }, [])

  const active = state.activeWarehouseId
    ? (state.warehouses[state.activeWarehouseId] ?? null)
    : null

  const value = useMemo<CountContextValue>(
    () => ({
      ...state,
      active,
      ready,
      login,
      logout,
      selectWarehouse,
      addEntry,
      updateEntry,
      removeEntry,
      submitCount,
      reopenCount,
      reviewItem,
      clearWarehouse,
    }),
    [
      state,
      active,
      ready,
      login,
      logout,
      selectWarehouse,
      addEntry,
      updateEntry,
      removeEntry,
      submitCount,
      reopenCount,
      reviewItem,
      clearWarehouse,
    ],
  )

  return <CountContext.Provider value={value}>{children}</CountContext.Provider>
}

export function useCountStore() {
  const ctx = useContext(CountContext)
  if (!ctx) throw new Error('useCountStore debe usarse dentro de CountProvider')
  return ctx
}
