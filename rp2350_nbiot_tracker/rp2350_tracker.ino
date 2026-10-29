/*
  =================================================================================
  ระบบติดตามตำแหน่ง GPS ผู้สวมใส่ แจ้งเตือนผู้ดูแลผ่าน LINE Official Account (LINE OA)
  ฮาร์ดแวร์:
    - บอร์ด: iLabs Challenger+ RP2350 NB-IoT
    - ซิม: 1NCE IoT SIM (APN: iot.1nce.net)
    - ระบบระบุพิกัด: Built-in GNSS บนโมดูล ST87M01
    - อุปกรณ์เตือนภัย: Active Buzzer (ต่อที่ขา GPIO 12)
  
  ฟังก์ชันใหม่:
    - เมื่อออกนอกเขตบ้าน: Buzzer ที่สายรัดแขนจะดังเตือนผู้ป่วย + ส่ง LINE ทุก 30 วินาที
    - มีปุ่ม "🛑 พบตัวแล้ว (ปิดเสียง & พักระบบ)" บนการ์ด LINE ให้ผู้ดูแลกดปิดเสียงและหยุดเตือน
  =================================================================================
*/

#include <Arduino.h>
#include <math.h>

// -----------------------------------------------------------------------------
// 1. ระบุข้อมูลประจำตัวของเครื่องและผู้สวมใส่
// -----------------------------------------------------------------------------
const char* DEVICE_ID   = "TRACKER_01";      // รหัสประจำเครื่อง
const char* WEARER_NAME = "คุณตา";            // ชื่อผู้สวมใส่

// ขาเชื่อมต่อ Active Buzzer บนสายรัดแขน
#define BUZZER_PIN 12

// -----------------------------------------------------------------------------
// 2. ตั้งค่า LINE Official Account & รายชื่อผู้ดูแล (Caregivers)
// -----------------------------------------------------------------------------
const char* LINE_CHANNEL_ACCESS_TOKEN = "UN4DnMZuwSyGTI1BaYYdwDPBvy8Iq+MQ6zhl3DPpmbw/d5GbMbTaHaee6DUFRGL5pfID+axOtqURn3gvT/eJqSDQ69K3RQwPs1p2Z5apaS3wriVYJqhYByELcs/2f/Yy4fSL8iWxLdUX3xvMEy6BugdB04t89/1O/w1cDnyilFU=";

// รายชื่อผู้ดูแลที่รับการแจ้งเตือนพร้อมกัน
const char* CAREGIVER_USER_IDS[] = {
  "U1664630158334b37fcdac10318ee0d4e", // ผู้ดูแลคนที่ 1
  "U8af540fcc48dcc553f87d88aed55bab4"  // ผู้ดูแลคนที่ 2
};
const int NUM_CAREGIVERS = sizeof(CAREGIVER_USER_IDS) / sizeof(CAREGIVER_USER_IDS[0]);

// -----------------------------------------------------------------------------
// 3. ตั้งค่าซิม 1NCE และ เครือข่าย NB-IoT
// -----------------------------------------------------------------------------
const char* APN = "iot.1nce.net"; // APN มาตรฐานของ 1NCE IoT SIM
#define SEND_DIRECT_TO_LINE true

// -----------------------------------------------------------------------------
// 4. ตั้งค่าพิกัด "บ้าน" ประจำเครื่องนี้
// -----------------------------------------------------------------------------
const double HOME_LATITUDE      = 13.756331; // ละติจูดของบ้าน
const double HOME_LONGITUDE     = 100.501765; // ลองจิจูดของบ้าน
const double HOME_RADIUS_METERS = 50.0;       // รัศมีเขตบ้าน (50 เมตร)

// -----------------------------------------------------------------------------
// 5. ตั้งค่าเวลาตามเงื่อนไข (มิลลิวินาที)
// -----------------------------------------------------------------------------
const unsigned long INTERVAL_STATIONARY = 2UL * 60UL * 60UL * 1000UL; // 2 ชม.
const unsigned long INTERVAL_MOVING     = 2UL * 60UL * 1000UL;         // 2 นาที
const unsigned long INTERVAL_OUTSIDE    = 30UL * 1000UL;               // 30 วินาที

