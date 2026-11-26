const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const extraPaths = Array.from(
  new Set(
    [
      process.env.CARGO_HOME ? path.join(process.env.CARGO_HOME, 'bin') : '',
      'D:\\Vibe-coding Projects\\Tools\\rust\\cargo\\bin',
      'D:\\Vibe-coding Projects\\Tools\\llvm-mingw\\bin',
      'D:\\Vibe-coding Projects\\Tools\\nsis',
      path.join(os.homedir(), '.cargo', 'bin'),
    ].filter((dir) => dir && fs.existsSync(dir)),
  ),
);

const vcvarsCandidates = [
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\VC\\Auxiliary\\Build\\vcvars64.bat',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvars64.bat',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat',
];
const vcvars64Path = vcvarsCandidates.find((candidate) => fs.existsSync(candidate)) || '';

function resolveDefaultToolchain() {
  if (process.env.RUSTUP_TOOLCHAIN || vcvars64Path) {
    return undefined;
  }
  const rustupHome =
    process.env.RUSTUP_HOME ||
    (fs.existsSync('D:\\Vibe-coding Projects\\Tools\\rust\\rustup')
      ? 'D:\\Vibe-coding Projects\\Tools\\rust\\rustup'
      : path.join(os.homedir(), '.rustup'));
  const gnullvmDir = path.join(rustupHome, 'toolchains', 'stable-x86_64-pc-windows-gnullvm');
  return fs.existsSync(gnullvmDir) ? 'stable-x86_64-pc-windows-gnullvm' : undefined;
}

function withToolchainPaths(options = {}) {
  const currentPath = process.env.PATH || '';
  const pathValue = extraPaths.length > 0
    ? `${extraPaths.join(path.delimiter)}${path.delimiter}${currentPath}`
    : currentPath;
  const gnullvmToolchain = resolveDefaultToolchain();

  return {
    ...options,
    env: {
      ...process.env,
      ...(gnullvmToolchain ? { RUSTUP_TOOLCHAIN: gnullvmToolchain } : {}),
      ...options.env,
      PATH: pathValue,
    },
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...withToolchainPaths(options),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(typeof result.status === 'number' ? result.status : 1);
}

function runFinal(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...withToolchainPaths(options),
  });
  if (result.error) throw result.error;
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

function runTauriDirect() {
  run('npm.cmd', ['run', 'sync-version'], { shell: true });
  runFinal('npx.cmd', ['tauri', ...process.argv.slice(2)], { shell: true });
}

if (!vcvars64Path) {
  runTauriDirect();
}

const tempScriptPath = path.join(os.tmpdir(), `agy-shift-tauri-${process.pid}.cmd`);
const tauriCliPath = path.join(repoRoot, 'node_modules', '.bin', 'tauri.cmd');
const tauriArgs = process.argv.slice(2);

if (!fs.existsSync(tauriCliPath)) {
  runTauriDirect();
}

const quotedArgs = tauriArgs.map((arg) => (/[\s"]/u.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg));
const scriptBody = [
  '@echo off',
  ...(extraPaths.length > 0 ? [`set "PATH=${extraPaths.join(path.delimiter)};%PATH%"`] : []),
  `call "${vcvars64Path}"`,
  'if errorlevel 1 exit /b %errorlevel%',
  'call npm.cmd run sync-version',
  'if errorlevel 1 exit /b %errorlevel%',
  `call "${tauriCliPath}" ${quotedArgs.join(' ')}`.trim(),
].join('\r\n');

fs.writeFileSync(tempScriptPath, scriptBody);
try {
  runFinal('cmd.exe', ['/d', '/c', tempScriptPath]);
} finally {
  fs.rmSync(tempScriptPath, { force: true });
}
