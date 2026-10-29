# ระบบติดตามตำแหน่ง GPS ผู้สวมใส่ แจ้งเตือนผู้ดูแลผ่าน LINE Official Account (LINE OA)
### สำหรับบอร์ด iLabs Challenger+ RP2350 NB-IoT ร่วมกับซิม 1NCE IoT SIM

ระบบส่งพิกัด GPS ของผู้สวมใส่อุปกรณ์ติดตาม (Wearable GPS Tracker) ไปยังผู้ดูแลผ่าน **LINE OA (LINE Messaging API Push Message)** โดยแบ่งการทำงานออกเป็น 3 โหมดตามเงื่อนไข:

| ลำดับ | เงื่อนไข (Condition) | ความถี่การส่ง (Interval) | รูปแบบการแจ้งเตือน (Status) |
| :---: | :--- | :---: | :--- |
| **1** | **GPS อยู่นิ่ง (Stationary)** | ทุก ๆ **2 ชั่วโมง** (7,200 วินาที) | 🟢 สถานะปกติ: อยู่นิ่งในบ้าน (ประหยัดพลังงาน & โควตาข้อความ) |
| **2** | **มีการเคลื่อนไหว (Moving)** | ทุก ๆ **2 นาที** (120 วินาที) | 🟡 สถานะ: ตรวจพบการเคลื่อนไหว |
| **3** | **ออกนอกเขต "บ้าน" (Geofence Alert)** | ทุก ๆ **30 วินาที** | 🔴 แจ้งเตือนฉุกเฉิน: ออกนอกเขตบ้านที่กำหนด พร้อมแผนที่ทันที |

---

## 🛰️ สเปกฮาร์ดแวร์และการเชื่อมต่อ

### 1. บอร์ด iLabs Challenger+ RP2350 NB-IoT
* **MCU:** Raspberry Pi **RP2350** (Dual ARM Cortex-M33 / Hazard3 RISC-V @ 150 MHz)
* **โมดูลเครือข่าย & พิกัด:** **STMicroelectronics ST87M01-1301**
  * รองรับเครือข่าย: **LTE Cat NB2 (NB-IoT)**
  * ระบบระบุพิกัดในตัว: **Concurrent GNSS (GPS L1 + Galileo)** มีชิปดาวเทียมในตัว ไม่ต้องต่อโมดูล GPS ภายนอกเพิ่ม!
* **ขั้วต่อเสาอากาศ (U.FL Connectors):** บอร์ดมีขั้ว U.FL 2 จุด:
  1. จุดที่ 1: **LTE / NB-IoT Antenna** (สำหรับส่งข้อมูลผ่านซิม)
  2. จุดที่ 2: **GNSS Antenna** (สำหรับรับสัญญาณดาวเทียม GPS)
  *(⚠️ ต้องต่อเสาอากาศให้ครบทั้งสองจุดเพื่อการรับสัญญาณที่ดี)*

### 2. ซิมการ์ด 1NCE IoT SIM
* **APN:** `iot.1nce.net`
* **Username / Password:** ปล่อยว่าง (ไม่ต้องใส่)
* **การเชื่อมต่อ:** โรมมิ่งบนโครงข่าย NB-IoT ในประเทศไทย (AIS NB-IoT หรือ True/dtac)

---

## 🏗️ โครงสร้างการทำงาน (Architecture)

เนื่องจาก **1NCE เป็นซิมประเภท NB-IoT (Narrowband IoT)** ซึ่งออกแบบมาเพื่อส่งข้อมูลขนาดเล็กและประหยัดพลังงาน:
- การให้บอร์ดส่งตรงไปที่ LINE OA โดยตรงจะต้องทำ TLS Handshake ขนาดใหญ่และส่ง JSON ก้อนโต ซึ่งจะทำให้เปลืองดาต้า (1NCE มี 500 MB ตลอด 10 ปี) และใช้เวลาเชื่อมต่อ 5–10 วินาที
- **สถาปัตยกรรมที่ดีที่สุด:** 
  1. บอร์ด **RP2350** ส่งพิกัด JSON ขนาดกะทัดรัด (ประมาณ 60–80 bytes) ผ่าน 1NCE NB-IoT ไปยัง **Backend Server (`server.js`)**
  2. **Backend Server** นำพิกัดมาประมวลผล Geofence และส่ง **LINE Flex Message** สีสันสวยงาม พร้อมปุ่มเปิด Google Maps ไปยังผู้ดูแลทันที!

```
+------------------------------------------+
|  iLabs Challenger+ RP2350 NB-IoT         |
|  - ST87M01 (GNSS รับพิกัดดาวเทียม)         |
|  - 1NCE SIM (APN: iot.1nce.net)          |
+------------------------------------------+
                    |
      [NB-IoT Cellular Link]
                    |
                    v
       +-------------------------+
       | Node.js Backend Server  |
       | (server.js @ Port 3000) |
       +-------------------------+
                    |
      [LINE Messaging API Push]
                    |
                    v
       +-------------------------+
       |   LINE Official Account |
       +-------------------------+
                    |
                    v
       +-------------------------+
       |    LINE ของผู้ดูแล      |
       |  (Flex Message + แผนที่)|
       +-------------------------+
```

---

## 📁 โครงสร้างโปรเจกต์

