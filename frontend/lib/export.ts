import type { Warehouse } from '@/lib/data'
import type { CountEntry, Review } from '@/lib/store'
import { orderedEntries } from '@/lib/inventory'

function csvCell(value: string | number) {
  const s = String(value)
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export interface ReportRow {
  order: number
  name: string
  affiliateQty: number
  affiliateUnit: string
  wasAnomaly: boolean
  wasDuplicate: boolean
  auditorQty: number
  auditorUnit: string
  status: string
  difference: number
  note: string
}

export function buildReportRows(
  entries: CountEntry[],
  reviews: Record<string, Review>,
): ReportRow[] {
  return orderedEntries(entries).map((entry, i) => {
    const review = reviews[entry.id]
    const auditorQty = review ? review.auditorQuantity : entry.quantity
    const auditorUnit = review ? review.auditorUnit : entry.unit
    return {
      order: i + 1,
      name: entry.name,
      affiliateQty: entry.quantity,
      affiliateUnit: entry.unit,
      wasAnomaly: entry.isAnomaly,
      wasDuplicate: entry.isDuplicate,
      auditorQty,
      auditorUnit,
      status: review ? review.status : 'pendiente',
      difference: auditorQty - entry.quantity,
      note: review?.note ?? '',
    }
  })
}

export function buildCsv(rows: ReportRow[], warehouse: Warehouse): string {
  const headers = [
    'Orden',
    'Producto',
    'Cantidad afiliado',
    'Unidad afiliado',
    'Cantidad inusual',
    'Producto repetido',
    'Cantidad auditor',
    'Unidad auditor',
    'Estado',
    'Diferencia',
    'Nota auditor',
  ]
  const meta = [
    `Bodega;${warehouse.name}`,
    `Ciudad;${warehouse.city}`,
    `Zona;${warehouse.zone}`,
    `Codigo;${warehouse.id}`,
    `Generado;${new Date().toLocaleString('es-CO')}`,
  ]
  const body = rows.map((r) =>
    [
      r.order,
      r.name,
      r.affiliateQty,
      r.affiliateUnit,
      r.wasAnomaly ? 'Si' : 'No',
      r.wasDuplicate ? 'Si' : 'No',
      r.auditorQty,
      r.auditorUnit,
      r.status,
      r.difference,
      r.note,
    ]
      .map(csvCell)
      .join(';'),
  )
  return [...meta, '', headers.map(csvCell).join(';'), ...body].join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
