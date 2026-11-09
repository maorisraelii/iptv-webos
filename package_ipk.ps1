param(
    [string]$Device = ""
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   IPTV Live TV - LG webOS IPK Packager" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Clean & Prepare dist directory
Write-Host "`n[1/3] Preparing clean app bundle..." -ForegroundColor Green
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
New-Item -ItemType Directory -Path "dist" | Out-Null

Copy-Item "index.html", "appinfo.json", "app-config.json", "icon.png", "largeIcon.png" -Destination "dist"
Copy-Item -Recurse "css", "js" -Destination "dist"

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