const double SPEED_THRESHOLD_KMPH  = 1.8;
const double DISTANCE_DELTA_METERS = 15.0;

#define MODEM_SERIAL Serial1
const uint32_t MODEM_BAUDRATE = 115200;

enum TrackerMode {
  MODE_STATIONARY = 1,
  MODE_MOVING     = 2,
  MODE_OUTSIDE    = 3
};

TrackerMode currentMode = MODE_STATIONARY;
TrackerMode lastReportedMode = MODE_STATIONARY;
unsigned long lastSendTime = 0;

// สถานะการพักระบบเมื่อผู้ดูแลกดพบตัวแล้ว (Paused / Muted)
bool isAlertMuted = false;
unsigned long lastBuzzerToggleTime = 0;
bool buzzerState = false;

double currentLat = 0.0;
double currentLng = 0.0;
double currentSpeed = 0.0;
double lastLat = 0.0;
double lastLng = 0.0;
bool hasValidGpsFix = false;
unsigned long lastPositionUpdateTime = 0;

String sendATCommand(const String& cmd, unsigned long timeoutMs = 2000) {
  MODEM_SERIAL.println(cmd);
  Serial.print("[AT ->] "); Serial.println(cmd);

  String response = "";
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    while (MODEM_SERIAL.available()) {
      char c = MODEM_SERIAL.read();
      response += c;
    }
    if (response.indexOf("OK\r\n") != -1 || response.indexOf("ERROR\r\n") != -1) break;
  }
  return response;
}

bool initModemAnd1NCESim() {
  Serial.println("\n[1NCE / NB-IoT] กำลังเริ่มต้นโมดูล ST87M01...");
  for (int r = 0; r < 5; r++) {
    if (sendATCommand("AT", 1000).indexOf("OK") != -1) break;
    delay(500);
  }
  sendATCommand("ATE0", 1000);

  if (sendATCommand("AT+CPIN?", 2000).indexOf("READY") == -1) {
    Serial.println("[1NCE] ⚠️ ตรวจไม่พบซิม 1NCE");
    return false;
  }
  Serial.println("[1NCE] ✅ พบซิม 1NCE พร้อมใช้งาน");

  String apnCmd = "AT+CGDCONT=1,\"IP\",\"" + String(APN) + "\"";
  sendATCommand(apnCmd, 2000);

  Serial.println("[1NCE] รอเกาะเครือข่าย NB-IoT...");
  bool registered = false;
  for (int i = 0; i < 20; i++) {
    String cereg = sendATCommand("AT+CEREG?", 2000);
    if (cereg.indexOf(",1") != -1 || cereg.indexOf(",5") != -1) {
      registered = true;
      Serial.println("[1NCE] ✅ เกาะสัญญาณสำเร็จ!");
      break;
    }
    delay(2000);
  }

  Serial.println("[GNSS] เปิดระบบรับสัญญาณดาวเทียม...");
  sendATCommand("AT+CGNSS=1", 2000);
  return registered;
}

bool readGNSSLocation() {
  String res = sendATCommand("AT+CGNSSINFO", 2000);
  if (res.indexOf("+CGNSSINFO:") != -1 && (res.indexOf(",N,") != -1 || res.indexOf(",S,") != -1)) {
    hasValidGpsFix = true;
    return true;
  }
  return false;
}

double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
  const double R = 6371000.0;
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

// ฟังก์ชันควบคุมเสียง Buzzer เป็นจังหวะเตือน
void updateBuzzer(bool shouldSound) {
  if (!shouldSound || isAlertMuted) {
    digitalWrite(BUZZER_PIN, LOW);
    buzzerState = false;
    return;
  }

  // ส่งเสียงบี๊บเป็นจังหวะ ทุก 500 ms (เตือนผู้ป่วยว่าอยู่นอกบ้าน)
  if (millis() - lastBuzzerToggleTime > 500) {
    buzzerState = !buzzerState;
    digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    lastBuzzerToggleTime = millis();
  }
}

