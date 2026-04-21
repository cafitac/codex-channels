import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const result = spawnSync(process.execPath, ['./packages/cli/dist/index.js', 'plugin-bootstrap', ...args], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
