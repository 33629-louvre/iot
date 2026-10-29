# =============================================================================
# Simulate All 3 Tracker Modes to Caregiver LINE OA (Pure ASCII Safe for PS 5.1)
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

if ([string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace($userId)) {
    Write-Host "[ERROR] Token or User ID missing in .env" -ForegroundColor Red
    exit 1
}

function Send-LineFlexMessage {
    param(
        [string]$HeaderTitle,
        [string]$HeaderColor,
        [string]$StatusText,
        [string]$IntervalText,
        [double]$Lat,
        [double]$Lng,
        [double]$Speed,
        [int]$DistanceHome
    )

    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $mapsUrl = "https://www.google.com/maps?q=$Lat,$Lng"

    $headers = @{
        "Content-Type"  = "application/json; charset=UTF-8"
        "Authorization" = "Bearer $token"
    }

    $flexJson = @{
        to = $userId
        messages = @(
            @{
                type = "flex"
                altText = "$HeaderTitle ($Lat, $Lng)"
                contents = @{
                    type = "bubble"
                    header = @{
                        type = "box"
                        layout = "vertical"
                        backgroundColor = $HeaderColor
                        paddingAll = "15px"
                        contents = @(
                            @{
                                type = "text"
                                text = $HeaderTitle
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
                                    @{ type = "text"; text = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("สถานะ:")); size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = $StatusText; size = "xs"; weight = "bold"; flex = 5 }
                                )
                            }
                            @{
                                type = "box"
                                layout = "horizontal"
                                contents = @(
                                    @{ type = "text"; text = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("วัน-เวลา:")); size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = $nowStr; size = "xs"; flex = 5 }
                                )
                            }
                            @{
                                type = "box"
                                layout = "horizontal"
                                contents = @(
                                    @{ type = "text"; text = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("พิกัด:")); size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = "$Lat, $Lng"; size = "xs"; flex = 5 }
                                )
                            }
                            @{
                                type = "box"
                                layout = "horizontal"
                                contents = @(
                                    @{ type = "text"; text = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("ห่างจากบ้าน:")); size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = "$DistanceHome " + [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("เมตร (รัศมี 50 ม.)")); size = "xs"; flex = 5 }
                                )
                            }
                            @{
                                type = "box"
                                layout = "horizontal"
                                contents = @(
                                    @{ type = "text"; text = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("ความเร็ว:")); size = "xs"; color = "#888888"; flex = 2 }
                                    @{ type = "text"; text = "$Speed " + [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("กม./ชม.")); size = "xs"; flex = 5 }
                                )
                            }
                            @{
                                type = "separator"
                                margin = "sm"
                            }
                            @{
                                type = "text"
                                text = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("รอบการส่ง: ")) + $IntervalText
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
                                color = $HeaderColor
                                height = "sm"
                                action = @{
                                    type = "uri"
                                    label = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("เปิดดูบน Google Maps"))
                                    uri = $mapsUrl
                                }
                            }
                        )
                    }
                }
            }
        )
    }

    $json = $flexJson | ConvertTo-Json -Depth 10
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    Invoke-RestMethod -Uri "https://api.line.me/v2/bot/message/push" -Method Post -Headers $headers -Body $bytes | Out-Null
}

Write-Host "Sending 3 test alert cards to LINE OA..." -ForegroundColor Cyan

# 1. Mode 1: Stationary (Green)
Write-Host "-> Mode 1: Stationary (Green)..." -ForegroundColor Green
$t1 = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("อยู่นิ่งตามปกติ"))
$s1 = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("อยู่นิ่งภายในบ้าน"))
$i1 = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("ส่งพิกัดทุก 2 ชั่วโมง"))
Send-LineFlexMessage -HeaderTitle $t1 -HeaderColor "#1E8E3E" -StatusText $s1 -IntervalText $i1 -Lat 13.756331 -Lng 100.501765 -Speed 0.0 -DistanceHome 5
Start-Sleep -Seconds 1

# 2. Mode 2: Moving (Yellow)
Write-Host "-> Mode 2: Moving (Yellow)..." -ForegroundColor Yellow
$t2 = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("ตรวจพบการเคลื่อนไหว"))
$s2 = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("กำลังเคลื่อนไหว"))
$i2 = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("ส่งพิกัดทุก 2 นาที"))
Send-LineFlexMessage -HeaderTitle $t2 -HeaderColor "#F9AB00" -StatusText $s2 -IntervalText $i2 -Lat 13.756450 -Lng 100.501900 -Speed 3.6 -DistanceHome 25
Start-Sleep -Seconds 1

# 3. Mode 3: Outside Geofence (Red)
Write-Host "-> Mode 3: Outside Home Alert (Red)..." -ForegroundColor Red
$t3 = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("ด่วน: ออกนอกเขตบ้าน!"))
$s3 = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("ออกนอกเขตบ้านที่กำหนด"))
$i3 = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes("ส่งพิกัดทุก 30 วินาที"))
Send-LineFlexMessage -HeaderTitle $t3 -HeaderColor "#D93025" -StatusText $s3 -IntervalText $i3 -Lat 13.758200 -Lng 100.504500 -Speed 4.2 -DistanceHome 320

Write-Host "ALL 3 MODES SENT SUCCESSFULLY!" -ForegroundColor Green
