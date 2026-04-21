import { spawnSync } from 'node:child_process';

const steps = [
  ['npm', ['run', 'check']],
  ['npm', ['run', 'build']],
  ['npm', ['test']],
  ['npm', ['run', 'pack:preview']],
  ['npm', ['run', 'publish:dry-run']],
];

for (const [cmd, args] of steps) {
  console.log(`\n=== ${cmd} ${args.join(' ')} ===`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
