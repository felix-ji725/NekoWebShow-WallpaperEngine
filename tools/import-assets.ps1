# 从本地已有的 NekoWebShow 目录导入素材（data / background / sounds）
# 用法：powershell -ExecutionPolicy Bypass -File tools\import-assets.ps1 -Source "D:\path\to\NekoWebShow"
param(
    [Parameter(Mandatory = $true)]
    [string]$Source
)

$root = Split-Path -Parent $PSScriptRoot
$dirs = @('data', 'background', 'sounds')
$missing = @()

foreach ($d in $dirs) {
    $from = Join-Path $Source $d
    if (-not (Test-Path $from)) { $missing += $d; continue }
    $to = Join-Path $root $d
    Write-Host "复制 $d ..."
    robocopy $from $to /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Host "  [失败] $d" -ForegroundColor Red }
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "以下目录在源路径中不存在：" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

Write-Host ""
Write-Host "完成。现在可以运行 安装到WallpaperEngine.bat" -ForegroundColor Green
