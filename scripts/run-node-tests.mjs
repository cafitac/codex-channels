import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = globSync('packages/*/dist/*.test.js').sort();
if (files.length === 0) {
  console.error('No compiled test files found. Run npm run build first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
