/**
 * El frontend y la API se sirven desde el MISMO origen. No es comodidad.
 *
 * La cookie de sesión es `SameSite=Strict`: un frontend en otro dominio no la
 * enviaría y todo respondería 401. En producción lo resuelve nginx (`/sesion`,
 * `/rondas`… van al :3000 y el resto a Next); en desarrollo lo resuelve este
 * `rewrites`, que hace exactamente lo mismo. Que las dos capas repitan la lista
 * es a propósito: son dos servidores distintos y ninguno puede leer al otro.
 */
const RUTAS_API = [
  'sesion',
  'rondas',
  'bodegas',
  'auditoria',
  'administracion',
  'aprendizaje',
  'consulta',
  'integracion',
  'metricas',
  'voz',
  'salud',
  'tiempo',
  'presencia',
]

const API = process.env.API_INTERNA ?? 'http://127.0.0.1:3000'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Empaqueta el servidor con solo las dependencias que traza. En la imagen
  // pesa ~100 MB en vez de arrastrar el `node_modules` del monorepo entero.
  output: 'standalone',
  outputFileTracingRoot: new URL('..', import.meta.url).pathname,
  // ⚠️ NO se ignoran los errores de tipos.
  //
  // Venía en `true`, que es lo razonable mientras las pantallas se construyen
  // contra datos inventados. Ahora hablan con el backend real y los tipos que
  // comparten (`@cci/contracts`) son el contrato: si el servidor cambia un
  // campo y la pantalla no, eso tiene que romper el build, no la demostración.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      ...RUTAS_API.map((r) => ({ source: `/${r}/:ruta*`, destination: `${API}/${r}/:ruta*` })),
      // `POST /sesion` y `GET /sesion` no llevan sufijo: `:ruta*` no los cubre.
      ...RUTAS_API.map((r) => ({ source: `/${r}`, destination: `${API}/${r}` })),
    ]
  },
}

export default nextConfig
