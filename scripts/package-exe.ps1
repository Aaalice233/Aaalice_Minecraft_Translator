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
  throw "未找到 cargo。请先安装 Rust 工具链，或确认 $cargoBin 存在。"
}

if (-not (Test-Path "node_modules")) {
  npm install
}

npm run build

$tauri = Join-Path $root "node_modules/.bin/tauri.cmd"
if (-not (Test-Path $tauri)) {
  throw "未找到 Tauri CLI：$tauri"
}

if ($NoBundle) {
  & $tauri build --no-bundle
} else {
  & $tauri build --bundles nsis
}
