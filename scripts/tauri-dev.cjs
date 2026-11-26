const { spawnSync } = require('node:child_process');
const path = require('node:path');

const cwd = path.resolve(__dirname, '..');
const env = {
  ...process.env,
  AGY_SHIFT_PROFILE: process.env.AGY_SHIFT_PROFILE || 'dev',
  VITE_AGY_SHIFT_PROFILE: process.env.VITE_AGY_SHIFT_PROFILE || 'dev',
};

const sync = spawnSync(process.execPath, [path.join(__dirname, 'sync-version.js')], {
  cwd,
  env,
  stdio: 'inherit',
});
if (sync.status !== 0) {
  process.exit(sync.status ?? 1);
}

const dev = spawnSync(
  process.execPath,
  [
    require.resolve('@tauri-apps/cli/tauri.js'),
    'dev',
    '--config',
    'src-tauri/tauri.dev.conf.json',
    ...process.argv.slice(2),
  ],
  { cwd, env, stdio: 'inherit' }
);
process.exit(dev.status ?? 1);
