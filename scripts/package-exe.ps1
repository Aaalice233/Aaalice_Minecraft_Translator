param(
  [switch]$NoBundle
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

$cargoBin = Join-Path $env:USERPROFILE ".cargo/bin"
if (Test-Path $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo not found. Please install the Rust toolchain or verify $cargoBin exists."
}

# ── 自动从 .env.local 加载签名密钥 ──────────────────────────
$envFile = Join-Path $root ".env.local"
if (Test-Path $envFile) {
  $lines = Get-Content $envFile
  foreach ($line in $lines) {
    if ($line -match '^TAURI_SIGNING_PRIVATE_KEY=(.+)') {
      if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
        $env:TAURI_SIGNING_PRIVATE_KEY = $Matches[1]
      }
    }
    if ($line -match '^TAURI_SIGNING_PRIVATE_KEY_PASSWORD=(.+)') {
      if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $Matches[1]
      }
    }
  }
}
# ──────────────────────────────────────────────────────────

if (-not (Test-Path "node_modules")) {
  npm install
}

# 注意：不在这里显式 npm run build——tauri build 会自动执行 beforeBuildCommand

$tauri = Join-Path $root "node_modules/.bin/tauri.cmd"
if (-not (Test-Path $tauri)) {
  throw "Tauri CLI not found: $tauri"
}

if ($NoBundle) {
  & $tauri build --no-bundle
} else {
  & $tauri build --bundles nsis
}
