import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const buildResult = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if ((buildResult.status ?? 1) !== 0) {
  process.exit(buildResult.status ?? 1);
}

const files = globSync('packages/*/src/*.test.ts').sort();
if (files.length === 0) {
  console.error('No source test files found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
