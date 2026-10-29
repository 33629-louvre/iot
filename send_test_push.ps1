# =============================================================================
# Send All 3 Tracker Mode Cards to Caregiver LINE OA
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

function Send-Card {
    param(
        [string]$Title,
        [string]$Color,
        [string]$Status,
        [string]$Interval,
        [string]$Lat,
        [string]$Lng,
        [string]$Distance,
        [string]$Speed
    )

    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $mapsUrl = "https://www.google.com/maps?q=$Lat,$Lng"

    $headers = @{
        "Content-Type"  = "application/json; charset=UTF-8"
        "Authorization" = "Bearer $token"
    }

    $payload = @{
        to = $userId
        messages = @(
            @{
                type = "flex"
                altText = "$Title ($Lat, $Lng)"
                contents = @{
                    type = "bubble"
                    header = @{
                        type = "box"
                        layout = "vertical"
                        backgroundColor = $Color
                        paddingAll = "15px"
                        contents = @(
                            @{
                                type = "text"
                                text = $Title
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
                        paddingAll = "15px"
                        contents = @(
                            @{
                                type = "box"
                                layout = "horizontal"
                                contents = @(
                                    @{ type = "text"; text = "Status:"; size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = $Status; size = "xs"; weight = "bold"; flex = 5 }
                                )
                            }
                            @{
                                type = "box"
                                layout = "horizontal"
                                contents = @(
                                    @{ type = "text"; text = "Date-Time:"; size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = $nowStr; size = "xs"; flex = 5 }
                                )
                            }
                            @{
                                type = "box"
                                layout = "horizontal"
                                contents = @(
                                    @{ type = "text"; text = "GPS Lat/Lng:"; size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = "$Lat, $Lng"; size = "xs"; flex = 5 }
                                )
                            }
                            @{
                                type = "box"
                                layout = "horizontal"
                                contents = @(
                                    @{ type = "text"; text = "Distance:"; size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = "$Distance (Home Radius 50m)"; size = "xs"; flex = 5 }
                                )
                            }
                            @{
                                type = "box"
                                layout = "horizontal"
                                contents = @(
                                    @{ type = "text"; text = "Speed:"; size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = "$Speed km/h"; size = "xs"; flex = 5 }
                                )
                            }
                            @{
                                type = "separator"
                                margin = "sm"
                            }
                            @{
                                type = "text"
                                text = "Interval Mode: $Interval"
                                size = "xxs"
                                color = "#999999"
                            }
                        )
                    }
                    footer = @{
                        type = "box"
                        layout = "vertical"
                        paddingAll = "12px"
                        contents = @(
                            @{
                                type = "button"
                                style = "primary"
                                color = $Color
                                height = "sm"
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

    $json = $payload | ConvertTo-Json -Depth 10
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    Invoke-RestMethod -Uri "https://api.line.me/v2/bot/message/push" -Method Post -Headers $headers -Body $bytes | Out-Null
}

Write-Host "Sending 3 alert cards to LINE OA..." -ForegroundColor Cyan

# 1. Mode 1: Stationary (Every 2 Hours)
Write-Host "[1/3] Mode 1: Stationary Inside Home (Green - Every 2 Hours)..." -ForegroundColor Green
Send-Card -Title "Normal: Stationary at Home" -Color "#1E8E3E" -Status "Stationary (Inside Home)" -Interval "Every 2 Hours" -Lat "13.756331" -Lng "100.501765" -Distance "5 meters" -Speed "0.0"
Start-Sleep -Seconds 1

# 2. Mode 2: Moving (Every 2 Minutes)
Write-Host "[2/3] Mode 2: Moving Detected (Yellow - Every 2 Minutes)..." -ForegroundColor Yellow
Send-Card -Title "Notice: Movement Detected" -Color "#F9AB00" -Status "Moving (Active)" -Interval "Every 2 Minutes" -Lat "13.756450" -Lng "100.501900" -Distance "25 meters" -Speed "3.6"
Start-Sleep -Seconds 1

# 3. Mode 3: Outside Geofence (Every 30 Seconds)
Write-Host "[3/3] Mode 3: Outside Home Geofence (Red Alert - Every 30 Seconds)..." -ForegroundColor Red
Send-Card -Title "EMERGENCY: Outside Home Area!" -Color "#D93025" -Status "OUTSIDE GEOFENCE!" -Interval "Every 30 Seconds" -Lat "13.758200" -Lng "100.504500" -Distance "320 meters" -Speed "4.5"

Write-Host "`nSUCCESS: All 3 alert cards sent to your LINE app!" -ForegroundColor Green

