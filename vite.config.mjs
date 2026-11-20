import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'vite';

function precache() {
  return {
    name: 'skybreak-precache',
    apply: 'build',
    async writeBundle({ dir }, bundle) {
      const worker = await readFile(new URL('./public/sw.js', import.meta.url), 'utf8');
      const assets = Object.keys(bundle).filter(path => !path.endsWith('.map')).sort();
      const hash = createHash('sha256').update(worker);
      for (const path of assets) hash.update(path).update(await readFile(join(dir, path)));
      const version = hash.digest('hex').slice(0, 16);
      await writeFile(join(dir, 'sw.js'),
        `const VERSION = ${JSON.stringify(version)};\nconst ASSETS = ${JSON.stringify(assets)};\n${worker}`);
    },
  };
}

export default defineConfig({
  plugins: [precache()],
  // Browser tests (tests/e2e, tests/soak) run under Playwright, not Vitest.
  test: { include: ['tests/unit/**/*.test.ts'] },
});
