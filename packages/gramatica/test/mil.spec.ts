import { describe, expect, it } from 'vitest'
import { enNotacionColombiana } from '../src/numeros'
import { parsear } from '../src/index'

describe('notación colombiana', () => {
  it('el punto de miles ya no divide por mil', () => {
    expect(enNotacionColombiana('1.500')).toBe(1500)
    expect(enNotacionColombiana('1.500,25')).toBe(1500.25)
    expect(enNotacionColombiana('19,8')).toBe(19.8)
    expect(enNotacionColombiana('19.8')).toBe(19.8)
    expect(enNotacionColombiana('1.234.567')).toBe(1234567)
    expect(enNotacionColombiana('20')).toBe(20)
    expect(enNotacionColombiana('0,5')).toBe(0.5)
  })
  it('el dictado real', () => {
    const a = parsear('arroz 1.500 kilos')
    expect(a.ok && a.cantidad).toBe(1500)
    const b = parsear('1.500 unidades de servilletas')
    expect(b.ok && b.cantidad).toBe(1500)
    const c = parsear('arroz 19,8 kilos')
    expect(c.ok && c.cantidad).toBe(19.8)
  })
})
