# =============================================================================
# Test Multi-Device and Multi-Caregiver Alert Card (ASCII Safe)
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

$headers = @{
    "Content-Type"  = "application/json; charset=UTF-8"
    "Authorization" = "Bearer $token"
}

$nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$lat = "13.758200"
$lng = "100.504500"
$mapsUrl = "https://www.google.com/maps?q=$lat,$lng"

$payload = @{
    to = $userId
    messages = @(
        @{
            type = "flex"
            altText = "Emergency: Grandpa Outside Home Geofence!"
            contents = @{
                type = "bubble"
                header = @{
                    type = "box"
                    layout = "vertical"
                    backgroundColor = "#D93025"
                    paddingAll = "15px"
                    contents = @(
                        @{
                            type = "text"
                            text = "EMERGENCY: OUTSIDE HOME AREA!"
                            weight = "bold"
                            color = "#FFFFFF"
                            size = "md"
                        }
                        @{
                            type = "text"
                            text = "Target: Grandpa (Device: TRACKER_01)"
                            size = "xs"
                            color = "#FFFFFF"
                            weight = "bold"
                            margin = "xs"
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
                                @{ type = "text"; text = "Wearer:"; size = "xs"; color = "#888888"; flex = 2 }
                                @{ type = "text"; text = "Grandpa (Elderly)"; size = "xs"; weight = "bold"; flex = 5 }
                            )
                        }
                        @{
                            type = "box"
                            layout = "horizontal"
                            contents = @(
                                @{ type = "text"; text = "Caregivers:"; size = "xs"; color = "#888888"; flex = 2 }
                                @{ type = "text"; text = "Phone 1 and Phone 2 (Both Alerted)"; size = "xs"; color = "#1E8E3E"; weight = "bold"; flex = 5 }
                            )
                        }
                        @{
                            type = "box"
                            layout = "horizontal"
                            contents = @(
                                @{ type = "text"; text = "Status:"; size = "xs"; color = "#888888"; flex = 2 }
                                @{ type = "text"; text = "OUTSIDE GEOFENCE (Alert!)"; size = "xs"; weight = "bold"; color = "#D93025"; flex = 5 }
                            )
                        }
                        @{
                            type = "box"
                            layout = "horizontal"
                            contents = @(
                                @{ type = "text"; text = "Distance:"; size = "xs"; color = "#888888"; flex = 2 }
                                @{ type = "text"; text = "320 meters (Safe radius: 50m)"; size = "xs"; flex = 5 }
                            )
                        }
                        @{
                            type = "box"
                            layout = "horizontal"
                            contents = @(
                                @{ type = "text"; text = "Interval:"; size = "xs"; color = "#888888"; flex = 2 }
                                @{ type = "text"; text = "Every 30 Seconds"; size = "xs"; flex = 5 }
                            )
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
                            color = "#D93025"
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

Write-Host "Multi-device and Multi-caregiver test card sent to LINE successfully!" -ForegroundColor Green
