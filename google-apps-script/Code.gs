/**
 * Smart POS Pro — Google Apps Script (Code.gs)
 * รองรับทั้งการซิงค์แบบเรียลไทม์ต่อบิล (appendRows) และการซิงค์ฐานข้อมูล
 * ทั้งหมดแบบเขียนทับ (fullReplace) จาก sync.js / sheetsFullSync.js
 *
 * วิธีติดตั้ง:
 * 1. เปิด Google Sheet ที่จะใช้เก็บข้อมูล (แนะนำให้สร้างไฟล์ใหม่เปล่าๆ)
 * 2. เมนู ส่วนขยาย (Extensions) > Apps Script
 * 3. ลบโค้ดเดิมทั้งหมด แล้ววางโค้ดนี้แทน (ตั้งชื่อไฟล์ว่า Code.gs)
 * 4. กด Deploy > New deployment > เลือกประเภท "Web app"
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 5. คัดลอก Web app URL ที่ได้ ไปวางใน ⚙️ ตั้งค่า > Google Sheets URL ในแอป POS
 *
 * ทุกครั้งที่แก้โค้ดนี้แล้วอยาก deploy ใหม่ ต้องกด Deploy > Manage deployments
 * > แก้ไข (ไอคอนดินสอ) > Version: New version — ไม่งั้น URL เดิมจะยังรันโค้ดเก่าอยู่
 */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'ping') {
      return jsonOut({ result: 'ok', message: 'Smart POS Sync is alive' });
    }

    if (action === 'appendRows') {
      return handleAppendRows(body);
    }

    if (action === 'fullReplace') {
      return handleFullReplace(body);
    }

    return jsonOut({ result: 'error', message: 'Unknown action: ' + action });

  } catch (err) {
    return jsonOut({ result: 'error', message: err.message });
  }
}

function doGet(e) {
  return jsonOut({ status: 'Smart POS Sync is running' });
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Real-time per-sale append. De-duplicates by the FIRST column (the row's ID) so the
 *  app's built-in retry logic can never create a duplicate row if a request is retried
 *  after actually succeeding. */
function handleAppendRows(body) {
  const sheet = getOrCreateSheet(body.sheetName, body.headers);
  const rows = body.rows || [];
  if (rows.length === 0) return jsonOut({ result: 'success', appended: 0 });

  const existingIds = getExistingIds(sheet);
  const newRows = rows.filter(r => !existingIds.has(String(r[0])));

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  return jsonOut({ result: 'success', appended: newRows.length, skippedDuplicates: rows.length - newRows.length });
}

/** Full-database sync: clears everything below the header row and rewrites it from
 *  scratch. This is intentionally simple (no diffing) — state.db in the app is always
 *  the source of truth, so a clean replace is more robust than trying to merge. */
function handleFullReplace(body) {
  const sheet = getOrCreateSheet(body.sheetName, body.headers);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  const rows = body.rows || [];
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  return jsonOut({ result: 'success', written: rows.length });
}

function getOrCreateSheet(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  // Keep headers in sync with what the app sends (handles the case where a column
  // was added to js/db/sheetsSchema.js after the sheet was first created).
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const headersMatch = headers.every((h, i) => currentHeaders[i] === h);
  if (!headersMatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getExistingIds(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(String);
  return new Set(ids);
}