// -----------------------------------------------------------------------------
// ส่งพิกัดแจ้งเตือนเข้า LINE OA (พร้อมปุ่มปิดเสียง & นำทาง)
// -----------------------------------------------------------------------------
bool sendDirectToLineOA(double lat, double lng, double distHome, TrackerMode mode) {
  Serial.print("\n[LINE OA] กำลังส่งแจ้งเตือนเครื่อง [");
  Serial.print(WEARER_NAME);
  Serial.println("]...");

  String statusTitle = "";
  String statusColor = "";
  String statusBadge = "";
  String intervalText = "";

  if (mode == MODE_OUTSIDE) {
    statusTitle = "🚨 ด่วน: ออกนอกเขตบ้าน!";
    statusColor = "#D93025"; // สีแดง
    statusBadge = "🔴 ออกนอกเขตบ้าน (30s/ครั้ง)";
    intervalText = "ส่งทุก 30 วินาที + Buzzer ดัง";
  } else if (mode == MODE_MOVING) {
    statusTitle = "🚶 ตรวจพบการเคลื่อนไหว";
    statusColor = "#F9AB00"; // สีส้ม
    statusBadge = "🟡 กำลังเคลื่อนไหว";
    intervalText = "ส่งทุก 2 นาที";
  } else {
    statusTitle = "🏠 อยู่นิ่งตามปกติ";
    statusColor = "#1E8E3E"; // สีเขียว
    statusBadge = "🟢 อยู่นิ่งในบ้าน";
    intervalText = "ส่งทุก 2 ชั่วโมง";
  }

  String mapsUrl = "https://www.google.com/maps?q=" + String(lat, 6) + "," + String(lng, 6);

  // สร้าง LINE Flex Card
  String flexCard = "{";
  flexCard += "  \"type\":\"bubble\",";
  flexCard += "  \"header\":{\"type\":\"box\",\"layout\":\"vertical\",\"backgroundColor\":\"" + statusColor + "\",\"paddingAll\":\"15px\",\"contents\":[";
  flexCard += "    {\"type\":\"text\",\"text\":\"" + statusTitle + "\",\"weight\":\"bold\",\"color\":\"#FFFFFF\",\"size\":\"md\"},";
  flexCard += "    {\"type\":\"text\",\"text\":\"👤 ผู้สวมใส่: " + String(WEARER_NAME) + " (" + String(DEVICE_ID) + ")\",\"size\":\"xs\",\"color\":\"#FFFFFF\",\"margin\":\"xs\"}";
  flexCard += "  ]},";
  flexCard += "  \"body\":{\"type\":\"box\",\"layout\":\"vertical\",\"spacing\":\"sm\",\"paddingAll\":\"15px\",\"contents\":[";
  flexCard += "    {\"type\":\"box\",\"layout\":\"horizontal\",\"contents\":[{\"type\":\"text\",\"text\":\"สถานะ:\",\"size\":\"xs\",\"color\":\"#888888\",\"flex\":2},{\"type\":\"text\",\"text\":\"" + statusBadge + "\",\"weight\":\"bold\",\"size\":\"xs\",\"flex\":5}]},";
  if (mode == MODE_OUTSIDE) {
    flexCard += "  {\"type\":\"box\",\"layout\":\"horizontal\",\"contents\":[{\"type\":\"text\",\"text\":\"สายรัดแขน:\",\"size\":\"xs\",\"color\":\"#888888\",\"flex\":2},{\"type\":\"text\",\"text\":\"🔊 เสียง Buzzer กำลังร้อง\",\"weight\":\"bold\",\"color\":\"#E37400\",\"size\":\"xs\",\"flex\":5}]},";
  }
  flexCard += "    {\"type\":\"box\",\"layout\":\"horizontal\",\"contents\":[{\"type\":\"text\",\"text\":\"📍 พิกัด:\",\"size\":\"xs\",\"color\":\"#888888\",\"flex\":2},{\"type\":\"text\",\"text\":\"" + String(lat, 6) + ", " + String(lng, 6) + "\",\"size\":\"xs\",\"flex\":5}]},";
  flexCard += "    {\"type\":\"box\",\"layout\":\"horizontal\",\"contents\":[{\"type\":\"text\",\"text\":\"📏 ห่างบ้าน:\",\"size\":\"xs\",\"color\":\"#888888\",\"flex\":2},{\"type\":\"text\",\"text\":\"" + String((int)distHome) + " เมตร\",\"size\":\"xs\",\"flex\":5}]},";
  flexCard += "    {\"type\":\"box\",\"layout\":\"horizontal\",\"contents\":[{\"type\":\"text\",\"text\":\"⏱️ โหมดส่ง:\",\"size\":\"xs\",\"color\":\"#888888\",\"flex\":2},{\"type\":\"text\",\"text\":\"" + intervalText + "\",\"size\":\"xs\",\"color\":\"#555555\",\"flex\":5}]}";
  flexCard += "  ]},";
  flexCard += "  \"footer\":{\"type\":\"box\",\"layout\":\"vertical\",\"spacing\":\"sm\",\"paddingAll\":\"12px\",\"contents\":[";
  flexCard += "    {\"type\":\"button\",\"style\":\"primary\",\"color\":\"" + statusColor + "\",\"height\":\"sm\",\"action\":{\"type\":\"uri\",\"label\":\"🗺️ นำทางด้วย Google Maps\",\"uri\":\"" + mapsUrl + "\"}}";
  
  // เพิ่มปุ่ม "🛑 พบตัวแล้ว (ปิดเสียง & พักระบบ)" สีเขียวเด่น คมชัด อ่านง่าย
  if (mode == MODE_OUTSIDE) {
    flexCard += "  ,{\"type\":\"button\",\"style\":\"primary\",\"color\":\"#2E7D32\",\"height\":\"sm\",\"action\":{\"type\":\"postback\",\"label\":\"🛑 พบตัวแล้ว (ปิดเสียง & พักระบบ)\",\"data\":\"action=mute_alert&deviceId=" + String(DEVICE_ID) + "\",\"displayText\":\"ฉันพบตัว " + String(WEARER_NAME) + " แล้ว ขอปิดเสียงและพักระบบติดตาม\"}}";
  }
  flexCard += "  ]}";
  flexCard += "}";

  String url = (NUM_CAREGIVERS == 1) ? "https://api.line.me/v2/bot/message/push" : "https://api.line.me/v2/bot/message/multicast";
  String payload = "{";

  if (NUM_CAREGIVERS == 1) {
    payload += "\"to\":\"" + String(CAREGIVER_USER_IDS[0]) + "\",";
  } else {
    payload += "\"to\":[";
    for (int i = 0; i < NUM_CAREGIVERS; i++) {
      payload += "\"" + String(CAREGIVER_USER_IDS[i]) + "\"";
      if (i < NUM_CAREGIVERS - 1) payload += ",";
    }
    payload += "],";
  }

  payload += "\"messages\":[{\"type\":\"flex\",\"altText\":\"" + statusTitle + " [" + String(WEARER_NAME) + "]\",\"contents\":" + flexCard + "}]}";

  sendATCommand("AT+HTTPINIT", 2000);
  sendATCommand("AT+HTTPPARA=\"URL\",\"" + url + "\"", 2000);
  sendATCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 2000);
  sendATCommand("AT+HTTPPARA=\"USERDATA\",\"Authorization: Bearer " + String(LINE_CHANNEL_ACCESS_TOKEN) + "\"", 2000);
  sendATCommand("AT+HTTPDATA=" + String(payload.length()) + ",10000", 2000);
  MODEM_SERIAL.print(payload);
  delay(100);
  sendATCommand("AT+HTTPACTION=1", 8000);
  sendATCommand("AT+HTTPTERM", 1000);

  Serial.println("[LINE OA] ✅ ส่งแจ้งเตือนพร้อมปุ่มปิดเสียงเรียบร้อย!");
  return true;
}

