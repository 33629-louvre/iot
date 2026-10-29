$token = "UN4DnMZuwSyGTI1BaYYdwDPBvy8Iq+MQ6zhl3DPpmbw/d5GbMbTaHaee6DUFRGL5pfID+axOtqURn3gvT/eJqSDQ69K3RQwPs1p2Z5apaS3wriVYJqhYByELcs/2f/Yy4fSL8iWxLdUX3xvMEy6BugdB04t89/1O/w1cDnyilFU="
$userId = "U1664630158334b37fcdac10318ee0d4e"

$headers = @{
    "Content-Type"  = "application/json; charset=UTF-8"
    "Authorization" = "Bearer $token"
}

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

# จำลองส่ง 3 ครั้ง ทุก 30 วินาที
for ($i = 1; $i -le 3; $i++) {
    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $lat = (13.758200 + ($i * 0.000100)).ToString("F6")
    $lng = (100.504500 + ($i * 0.000150)).ToString("F6")
    $dist = 300 + ($i * 35)
    $mapsUrl = "https://www.google.com/maps?q=$lat,$lng"

    $flexMessage = @{
        type = "flex"
        altText = "🚨 แจ้งเตือนรอบที่ $($i): คุณตา ออกนอกเขตบ้าน! (ทุก 30 วินาที)"
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
                        text = "🚨 ด่วน: ออกนอกเขตบ้าน! [รอบที่ $i/3]"
                        weight = "bold"
                        color = "#FFFFFF"
                        size = "md"
                    }
                    @{
                        type = "text"
                        text = "👤 ผู้สวมใส่: คุณตา (เครื่อง GPS-01)"
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
                            @{ type = "text"; text = "สถานะ:"; size = "xs"; color = "#888888"; flex = 2 }
                            @{ type = "text"; text = "🔴 ออกนอกเขตบ้าน (30s/ครั้ง)"; size = "xs"; weight = "bold"; color = "#D93025"; flex = 5 }
                        )
                    }
                    @{
                        type = "box"
                        layout = "horizontal"
                        contents = @(
                            @{ type = "text"; text = "สายรัดแขน:"; size = "xs"; color = "#888888"; flex = 2 }
                            @{ type = "text"; text = "🔊 เสียง Buzzer กำลังร้องเตือน"; size = "xs"; weight = "bold"; color = "#E37400"; flex = 5 }
                        )
                    }
                    @{
                        type = "box"
                        layout = "horizontal"
                        contents = @(
                            @{ type = "text"; text = "ระยะห่าง:"; size = "xs"; color = "#888888"; flex = 2 }
                            @{ type = "text"; text = "$dist เมตร (กำลังเดินห่างออกไป)"; size = "xs"; flex = 5 }
                        )
                    }
                    @{
                        type = "box"
                        layout = "horizontal"
                        contents = @(
                            @{ type = "text"; text = "วัน-เวลา:"; size = "xs"; color = "#888888"; flex = 2 }
                            @{ type = "text"; text = $nowStr; size = "xs"; flex = 5 }
                        )
                    }
                    @{
                        type = "separator"
                        margin = "sm"
                    }
                    @{
                        type = "text"
                        text = "⏱️ ระบบจะส่งแจ้งเตือนซ้ำทุก ๆ 30 วินาที จนกว่าผู้ดูแลจะกดปุ่มสีเขียวด้านล่าง"
                        size = "xxs"
                        color = "#555555"
                        wrap = $true
                    }
                )
            }
            footer = @{
                type = "box"
                layout = "vertical"
                spacing = "sm"
                paddingAll = "12px"
                contents = @(
                    @{
                        type = "button"
                        style = "primary"
                        color = "#D93025"
                        height = "sm"
                        action = @{
                            type = "uri"
                            label = "🗺️ นำทางด้วย Google Maps"
                            uri = $mapsUrl
                        }
                    }
                    @{
                        type = "button"
                        style = "primary"
                        color = "#2E7D32"
                        height = "sm"
                        action = @{
                            type = "postback"
                            label = "🛑 พบตัวแล้ว (ปิดเสียง & พักระบบ)"
                            data = "action=mute_alert&deviceId=TRACKER_01"
                            displayText = "ฉันพบตัวคุณตาแล้ว ขอปิดเสียงและพักระบบติดตาม"
                        }
                    }
                )
            }
        }
    }

    $payload = @{
        to = $userId
        messages = @($flexMessage)
    }

    $json = $payload | ConvertTo-Json -Depth 10
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

    try {
        Invoke-RestMethod -Uri "https://api.line.me/v2/bot/message/push" -Method Post -Headers $headers -Body $bytes | Out-Null
        Write-Host "[$i/3] ส่งแจ้งเตือนฉุกเฉินรอบที่ $i สำเร็จ! (เวลา: $nowStr)" -ForegroundColor Green
    } catch {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }

    if ($i -lt 3) {
        Write-Host "กำลังรอ 30 วินาที สำหรับรอบถัดไป..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
    }
}

Write-Host "ส่งครบ 3 รอบ (30 วินาที) เรียบร้อยแล้ว!" -ForegroundColor Cyan
