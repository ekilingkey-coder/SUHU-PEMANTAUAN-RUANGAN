/**
 * Google Apps Script Backend untuk Pemantauan Suhu SPPG Pandeglang Patia Ciawi
 *
 * Cara Pasang:
 * 1. Buka Google Sheet baru -> klik menu Extensions -> Apps Script
 * 2. Hapus kode default, tempel seluruh kode ini, lalu Save (Ctrl+S)
 * 3. Klik Deploy -> New deployment -> Type: Web app
 * 4. Execute as: "Me" | Who has access: "Anyone"
 * 5. Klik Deploy -> Authorize access -> salin Web App URL
 * 6. Tempel Web App URL tersebut di menu "☁️ Google Sheet" pada aplikasi web
 */

var SHEET_DATA = "Data_Pemantauan";
var SHEET_SETTINGS = "Pengaturan";

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    }
  }
  return sheet;
}

function sanitizeCell(val) {
  var s = String(val === undefined || val === null ? "" : val);
  return /^[=\+\-@]/.test(s) ? "'" + s : s;
}

function createJsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "ping";
    if (action === "ping") {
      return createJsonResponse({ status: "ok", message: "SPPG Google Sheet API aktif" });
    }

    if (action === "load") {
      var period = (e.parameter && e.parameter.period) || "";
      var dataSheet = getOrCreateSheet(SHEET_DATA, ["periodKey", "updatedAt", "payloadJson"]);
      var settingsSheet = getOrCreateSheet(SHEET_SETTINGS, ["key", "valueJson", "updatedAt"]);

      var periodData = null;
      if (period) {
        var rows = dataSheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          if (String(rows[i][0]) === String(period)) {
            try {
              periodData = JSON.parse(rows[i][2]);
            } catch (_) {}
            break;
          }
        }
      }

      var settingsData = null;
      var sRows = settingsSheet.getDataRange().getValues();
      for (var j = 1; j < sRows.length; j++) {
        if (String(sRows[j][0]) === "settings") {
          try {
            settingsData = JSON.parse(sRows[j][1]);
          } catch (_) {}
          break;
        }
      }

      return createJsonResponse({
        status: "ok",
        period: period,
        periodData: periodData,
        settings: settingsData
      });
    }

    return createJsonResponse({ status: "error", message: "Action tidak dikenal" });
  } catch (err) {
    return createJsonResponse({ status: "error", message: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = lock.tryLock(15000);
  if (!hasLock) {
    return createJsonResponse({ status: "error", message: "Server sibuk. Coba beberapa saat lagi." });
  }

  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var action = body.action;
    var nowIso = new Date().toISOString();

    if (action === "savePeriod") {
      var period = String(body.period || "");
      if (!period) {
        return createJsonResponse({ status: "error", message: "Parameter period wajib diisi" });
      }

      var dataSheet = getOrCreateSheet(SHEET_DATA, ["periodKey", "updatedAt", "payloadJson"]);
      var rows = dataSheet.getDataRange().getValues();
      var payloadStr = JSON.stringify(body.periodData || {});
      var foundRow = -1;

      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === period) {
          foundRow = i + 1;
          break;
        }
      }

      if (foundRow > 0) {
        dataSheet.getRange(foundRow, 2).setValue(nowIso);
        dataSheet.getRange(foundRow, 3).setValue(payloadStr);
      } else {
        dataSheet.appendRow([sanitizeCell(period), nowIso, payloadStr]);
      }

      if (body.settings) {
        var settingsSheet = getOrCreateSheet(SHEET_SETTINGS, ["key", "valueJson", "updatedAt"]);
        var sRows = settingsSheet.getDataRange().getValues();
        var sFound = -1;
        for (var j = 1; j < sRows.length; j++) {
          if (String(sRows[j][0]) === "settings") {
            sFound = j + 1;
            break;
          }
        }
        var sStr = JSON.stringify(body.settings);
        if (sFound > 0) {
          settingsSheet.getRange(sFound, 2).setValue(sStr);
          settingsSheet.getRange(sFound, 3).setValue(nowIso);
        } else {
          settingsSheet.appendRow(["settings", sStr, nowIso]);
        }
      }

      return createJsonResponse({ status: "ok", updatedAt: nowIso });
    }

    return createJsonResponse({ status: "error", message: "Action tidak dikenal" });
  } catch (err) {
    return createJsonResponse({ status: "error", message: String(err) });
  } finally {
    if (hasLock) lock.releaseLock();
  }
}
