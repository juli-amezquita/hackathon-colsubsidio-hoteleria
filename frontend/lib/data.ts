export type Unit = 'unidades' | 'cajas' | 'paquetes' | 'bultos' | 'kilos' | 'litros'

export interface Warehouse {
  id: string
  name: string
  city: string
  zone: string
}

/**
 * Bodegas disponibles. La ruta de conteo NO está predefinida: el afiliado
 * agrega los productos a medida que los va nombrando por voz. Cada bodega
 * guarda su propio conteo por separado.
 */
export const WAREHOUSES: Warehouse[] = [
  { id: 'BOG-CENTRO-04', name: 'Bodega Centro 04', city: 'Bogotá', zone: 'Cundinamarca' },
  { id: 'BOG-NORTE-11', name: 'Bodega Norte 11', city: 'Bogotá', zone: 'Cundinamarca' },
  { id: 'BOG-SUR-07', name: 'Bodega Sur 07', city: 'Bogotá', zone: 'Cundinamarca' },
  { id: 'SOA-CEDI-01', name: 'CEDI Soacha 01', city: 'Soacha', zone: 'Cundinamarca' },
  { id: 'MED-POBLADO-03', name: 'Bodega Poblado 03', city: 'Medellín', zone: 'Antioquia' },
  { id: 'MED-ITAGUI-02', name: 'Bodega Itagüí 02', city: 'Itagüí', zone: 'Antioquia' },
  { id: 'CAL-NORTE-05', name: 'Bodega Norte 05', city: 'Cali', zone: 'Valle del Cauca' },
  { id: 'CAL-YUMBO-01', name: 'CEDI Yumbo 01', city: 'Yumbo', zone: 'Valle del Cauca' },
  { id: 'BAQ-CENTRO-02', name: 'Bodega Centro 02', city: 'Barranquilla', zone: 'Atlántico' },
  { id: 'BUC-CENTRO-01', name: 'Bodega Centro 01', city: 'Bucaramanga', zone: 'Santander' },
  { id: 'PEI-EJE-01', name: 'CEDI Eje Cafetero 01', city: 'Pereira', zone: 'Risaralda' },
  { id: 'CTG-BOSQUE-02', name: 'Bodega El Bosque 02', city: 'Cartagena', zone: 'Bolívar' },
]

export function getWarehouse(id: string | null | undefined) {
  return WAREHOUSES.find((w) => w.id === id) ?? null
}

export const USERS = [
  {
    username: 'afiliado',
    password: '1234',
    role: 'afiliado' as const,
    name: 'Carlos Mejía',
  },
  {
    username: 'auditor',
    password: '1234',
    role: 'auditor' as const,
    name: 'Diana Rojas',
  },
]

export type Role = 'afiliado' | 'auditor'
