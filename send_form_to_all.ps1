$token = "UN4DnMZuwSyGTI1BaYYdwDPBvy8Iq+MQ6zhl3DPpmbw/d5GbMbTaHaee6DUFRGL5pfID+axOtqURn3gvT/eJqSDQ69K3RQwPs1p2Z5apaS3wriVYJqhYByELcs/2f/Yy4fSL8iWxLdUX3xvMEy6BugdB04t89/1O/w1cDnyilFU="
$caregivers = @(
    "U1664630158334b37fcdac10318ee0d4e", # ผู้ดูแลคนที่ 1 (ของคุณ)
    "U8af540fcc48dcc553f87d88aed55bab4"  # ผู้ดูแลคนที่ 2 (ของเพื่อน)
)

$headers = @{
    "Content-Type"  = "application/json; charset=UTF-8"
    "Authorization" = "Bearer $token"
}

# ลิงก์สำหรับเปิดแบบฟอร์ม (เติม ?openExternalBrowser=1 เพื่อให้เปิดใน Chrome/Safari บนมือถือได้ทันที ไม่ติดหน้าขาวใน LINE)
$formUrl = "https://script.google.com/macros/s/AKfycbwdNLK2VmcznQ9beF9dgV6tKbPZicYgBio1gJ-N4e8CYWfKlq_Y4Np72AhN1MVh7Ao3/exec?openExternalBrowser=1"

$flexMessage = @{
    type = "flex"
    altText = "📋 แบบฟอร์มลงทะเบียนและผูกข้อมูลผู้ป่วย (สำหรับผู้ดูแลทุกคน)"
    contents = @{
        type = "bubble"
        header = @{
            type = "box"
            layout = "vertical"
            backgroundColor = "#1A73E8"
            paddingAll = "16px"
            contents = @(
                @{
                    type = "text"
                    text = "📋 ลงทะเบียนเครื่องติดตาม GPS"
                    weight = "bold"
                    color = "#FFFFFF"
                    size = "md"
                }
                @{
                    type = "text"
                    text = "กรุณากรอกข้อมูลเพื่อผูกผู้ดูแลและแนวรั้วบ้าน"
                    size = "xs"
                    color = "#E8F0FE"
                    margin = "xs"
                }
            )
        }
        body = @{
            type = "box"
            layout = "vertical"
            spacing = "sm"
            paddingAll = "16px"
            contents = @(
                @{
                    type = "text"
                    text = "เรียน ท่านผู้ดูแลทุกท่าน 👋"
                    weight = "bold"
                    size = "sm"
                    color = "#202124"
                }
                @{
                    type = "text"
                    text = "เพื่อให้ระบบติดตามทำงานได้อย่างถูกต้องและแม่นยำ กรุณาเปิดแบบฟอร์มเพื่อตั้งค่า:"
                    size = "xs"
                    color = "#5F6368"
                    wrap = $true
                }
                @{
                    type = "box"
                    layout = "vertical"
                    margin = "md"
                    spacing = "xs"
                    contents = @(
                        @{ type = "text"; text = "1. 🏷️ รหัสเครื่อง GPS ประจำตัว"; size = "xs"; color = "#1A73E8" }
                        @{ type = "text"; text = "2. 👤 ชื่อผู้ป่วย / ผู้สวมใส่"; size = "xs"; color = "#1A73E8" }
                        @{ type = "text"; text = "3. 🏡 ตีกรอบแนวรั้วบ้านบนแผนที่"; size = "xs"; color = "#1A73E8" }
                        @{ type = "text"; text = "4. 🔊 ตั้งค่าเสียงเตือน Buzzer สายรัดแขน"; size = "xs"; color = "#1A73E8" }
                    )
                }
                @{
                    type = "separator"
                    margin = "md"
                }
                @{
                    type = "text"
                    text = "💡 เมื่อกรอกเสร็จ ข้อมูลจะผูกเข้ากับระบบอัตโนมัติทันที"
                    size = "xxs"
                    color = "#888888"
                }
            )
        }
        footer = @{
            type = "box"
            layout = "vertical"
            paddingAll = "14px"
            contents = @(
                @{
                    type = "button"
                    style = "primary"
                    color = "#1A73E8"
                    height = "sm"
                    action = @{
                        type = "uri"
                        label = "📝 เปิดแบบฟอร์มลงทะเบียน"
                        uri = $formUrl
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

Write-Host "กำลังส่งแบบฟอร์มลงทะเบียนไปยังผู้ดูแลทุกคน ($($caregivers.Count) เครื่อง)..." -ForegroundColor Cyan

try {
    $res = Invoke-RestMethod -Uri "https://api.line.me/v2/bot/message/multicast" -Method Post -Headers $headers -Body $bytes
    Write-Host "✅ ส่งแบบฟอร์มถึงผู้ดูแลทุกคนเรียบร้อยแล้ว!" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

