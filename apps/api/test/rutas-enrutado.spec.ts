import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Las pantallas y la API comparten origen, y esta prueba es lo que lo sostiene.
 *
 * La cookie de sesión es `SameSite=Strict`, así que el frontend tiene que
 * servirse desde el mismo origen que la API. Ahí el reparto es: la API son
 * rutas ENUMERADAS, y todo lo demás son las pantallas.
 *
 * Y esa enumeración está escrita en dos sitios que no pueden leerse entre sí:
 *
 *   · `infra/nginx.conf` — el reparto en producción.
 *   · `frontend/next.config.mjs` — el mismo reparto en desarrollo, donde no hay
 *     nginx y lo hace el `rewrites` de Next.
 *
 * Podrían generarse de una sola fuente, pero los consume nginx (que no ejecuta
 * JavaScript) y Next (que no lee nginx). Duplicar la lista y comparar las tres
 * en una prueba cuesta menos que un generador, y falla igual de pronto.
 *
 * El fallo que esto evita es incómodo de diagnosticar. Alguien añade un
 * controlador, olvida una de las listas, y esa ruta empieza a devolver el HTML
 * de las pantallas con **código 200**. El cliente recibe HTML donde espera
 * JSON, el error salta al parsear, y nada apunta al enrutado.
 */

const RAIZ = join(__dirname, '..', 'src');
const REPO = join(__dirname, '..', '..', '..');
const NGINX = join(REPO, 'infra', 'nginx.conf');
const NEXT = join(REPO, 'frontend', 'next.config.mjs');

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
        // Solo el primer segmento: el reparto es por raíz de la ruta.
        const raiz = (m[1] ?? '').split('/')[0];
        if (raiz) prefijos.add(raiz);
      }
    }
  };

  recorrer(RAIZ);
  return prefijos;
}

/** Los prefijos del `location ~ ^/(…)` que manda a la API. */
function prefijosDeNginx(): Set<string> {
  const conf = readFileSync(NGINX, 'utf8');
  const bloque = /location\s+~\s+\^\/\(([^)]*)\)/.exec(conf)?.[1] ?? '';
  return new Set(bloque.split('|').filter(Boolean));
}

/** Los prefijos de `RUTAS_API` en la configuración de Next. */
function prefijosDeNext(): Set<string> {
  const conf = readFileSync(NEXT, 'utf8');
  const bloque = /RUTAS_API\s*=\s*\[([^\]]*)\]/.exec(conf)?.[1] ?? '';
  return new Set([...bloque.matchAll(/'([^']+)'/g)].map((m) => m[1]!));
}

const CONSUMIDORES = [
  ['nginx (infra/nginx.conf)', prefijosDeNginx],
  ['Next (frontend/next.config.mjs)', prefijosDeNext],
] as const;

describe('las rutas de la API están declaradas en todos los enrutadores', () => {
  it.each(CONSUMIDORES)('%s no deja fuera ningún controlador', (_nombre, leer) => {
    const faltantes = [...prefijosDeControladores()].filter((p) => !leer().has(p)).sort();

    expect(
      faltantes,
      `Estas rutas no están declaradas y el enrutador les devolvería el HTML de ` +
        `las pantallas con código 200: ${faltantes.join(', ')}`,
    ).toEqual([]);
  });

  it.each(CONSUMIDORES)('%s no arrastra rutas que ya no existen', (_nombre, leer) => {
    // Una ruta de más no rompe nada hoy, pero enmascara la eliminación de un
    // controlador y hace que la lista deje de ser legible como inventario.
    const controladores = prefijosDeControladores();
    const sobrantes = [...leer()].filter((p) => !controladores.has(p)).sort();

    expect(sobrantes, `Rutas declaradas que ya ningún controlador sirve: ${sobrantes.join(', ')}`).toEqual(
      [],
    );
  });

  it('encuentra los controladores de verdad, no una lista vacía', () => {
    // Sin esto, un cambio en la forma del decorador dejaría la prueba pasando
    // por no encontrar nada — el peor resultado posible de una prueba.
    expect(prefijosDeControladores().size).toBeGreaterThanOrEqual(8);
  });

  it.each(CONSUMIDORES)('%s se leyó de verdad', (_nombre, leer) => {
    // Igual que arriba: si el formato del archivo cambia y el regex deja de
    // encontrar nada, las dos pruebas anteriores pasarían sin comprobar nada.
    expect(leer().size).toBeGreaterThanOrEqual(8);
  });
});