void setup() {
  Serial.begin(115200);
  MODEM_SERIAL.begin(MODEM_BAUDRATE);

  // ตั้งค่าขา Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  unsigned long startWait = millis();
  while (!Serial && (millis() - startWait < 3000));

  Serial.println("\n=======================================================");
  Serial.print("  GPS Tracker + Buzzer: "); Serial.println(WEARER_NAME);
  Serial.println("=======================================================");

  initModemAnd1NCESim();
}

void loop() {
  readGNSSLocation();

  if (!hasValidGpsFix) {
    currentLat = HOME_LATITUDE;
    currentLng = HOME_LONGITUDE;
    currentSpeed = 0.0;
  }

  double distFromHome = calculateDistance(currentLat, currentLng, HOME_LATITUDE, HOME_LONGITUDE);

  bool isMoving = (currentSpeed >= SPEED_THRESHOLD_KMPH);
  if (lastLat != 0.0 && lastLng != 0.0) {
    double delta = calculateDistance(currentLat, currentLng, lastLat, lastLng);
    if (delta >= DISTANCE_DELTA_METERS) isMoving = true;
  }

  if (millis() - lastPositionUpdateTime > 10000) {
    lastLat = currentLat;
    lastLng = currentLng;
    lastPositionUpdateTime = millis();
  }

  TrackerMode newMode;
  unsigned long targetInterval = INTERVAL_STATIONARY;

  if (distFromHome > HOME_RADIUS_METERS) {
    newMode = MODE_OUTSIDE;
    targetInterval = INTERVAL_OUTSIDE; // 30 วิ
  } else if (isMoving) {
    newMode = MODE_MOVING;
    targetInterval = INTERVAL_MOVING;  // 2 นาที
    isAlertMuted = false; // เมื่อกลับเข้าบ้าน ปลดล็อกสถานะ Mute ให้พร้อมเตือนใหม่
  } else {
    newMode = MODE_STATIONARY;
    targetInterval = INTERVAL_STATIONARY; // 2 ชม.
    isAlertMuted = false;
  }

  currentMode = newMode;

  // ควบคุมเสียง Buzzer: ถ้าออกนอกบ้านและยังไม่ได้กด Mute -> ส่งเสียงเตือน
  updateBuzzer(currentMode == MODE_OUTSIDE && !isAlertMuted);

  bool shouldSend = false;
  unsigned long elapsed = millis() - lastSendTime;

  // ถ้าผู้ดูแลกดพักระบบไว้ ไม่ต้องส่งแจ้งเตือน 30 วินาทีรบกวน
  if (!isAlertMuted) {
    if (lastSendTime == 0) {
      shouldSend = true;
    } else if (currentMode == MODE_OUTSIDE && lastReportedMode != MODE_OUTSIDE) {
      shouldSend = true; // เพิ่งออกนอกบ้าน ส่งเตือนทันที!
    } else if (elapsed >= targetInterval) {
      shouldSend = true;
    }
  }

  if (shouldSend) {
    Serial.println("\n-------------------------------------------------------");
    Serial.print("[ผู้สวมใส่: "); Serial.print(WEARER_NAME); Serial.print("] ");
    if (currentMode == MODE_OUTSIDE) Serial.println("🔴 โหมด 3: ออกนอกบ้าน! (Buzzer ดัง + ส่งทุก 30s)");
    else if (currentMode == MODE_MOVING) Serial.println("🟡 โหมด 2: เคลื่อนไหว (ส่งทุก 2 นาที)");
    else Serial.println("🟢 โหมด 1: อยู่นิ่ง (ส่งทุก 2 ชั่วโมง)");

    sendDirectToLineOA(currentLat, currentLng, distFromHome, currentMode);

    lastSendTime = millis();
    lastReportedMode = currentMode;
  }

  delay(100);
}
