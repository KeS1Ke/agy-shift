param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$PublicKey
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
$repoRoot = Split-Path -Parent $PSScriptRoot
$application = Get-Item -LiteralPath (Join-Path $repoRoot 'target/release/agy-shift.exe')
if ($application.VersionInfo.ProductVersion.Trim() -cne $Version) {
    throw 'The application version does not match the update version. Rebuild the application first.'
}

$store = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AgyShiftSigning'
$secretPath = Join-Path $store 'updater.key.dpapi'
$publicPath = Join-Path $store 'updater.key.pub'
if (!(Test-Path -LiteralPath $secretPath -PathType Leaf) -or !(Test-Path -LiteralPath $publicPath -PathType Leaf)) {
    throw 'The local Agy Shift updater signing key is missing.'
}
if ([IO.File]::ReadAllText($publicPath).Trim() -cne $PublicKey) {
    throw 'The local signing key does not match the updater public key.'
}

$privateKey = [IO.File]::ReadAllText($secretPath) | ConvertTo-SecureString
$credential = [PSCredential]::new('updater', $privateKey)
$signer = New-Object Diagnostics.ProcessStartInfo
$signer.FileName = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$signer.WorkingDirectory = $repoRoot
$signer.Arguments = "node_modules/@tauri-apps/cli/tauri.js signer sign --password= --app-version $Version `"$Installer`""
$signer.UseShellExecute = $false
$signer.RedirectStandardOutput = $true
$signer.RedirectStandardError = $true
$signer.EnvironmentVariables.Remove('TAURI_SIGNING_PRIVATE_KEY_PATH')
$signer.EnvironmentVariables['TAURI_SIGNING_PRIVATE_KEY'] = $credential.GetNetworkCredential().Password
$process = [Diagnostics.Process]::Start($signer)
try {
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw 'Tauri could not sign the Inno Setup update artifact.'
    }
} finally {
    $process.Dispose()
    $privateKey.Dispose()
}
