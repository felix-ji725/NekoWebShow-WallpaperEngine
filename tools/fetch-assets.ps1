# 自动获取《猫娘乐园》素材并安装到 Wallpaper Engine
# 素材版权归 NEKO WORKs，本脚本只负责"从上游仓库下载到本机"，不托管、不再分发。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1 -Mode files   # 强制逐文件下载
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1 -SkipInstall  # 只下素材

param(
    [ValidateSet('auto', 'zip', 'files')]
    [string]$Mode = 'auto',
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$branch = 'html_version_v2'
$repo = 'Chocola-X/NekoWebShow'
$dirs = @('data', 'background', 'sounds')
$expected = @{ 'data' = 195; 'background' = 121; 'sounds' = 271 }

function Write-Step($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

function Test-Assets {
    $ok = $true
    foreach ($d in $dirs) {
        $path = Join-Path $root $d
        $n = if (Test-Path $path) { (Get-ChildItem $path -Recurse -File | Measure-Object).Count } else { 0 }
        $color = if ($n -eq $expected[$d]) { 'Green' } else { 'Yellow' }
        Write-Host ("  {0,-12} {1,4} / {2}" -f $d, $n, $expected[$d]) -ForegroundColor $color
        if ($n -ne $expected[$d]) { $ok = $false }
    }
    return $ok
}

function Get-Zip($dest) {
    $urls = @(
        "https://codeload.github.com/$repo/zip/refs/heads/$branch",
        "https://gh-proxy.com/https://codeload.github.com/$repo/zip/refs/heads/$branch"
    )
    foreach ($u in $urls) {
        Write-Host "  尝试: $($u.Substring(0, [Math]::Min(70, $u.Length)))..." -ForegroundColor DarkGray
        try {
            if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
                $job = Start-BitsTransfer -Source $u -Destination $dest -Asynchronous -Priority Foreground
                while ($job.JobState -in 'Connecting', 'Transferring', 'Queued') {
                    $pct = if ($job.BytesTotal -gt 0) { [Math]::Round($job.BytesTransferred / $job.BytesTotal * 100) } else { 0 }
                    Write-Progress -Activity "下载素材包" -Status ("{0} MB / {1} MB" -f [Math]::Round($job.BytesTransferred / 1MB), [Math]::Round($job.BytesTotal / 1MB)) -PercentComplete $pct
                    Start-Sleep -Milliseconds 800
                    $job = Get-BitsTransfer -JobId $job.JobId
                }
                Write-Progress -Activity "下载素材包" -Completed
                if ($job.JobState -eq 'Transferred') { Complete-BitsTransfer -BitsJob $job; return $true }
                Remove-BitsTransfer -BitsJob $job
            } else {
                Invoke-WebRequest -Uri $u -OutFile $dest -UseBasicParsing
                return $true
            }
        } catch {
            Write-Host "  失败: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
    }
    return $false
}

function Install-FromZip($zip) {
    $tmp = Join-Path $env:TEMP ("nekoshow-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Write-Host "  解压中（约 1 GB，需要几十秒）..."
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (-not $inner) { throw "压缩包结构异常" }
    foreach ($d in $dirs) {
        $from = Join-Path $inner.FullName $d
        if (-not (Test-Path $from)) { throw "压缩包里缺少 $d" }
        $to = Join-Path $root $d
        if (Test-Path $to) { Remove-Item $to -Recurse -Force }
        Move-Item $from $to
    }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

function Get-Files {
    $manifest = Get-Content (Join-Path $PSScriptRoot 'assets-manifest.json') -Raw | ConvertFrom-Json
    $todo = @()
    foreach ($f in $manifest.files) {
        $dest = Join-Path $root $f.p
        if ((Test-Path $dest) -and ((Get-Item $dest).Length -eq $f.s)) { continue }
        $todo += $f
    }
    Write-Host "  待下载 $($todo.Count) 个文件（共 $([Math]::Round(($todo | Measure-Object s -Sum).Sum / 1MB)) MB）"
    if ($todo.Count -eq 0) { return }

    $i = 0
    foreach ($f in $todo) {
        $i++
        $dest = Join-Path $root $f.p
        New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
        $url = "https://ghfast.top/https://raw.githubusercontent.com/$($manifest.repo)/$($manifest.branch)/$($f.p)"
        $url2 = "https://raw.githubusercontent.com/$($manifest.repo)/$($manifest.branch)/$($f.p)"
        Write-Progress -Activity "下载素材" -Status "$i / $($todo.Count)  $($f.p)" -PercentComplete ([Math]::Round($i / $todo.Count * 100))
        $done = $false
        foreach ($u in @($url, $url2)) {
            try {
                Invoke-WebRequest -Uri $u -OutFile $dest -UseBasicParsing -TimeoutSec 120
                if ((Get-Item $dest).Length -eq $f.s) { $done = $true; break }
            } catch { }
        }
        if (-not $done) { Write-Host "  跳过（失败）: $($f.p)" -ForegroundColor DarkYellow }
    }
    Write-Progress -Activity "下载素材" -Completed
}

function Start-Installer {
    $bat = Join-Path $root '安装到WallpaperEngine.bat'
    if (Test-Path $bat) {
        Write-Host "`n启动安装脚本..." -ForegroundColor Cyan
        Start-Process -FilePath $bat -WorkingDirectory $root
    } else {
        Write-Host "未找到 安装到WallpaperEngine.bat，请手动双击。" -ForegroundColor Yellow
    }
}

Write-Host "NekoWebShow 素材获取" -ForegroundColor Cyan
Write-Host "素材版权归 NEKO WORKs，仅下载到你本机自用，请勿再分发。" -ForegroundColor DarkGray

Write-Step "检查现有素材"
$have = Test-Assets
if ($have) {
    Write-Host "`n素材已齐全，跳过下载。" -ForegroundColor Green
    if (-not $SkipInstall) { Start-Installer }
    return
}

$downloaded = $false
if ($Mode -in 'auto', 'zip') {
    Write-Step "下载上游素材包（约 1 GB）"
    $zip = Join-Path $env:TEMP 'nekoshow-assets.zip'
    if ((Test-Path $zip) -and ((Get-Item $zip).Length -gt 100MB)) {
        Write-Host "  发现上次下载的压缩包，直接使用" -ForegroundColor DarkGray
        $downloaded = $true
    } else {
        $downloaded = Get-Zip $zip
    }
    if ($downloaded) {
        Write-Step "解压并放置素材"
        try { Install-FromZip $zip } catch { Write-Host "  解压失败: $($_.Exception.Message)" -ForegroundColor Red; $downloaded = $false }
    }
}

if (-not $downloaded -and $Mode -in 'auto', 'files') {
    Write-Step "改用逐文件下载（较慢，可中断后重跑续传）"
    try { Get-Files } catch { Write-Host "  下载出错: $($_.Exception.Message)" -ForegroundColor Red }
}

Write-Step "校验"
$ok = Test-Assets
if ($ok) {
    Write-Host "`n素材齐全。" -ForegroundColor Green
    if (-not $SkipInstall) { Start-Installer }
} else {
    Write-Host "`n素材不完整。" -ForegroundColor Yellow
    Write-Host "可以：重新运行本脚本（已下载的会跳过）；或用浏览器手动下载（见 README「手动安装」）。"
}
