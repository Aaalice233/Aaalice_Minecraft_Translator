$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot  # 项目根目录（脚本所在目录）

$Host.UI.RawUI.WindowTitle = "Aaalice Translator - Dev Reloader"

Write-Host ('=' * 57)
Write-Host "  Kill old processes + Start hot reload"
Write-Host ('=' * 57)
Write-Host ""

# ---- 1. Kill old processes ----
Write-Host "[1/3] 清理旧进程..."

# 关闭占用 1420 端口的进程
$conns = Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue |
    Where-Object State -Eq "Listen"
foreach ($c in $conns) {
    Write-Host "    - 端口 1420 被 PID $($c.OwningProcess) 占用，正在关闭..."
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
}

# 关闭相关进程
@("aaalice_mc_translator", "cargo", "rustc") | ForEach-Object {
    Get-Process -Name $_ -ErrorAction SilentlyContinue | Stop-Process -Force
}

Start-Sleep -Seconds 2

# 清理可能导致 EBUSY 的残留锁文件
$cargoLock = "src-tauri\target\debug\.cargo-lock"
if (Test-Path $cargoLock) { Remove-Item -Force $cargoLock -ErrorAction SilentlyContinue }

Write-Host "    完成"
Write-Host ""

# ---- 2. Check node_modules ----
Write-Host "[2/3] 检查依赖..."
if (-not (Test-Path "node_modules")) {
    Write-Host "    - node_modules 不存在，运行 npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    x npm install 失败"
        Read-Host "按 Enter 退出"
        exit $LASTEXITCODE
    }
    Write-Host "    - 安装完成"
} else {
    Write-Host "    - node_modules 就绪"
}
Write-Host ""

# ---- 3. Start hot reload ----
Write-Host "[3/3] 启动热重载..."
Write-Host "按 Ctrl+C 停止"
Write-Host ""
npm run tauri dev
