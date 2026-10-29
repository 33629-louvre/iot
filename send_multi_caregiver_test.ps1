$token = "UN4DnMZuwSyGTI1BaYYdwDPBvy8Iq+MQ6zhl3DPpmbw/d5GbMbTaHaee6DUFRGL5pfID+axOtqURn3gvT/eJqSDQ69K3RQwPs1p2Z5apaS3wriVYJqhYByELcs/2f/Yy4fSL8iWxLdUX3xvMEy6BugdB04t89/1O/w1cDnyilFU="
$caregivers = @(
    "U1664630158334b37fcdac10318ee0d4e",
    "U8af540fcc48dcc553f87d88aed55bab4"
)

$nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$lat = "13.758200"
$lng = "100.504500"
$mapsUrl = "https://www.google.com/maps?q=$lat,$lng"

$headers = @{
    "Content-Type"  = "application/json; charset=UTF-8"
    "Authorization" = "Bearer $token"
}

$flexMessage = @{
    type = "flex"
    altText = "🚨 แจ้งเตือนด่วน: คุณตา ออกนอกเขตบ้าน!"
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
                    text = "🚨 ด่วน: ออกนอกเขตบ้าน!"
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
                        @{ type = "text"; text = "อุปกรณ์:"; size = "xs"; color = "#888888"; flex = 2 }
                        @{ type = "text"; text = "GPS ติดตามตัว (คุณตา)"; size = "xs"; weight = "bold"; flex = 5 }
                    )
                }
                @{
                    type = "box"
                    layout = "horizontal"
                    contents = @(
                        @{ type = "text"; text = "ผู้ดูแล:"; size = "xs"; color = "#888888"; flex = 2 }
                        @{ type = "text"; text = "ส่งเข้ามือถือทั้ง 2 เครื่องพร้อมกัน"; size = "xs"; color = "#1E8E3E"; weight = "bold"; flex = 5 }
                    )
                }
                @{
                    type = "box"
                    layout = "horizontal"
                    contents = @(
                        @{ type = "text"; text = "สถานะ:"; size = "xs"; color = "#888888"; flex = 2 }
                        @{ type = "text"; text = "🔴 ออกนอกเขตบ้าน (ฉุกเฉิน)"; size = "xs"; weight = "bold"; color = "#D93025"; flex = 5 }
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
                    type = "box"
                    layout = "horizontal"
                    contents = @(
                        @{ type = "text"; text = "พิกัด:"; size = "xs"; color = "#888888"; flex = 2 }
                        @{ type = "text"; text = "$lat, $lng"; size = "xs"; flex = 5 }
                    )
                }
                @{
                    type = "box"
                    layout = "horizontal"
                    contents = @(
                        @{ type = "text"; text = "ระยะห่าง:"; size = "xs"; color = "#888888"; flex = 2 }
                        @{ type = "text"; text = "320 เมตร (รัศมีบ้าน 50 ม.)"; size = "xs"; flex = 5 }
                    )
                }
                @{
                    type = "separator"
                    margin = "sm"
                }
                @{
                    type = "text"
                    text = "⏱️ โหมดส่งข้อมูล: ส่งทุก 30 วินาทีเข้ามือถือผู้ดูแลทั้ง 2 เครื่อง"
                    size = "xxs"
                    color = "#888888"
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
                        label = "🗺️ เปิดดูบน Google Maps"
                        uri = $mapsUrl
                    }
                }
            )
        }
    }
}

$payload = @{
    to = $caregivers
    messages = @($flexMessage)
}

$json = $payload | ConvertTo-Json -Depth 10
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

Write-Host "กำลังส่ง LINE Multicast ไปยังผู้ดูแลทั้ง 2 เครื่องพร้อมกัน..." -ForegroundColor Cyan
Write-Host " - เครื่องที่ 1: $($caregivers[0])"
Write-Host " - เครื่องที่ 2: $($caregivers[1])"

try {
    # LINE Multicast Endpoint สำหรับส่งหลายคนพร้อมกัน
    $res = Invoke-RestMethod -Uri "https://api.line.me/v2/bot/message/multicast" -Method Post -Headers $headers -Body $bytes
    Write-Host "`n✅ ส่งสำเร็จพร้อมกันทั้ง 2 เครื่องเรียบร้อยแล้ว!" -ForegroundColor Green
} catch {
    Write-Host "`n❌ Multicast Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "รายละเอียดจาก LINE: $($_.ErrorDetails.Message)" -ForegroundColor Yellow
    }
}
