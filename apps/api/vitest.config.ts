import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Los contratos se resuelven al fuente, no a `dist`: así un cambio de
      // esquema rompe los tests en el acto y no después de compilar.
      '@cci/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    testTimeout: 20_000,

    /**
     * Un archivo a la vez. **No es una concesión: es la única forma correcta.**
     *
     * Las pruebas corren contra una base real —a propósito, porque probar la
     * inmutabilidad contra un doble no probaría nada— y el outbox es una cola
     * GLOBAL. Cualquier `pasada()` de una suite consume los eventos pendientes
     * de las demás, que es exactamente lo que debe hacer en producción y lo que
     * vuelve indeterminista cualquier prueba que afirme algo sobre lo pendiente.
     *
     * Lo mismo con las tolerancias de merma, que son configuración global.
     *
     * La alternativa sería una base por archivo. Cuesta más de lo que ahorra:
     * la suite entera tarda menos de un minuto en serie.
     */
    fileParallelism: false,
  },
  esbuild: {
    // NestJS necesita los metadatos de decorador en tiempo de ejecución.
    target: 'es2022',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    },
  },
});
