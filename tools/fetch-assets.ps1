# 自动获取《猫娘乐园》素材并安装到 Wallpaper Engine
# 素材版权归 NEKO WORKs，本脚本只负责"从上游仓库下载到本机"，不托管、不再分发。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1 -Mode files   # 强制逐文件
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1 -Mode zip     # 强制整包
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

function Write-Step($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

# ---------- 清单：以文件为准，不看数量 ----------
$manifest = Get-Content (Join-Path $PSScriptRoot 'assets-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$allFiles = $manifest.files

# 逐个文件核对：存在且大小一致才算就绪
function Get-AssetState {
    $missing = New-Object System.Collections.ArrayList
    $present = 0
    $missingBytes = 0
    foreach ($f in $allFiles) {
        $dest = Join-Path $root $f.p
        if ((Test-Path $dest) -and ((Get-Item $dest).Length -eq $f.s)) {
            $present++
        } else {
            [void]$missing.Add($f)
            $missingBytes += $f.s
        }
    }
    $extra = 0
    foreach ($d in $dirs) {
        $p = Join-Path $root $d
        if (Test-Path $p) {
            $have = (Get-ChildItem $p -Recurse -File | Measure-Object).Count
            $want = ($allFiles | Where-Object { $_.p -like "$d/*" }).Count
            if ($have -gt $want) { $extra += $have - $want }
        }
    }
    return [pscustomobject]@{
        Missing      = $missing
        Present      = $present
        Total        = $allFiles.Count
        MissingBytes = $missingBytes
        Extra        = $extra
    }
}

function Show-State($st) {
    $pct = if ($st.Total -gt 0) { [Math]::Round($st.Present / $st.Total * 100) } else { 0 }
    Write-Host ("  已就绪 {0} / {1} 个文件（{2}%）" -f $st.Present, $st.Total, $pct) -ForegroundColor $(if ($st.Missing.Count -eq 0) { 'Green' } else { 'Yellow' })
    if ($st.Missing.Count -gt 0) {
        Write-Host ("  待补 {0} 个，约 {1} MB" -f $st.Missing.Count, [Math]::Round($st.MissingBytes / 1MB)) -ForegroundColor Yellow
    }
    if ($st.Extra -gt 0) {
        Write-Host ("  另有 {0} 个清单之外的文件（忽略，不影响运行）" -f $st.Extra) -ForegroundColor DarkGray
    }
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
                $t0 = Get-Date
                $lastBytes = 0
                $lastT = $t0
                while ($job.JobState -in 'Connecting', 'Transferring', 'Queued') {
                    $mb = [Math]::Round($job.BytesTransferred / 1MB, 1)
                    $now = Get-Date
                    $dt = ($now - $lastT).TotalSeconds
                    $speed = 0
                    if ($dt -gt 0.4) {
                        $speed = ($job.BytesTransferred - $lastBytes) / 1KB / $dt
                        $lastBytes = $job.BytesTransferred
                        $lastT = $now
                    }
                    if ($job.BytesTotal -gt 0) {
                        $pct = [Math]::Round($job.BytesTransferred / $job.BytesTotal * 100)
                        $total = [Math]::Round($job.BytesTotal / 1MB, 0)
                        Write-Progress -Activity "下载素材包（约 1 GB）" -Status ("{0} MB / {1} MB    {2} KB/s" -f $mb, $total, [Math]::Round($speed)) -PercentComplete $pct
                    } else {
                        Write-Progress -Activity "下载素材包（约 1 GB，总大小未知）" -Status ("已下载 {0} MB    {1} KB/s    用时 {2:mm\:ss}" -f $mb, [Math]::Round($speed), ($now - $t0))
                    }
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

# 只补缺失文件，已就绪的一个都不碰
function Get-MissingFiles($missing) {
    $totalMB = [Math]::Round((($missing | Measure-Object s -Sum).Sum) / 1MB)
    Write-Host ("  需要下载 {0} 个文件，约 {1} MB" -f $missing.Count, $totalMB)
    $i = 0
    $doneMB = 0
    foreach ($f in $missing) {
        $i++
        $dest = Join-Path $root $f.p
        New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
        $url = "https://ghfast.top/https://raw.githubusercontent.com/$($manifest.repo)/$($manifest.branch)/$($f.p)"
        $url2 = "https://raw.githubusercontent.com/$($manifest.repo)/$($manifest.branch)/$($f.p)"
        Write-Progress -Activity "下载素材（只补缺失，可中断续传）" -Status ("已下载 {0} / {1} MB    第 {2} / {3} 个    {4}" -f [Math]::Round($doneMB), $totalMB, $i, $missing.Count, (Split-Path -Leaf $f.p)) -PercentComplete ([Math]::Round($i / [Math]::Max(1, $missing.Count) * 100))
        $done = $false
        foreach ($u in @($url, $url2)) {
            try {
                Invoke-WebRequest -Uri $u -OutFile $dest -UseBasicParsing -TimeoutSec 120
                if ((Get-Item $dest).Length -eq $f.s) { $done = $true; $doneMB += $f.s / 1MB; break }
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

# ---------- 主流程 ----------
Write-Host "NekoWebShow 素材获取" -ForegroundColor Cyan
Write-Host "素材版权归 NEKO WORKs，仅下载到你本机自用，请勿再分发。" -ForegroundColor DarkGray

Write-Step "检查现有素材"
$state = Get-AssetState
Show-State $state

if ($state.Missing.Count -eq 0) {
    Write-Host "`n素材已齐全，不需要下载。" -ForegroundColor Green
    if (-not $SkipInstall) { Start-Installer }
    return
}

# 已经有相当一部分就直接增量补，不为几个文件重下 1 GB
$ratio = $state.Present / [Math]::Max(1, $state.Total)
$useZip = ($Mode -eq 'zip') -or ($Mode -eq 'auto' -and $ratio -lt 0.3)

if ($useZip) {
    Write-Step "下载上游素材包（约 1 GB）"
    $zip = Join-Path $env:TEMP 'nekoshow-assets.zip'
    if ((Test-Path $zip) -and ((Get-Item $zip).Length -gt 100MB)) {
        Write-Host "  发现上次下载的完整压缩包，直接使用" -ForegroundColor DarkGray
        $ok = $true
    } else {
        $ok = Get-Zip $zip
    }
    if ($ok) {
        Write-Step "解压并放置素材"
        try { Install-FromZip $zip } catch { Write-Host "  解压失败: $($_.Exception.Message)" -ForegroundColor Red; $ok = $false }
    }
    if ($ok) {
        $state = Get-AssetState
        Show-State $state
    }
}

if ($state.Missing.Count -gt 0) {
    Write-Step "增量补齐缺失文件"
    try { Get-MissingFiles $state.Missing } catch { Write-Host "  下载出错: $($_.Exception.Message)" -ForegroundColor Red }
}

Write-Step "校验"
$final = Get-AssetState
Show-State $final
if ($final.Missing.Count -eq 0) {
    Write-Host "`n素材齐全。" -ForegroundColor Green
    if (-not $SkipInstall) { Start-Installer }
} else {
    Write-Host "`n仍有 $($final.Missing.Count) 个文件缺失。" -ForegroundColor Yellow
    Write-Host "重新运行本脚本会自动跳过已完整的，只补剩下的。"
}
