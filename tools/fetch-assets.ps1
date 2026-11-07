# 自动获取《猫娘乐园》素材并安装到 Wallpaper Engine
# 素材版权归 NEKO WORKs，本脚本只负责"从上游仓库下载到本机"，不托管、不再分发。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1 -Workers 8    # 并发数
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1 -Mode zip     # 改回整包下载
#   powershell -ExecutionPolicy Bypass -File tools\fetch-assets.ps1 -SkipInstall  # 只下素材

param(
    [ValidateSet('auto', 'zip', 'files')]
    [string]$Mode = 'auto',
    [int]$Workers = 4,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$branch = 'html_version_v2'
$repo = 'Chocola-X/NekoWebShow'
$dirs = @('data', 'background', 'sounds')

# 镜像优先级：实测 jsDelivr 最快，其次 ghfast，最后官方 raw
$mirrorTemplates = @(
    "https://cdn.jsdelivr.net/gh/{0}@{1}/{2}",
    "https://ghfast.top/https://raw.githubusercontent.com/{0}/{1}/{2}",
    "https://raw.githubusercontent.com/{0}/{1}/{2}"
)

function Write-Step($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

# ---------- 清单：以文件为准，不看数量 ----------
$manifest = Get-Content (Join-Path $PSScriptRoot 'assets-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$allFiles = $manifest.files

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
            try {
                $have = (Get-ChildItem $p -Recurse -File -ErrorAction Stop | Measure-Object).Count
                $want = ($allFiles | Where-Object { $_.p -like "$d/*" }).Count
                if ($have -gt $want) { $extra += $have - $want }
            } catch { }
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

# ---------- 并发下载：多连接拉小文件，比单连接下整包快得多 ----------
function Get-MissingFiles($missing) {
    $totalMB = [Math]::Round((($missing | Measure-Object s -Sum).Sum) / 1MB)
    Write-Host ("  需要下载 {0} 个文件，约 {1} MB，{2} 路并发" -f $missing.Count, $totalMB, $Workers)

    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.MaxConnectionsPerServer = [Math]::Max(4, $Workers)
    $http = New-Object System.Net.Http.HttpClient($handler)
    $http.Timeout = [TimeSpan]::FromSeconds(60)
    $http.DefaultRequestHeaders.Add('User-Agent', 'Mozilla/5.0')

    $queue = New-Object System.Collections.Queue
    foreach ($f in $missing) { $queue.Enqueue([pscustomobject]@{ File = $f; Mirror = 0 }) }

    $active = @()
    $doneCount = 0
    $doneMB = 0
    $failed = 0
    $t0 = Get-Date
    $lastMB = 0
    $lastT = $t0
    $speed = 0

    while ($queue.Count -gt 0 -or $active.Count -gt 0) {
        while ($active.Count -lt $Workers -and $queue.Count -gt 0) {
            $item = $queue.Dequeue()
            $dest = Join-Path $root $item.File.p
            New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
            $url = $mirrorTemplates[$item.Mirror] -f $repo, $branch, $item.File.p
            $task = $http.GetAsync($url)
            $active += [pscustomobject]@{ Item = $item; Task = $task; Dest = $dest }
        }

        $still = New-Object System.Collections.ArrayList
        foreach ($a in $active) {
            if (-not $a.Task.IsCompleted) { [void]$still.Add($a); continue }

            $ok = $false
            $resp = $null
            try {
                $resp = $a.Task.GetAwaiter().GetResult()
                if ($resp.IsSuccessStatusCode) {
                    $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                    if ($bytes.Length -eq $a.Item.File.s) {
                        [System.IO.File]::WriteAllBytes($a.Dest, $bytes)
                        $ok = $true
                    }
                }
            } catch { }

            if ($resp) { $resp.Dispose() }

            if ($ok) {
                $doneCount++
                $doneMB += $a.Item.File.s / 1MB
            } elseif ($a.Item.Mirror -lt ($mirrorTemplates.Count - 1)) {
                $queue.Enqueue([pscustomobject]@{ File = $a.Item.File; Mirror = $a.Item.Mirror + 1 })
            } else {
                $failed++
                Write-Host "  失败: $($a.Item.File.p)" -ForegroundColor DarkYellow
            }
        }
        $active = $still

        $now = Get-Date
        $dt = ($now - $lastT).TotalSeconds
        if ($dt -gt 1.0) {
            $speed = ($doneMB - $lastMB) / $dt
            $lastMB = $doneMB
            $lastT = $now
        }
        $elapsed = $now - $t0
        if ($speed -ge 1) {
            $speedTxt = "{0:N1} MB/s" -f $speed
        } elseif ($speed -gt 0) {
            $speedTxt = "{0:N0} KB/s" -f ($speed * 1024)
        } else {
            $speedTxt = "测速中"
        }
        if ($speed -gt 0.02) {
            $etaTxt = ([TimeSpan]::FromSeconds([Math]::Max(0, ($totalMB - $doneMB) / $speed))).ToString("mm\:ss")
        } else {
            $etaTxt = "--:--"
        }
        $pct = if ($totalMB -gt 0) { [Math]::Min(100, [Math]::Max(0, [Math]::Round($doneMB / $totalMB * 100))) } else { 0 }
        Write-Progress -Activity ("下载素材（{0} 路并发，可中断续传）" -f $Workers) `
            -Status ("{0}/{1} 个   {2}/{3} MB   {4}   剩余 {5}" -f $doneCount, $missing.Count, [Math]::Round($doneMB), $totalMB, $speedTxt, $etaTxt) `
            -PercentComplete $pct

        Start-Sleep -Milliseconds 100
    }
    Write-Progress -Activity "下载素材" -Completed
    $http.Dispose()
    if ($failed -gt 0) { Write-Host "  有 $failed 个文件失败，重跑脚本会只补这些。" -ForegroundColor DarkYellow }
}
# ---------- 整包模式（备用） ----------
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
                while ($job.JobState -in 'Connecting', 'Transferring', 'Queued') {
                    $mb = [Math]::Round($job.BytesTransferred / 1MB, 1)
                    Write-Progress -Activity "下载素材包（约 1 GB）" -Status ("已下载 {0} MB    用时 {1:mm\:ss}" -f $mb, ((Get-Date) - $t0))
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

if ($Mode -eq 'zip') {
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
        try { Install-FromZip $zip } catch { Write-Host "  解压失败: $($_.Exception.Message)" -ForegroundColor Red }
        $state = Get-AssetState
        Show-State $state
    }
}

if ($state.Missing.Count -gt 0) {
    Write-Step "下载素材"
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
