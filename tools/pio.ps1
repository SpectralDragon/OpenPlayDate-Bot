param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PioArgs
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pioCommand = Get-Command pio -ErrorAction SilentlyContinue
if ($pioCommand) {
    $pioPath = $pioCommand.Source
} else {
    $coreRoot = if ($env:PLATFORMIO_CORE_DIR) { $env:PLATFORMIO_CORE_DIR } else { Join-Path $env:USERPROFILE '.platformio' }
    $pioPath = Join-Path $coreRoot 'penv\Scripts\platformio.exe'
    if (-not (Test-Path -LiteralPath $pioPath)) {
        throw 'PlatformIO Core not found. Install the PlatformIO IDE extension in VS Code first.'
    }
}
Push-Location $projectRoot
try {
    & $pioPath @PioArgs
    $pioExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $pioExitCode
