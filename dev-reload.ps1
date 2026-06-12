$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot  # 项目根目录（脚本所在目录）

$Host.UI.RawUI.WindowTitle = "Aaalice Translator - Dev Reloader"

# ============================================================
# 颜色辅助
# ============================================================
$C = @{
    Green  = "Green"
    Yellow = "Yellow"
    Red    = "Red"
    Cyan   = "Cyan"
    Dim    = "DarkGray"
}

function Log-Info  { Write-Host "  $($args[0])" -ForegroundColor $C.Green }
function Log-Warn  { Write-Host "  ⚠ $($args[0])" -ForegroundColor $C.Yellow }
function Log-Err   { Write-Host "  x $($args[0])" -ForegroundColor $C.Red }
function Log-Step  { param([string]$Label) Write-Host ""; Write-Host "$Label" -ForegroundColor $C.Cyan }

Write-Host ('=' * 57) -ForegroundColor $C.Cyan
Write-Host "  Aaalice Translator — Dev Reloader" -ForegroundColor $C.Cyan
Write-Host ('=' * 57) -ForegroundColor $C.Cyan

# ============================================================
# [预备] 环境检测
# ============================================================
Log-Step "━━━ [预备] 环境检测 ━━━"
$hasError = $false

# -- Node.js --
try {
    $nodeVer = node --version
    $npmVer  = npm --version
    Log-Info "Node.js $nodeVer  /  npm $npmVer"
} catch {
    Log-Err "Node.js 未安装或不在 PATH 中"
    $hasError = $true
}

# -- Rust 工具链 --
try {
    $rustVer = rustc --version
    $cargoVer = cargo --version
    Log-Info "$rustVer  /  $cargoVer"
} catch {
    Log-Err "Rust/Cargo 未安装或不在 PATH 中"
    $hasError = $true
}

# -- 检查关键前端依赖（动态 import 的包最容易被漏掉） --
$criticalPkgs = @(
    "@tauri-apps/api",
    "@tauri-apps/plugin-dialog",
    "react",
    "react-dom",
    "zustand",
    "lucide-react",
    "react-virtuoso"
)
$missingPkgs = $criticalPkgs | Where-Object {
    $pkgDir = "node_modules/$($_ -replace '@', '' -replace '/', '/')"
    if ($_.StartsWith('@')) {
        $parts = $_ -split '/'
        $pkgDir = "node_modules/$($parts[0])/$($parts[1])"
    }
    -not (Test-Path "$pkgDir/package.json")
}
if ($missingPkgs.Count -gt 0) {
    Log-Warn "缺少前端包: $($missingPkgs -join ', ')"
    Log-Info "运行 npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Log-Err "npm install 失败"
        $hasError = $true
    } else {
        Log-Info "安装完成"
    }
} else {
    Log-Info "前端依赖就绪"
}

# -- 检查 Rust 关键依赖（通过 Cargo.lock 快速检查） --
$criticalCrates = @("tauri-plugin-dialog")
$missingCrates = $criticalCrates | Where-Object {
    Select-String -Path "src-tauri/Cargo.lock" -Pattern "name = `"$_`"" -Quiet -SimpleMatch
}
if ($missingCrates.Count -lt $criticalCrates.Count) {
    Log-Warn "Cargo.lock 中缺少部分 crate，可能需先 cargo build 下载"
}

# -- Git 工作区状态提醒 --
try {
    $gitStatus = git status --porcelain
    if (-not [string]::IsNullOrWhiteSpace($gitStatus)) {
        $changed = ($gitStatus -split "`n" | Where-Object { $_ -ne '' }).Count
        Log-Warn "有 $changed 个未提交的更改（git status 查看详情）"
    } else {
        Log-Info "Git 工作区干净"
    }
} catch {
    # Git 检测失败不阻断
}

# -- 上次构建产物 --
if (Test-Path "src-tauri/target/debug/aaalice_mc_translator.exe") {
    $builtTime = (Get-Item "src-tauri/target/debug/aaalice_mc_translator.exe").LastWriteTime
    $elapsed = [math]::Round(((Get-Date) - $builtTime).TotalHours, 1)
    Log-Info "上次调试构建: $elapsed 小时前"
}

if ($hasError) {
    Write-Host ""
    Log-Err "前置检测未通过，请修复后重试"
    Read-Host "按 Enter 退出"
    exit 1
}

Write-Host ""
Log-Info "环境检测全部通过"
Write-Host ""

# ============================================================
# [1/4] 清理旧进程
# ============================================================
Log-Step "━━━ [1/4] 清理旧进程 ━━━"

# 关闭占用 1420 端口的进程
$conns = Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue |
    Where-Object State -Eq "Listen"
foreach ($conn in $conns) {
    Write-Host "    - 端口 1420 被 PID $($conn.OwningProcess) 占用，正在关闭..." -ForegroundColor $C.Yellow
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
}

# 关闭相关进程
@("aaalice_mc_translator", "cargo", "rustc") | ForEach-Object {
    Get-Process -Name $_ -ErrorAction SilentlyContinue | Stop-Process -Force
}

Start-Sleep -Seconds 2

# 清理可能导致 EBUSY 的残留锁文件
$cargoLock = "src-tauri\target\debug\.cargo-lock"
if (Test-Path $cargoLock) { Remove-Item -Force $cargoLock -ErrorAction SilentlyContinue }

Log-Info "清理完成"

# ============================================================
# [2/4] 检查依赖
# ============================================================
Log-Step "━━━ [2/4] 检查依赖 ━━━"
if (-not (Test-Path "node_modules")) {
    Write-Host "    - node_modules 不存在，运行 npm install..." -ForegroundColor $C.Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Log-Err "npm install 失败"
        Read-Host "按 Enter 退出"
        exit $LASTEXITCODE
    }
    Log-Info "安装完成"
} else {
    Log-Info "node_modules 就绪"
}

# ============================================================
# [3/4] 检查关键包完整性
# ============================================================
Log-Step "━━━ [3/4] 校验关键包 ━━━"

# 前端包校验（检查 package.json 声明 vs node_modules 实际存在）
$pkgJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$declared = @($pkgJson.dependencies.PSObject.Properties.Name)
$actuallyMissing = $declared | Where-Object {
    $dir = "node_modules/$($_ -replace '@', '' -replace '/', '/')"
    if ($_.StartsWith('@')) {
        $parts = $_ -split '/'
        $dir = "node_modules/$($parts[0])/$($parts[1])"
    }
    -not (Test-Path "$dir/package.json")
}
if ($actuallyMissing.Count -gt 0) {
    Log-Warn "package.json 中声明的包未安装: $($actuallyMissing -join ', ')"
    Log-Info "运行 npm install..."
    npm install
} else {
    Log-Info "所有声明的包均已安装"
}

# ============================================================
# [4/4] 启动热重载
# ============================================================
Log-Step "━━━ [4/4] 启动热重载 ━━━"
Write-Host "按 Ctrl+C 停止" -ForegroundColor $C.Dim
Write-Host ""
npm run tauri dev
