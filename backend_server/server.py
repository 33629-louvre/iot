"""
=============================================================================
Standalone GPS Tracker Backend & Admin Server (Python Standard Library)
Zero-dependency: รันได้ทันทีโดยไม่ต้องติดตั้งไลบรารีเสริม
พร้อมระบบส่งแจ้งเตือนเข้า LINE Messaging API อัตโนมัติ
=============================================================================
"""

import sys
import os
import json
import math
import time
import urllib.parse
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import datetime, timezone

def get_utc_now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

PORT = 3000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..'))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DEVICES_FILE = os.path.join(DATA_DIR, 'devices.json')
ADMIN_DIR = os.path.join(PROJECT_DIR, 'admin_dashboard')
MANAGE_DIR = os.path.join(PROJECT_DIR, 'geofence_map')
ENV_FILE = os.path.join(BASE_DIR, '.env')

os.makedirs(DATA_DIR, exist_ok=True)

# -----------------------------------------------------------------------------
# โหลดค่า Config จาก .env
# -----------------------------------------------------------------------------
def load_env(filepath):
    env_vars = {}
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        env_vars[k.strip()] = v.strip()
        except Exception as e:
            print(f"[ENV] Error reading .env: {e}")
    return env_vars

env_config = load_env(ENV_FILE)
LINE_CHANNEL_ACCESS_TOKEN = env_config.get('LINE_CHANNEL_ACCESS_TOKEN', '')
CAREGIVER_LINE_USER_ID = env_config.get('CAREGIVER_LINE_USER_ID', '')
DEFAULT_HOME_LAT = float(env_config.get('HOME_LATITUDE', '13.756331'))
DEFAULT_HOME_LNG = float(env_config.get('HOME_LONGITUDE', '100.501765'))
DEFAULT_HOME_RADIUS = float(env_config.get('HOME_RADIUS_METERS', '50'))
FORM_URL = env_config.get('FORM_URL', 'https://script.google.com/macros/s/AKfycbwdNLK2VmcznQ9beF9dgV6tKbPZicYgBio1gJ-N4e8CYWfKlq_Y4Np72AhN1MVh7Ao3/exec')

print(f"[CONFIG] LINE Access Token Loaded: {'YES (Ready)' if LINE_CHANNEL_ACCESS_TOKEN else 'NO'}")
print(f"[CONFIG] Default Caregiver LINE UID: {CAREGIVER_LINE_USER_ID}")
print(f"[CONFIG] Form / GAS Web App URL: {FORM_URL}")

