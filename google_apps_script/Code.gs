/**
 * =============================================================================
 * Google Apps Script: LINE OA Bot + Web Form 24 ชม.
 * =============================================================================
 */

const CHANNEL_ACCESS_TOKEN = "UN4DnMZuwSyGTI1BaYYdwDPBvy8Iq+MQ6zhl3DPpmbw/d5GbMbTaHaee6DUFRGL5pfID+axOtqURn3gvT/eJqSDQ69K3RQwPs1p2Z5apaS3wriVYJqhYByELcs/2f/Yy4fSL8iWxLdUX3xvMEy6BugdB04t89/1O/w1cDnyilFU=";

// 1. เมื่อมีคนกดเปิดลิงก์ฟอร์มบนมือถือ (GET Request) -> ส่งหน้าเว็บฟอร์มให้แสดงผล
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('form')
    .setTitle('ลงทะเบียนผู้ป่วยและเครื่อง GPS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

// 2. เมื่อ LINE ส่งข้อความทักทายเข้ามา (POST Request) -> บอตตอบรหัส U...
function doPost(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    const events = contents.events;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const replyToken = event.replyToken;
      const userId = event.source.userId;

      if (replyToken && userId) {
        const replyText = 
          "👋 สวัสดีครับ!\n\n" +
          "รหัสประจำตัวผู้ดูแล (User ID) ของคุณคือ:\n\n" +
          userId + "\n\n" +
          "📋 กดคัดลอกรหัสนี้ส่งให้แอดมิน เพื่อผูกกับเครื่องติดตาม GPS ได้เลยครับ";

        sendLineReply(replyToken, replyText);
      }
    }
  } catch (err) {
    console.error("Error: " + err.message);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

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

function testAuth() {
  UrlFetchApp.fetch("https://api.line.me");
}
