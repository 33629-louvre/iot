/**
 * =============================================================================
 * Google Apps Script: LINE OA Bot + Web Form + Google Sheets 24 ชม.
 * =============================================================================
 */

const CHANNEL_ACCESS_TOKEN = "UN4DnMZuwSyGTI1BaYYdwDPBvy8Iq+MQ6zhl3DPpmbw/d5GbMbTaHaee6DUFRGL5pfID+axOtqURn3gvT/eJqSDQ69K3RQwPs1p2Z5apaS3wriVYJqhYByELcs/2f/Yy4fSL8iWxLdUX3xvMEy6BugdB04t89/1O/w1cDnyilFU=";
const FORM_URL = "https://script.google.com/macros/s/AKfycbwdNLK2VmcznQ9beF9dgV6tKbPZicYgBio1gJ-N4e8CYWfKlq_Y4Np72AhN1MVh7Ao3/exec?openExternalBrowser=1";

// ข้อมูลเริ่มต้นของระบบ (ใช้กรณีที่ยังไม่มีการกรอกข้อมูลในแบบฟอร์ม)
const DEFAULT_PATIENT_DATA = {
  deviceId: "TRACKER_01",
  patientName: "คุณตาสมชาย",
  note: "ผู้ป่วยอัลไซเมอร์ สวมสายรัดแขนข้อมือซ้าย",
  buzzer: { enabled: true, beepIntervalMs: 500 },
  homeFence: {
    type: "polygon",
    radiusMeters: 50,
    polygon: [
      [13.75650, 100.50160],
      [13.75655, 100.50200],
      [13.75615, 100.50205],
      [13.75610, 100.50165]
    ]
  },
  caregivers: [
    {
      userId: "U1664630158334b37fcdac10318ee0d4e",
      name: "ผู้ดูแลคนที่ 1 (ของคุณ)",
      phone: "081-xxx-xxxx"
    },
    {
      userId: "U8af540fcc48dcc553f87d88aed55bab4",
      name: "ผู้ดูแลคนที่ 2 (ของเพื่อน)",
      phone: "089-xxx-xxxx"
    }
  ]
};

