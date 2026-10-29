"""
=============================================================================
สคริปต์จำลองการส่งข้อมูล GPS (Wearable GPS Tracker Simulator)
ใช้ทดสอบการทำงานของทั้ง 3 โหมด โดยส่งข้อมูลเข้า Backend Server
=============================================================================
"""

import time
import requests
import json
from datetime import datetime

SERVER_URL = "http://localhost:3000/api/telemetry"

# พิกัดบ้านอ้างอิง (ตรงกับใน Backend Server)
HOME_LAT = 13.756331
HOME_LNG = 100.501765

def send_telemetry(test_name, lat, lng, speed, battery=95):
    payload = {
        "deviceId": "SIMULATED_ESP32_01",
        "lat": lat,
        "lng": lng,
        "speed": speed,
        "battery": battery,
        "timestamp": int(time.time() * 1000)
    }
    
    print(f"\n==================================================")
    print(f"▶ กำลังทดสอบ: {test_name}")
    print(f"พิกัดส่ง: Lat {lat}, Lng {lng} | ความเร็ว: {speed} กม./ชม.")
    
    try:
        res = requests.post(SERVER_URL, json=payload, timeout=5)
        data = res.json()
        print(f"ผลตอบกลับจากเซิร์ฟเวอร์:")
        print(f" - โหมดที่ตรวจจับได้: {data.get('currentMode')}")
        print(f" - ระยะห่างจากบ้าน: {data.get('distanceFromHome')} เมตร")
        print(f" - ออกนอกเขตบ้านหรือไม่: {data.get('isOutsideHome')}")
        print(f" - ส่งข้อความ LINE หรือไม่: {data.get('notificationSent')}")
        print(f" - รอบเวลาส่งครั้งถัดไป: {data.get('nextIntervalSec')} วินาที")
    except Exception as e:
        print(f"เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: {e}")
        print("คำแนะนำ: กรุณาเปิดเซิร์ฟเวอร์ Node.js ก่อนรันสคริปต์นี้ (npm start ใน backend_server)")

if __name__ == "__main__":
    print("เริ่มการทดสอบจำลองพิกัด 3 โหมด...")

    # โหมด 1: อยู่นิ่งภายในบ้าน (Stationary) -> รอบส่ง 2 ชม. (7200s)
    send_telemetry("1. อยู่นิ่งภายในบ้าน (Stationary Mode)", HOME_LAT, HOME_LNG, speed=0.0)
    time.sleep(2)

    # โหมด 2: มีการเคลื่อนไหวในเขตบ้าน (Moving Mode) -> รอบส่ง 2 นาที (120s)
    send_telemetry("2. กำลังเคลื่อนไหวในบ้าน (Moving Mode)", HOME_LAT + 0.0001, HOME_LNG + 0.0001, speed=3.8)
    time.sleep(2)

    # โหมด 3: เดินออกนอกเขตบ้านเกิน 50 เมตร (Outside Geofence Mode) -> รอบส่ง 30 วินาที
    send_telemetry("3. เดินออกนอกเขตบ้าน (Outside Geofence Alert!)", HOME_LAT + 0.0020, HOME_LNG + 0.0020, speed=4.5)

