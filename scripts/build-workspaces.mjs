import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const workspaces = [
  'packages/core',
  'packages/persistence-file',
  'packages/backend-local',
  'packages/backend-slack',
  'packages/backend-discord',
  'packages/backend-telegram',
  'packages/transport-codex-app-server',
  'packages/cli',
];

for (const workspace of workspaces) {
  const distDir = join(workspace, 'dist');
  const buildInfo = join(workspace, 'tsconfig.tsbuildinfo');
  if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
  if (existsSync(buildInfo)) rmSync(buildInfo, { force: true });
  console.log(`\n=== tsc -p ${workspace}/tsconfig.json ===`);
  const result = spawnSync('npx', ['tsc', '-p', `${workspace}/tsconfig.json`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
