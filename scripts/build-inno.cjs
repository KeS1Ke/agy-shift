const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const tauriScriptPath = path.join(repoRoot, 'scripts', 'tauri.cjs');
const issPath = path.join(repoRoot, 'installer', 'agy-shift.iss');
const updateConfigPath = path.join(repoRoot, 'installer', 'tauri.inno.json');
const exePath = path.join(repoRoot, 'target', 'release', 'agy-shift.exe');

const installerOnly = process.argv.includes('--installer-only');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version || '0.1.0';

function findIscc() {
  const candidates = [
    process.env.ISCC_PATH,
    'D:\\Vibe-coding Projects\\Tools\\Inno Setup 7\\ISCC.exe',
    'D:\\Vibe-coding Projects\\Tools\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files (x86)\\Inno Setup 7\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const whereResult = spawnSync('where.exe', ['ISCC.exe'], {
    encoding: 'utf-8',
    shell: false,
  });
  if (whereResult.status === 0 && whereResult.stdout) {
    const firstLine = whereResult.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  }
  return null;
}

if (!installerOnly) {
  console.log('[Inno] 正在编译 Agy Shift Release 可执行文件...');
  const buildResult = spawnSync(
    process.execPath,
    [tauriScriptPath, 'build', '--no-bundle', '--config', path.relative(repoRoot, updateConfigPath)],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    },
  );
  if (buildResult.error) throw buildResult.error;
  if (buildResult.status !== 0) {
    process.exit(typeof buildResult.status === 'number' ? buildResult.status : 1);
  }
}

if (!fs.existsSync(exePath)) {
  console.error(`[Inno] 未找到编译产物: ${exePath}`);
  console.error('[Inno] 请先运行 npm run build:inno。');
  process.exit(1);
}

const { pubkey } = require('../src-tauri/tauri.conf.json').plugins.updater;
const [updateEndpoint] = require(updateConfigPath).plugins.updater.endpoints;
const exe = fs.readFileSync(exePath);
if (!pubkey || !exe.includes(Buffer.from(pubkey)) || !exe.includes(Buffer.from(updateEndpoint))) {
  console.error('[Inno] 程序未嵌入当前更新公钥和 Inno 更新地址，请运行 npm run build:inno。');
  process.exit(1);
}

const isccPath = findIscc();
if (!isccPath) {
  console.error('[Inno] 未找到 Inno Setup 编译器 (ISCC.exe)。');
  console.error('[Inno] 请安装 Inno Setup 7，或通过环境变量 ISCC_PATH 指定 ISCC.exe 路径。');
  process.exit(1);
}

const outputDir = path.join(repoRoot, 'target', 'release', 'bundle', 'inno');
const installerName = `Agy-Shift_${version}_x64-setup.exe`;
const outputSetup = path.join(outputDir, installerName);
const signaturePath = `${outputSetup}.sig`;
const manifestPath = path.join(outputDir, path.posix.basename(new URL(updateEndpoint).pathname));
fs.rmSync(signaturePath, { force: true });
fs.rmSync(manifestPath, { force: true });

console.log(`[Inno] 使用编译器: ${isccPath}`);
const innoResult = spawnSync(
  isccPath,
  [`/DAppVersion=${version}`, issPath],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  },
);
if (innoResult.error) throw innoResult.error;
if (innoResult.status !== 0) {
  process.exit(typeof innoResult.status === 'number' ? innoResult.status : 1);
}

const signResult = spawnSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(repoRoot, 'scripts', 'sign-inno.ps1'),
  '-Installer', outputSetup, '-Version', version, '-PublicKey', pubkey,
], { cwd: repoRoot, stdio: 'inherit', shell: false });
if (signResult.error) throw signResult.error;
if (signResult.status !== 0) process.exit(signResult.status ?? 1);

const releaseUrl = new URL(updateEndpoint);
releaseUrl.pathname = releaseUrl.pathname.replace(
  /\/latest\/download\/[^/]+$/u,
  `/download/v${version}/${installerName}`,
);
const manifest = {
  version,
  platforms: {
    'windows-x86_64': {
      url: releaseUrl.href,
      signature: fs.readFileSync(signaturePath, 'utf8').trim(),
    },
  },
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[Inno] 安装包已生成: ${outputSetup}`);
console.log(`[Inno] 更新清单已生成: ${manifestPath}`);
