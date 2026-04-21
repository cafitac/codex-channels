import { spawnSync } from 'node:child_process';

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
  console.log(`\n=== tsc -p ${workspace}/tsconfig.json ===`);
  const result = spawnSync('npx', ['tsc', '-p', `${workspace}/tsconfig.json`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
