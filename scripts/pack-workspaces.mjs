import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const buildResult = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if ((buildResult.status ?? 1) !== 0) {
  process.exit(buildResult.status ?? 1);
}

const packagesDir = 'packages';
const workspaces = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packagesDir, entry.name))
  .sort();

for (const workspace of workspaces) {
  console.log(`\n=== npm pack --dry-run ${workspace} ===`);
  const result = spawnSync('npm', ['pack', '--dry-run'], {
    cwd: workspace,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