```
c:\Users\User\Documents\azm/
├── rp2350_nbiot_tracker/
│   └── rp2350_tracker.ino       # โค้ด Arduino สำหรับ iLabs Challenger+ RP2350 NB-IoT
├── backend_server/
│   ├── package.json             # โมดูล Node.js (express, @line/bot-sdk, axios)
│   ├── server.js                # เซิร์ฟเวอร์รับพิกัดจาก NB-IoT และยิง LINE OA Push Message
│   └── .env.example             # ไฟล์ตั้งค่า LINE Token และ พิกัดบ้าน
├── simulator/
│   ├── simulate_tracker.ps1     # สคริปต์จำลองทดสอบผ่าน PowerShell
│   └── simulate_tracker.py      # สคริปต์จำลองทดสอบผ่าน Python
└── README.md                    # คู่มือฉบับนี้
```

---

## 🚀 ขั้นตอนการติดตั้งและใช้งาน

### ขั้นตอนที่ 1: ตั้งค่าโปรแกรม Arduino IDE สำหรับ RP2350
1. ติดตั้ง **Arduino IDE** (เวอร์ชัน 2.x ขึ้นไป)
2. ไปที่ **File > Preferences** ในช่อง *Additional Boards Manager URLs* ให้เพิ่ม:
   ```text
   https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
   ```
3. ไปที่ **Tools > Board > Boards Manager** แล้วค้นหา `pico` กดติดตั้ง **Raspberry Pi Pico/RP2040/RP2350 by Earle F. Philhower**
4. เลือกบอร์ด: **Tools > Board > Raspberry Pi Pico/RP2350 > Invector Challenger+ RP2350 NB-IoT** (หรือ Raspberry Pi RP2350)
5. เปิดไฟล์ [`rp2350_tracker.ino`](file:///c:/Users/User/Documents/azm/rp2350_nbiot_tracker/rp2350_tracker.ino) 
   - แก้ไข `SERVER_HOST` ให้เป็น IP หรือ Domain ของเซิร์ฟเวอร์
   - ตรวจสอบ `HOME_LATITUDE`, `HOME_LONGITUDE`, และ `HOME_RADIUS_METERS`
6. เสียบสาย USB-C และกด Upload ไปยังบอร์ด

---

### ขั้นตอนที่ 2: รัน Backend Server เพื่อยิงแจ้งเตือน LINE OA
1. ไปที่โฟลเดอร์ `backend_server`:
   ```powershell
   cd c:\Users\User\Documents\azm\backend_server
   copy .env.example .env
   ```
2. เปิดไฟล์ `.env` กรอกค่าที่ได้จาก [LINE Developers Console](https://developers.line.biz/):
   - `LINE_CHANNEL_ACCESS_TOKEN` = โทเคนจากแท็บ Messaging API
   - `CAREGIVER_LINE_USER_ID` = User ID ของผู้ดูแล (ขึ้นต้นด้วย `U...`)
   - `HOME_LATITUDE` / `HOME_LONGITUDE` = พิกัดบ้าน
3. สั่งรันเซิร์ฟเวอร์:
   ```powershell
   npm install
   npm start
   ```

---

### ขั้นตอนที่ 3: ทดสอบการทำงาน (Simulation)
สามารถเปิดอีกหน้าต่าง Terminal แล้วรันสคริปต์เพื่อทดสอบการตอบสนองของระบบทั้ง 3 โหมดได้ทันที:
```powershell
cd c:\Users\User\Documents\azm\simulator
.\simulate_tracker.ps1
```
- ระบบจะจำลอง 3 เงื่อนไข: อยู่นิ่ง (2 ชม.), มีการเคลื่อนไหว (2 นาที), และเดินออกนอกบ้าน (30 วินาที) โดยแจ้งเตือนจะเด้งเข้า LINE OA ของผู้ดูแลทันที!

---

### ขั้นตอนที่ 4: การตั้งค่าแบบฟอร์มลงทะเบียนผู้ดูแลและแนวรั้วบ้าน (Google Apps Script Web App)
ระบบมีแบบฟอร์มให้ผู้ดูแลเปิดผ่านมือถือเพื่อลงทะเบียนรหัสเครื่อง GPS, ข้อมูลผู้ป่วย และวาดกรอบแนวรั้วบ้าน (Geofence):

1. **สคริปต์ส่งการ์ดฟอร์มเข้า LINE:**
   - รันสคริปต์ `send_form_to_all.ps1` เพื่อยิง Flex Message พร้อมปุ่มเปิดแบบฟอร์มไปยังผู้ดูแลทุกคน
2. **การตั้งค่าใน Google Apps Script (หากพบข้อผิดพลาด `ไม่พบฟังก์ชันของสคริปต์: doGet`):**
   - ไปที่โปรเจกต์ Google Apps Script ต้องมีทั้งไฟล์ `Code.gs` และ `form.html` (จากโฟลเดอร์ `google_apps_script/`)
   - กดปุ่ม **การทำให้ใช้งานได้ (Deploy)** > **จัดการการทำให้ใช้งานได้ (Manage deployments)**
   - กดรูปดินสอ **แก้ไข** > เลือกเวอร์ชันเป็น **เวอร์ชันใหม่ (New version)**
   - สิทธิ์การเข้าถึงเลือกเป็น **ทุกคน (Anyone)** แล้วกด **ทำให้ใช้งานได้ (Deploy)**

