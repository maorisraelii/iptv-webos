<#
.SYNOPSIS
    אריזת אפליקציית Live TV לקובץ IPK והתקנה אוטומטית על טלוויזיית LG webOS
#>

param(
    [string]$Device = ""
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   📺 IPTV Live TV - LG webOS IPK Packager" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Package IPK
Write-Host "`n[1/3] Packaging webOS App..." -ForegroundColor Green
$packageCmd = "npx ares-package -n -e node_modules -e package-lock.json -e server.js -e .git -e .github ."
Invoke-Expression $packageCmd

$ipkFiles = Get-ChildItem -Filter "com.iptv.livetv_*.ipk" | Sort-Object LastWriteTime -Descending
if ($ipkFiles.Count -eq 0) {
    Write-Host "`n❌ Error: Failed to generate .ipk file!" -ForegroundColor Red
    exit 1
}

$latestIpk = $ipkFiles[0].Name
Copy-Item $latestIpk -Destination "IPTV-Live-webOS.ipk" -Force
Write-Host "✔ Package created successfully: $latestIpk (and IPTV-Live-webOS.ipk)" -ForegroundColor Green

# 2. Check for connected LG devices
Write-Host "`n[2/3] Checking connected webOS TV devices..." -ForegroundColor Green
$devicesOutput = npx ares-setup-device -l 2>&1

Write-Host $devicesOutput

# 3. Optional Direct Install
if ($Device -ne "") {
    Write-Host "`n[3/3] Installing to TV device '$Device'..." -ForegroundColor Green
    npx ares-install $latestIpk -d $Device
} else {
    Write-Host "`n💡 Tip: To install directly to your TV, run:" -ForegroundColor Yellow
    Write-Host "   .\package_ipk.ps1 -Device <TV_DEVICE_NAME>" -ForegroundColor White
    Write-Host "Or drag and drop '$latestIpk' into webOS Dev Manager!" -ForegroundColor Cyan
}

Write-Host "`n✔ All done!" -ForegroundColor Green
