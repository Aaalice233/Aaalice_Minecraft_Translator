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

if (-not (Test-Path "node_modules")) {
  npm install
}

npm run build

$tauri = Join-Path $root "node_modules/.bin/tauri.cmd"
if (-not (Test-Path $tauri)) {
  throw "Tauri CLI not found: $tauri"
}

if ($NoBundle) {
  & $tauri build --no-bundle
} else {
  & $tauri build --bundles nsis
}
