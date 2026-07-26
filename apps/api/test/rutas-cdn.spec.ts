import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * El PWA y la API comparten origen, y esta prueba es lo que lo sostiene.
 *
 * La cookie de sesión es `SameSite=Strict`, así que el frontend tiene que
 * servirse desde la misma distribución de CloudFront que la API (ver `pwa.tf`).
 * Ahí el reparto es: la API son rutas enumeradas, y todo lo demás es el PWA.
 *
 * El fallo que esta prueba evita es incómodo de diagnosticar. Alguien añade un
 * controlador, olvida la lista de Terraform, y esa ruta empieza a devolver el
 * `index.html` del PWA — con **código 200**. El cliente recibe HTML donde
 * espera JSON, el error aparece al parsear, y nada apunta a CloudFront.
 *
 * Comparar las dos listas cuesta veinte líneas y lo convierte en un fallo de
 * build.
 */

const RAIZ = join(__dirname, '..', 'src');
const CDN = join(__dirname, '..', '..', '..', 'infra', 'terraform', 'cdn.tf');

/** Los prefijos declarados en los `@Controller` del backend. */
function prefijosDeControladores(): Set<string> {
  const prefijos = new Set<string>();

  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(ruta);
        continue;
      }
      if (!entrada.name.endsWith('.ts')) continue;

      for (const m of readFileSync(ruta, 'utf8').matchAll(/@Controller\('([^']*)'\)/g)) {
        // Solo el primer segmento: el patrón de CloudFront es `/<raiz>*`.
        const raiz = (m[1] ?? '').split('/')[0];
        if (raiz) prefijos.add(raiz);
      }
    }
  };

  recorrer(RAIZ);
  return prefijos;
}

/** Los prefijos declarados en `locals.rutas_api` de Terraform. */
function prefijosDeCloudFront(): Set<string> {
  const cdn = readFileSync(CDN, 'utf8');
  const bloque = /rutas_api\s*=\s*\[([^\]]*)\]/.exec(cdn)?.[1] ?? '';
  return new Set([...bloque.matchAll(/"([^"]+)"/g)].map((m) => m[1]!));
}

describe('las rutas de la API están declaradas en CloudFront', () => {
  it('ningún controlador queda fuera de la lista', () => {
    const controladores = prefijosDeControladores();
    const cdn = prefijosDeCloudFront();

    const faltantes = [...controladores].filter((p) => !cdn.has(p)).sort();

    expect(
      faltantes,
      `Estas rutas no están en \`locals.rutas_api\` de infra/terraform/cdn.tf y ` +
        `CloudFront les devolvería el index.html del PWA con código 200: ${faltantes.join(', ')}`,
    ).toEqual([]);
  });

  it('la lista no arrastra rutas que ya no existen', () => {
    // Una ruta de más no rompe nada hoy, pero enmascara la eliminación de un
    // controlador y hace que la lista deje de ser legible como inventario.
    const controladores = prefijosDeControladores();
    const sobrantes = [...prefijosDeCloudFront()].filter((p) => !controladores.has(p)).sort();

    expect(sobrantes, `Rutas en cdn.tf que ya ningún controlador sirve: ${sobrantes.join(', ')}`).toEqual([]);
  });

  it('encuentra los controladores de verdad, no una lista vacía', () => {
    // Sin esto, un cambio en la forma del decorador dejaría la prueba pasando
    // por no encontrar nada — el peor resultado posible de una prueba.
    expect(prefijosDeControladores().size).toBeGreaterThanOrEqual(8);
  });
});
