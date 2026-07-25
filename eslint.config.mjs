import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Los seis dominios del backend (Principio III). */
const DOMINIOS = ['identidad', 'catalogo', 'captura', 'consolidacion', 'auditoria', 'integracion'];

/**
 * S-09 · La frontera entre dominios la verifica la build, no la disciplina.
 *
 * Para cada dominio se prohíbe importar cualquier ruta de los otros cinco, en
 * cualquiera de las formas en que se puede escribir el import. La comunicación
 * entre dominios va por interfaz publicada o por evento (Principio III, D-14).
 *
 * Con carpetas y buena voluntad, la frontera existe hasta el primer viernes por
 * la tarde. Con esta regla, un import cruzado rompe el build.
 */
const fronterasDeDominio = DOMINIOS.map((propio) => {
  const ajenos = DOMINIOS.filter((d) => d !== propio);
  const patrones = ajenos.flatMap((d) => [
    `../${d}`,
    `../${d}/**`,
    `**/modules/${d}`,
    `**/modules/${d}/**`,
  ]);

  return {
    files: [`apps/api/src/modules/${propio}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: patrones,
              message:
                'Principio III: un dominio no puede importar otro. Use la interfaz publicada en platform/ o un evento de dominio.',
            },
          ],
        },
      ],
    },
  };
});

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dev-dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.specify/**',
      'specs/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Principio VI: `any` está PROHIBIDO. Cuando el tipo es genuinamente
      // desconocido se usa `unknown` con estrechamiento explícito.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // Una promesa sin await es un dato que se pierde sin que nadie se entere.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // El backend corre en Node.
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Archivos de configuración y scripts de k6: fuera del proyecto de tipos.
  // Lintarlos con reglas que exigen tipos daría un error de parseo, no un hallazgo.
  {
    files: ['*.mjs', '*.js', 'apps/*/vitest.config.ts', 'tests/perf/**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node, __ENV: 'readonly', __VU: 'readonly' } },
    rules: { '@typescript-eslint/no-unsafe-call': 'off' },
  },

  // Las clases de NestJS usan decoradores sobre miembros sin uso aparente.
  {
    files: ['apps/api/**/*.module.ts'],
    rules: { '@typescript-eslint/no-extraneous-class': 'off' },
  },

  // Los scripts de operación sí imprimen por consola: es su interfaz.
  {
    files: ['apps/api/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  ...fronterasDeDominio,
);
