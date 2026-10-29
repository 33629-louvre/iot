# =============================================================================
# สคริปต์จำลองการส่งข้อมูล GPS สำหรับ PowerShell (Windows Native)
# รันได้ทันทีโดยไม่ต้องลง Python หรือไลบรารีเสริม
# =============================================================================

$ServerUrl = "http://localhost:3000/api/telemetry"
$HomeLat = 13.756331
$HomeLng = 100.501765

function Send-Telemetry {
    param(
        [string]$TestTitle,
        [double]$Lat,
        [double]$Lng,
        [double]$Speed
    )

    Write-Host "`n==================================================" -ForegroundColor Cyan
    Write-Host "▶ ทดสอบ: $TestTitle" -ForegroundColor Yellow
    Write-Host "พิกัด: Lat $Lat, Lng $Lng | ความเร็ว: $Speed km/h"

    $body = @{
        deviceId = "SIM_POWERSHELL_01"
        lat = $Lat
        lng = $Lng
        speed = $Speed
        battery = 98
        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $ServerUrl -Method Post -Body $body -ContentType "application/json" -TimeoutSec 5
        Write-Host "ผลตอบกลับ:" -ForegroundColor Green
        Write-Host " - โหมดที่ตรวจจับได้: $($response.currentMode)"
        Write-Host " - ระยะห่างจากบ้าน: $($response.distanceFromHome) เมตร"
        Write-Host " - ออกนอกเขตบ้าน: $($response.isOutsideHome)"
        Write-Host " - ส่งข้อความ LINE: $($response.notificationSent)"
        Write-Host " - รอบการส่งครั้งถัดไป: $($response.nextIntervalSec) วินาที"
    } catch {
        Write-Host "❌ เกิดข้อผิดพลาดในการเชื่อมต่อไปยัง $ServerUrl" -ForegroundColor Red
        Write-Host "กรุณาตรวจสอบว่า backend_server รันอยู่หรือไม่ (npm start ใน backend_server)"
    }
}

Write-Host "เริ่มทดสอบจำลองส่งพิกัด GPS ทั้ง 3 โหมด..." -ForegroundColor Green

# 1. อยู่นิ่งภายในบ้าน
Send-Telemetry -TestTitle "1. GPS อยู่นิ่งภายในบ้าน (โหมด 2 ชั่วโมง)" -Lat $HomeLat -Lng $HomeLng -Speed 0.0
Start-Sleep -Seconds 2

# 2. มีการเคลื่อนไหว
Send-Telemetry -TestTitle "2. มีการเคลื่อนไหวในเขตบ้าน (โหมด 2 นาที)" -Lat ($HomeLat + 0.0001) -Lng ($HomeLng + 0.0001) -Speed 3.5
Start-Sleep -Seconds 2

# 3. ออกนอกเขตบ้าน
Send-Telemetry -TestTitle "3. ตรวจพบว่าออกจากเขตบ้าน (โหมดฉุกเฉิน 30 วินาที)" -Lat ($HomeLat + 0.0020) -Lng ($HomeLng + 0.0020) -Speed 4.2

