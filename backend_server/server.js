/**
 * =============================================================================
 * Backend Server: Wearable GPS Tracker with LINE Official Account (LINE OA)
 * & Central Admin Back-Office System
 * =============================================================================
 * คุณสมบัติ:
 * 1. รับพิกัด GPS จากอุปกรณ์สวมใส่หลายตัวพร้อมกัน (Multi-Tracker NB-IoT / ESP32)
 * 2. ตรวจสอบ 3 โหมดตามเงื่อนไขรายอุปกรณ์ (อยู่นิ่ง, เคลื่อนไหว, ออกนอกเขต Geofence)
 * 3. ส่งข้อความ LINE Flex Message แจ้งเตือนผู้ดูแลรายเครื่อง (Multicast / Push)
 * 4. รองรับ LINE Webhook: ให้ผู้ดูแลแชร์ Location ใน LINE เพื่อตั้งพิกัดบ้าน หรือขอข้อมูล
 * 5. ระบบหลังบ้านสำหรับแอดมิน (Admin Portal) ดูข้อมูล Tracker แต่ละตัวแบบเจาะลึก
 * =============================================================================
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// -----------------------------------------------------------------------------
// ค่า Config เริ่มต้น (ดึงจาก .env หรือค่า Default)
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
let CAREGIVER_LINE_USER_ID = process.env.CAREGIVER_LINE_USER_ID || '';
const FORM_URL = process.env.FORM_URL || 'https://script.google.com/macros/s/AKfycbwdNLK2VmcznQ9beF9dgV6tKbPZicYgBio1gJ-N4e8CYWfKlq_Y4Np72AhN1MVh7Ao3/exec';

// การตั้งค่าพิกัดบ้านเริ่มต้น (Default Home Config)
let defaultHomeConfig = {
  latitude: parseFloat(process.env.HOME_LATITUDE || '13.756331'),
  longitude: parseFloat(process.env.HOME_LONGITUDE || '100.501765'),
  radiusMeters: parseFloat(process.env.HOME_RADIUS_METERS || '50')
};

// ช่วงเวลาแจ้งเตือน (หน่วย: วินาที)
const INTERVALS = {
  STATIONARY: parseInt(process.env.INTERVAL_STATIONARY_SEC || '7200', 10), // 2 ชม.
  MOVING: parseInt(process.env.INTERVAL_MOVING_SEC || '120', 10),           // 2 นาที
  OUTSIDE: parseInt(process.env.INTERVAL_OUTSIDE_SEC || '30', 10)           // 30 วินาที
};

// ที่อยู่ไฟล์จัดเก็บข้อมูล
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const devicesFilePath = path.join(dataDir, 'devices.json');

// เก็บประวัติพิกัดย้อนหลังในหน่วยความจำ (In-memory Telemetry History: สูงสุด 50 จุดต่อเครื่อง)
const deviceHistoryMap = {};

// -----------------------------------------------------------------------------
// ฟังก์ชันจัดการข้อมูล Devices
// -----------------------------------------------------------------------------
function loadDevicesData() {
  if (fs.existsSync(devicesFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(devicesFilePath, 'utf8'));
    } catch (e) {
      console.error('[DATABASE] เกิดข้อผิดพลาดในการอ่าน devices.json:', e.message);
      return {};
    }
  }
  return {};
}

function saveDevicesData(data) {
  try {
    fs.writeFileSync(devicesFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[DATABASE] ไม่สามารถบันทึก devices.json ได้:', e.message);
    return false;
  }
}

let devices = loadDevicesData();

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

// ตรวจสอบว่าพิกัดอยู่ในโพลีกอนหรือไม่ (Ray-casting Algorithm)
function isPointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
                      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ตรวจสอบพิกัดกับขอบเขตแนวรั้วของอุปกรณ์
function evaluateGeofence(device, lat, lng) {
  const fence = device.homeFence || {};
  let centerLat = fence.centerLat || defaultHomeConfig.latitude;
  let centerLng = fence.centerLng || defaultHomeConfig.longitude;
  let radius = fence.radiusMeters || defaultHomeConfig.radiusMeters;

  // หากเป็นแบบ Polygon ให้คำนวณจุดกึ่งกลาง (Centroid) หากยังไม่ได้ระบุ
  if (fence.type === 'polygon' && fence.polygon && fence.polygon.length >= 3) {
    if (!fence.centerLat || !fence.centerLng) {
      centerLat = fence.polygon.reduce((acc, p) => acc + p[0], 0) / fence.polygon.length;
      centerLng = fence.polygon.reduce((acc, p) => acc + p[1], 0) / fence.polygon.length;
    }
    const inside = isPointInPolygon([lat, lng], fence.polygon);
    const distToCenter = calculateDistance(lat, lng, centerLat, centerLng);
    return {
      isOutside: !inside,
      distanceFromCenter: distToCenter,
      centerLat,
      centerLng,
      radius
    };
  }

  // หากเป็นแบบ Circle
  const dist = calculateDistance(lat, lng, centerLat, centerLng);
  return {
    isOutside: dist > radius,
    distanceFromCenter: dist,
    centerLat,
    centerLng,
    radius
  };
}

// แปลงเวลาเป็นภาษาไทย
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
// บันทึกประวัติพิกัด (Breadcrumb Trail)
// -----------------------------------------------------------------------------
function addHistoryRecord(deviceId, record) {
  if (!deviceHistoryMap[deviceId]) {
    deviceHistoryMap[deviceId] = [];
  }
  deviceHistoryMap[deviceId].unshift(record);
  if (deviceHistoryMap[deviceId].length > 50) {
    deviceHistoryMap[deviceId].pop();
  }
}

// สร้างประวัติต้นแบบให้ Tracker ที่มีอยู่ตอนเริ่มระบบ
Object.keys(devices).forEach(dId => {
  const dev = devices[dId];
  const st = dev.status || {};
  addHistoryRecord(dId, {
    timestamp: st.lastUpdate || new Date().toISOString(),
    lat: st.lastLat || defaultHomeConfig.latitude,
    lng: st.lastLng || defaultHomeConfig.longitude,
    speed: st.lastSpeed || 0,
    battery: st.battery || 90,
    mode: st.currentMode || 'STATIONARY',
    distanceHome: st.distanceFromHome || 10
  });
});

// -----------------------------------------------------------------------------
// ฟังก์ชันส่ง Push Notification ไปยังผู้ดูแลของเครื่องนั้น ๆ (LINE Messaging API)
// -----------------------------------------------------------------------------
async function sendLineNotificationForDevice(device, { mode, lat, lng, speed, distanceHome, battery, timestamp }) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn('[LINE] ข้ามการส่ง: ยังไม่ได้กำหนด LINE_CHANNEL_ACCESS_TOKEN');
    return false;
  }

  // รวบรวม LINE User IDs ของผู้ดูแลที่ผูกกับเครื่องนี้
  const targetUserIds = [];
  if (device.caregivers && Array.isArray(device.caregivers)) {
    device.caregivers.forEach(cg => {
      if (cg.userId && !targetUserIds.includes(cg.userId)) {
        targetUserIds.push(cg.userId);
      }
    });
  }

  // หากไม่มีผู้ดูแลในเครื่อง ให้ใช้ CAREGIVER_LINE_USER_ID ค่ากลางจาก .env
  if (targetUserIds.length === 0 && CAREGIVER_LINE_USER_ID) {
    targetUserIds.push(CAREGIVER_LINE_USER_ID);
  }

  if (targetUserIds.length === 0) {
    console.warn(`[LINE] ข้ามการส่ง: ไม่พบ User ID ผู้ดูแลสำหรับเครื่อง ${device.deviceId}`);
    return false;
  }

  let theme = {
    title: '🏠 อยู่นิ่งตามปกติ',
    badge: '🟢 อยู่นิ่งภายในบ้าน',
    color: '#1E8E3E',
    intervalText: 'ส่งพิกัดทุก 2 ชั่วโมง'
  };

  if (mode === 'OUTSIDE') {
    theme = {
      title: '🚨 แจ้งเตือนด่วน: ออกนอกเขตบ้าน!',
      badge: '🔴 ออกนอกเขตบ้านที่กำหนด',
      color: '#D93025',
      intervalText: 'ส่งพิกัดทุก 30 วินาที'
    };
  } else if (mode === 'MOVING') {
    theme = {
      title: '🚶 มีการเคลื่อนไหว',
      badge: '🟡 ตรวจพบการเคลื่อนไหว',
      color: '#F9AB00',
      intervalText: 'ส่งพิกัดทุก 2 นาที'
    };
  }

  const patientName = device.patientName || 'ผู้สวมใส่';
  const deviceId = device.deviceId || 'TRACKER';
  const timeStr = formatThaiDateTime(new Date(timestamp || Date.now()));
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  const flexMessage = {
    type: 'flex',
    altText: `[${deviceId} - ${patientName}] ${theme.title}`,
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
            text: `${theme.title}`,
            weight: 'bold',
            size: 'md',
            color: '#FFFFFF'
          },
          {
            type: 'text',
            text: `👤 ผู้สวมใส่: ${patientName} (${deviceId})`,
            size: 'xs',
            color: '#FFFFFF',
            margin: 'xs',
            weight: 'bold'
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
              { type: 'text', text: '📏 ระยะห่าง:', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `${Math.round(distanceHome)} เมตรจากบ้าน`, size: 'xs', flex: 5 }
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
    if (targetUserIds.length === 1) {
      await axios.post(
        'https://api.line.me/v2/bot/message/push',
        { to: targetUserIds[0], messages: [flexMessage] },
        { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
      );
    } else {
      await axios.post(
        'https://api.line.me/v2/bot/message/multicast',
        { to: targetUserIds, messages: [flexMessage] },
        { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
      );
    }
    console.log(`[LINE OA] ส่งแจ้งเตือนสำเร็จไปยัง ${targetUserIds.length} ผู้ดูแล (เครื่อง: ${deviceId}, โหมด: ${mode})`);
    return true;
  } catch (err) {
    console.error(`[LINE OA] ข้อผิดพลาดส่งแจ้งเตือน:`, err.response?.data || err.message);
    return false;
  }
}

// -----------------------------------------------------------------------------
// Endpoint 1: รับข้อมูล Telemetry จากเครื่องสวมใส่ (ESP32 หรือ RP2350 NB-IoT)
// -----------------------------------------------------------------------------
app.post('/api/telemetry', async (req, res) => {
  const { deviceId = 'TRACKER_01', lat, lng, speed = 0, battery = 100, timestamp } = req.body;

  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Latitude and Longitude are required' });
  }

  const currentLat = parseFloat(lat);
  const currentLng = parseFloat(lng);
  const currentSpeed = parseFloat(speed);
  const now = Date.now();

  // ดึงหรือสร้างข้อมูลอุปกรณ์
  if (!devices[deviceId]) {
    devices[deviceId] = {
      deviceId,
      patientName: `ผู้ป่วย (${deviceId})`,
      note: 'สร้างอัตโนมัติจากการรับพิกัดครั้งแรก',
      wearerPosition: 'สายรัดข้อมือ',
      hardware: {
        board: 'RP2350 NB-IoT',
        sim: '1NCE IoT SIM',
        fwVersion: 'v1.0.0'
      },
      buzzer: { enabled: true, beepIntervalMs: 500 },
      homeFence: {
        type: 'circle',
        centerLat: defaultHomeConfig.latitude,
        centerLng: defaultHomeConfig.longitude,
        radiusMeters: defaultHomeConfig.radiusMeters,
        polygon: []
      },
      caregivers: CAREGIVER_LINE_USER_ID ? [{ userId: CAREGIVER_LINE_USER_ID, name: 'ผู้ดูแลหลัก', isPrimary: true }] : [],
      status: {
        currentMode: 'STATIONARY',
        isAlertMuted: false,
        lastLat: currentLat,
        lastLng: currentLng,
        lastSpeed: currentSpeed,
        battery,
        distanceFromHome: 0,
        isOnline: true,
        lastUpdate: new Date().toISOString()
      }
    };
  }

  const device = devices[deviceId];
  const devStatus = device.status || {};

  // 1. ตรวจสอบระยะห่างและเงื่อนไข Geofence
  const geoResult = evaluateGeofence(device, currentLat, currentLng);
  const distFromHome = geoResult.distanceFromCenter;

  // 2. ตรวจสอบการเคลื่อนไหว
  const prevLat = devStatus.lastLat || currentLat;
  const prevLng = devStatus.lastLng || currentLng;
  const distDelta = calculateDistance(currentLat, currentLng, prevLat, prevLng);
  const isMoving = currentSpeed >= 1.5 || distDelta >= 15.0;

  // 3. กำหนดโหมดตามลำดับความสำคัญ
  let detectedMode = 'STATIONARY';
  let targetIntervalSec = INTERVALS.STATIONARY;

  if (geoResult.isOutside) {
    detectedMode = 'OUTSIDE';
    targetIntervalSec = INTERVALS.OUTSIDE;
  } else if (isMoving) {
    detectedMode = 'MOVING';
    targetIntervalSec = INTERVALS.MOVING;
  } else {
    detectedMode = 'STATIONARY';
    targetIntervalSec = INTERVALS.STATIONARY;
  }

  // 4. ตรวจสอบว่าควรส่ง LINE แจ้งเตือนหรือไม่
  const lastSentTime = devStatus.lastSentTime || 0;
  const elapsedSec = (now - lastSentTime) / 1000;
  let shouldSend = false;

  // ถ้า Mute ไว้ จะไม่ส่งซ้ำช่วงออกนอกบ้าน
  const isMuted = devStatus.isAlertMuted || false;

  if (!isMuted) {
    if (lastSentTime === 0) {
      shouldSend = true;
    } else if (detectedMode === 'OUTSIDE' && devStatus.currentMode !== 'OUTSIDE') {
      shouldSend = true; // เพิ่งก้าวออกนอกบ้าน ส่งทันที!
    } else if (elapsedSec >= targetIntervalSec) {
      shouldSend = true;
    }
  }

  // ปลดล็อก Mute อัตโนมัติเมื่อกลับเข้าบ้าน
  let newMuteState = isMuted;
  if (!geoResult.isOutside && isMuted) {
    newMuteState = false;
    console.log(`[DEVICE ${deviceId}] กลับเข้าบ้านแล้ว -> ปลดล็อก Mute อัตโนมัติ`);
  }

  // อัปเดตสถานะอุปกรณ์
  device.status = {
    ...devStatus,
    currentMode: detectedMode,
    isAlertMuted: newMuteState,
    lastLat: currentLat,
    lastLng: currentLng,
    lastSpeed: currentSpeed,
    battery,
    distanceFromHome: Math.round(distFromHome),
    isOnline: true,
    lastSentTime: shouldSend ? now : lastSentTime,
    lastUpdate: new Date().toISOString()
  };

  // บันทึกลงประวัติ
  addHistoryRecord(deviceId, {
    timestamp: new Date().toISOString(),
    lat: currentLat,
    lng: currentLng,
    speed: currentSpeed,
    battery,
    mode: detectedMode,
    distanceHome: Math.round(distFromHome)
  });

  saveDevicesData(devices);

  if (shouldSend) {
    console.log(`\n>>> [TRIGGER SEND ${deviceId}] โหมด: ${detectedMode} | ห่างบ้าน: ${distFromHome.toFixed(1)}m`);
    await sendLineNotificationForDevice(device, {
      mode: detectedMode,
      lat: currentLat,
      lng: currentLng,
      speed: currentSpeed,
      distanceHome: distFromHome,
      battery,
      timestamp: timestamp || now
    });
  }

  return res.json({
    status: 'OK',
    deviceId,
    currentMode: detectedMode,
    distanceFromHome: Math.round(distFromHome),
    isOutsideHome: geoResult.isOutside,
    isAlertMuted: newMuteState,
    notificationSent: shouldSend,
    nextIntervalSec: targetIntervalSec
  });
});

// -----------------------------------------------------------------------------
// Endpoint 2: REST APIs สำหรับแอดมินดูข้อมูลและจัดการ Tracker แต่ละตัว
// -----------------------------------------------------------------------------

// 2.1 ดึงสรุปภาพรวมระบบ (Admin Dashboard KPI Summary)
app.get('/api/admin/stats', (req, res) => {
  const allDevices = Object.values(devices);
  const totalDevices = allDevices.length;
  let onlineCount = 0;
  let outsideCount = 0;
  let movingCount = 0;
  let stationaryCount = 0;
  let lowBatteryCount = 0;

  const now = Date.now();
  allDevices.forEach(d => {
    const st = d.status || {};
    const updateTime = st.lastUpdate ? new Date(st.lastUpdate).getTime() : 0;
    // ถือว่า Online ถ้ามีการส่งข้อมูลภายใน 24 ชม.
    const isOnline = (now - updateTime) < (24 * 60 * 60 * 1000);
    if (isOnline) onlineCount++;

    if (st.currentMode === 'OUTSIDE') outsideCount++;
    else if (st.currentMode === 'MOVING') movingCount++;
    else stationaryCount++;

    if (st.battery !== undefined && st.battery <= 20) lowBatteryCount++;
  });

  res.json({
    totalDevices,
    onlineDevices: onlineCount,
    outsideAlerts: outsideCount,
    movingCount,
    stationaryCount,
    lowBatteryCount,
    serverTime: new Date().toISOString()
  });
});

// 2.2 ดึงรายการ Tracker ทั้งหมด (พร้อมประวัติล่าสุด)
app.get('/api/devices', (req, res) => {
  const result = {};
  for (const [id, dev] of Object.entries(devices)) {
    result[id] = {
      ...dev,
      recentHistory: (deviceHistoryMap[id] || []).slice(0, 10)
    };
  }
  res.json(result);
});

// 2.3 ดึงข้อมูลเจาะลึกของ Tracker ตัวใดตัวหนึ่ง (รวม History ทั้งหมด)
app.get('/api/devices/:id', (req, res) => {
  const deviceId = req.params.id;
  const device = devices[deviceId];
  if (!device) {
    return res.status(404).json({ error: `ไม่พบอุปกรณ์รหัส ${deviceId}` });
  }

  res.json({
    ...device,
    history: deviceHistoryMap[deviceId] || []
  });
});

// 2.4 เพิ่ม Tracker ตัวใหม่
app.post('/api/devices', (req, res) => {
  const { deviceId, patientName, note, wearerPosition, buzzer, homeFence, caregivers } = req.body;
  if (!deviceId) {
    return res.status(400).json({ error: 'ต้องระบุ Device ID' });
  }

  if (devices[deviceId]) {
    return res.status(409).json({ error: `รหัสอุปกรณ์ ${deviceId} มีอยู่ในระบบแล้ว` });
  }

  devices[deviceId] = {
    deviceId,
    patientName: patientName || 'ผู้สวมใส่ใหม่',
    note: note || '',
    wearerPosition: wearerPosition || 'สายรัดข้อมือ',
    hardware: {
      board: 'iLabs Challenger+ RP2350 NB-IoT',
      gnss: 'ST87M01-1301 Concurrent GNSS',
      sim: '1NCE IoT SIM (APN: iot.1nce.net)',
      fwVersion: 'v1.2.0'
    },
    buzzer: buzzer || { enabled: true, beepIntervalMs: 500 },
    homeFence: homeFence || {
      type: 'circle',
      centerLat: defaultHomeConfig.latitude,
      centerLng: defaultHomeConfig.longitude,
      radiusMeters: defaultHomeConfig.radiusMeters,
      polygon: []
    },
    caregivers: caregivers || [],
    status: {
      currentMode: 'STATIONARY',
      isAlertMuted: false,
      lastLat: homeFence?.centerLat || defaultHomeConfig.latitude,
      lastLng: homeFence?.centerLng || defaultHomeConfig.longitude,
      lastSpeed: 0,
      battery: 100,
      distanceFromHome: 0,
      isOnline: true,
      lastUpdate: new Date().toISOString()
    }
  };

  saveDevicesData(devices);
  console.log(`[ADMIN] เพิ่ม Tracker ใหม่สำเร็จ: ${deviceId}`);
  res.status(201).json({ status: 'OK', message: 'สร้างอุปกรณ์ใหม่เรียบร้อย', device: devices[deviceId] });
});

// 2.5 แก้ไขข้อมูล Tracker
app.put('/api/devices/:id', (req, res) => {
  const deviceId = req.params.id;
  if (!devices[deviceId]) {
    return res.status(404).json({ error: `ไม่พบอุปกรณ์รหัส ${deviceId}` });
  }

  const { patientName, note, wearerPosition, buzzer, homeFence, caregivers } = req.body;
  const dev = devices[deviceId];

  if (patientName !== undefined) dev.patientName = patientName;
  if (note !== undefined) dev.note = note;
  if (wearerPosition !== undefined) dev.wearerPosition = wearerPosition;
  if (buzzer !== undefined) dev.buzzer = { ...dev.buzzer, ...buzzer };
  if (homeFence !== undefined) dev.homeFence = { ...dev.homeFence, ...homeFence };
  if (caregivers !== undefined) dev.caregivers = caregivers;

  saveDevicesData(devices);
  console.log(`[ADMIN] อัปเดตข้อมูลอุปกรณ์ ${deviceId} เรียบร้อยแล้ว`);
  res.json({ status: 'OK', message: 'อัปเดตข้อมูลสำเร็จ', device: dev });
});

// 2.6 ลบ Tracker
app.delete('/api/devices/:id', (req, res) => {
  const deviceId = req.params.id;
  if (!devices[deviceId]) {
    return res.status(404).json({ error: `ไม่พบอุปกรณ์รหัส ${deviceId}` });
  }

  delete devices[deviceId];
  delete deviceHistoryMap[deviceId];
  saveDevicesData(devices);
  console.log(`[ADMIN] ลบอุปกรณ์ ${deviceId} ออกจากระบบแล้ว`);
  res.json({ status: 'OK', message: `ลบอุปกรณ์ ${deviceId} สำเร็จ` });
});

// 2.7 สั่ง Mute / Unmute การเตือนของ Tracker
app.post('/api/devices/:id/mute', (req, res) => {
  const deviceId = req.params.id;
  const dev = devices[deviceId];
  if (!dev) return res.status(404).json({ error: 'Device not found' });

  const { isMuted } = req.body;
  dev.status = dev.status || {};
  dev.status.isAlertMuted = isMuted !== undefined ? isMuted : !dev.status.isAlertMuted;

  saveDevicesData(devices);
  console.log(`[ADMIN] เปลี่ยนสถานะ Mute เครื่อง ${deviceId} เป็น: ${dev.status.isAlertMuted}`);
  res.json({ status: 'OK', isAlertMuted: dev.status.isAlertMuted });
});

// 2.8 สั่งเปิด/ปิด Buzzer
app.post('/api/devices/:id/buzzer', (req, res) => {
  const deviceId = req.params.id;
  const dev = devices[deviceId];
  if (!dev) return res.status(404).json({ error: 'Device not found' });

  const { enabled } = req.body;
  dev.buzzer = dev.buzzer || {};
  dev.buzzer.enabled = enabled !== undefined ? enabled : !dev.buzzer.enabled;

  saveDevicesData(devices);
  res.json({ status: 'OK', buzzerEnabled: dev.buzzer.enabled });
});

// 2.9 ทดสอบยิง LINE Alert เฉพาะ Tracker นี้
app.post('/api/devices/:id/test-line', async (req, res) => {
  const deviceId = req.params.id;
  const dev = devices[deviceId];
  if (!dev) return res.status(404).json({ error: 'Device not found' });

  const st = dev.status || {};
  const lat = st.lastLat || defaultHomeConfig.latitude;
  const lng = st.lastLng || defaultHomeConfig.longitude;
  const mode = req.body.mode || st.currentMode || 'OUTSIDE';

  const sent = await sendLineNotificationForDevice(dev, {
    mode,
    lat,
    lng,
    speed: st.lastSpeed || 0,
    distanceHome: st.distanceFromHome || 50,
    battery: st.battery || 95,
    timestamp: Date.now()
  });

  res.json({ status: sent ? 'OK' : 'ERROR', sent, deviceId });
});

// 2.10 จำลองส่งพิกัด GPS สำหรับทดสอบ Tracker
app.post('/api/devices/:id/simulate', async (req, res) => {
  const deviceId = req.params.id;
  const { mode = 'STATIONARY', lat, lng, speed = 0, battery = 90 } = req.body;

  const dev = devices[deviceId];
  if (!dev) return res.status(404).json({ error: 'Device not found' });

  let simLat = lat;
  let simLng = lng;
  let simSpeed = speed;

  const fence = dev.homeFence || {};
  const centerLat = fence.centerLat || defaultHomeConfig.latitude;
  const centerLng = fence.centerLng || defaultHomeConfig.longitude;

  if (simLat === undefined || simLng === undefined) {
    if (mode === 'STATIONARY') {
      simLat = centerLat;
      simLng = centerLng;
      simSpeed = 0.0;
    } else if (mode === 'MOVING') {
      simLat = centerLat + 0.0002;
      simLng = centerLng + 0.0002;
      simSpeed = 2.5;
    } else if (mode === 'OUTSIDE') {
      simLat = centerLat + 0.0030; // ห่างออกไป ~300 เมตร
      simLng = centerLng + 0.0030;
      simSpeed = 4.2;
    }
  }

  // ส่งเข้า telemetry endpoint logic
  const fakeReq = {
    body: {
      deviceId,
      lat: simLat,
      lng: simLng,
      speed: simSpeed,
      battery,
      timestamp: Date.now()
    }
  };

  // เรียกใช้ Logic Telemetry
  const geoResult = evaluateGeofence(dev, simLat, simLng);
  const detectedMode = geoResult.isOutside ? 'OUTSIDE' : (simSpeed >= 1.5 ? 'MOVING' : 'STATIONARY');

  dev.status = {
    ...dev.status,
    currentMode: detectedMode,
    lastLat: simLat,
    lastLng: simLng,
    lastSpeed: simSpeed,
    battery,
    distanceFromHome: Math.round(geoResult.distanceFromCenter),
    isOnline: true,
    lastUpdate: new Date().toISOString()
  };

  addHistoryRecord(deviceId, {
    timestamp: new Date().toISOString(),
    lat: simLat,
    lng: simLng,
    speed: simSpeed,
    battery,
    mode: detectedMode,
    distanceHome: Math.round(geoResult.distanceFromCenter)
  });

  saveDevicesData(devices);

  res.json({
    status: 'OK',
    simulated: true,
    deviceId,
    detectedMode,
    lat: simLat,
    lng: simLng,
    distanceFromHome: Math.round(geoResult.distanceFromCenter),
    isOutside: geoResult.isOutside
  });
});

// -----------------------------------------------------------------------------
// Endpoint 3: Backward Compatibility APIs
// -----------------------------------------------------------------------------
app.get('/api/status', (req, res) => {
  const firstDev = Object.values(devices)[0] || {};
  res.json({
    trackerState: firstDev.status || {},
    homeConfig: defaultHomeConfig,
    intervals: INTERVALS
  });
});

app.post('/api/set-home', (req, res) => {
  const { latitude, longitude, radiusMeters } = req.body;
  if (latitude !== undefined) defaultHomeConfig.latitude = parseFloat(latitude);
  if (longitude !== undefined) defaultHomeConfig.longitude = parseFloat(longitude);
  if (radiusMeters !== undefined) defaultHomeConfig.radiusMeters = parseFloat(radiusMeters);
  res.json({ message: 'Default home geofence updated', homeConfig: defaultHomeConfig });
});

app.post('/api/bind-device', (req, res) => {
  const { deviceId = 'TRACKER_01', patientName, note, buzzer, caregivers, homeFence } = req.body;
  const targetId = deviceId;

  let fenceObj = {
    type: 'circle',
    radiusMeters: 50,
    centerLat: defaultHomeConfig.latitude,
    centerLng: defaultHomeConfig.longitude,
    polygon: []
  };

  if (homeFence) {
    if (homeFence.polygon && homeFence.polygon.length >= 3) {
      const cLat = homeFence.polygon.reduce((acc, p) => acc + p[0], 0) / homeFence.polygon.length;
      const cLng = homeFence.polygon.reduce((acc, p) => acc + p[1], 0) / homeFence.polygon.length;
      fenceObj = {
        type: 'polygon',
        centerLat: cLat,
        centerLng: cLng,
        radiusMeters: homeFence.radiusMeters || 50,
        polygon: homeFence.polygon
      };
      defaultHomeConfig.latitude = cLat;
      defaultHomeConfig.longitude = cLng;
    } else {
      fenceObj = {
        type: homeFence.type || 'circle',
        centerLat: homeFence.centerLat || defaultHomeConfig.latitude,
        centerLng: homeFence.centerLng || defaultHomeConfig.longitude,
        radiusMeters: homeFence.radiusMeters || defaultHomeConfig.radiusMeters,
        polygon: homeFence.polygon || []
      };
    }
  }

  devices[targetId] = {
    deviceId: targetId,
    patientName: patientName || 'คุณตาสมชาย',
    note: note || '',
    wearerPosition: 'สายรัดแขนข้อมือซ้าย',
    hardware: { board: 'iLabs Challenger+ RP2350 NB-IoT', sim: '1NCE IoT SIM (APN: iot.1nce.net)', fwVersion: 'v1.2.0' },
    buzzer: buzzer || { enabled: true, beepIntervalMs: 500 },
    homeFence: fenceObj,
    caregivers: caregivers || [],
    status: devices[targetId]?.status || {
      currentMode: 'STATIONARY',
      isAlertMuted: false,
      lastLat: fenceObj.centerLat,
      lastLng: fenceObj.centerLng,
      lastSpeed: 0,
      battery: 100,
      distanceFromHome: 0,
      isOnline: true,
      lastUpdate: new Date().toISOString()
    }
  };

  saveDevicesData(devices);
  res.json({ status: 'OK', message: 'Device bound successfully', device: devices[targetId] });
});

// -----------------------------------------------------------------------------
// Web Pages & Static Serving
// -----------------------------------------------------------------------------
// 1. หน้า Admin Dashboard กลาง
app.use('/admin', express.static(path.join(__dirname, '../admin_dashboard')));

// 2. หน้า Geofence Map / จัดการผู้ป่วยสำหรับผู้ดูแล
app.use('/manage', express.static(path.join(__dirname, '../geofence_map')));

// 3. หน้า Form Redirect
app.get('/form', (req, res) => {
  res.redirect(FORM_URL);
});

// 4. Default Root -> Redirect ไปที่หน้า Admin
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// -----------------------------------------------------------------------------
// Endpoint 4: LINE OA Webhook (รับข้อความ หรือ Location จากผู้ดูแล)
// -----------------------------------------------------------------------------
app.post('/webhook', async (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    const userId = event.source?.userId;
    if (userId && !CAREGIVER_LINE_USER_ID) {
      CAREGIVER_LINE_USER_ID = userId;
      console.log(`[LINE Webhook] บันทึก CAREGIVER_LINE_USER_ID อัตโนมัติ: ${userId}`);
    }

    if (event.type === 'message' && event.message.type === 'location') {
      defaultHomeConfig.latitude = event.message.latitude;
      defaultHomeConfig.longitude = event.message.longitude;
      console.log(`[LINE Webhook] ผู้ดูแลตั้งพิกัดบ้านผ่าน LINE: ${defaultHomeConfig.latitude}, ${defaultHomeConfig.longitude}`);

      if (event.replyToken && LINE_CHANNEL_ACCESS_TOKEN) {
        await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          {
            replyToken: event.replyToken,
            messages: [{
              type: 'text',
              text: `✅ ตั้งพิกัด "บ้าน" เรียบร้อยแล้ว!\n📍 ละติจูด: ${defaultHomeConfig.latitude}\n📍 ลองจิจูด: ${defaultHomeConfig.longitude}\n📏 รัศมีปลอดภัย: ${defaultHomeConfig.radiusMeters} เมตร`
            }]
          },
          { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
        ).catch(e => console.error(e.message));
      }
    } else if ((event.type === 'message' && event.message.type === 'text') || event.type === 'follow') {
      const incomingText = event.message?.text?.trim() || '';
      const lowerText = incomingText.toLowerCase();
      let replyMessages = [];

      if (incomingText.includes('ขอรหัส') || incomingText === 'รหัส' || lowerText === 'uid' || lowerText === 'id' || lowerText === 'user id') {
        replyMessages = [{
          type: 'text',
          text: `🔑 รหัสประจำตัวผู้ดูแล (User ID) ของคุณคือ:\n\n${userId}\n\n📋 กดคัดลอกรหัสนี้เพื่อส่งต่อให้แอดมินนำไปผูกกับเครื่อง GPS Tracker ได้เลยครับ`
        }];
      } else if (incomingText.includes('ขอข้อมูล') || incomingText === 'ข้อมูล' || incomingText.includes('เช็คข้อมูล') || incomingText.includes('ดูข้อมูล') || incomingText === 'สถานะ') {
        let boundDevice = null;
        for (const dId of Object.keys(devices)) {
          const dev = devices[dId];
          if (dev.caregivers && dev.caregivers.some(cg => cg.userId === userId)) {
            boundDevice = dev;
            break;
          }
        }
        if (!boundDevice && Object.keys(devices).length > 0) {
          boundDevice = Object.values(devices)[0];
        }

        if (boundDevice) {
          const caregiversList = (boundDevice.caregivers || [])
            .map((cg, i) => `   ${i + 1}. ${cg.name || 'ผู้ดูแล'} (${cg.userId})`)
            .join('\n') || '   - ยังไม่มีผู้ดูแลในระบบ';

          const fencePoints = boundDevice.homeFence?.polygon?.length || 0;
          const fenceInfo = fencePoints > 0 ? `กำหนดแล้ว (${fencePoints} มุม) 🏡` : `รัศมี ${boundDevice.homeFence?.radiusMeters || 50} ม.`;

          replyMessages = [{
            type: 'text',
            text: `📋 ข้อมูลที่ผูกกับบัญชีของคุณ:\n\n` +
              `🏷️ รหัสเครื่อง: ${boundDevice.deviceId || '-'}\n` +
              `👤 ผู้ป่วย / ผู้สวมใส่: ${boundDevice.patientName || '-'}\n` +
              `📝 อาการ / หมายเหตุ: ${boundDevice.note || 'ไม่มี'}\n` +
              `🔋 แบตเตอรี่: ${boundDevice.status?.battery || 100}%\n` +
              `🔊 เสียง Buzzer: ${boundDevice.buzzer?.enabled ? 'เปิดใช้งาน 🔊' : 'ปิด 🔇'}\n` +
              `🏡 แนวรั้วบ้าน: ${fenceInfo}\n\n` +
              `👥 รายชื่อผู้ดูแล (${boundDevice.caregivers?.length || 0} คน):\n${caregiversList}`
          }];
        } else {
          replyMessages = [{
            type: 'text',
            text: `🔍 ตรวจสอบรหัส User ID:\n${userId}\n\n❌ ยังไม่พบข้อมูลผู้ป่วยที่ผูกกับบัญชีของคุณในระบบ\n💡 กรุณาส่งรหัสนี้ให้แอดมินเพื่อลงทะเบียนครับ`
          }];
        }
      } else {
        replyMessages = [{
          type: 'text',
          text: `👋 สวัสดีครับผู้ดูแล!\n\nเมนูคำสั่ง:\n• พิมพ์ "ขอรหัส" -> ดู User ID ของคุณ\n• พิมพ์ "ขอข้อมูล" -> ดูสถานะและข้อมูล Tracker ที่ผูกไว้\n• ส่ง Location Pin ทางแชท -> ตั้งพิกัดบ้าน`
        }];
      }

      if (event.replyToken && LINE_CHANNEL_ACCESS_TOKEN) {
        await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          { replyToken: event.replyToken, messages: replyMessages },
          { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
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
  console.log(`🛡️ ระบบหลังบ้านแอดมิน (Admin Dashboard): http://localhost:${PORT}/admin`);
  console.log(`🗺️ ระบบจัดการผู้ป่วย (Caregiver Portal): http://localhost:${PORT}/manage`);
  console.log(`📱 โหลดอุปกรณ์แล้วทั้งหมด: ${Object.keys(devices).length} เครื่อง`);
  console.log('=============================================================');
});
