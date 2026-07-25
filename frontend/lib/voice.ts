import type { Unit } from '@/lib/data'

const UNIT_KEYWORDS: Record<string, Unit> = {
  unidad: 'unidades',
  unidades: 'unidades',
  und: 'unidades',
  caja: 'cajas',
  cajas: 'cajas',
  paquete: 'paquetes',
  paquetes: 'paquetes',
  paca: 'paquetes',
  pacas: 'paquetes',
  bulto: 'bultos',
  bultos: 'bultos',
  saco: 'bultos',
  sacos: 'bultos',
  kilo: 'kilos',
  kilos: 'kilos',
  kg: 'kilos',
  litro: 'litros',
  litros: 'litros',
  lt: 'litros',
}

const NUMBER_WORDS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
  mil: 1000,
}

// Palabras de relleno que no forman parte del nombre del producto.
const FILLER_WORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'hay', 'son'])

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function wordsToNumber(tokens: string[]): number | null {
  let total = 0
  let current = 0
  let matched = false
  for (const t of tokens) {
    if (!(t in NUMBER_WORDS) && t !== 'y') return matched ? total + current : null
    if (t === 'y') continue
    matched = true
    const val = NUMBER_WORDS[t]
    if (val === 1000) {
      current = current === 0 ? 1000 : current * 1000
      total += current
      current = 0
    } else {
      current += val
    }
  }
  return matched ? total + current : null
}

function titleCase(text: string) {
  return text
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export interface ParsedSpeech {
  name: string
  quantity: number | null
  unit: Unit | null
  /** El audio no se entendió bien: falta nombre, cantidad o unidad. */
  needsReview: boolean
}

/**
 * Extrae nombre + cantidad + unidad de una sola frase, por ejemplo
 * "arroz blanco cincuenta paquetes" -> { name: "Arroz Blanco", quantity: 50, unit: "paquetes" }.
 */
export function parseSpeech(transcript: string): ParsedSpeech {
  const norm = normalize(transcript)
  const tokens = norm.split(' ').filter(Boolean)

  // 1) Cantidad como dígitos
  let quantity: number | null = null
  const digitMatch = norm.match(/\d+/)
  if (digitMatch) {
    quantity = Number.parseInt(digitMatch[0], 10)
  } else {
    let best: number | null = null
    let run: string[] = []
    const flush = () => {
      if (run.length) {
        const n = wordsToNumber(run)
        if (n !== null) best = n
      }
      run = []
    }
    for (const t of tokens) {
      if (t in NUMBER_WORDS || t === 'y') run.push(t)
      else flush()
    }
    flush()
    quantity = best
  }

  // 2) Unidad
  let unit: Unit | null = null
  for (const t of tokens) {
    if (t in UNIT_KEYWORDS) {
      unit = UNIT_KEYWORDS[t]
      break
    }
  }

  // 3) Nombre = tokens que no son número, unidad ni relleno
  const nameTokens = tokens.filter(
    (t) =>
      !/^\d+$/.test(t) &&
      !(t in NUMBER_WORDS) &&
      !(t in UNIT_KEYWORDS) &&
      !FILLER_WORDS.has(t),
  )
  const name = titleCase(nameTokens.join(' '))

  const needsReview = !name || quantity === null || unit === null

  return { name, quantity, unit, needsReview }
}
