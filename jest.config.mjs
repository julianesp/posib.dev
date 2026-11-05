import nextJest from 'next/jest.js';

// next/jest compila con SWC (igual que Next), carga los .env y respeta
// la configuración de next.config.ts.
const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  // La mayoría de las pruebas son de lógica pura; las que necesitan DOM
  // (componentes, localStorage) lo piden con `@jest-environment jsdom`.
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Hono es dependencia del Worker (cloudflare-migration), no de la app Next.
    '^hono$': '<rootDir>/cloudflare-migration/node_modules/hono/dist/cjs/index.js',
    '^jose$': '<rootDir>/cloudflare-migration/node_modules/jose/dist/node/cjs/index.js',
  },
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '<rootDir>/tests/**/*.test.{ts,tsx}'],
  // Las pruebas E2E (e2e/) son de Playwright: se corren con `pnpm e2e`.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.open-next/', '<rootDir>/cloudflare-migration/'],
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'components/ui/**/*.{ts,tsx}',
    'cloudflare-migration/src/utils/**/*.ts',
    '!**/__tests__/**',
    '!**/*.d.ts',
  ],
};

export default createJestConfig(config);
