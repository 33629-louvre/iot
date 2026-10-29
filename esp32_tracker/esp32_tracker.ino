/*
  =================================================================================
  ระบบติดตามตำแหน่ง GPS ผู้สวมใส่ แจ้งเตือนผู้ดูแลผ่าน LINE Official Account (LINE OA)
  บอร์ด: ESP32 + GPS Module (NEO-6M / NEO-8M)
  
  โหมดการทำงาน:
    1. GPS อยู่นิ่ง (Stationary)       -> ส่งทุก ๆ 2 ชั่วโมง  (7,200,000 ms)
    2. มีการเคลื่อนไหว (Moving)         -> ส่งทุก ๆ 2 นาที      (120,000 ms)
    3. ออกนอกเขต "บ้าน" (Outside Home) -> ส่งทุก ๆ 30 วินาที    (30,000 ms)
  =================================================================================
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HardwareSerial.h>
#include <TinyGPS++.h>
#include <math.h>

// -------------------------------------------------------------
// 1. ตั้งค่าการเชื่อมต่อ Wi-Fi และ LINE Messaging API
// -------------------------------------------------------------
const char* WIFI_SSID     = "YOUR_WIFI_SSID";         // เปลี่ยนเป็นชื่อ Wi-Fi ของท่าน
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";     // เปลี่ยนเป็นรหัสผ่าน Wi-Fi ของท่าน

// LINE OA Messaging API Config (ได้จาก https://developers.line.biz/)
const char* LINE_CHANNEL_ACCESS_TOKEN = "YOUR_LINE_CHANNEL_ACCESS_TOKEN"; 
const char* LINE_TARGET_USER_ID       = "YOUR_CAREGIVER_LINE_USER_ID";   // User ID ของผู้ดูแล (ขึ้นต้นด้วย U...)

// -------------------------------------------------------------
// 2. ตั้งค่าพิกัด "บ้าน" (Home Geofence)
// -------------------------------------------------------------
const double HOME_LATITUDE      = 13.7563;   // ตัวอย่าง: พิกัดบ้าน (Latitude)
const double HOME_LONGITUDE     = 100.5018;  // ตัวอย่าง: พิกัดบ้าน (Longitude)
const double HOME_RADIUS_METERS = 50.0;      // รัศมีเขตบ้าน (เมตร)

// -------------------------------------------------------------
// 3. ตั้งค่าเวลาตามเงื่อนไข (มิลลิวินาที: ms)
// -------------------------------------------------------------
const unsigned long INTERVAL_STATIONARY = 2UL * 60UL * 60UL * 1000UL; // 2 ชั่วโมง (7,200,000 ms)
const unsigned long INTERVAL_MOVING     = 2UL * 60UL * 1000UL;         // 2 นาที (120,000 ms)
const unsigned long INTERVAL_OUTSIDE    = 30UL * 1000UL;               // 30 วินาที (30,000 ms)

// เกณฑ์ตรวจจับการเคลื่อนไหว (Motion Thresholds)
const double SPEED_THRESHOLD_KMPH = 1.8;     // ความเร็วขั้นต่ำเพื่อถือว่าเคลื่อนไหว (km/h) ป้องกัน GPS Drift
const double DISTANCE_DELTA_METERS = 15.0;   // ระยะที่เปลี่ยนไปขั้นต่ำเพื่อยืนยันว่าเคลื่อนไหวจริง

// -------------------------------------------------------------
// ขาต่อ GPS Serial (ESP32 Serial2)
// -------------------------------------------------------------
#define GPS_RX_PIN 16 // ต่อกับ TX ของโมดูล GPS
#define GPS_TX_PIN 17 // ต่อกับ RX ของโมดูล GPS
HardwareSerial gpsSerial(2);
TinyGPSPlus gps;

// สถานะการทำงาน
enum TrackerMode {
  MODE_STATIONARY = 1,
  MODE_MOVING     = 2,
  MODE_OUTSIDE    = 3
};

TrackerMode currentMode = MODE_STATIONARY;
TrackerMode lastReportedMode = MODE_STATIONARY;
unsigned long lastSendTime = 0;

// พิกัดล่าสุดที่บันทึกไว้สำหรับเปรียบเทียบระยะการขยับ
double lastLat = 0.0;
double lastLng = 0.0;
unsigned long lastPositionUpdateTime = 0;

// -------------------------------------------------------------
// ฟังก์ชันคำนวณระยะทางแบบ Haversine Formula (หน่วย: เมตร)
// -------------------------------------------------------------
double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
  const double R = 6371000.0; // รัศมีโลกเป็นเมตร
  double phi1 = lat1 * M_PI / 180.0;
  double phi2 = lat2 * M_PI / 180.0;
  double deltaPhi = (lat2 - lat1) * M_PI / 180.0;
  double deltaLambda = (lon2 - lon1) * M_PI / 180.0;

  double a = sin(deltaPhi / 2.0) * sin(deltaPhi / 2.0) +
             cos(phi1) * cos(phi2) *
             sin(deltaLambda / 2.0) * sin(deltaLambda / 2.0);
  double c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a));

  return R * c;
}

// -------------------------------------------------------------
// ฟังก์ชันจัดรูปแบบ วันที่ และ เวลา (UTC+7 สำหรับประเทศไทย)
// -------------------------------------------------------------
String getFormattedDateTime() {
  if (!gps.date.isValid() || !gps.time.isValid()) {
    return "รอสัญญาณเวลาดาวเทียม...";
  }

  int year = gps.date.year();
  int month = gps.date.month();
  int day = gps.date.day();
  int hour = gps.time.hour() + 7; // ปรับเวลาเป็นเวลาไทย (UTC+7)
  int minute = gps.time.minute();
  int second = gps.time.second();

  // จัดการกรณีข้ามวันจากการ +7 ชั่วโมง
  if (hour >= 24) {
    hour -= 24;
    day += 1; // ในระดับอุปกรณ์ต้นแบบคำนวณคร่าวๆ หรือดึงจาก NTP ได้
  }

  char buffer[32];
  snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d %02d:%02d:%02d", year, month, day, hour, minute, second);
  return String(buffer);
}

// -------------------------------------------------------------
// ฟังก์ชันส่งพิกัดแจ้งเตือนไปยัง LINE OA (Push Message)
// -------------------------------------------------------------
bool sendLinePushNotification(double lat, double lng, double distanceHome, double speed, TrackerMode mode) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Wi-Fi] ไม่ได้เชื่อมต่อ Wi-Fi ข้ามการส่ง");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // ข้ามการตรวจ certificate validation บน ESP32 เพื่อประหยัด RAM

  const char* host = "api.line.me";
  const int httpsPort = 443;

  Serial.println("[LINE] กำลังเชื่อมต่อไปยัง api.line.me...");
  if (!client.connect(host, httpsPort)) {
    Serial.println("[LINE] เชื่อมต่อล้มเหลว!");
    return false;
  }

  String statusTitle = "";
  String statusColor = "";
  String statusBadge = "";
  String intervalText = "";

  switch (mode) {
    case MODE_OUTSIDE:
      statusTitle = "🚨 แจ้งเตือนด่วน: ออกนอกเขตบ้าน!";
      statusColor = "#D93025"; // สีแดง
      statusBadge = "🔴 ออกนอกเขตบ้าน";
      intervalText = "ส่งพิกัดทุก 30 วินาที";
      break;
    case MODE_MOVING:
      statusTitle = "🚶 กำลังเคลื่อนไหว";
      statusColor = "#F9AB00"; // สีเหลืองทอง
      statusBadge = "🟡 ตรวจพบการเคลื่อนไหว";
      intervalText = "ส่งพิกัดทุก 2 นาที";
      break;
    case MODE_STATIONARY:
    default:
      statusTitle = "🏠 อยู่นิ่งตามปกติ";
      statusColor = "#1E8E3E"; // สีเขียว
      statusBadge = "🟢 อยู่นิ่งภายในบ้าน";
      intervalText = "ส่งพิกัดทุก 2 ชั่วโมง";
      break;
  }

  String dateTimeStr = getFormattedDateTime();
  String mapsUrl = "https://www.google.com/maps/search/?api=1&query=" + String(lat, 6) + "," + String(lng, 6);

  // สร้าง LINE Flex Message JSON แบบ Compact สวยงาม
  String payload = "{";
  payload += "\"to\":\"" + String(LINE_TARGET_USER_ID) + "\",";
  payload += "\"messages\":[";
  payload += "{";
  payload += "\"type\":\"flex\",";
  payload += "\"altText\":\"" + statusTitle + "\",";
  payload += "\"contents\":{";
  payload += "  \"type\":\"bubble\",";
  payload += "  \"header\":{";
  payload += "    \"type\":\"box\",\"layout\":\"vertical\",";
  payload += "    \"backgroundColor\":\"" + statusColor + "\",";
  payload += "    \"contents\":[";
  payload += "      {\"type\":\"text\",\"text\":\"" + statusTitle + "\",\"weight\":\"bold\",\"color\":\"#FFFFFF\",\"size\":\"md\"}";
  payload += "    ]";
  payload += "  },";
  payload += "  \"body\":{";
  payload += "    \"type\":\"box\",\"layout\":\"vertical\",\"spacing\":\"md\",";
  payload += "    \"contents\":[";
  payload += "      {\"type\":\"text\",\"text\":\"สถานะ: " + statusBadge + "\",\"weight\":\"bold\",\"size\":\"sm\"},";
  payload += "      {\"type\":\"text\",\"text\":\"📅 วัน-เวลา: " + dateTimeStr + "\",\"size\":\"xs\",\"color\":\"#555555\"},";
  payload += "      {\"type\":\"text\",\"text\":\"📍 พิกัด: " + String(lat, 6) + ", " + String(lng, 6) + "\",\"size\":\"xs\",\"color\":\"#555555\"},";
  payload += "      {\"type\":\"text\",\"text\":\"📏 ระยะห่างจากบ้าน: " + String((int)distanceHome) + " เมตร\",\"size\":\"xs\",\"color\":\"#555555\"},";
  payload += "      {\"type\":\"text\",\"text\":\"⚡ ความเร็ว: " + String(speed, 1) + " กม./ชม.\",\"size\":\"xs\",\"color\":\"#555555\"},";
  payload += "      {\"type\":\"text\",\"text\":\"⏱️ รอบการส่ง: " + intervalText + "\",\"size\":\"xs\",\"color\":\"#888888\"}";
  payload += "    ]";
  payload += "  },";
  payload += "  \"footer\":{";
  payload += "    \"type\":\"box\",\"layout\":\"vertical\",";
  payload += "    \"contents\":[";
  payload += "      {";
  payload += "        \"type\":\"button\",";
  payload += "        \"style\":\"primary\",";
  payload += "        \"color\":\"" + statusColor + "\",";
  payload += "        \"action\":{";
  payload += "          \"type\":\"uri\",";
  payload += "          \"label\":\"🗺️ เปิดดูบน Google Maps\",";
  payload += "          \"uri\":\"" + mapsUrl + "\"";
  payload += "        }";
  payload += "      }";
  payload += "    ]";
  payload += "  }";
  payload += "}";
  payload += "}";
  payload += "]}";

  // ส่ง HTTP POST ไปที่ LINE API
  client.println("POST /v2/bot/message/push HTTP/1.1");
  client.println("Host: " + String(host));
  client.println("Authorization: Bearer " + String(LINE_CHANNEL_ACCESS_TOKEN));
  client.println("Content-Type: application/json; charset=UTF-8");
  client.print("Content-Length: ");
  client.println(payload.length());
  client.println("Connection: close");
  client.println();
  client.println(payload);

  // ตรวจสอบผลลัพธ์
  while (client.connected()) {
    String line = client.readStringUntil('\n');
    if (line.startsWith("HTTP/1.1")) {
      Serial.println("[LINE ตอบกลับ] " + line);
      if (line.indexOf("200 OK") > 0) {
        Serial.println("[LINE] ✅ ส่งข้อความสำเร็จ!");
        client.stop();
        return true;
      }
    }
    if (line == "\r") {
      break;
    }
  }
  client.stop();
  return false;
}

// -------------------------------------------------------------
// Setup
// -------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  Serial.println("\n=============================================");
  Serial.println("  ระบบติดตาม GPS สวมใส่ (Wearable Tracker)  ");
  Serial.println("=============================================");

  // เชื่อมต่อ Wi-Fi
  Serial.print("[Wi-Fi] กำลังเชื่อมต่อ: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int wifiRetries = 0;
  while (WiFi.status() != WL_CONNECTED && wifiRetries < 20) {
    delay(500);
    Serial.print(".");
    wifiRetries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] เชื่อมต่อสำเร็จ! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[Wi-Fi] เชื่อมต่อไม่สำเร็จ (จะลองใหม่ในลูป)");
  }

  Serial.println("[GPS] รอสัญญาณดาวเทียม...");
}

// -------------------------------------------------------------
// Main Loop
// -------------------------------------------------------------
void loop() {
  // อ่านข้อมูล NMEA จากโมดูล GPS
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // ตรวจสอบว่าได้พิกัด GPS ที่ถูกต้องแล้วหรือไม่
  if (gps.location.isValid()) {
    double currentLat = gps.location.lat();
    double currentLng = gps.location.lng();
    double speedKmph  = gps.speed.isValid() ? gps.speed.kmph() : 0.0;

    // คำนวณระยะห่างจาก "บ้าน" (Home Geofence)
    double distFromHome = calculateDistance(currentLat, currentLng, HOME_LATITUDE, HOME_LONGITUDE);

    // ตรวจจับการเคลื่อนไหว
    // 1. ตรวจสอบจากความเร็ว GPS
    bool isMoving = (speedKmph >= SPEED_THRESHOLD_KMPH);

    // 2. ตรวจสอบจากการขยับตำแหน่งเทียบกับจุดล่าสุด
    if (lastLat != 0.0 && lastLng != 0.0) {
      double deltaDistance = calculateDistance(currentLat, currentLng, lastLat, lastLng);
      if (deltaDistance >= DISTANCE_DELTA_METERS) {
        isMoving = true;
      }
    }

    // อัปเดตพิกัดอ้างอิงทุก ๆ 10 วินาที
    if (millis() - lastPositionUpdateTime > 10000) {
      lastLat = currentLat;
      lastLng = currentLng;
      lastPositionUpdateTime = millis();
    }

    // ---------------------------------------------------------
    // ตรรกะการประเมินโหมด 3 ลำดับ (Priority State Machine)
    // ---------------------------------------------------------
    TrackerMode newMode;
    unsigned long targetInterval = INTERVAL_STATIONARY;

    if (distFromHome > HOME_RADIUS_METERS) {
      // โหมด 3: ออกนอกเขตบ้าน (ความสำคัญสูงสุด)
      newMode = MODE_OUTSIDE;
      targetInterval = INTERVAL_OUTSIDE; // 30 วินาที
    } else if (isMoving) {
      // โหมด 2: มีการเคลื่อนไหว (แต่อยู่ในเขตบ้าน)
      newMode = MODE_MOVING;
      targetInterval = INTERVAL_MOVING;  // 2 นาที
    } else {
      // โหมด 1: อยู่นิ่งภายในบ้าน
      newMode = MODE_STATIONARY;
      targetInterval = INTERVAL_STATIONARY; // 2 ชั่วโมง
    }

    currentMode = newMode;

    // ---------------------------------------------------------
    // ตรวจสอบเงื่อนไขเวลาในการส่ง
    // 1. ครบเวลาของรอบโหมดนั้น ๆ
    // 2. มีการเปลี่ยนโหมดแบบฉับพลัน (เช่น อยู่นิ่งแล้ววิ่งออกนอกบ้านทันที)
    // ---------------------------------------------------------
    bool shouldSend = false;
    unsigned long elapsed = millis() - lastSendTime;

    if (lastSendTime == 0) {
      // ส่งทันทีครั้งแรกหลังจับสัญญาณได้
      shouldSend = true;
    } else if (currentMode == MODE_OUTSIDE && lastReportedMode != MODE_OUTSIDE) {
      // เปลี่ยนจากโหมดปกติเป็น "ออกนอกบ้าน" ให้ส่งเตือนทันที!
      shouldSend = true;
    } else if (elapsed >= targetInterval) {
      // ครบกำหนดเวลาตามโหมด
      shouldSend = true;
    }

    if (shouldSend) {
      Serial.println("\n---------------------------------------------");
      Serial.print("[โหมดปัจจุบัน] ");
      if (currentMode == MODE_OUTSIDE) Serial.println("3: ออกนอกเขตบ้าน (ทุก 30 วินาที)");
      else if (currentMode == MODE_MOVING) Serial.println("2: กำลังเคลื่อนไหว (ทุก 2 นาที)");
      else Serial.println("1: อยู่นิ่ง (ทุก 2 ชั่วโมง)");

      Serial.print("พิกัด: "); Serial.print(currentLat, 6); Serial.print(", "); Serial.println(currentLng, 6);
      Serial.print("ระยะห่างจากบ้าน: "); Serial.print(distFromHome); Serial.println(" เมตร");
      Serial.print("ความเร็ว: "); Serial.print(speedKmph); Serial.println(" กม./ชม.");

      bool success = sendLinePushNotification(currentLat, currentLng, distFromHome, speedKmph, currentMode);
      if (success) {
        lastSendTime = millis();
        lastReportedMode = currentMode;
      } else {
        // หากส่งไม่สำเร็จ ลองใหม่ในอีก 5 วินาที
        lastSendTime = millis() - (targetInterval - 5000);
      }
    }
  }

  // พักรอบเล็กน้อย
  delay(100);
}

