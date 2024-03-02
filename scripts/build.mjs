import fs from 'node:fs/promises';
import * as esbuild from 'esbuild';
import { dtsPlugin } from 'esbuild-plugin-d.ts';

const common = {
  entryPoints: ['./src/**/*.ts'],
  bundle: false,
  platform: 'node',
  target: 'node20',
  sourcemap: 'linked',
  plugins: [dtsPlugin({})],
};

await esbuild.build({
  ...common,
  outdir: './dist/esm',
  format: 'esm',
});

await esbuild.build({
  ...common,
  outdir: './dist/cjs',
  format: 'cjs',
});

await fs.writeFile('./dist/esm/package.json', JSON.stringify({ type: 'module' }), 'utf8');

await fs.writeFile('./dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }), 'utf8');
