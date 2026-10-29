/**
 * =============================================================================
 * Backend Server: Wearable GPS Tracker with LINE Official Account (LINE OA)
 * =============================================================================
 * คุณสมบัติ:
 * 1. รับพิกัด GPS จากอุปกรณ์สวมใส่ (ESP32 / 4G GPS Tracker / Mobile App)
 * 2. ตรวจสอบ 3 โหมดตามเงื่อนไข:
 *    - โหมด 1: อยู่นิ่ง -> แจ้งเตือนทุก 2 ชั่วโมง
 *    - โหมด 2: มีการเคลื่อนไหว -> แจ้งเตือนทุก 2 นาที
 *    - โหมด 3: ออกนอกเขตบ้าน -> แจ้งเตือนทุก 30 วินาที
 * 3. ส่งข้อความแจ้งเตือนเข้า LINE OA ของผู้ดูแลผ่าน LINE Messaging API
 * 4. รองรับ LINE Webhook: ให้ผู้ดูแลแชร์ Location ใน LINE เพื่อตั้ง "พิกัดบ้าน" ได้ทันที!
 * =============================================================================
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// -----------------------------------------------------------------------------
// ค่า Config เริ่มต้น (ดึงจาก .env หรือค่า Default)
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
let CAREGIVER_LINE_USER_ID = process.env.CAREGIVER_LINE_USER_ID || '';

// การตั้งค่าพิกัดบ้าน (ผู้ดูแลสามารถอัปเดตได้แบบ Dynamic)
let homeConfig = {
  latitude: parseFloat(process.env.HOME_LATITUDE || '13.756331'),
  longitude: parseFloat(process.env.HOME_LONGITUDE || '100.501765'),
  radiusMeters: parseFloat(process.env.HOME_RADIUS_METERS || '50')
};

// ช่วงเวลาแจ้งเตือน (หน่วย: วินาที)
const INTERVALS = {
  STATIONARY: parseInt(process.env.INTERVAL_STATIONARY_SEC || '7200', 10), // 2 ชม. = 7200 วิ
  MOVING: parseInt(process.env.INTERVAL_MOVING_SEC || '120', 10),           // 2 นาที = 120 วิ
  OUTSIDE: parseInt(process.env.INTERVAL_OUTSIDE_SEC || '30', 10)           // 30 วินาที
};

// หน่วยความจำจำลองสถานะอุปกรณ์
let trackerState = {
  deviceId: 'TRACKER_01',
  lastLat: homeConfig.latitude,
  lastLng: homeConfig.longitude,
  lastSpeed: 0,
  lastUpdate: new Date(),
  lastSentTime: 0,
  currentMode: 'STATIONARY', // 'STATIONARY' | 'MOVING' | 'OUTSIDE'
  lastReportedMode: null,
  battery: 100
};

// -----------------------------------------------------------------------------
// สูตรคำนวณระยะทาง Haversine Formula (เมตร)
// -----------------------------------------------------------------------------
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // รัศมีโลก (เมตร)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// แปลงเวลาเป็นภาษาไทยและรูปแบบที่อ่านง่าย (Asia/Bangkok)
function formatThaiDateTime(date) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

// -----------------------------------------------------------------------------
// ฟังก์ชันส่ง Push Message ไปยัง LINE OA ของผู้ดูแล
// -----------------------------------------------------------------------------
async function sendLinePushNotification({ mode, lat, lng, speed, distanceHome, battery, timestamp }) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !CAREGIVER_LINE_USER_ID) {
    console.warn('[LINE] ข้ามการส่ง: ยังไม่ได้กำหนด LINE_CHANNEL_ACCESS_TOKEN หรือ CAREGIVER_LINE_USER_ID');
    return false;
  }

  let theme = {
    title: '🏠 อยู่นิ่งตามปกติ',
    badge: '🟢 อยู่นิ่งภายในบ้าน',
    color: '#1E8E3E', // สีเขียว
    intervalText: 'ส่งพิกัดทุก 2 ชั่วโมง'
  };

  if (mode === 'OUTSIDE') {
    theme = {
      title: '🚨 แจ้งเตือนด่วน: ออกนอกเขตบ้าน!',
      badge: '🔴 ออกนอกเขตบ้านที่กำหนด',
      color: '#D93025', // สีแดง
      intervalText: 'ส่งพิกัดทุก 30 วินาที'
    };
  } else if (mode === 'MOVING') {
    theme = {
      title: '🚶 มีการเคลื่อนไหว',
      badge: '🟡 ตรวจพบการเคลื่อนไหว',
      color: '#F9AB00', // สีส้มอมเหลือง
      intervalText: 'ส่งพิกัดทุก 2 นาที'
    };
  }

  const timeStr = formatThaiDateTime(new Date(timestamp || Date.now()));
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  const flexMessage = {
    type: 'flex',
    altText: `${theme.title} (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: theme.color,
        paddingAll: '15px',
        contents: [
          {
            type: 'text',
            text: theme.title,
            weight: 'bold',
            size: 'md',
            color: '#FFFFFF'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '15px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'สถานะ:', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: theme.badge, size: 'xs', weight: 'bold', flex: 5 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '📅 วัน-เวลา:', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: timeStr, size: 'xs', flex: 5 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '📍 พิกัด:', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `${lat.toFixed(6)}, ${lng.toFixed(6)}`, size: 'xs', flex: 5 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '📏 ห่างจากบ้าน:', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `${Math.round(distanceHome)} เมตร (รัศมี ${homeConfig.radiusMeters} ม.)`, size: 'xs', flex: 5 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '⚡ ความเร็ว:', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `${speed.toFixed(1)} กม./ชม.`, size: 'xs', flex: 5 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '🔋 แบตเตอรี่:', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `${battery !== undefined ? battery + '%' : 'ปกติ'}`, size: 'xs', flex: 5 }
            ]
          },
          {
            type: 'separator',
            margin: 'sm'
          },
          {
            type: 'text',
            text: `⏱️ โหมดการส่ง: ${theme.intervalText}`,
            size: 'xxs',
            color: '#999999'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: theme.color,
            height: 'sm',
            action: {
              type: 'uri',
              label: '🗺️ เปิด Google Maps',
              uri: mapsUrl
            }
          }
        ]
      }
    }
  };

  try {
    const response = await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: CAREGIVER_LINE_USER_ID,
        messages: [flexMessage]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        }
      }
    );
    console.log(`[LINE OA] ส่งแจ้งเตือนสำเร็จ (โหมด: ${mode}, สถานะ HTTP: ${response.status})`);
    return true;
  } catch (err) {
    console.error('[LINE OA] เกิดข้อผิดพลาดในการส่ง:', err.response?.data || err.message);
    return false;
  }
}

// -----------------------------------------------------------------------------
// Endpoint 1: รับข้อมูล Telemetry จากเครื่องสวมใส่ (ESP32 หรือ Tracker)
// -----------------------------------------------------------------------------
app.post('/api/telemetry', async (req, res) => {
  const { deviceId, lat, lng, speed = 0, battery = 100, timestamp } = req.body;

  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Latitude and Longitude are required' });
  }

  const currentLat = parseFloat(lat);
  const currentLng = parseFloat(lng);
  const currentSpeed = parseFloat(speed);
  const now = Date.now();

  // 1. คำนวณระยะห่างจากพิกัด "บ้าน"
  const distFromHome = calculateDistance(currentLat, currentLng, homeConfig.latitude, homeConfig.longitude);

  // 2. ตรวจสอบการเคลื่อนไหว (ความเร็ว > 1.5 km/h หรือ ระยะเปลี่ยน > 15 เมตร)
  const distDelta = calculateDistance(currentLat, currentLng, trackerState.lastLat, trackerState.lastLng);
  const isMoving = currentSpeed >= 1.5 || distDelta >= 15.0;

  // 3. กำหนดโหมดตามเงื่อนไขทั้ง 3 แบบ (เรียงตามลำดับความสำคัญ)
  let detectedMode = 'STATIONARY';
  let targetIntervalSec = INTERVALS.STATIONARY; // 2 ชม. (7200 วิ)

  if (distFromHome > homeConfig.radiusMeters) {
    // โหมด 3: ออกนอกเขตบ้าน (ความสำคัญสูงสุด)
    detectedMode = 'OUTSIDE';
    targetIntervalSec = INTERVALS.OUTSIDE; // 30 วินาที
  } else if (isMoving) {
    // โหมด 2: มีการเคลื่อนไหว
    detectedMode = 'MOVING';
    targetIntervalSec = INTERVALS.MOVING; // 2 นาที
  } else {
    // โหมด 1: อยู่นิ่ง
    detectedMode = 'STATIONARY';
    targetIntervalSec = INTERVALS.STATIONARY; // 2 ชม.
  }

  // 4. ตรวจสอบเงื่อนไขว่าควรส่ง LINE แจ้งเตือนหรือไม่
  const elapsedSec = (now - trackerState.lastSentTime) / 1000;
  let shouldSend = false;

  if (trackerState.lastSentTime === 0) {
    // ส่งครั้งแรกเมื่อเริ่มระบบ
    shouldSend = true;
  } else if (detectedMode === 'OUTSIDE' && trackerState.lastReportedMode !== 'OUTSIDE') {
    // หากเพิ่งก้าวเท้าออกนอกบ้าน ให้ส่งเตือนทันทีโดยไม่ต้องรอจบรอบ!
    shouldSend = true;
  } else if (elapsedSec >= targetIntervalSec) {
    // ครบกำหนดรอบเวลาของโหมดปัจจุบัน
    shouldSend = true;
  }

  // อัปเดตข้อมูลสถานะในหน่วยความจำ
  trackerState = {
    ...trackerState,
    deviceId: deviceId || trackerState.deviceId,
    lastLat: currentLat,
    lastLng: currentLng,
    lastSpeed: currentSpeed,
    lastUpdate: new Date(),
    currentMode: detectedMode,
    battery
  };

  if (shouldSend) {
    console.log(`\n>>> [TRIGGER SEND] โหมด: ${detectedMode} | ห่างบ้าน: ${distFromHome.toFixed(1)}m | ครบ: ${elapsedSec.toFixed(0)}s`);
    await sendLinePushNotification({
      mode: detectedMode,
      lat: currentLat,
      lng: currentLng,
      speed: currentSpeed,
      distanceHome: distFromHome,
      battery,
      timestamp: timestamp || now
    });
    trackerState.lastSentTime = now;
    trackerState.lastReportedMode = detectedMode;
  }

  return res.json({
    status: 'OK',
    currentMode: detectedMode,
    distanceFromHome: Math.round(distFromHome),
    isOutsideHome: distFromHome > homeConfig.radiusMeters,
    notificationSent: shouldSend,
    nextIntervalSec: targetIntervalSec
  });
});

// -----------------------------------------------------------------------------
// Endpoint 2: ดึงข้อมูลสถานะปัจจุบัน (Dashboard / Debug)
// -----------------------------------------------------------------------------
app.get('/api/status', (req, res) => {
  const distFromHome = calculateDistance(trackerState.lastLat, trackerState.lastLng, homeConfig.latitude, homeConfig.longitude);
  res.json({
    trackerState,
    homeConfig,
    distanceFromHome: Math.round(distFromHome),
    intervals: INTERVALS
  });
});

// -----------------------------------------------------------------------------
// Endpoint 3: กำหนดพิกัดบ้านใหม่
// -----------------------------------------------------------------------------
app.post('/api/set-home', (req, res) => {
  const { latitude, longitude, radiusMeters } = req.body;
  if (latitude !== undefined) homeConfig.latitude = parseFloat(latitude);
  if (longitude !== undefined) homeConfig.longitude = parseFloat(longitude);
  if (radiusMeters !== undefined) homeConfig.radiusMeters = parseFloat(radiusMeters);

  console.log(`[GEOFENCE] อัปเดตพิกัดบ้านใหม่: (${homeConfig.latitude}, ${homeConfig.longitude}) รัศมี ${homeConfig.radiusMeters} ม.`);
  res.json({ message: 'Home geofence updated successfully', homeConfig });
});

// -----------------------------------------------------------------------------
// Endpoint 4: LINE OA Webhook (ให้ผู้ดูแลพิมพ์คุย หรือแชร์ Location เพื่อตั้งบ้าน)
// -----------------------------------------------------------------------------
app.post('/webhook', async (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    const userId = event.source?.userId;
    // จำ User ID ของผู้ดูแลที่ทักมา
    if (userId && !CAREGIVER_LINE_USER_ID) {
      CAREGIVER_LINE_USER_ID = userId;
      console.log(`[LINE Webhook] บันทึก CAREGIVER_LINE_USER_ID อัตโนมัติ: ${userId}`);
    }

    // กรณีผู้ดูแลกดส่ง Location Pin ทาง LINE เพื่อตั้งเป็นพิกัด "บ้าน"
    if (event.type === 'message' && event.message.type === 'location') {
      homeConfig.latitude = event.message.latitude;
      homeConfig.longitude = event.message.longitude;
      console.log(`[LINE Webhook] ผู้ดูแลตั้งพิกัดบ้านผ่าน LINE: ${homeConfig.latitude}, ${homeConfig.longitude}`);

      // ส่งข้อความตอบกลับยืนยัน
      if (event.replyToken && LINE_CHANNEL_ACCESS_TOKEN) {
        await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text: `✅ ตั้งพิกัด "บ้าน" เรียบร้อยแล้ว!\n📍 ละติจูด: ${homeConfig.latitude}\n📍 ลองจิจูด: ${homeConfig.longitude}\n📏 รัศมีปลอดภัย: ${homeConfig.radiusMeters} เมตร`
              }
            ]
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
          }
        ).catch(e => console.error(e.message));
      }
    }
  }
  res.status(200).send('OK');
});

// เริ่มทำงาน Web Server
app.listen(PORT, () => {
  console.log('=============================================================');
  console.log(`🚀 GPS Tracker Backend Server ทำงานที่ Port: ${PORT}`);
  console.log(`📍 พิกัดบ้านปัจจุบัน: Lat ${homeConfig.latitude}, Lng ${homeConfig.longitude}`);
  console.log(`📏 รัศมีเขตบ้าน: ${homeConfig.radiusMeters} เมตร`);
  console.log(`⏱️ ความถี่การส่ง: อยู่นิ่ง=${INTERVALS.STATIONARY}s | เคลื่อนไหว=${INTERVALS.MOVING}s | ออกนอกบ้าน=${INTERVALS.OUTSIDE}s`);
  console.log('=============================================================');
});