// 1. ส่งหน้าเว็บฟอร์มเมื่อมีคนเปิดลิงก์ (GET Request)
// รับ ?userId=Uxxx เพื่อแยกข้อมูลรายบุคคล
function doGet(e) {
  const userId = (e && e.parameter && e.parameter.userId) ? e.parameter.userId : '';
  const template = HtmlService.createTemplateFromFile('form');
  template.userId = userId;
  return template.evaluate()
    .setTitle('ลงทะเบียนผู้ป่วยและเครื่อง GPS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

// 2. เมื่อมีข้อความส่งเข้ามาใน LINE (POST Request / Webhook)
function doPost(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    const events = contents.events;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const replyToken = event.replyToken;
      const userId = event.source.userId;

      if (!replyToken || !userId) continue;

      const userText = (event.message && event.message.text) ? event.message.text.trim() : "";
      const lowerText = userText.toLowerCase();

      // เงื่อนไข 1: พิมพ์ "ขอรหัส" -> ส่งเฉพาะ User ID พร้อมลิงก์ฟอร์มส่วนตัว
      if (userText.includes("ขอรหัส") || userText === "รหัส" || lowerText === "uid" || lowerText === "id" || lowerText === "user id") {
        // สร้างลิงก์ฟอร์มเฉพาะบุคคล (ต่อท้าย &userId=Uxxx)
        const personalFormUrl = FORM_URL + "&userId=" + userId;
        const replyText =
          "🔑 รหัสประจำตัวผู้ดูแล (User ID) ของคุณคือ:\n\n" +
          userId + "\n\n" +
          "📋 กดคัดลอกรหัสนี้เพื่อนำไปกรอกในแบบฟอร์มลงทะเบียน หรือส่งต่อให้แอดมินได้เลยครับ\n\n" +
          "📝 หรือกรอกแบบฟอร์มข้อมูลส่วนตัวของคุณได้ที่:\n" +
          personalFormUrl;

        sendLineReply(replyToken, replyText);
      }

      // เงื่อนไข 2: พิมพ์ "ขอข้อมูล" -> ส่งข้อมูลทุกอย่างของเครื่องและผู้ป่วยทันที!
      else if (userText.includes("ข้อมูล") || userText.includes("เช็ค") || userText.includes("สถานะ") || userText.includes("ผู้ป่วย") || userText.includes("รั้ว")) {
        let dev = null;
        let sheetUrl = "";

        try {
          const props = PropertiesService.getScriptProperties();
          const sheetId = props.getProperty('SPREADSHEET_ID');
          if (sheetId) {
            sheetUrl = "https://docs.google.com/spreadsheets/d/" + sheetId;
          }

          const boundDeviceId = props.getProperty('caregiver_' + userId.trim());
          if (boundDeviceId) {
            const raw = props.getProperty('device_' + boundDeviceId);
            if (raw) dev = JSON.parse(raw);
          }
          if (!dev) {
            const latestId = props.getProperty('latest_device');
            if (latestId) {
              const raw = props.getProperty('device_' + latestId);
              if (raw) dev = JSON.parse(raw);
            }
          }
        } catch (err) {}

        // หากยังไม่มีการบันทึกใหม่ ให้ดึงข้อมูลตั้งต้น
        if (!dev) {
          dev = DEFAULT_PATIENT_DATA;
        }

        // หาชื่อของผู้ดูแลที่ถามอยู่ตอนนี้
        let myName = "ผู้ดูแล";
        let myPhone = "-";
        let myIndex = -1;
        if (dev.caregivers && dev.caregivers.length > 0) {
          for (let ci = 0; ci < dev.caregivers.length; ci++) {
            if (dev.caregivers[ci].userId && dev.caregivers[ci].userId.trim() === userId.trim()) {
              myName = dev.caregivers[ci].name || "ผู้ดูแล";
              myPhone = dev.caregivers[ci].phone || "-";
              myIndex = ci + 1;
              break;
            }
          }
        }

        // รวมรายชื่อผู้ดูแลทั้งหมด (ไฮไลต์คนที่ถาม)
        let caregiversText = "";
        if (dev.caregivers && dev.caregivers.length > 0) {
          caregiversText = dev.caregivers.map(function(cg, idx) {
            const isMe = (cg.userId && cg.userId.trim() === userId.trim());
            const prefix = isMe ? "   ★ " : "   " + (idx + 1) + ". ";
            const suffix = isMe ? " ← คุณ" : "";
            return prefix + (cg.name || "ผู้ดูแล") + " (" + (cg.phone || "-") + ")" + suffix;
          }).join("\n");
        } else {
          caregiversText = "   - ยังไม่มีผู้ดูแลในระบบ";
        }

        const fencePoints = (dev.homeFence && dev.homeFence.polygon) ? dev.homeFence.polygon.length : 0;
        const fenceInfo = fencePoints > 0 ? ("กำหนดแล้ว (" + fencePoints + " มุม) 🏡") : "ยังไม่ได้กำหนด";

        // หัวข้อทักทายเฉพาะบุคคล
        const greeting = myIndex > 0
          ? "สวัสดีครับ คุณ" + myName + " (ผู้ดูแลคนที่ " + myIndex + ")\n📱 เบอร์โทร: " + myPhone + "\n\n"
          : "สวัสดีครับ! (User ID ของคุณยังไม่ได้ลงทะเบียนในระบบ)\n\n";

        let replyText =
          greeting +
          "📋 ข้อมูลทั้งหมดที่บันทึกในระบบ:\n\n" +
          "🏷️ รหัสเครื่อง GPS: " + (dev.deviceId || "-") + "\n" +
          "👤 ผู้ป่วย / ผู้สวมใส่: " + (dev.patientName || "-") + "\n" +
          "📝 อาการ / หมายเหตุ: " + (dev.note || "ไม่มี") + "\n" +
          "🔊 เสียง Buzzer สายรัดแขน: " + (dev.buzzer && dev.buzzer.enabled ? "เปิดใช้งาน 🔊" : "ปิด 🔇") + "\n" +
          "🏡 แนวรั้วบ้าน: " + fenceInfo + "\n\n" +
          "👥 ผู้ดูแลทั้งหมด (" + (dev.caregivers ? dev.caregivers.length : 0) + " คน):\n" +
          caregiversText + "\n\n" +
          "📝 ตรวจสอบพิกัดรั้วบ้านหรือแก้ไขข้อมูล:\n" +
          FORM_URL;

        if (sheetUrl) {
          replyText += "\n\n📊 ตาราง Google Sheet:\n" + sheetUrl;
        }

        sendLineReply(replyToken, replyText);
      }

      // เงื่อนไข 3: ข้อความอื่น ๆ -> แนะนำคำสั่ง
      else {
        const replyText =
          "👋 สวัสดีครับผู้ดูแล!\n\n" +
          "เมนูคำสั่งที่คุณสามารถพิมพ์ได้:\n" +
          "• พิมพ์ \"ขอรหัส\" -> ระบบจะส่งรหัส User ID ให้ทันที\n" +
          "• พิมพ์ \"ขอข้อมูล\" -> ระบบจะตรวจสอบ User ID และส่งข้อมูลทุกอย่างให้\n\n" +
          "📝 หรือเปิดแบบฟอร์มลงทะเบียน/ตั้งค่าแนวรั้วบ้าน:\n" +
          FORM_URL;

        sendLineReply(replyToken, replyText);
      }
    }
  } catch (err) {
    console.error("Error: " + err.message);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// -----------------------------------------------------------------------------
// ระบบจัดเก็บข้อมูล (บันทึกลงทั้ง Google Sheets ใน Google Drive และ PropertiesService)
// -----------------------------------------------------------------------------

// บันทึกข้อมูลที่ผู้ดูแลกรอกลง Google Sheet และ PropertiesService
function savePatientData(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const deviceId = data.deviceId || 'TRACKER_01';

    // 1. บันทึกลง PropertiesService (เพื่อดึงตอบแชท LINE ได้ทันที 24 ชม.)
    props.setProperty('device_' + deviceId, JSON.stringify(data));
    props.setProperty('latest_device', deviceId);

    if (data.caregivers && Array.isArray(data.caregivers)) {
      data.caregivers.forEach(function(cg) {
        if (cg.userId) {
          props.setProperty('caregiver_' + cg.userId.trim(), deviceId);
        }
      });
    }

    // 2. บันทึกลง Google Sheet ใน Google Drive ของคุณโดยอัตโนมัติ!
    let sheetUrl = "";
    try {
      const sheet = getOrCreateSheet();
      const caregiversStr = (data.caregivers || []).map(function(cg) {
        return (cg.name || "ผู้ดูแล") + " (" + (cg.userId || "") + ")";
      }).join(", ");
      const fencePoints = (data.homeFence && data.homeFence.polygon) ? data.homeFence.polygon.length : 0;
      const nowStr = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");

      sheet.appendRow([
        nowStr,
        data.deviceId,
        data.patientName,
        data.note || "-",
        (data.buzzer && data.buzzer.enabled) ? "เปิดใช้งาน" : "ปิด",
        fencePoints + " มุม",
        caregiversStr,
        JSON.stringify(data.homeFence ? data.homeFence.polygon : [])
      ]);

      sheetUrl = sheet.getParent().getUrl();
    } catch(sheetErr) {
      console.error("Sheet error:", sheetErr);
    }

    return {
      success: true,
      message: "บันทึกข้อมูลเรียบร้อยแล้ว",
      sheetUrl: sheetUrl
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ฟังก์ชันสร้างหรือเปิด Google Sheet ใน Google Drive อัตโนมัติ
function getOrCreateSheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('SPREADSHEET_ID');
  let ss = null;

  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      ss = null;
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create("ข้อมูลผู้ป่วยและเครื่อง GPS (GPS Tracker)");
    props.setProperty('SPREADSHEET_ID', ss.getId());
    const sheet = ss.getActiveSheet();
    sheet.setName("ประวัติการลงทะเบียน");
    sheet.appendRow([
      "วัน-เวลาที่บันทึก",
      "รหัสเครื่อง (Device ID)",
      "ชื่อผู้ป่วย/ผู้สวมใส่",
      "อาการ/หมายเหตุ",
      "เสียงเตือน Buzzer",
      "จำนวนมุมรั้วบ้าน",
      "รายชื่อผู้ดูแลที่ผูก",
      "พิกัดแนวรั้ว (JSON)"
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setBackground("#1A73E8").setFontColor("#FFFFFF").setFontWeight("bold");
  }

  return ss.getActiveSheet();
}

// ดึงข้อมูลผู้ป่วยและเครื่องมาแสดงผลในแบบฟอร์ม
function getPatientData(deviceId) {
  try {
    const props = PropertiesService.getScriptProperties();
    const targetId = deviceId || props.getProperty('latest_device') || 'TRACKER_01';
    const raw = props.getProperty('device_' + targetId);
    if (raw) return JSON.parse(raw);
  } catch (err) {}
  return DEFAULT_PATIENT_DATA;
}

// ส่งข้อความตอบกลับไปยัง LINE Messaging API
function sendLineReply(replyToken, messageText) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const payload = {
    replyToken: replyToken,
    messages: [{ type: "text", text: messageText }]
  };

  const options = {
    method: "post",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Authorization": "Bearer " + CHANNEL_ACCESS_TOKEN
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  UrlFetchApp.fetch(url, options);
}
