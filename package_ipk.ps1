param(
    [string]$Device = ""
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   IPTV Live TV - LG webOS IPK Packager" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Clean & Prepare dist directory
Write-Host "`n[1/3] Preparing clean app bundle & building full OTA runtime manifest..." -ForegroundColor Green
node .\scripts\build-ota-manifest.js
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
New-Item -ItemType Directory -Path "dist" | Out-Null

Copy-Item "index.html", "manager.html", "remote.html", "ota-manifest.json", "epg-il.xml", "appinfo.json", "app-config.json", "icon.png", "largeIcon.png" -Destination "dist"
Copy-Item -Recurse "css", "js" -Destination "dist"

# Sync OTA Manifest, Live EPG & Remote Portal to Public Cloud Gist if gh is available
if (Get-Command gh -ErrorAction SilentlyContinue) {
    $otaChannel = "stable"
    if (Test-Path "app-config.json") {
        try {
            $cfg = Get-Content "app-config.json" -Raw | ConvertFrom-Json
            if ($cfg -and $cfg.channel -eq "beta") { $otaChannel = "beta" }
        } catch {}
    }

    if ($otaChannel -eq "beta") {
        Write-Host "`n[OTA] Syncing Beta ota-manifest-beta.json to Cloud OTA Gist (preserving Stable manifest)..." -ForegroundColor Cyan
        $tempBeta = Join-Path $env:TEMP "ota-manifest-beta.json"
        Copy-Item "ota-manifest.json" -Destination $tempBeta -Force
        gh gist edit b4408ca1c31143ed2f50164629f53f1c --filename ota-manifest-beta.json $tempBeta 2>$null
        if ($LASTEXITCODE -ne 0) {
            gh gist edit b4408ca1c31143ed2f50164629f53f1c --add $tempBeta 2>$null
        }
        Remove-Item $tempBeta -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "`n[OTA] Syncing ota-manifest.json, epg-il.xml & remote.html to Cloud OTA Gist..." -ForegroundColor Cyan
        gh gist edit b4408ca1c31143ed2f50164629f53f1c --filename ota-manifest.json ota-manifest.json 2>$null
        gh gist edit b4408ca1c31143ed2f50164629f53f1c --filename epg-il.xml epg-il.xml 2>$null
        gh gist edit b4408ca1c31143ed2f50164629f53f1c --filename remote.html remote.html 2>$null
    }
}

# 2. Package IPK
Write-Host "`n[2/3] Packaging webOS App with @webos-tools/cli..." -ForegroundColor Green
npx ares-package -n dist

$ipkFiles = Get-ChildItem -Filter "com.iptv.livetv_*.ipk" | Sort-Object LastWriteTime -Descending
if ($ipkFiles.Count -eq 0) {
    Write-Host "`n[ERROR] Failed to generate .ipk file!" -ForegroundColor Red
    exit 1
}

$latestIpk = $ipkFiles[0].Name
Copy-Item $latestIpk -Destination "IPTV-Live-webOS.ipk" -Force
if ($latestIpk -ne "com.iptv.livetv_1.0.0_all.ipk") {
    Copy-Item $latestIpk -Destination "com.iptv.livetv_1.0.0_all.ipk" -Force
}
Write-Host "[OK] Package created: $latestIpk -> IPTV-Live-webOS.ipk" -ForegroundColor Green

# 3. Optional Direct Install
if ($Device -ne "") {
    Write-Host "`n[3/3] Installing to TV device '$Device'..." -ForegroundColor Green
    npx ares-install $latestIpk -d $Device
} else {
    Write-Host "`nTip: To install directly to your TV, run:" -ForegroundColor Yellow
    Write-Host "   .\package_ipk.ps1 -Device tv" -ForegroundColor White
    Write-Host "Or install '$latestIpk' via webOS Dev Manager!" -ForegroundColor Cyan
}

Write-Host "`nDone!" -ForegroundColor Green
