# =============================================================================
# Line OA Push Test Script (PowerShell 5.1 Safe)
# =============================================================================

$envFile = "c:\Users\User\Documents\azm\backend_server\.env"

$token = ""
$userId = ""

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^LINE_CHANNEL_ACCESS_TOKEN=(.+)$") { $token = $matches[1].Trim() }
        if ($_ -match "^CAREGIVER_LINE_USER_ID=(.+)$") { $userId = $matches[1].Trim() }
    }
}

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "[ERROR] LINE_CHANNEL_ACCESS_TOKEN is missing in .env" -ForegroundColor Red
    exit 1
}

if ([string]::IsNullOrWhiteSpace($userId)) {
    Write-Host "[ERROR] CAREGIVER_LINE_USER_ID is missing in .env" -ForegroundColor Red
    exit 1
}

Write-Host "Target User ID: $userId" -ForegroundColor Cyan
Write-Host "Sending test push message to LINE..." -ForegroundColor Yellow

$nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$lat = "13.756331"
$lng = "100.501765"
$mapsUrl = "https://www.google.com/maps?q=$lat,$lng"

$headers = @{
    "Content-Type"  = "application/json; charset=UTF-8"
    "Authorization" = "Bearer $token"
}

$payloadObj = @{
    to = $userId
    messages = @(
        @{
            type = "flex"
            altText = "GPS Tracker Test Notification"
            contents = @{
                type = "bubble"
                header = @{
                    type = "box"
                    layout = "vertical"
                    backgroundColor = "#1E8E3E"
                    contents = @(
                        @{
                            type = "text"
                            text = "GPS Tracker - System Connected!"
                            weight = "bold"
                            color = "#FFFFFF"
                            size = "md"
                        }
                    )
                }
                body = @{
                    type = "box"
                    layout = "vertical"
                    spacing = "sm"
                    contents = @(
                        @{ type = "text"; text = "Status: READY (Challenger+ RP2350)"; size = "xs"; weight = "bold" }
                        @{ type = "text"; text = "Date-Time: $nowStr"; size = "xs"; color = "#555555" }
                        @{ type = "text"; text = "GPS Lat/Lng: $lat, $lng"; size = "xs"; color = "#555555" }
                        @{ type = "text"; text = "Network: 1NCE NB-IoT"; size = "xs"; color = "#555555" }
                    )
                }
                footer = @{
                    type = "box"
                    layout = "vertical"
                    contents = @(
                        @{
                            type = "button"
                            style = "primary"
                            color = "#1E8E3E"
                            action = @{
                                type = "uri"
                                label = "Open Google Maps"
                                uri = $mapsUrl
                            }
                        }
                    )
                }
            }
        }
    )
}

$body = $payloadObj | ConvertTo-Json -Depth 10

# Ensure UTF-8 bytes for request
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

try {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    $response = Invoke-RestMethod -Uri "https://api.line.me/v2/bot/message/push" -Method Post -Headers $headers -Body $bytes
    Write-Host "`nSUCCESS: Test message sent successfully to your LINE app!" -ForegroundColor Green
} catch {
    Write-Host "`nERROR occurred:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    if ($_.ErrorDetails.Message) {
        Write-Host "LINE API details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}
