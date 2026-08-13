import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const entryPoint = resolve(
  projectRoot,
  'hooks/jetbrains-mcp-bridge.mjs'
);

if (!existsSync(entryPoint)) {
  console.log('[build] Entry point not found, skipping:');
  console.log(`  ${entryPoint}`);
  process.exit(0);
}

const outFile = resolve(
  projectRoot,
  'hooks/jetbrains-mcp-bridge.bundle.mjs'
);

try {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    outfile: outFile,
    banner: {
      js: '// Auto-generated bundle — do not edit by hand',
    },
  });

  if (result.errors.length > 0) {
    console.error('[build] Build completed with errors:');
    result.errors.forEach((err) => console.error(err));
    process.exit(1);
  }

  console.log(`[build] Bundle written to: ${outFile}`);
} catch (err) {
  console.error('[build] Build failed:', err.message);
  process.exit(1);
}
