# =============================================================================
# Launcher Script: GPS Tracker Admin Back-Office System
# PowerShell 5.1 Safe
# =============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  GPS Tracker - Admin Central Dashboard Launcher     " -ForegroundColor Yellow
Write-Host "=====================================================" -ForegroundColor Cyan

$CurrentDir = $PSScriptRoot
if (-not $CurrentDir) {
    $CurrentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $CurrentDir) {
    $CurrentDir = Get-Location
}

$AdminUrl = "http://localhost:3000/admin"
$BackendDir = Join-Path $CurrentDir "backend_server"

# 1. Detect Working Runtime (Node.js or Python)
$RuntimeType = $null
$RuntimeExe = $null
$ScriptToRun = $null

# Check Node.js
try {
    $nodeVer = & node -v 2>$null
    if ($nodeVer -match "^v\d+") {
        $RuntimeType = "Node.js"
        $RuntimeExe = "node"
        $ScriptToRun = "server.js"
    }
} catch {}

# Check Thonny Python
$thonnyPy = "C:\Users\User\AppData\Local\Programs\Thonny\python.exe"
if (-not $RuntimeType -and (Test-Path $thonnyPy)) {
    $RuntimeType = "Python"
    $RuntimeExe = $thonnyPy
    $ScriptToRun = "server.py"
}

# Check System Python
if (-not $RuntimeType) {
    try {
        $pyCheck = & python -c "print('OK')" 2>$null
        if ($pyCheck -eq "OK") {
            $RuntimeType = "Python"
            $RuntimeExe = "python"
            $ScriptToRun = "server.py"
        }
    } catch {}
}

if (-not $RuntimeType) {
    Write-Host "[WARNING] Node.js or Python runtime was not found." -ForegroundColor Yellow
    Write-Host "[INFO] Opening Admin Dashboard in Standalone Browser Mode..." -ForegroundColor Cyan
    Start-Process (Join-Path $CurrentDir "admin_dashboard\index.html")
    exit 0
}

# 2. Kill any stale process on Port 3000 before starting
try {
    $existingConns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($existingConns) {
        $oldPids = $existingConns | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($oldPid in $oldPids) {
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 600
    }
} catch {}

Write-Host "[INFO] Starting Backend Server ($RuntimeType - $ScriptToRun)..." -ForegroundColor Green
$ServerProc = Start-Process -FilePath $RuntimeExe -ArgumentList $ScriptToRun -WorkingDirectory $BackendDir -PassThru -NoNewWindow

Start-Sleep -Seconds 2

Write-Host "[INFO] Opening Admin Dashboard: $AdminUrl" -ForegroundColor Cyan
Start-Process $AdminUrl

Write-Host ""
Write-Host "[SUCCESS] Admin System is now RUNNING at $AdminUrl" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Gray
Write-Host ""

try {
    $ServerProc.WaitForExit()
} finally {
    if ($ServerProc -and -not $ServerProc.HasExited) {
        Stop-Process -Id $ServerProc.Id -Force -ErrorAction SilentlyContinue
    }
}
