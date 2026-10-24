import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const base = process.env.BASE_PATH || '/borey-89/';
if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..')) throw new Error('BASE_PATH должен начинаться и заканчиваться /');
export default defineConfig({
  base,
  build: { target: 'es2022' },
  plugins: [{
    name: 'owlbear-manifest-base',
    writeBundle(options) {
      const manifest = JSON.parse(readFileSync(new URL('./public/manifest.json', import.meta.url)));
      manifest.icon = manifest.action.icon = base + 'icon.svg';
      manifest.action.popover = base;
      writeFileSync(resolve(options.dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    },
  }],
});
