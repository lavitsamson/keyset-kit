import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'prisma/index': 'src/prisma/index.ts',
    'typeorm/index': 'src/typeorm/index.ts',
    'mongoose/index': 'src/mongoose/index.ts',
    'express/index': 'src/express/index.ts',
  },
  format: ['esm', 'cjs'],
  // tsup's dts worker sets `baseUrl` internally, which TypeScript 6 deprecates (see ADR 0001).
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  target: 'es2022',
  platform: 'node',
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  // Adapters import ORM types only; peers must never be bundled.
  external: ['@prisma/client', 'typeorm', 'mongoose', 'express'],
});