# -----------------------------------------------------------------------------
# โหลด / บันทึก Devices Data
# -----------------------------------------------------------------------------
def load_devices():
    if os.path.exists(DEVICES_FILE):
        try:
            with open(DEVICES_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[ERROR] Failed to load devices.json: {e}")
    return {}

def save_devices(data):
    try:
        with open(DEVICES_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[ERROR] Failed to save devices.json: {e}")
        return False

devices_db = load_devices()
device_history = {}

# -----------------------------------------------------------------------------
# สูตรคำนวณระยะทางและตรวจสอบขอบเขต Geofence
# -----------------------------------------------------------------------------
# Haversine distance in meters
def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371000.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

# Point in polygon (Ray-casting Algorithm)
def is_point_in_polygon(point, vs):
    x, y = point[0], point[1]
    inside = False
    j = len(vs) - 1
    for i in range(len(vs)):
        xi, yi = vs[i][0], vs[i][1]
        xj, yj = vs[j][0], vs[j][1]
        intersect = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
        if intersect:
            inside = not inside
        j = i
    return inside

def evaluate_geofence(dev, lat, lng):
    fence = dev.get('homeFence', {})
    center_lat = fence.get('centerLat', DEFAULT_HOME_LAT)
    center_lng = fence.get('centerLng', DEFAULT_HOME_LNG)
    radius = fence.get('radiusMeters', DEFAULT_HOME_RADIUS)

    if fence.get('type') == 'polygon' and fence.get('polygon') and len(fence.get('polygon')) >= 3:
        poly = fence.get('polygon')
        inside = is_point_in_polygon([lat, lng], poly)
        c_lat = sum(p[0] for p in poly) / len(poly)
        c_lng = sum(p[1] for p in poly) / len(poly)
        dist = calculate_distance(lat, lng, c_lat, c_lng)
        return {
            'isOutside': not inside,
            'distanceFromCenter': dist
        }

    dist = calculate_distance(lat, lng, center_lat, center_lng)
    return {
        'isOutside': dist > radius,
        'distanceFromCenter': dist
    }

# คำนวณและอัปเดตสถานะโหมด (STATIONARY / MOVING / OUTSIDE) อัตโนมัติจากพิกัดและแนวรั้วล่าสุด
def recalculate_device_mode(dev):
    st = dev.get('status', {})
    fence = dev.get('homeFence', {})
    lat = st.get('lastLat', fence.get('centerLat', DEFAULT_HOME_LAT))
    lng = st.get('lastLng', fence.get('centerLng', DEFAULT_HOME_LNG))
    geo = evaluate_geofence(dev, lat, lng)
    speed = float(st.get('lastSpeed', 0.0))
    mode = 'OUTSIDE' if geo['isOutside'] else ('MOVING' if speed >= 1.5 else 'STATIONARY')
    st['currentMode'] = mode
    st['distanceFromHome'] = round(geo['distanceFromCenter'])
    dev['status'] = st
    return dev

# ตรวจสอบและอัปเดตโหมดของอุปกรณ์ทั้งหมดตอนเริ่มระบบ
for dev in devices_db.values():
    recalculate_device_mode(dev)

# -----------------------------------------------------------------------------
# ซิงค์ข้อมูลกับ Google Apps Script (หน้าบ้าน)
# -----------------------------------------------------------------------------
def sync_devices_from_gas():
    if not FORM_URL:
        return {'success': False, 'error': 'FORM_URL not set'}
    try:
        clean_url = FORM_URL.split('?')[0]
        sync_api_url = f"{clean_url}?api=getDevices"
        print(f"[SYNC] กำลังดึงข้อมูลจาก Google Apps Script: {sync_api_url}")
        req = urllib.request.Request(sync_api_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=12) as response:
            content = response.read().decode('utf-8')
            gas_devices = json.loads(content)

            if isinstance(gas_devices, dict):
                count = 0
                for d_id, g_dev in gas_devices.items():
                    if not d_id or not isinstance(g_dev, dict):
                        continue
                    existing = devices_db.get(d_id, {})
                    st = existing.get('status', {})
                    fence = g_dev.get('homeFence', existing.get('homeFence', {
                        'type': 'polygon',
                        'centerLat': DEFAULT_HOME_LAT,
                        'centerLng': DEFAULT_HOME_LNG,
                        'radiusMeters': DEFAULT_HOME_RADIUS,
                        'polygon': []
                    }))
                    if fence.get('polygon') and len(fence['polygon']) >= 3:
                        poly = fence['polygon']
                        fence['centerLat'] = sum(p[0] for p in poly) / len(poly)
                        fence['centerLng'] = sum(p[1] for p in poly) / len(poly)
                        fence['type'] = 'polygon'

                    dev_obj = {
                        **existing,
                        'deviceId': d_id,
                        'patientName': g_dev.get('patientName', existing.get('patientName', f'ผู้ป่วย ({d_id})')),
                        'note': g_dev.get('note', existing.get('note', '')),
                        'wearerPosition': g_dev.get('wearerPosition', existing.get('wearerPosition', 'สายรัดแขนข้อมือซ้าย')),
                        'hardware': existing.get('hardware', {
                            'board': 'iLabs Challenger+ RP2350 NB-IoT',
                            'gnss': 'ST87M01-1301 Concurrent GNSS',
                            'sim': '1NCE IoT SIM (APN: iot.1nce.net)',
                            'fwVersion': 'v1.2.0'
                        }),
                        'buzzer': g_dev.get('buzzer', existing.get('buzzer', {'enabled': True, 'beepIntervalMs': 500})),
                        'homeFence': fence,
                        'caregivers': g_dev.get('caregivers', existing.get('caregivers', [])),
                        'status': {
                            **st,
                            'isAlertMuted': st.get('isAlertMuted', False),
                            'lastLat': st.get('lastLat', fence.get('centerLat', DEFAULT_HOME_LAT)),
                            'lastLng': st.get('lastLng', fence.get('centerLng', DEFAULT_HOME_LNG)),
                            'lastSpeed': st.get('lastSpeed', 0),
                            'battery': st.get('battery', 100),
                            'isOnline': st.get('isOnline', True),
                            'lastUpdate': st.get('lastUpdate', get_utc_now_iso())
                        }
                    }
                    recalculate_device_mode(dev_obj)
                    devices_db[d_id] = dev_obj
                    count += 1
                save_devices(devices_db)
                print(f"[SYNC] ✅ ซิงค์ข้อมูลสำเร็จ ({count} เครื่อง)")
                return {'success': True, 'count': count, 'devices': devices_db}
    except Exception as e:
        print(f"[SYNC] ข้อผิดพลาดในการซิงค์ข้อมูลกับ GAS: {e}")
        return {'success': False, 'error': str(e)}
    return {'success': False, 'error': 'Unknown sync error'}

def push_device_to_gas(device):
    if not FORM_URL or not device:
        return False
    try:
        clean_url = FORM_URL.split('?')[0]
        payload = json.dumps({'action': 'saveDevice', 'device': device}, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(clean_url, data=payload, headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[SYNC-PUSH] ส่งข้อมูลอุปกรณ์ {device.get('deviceId')} ไปยัง Google Apps Script สำเร็จ")
            return True
    except Exception as e:
        print(f"[SYNC-PUSH] ไม่สามารถส่งข้อมูลอุปกรณ์ไปยัง GAS: {e}")
        return False

# -----------------------------------------------------------------------------
# ส่ง LINE OA Push / Multicast Notification
# -----------------------------------------------------------------------------
def send_line_notification(device, mode='OUTSIDE', lat=13.756331, lng=100.501765, speed=0.0, distance_home=0, battery=98):
    if not LINE_CHANNEL_ACCESS_TOKEN:
        print("[LINE] ไม่สามารถส่งได้: ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน .env")
        return False

    target_uids = []
    caregivers = device.get('caregivers', [])
    for cg in caregivers:
        uid = cg.get('userId')
        if uid and uid not in target_uids:
            target_uids.append(uid.strip())

    if not target_uids and CAREGIVER_LINE_USER_ID:
        target_uids.append(CAREGIVER_LINE_USER_ID.strip())

    if not target_uids:
        print(f"[LINE] ไม่พบ User ID ผู้ดูแลสำหรับอุปกรณ์ {device.get('deviceId')}")
        return False

    theme = {
        'title': '🏠 อยู่นิ่งตามปกติ',
        'badge': '🟢 อยู่นิ่งภายในบ้าน',
        'color': '#1E8E3E',
        'interval': 'ส่งพิกัดทุก 2 ชั่วโมง'
    }
    if mode == 'OUTSIDE':
        theme = {
            'title': '🚨 แจ้งเตือนด่วน: ออกนอกเขตบ้าน!',
            'badge': '🔴 ออกนอกเขตบ้านที่กำหนด',
            'color': '#D93025',
            'interval': 'ส่งพิกัดทุก 30 วินาที'
        }
    elif mode == 'MOVING':
        theme = {
            'title': '🚶 มีการเคลื่อนไหว',
            'badge': '🟡 ตรวจพบการเคลื่อนไหว',
            'color': '#F9AB00',
            'interval': 'ส่งพิกัดทุก 2 นาที'
        }

    patient_name = device.get('patientName', 'คุณตาสมชาย')
    device_id = device.get('deviceId', 'TRACKER_01')
    maps_url = f"https://www.google.com/maps?q={lat},{lng}"
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    flex_message = {
        "type": "flex",
        "altText": f"[{device_id} - {patient_name}] {theme['title']}",
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": theme['color'],
                "paddingAll": "15px",
                "contents": [
                    { "type": "text", "text": theme['title'], "weight": "bold", "size": "md", "color": "#FFFFFF" },
                    { "type": "text", "text": f"👤 ผู้สวมใส่: {patient_name} ({device_id})", "size": "xs", "color": "#FFFFFF", "margin": "xs", "weight": "bold" }
                ]
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "sm",
                "paddingAll": "15px",
                "contents": [
                    {
                        "type": "box", "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": "สถานะ:", "size": "xs", "color": "#888888", "flex": 2 },
                            { "type": "text", "text": theme['badge'], "size": "xs", "weight": "bold", "flex": 5 }
                        ]
                    },
                    {
                        "type": "box", "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": "📅 วัน-เวลา:", "size": "xs", "color": "#888888", "flex": 2 },
                            { "type": "text", "text": now_str, "size": "xs", "flex": 5 }
                        ]
                    },
                    {
                        "type": "box", "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": "📍 พิกัด:", "size": "xs", "color": "#888888", "flex": 2 },
                            { "type": "text", "text": f"{lat:.6f}, {lng:.6f}", "size": "xs", "flex": 5 }
                        ]
                    },
                    {
                        "type": "box", "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": "📏 ระยะห่าง:", "size": "xs", "color": "#888888", "flex": 2 },
                            { "type": "text", "text": f"{round(distance_home)} เมตรจากบ้าน", "size": "xs", "flex": 5 }
                        ]
                    },
                    {
                        "type": "box", "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": "⚡ ความเร็ว:", "size": "xs", "color": "#888888", "flex": 2 },
                            { "type": "text", "text": f"{speed:.1f} กม./ชม.", "size": "xs", "flex": 5 }
                        ]
                    },
                    {
                        "type": "box", "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": "🔋 แบตเตอรี่:", "size": "xs", "color": "#888888", "flex": 2 },
                            { "type": "text", "text": f"{battery}%", "size": "xs", "flex": 5 }
                        ]
                    },
                    { "type": "separator", "margin": "sm" },
                    { "type": "text", "text": f"⏱️ โหมดการส่ง: {theme['interval']}", "size": "xxs", "color": "#999999" }
                ]
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "paddingAll": "12px",
                "contents": [
                    {
                        "type": "button",
                        "style": "primary",
                        "color": theme['color'],
                        "height": "sm",
                        "action": {
                            "type": "uri",
                            "label": "🗺️ เปิด Google Maps",
                            "uri": maps_url
                        }
                    }
                ]
            }
        }
    }

    try:
        if len(target_uids) == 1:
            api_url = "https://api.line.me/v2/bot/message/push"
            payload = { "to": target_uids[0], "messages": [flex_message] }
        else:
            api_url = "https://api.line.me/v2/bot/message/multicast"
            payload = { "to": target_uids, "messages": [flex_message] }

        req = urllib.request.Request(
            api_url,
            data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            headers={
                "Content-Type": "application/json; charset=UTF-8",
                "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[LINE OA] ส่งแจ้งเตือนสำเร็จไปยัง {len(target_uids)} ผู้ดูแล (HTTP {resp.status})")
            return True
    except Exception as e:
        print(f"[LINE OA ERROR] ไม่สามารถส่ง LINE ได้: {e}")
        return False

# -----------------------------------------------------------------------------
# HTTP Request Handler
# -----------------------------------------------------------------------------
class AdminRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 1. API: /api/admin/stats
        if path == '/api/admin/stats':
            for dev in devices_db.values():
                recalculate_device_mode(dev)
            all_devs = list(devices_db.values())
            outside = sum(1 for d in all_devs if d.get('status', {}).get('currentMode') == 'OUTSIDE')
            moving = sum(1 for d in all_devs if d.get('status', {}).get('currentMode') == 'MOVING')
            stationary = len(all_devs) - outside - moving
            self.send_json({
                'totalDevices': len(all_devs),
                'onlineDevices': len(all_devs),
                'outsideAlerts': outside,
                'movingCount': moving,
                'stationaryCount': stationary,
                'lowBatteryCount': sum(1 for d in all_devs if d.get('status', {}).get('battery', 100) <= 20)
            })
            return

        # 1.1 API: /api/sync-gas
        if path == '/api/sync-gas':
            result = sync_devices_from_gas()
            self.send_json(result)
            return

        # 2. API: /api/devices
        if path == '/api/devices':
            res = {}
            for dev_id, dev in devices_db.items():
                recalculate_device_mode(dev)
                d_copy = dict(dev)
                d_copy['recentHistory'] = device_history.get(dev_id, [])[:10]
                res[dev_id] = d_copy
            self.send_json(res)
            return

        # 3. API: /api/devices/<id>
        if path.startswith('/api/devices/'):
            parts = path.strip('/').split('/')
            if len(parts) == 3:
                dev_id = parts[2]
                if dev_id in devices_db:
                    d_copy = dict(devices_db[dev_id])
                    d_copy['history'] = device_history.get(dev_id, [])
                    self.send_json(d_copy)
                    return
                else:
                    self.send_error(404, "Device not found")
                    return

        # 4. API: /api/status
        if path == '/api/status':
            first_dev = list(devices_db.values())[0] if devices_db else {}
            self.send_json({
                'trackerState': first_dev.get('status', {}),
                'homeConfig': { 'latitude': DEFAULT_HOME_LAT, 'longitude': DEFAULT_HOME_LNG, 'radiusMeters': DEFAULT_HOME_RADIUS }
            })
            return

        # 5. Route: / or /admin -> serve admin_dashboard/index.html
        if path in ['/', '/admin', '/admin/']:
            self.serve_file(os.path.join(ADMIN_DIR, 'index.html'), 'text/html')
            return

        if path.startswith('/admin/'):
            sub_file = path[len('/admin/'):]
            target = os.path.join(ADMIN_DIR, sub_file)
            if os.path.isfile(target):
                self.serve_file(target)
                return

        # 6. Route: /manage -> serve geofence_map
        if path in ['/manage', '/manage/']:
            self.serve_file(os.path.join(MANAGE_DIR, 'manage_patient.html'), 'text/html')
            return

        if path.startswith('/manage/'):
            sub_file = path[len('/manage/'):]
            target = os.path.join(MANAGE_DIR, sub_file)
            if os.path.isfile(target):
                self.serve_file(target)
                return

        # Fallback to default file serving
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.read_json_body()

        # Sync GAS
        if path == '/api/sync-gas':
            result = sync_devices_from_gas()
            self.send_json(result)
            return

        # Telemetry
        if path == '/api/telemetry':
            dev_id = body.get('deviceId', 'TRACKER_01')
            lat = float(body.get('lat', DEFAULT_HOME_LAT))
            lng = float(body.get('lng', DEFAULT_HOME_LNG))
            speed = float(body.get('speed', 0.0))
            battery = int(body.get('battery', 100))

            if dev_id not in devices_db:
                devices_db[dev_id] = {
                    'deviceId': dev_id,
                    'patientName': f'ผู้ป่วย ({dev_id})',
                    'wearerPosition': 'สายรัดข้อมือ',
                    'note': 'ลงทะเบียนอัตโนมัติ',
                    'buzzer': { 'enabled': True, 'beepIntervalMs': 500 },
                    'homeFence': { 'type': 'circle', 'centerLat': DEFAULT_HOME_LAT, 'centerLng': DEFAULT_HOME_LNG, 'radiusMeters': DEFAULT_HOME_RADIUS },
                    'caregivers': [],
                    'status': {}
                }

            dev = devices_db[dev_id]
            geo = evaluate_geofence(dev, lat, lng)
            mode = 'OUTSIDE' if geo['isOutside'] else ('MOVING' if speed >= 1.5 else 'STATIONARY')

            is_muted = dev.get('status', {}).get('isAlertMuted', False)
            if not geo['isOutside'] and is_muted:
                is_muted = False

            dev['status'] = {
                'currentMode': mode,
                'isAlertMuted': is_muted,
                'lastLat': lat,
                'lastLng': lng,
                'lastSpeed': speed,
                'battery': battery,
                'distanceFromHome': round(geo['distanceFromCenter']),
                'isOnline': True,
                'lastUpdate': get_utc_now_iso()
            }

            if dev_id not in device_history:
                device_history[dev_id] = []
            device_history[dev_id].insert(0, {
                'timestamp': get_utc_now_iso(),
                'lat': lat,
                'lng': lng,
                'speed': speed,
                'battery': battery,
                'mode': mode,
                'distanceHome': round(geo['distanceFromCenter'])
            })
            save_devices(devices_db)

            # ส่งแจ้งเตือน LINE หากออกนอกเขตและไม่ได้กดพักระบบ
            sent = False
            if mode == 'OUTSIDE' and not is_muted:
                sent = send_line_notification(dev, mode=mode, lat=lat, lng=lng, speed=speed, distance_home=geo['distanceFromCenter'], battery=battery)

            self.send_json({
                'status': 'OK',
                'deviceId': dev_id,
                'currentMode': mode,
                'distanceFromHome': round(geo['distanceFromCenter']),
                'isOutsideHome': geo['isOutside'],
                'notificationSent': sent
            })
            return

        # Test LINE Alert from Admin Dashboard
        if path.startswith('/api/devices/') and path.endswith('/test-line'):
            dev_id = path.split('/')[3]
            if dev_id in devices_db:
                dev = devices_db[dev_id]
                st = dev.get('status', {})
                mode = body.get('mode', st.get('currentMode', 'OUTSIDE'))
                lat = st.get('lastLat', DEFAULT_HOME_LAT)
                lng = st.get('lastLng', DEFAULT_HOME_LNG)
                speed = st.get('lastSpeed', 0.0)
                battery = st.get('battery', 95)
                dist = st.get('distanceFromHome', 50)

                sent = send_line_notification(dev, mode=mode, lat=lat, lng=lng, speed=speed, distance_home=dist, battery=battery)
                self.send_json({'status': 'OK' if sent else 'ERROR', 'sent': sent, 'deviceId': dev_id})
                return
            else:
                self.send_error(404, "Device not found")
                return

        # Simulate
        if path.startswith('/api/devices/') and path.endswith('/simulate'):
            dev_id = path.split('/')[3]
            if dev_id in devices_db:
                dev = devices_db[dev_id]
                mode = body.get('mode', 'STATIONARY')
                speed = float(body.get('speed', 0.0))
                battery = int(body.get('battery', 90))

                fence = dev.get('homeFence', {})
                c_lat = fence.get('centerLat', DEFAULT_HOME_LAT)
                c_lng = fence.get('centerLng', DEFAULT_HOME_LNG)

                if mode == 'OUTSIDE':
                    c_lat += 0.0030
                    c_lng += 0.0030
                elif mode == 'MOVING':
                    c_lat += 0.0002
                    c_lng += 0.0002

                geo = evaluate_geofence(dev, c_lat, c_lng)
                dev['status'] = {
                    'currentMode': mode,
                    'isAlertMuted': dev.get('status', {}).get('isAlertMuted', False),
                    'lastLat': c_lat,
                    'lastLng': c_lng,
                    'lastSpeed': speed,
                    'battery': battery,
                    'distanceFromHome': round(geo['distanceFromCenter']),
                    'isOnline': True,
                    'lastUpdate': get_utc_now_iso()
                }

                if dev_id not in device_history:
                    device_history[dev_id] = []
                device_history[dev_id].insert(0, {
                    'timestamp': get_utc_now_iso(),
                    'lat': c_lat,
                    'lng': c_lng,
                    'speed': speed,
                    'battery': battery,
                    'mode': mode,
                    'distanceHome': round(geo['distanceFromCenter'])
                })
                save_devices(devices_db)

                # ส่ง LINE จำลอง หากตั้งเป็น OUTSIDE
                sent = False
                if mode == 'OUTSIDE':
                    sent = send_line_notification(dev, mode='OUTSIDE', lat=c_lat, lng=c_lng, speed=speed, distance_home=geo['distanceFromCenter'], battery=battery)

                self.send_json({
                    'status': 'OK',
                    'simulated': True,
                    'detectedMode': mode,
                    'distanceFromHome': round(geo['distanceFromCenter']),
                    'notificationSent': sent
                })
                return

        # Mute toggle
        if path.startswith('/api/devices/') and path.endswith('/mute'):
            dev_id = path.split('/')[3]
            if dev_id in devices_db:
                dev = devices_db[dev_id]
                dev['status']['isAlertMuted'] = body.get('isMuted', not dev.get('status', {}).get('isAlertMuted', False))
                save_devices(devices_db)
                self.send_json({'status': 'OK', 'isAlertMuted': dev['status']['isAlertMuted']})
                return

        # Buzzer toggle
        if path.startswith('/api/devices/') and path.endswith('/buzzer'):
            dev_id = path.split('/')[3]
            if dev_id in devices_db:
                dev = devices_db[dev_id]
                dev['buzzer']['enabled'] = body.get('enabled', not dev.get('buzzer', {}).get('enabled', True))
                save_devices(devices_db)
                self.send_json({'status': 'OK', 'buzzerEnabled': dev['buzzer']['enabled']})
                return

        # Add Device
        if path == '/api/devices':
            dev_id = body.get('deviceId')
            if not dev_id:
                self.send_error(400, "Device ID required")
                return
            devices_db[dev_id] = body
            devices_db[dev_id]['status'] = {
                'currentMode': 'STATIONARY',
                'isAlertMuted': False,
                'lastLat': body.get('homeFence', {}).get('centerLat', DEFAULT_HOME_LAT),
                'lastLng': body.get('homeFence', {}).get('centerLng', DEFAULT_HOME_LNG),
                'lastSpeed': 0,
                'battery': 100,
                'distanceFromHome': 0,
                'isOnline': True,
                'lastUpdate': get_utc_now_iso()
            }
            save_devices(devices_db)
            push_device_to_gas(devices_db[dev_id])
            self.send_json({'status': 'OK', 'device': devices_db[dev_id]})
            return

        # Bind Device from Caregiver Form (/manage or form.html)
        if path == '/api/bind-device':
            dev_id = body.get('deviceId', 'TRACKER_01')
            patient_name = body.get('patientName', 'คุณตาสมชาย')
            note = body.get('note', '')
            buzzer = body.get('buzzer', {'enabled': True, 'beepIntervalMs': 500})
            caregivers = body.get('caregivers', [])
            home_fence = body.get('homeFence', {})

            fence_obj = {
                'type': 'circle',
                'radiusMeters': 50,
                'centerLat': DEFAULT_HOME_LAT,
                'centerLng': DEFAULT_HOME_LNG,
                'polygon': []
            }
            if home_fence:
                poly = home_fence.get('polygon', [])
                if poly and len(poly) >= 3:
                    c_lat = sum(p[0] for p in poly) / len(poly)
                    c_lng = sum(p[1] for p in poly) / len(poly)
                    fence_obj = {
                        'type': 'polygon',
                        'centerLat': c_lat,
                        'centerLng': c_lng,
                        'radiusMeters': home_fence.get('radiusMeters', 50),
                        'polygon': poly
                    }
                else:
                    fence_obj = {
                        'type': home_fence.get('type', 'circle'),
                        'centerLat': home_fence.get('centerLat', DEFAULT_HOME_LAT),
                        'centerLng': home_fence.get('centerLng', DEFAULT_HOME_LNG),
                        'radiusMeters': home_fence.get('radiusMeters', 50),
                        'polygon': home_fence.get('polygon', [])
                    }

            if dev_id not in devices_db:
                devices_db[dev_id] = {
                    'deviceId': dev_id,
                    'patientName': patient_name,
                    'note': note,
                    'wearerPosition': 'สายรัดแขนข้อมือซ้าย',
                    'hardware': {
                        'board': 'iLabs Challenger+ RP2350 NB-IoT',
                        'gnss': 'ST87M01-1301 Concurrent GNSS',
                        'sim': '1NCE IoT SIM (APN: iot.1nce.net)',
                        'fwVersion': 'v1.2.0'
                    },
                    'buzzer': buzzer,
                    'homeFence': fence_obj,
                    'caregivers': caregivers,
                    'status': {
                        'currentMode': 'STATIONARY',
                        'isAlertMuted': False,
                        'lastLat': fence_obj['centerLat'],
                        'lastLng': fence_obj['centerLng'],
                        'lastSpeed': 0,
                        'battery': 100,
                        'distanceFromHome': 0,
                        'isOnline': True,
                        'lastUpdate': get_utc_now_iso()
                    }
                }
            else:
                dev = devices_db[dev_id]
                dev['patientName'] = patient_name
                dev['note'] = note
                dev['buzzer'] = buzzer
                dev['homeFence'] = fence_obj
                dev['caregivers'] = caregivers

            save_devices(devices_db)
            push_device_to_gas(devices_db[dev_id])
            self.send_json({'status': 'OK', 'message': 'Device bound successfully', 'device': devices_db[dev_id]})
            return

        self.send_error(404, "Endpoint not found")

    def do_PUT(self):
        parts = self.path.strip('/').split('/')
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'devices':
            dev_id = parts[2]
            if dev_id in devices_db:
                body = self.read_json_body()
                devices_db[dev_id].update(body)
                save_devices(devices_db)
                push_device_to_gas(devices_db[dev_id])
                self.send_json({'status': 'OK', 'device': devices_db[dev_id]})
                return
        self.send_error(404, "Device not found")

    def do_DELETE(self):
        parts = self.path.strip('/').split('/')
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'devices':
            dev_id = parts[2]
            if dev_id in devices_db:
                del devices_db[dev_id]
                save_devices(devices_db)
                self.send_json({'status': 'OK', 'message': f'Deleted {dev_id}'})
                return
        self.send_error(404, "Device not found")

    def read_json_body(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                raw_data = self.rfile.read(content_length).decode('utf-8')
                return json.loads(raw_data)
        except Exception:
            pass
        return {}

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, filepath, content_type='text/html'):
        try:
            with open(filepath, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', f'{content_type}; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Cannot read file: {e}")

def run_server():
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, AdminRequestHandler)
    print("=" * 65)
    print(f"🚀 GPS Tracker Central Admin Server เริ่มทำงานที่ Port {PORT}")
    print(f"🛡️ หน้าเว็บระบบหลังบ้าน (Admin Portal): http://localhost:{PORT}/admin")
    print(f"🗺️ หน้าเว็บลงทะเบียนผู้ป่วย (Caregiver Form): http://localhost:{PORT}/manage")
    print(f"📱 โหลดอุปกรณ์ Tracker ในระบบแล้ว {len(devices_db)} เครื่อง")
    print("=" * 65)

    import threading
    def auto_sync_worker():
        time.sleep(2)
        sync_devices_from_gas()
        while True:
            time.sleep(30)
            sync_devices_from_gas()

    sync_thread = threading.Thread(target=auto_sync_worker, daemon=True)
    sync_thread.start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
