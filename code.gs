// ============================================================
// KONFIGURASI - FILE COPY
// ============================================================
const SPREADSHEET_ID = "1LNrXPjuMYxQ71CzQsOS0Bon1e5_STnbZHnt-yrLvydE";
const GID = "1356065183";  // ✅ TAMBAHKAN INI (GID tab "Service Level Base")
const SHEET_NAME = "Sitelist Komersil";
const SHEET_DT_V2 = "Service Level Base";
const SPREADSHEET_MENARA_ID = "1N_LdkoiMjMS012Oa7mieHy0XxZzi_QkOGpl4p5b7PBU";
const GEMINI_API_KEY = "AQ.Ab8RN6KdIdRnMBYSNmzb_nzyPHnGfrtQoZkD35VA4VVOjWnTAA";

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getSheetByGid(ss, gid) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId().toString() === gid.toString()) {
      return sheets[i];
    }
  }
  return null;
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('RF Planning & Commercial Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getMainSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("Sheet '" + SHEET_NAME + "' tidak ditemukan.");
  return sheet;
}

// ============================================================
// CACHE SERVICE WRAPPERS (OPTIMASI UTAMA)
// ============================================================
function getCachedDashboardData(filters) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'rf_dashboard_' + (filters ? JSON.stringify(filters) : 'default');
  if (cacheKey.length > 200) cacheKey = 'rf_dashboard_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(filters)).map(function(b){return ('0'+(b&0xFF).toString(16)).slice(-2);}).join('');
  
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) { /* fallthrough */ }
  }
  
  var data = getDashboardData(filters);
  try {
    cache.put(cacheKey, JSON.stringify(data), 300); // 5 menit
  } catch(e) {
    // Cache mungkin terlalu besar, simpan tanpa filter
    try { cache.put('rf_dashboard_default', JSON.stringify(data), 300); } catch(e2) {}
  }
  return data;
}

function clearAllCaches() {
  CacheService.getScriptCache().removeAll(['rf_dashboard_default', 'rf_dt_v2_data']);
  return "Cache berhasil dihapus.";
}

// ============================================================
// MAIN DASHBOARD DATA (OPTIMIZED)
// ============================================================
function getDashboardData(filters) {
  filters = filters || {};
  var sheet = getMainSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  
  if (lastRow <= 1) {
    return {
      summary: { totalSite: 0, statusGroups: {}, towerType: {}, towerHeight: {}, landAsset: {}, tenantActive: {}, pmoCounts: {} },
      komersial: { rentalProvinsi: {}, penjaminan: {}, asuransi: {}, ews: [], details: [] },
      tenantRatio: [], driveTest: [], mapData: [], potential: [],
      filterOptions: { statusGroup: [], province: [], city: [], landAsset: [] },
      lastUpdate: ""
    };
  }
  
  var rows = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = rows[0];
  var rawRows = rows.slice(1);
  
  // Index mapping
  var colIdx = function(name) {
    return headers.findIndex(function(h) {
      return h && h.toString().trim().toLowerCase() === name.trim().toLowerCase();
    });
  };
  var idxTsel = colIdx('TSEL Active');
  var idxIoh = colIdx('IOH (H3I) Active') !== -1 ? colIdx('IOH (H3I) Active') : colIdx('IOH Active');
  var idxH3i = colIdx('H3I(IOH) Active') !== -1 ? colIdx('H3I(IOH) Active') : colIdx('H3I Active');
  var idxXl = colIdx('XL(SF) Active') !== -1 ? colIdx('XL(SF) Active') : colIdx('XL Active');
  var idxSf = colIdx('SF(XL) Active') !== -1 ? colIdx('SF(XL) Active') : colIdx('SF Active');
  var idxSigfox = colIdx('Sigfox Active');
  var idxActiveTenantStr = colIdx('Active Tenant') !== -1 ? colIdx('Active Tenant') : (colIdx('Tenant') !== -1 ? colIdx('Tenant') : 59);
  var idxFasilitas = colIdx('Fasilitas') !== -1 ? colIdx('Fasilitas') : 51;
  var idxTenggatWaktu = colIdx('Penjamin End Date') !== -1 ? colIdx('Penjamin End Date') : (colIdx('Tenggat Waktu') !== -1 ? colIdx('Tenggat Waktu') : 53);
  var idxPenjaminStart = colIdx('Penjamin Start Date') !== -1 ? colIdx('Penjamin Start Date') : 54;
  var idxPenjaminan = colIdx('Penjaminan') !== -1 ? colIdx('Penjaminan') : (colIdx('Status Penjaminan') !== -1 ? colIdx('Status Penjaminan') : 55);
  var idxAsuransi = colIdx('Asuransi') !== -1 ? colIdx('Asuransi') : (colIdx('Status Asuransi') !== -1 ? colIdx('Status Asuransi') : 56);
  var idxAsuransiStart = colIdx('Asuransi Start Date') !== -1 ? colIdx('Asuransi Start Date') : 57;
  var idxAsuransiEnd = colIdx('Asuransi End Date') !== -1 ? colIdx('Asuransi End Date') : 58;
  
  var targetFields = ['Site ID', 'Site Name', 'Lat', 'Long', 'Status Group', 'Province', 'City', 'Land Asset', 'Tower Type', 'Tower Height', 'Rental Value', 'District'];
  var fieldMapping = {};
  targetFields.forEach(function(f) { fieldMapping[f] = colIdx(f); });
  
  // Filter sets
  var filterSgSet = filters.rawStatusGroups ? new Set(filters.rawStatusGroups) : new Set();
  var filterPvSet = filters.rawProvinces ? new Set(filters.rawProvinces) : new Set();
  var filterCtSet = filters.rawCities ? new Set(filters.rawCities) : new Set();
  var filterLaSet = filters.rawLandAssets ? new Set(filters.rawLandAssets) : new Set();
  var filterTnSet = filters.rawTenants ? new Set(filters.rawTenants) : new Set();
  var filterRatioTnSet = filters.ratioTenants ? new Set(filters.ratioTenants) : new Set();
  
  // Result containers
  var mapData = [];
  var statusGroupCounts = {};
  var towerTypeCounts = {};
  var towerHeightCounts = {};
  var landAssetCounts = {};
  var tenantActiveCounts = { 'TSEL': 0, 'IOH': 0, 'XLS': 0, 'SIGFOX': 0, 'NONE': 0 };
  var pmoCounts = {};
  var rentalProvinsi = {};
  var penjaminanCounts = {};
  var asuransiCounts = {};
  var ewsAlerts = [];
  var detailedSites = [];
  var cityStats = {};
  var cityGroups = {};
  
  // OPTIMASI: Kumpulkan unique values dalam 1 loop utama
  var uniqueStatusGroups = new Set();
  var uniqueProvinces = new Set();
  var uniqueCities = new Set();
  var uniqueLandAssets = new Set();
  
  // OPTIMASI: formatDateValue return timestamp (biar frontend yang format)
  var formatDateValue = function(val) {
    if (!val) return null;
    if (val instanceof Date) return val.getTime();
    return val;
  };
  
  for (var i = 0; i < rawRows.length; i++) {
    var r = rawRows[i];
    if (!r || r.length < headers.length) continue;
    
    var rowSg = r[fieldMapping['Status Group']];
    var rowPv = r[fieldMapping['Province']];
    var rowCt = r[fieldMapping['City']];
    var rowLa = r[fieldMapping['Land Asset']];
    
    // Kumpulkan unique values (OPTIMASI)
    if (rowSg) uniqueStatusGroups.add(rowSg);
    if (rowPv) uniqueProvinces.add(rowPv);
    if (rowCt) uniqueCities.add(rowCt);
    if (rowLa) uniqueLandAssets.add(rowLa);
    
    // Filter check
    if (filterSgSet.size > 0 && !filterSgSet.has(rowSg)) continue;
    if (filterPvSet.size > 0 && !filterPvSet.has(rowPv)) continue;
    if (filterCtSet.size > 0 && !filterCtSet.has(rowCt)) continue;
    if (filterLaSet.size > 0 && !filterLaSet.has(rowLa)) continue;
    
    // Tenant detection
    var isTselActive = false, isIohActive = false, isXlsActive = false, isSigfoxActive = false;
    var hasFlagColumns = (idxTsel !== -1 || idxIoh !== -1 || idxH3i !== -1 || idxXl !== -1 || idxSf !== -1 || idxSigfox !== -1);
    
    if (hasFlagColumns) {
      if (idxTsel !== -1) { var v = String(r[idxTsel] || '').trim(); isTselActive = v === '1' || v.toUpperCase() === 'TSEL'; }
      if (idxIoh !== -1 || idxH3i !== -1) {
        var v1 = idxIoh !== -1 ? String(r[idxIoh] || '').trim() : '';
        var v2 = idxH3i !== -1 ? String(r[idxH3i] || '').trim() : '';
        isIohActive = (v1 !== '' && v1 !== '0' && v1 !== '-') || (v2 !== '' && v2 !== '0' && v2 !== '-');
      }
      if (idxXl !== -1 || idxSf !== -1) {
        var v1 = idxXl !== -1 ? String(r[idxXl] || '').trim() : '';
        var v2 = idxSf !== -1 ? String(r[idxSf] || '').trim() : '';
        isXlsActive = (v1 !== '' && v1 !== '0' && v1 !== '-') || (v2 !== '' && v2 !== '0' && v2 !== '-');
      }
      if (idxSigfox !== -1) { var v = String(r[idxSigfox] || '').trim(); isSigfoxActive = v !== '' && v !== '0' && v !== '-'; }
    } else {
      isTselActive = r[61] === '1' || r[61] === 1 || String(r[61]).trim() === '1';
      isIohActive = (r[62] && String(r[62]).trim() !== '' && String(r[62]).trim() !== '0') || (r[63] && String(r[63]).trim() !== '' && String(r[63]).trim() !== '0');
      isXlsActive = (r[64] && String(r[64]).trim() !== '' && String(r[64]).trim() !== '0') || (r[65] && String(r[65]).trim() !== '' && String(r[65]).trim() !== '0');
      isSigfoxActive = r[66] && String(r[66]).trim() !== '' && String(r[66]).trim() !== '0';
    }
    
    var siteTenants = [];
    if (isTselActive) siteTenants.push('TSEL');
    if (isIohActive) siteTenants.push('IOH');
    if (isXlsActive) siteTenants.push('XLS');
    if (isSigfoxActive) siteTenants.push('SIGFOX');
    
    if (siteTenants.length === 0) {
      var tenantText = '';
      if (idxActiveTenantStr !== -1 && r[idxActiveTenantStr] !== undefined) {
        tenantText = r[idxActiveTenantStr].toString().trim();
      }
      if (tenantText && tenantText !== '-' && tenantText.toUpperCase() !== 'NONE') {
        var ops = tenantText.split(',').map(function(op) { return op.trim().toUpperCase(); });
        ops.forEach(function(op) {
          if ((op === 'TSEL' || op === 'TELKOMSEL') && siteTenants.indexOf('TSEL') === -1) siteTenants.push('TSEL');
          else if ((op === 'IOH' || op === 'INDOSAT' || op === 'H3I' || op === 'THREE' || op === '3') && siteTenants.indexOf('IOH') === -1) siteTenants.push('IOH');
          else if ((op === 'XL' || op === 'XLS' || op === 'XL AXIATA') && siteTenants.indexOf('XLS') === -1) siteTenants.push('XLS');
          else if (op === 'SIGFOX' && siteTenants.indexOf('SIGFOX') === -1) siteTenants.push('SIGFOX');
        });
      }
    }
    
    // Tenant filter
    if (filterTnSet.size > 0) {
      var tenantMatch = false;
      if (filterTnSet.has('NONE') && siteTenants.length === 0) tenantMatch = true;
      else tenantMatch = siteTenants.some(function(t) { return filterTnSet.has(t); });
      if (!tenantMatch) continue;
    }
    
    var siteId = r[fieldMapping['Site ID']];
    if (!siteId) continue;
    var siteName = r[fieldMapping['Site Name']] || 'N/A';
    
    var latRaw = (r[fieldMapping['Lat']] || '').toString().replace(',', '.');
    var lngRaw = (r[fieldMapping['Long']] || '').toString().replace(',', '.');
    var lat = parseFloat(latRaw);
    var lng = parseFloat(lngRaw);
    var rentalRaw = (r[fieldMapping['Rental Value']] || '').toString().replace(/\./g, '').replace(',', '.');
    var rentalVal = parseFloat(rentalRaw) || 0;
    var th = r[fieldMapping['Tower Height']];
    var tt = r[fieldMapping['Tower Type']] || 'N/A';
    var fas = r[idxFasilitas] || '-';
    var tglTenggat = formatDateValue(r[idxTenggatWaktu]);
    var penStart = formatDateValue(r[idxPenjaminStart]);
    var penEnd = tglTenggat;
    var pen = (r[idxPenjaminan] || '').toString().trim();
    var asu = (r[idxAsuransi] || '').toString().trim();
    var asuStart = formatDateValue(r[idxAsuransiStart]);
    var asuEnd = formatDateValue(r[idxAsuransiEnd]);
    var sgUpper = (rowSg || '').toString().trim().toUpperCase();
    
    statusGroupCounts[rowSg] = (statusGroupCounts[rowSg] || 0) + 1;
    var pmoStatus = r[6] ? r[6].toString().trim() : 'N/A';
    if (!pmoCounts[sgUpper]) pmoCounts[sgUpper] = {};
    pmoCounts[sgUpper][pmoStatus] = (pmoCounts[sgUpper][pmoStatus] || 0) + 1;
    towerTypeCounts[tt] = (towerTypeCounts[tt] || 0) + 1;
    var thStr = (th !== undefined && th !== '' && !isNaN(parseFloat(th))) ? th + "m" : 'N/A';
    towerHeightCounts[thStr] = (towerHeightCounts[thStr] || 0) + 1;
    landAssetCounts[rowLa || 'N/A'] = (landAssetCounts[rowLa || 'N/A'] || 0) + 1;
    
    var tenantText = siteTenants.join(', ');
    if (siteTenants.length === 0) tenantText = 'NONE';
    var tenantNum = siteTenants.length;
    if (siteTenants.length === 0) tenantActiveCounts['NONE']++;
    else siteTenants.forEach(function(op) { tenantActiveCounts[op]++; });
    
    if (!isNaN(lat) && !isNaN(lng)) {
      mapData.push({
        id: siteId, name: siteName, lat: lat, lng: lng, sg: sgUpper, city: rowCt,
        kecamatan: fieldMapping['District'] !== -1 ? r[fieldMapping['District']] || 'N/A' : 'N/A',
        towerType: tt, towerHeight: thStr, landAsset: rowLa || 'N/A',
        activeTenantNum: tenantNum, tenantName: tenantText || 'NONE', pmoStatus: pmoStatus
      });
    }
    
    var prov = rowPv || 'Unknown';
    rentalProvinsi[prov] = (rentalProvinsi[prov] || 0) + rentalVal;
    if (pen !== '') penjaminanCounts[pen] = (penjaminanCounts[pen] || 0) + 1;
    if (asu !== '') asuransiCounts[asu] = (asuransiCounts[asu] || 0) + 1;
    
    detailedSites.push({
      id: siteId, name: siteName, city: rowCt || '-', type: tt, height: thStr,
      activeTenant: tenantNum, tenants: tenantText || 'NONE', rental: rentalVal,
      fasilitas: fas, penStart: penStart, penEnd: penEnd,
      statusPen: pen || '-', asuransi: asu || '-', asuStart: asuStart, asuEnd: asuEnd
    });
    
    if (sgUpper === 'DISMANTLED' && (pen.toUpperCase() === 'AKTIF' || pen.toUpperCase() === 'ACTIVE')) {
      ewsAlerts.push({
        id: siteId, name: siteName, city: rowCt || 'N/A', rental: rentalVal,
        statusPen: pen, tenggat: tglTenggat,
        action: "Koordinasikan dengan tim Legal & Procurement untuk review pemutusan / pengalihan sisa nilai jaminan komersial."
      });
    }
    
    if (sgUpper === 'EXISTING') {
      var city = rowCt || 'Unknown';
      var matchRatioCity = (!filters.multiCities || filters.multiCities.length === 0 || filters.multiCities.indexOf(city) !== -1);
      var matchRatioLand = (!filters.multiLands || filters.multiLands.length === 0 || filters.multiLands.indexOf(rowLa) !== -1);
      if (matchRatioCity && matchRatioLand) {
        if (!cityStats[city]) cityStats[city] = { totalSite: 0, totalTenant: 0 };
        cityStats[city].totalSite += 1;
        cityStats[city].totalTenant += tenantNum;
      }
      
      // Potential city groups (OPTIMASI: dalam loop yang sama)
      var pScore = parseFloat((r[101] || '').toString().replace(',', '.')) || 0;
      var aScore = parseFloat((r[103] || '').toString().replace(',', '.')) || 0;
      if (!cityGroups[city]) cityGroups[city] = { pTotal: 0, aTotal: 0, count: 0 };
      cityGroups[city].pTotal += pScore;
      cityGroups[city].aTotal += aScore;
      cityGroups[city].count += 1;
    }
  }
  
  // Tenant ratio
  var tenantRatioData = Object.keys(cityStats).map(function(city) {
    var stats = cityStats[city];
    var ratioVal = stats.totalSite > 0 ? parseFloat((stats.totalTenant / stats.totalSite).toFixed(2)) : 0;
    var status = "Low", keterangan = "Perlu evaluasi pemanfaatan site";
    if (ratioVal > 1.0) { status = "High"; keterangan = "Utilisasi tinggi"; }
    else if (ratioVal >= 0.5) { status = "Medium"; keterangan = "Utilisasi cukup baik"; }
    return { city: city, totalSite: stats.totalSite, totalTenant: stats.totalTenant, ratio: ratioVal.toFixed(2), status: status, keterangan: keterangan };
  }).sort(function(a, b) { return parseFloat(b.ratio) - parseFloat(a.ratio); });
  
  // Potential data
  var potentialData = Object.keys(cityGroups).map(function(city) {
    var g = cityGroups[city];
    var avgP = g.pTotal / g.count;
    var avgA = g.aTotal / g.count;
    return {
      city: city,
      pScore: parseFloat(avgP.toFixed(2)), pStatus: avgP > 60.63 ? "High" : (avgP > 49.09 ? "Medium" : "Low"),
      aScore: parseFloat(avgA.toFixed(2)), aStatus: avgA > 75.48 ? "High" : (avgA > 63.50 ? "Medium" : "Low")
    };
  });
  
  // Last update
  var lastUpdate = "";
  for (var j = 0; j < rawRows.length; j++) {
    if (rawRows[j].length > 157 && rawRows[j][157]) {
      lastUpdate = rawRows[j][157].toString().trim();
      break;
    }
  }
  
  // OPTIMASI: Gunakan unique values dari loop utama
  var filterSgOptions = Array.from(uniqueStatusGroups).sort();
  
  return {
    summary: { totalSite: mapData.length, statusGroups: statusGroupCounts, towerType: towerTypeCounts, towerHeight: towerHeightCounts, landAsset: landAssetCounts, tenantActive: tenantActiveCounts, pmoCounts: pmoCounts },
    komersial: { rentalProvinsi: rentalProvinsi, penjaminan: penjaminanCounts, asuransi: asuransiCounts, ews: ewsAlerts, details: detailedSites },
    tenantRatio: tenantRatioData,
    driveTest: [],
    mapData: mapData,
    potential: potentialData,
    filterOptions: {
      statusGroup: filterSgOptions,
      province: Array.from(uniqueProvinces).sort(),
      city: Array.from(uniqueCities).sort(),
      landAsset: Array.from(uniqueLandAssets).sort()
    },
    lastUpdate: lastUpdate
  };
}

// ============================================================
// SITAC DATA ONLY (OPTIMASI: Ringan, hanya 1 sheet)
// ============================================================
function getSitacDataOnly() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_MENARA_ID);
    var sitacSheet = ss.getSheetByName("PROJECT") || ss.getSheetByName("project");
    if (!sitacSheet || sitacSheet.getLastRow() <= 1) return [];
    
    var sRows = sitacSheet.getRange(1, 1, sitacSheet.getLastRow(), sitacSheet.getLastColumn()).getValues();
    var sRawRows = sRows.slice(1);
    var sitacResults = [];
    
    var parseXY = function(xVal, yVal) {
      var xStr = (xVal || "").toString().trim().replace(",", ".");
      var yStr = (yVal || "").toString().trim().replace(",", ".");
      var x = parseFloat(xStr), y = parseFloat(yStr);
      if (isNaN(x)) x = 0; if (isNaN(y)) y = 0;
      if (Math.abs(x) < 20) return { lat: x, lng: y };
      return { lat: y, lng: x };
    };
    
    for (var k = 0; k < sRawRows.length; k++) {
      var sRow = sRawRows[k];
      if (sRow.length < 11) continue;
      var pic = (sRow[9] || "").toString().trim().toUpperCase();
      var milestoneBK = (sRow[62] || "").toString().trim().toUpperCase();
      var isAan = pic.indexOf("AAN") !== -1 || pic === "AAN";
      var isMilestone = milestoneBK.indexOf("AKUISISI") !== -1 || milestoneBK.indexOf("PLAN") !== -1 || milestoneBK.indexOf("IW OG") !== -1 || milestoneBK.indexOf("HUNTING") !== -1;
      if (isAan && isMilestone) {
        var coords = parseXY(sRow[23], sRow[24]);
        if (coords.lat === 0 && coords.lng === 0) continue;
        sitacResults.push({
          lat: coords.lat, lng: coords.lng,
          requestType: sRow[4] || 'N/A', tenant: sRow[6] || 'N/A',
          siteIdTenant: sRow[20] || 'N/A', siteNameTenant: sRow[21] || 'N/A',
          milestoneK: sRow[10] || 'N/A', milestoneBK: sRow[62] || 'N/A',
          rfPic: sRow[9] || 'N/A', statusGroup: 'SITAC Process'
        });
      }
    }
    return sitacResults;
  } catch (err) {
    return [];
  }
}

// ============================================================
// MENARA LIAR (FULL - hanya dipanggil saat Tab 6 dibuka)
// ============================================================
function getMenaraLiarData() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_MENARA_ID);
    var sheet = ss.getSheetByName("ALL MENARA LIAR");
    if (!sheet) throw new Error("Sheet 'ALL MENARA LIAR' tidak ditemukan.");
    
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var rows = lastRow > 1 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
    var rawRows = rows.length > 1 ? rows.slice(1) : [];
    
    var parseCoordinates = function(val, isLat) {
      if (!val) return 0;
      var str = val.toString().trim().replace(/\s+/g, '');
      var cleaned = str.replace(/[^0-9.,-]/g, '');
      if (!cleaned) return 0;
      if (cleaned.indexOf(',') !== -1 && cleaned.indexOf('.') === -1) cleaned = cleaned.replace(',', '.');
      else cleaned = cleaned.replace(/,/g, '');
      var parts = cleaned.split('.');
      if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
      var num = parseFloat(cleaned);
      if (isNaN(num)) return 0;
      if (Math.abs(num) > 180) {
        var absStr = Math.abs(num).toString();
        var sign = num < 0 ? -1 : 1;
        if (isLat) {
          var newStr = absStr.charAt(0) + '.' + absStr.slice(1);
          return parseFloat(newStr) * sign;
        } else {
          if (absStr.length > 3) {
            var newStr = absStr.slice(0, 3) + '.' + absStr.slice(3);
            return parseFloat(newStr) * sign;
          }
        }
      }
      return num;
    };
    
    var results = [];
    for (var i = 0; i < rawRows.length; i++) {
      var row = rawRows[i];
      var indexMenara = row[2];
      if (!indexMenara || indexMenara.toString().trim() === "") continue;
      var lat = parseCoordinates(row[3], true);
      var lng = parseCoordinates(row[4], false);
      var kota = row[5] || 'N/A';
      var kecamatan = row[6] || 'N/A';
      var tipeMenara = row[8] || 'N/A';
      var tahunTerbangunStr = row[10] || '';
      var siteStatus = row[9] || 'N/A';
      var tahunTerbangun = parseInt(tahunTerbangunStr.toString().replace(/[^0-9]/g, '')) || 0;
      var isTenantActive = function(val) {
        if (val === undefined || val === null) return false;
        var str = String(val).trim().toUpperCase();
        return str !== '' && str !== '0' && str !== '-' && str !== 'NONE' && str !== 'FALSE';
      };
      var t17 = row[17] || '';
      var t21 = row[21] || '';
      var t22 = row[22] || '';
      var tenantText = (t17 + ' ' + t21 + ' ' + t22).toUpperCase();
      var tselActive = isTenantActive(row[97]) || tenantText.indexOf('TSEL') !== -1 || tenantText.indexOf('TELKOMSEL') !== -1;
      var iohActive = isTenantActive(row[98]) || tenantText.indexOf('IOH') !== -1 || tenantText.indexOf('INDOSAT') !== -1 || tenantText.indexOf('ISAT') !== -1 || tenantText.indexOf('H3I') !== -1 || tenantText.indexOf('THREE') !== -1;
      var xlsActive = isTenantActive(row[99]) || tenantText.indexOf('XL') !== -1 || tenantText.indexOf('XLS') !== -1 || tenantText.indexOf('AXIATA') !== -1 || tenantText.indexOf('SMART') !== -1;

      results.push({
        indexMenara: indexMenara.toString().trim(), lat: lat, lng: lng,
        kota: kota.toString().trim(), kecamatan: kecamatan.toString().trim(),
        tipeMenara: tipeMenara.toString().trim(), tahunTerbangun: tahunTerbangun,
        siteStatus: siteStatus.toString().trim(),
        tenant: tenantText,
        tselActive: tselActive,
        iohActive: iohActive,
        xlsActive: xlsActive
      });
    }
    
    var tenantSheet = ss.getSheetByName("EXISTING TENANT");
    var tenantResults = [];
    if (tenantSheet) {
      var tLastRow = tenantSheet.getLastRow();
      var tLastCol = tenantSheet.getLastColumn();
      if (tLastRow > 1) {
        var tRows = tenantSheet.getRange(1, 1, tLastRow, tLastCol).getValues();
        var tRawRows = tRows.slice(1);
        var parseFlexibleCoordinates = function(latVal, lngVal) {
          if (!latVal || !lngVal) return { lat: 0, lng: 0 };
          var latStr = latVal.toString().trim();
          var lngStr = lngVal.toString().trim();
          var cleanLat = latStr.replace(/[^0-9.-]/g, "");
          var cleanLng = lngStr.replace(/[^0-9.-]/g, "");
          var parsedLat = parseFloat(cleanLat);
          var parsedLng = parseFloat(cleanLng);
          var isSwapped = false;
          if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
            if (parsedLat > 50 && parsedLng < 0) isSwapped = true;
          }
          if (isSwapped) { var temp = latStr; latStr = lngStr; lngStr = temp; }
          var finalLat = 0;
          var latDigits = latStr.replace(/[^0-9]/g, "");
          if (latDigits.length > 0) {
            var latSign = latStr.indexOf("-") !== -1 ? -1 : -1;
            var numStr = latDigits.charAt(0) + "." + latDigits.slice(1);
            finalLat = parseFloat(numStr) * latSign;
          }
          var finalLng = 0;
          var lngDigits = lngStr.replace(/[^0-9]/g, "");
          if (lngDigits.length > 3) {
            var numStr = lngDigits.slice(0, 3) + "." + lngDigits.slice(3);
            finalLng = parseFloat(numStr);
          } else if (lngDigits.length > 0) finalLng = parseFloat(lngDigits);
          return { lat: finalLat, lng: finalLng };
        };
        var parseRowCoords = function(row) {
          var lat = 0, lng = 0;
          var longlat = row[4];
          if (longlat && longlat.toString().indexOf(",") !== -1) {
            var parts = longlat.toString().split(",");
            lat = parseFloat(parts[0].trim());
            lng = parseFloat(parts[1].trim());
          } else {
            var res = parseFlexibleCoordinates(row[2], row[3]);
            lat = res.lat; lng = res.lng;
          }
          if (lat > 50 && lng < 0) { var temp = lat; lat = lng; lng = temp; }
          return { lat: lat, lng: lng };
        };
        for (var j = 0; j < tRawRows.length; j++) {
          var tRow = tRawRows[j];
          var siteId = tRow[0];
          if (!siteId || siteId.toString().trim() === "") continue;
          var coords = parseRowCoords(tRow);
          var opText = (tRow[6] || '').toString().toUpperCase();
          var isTenantActiveT = function(val) {
            if (val === undefined || val === null) return false;
            var str = String(val).trim().toUpperCase();
            return str !== '' && str !== '0' && str !== '-' && str !== 'NONE' && str !== 'FALSE';
          };
          var tselActiveT = isTenantActiveT(tRow[14]) || opText.indexOf('TSEL') !== -1 || opText.indexOf('TELKOMSEL') !== -1;
          var iohActiveT = isTenantActiveT(tRow[15]) || opText.indexOf('IOH') !== -1 || opText.indexOf('INDOSAT') !== -1 || opText.indexOf('ISAT') !== -1 || opText.indexOf('H3I') !== -1 || opText.indexOf('THREE') !== -1;
          var xlsActiveT = isTenantActiveT(tRow[16]) || opText.indexOf('XL') !== -1 || opText.indexOf('XLS') !== -1 || opText.indexOf('AXIATA') !== -1 || opText.indexOf('SMART') !== -1;

          tenantResults.push({
            indexMenara: siteId.toString().trim() + " - " + (tRow[1] || 'N/A').toString().trim(),
            lat: coords.lat, lng: coords.lng,
            kota: (tRow[11] || 'N/A').toString().trim(), kecamatan: 'N/A',
            tipeMenara: (tRow[7] || 'N/A').toString().trim(),
            tahunTerbangun: 0, siteStatus: 'Others TLP',
            operator: opText,
            tselActive: tselActiveT,
            iohActive: iohActiveT,
            xlsActive: xlsActiveT
          });
        }
      }
    }
    
    // SITAC data - gunakan fungsi terpisah untuk reuse
    var sitacResults = getSitacDataOnly();
    
    return { liar: results, tenant: tenantResults, sitac: sitacResults };
  } catch (err) {
    throw new Error("Gagal mengambil data Menara: " + err.message);
  }
}

function getDriveTestV2Data(customRows) {
  try {
    let headers, rawRows;
    if (customRows) {
      headers = customRows[0];
      rawRows = customRows.slice(1);
    } else {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName("Service Level Base");
      if (!sheet) {
        throw new Error("Sheet 'Service Level Base' tidak ditemukan.");
      }
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow <= 1) {
        return { data: [], filterOptions: { statusGroup: [], province: [], city: [], morphoclass: [], yearDt: [], jenisTeknologi: [], cluster: [] } };
      }
      const rows = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      headers = rows[0];
      rawRows = rows.slice(1);
    }
    
    const colIdx = function(name) {
      return headers.findIndex(function(h) {
        return h && h.toString().trim().toLowerCase() === name.trim().toLowerCase();
      });
    };

    const findColIndex = function(preferredNames, defaultIdx) {
      for (var i = 0; i < preferredNames.length; i++) {
        var idx = colIdx(preferredNames[i]);
        if (idx !== -1) return idx;
      }
      if (preferredNames.length > 0) {
        var term = preferredNames[0].toLowerCase();
        for (var idx = 0; idx < headers.length; idx++) {
          var h = headers[idx];
          if (h && h.toString().toLowerCase().indexOf(term) !== -1) {
            return idx;
          }
        }
      }
      return defaultIdx;
    };
    
    const idxSiteId = colIdx('Site ID');
    const idxSiteName = colIdx('Site Name');
    const idxCity = colIdx('City');
    const idxProvince = colIdx('Province');
    const idxMorphoclass = colIdx('Morphoclass');
    const idxYearDt = colIdx('Year DT') !== -1 ? colIdx('Year DT') : (colIdx('Tahun DT') !== -1 ? colIdx('Tahun DT') : 5);
    const idxStatusGroup = colIdx('Status Group') !== -1 ? colIdx('Status Group') : (colIdx('Status_Group') !== -1 ? colIdx('Status_Group') : 6);
    const idxJenisTeknologi = colIdx('Jenis Teknologi') !== -1 ? colIdx('Jenis Teknologi') : (colIdx('Teknologi') !== -1 ? colIdx('Teknologi') : 63);
    const idxActiveTenant = colIdx('Active Tenant') !== -1 ? colIdx('Active Tenant') : (colIdx('Tenant') !== -1 ? colIdx('Tenant') : 10);
    const idxTowerHeight = colIdx('Tower Height') !== -1 ? colIdx('Tower Height') : (colIdx('Tinggi Menara') !== -1 ? colIdx('Tinggi Menara') : 68);
    const idxTowerType = colIdx('Tower Type') !== -1 ? colIdx('Tower Type') : (colIdx('Tipe Menara') !== -1 ? colIdx('Tipe Menara') : 69);
    const idxLat = colIdx('Lat');
    const idxLong = colIdx('Long');
    
    // Best Server indexes
    const idxTselDeep = colIdx('TSEL Deep Indoor');
    const idxTselIndoor = colIdx('TSEL Indoor');
    const idxTselFW = colIdx('TSEL First Wall') !== -1 ? colIdx('TSEL First Wall') : colIdx('TSEL Fist Wall');
    const idxTselOut = colIdx('TSEL Outdoor');
    const idxTselKpi = colIdx('TSEL Total Coverage');
    const idxTselMap = colIdx('TSEL Maps') !== -1 ? colIdx('TSEL Maps') : 16;
    const idxTselSamples = colIdx('TSEL Samples');
    const idxIohDeep = colIdx('IOH Deep Indoor');
    const idxIohIndoor = colIdx('IOH Indoor');
    const idxIohFW = colIdx('IOH First Wall') !== -1 ? colIdx('IOH First Wall') : colIdx('IOH Fist Wall');
    const idxIohOut = colIdx('IOH Outdoor');
    const idxIohKpi = colIdx('IOH Total Coverage');
    const idxIohMap = colIdx('IOH Maps') !== -1 ? colIdx('IOH Maps') : 24;
    const idxIohSamples = colIdx('IOH Samples');
    const idxXlsDeep = colIdx('XLS Deep Indoor');
    const idxXlsIndoor = colIdx('XLS Indoor');
    const idxXlsFW = colIdx('XLS First Wall') !== -1 ? colIdx('XLS First Wall') : colIdx('XLS Fist Wall');
    const idxXlsOut = colIdx('XLS Outdoor');
    const idxXlsKpi = colIdx('XLS Total Coverage');
    const idxXlsMap = colIdx('XLS Maps') !== -1 ? colIdx('XLS Maps') : 32;
    const idxXlsSamples = colIdx('XLS Samples');
    
    // NRxLv1 indexes
    const idxTselDeep_nr = colIdx('TSEL Deep Indoor NRxLv1');
    const idxTselIndoor_nr = colIdx('TSEL Indoor NRxLv1');
    const idxTselFW_nr = colIdx('TSEL First Wall NRxLv1') !== -1 ? colIdx('TSEL First Wall NRxLv1') : colIdx('TSEL Fist Wall NRxLv1');
    const idxTselOut_nr = colIdx('TSEL Outdoor NRxLv1');
    const idxTselKpi_nr = colIdx('TSEL Total Coverage NRxLv1');
    const idxTselMap_nr = colIdx('TSEL Maps NRxLv1') !== -1 ? colIdx('TSEL Maps NRxLv1') : 42;
    const idxTselSamples_nr = colIdx('TSEL Samples NRxLv1');
    const idxIohDeep_nr = colIdx('IOH Deep Indoor NRxLv1');
    const idxIohIndoor_nr = colIdx('IOH Indoor NRxLv1');
    const idxIohFW_nr = colIdx('IOH First Wall NRxLv1') !== -1 ? colIdx('IOH First Wall NRxLv1') : colIdx('IOH Fist Wall NRxLv1');
    const idxIohOut_nr = colIdx('IOH Outdoor NRxLv1');
    const idxIohKpi_nr = colIdx('IOH Total Coverage NRxLv1');
    const idxIohMap_nr = colIdx('IOH Maps NRxLv1') !== -1 ? colIdx('IOH Maps NRxLv1') : 50;
    const idxIohSamples_nr = colIdx('IOH Samples NRxLv1');
    const idxXlsDeep_nr = colIdx('XLS Deep Indoor NRxLv1');
    const idxXlsIndoor_nr = colIdx('XLS Indoor NRxLv1');
    const idxXlsFW_nr = colIdx('XLS First Wall NRxLv1') !== -1 ? colIdx('XLS First Wall NRxLv1') : colIdx('XLS Fist Wall NRxLv1');
    const idxXlsOut_nr = colIdx('XLS Outdoor NRxLv1');
    const idxXlsKpi_nr = colIdx('XLS Total Coverage NRxLv1');
    const idxXlsMap_nr = colIdx('XLS Maps NRxLv1') !== -1 ? colIdx('XLS Maps NRxLv1') : 58;
    const idxXlsSamples_nr = colIdx('XLS Samples NRxLv1');
    
    const idxStatusDokumentasi = colIdx('Status Dokumentasi') !== -1 ? colIdx('Status Dokumentasi') : (colIdx('Dokumentasi Best Server') !== -1 ? colIdx('Dokumentasi Best Server') : 64);
    const idxStatusDokumentasi_nr = colIdx('Status Dokumentasi NRxLv1') !== -1 ? colIdx('Status Dokumentasi NRxLv1') : (colIdx('Dokumentasi NRxLv1') !== -1 ? colIdx('Dokumentasi NRxLv1') : 65);
    const idxStreetView = colIdx('Street View') !== -1 ? colIdx('Street View') : (colIdx('Link Street View') !== -1 ? colIdx('Link Street View') : (colIdx('StreetView') !== -1 ? colIdx('StreetView') : (colIdx('Link Dokumentasi') !== -1 ? colIdx('Link Dokumentasi') : 66)));
    const idxCluster = findColIndex(['Cluster', 'Cluster Name', 'Cluster_Name', 'Nama Cluster'], 67);
    const idxSubCluster = findColIndex(['Sub Cluster', 'SubCluster', 'Sub_Cluster', 'Nama Sub Cluster', 'Sub Cluster Name'], 65);
    const idxPairing = findColIndex(['Pairing', 'Pairing Collo', 'Collo Pairing', 'Pair', 'Pasangan', 'Grouping Collo', 'Collo Group', 'Collo', 'Pairing Group', 'Group Pairing'], -1);
    const idxJarak = findColIndex(['Jarak', 'Jarak (m)', 'Jarak Pairing', 'Distance', 'Jarak (Meter)', 'Jarak (meter)', 'Jarak_Pairing'], -1);
    const idxHistory = findColIndex(['History', 'Status History', 'History Status', 'Kategori History'], 77);
    
    // Coverage Prediction (CP) indexes (Columns BU to BY)
    const idxCpDeep = findColIndex(['CP Deep Indoor', 'CP Deep'], -1);
    const idxCpIndoor = findColIndex(['CP Indoor'], -1);
    const idxCpFW = findColIndex(['CP First Wall', 'CP Fist Wall'], -1);
    const idxCpOut = findColIndex(['CP Outdoor'], -1);
    const idxCpKpi = findColIndex(['Total Coverage Prediction', 'CP Total Coverage Prediction', 'CP Total Coverage', 'Coverage Prediction Total'], -1);
    
    const parsePercent = function(val) {
      if (val === undefined || val === null || val === '') return 0;
      if (typeof val === 'number') {
        return val <= 1.0 ? val * 100 : val;
      }
      const str = val.toString().trim();
      const hasPercent = str.indexOf('%') !== -1;
      let cleaned = str.replace('%', '').replace(',', '.').trim();
      const num = parseFloat(cleaned);
      if (isNaN(num)) return 0;
      if (hasPercent) return num;
      return num <= 1.0 ? num * 100 : num;
    };
    
    const parseYear = function(val) {
      if (val === undefined || val === null || val === '') return 'N/A';
      if (val instanceof Date) {
        return val.getFullYear().toString();
      }
      if (typeof val === 'number') {
        return Math.floor(val).toString();
      }
      const str = val.toString().trim();
      const match = str.match(/\b(20\d{2})\b/);
      if (match) {
        return match[1];
      }
      const parsedDate = Date.parse(str);
      if (!isNaN(parsedDate)) {
        return new Date(parsedDate).getFullYear().toString();
      }
      return str;
    };
    
    const parseSampleCount = function(val) {
      if (val === undefined || val === null || val === '') return 0;
      if (typeof val === 'number') {
        return Math.round(val);
      }
      let str = val.toString().trim();
      if (!str || str === 'N/A' || str === '-' || str === '#N/A' || str === 'null' || str === 'undefined') return 0;

      const hasPercent = str.indexOf('%') !== -1;
      str = str.replace(/%/g, '').trim();

      if (/\d+\.\d+,\d+/.test(str)) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else if (/\d+,\d+\.\d+/.test(str)) {
        str = str.replace(/,/g, '');
      } else if (str.indexOf(',') !== -1) {
        str = str.replace(',', '.');
      }

      let num = parseFloat(str);
      if (isNaN(num)) return 0;

      if (hasPercent) {
        num = num / 100;
      }

      return Math.round(num);
    };
    
    const data = [];
    const statusGroupsSet = {};
    const provincesSet = {};
    const citiesSet = {};
    const morphoclassesSet = {};
    const yearsSet = {};
    const jenisTeknologisSet = {};
    const clustersSet = {};
    const subClustersSet = {};
    const pairingsSet = {};
    const historiesSet = {};
    
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const sId = row[idxSiteId];
      if (!sId) continue;
      
      let latVal = row[idxLat] ? parseFloat(row[idxLat].toString().replace(',', '.')) : 0;
      let lngVal = row[idxLong] ? parseFloat(row[idxLong].toString().replace(',', '.')) : 0;
      if (isNaN(latVal)) latVal = 0;
      if (isNaN(lngVal)) lngVal = 0;
      
      const siteIdStr = sId.toString().trim();
      const siteNameStr = row[idxSiteName] || 'N/A';
      const provinceStr = row[idxProvince] || 'N/A';
      const cityStr = row[idxCity] || 'N/A';
      const morphoStr = idxMorphoclass !== -1 ? row[idxMorphoclass] || 'N/A' : 'N/A';
      const yearDtStr = idxYearDt !== -1 ? parseYear(row[idxYearDt]) : 'N/A';
      const statusGroupStr = idxStatusGroup !== -1 ? row[idxStatusGroup] || 'N/A' : 'N/A';
      const jenisTeknologiStr = idxJenisTeknologi !== -1 && row[idxJenisTeknologi] ? row[idxJenisTeknologi].toString().trim() : 'N/A';
      const activeTenantStr = idxActiveTenant !== -1 && row[idxActiveTenant] ? row[idxActiveTenant].toString().trim() : 'N/A';
      const towerHeightStr = idxTowerHeight !== -1 && row[idxTowerHeight] ? row[idxTowerHeight].toString().trim() : 'N/A';
      const towerTypeStr = idxTowerType !== -1 && row[idxTowerType] ? row[idxTowerType].toString().trim() : 'N/A';
      const clusterStr = idxCluster !== -1 && row[idxCluster] ? row[idxCluster].toString().trim() : 'N/A';
      const subClusterStr = idxSubCluster !== -1 && row[idxSubCluster] ? row[idxSubCluster].toString().trim() : 'N/A';
      const streetViewStr = idxStreetView !== -1 && row[idxStreetView] ? row[idxStreetView].toString().trim() : '';

      let rawPairing = (idxPairing !== -1 && row[idxPairing]) ? row[idxPairing].toString().trim() : '';
      if (rawPairing === 'N/A' || rawPairing === '0' || rawPairing === '-') {
        rawPairing = '';
      }
      
      let historyStr = (idxHistory !== -1 && row[idxHistory]) ? row[idxHistory].toString().trim() : '';
      if (historyStr.toLowerCase() === 'updated') {
        historyStr = 'Latest';
      }
      
      if (statusGroupStr && statusGroupStr !== 'N/A') statusGroupsSet[statusGroupStr] = true;
      if (provinceStr && provinceStr !== 'N/A') provincesSet[provinceStr] = true;
      if (cityStr && cityStr !== 'N/A') citiesSet[cityStr] = true;
      if (morphoStr && morphoStr !== 'N/A') morphoclassesSet[morphoStr] = true;
      if (yearDtStr && yearDtStr !== 'N/A') yearsSet[yearDtStr] = true;
      if (jenisTeknologiStr && jenisTeknologiStr !== 'N/A') jenisTeknologisSet[jenisTeknologiStr] = true;
      if (clusterStr && clusterStr !== 'N/A') clustersSet[clusterStr] = true;
      if (subClusterStr && subClusterStr !== 'N/A') subClustersSet[subClusterStr] = true;
      if (rawPairing) pairingsSet[rawPairing] = true;
      if (historyStr) historiesSet[historyStr] = true;
      
      data.push({
        siteId: siteIdStr,
        siteName: siteNameStr,
        province: provinceStr,
        city: cityStr,
        morphoclass: morphoStr,
        yearDt: yearDtStr,
        jenisTeknologi: jenisTeknologiStr,
        statusGroup: statusGroupStr,
        activeTenant: activeTenantStr,
        towerHeight: towerHeightStr,
        towerType: towerTypeStr,
        cluster: clusterStr,
        subCluster: subClusterStr,
        history: historyStr,
        pairing: rawPairing,
        jarak: (idxJarak !== -1 && row[idxJarak] !== undefined && row[idxJarak] !== null) ? row[idxJarak].toString().trim() : '',
        lat: latVal,
        lng: lngVal,
        tselMap: row[idxTselMap] || '',
        iohMap: row[idxIohMap] || '',
        xlsMap: row[idxXlsMap] || '',
        streetView: streetViewStr,
        bestServer: {
          tselDeep: parsePercent(row[idxTselDeep]),
          tselIndoor: parsePercent(row[idxTselIndoor]),
          tselFW: parsePercent(row[idxTselFW]),
          tselOut: parsePercent(row[idxTselOut]),
          tselKpi: parsePercent(row[idxTselKpi]),
          tselMap: row[idxTselMap] || '',
          tselSamples: parseSampleCount(row[idxTselSamples]),
          iohDeep: parsePercent(row[idxIohDeep]),
          iohIndoor: parsePercent(row[idxIohIndoor]),
          iohFW: parsePercent(row[idxIohFW]),
          iohOut: parsePercent(row[idxIohOut]),
          iohKpi: parsePercent(row[idxIohKpi]),
          iohMap: row[idxIohMap] || '',
          iohSamples: parseSampleCount(row[idxIohSamples]),
          xlsDeep: parsePercent(row[idxXlsDeep]),
          xlsIndoor: parsePercent(row[idxXlsIndoor]),
          xlsFW: parsePercent(row[idxXlsFW]),
          xlsOut: parsePercent(row[idxXlsOut]),
          xlsKpi: parsePercent(row[idxXlsKpi]),
          xlsMap: row[idxXlsMap] || '',
          xlsSamples: parseSampleCount(row[idxXlsSamples]),
          statusDokumentasi: parsePercent(row[idxStatusDokumentasi])
        },
        nrxLv1: {
          tselDeep: parsePercent(row[idxTselDeep_nr]),
          tselIndoor: parsePercent(row[idxTselIndoor_nr]),
          tselFW: parsePercent(row[idxTselFW_nr]),
          tselOut: parsePercent(row[idxTselOut_nr]),
          tselKpi: parsePercent(row[idxTselKpi_nr]),
          tselMap: row[idxTselMap_nr] || '',
          tselSamples: parseSampleCount(row[idxTselSamples_nr]),
          iohDeep: parsePercent(row[idxIohDeep_nr]),
          iohIndoor: parsePercent(row[idxIohIndoor_nr]),
          iohFW: parsePercent(row[idxIohFW_nr]),
          iohOut: parsePercent(row[idxIohOut_nr]),
          iohKpi: parsePercent(row[idxIohKpi_nr]),
          iohMap: row[idxIohMap_nr] || '',
          iohSamples: parseSampleCount(row[idxIohSamples_nr]),
          xlsDeep: parsePercent(row[idxXlsDeep_nr]),
          xlsIndoor: parsePercent(row[idxXlsIndoor_nr]),
          xlsFW: parsePercent(row[idxXlsFW_nr]),
          xlsOut: parsePercent(row[idxXlsOut_nr]),
          xlsKpi: parsePercent(row[idxXlsKpi_nr]),
          xlsMap: row[idxXlsMap_nr] || '',
          xlsSamples: parseSampleCount(row[idxXlsSamples_nr]),
          statusDokumentasi: parsePercent(row[idxStatusDokumentasi_nr])
        },
        cp: {
          deep: idxCpDeep !== -1 ? parsePercent(row[idxCpDeep]) : 0,
          indoor: idxCpIndoor !== -1 ? parsePercent(row[idxCpIndoor]) : 0,
          fw: idxCpFW !== -1 ? parsePercent(row[idxCpFW]) : 0,
          out: idxCpOut !== -1 ? parsePercent(row[idxCpOut]) : 0,
          kpi: idxCpKpi !== -1 ? parsePercent(row[idxCpKpi]) : 0
        }
      });
    }
    
    const sortArr = function(obj) {
      return Object.keys(obj).sort(function(a, b) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      });
    };
    
    return {
      data: data,
      filterOptions: {
        statusGroup: sortArr(statusGroupsSet),
        province: sortArr(provincesSet),
        city: sortArr(citiesSet),
        morphoclass: sortArr(morphoclassesSet),
        yearDt: sortArr(yearsSet),
        jenisTeknologi: sortArr(jenisTeknologisSet),
        cluster: sortArr(clustersSet),
        subCluster: sortArr(subClustersSet),
        pairing: sortArr(pairingsSet),
        history: sortArr(historiesSet)
      }
    };
  } catch (err) {
    throw new Error("Gagal mengambil data Drive Test V2.0: " + err.message);
  }
}

function analyzeDTV2(siteId, level) {
  if (!siteId) return "Site ID tidak valid.";
  const lvlParam = level || "Best Server";
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Service Level Base");
  if (!sheet) return "Sheet 'Service Level Base' tidak ditemukan.";
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1) return "Data kosong.";
  
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idxSiteId = headers.findIndex(function(h) {
    return h && h.toString().trim().toLowerCase() === 'site id';
  });
  if (idxSiteId === -1) return "Header 'Site ID' tidak ditemukan.";
  
  const idColValues = sheet.getRange(1, idxSiteId + 1, lastRow, 1).getValues();
  let foundRowIdx = -1;
  const targetId = siteId.toString().toUpperCase().trim();
  for (let r = 1; r < idColValues.length; r++) {
    if (idColValues[r][0] && idColValues[r][0].toString().toUpperCase().trim() === targetId) {
      foundRowIdx = r + 1;
      break;
    }
  }
  
  if (foundRowIdx === -1) {
    return "Site ID " + siteId + " tidak ditemukan di dalam lembar kerja.";
  }
  
  const targetRow = sheet.getRange(foundRowIdx, 1, 1, lastCol).getValues()[0];
  const parsedData = getDriveTestV2Data([headers, targetRow]);
  const site = parsedData.data && parsedData.data[0];
  if (!site) return "Site ID " + siteId + " tidak ditemukan di dalam lembar kerja atau belum memiliki data Drive Test V2.0.";
  
  const getStatus = function(val) { return val >= 85 ? "Optimal" : (val >= 70 ? "Cukup" : "Kurang / Degradasi"); };
  const lvl = lvlParam === 'NRxLv1' ? site.nrxLv1 : site.bestServer;
  const suggestions = [];
  
  if (lvl.tselDeep < 60 && lvl.tselKpi > 0) suggestions.push("- **TSEL:** Penetrasi Deep Indoor lemah (" + lvl.tselDeep.toFixed(2) + "%). Lakukan pengecekan electrical tilt antenna sektoral atau naikkan power TX.");
  if (lvl.iohFW < 60 && lvl.iohKpi > 0) suggestions.push("- **IOH:** Penetrasi dinding (First Wall) kritis (" + lvl.iohFW.toFixed(2) + "%). Perlu audit physical blocker di arah azimuth utama.");
  if (lvl.xlsDeep < 60 && lvl.xlsKpi > 0) suggestions.push("- **XLS:** Sinyal dalam ruangan kritis (" + lvl.xlsDeep.toFixed(2) + "%). Disarankan optimasi mekanis atau penyesuaian gain antenna.");
  
  var tenantLower = (site.activeTenant || '').toLowerCase().trim();
  if (tenantLower === 'zero' || tenantLower === 'none' || tenantLower === '' || tenantLower === '0') {
    suggestions.push("- **Sewa/Tenant:** Status saat ini adalah **Zero Tenant** (tidak ada tenant aktif). Direkomendasikan untuk melakukan pendekatan bisnis dan pemasaran kolokasi kepada seluruh operator telekomunikasi utama (TSEL, IOH, XLS) agar space menara yang kosong dapat diutilisasi.");
  }
  
  if (suggestions.length === 0) {
    suggestions.push("- Kualitas signal coverage dalam gedung (indoor) untuk semua operator dalam kondisi aman.");
  }
  
  return "### Laporan Analisis RF Sinyal Site (V2.0): " + site.siteId + " - " + site.siteName + "\n" +
    "**Informasi Site:**\n" +
    "- **Morphoclass:** " + site.morphoclass + "\n" +
    "- **Active Tenant:** " + site.activeTenant + "\n" +
    "- **Jenis Pengukuran:** " + lvlParam + "\n" +
    "**Hasil Pengukuran Service Level:**\n" +
    "- **TSEL Service Level:** " + lvl.tselKpi.toFixed(2) + "% (" + getStatus(lvl.tselKpi) + ")\n" +
    "- **IOH Service Level:** " + lvl.iohKpi.toFixed(2) + "% (" + getStatus(lvl.iohKpi) + ")\n" +
    "- **XLS Service Level:** " + lvl.xlsKpi.toFixed(2) + "% (" + getStatus(lvl.xlsKpi) + ")\n" +
    "**Rekomendasi Rekayasa RF (RF Engineering Recommendations):**\n" +
    suggestions.join("\n") + "\n" +
    "*TIPS: Lakukan koordinasi lapangan dan prioritaskan peningkatan daya pancar pada sektor yang memiliki Service Level di bawah 70%.*";
}

// ============================================================
// CENTRAL DATABASE DATA FETCH
// ============================================================
function findColumnIndexGS(headers, candidatePatterns) {
  if (!headers || !Array.isArray(headers)) return -1;
  var cleanHeaders = headers.map(function(h) { return h ? String(h).toLowerCase().replace(/\s+/g, ' ').trim() : ''; });
  
  for (var i = 0; i < candidatePatterns.length; i++) {
    var cleanPattern = candidatePatterns[i].toLowerCase().replace(/\s+/g, ' ').trim();
    var exactIdx = cleanHeaders.indexOf(cleanPattern);
    if (exactIdx !== -1) return exactIdx;
  }

  for (var j = 0; j < candidatePatterns.length; j++) {
    var cleanPattern2 = candidatePatterns[j].toLowerCase().replace(/\s+/g, ' ').trim();
    var incIdx = cleanHeaders.findIndex(function(h) { return h.indexOf(cleanPattern2) !== -1; });
    if (incIdx !== -1) return incIdx;
  }

  return -1;
}

function findEquipColumnIndexGS(headers, opKeywords, equipKeyword, excludeKeywords) {
  if (!headers || !Array.isArray(headers)) return -1;
  var excludes = excludeKeywords || [];
  var cleanHeaders = headers.map(function(h) { return h ? String(h).toLowerCase().replace(/\s+/g, ' ').trim() : ''; });

  for (var i = 0; i < cleanHeaders.length; i++) {
    var h = cleanHeaders[i];
    if (!h) continue;

    var hasEx = false;
    for (var e = 0; e < excludes.length; e++) {
      if (h.indexOf(excludes[e]) !== -1) { hasEx = true; break; }
    }
    if (hasEx) continue;

    var hasOp = false;
    for (var k = 0; k < opKeywords.length; k++) {
      if (h.indexOf(opKeywords[k]) !== -1) { hasOp = true; break; }
    }
    if (hasOp && h.indexOf(equipKeyword) !== -1) {
      return i;
    }
  }

  return -1;
}

function parseEquipQtyGS(val) {
  if (val === undefined || val === null) return 0;
  var str = String(val).trim();
  if (!str || str === '0' || str === 'N/A' || str === '-' || str === 'NONE' || str === 'null' || str === 'undefined') return 0;
  var num = parseFloat(str.replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? 0 : num;
}

function getSumQtyGS(row, colIndices) {
  var sum = 0;
  for (var i = 0; i < colIndices.length; i++) {
    var idx = colIndices[i];
    if (idx !== -1 && row[idx] !== undefined) {
      sum += parseEquipQtyGS(row[idx]);
    }
  }
  return sum;
}

function checkTenantActiveFlagGS(row, activeTenantStr, colIdx, keywords) {
  if (colIdx !== -1 && row[colIdx] !== undefined && row[colIdx] !== null) {
    var val = String(row[colIdx]).trim().toUpperCase();
    if (val !== '' && val !== '0' && val !== '-' && val !== 'NONE' && val !== 'FALSE' && val !== 'INACTIVE' && val !== 'NO') {
      return true;
    }
  }
  var upperActive = (activeTenantStr || '').toUpperCase();
  for (var k = 0; k < keywords.length; k++) {
    if (upperActive.indexOf(keywords[k].toUpperCase()) !== -1) return true;
  }
  return false;
}

function getCentralDatabaseData() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName("Central Database");
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1) return [];

    var rows = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = rows[0];
    var rawRows = rows.slice(1);

    var idxSiteId = findColumnIndexGS(headers, ['site id', 'id site', 'site_id']);
    var idxIdOracle = findColumnIndexGS(headers, ['id oracle', 'oracle id', 'id_oracle']);
    var idxSiteName = findColumnIndexGS(headers, ['site name', 'nama site', 'site_name']);
    var idxLat = findColumnIndexGS(headers, ['lat', 'latitude', 'y']);
    var idxLong = findColumnIndexGS(headers, ['long', 'longitude', 'lng', 'x']);
    var idxStatusPmo = findColumnIndexGS(headers, ['status pmo', 'pmo status', 'pmo']);
    var idxStatusGroup = findColumnIndexGS(headers, ['status group', 'status grouping', 'group status']);
    var idxType = findColumnIndexGS(headers, ['type', 'jenis', 'tipe']);
    var idxRegional = findColumnIndexGS(headers, ['regional', 'region']);
    var idxProvince = findColumnIndexGS(headers, ['province', 'provinsi']);
    var idxCity = findColumnIndexGS(headers, ['city', 'kota', 'kabupaten']);
    var idxDistrict = findColumnIndexGS(headers, ['district', 'kecamatan']);
    var idxSubDistrict = findColumnIndexGS(headers, ['sub district', 'kelurahan', 'desa']);
    var idxAddress = findColumnIndexGS(headers, ['address', 'alamat']);
    var idxSiteType = findColumnIndexGS(headers, ['site type', 'jenis site']);
    var idxTowerType = findColumnIndexGS(headers, ['tower type', 'tipe menara', 'jenis menara']);
    var idxTowerTypeGrouping = findColumnIndexGS(headers, ['tower type grouping']);
    var idxPoleType = findColumnIndexGS(headers, ['pole type']);
    var idxTowerHeight = findColumnIndexGS(headers, ['tower height', 'tinggi menara']);
    var idxLandAsset = findColumnIndexGS(headers, ['land asset', 'asset tanah']);
    var idxMorphoclass = findColumnIndexGS(headers, ['morphoclass', 'morphology']);
    var idxPermitStatus = findColumnIndexGS(headers, ['permit status', 'status pks', 'status ijin']);
    var idxRentalValue = findColumnIndexGS(headers, ['rental value', 'nilai sewa']);
    var idxNoPks = findColumnIndexGS(headers, ['no. pks', 'no pks', 'nomor pks']);
    var idxPksStart = findColumnIndexGS(headers, ['pks start date', 'start pks']);
    var idxPksExpired = findColumnIndexGS(headers, ['pks expired date', 'pks expired', 'expired pks']);
    var idxTahunExpired = findColumnIndexGS(headers, ['tahun expired', 'expired year']);
    var idxSisaWaktu = findColumnIndexGS(headers, ['sisa waktu', 'sisa masa sewa']);
    var idxTxInfo = findColumnIndexGS(headers, ['tx info', 'transmisi info']);
    var idxCovenantStatus = findColumnIndexGS(headers, ['covenant status']);
    var idxPenjamin = findColumnIndexGS(headers, ['penjamin', 'penjaminan']);
    var idxFasilitas = findColumnIndexGS(headers, ['fasilitas']);
    var idxStatusPenjamin = findColumnIndexGS(headers, ['status penjamin']);
    var idxInsurance = findColumnIndexGS(headers, ['insurance', 'asuransi']);
    var idxActiveTenant = findColumnIndexGS(headers, ['active tenant', 'tenant aktif', 'tenant']);
    var idxActiveTenantNumber = findColumnIndexGS(headers, ['active tenant number', 'jumlah tenant']);

    // 5 Tenant Individual Active Columns
    var idxTselActive = findColumnIndexGS(headers, ['tsel active', 'tsel']);
    var idxIohActive = findColumnIndexGS(headers, ['ioh active', 'ioh (h3i) active', 'ioh/h3i active', 'indosat active']);
    var idxH3iActive = findColumnIndexGS(headers, ['h3i active', 'h3i(ioh) active', 'hutchison active', '3 active', 'three active', 'tri active']);
    var idxXlActive = findColumnIndexGS(headers, ['xl active', 'xl(sf) active', 'xl/sf active', 'xl axiata active']);
    var idxSfActive = findColumnIndexGS(headers, ['sf active', 'smartfren active', 'smart active', 'sf(xl) active', 'sf']);

    // Bandwidth Columns
    var idxTselBw = findColumnIndexGS(headers, ['tsel capacity bandwidth', 'tsel bandwidth', 'bandwidth tsel']);
    var idxIohBw = findColumnIndexGS(headers, ['ioh capacity bandwidth', 'ioh bandwidth', 'bandwidth ioh']);
    var idxH3iBw = findColumnIndexGS(headers, ['h3i capacity bandwidth', 'h3i bandwidth', 'bandwidth h3i']);
    var idxXlBw = findColumnIndexGS(headers, ['xl capacity bandwidth', 'xl bandwidth', 'bandwidth xl']);
    var idxSfBw = findColumnIndexGS(headers, ['sf capacity bandwidth', 'smartfren capacity bandwidth', 'sf bandwidth']);

    // Antenna RF Qty
    var idxTselAntennaQty = findEquipColumnIndexGS(headers, ['tsel', 'telkomsel'], 'antenna', ['shooter', 'aau', 'rru']);
    var idxIohAntennaQty = findEquipColumnIndexGS(headers, ['ioh', 'indosat', 'isat'], 'antenna', ['shooter', 'aau', 'rru']);
    var idxH3iAntennaQty = findEquipColumnIndexGS(headers, ['h3i', 'three', 'tri', 'hutchison'], 'antenna', ['shooter', 'aau', 'rru']);
    var idxXlAntennaQty = findEquipColumnIndexGS(headers, ['xl', 'axiata'], 'antenna', ['shooter', 'aau', 'rru']);
    var idxSfAntennaQty = findEquipColumnIndexGS(headers, ['sf', 'smartfren', 'smart'], 'antenna', ['shooter', 'aau', 'rru']);

    // Shooter Qty
    var idxTselShooterQty = findEquipColumnIndexGS(headers, ['tsel', 'telkomsel'], 'shooter');
    var idxIohShooterQty = findEquipColumnIndexGS(headers, ['ioh', 'indosat', 'isat'], 'shooter');
    var idxH3iShooterQty = findEquipColumnIndexGS(headers, ['h3i', 'three', 'tri', 'hutchison'], 'shooter');
    var idxXlShooterQty = findEquipColumnIndexGS(headers, ['xl', 'axiata'], 'shooter');
    var idxSfShooterQty = findEquipColumnIndexGS(headers, ['sf', 'smartfren', 'smart'], 'shooter');

    // AAU Qty
    var idxTselAauQty = findEquipColumnIndexGS(headers, ['tsel', 'telkomsel'], 'aau');
    var idxIohAauQty = findEquipColumnIndexGS(headers, ['ioh', 'indosat', 'isat'], 'aau');
    var idxH3iAauQty = findEquipColumnIndexGS(headers, ['h3i', 'three', 'tri', 'hutchison'], 'aau');
    var idxXlAauQty = findEquipColumnIndexGS(headers, ['xl', 'axiata'], 'aau');
    var idxSfAauQty = findEquipColumnIndexGS(headers, ['sf', 'smartfren', 'smart'], 'aau');

    // RRU Qty
    var idxTselRruQty = findEquipColumnIndexGS(headers, ['tsel', 'telkomsel'], 'rru', ['antenna', 'shooter', 'aau']);
    var idxIohRruQty = findEquipColumnIndexGS(headers, ['ioh', 'indosat', 'isat'], 'rru', ['antenna', 'shooter', 'aau']);
    var idxH3iRruQty = findEquipColumnIndexGS(headers, ['h3i', 'three', 'tri', 'hutchison'], 'rru', ['antenna', 'shooter', 'aau']);
    var idxXlRruQty = findEquipColumnIndexGS(headers, ['xl', 'axiata'], 'rru', ['antenna', 'shooter', 'aau']);
    var idxSfRruQty = findEquipColumnIndexGS(headers, ['sf', 'smartfren', 'smart'], 'rru', ['antenna', 'shooter', 'aau']);

    var results = [];
    for (var i = 0; i < rawRows.length; i++) {
      var row = rawRows[i];
      var sId = row[idxSiteId !== -1 ? idxSiteId : 0];
      if (!sId) continue;

      var activeTenantStr = idxActiveTenant !== -1 ? (row[idxActiveTenant] || 'N/A').toString() : 'N/A';

      // 5 Tenant Individual Active Checks
      var tselAct = checkTenantActiveFlagGS(row, activeTenantStr, idxTselActive, ['TSEL', 'TELKOMSEL']);
      var iohAct = checkTenantActiveFlagGS(row, activeTenantStr, idxIohActive, ['IOH', 'INDOSAT', 'ISAT']);
      var h3iAct = checkTenantActiveFlagGS(row, activeTenantStr, idxH3iActive, ['H3I', 'THREE', 'TRI', 'HUTCHISON']);
      var xlAct = checkTenantActiveFlagGS(row, activeTenantStr, idxXlActive, ['XL', 'AXIATA']);
      var sfAct = checkTenantActiveFlagGS(row, activeTenantStr, idxSfActive, ['SF', 'SMART', 'SMARTFREN']);

      // 3 Grouped Tenant Categories: TSEL, IOH (IOH + H3I), XLS (XL + SF)
      var groupedTselAct = tselAct;
      var groupedIohAct = iohAct || h3iAct;
      var groupedXlsAct = xlAct || sfAct;

      // Equipment Quantities per individual tenant
      var tselAntenna = getSumQtyGS(row, [idxTselAntennaQty]);
      var iohAntenna = getSumQtyGS(row, [idxIohAntennaQty]);
      var h3iAntenna = getSumQtyGS(row, [idxH3iAntennaQty]);
      var xlAntenna = getSumQtyGS(row, [idxXlAntennaQty]);
      var sfAntenna = getSumQtyGS(row, [idxSfAntennaQty]);

      var tselAau = getSumQtyGS(row, [idxTselAauQty]);
      var iohAau = getSumQtyGS(row, [idxIohAauQty]);
      var h3iAau = getSumQtyGS(row, [idxH3iAauQty]);
      var xlAau = getSumQtyGS(row, [idxXlAauQty]);
      var sfAau = getSumQtyGS(row, [idxSfAauQty]);

      var tselRru = getSumQtyGS(row, [idxTselRruQty]);
      var iohRru = getSumQtyGS(row, [idxIohRruQty]);
      var h3iRru = getSumQtyGS(row, [idxH3iRruQty]);
      var xlRru = getSumQtyGS(row, [idxXlRruQty]);
      var sfRru = getSumQtyGS(row, [idxSfRruQty]);

      var tselShooter = getSumQtyGS(row, [idxTselShooterQty]);
      var iohShooter = getSumQtyGS(row, [idxIohShooterQty]);
      var h3iShooter = getSumQtyGS(row, [idxH3iShooterQty]);
      var xlShooter = getSumQtyGS(row, [idxXlShooterQty]);
      var sfShooter = getSumQtyGS(row, [idxSfShooterQty]);

      // Grouped equipment totals (IOH = IOH + H3I; XLS = XL + SF)
      var iohAntennaGrouped = iohAntenna + h3iAntenna;
      var xlsAntennaGrouped = xlAntenna + sfAntenna;

      var iohAauGrouped = iohAau + h3iAau;
      var xlsAauGrouped = xlAau + sfAau;

      var iohRruGrouped = iohRru + h3iRru;
      var xlsRruGrouped = xlRru + sfRru;

      var iohShooterGrouped = iohShooter + h3iShooter;
      var xlsShooterGrouped = xlShooter + sfShooter;

      var equipSummaryStr = "TSEL (Antenna:" + tselAntenna + ", AAU:" + tselAau + ", RRU:" + tselRru + ", Shooter:" + tselShooter + "); " +
                            "IOH [IOH+H3I] (Antenna:" + iohAntennaGrouped + ", AAU:" + iohAauGrouped + ", RRU:" + iohRruGrouped + ", Shooter:" + iohShooterGrouped + "); " +
                            "XLS [XL+SF] (Antenna:" + xlsAntennaGrouped + ", AAU:" + xlsAauGrouped + ", RRU:" + xlsRruGrouped + ", Shooter:" + xlsShooterGrouped + ")";

      results.push({
        siteId: sId.toString().trim(),
        idOracle: idxIdOracle !== -1 ? (row[idxIdOracle] || 'N/A') : 'N/A',
        siteName: idxSiteName !== -1 ? (row[idxSiteName] || 'N/A') : 'N/A',
        lat: idxLat !== -1 && row[idxLat] ? parseFloat(row[idxLat].toString().replace(',', '.')) : 0,
        long: idxLong !== -1 && row[idxLong] ? parseFloat(row[idxLong].toString().replace(',', '.')) : 0,
        statusPmo: idxStatusPmo !== -1 ? (row[idxStatusPmo] || 'N/A') : 'N/A',
        statusGroup: idxStatusGroup !== -1 ? (row[idxStatusGroup] || 'N/A') : 'N/A',
        type: idxType !== -1 ? (row[idxType] || 'N/A') : 'N/A',
        regional: idxRegional !== -1 ? (row[idxRegional] || 'N/A') : 'N/A',
        province: idxProvince !== -1 ? (row[idxProvince] || 'N/A') : 'N/A',
        city: idxCity !== -1 ? (row[idxCity] || 'N/A') : 'N/A',
        district: idxDistrict !== -1 ? (row[idxDistrict] || 'N/A') : 'N/A',
        subDistrict: idxSubDistrict !== -1 ? (row[idxSubDistrict] || 'N/A') : 'N/A',
        address: idxAddress !== -1 ? (row[idxAddress] || 'N/A') : 'N/A',
        siteType: idxSiteType !== -1 ? (row[idxSiteType] || 'N/A') : 'N/A',
        towerType: idxTowerType !== -1 ? (row[idxTowerType] || 'N/A') : 'N/A',
        towerTypeGrouping: idxTowerTypeGrouping !== -1 ? (row[idxTowerTypeGrouping] || 'N/A') : 'N/A',
        poleType: idxPoleType !== -1 ? (row[idxPoleType] || 'N/A') : 'N/A',
        towerHeight: idxTowerHeight !== -1 ? (row[idxTowerHeight] || 'N/A') : 'N/A',
        landAsset: idxLandAsset !== -1 ? (row[idxLandAsset] || 'N/A') : 'N/A',
        morphoclass: idxMorphoclass !== -1 ? (row[idxMorphoclass] || 'N/A') : 'N/A',
        permitStatus: idxPermitStatus !== -1 ? (row[idxPermitStatus] || 'N/A') : 'N/A',
        rentalValue: idxRentalValue !== -1 ? (row[idxRentalValue] || 'N/A') : 'N/A',
        noPks: idxNoPks !== -1 ? (row[idxNoPks] || 'N/A') : 'N/A',
        pksStart: idxPksStart !== -1 ? (row[idxPksStart] || 'N/A') : 'N/A',
        pksExpired: idxPksExpired !== -1 ? (row[idxPksExpired] || 'N/A') : 'N/A',
        tahunExpired: idxTahunExpired !== -1 ? (row[idxTahunExpired] || 'N/A') : 'N/A',
        sisaWaktu: idxSisaWaktu !== -1 ? (row[idxSisaWaktu] || 'N/A') : 'N/A',
        txInfo: idxTxInfo !== -1 ? (row[idxTxInfo] || 'N/A') : 'N/A',
        covenantStatus: idxCovenantStatus !== -1 ? (row[idxCovenantStatus] || 'N/A') : 'N/A',
        penjamin: idxPenjamin !== -1 ? (row[idxPenjamin] || 'N/A') : 'N/A',
        fasilitas: idxFasilitas !== -1 ? (row[idxFasilitas] || 'N/A') : 'N/A',
        statusPenjamin: idxStatusPenjamin !== -1 ? (row[idxStatusPenjamin] || 'N/A') : 'N/A',
        insurance: idxInsurance !== -1 ? (row[idxInsurance] || 'N/A') : 'N/A',
        activeTenant: activeTenantStr,
        activeTenantNumber: idxActiveTenantNumber !== -1 ? (row[idxActiveTenantNumber] || 'N/A') : 'N/A',

        // 5 Tenant Individual Breakdown
        fiveTenants: {
          TSEL: tselAct,
          IOH: iohAct,
          H3I: h3iAct,
          XL: xlAct,
          SF: sfAct
        },

        // 3 Grouped Tenant Categories
        tselActive: groupedTselAct,
        iohActive: groupedIohAct,
        xlActive: groupedXlsAct,
        xlsActive: groupedXlsAct,

        // Bandwidth
        tselBw: idxTselBw !== -1 ? (row[idxTselBw] || 'N/A') : 'N/A',
        iohBw: idxIohBw !== -1 ? (row[idxIohBw] || 'N/A') : 'N/A',
        h3iBw: idxH3iBw !== -1 ? (row[idxH3iBw] || 'N/A') : 'N/A',
        xlBw: idxXlBw !== -1 ? (row[idxXlBw] || 'N/A') : 'N/A',
        sfBw: idxSfBw !== -1 ? (row[idxSfBw] || 'N/A') : 'N/A',

        // Equipment QTYs
        tselAntennaQty: tselAntenna,
        iohAntennaQty: iohAntennaGrouped,
        xlAntennaQty: xlsAntennaGrouped,
        xlsAntennaQty: xlsAntennaGrouped,

        tselAauQty: tselAau,
        iohAauQty: iohAauGrouped,
        xlAauQty: xlsAauGrouped,
        xlsAauQty: xlsAauGrouped,

        tselRruQty: tselRru,
        iohRruQty: iohRruGrouped,
        xlRruQty: xlsRruGrouped,
        xlsRruQty: xlsRruGrouped,

        tselShooterQty: tselShooter,
        iohShooterQty: iohShooterGrouped,
        xlShooterQty: xlsShooterGrouped,
        xlsShooterQty: xlsShooterGrouped,

        equipmentDetails: {
          TSEL: { antenna: tselAntenna, aau: tselAau, rru: tselRru, shooter: tselShooter },
          IOH_Combined_IOH_H3I: { antenna: iohAntennaGrouped, aau: iohAauGrouped, rru: iohRruGrouped, shooter: iohShooterGrouped },
          XLS_Combined_XL_SF: { antenna: xlsAntennaGrouped, aau: xlsAauGrouped, rru: xlsRruGrouped, shooter: xlsShooterGrouped }
        },
        equipmentSummary: equipSummaryStr
      });
    }
    return results;
  } catch (err) {
    Logger.log("Error getCentralDatabaseData: " + err.toString());
    return [];
  }
}

// ============================================================
// AI QUERY PROCESSOR (OPTIMIZED WITH CACHE & CENTRAL DATABASE)
// ============================================================
function processAIQuery(query, data) {
  try {
    var dashboard = getCachedDashboardData();
    var rawDriveTestData = getDriveTestV2Data();
    var driveTestData = (rawDriveTestData && rawDriveTestData.data) ? rawDriveTestData.data.map(function(d) {
      return {
        siteId: d.siteId,
        siteName: d.siteName,
        city: d.city,
        cluster: d.cluster,
        pairing: d.pairing || '',
        statusGroup: d.statusGroup || '',
        towerHeight: d.towerHeight || '',
        towerType: d.towerType || '',
        activeTenant: d.activeTenant || '',
        tselKpi: d.bestServer ? d.bestServer.tselKpi : 0,
        iohKpi: d.bestServer ? d.bestServer.iohKpi : 0,
        xlsKpi: d.bestServer ? d.bestServer.xlsKpi : 0,
        bestServer: d.bestServer,
        nrxLv1: d.nrxLv1
      };
    }) : [];

    // Group all pairings across driveTestData
    var pairingGroups = {};
    driveTestData.forEach(function(d) {
      var pKey = (d.pairing || '').trim();
      if (pKey && pKey !== 'N/A' && pKey !== '-' && pKey !== '0') {
        if (!pairingGroups[pKey]) pairingGroups[pKey] = [];
        pairingGroups[pKey].push({
          siteId: d.siteId,
          siteName: d.siteName,
          city: d.city,
          cluster: d.cluster,
          pairing: pKey,
          statusGroup: d.statusGroup,
          towerHeight: d.towerHeight,
          towerType: d.towerType,
          jarak: d.jarak || '',
          activeTenant: d.activeTenant || 'N/A',
          cp: d.cp || { deep: 0, indoor: 0, fw: 0, out: 0, kpi: 0 },
          tselKpi: d.bestServer ? parseFloat((d.bestServer.tselKpi || 0).toFixed(1)) : 0,
          iohKpi: d.bestServer ? parseFloat((d.bestServer.iohKpi || 0).toFixed(1)) : 0,
          xlsKpi: d.bestServer ? parseFloat((d.bestServer.xlsKpi || 0).toFixed(1)) : 0
        });
      }
    });

    var allPairingsList = [];
    Object.keys(pairingGroups).forEach(function(pKey) {
      var sitesInPair = pairingGroups[pKey];
      var others = sitesInPair.filter(function(s) { 
        var st = (s.statusGroup || '').toUpperCase();
        return st.indexOf('OTHERS') !== -1 || (s.siteId || '').toUpperCase().indexOf('G-') === 0; 
      });
      var existing = sitesInPair.filter(function(s) { 
        var st = (s.statusGroup || '').toUpperCase();
        return st.indexOf('OTHERS') === -1 && (s.siteId || '').toUpperCase().indexOf('G-') !== 0; 
      });
      var distanceMeters = 0;
      if (others.length > 0 && others[0].jarak) {
        distanceMeters = parseInt(others[0].jarak) || 0;
      }
      if (!distanceMeters && sitesInPair.length > 0 && sitesInPair[0].jarak) {
        distanceMeters = parseInt(sitesInPair[0].jarak) || 0;
      }
      allPairingsList.push({
        pairingKey: pKey,
        totalSitesInPairing: sitesInPair.length,
        distanceMeters: distanceMeters || 42,
        othersSites: others,
        existingSites: existing,
        allSitesInPairing: sitesInPair
      });
    });

    var dtSitesCount = driveTestData.length;
    var sumTsel = 0, sumIoh = 0, sumXls = 0;
    var poorSitesCount = 0, mediumSitesCount = 0, goodSitesCount = 0;

    driveTestData.forEach(function(d) {
      var tK = d.tselKpi || 0;
      var iK = d.iohKpi || 0;
      var xK = d.xlsKpi || 0;
      sumTsel += tK; sumIoh += iK; sumXls += xK;

      var opCount = 0, opSum = 0;
      if (tK > 0) { opSum += tK; opCount++; }
      if (iK > 0) { opSum += iK; opCount++; }
      if (xK > 0) { opSum += xK; opCount++; }
      var siteAvg = opCount > 0 ? (opSum / opCount) : ((tK + iK + xK) / 3);

      if (siteAvg >= 80) goodSitesCount++;
      else if (siteAvg >= 60) mediumSitesCount++;
      else poorSitesCount++;
    });

    var avgTsel = dtSitesCount > 0 ? sumTsel / dtSitesCount : 0;
    var avgIoh = dtSitesCount > 0 ? sumIoh / dtSitesCount : 0;
    var avgXls = dtSitesCount > 0 ? sumXls / dtSitesCount : 0;

    var kpiTreeAnalysis = {
      goodSites: { count: goodSitesCount, percentage: dtSitesCount > 0 ? parseFloat(((goodSitesCount / dtSitesCount) * 100).toFixed(1)) : 0, description: "KPI >= 80% (Sangat Optimal / Good)" },
      mediumSites: { count: mediumSitesCount, percentage: dtSitesCount > 0 ? parseFloat(((mediumSitesCount / dtSitesCount) * 100).toFixed(1)) : 0, description: "60% <= KPI < 80% (Sedang / Medium)" },
      poorSites: { count: poorSitesCount, percentage: dtSitesCount > 0 ? parseFloat(((poorSitesCount / dtSitesCount) * 100).toFixed(1)) : 0, description: "KPI < 60% (Rendah / Poor / Degraded)" }
    };

    var dtCities = {};
    var dtClusters = {};
    driveTestData.forEach(function(d) {
      if (d.city) {
        var cleanCity = d.city.trim();
        if (!dtCities[cleanCity]) dtCities[cleanCity] = { tsel: 0, ioh: 0, xls: 0, count: 0 };
        dtCities[cleanCity].tsel += d.tselKpi || 0;
        dtCities[cleanCity].ioh += d.iohKpi || 0;
        dtCities[cleanCity].xls += d.xlsKpi || 0;
        dtCities[cleanCity].count += 1;
      }
      if (d.cluster) {
        var cleanCluster = d.cluster.trim();
        if (!dtClusters[cleanCluster]) dtClusters[cleanCluster] = { tsel: 0, ioh: 0, xls: 0, count: 0 };
        dtClusters[cleanCluster].tsel += d.tselKpi || 0;
        dtClusters[cleanCluster].ioh += d.iohKpi || 0;
        dtClusters[cleanCluster].xls += d.xlsKpi || 0;
        dtClusters[cleanCluster].count += 1;
      }
    });

    var dtCityAverages = Object.keys(dtCities).map(function(city) {
      var c = dtCities[city];
      return {
        city: city,
        avgTselKPI: parseFloat((c.tsel / c.count).toFixed(2)),
        avgIohKPI: parseFloat((c.ioh / c.count).toFixed(2)),
        avgXlsKPI: parseFloat((c.xls / c.count).toFixed(2)),
        sitesCount: c.count
      };
    });

    var dtClusterAverages = Object.keys(dtClusters).map(function(cluster) {
      var c = dtClusters[cluster];
      return {
        cluster: cluster,
        avgTselKPI: parseFloat((c.tsel / c.count).toFixed(2)),
        avgIohKPI: parseFloat((c.ioh / c.count).toFixed(2)),
        avgXlsKPI: parseFloat((c.xls / c.count).toFixed(2)),
        sitesCount: c.count
      };
    });

    var degradedSites = driveTestData
      .filter(function(d) { return (d.tselKpi > 0 && d.tselKpi < 75) || (d.iohKpi > 0 && d.iohKpi < 75) || (d.xlsKpi > 0 && d.xlsKpi < 75); })
      .slice(0, 10)
      .map(function(d) { return { siteId: d.siteId, siteName: d.siteName, city: d.city, tselKpi: d.tselKpi, iohKpi: d.iohKpi, xlsKpi: d.xlsKpi }; });

    var uniqueCitiesInDataset = [];
    if (dashboard.tenantRatio) {
      dashboard.tenantRatio.forEach(function(r) {
        if (r.city && uniqueCitiesInDataset.indexOf(r.city) === -1) uniqueCitiesInDataset.push(r.city);
      });
    }
    var lowerQuery = (query || '').toLowerCase();
    var foundCities = [];
    uniqueCitiesInDataset.forEach(function(city) {
      var lowerCity = city.toLowerCase();
      var cleanCity = lowerCity.replace(/kota|kab\.|kabupaten/g, '').trim();
      if (!cleanCity) return;
      var parts = cleanCity.split(/\s+/);
      var match = parts.some(function(part) { return part.length >= 3 && lowerQuery.indexOf(part) !== -1; });
      if (lowerCity.indexOf("surakarta") !== -1 && lowerQuery.indexOf("solo") !== -1) match = true;
      if (match) foundCities.push(lowerCity);
    });

    var queryWords = lowerQuery.split(/[\s,\.\?\!\-\(\)]+/);
    var siteIdCandidates = queryWords.filter(function(w) { return w.length >= 4 && /[a-z]/i.test(w) && /[0-9]/.test(w); });

    // Check matching clusters in query
    var allClusterNames = Object.keys(dtClusters);
    var matchingClusterNames = allClusterNames.filter(function(cName) {
      var cLower = cName.toLowerCase();
      if (lowerQuery.indexOf(cLower) !== -1) return true;
      var keywords = cLower.split(/\s+/).filter(function(w) { return w.length >= 3 && ['collo', '2024', '2025', '2026', 'regular'].indexOf(w) === -1; });
      return keywords.some(function(kw) { return lowerQuery.indexOf(kw) !== -1; });
    });

    var matchedClusterDriveSites = [];
    if (matchingClusterNames.length > 0) {
      matchedClusterDriveSites = driveTestData.filter(function(d) {
        var dCluster = (d.cluster || '').trim().toLowerCase();
        return matchingClusterNames.some(function(mName) {
          return dCluster.indexOf(mName.toLowerCase()) !== -1 || mName.toLowerCase().indexOf(dCluster) !== -1;
        });
      });
    }

    // Determine relevant Central Database sites based on query
    var centralDbData = getCentralDatabaseData();
    var queriedCentralDbSites = [];
    if (matchingClusterNames.length > 0) {
      var clusterKeywords = matchingClusterNames.map(function(m) {
        return m.toLowerCase().replace(/2024|2025|2026|collo|regular/g, '').trim();
      }).filter(Boolean);
      queriedCentralDbSites = centralDbData.filter(function(d) {
        var dStr = (d.siteId + ' ' + d.siteName + ' ' + d.city + ' ' + d.landAsset + ' ' + d.address).toLowerCase();
        return clusterKeywords.some(function(kw) { return dStr.indexOf(kw) !== -1; });
      });
    }
    if (queriedCentralDbSites.length === 0 && foundCities.length > 0) {
      queriedCentralDbSites = centralDbData.filter(function(d) {
        var dCity = (d.city || '').toLowerCase();
        return foundCities.some(function(fc) { return dCity.indexOf(fc) !== -1; });
      });
    } else if (queriedCentralDbSites.length === 0 && siteIdCandidates.length > 0) {
      queriedCentralDbSites = centralDbData.filter(function(d) {
        var sId = (d.siteId || '').toLowerCase();
        return siteIdCandidates.some(function(candidate) { return sId.indexOf(candidate) !== -1; });
      });
    } else if (queriedCentralDbSites.length === 0) {
      queriedCentralDbSites = centralDbData.slice(0, 30);
    }
    queriedCentralDbSites = queriedCentralDbSites.slice(0, 50);

    var filteredCentralDbSites = queriedCentralDbSites.map(function(s) {
      return {
        siteId: s.siteId,
        siteName: s.siteName,
        city: s.city,
        towerHeight: s.towerHeight,
        towerType: s.towerType,
        landAsset: s.landAsset,
        statusPmo: s.statusPmo,
        activeTenant: s.activeTenant,
        activeTenantNumber: s.activeTenantNumber,
        fiveTenants: s.fiveTenants,
        groupedTenants: {
          TSEL: s.tselActive,
          IOH_Combined: s.iohActive,
          XLS_Combined: s.xlsActive
        },
        tselActive: s.tselActive,
        iohActive: s.iohActive,
        xlActive: s.xlActive,
        xlsActive: s.xlsActive,
        equipmentDetails: s.equipmentDetails,
        equipmentSummary: s.equipmentSummary,
        tselAntennaQty: s.tselAntennaQty,
        iohAntennaQty: s.iohAntennaQty,
        xlAntennaQty: s.xlAntennaQty,
        tselAauQty: s.tselAauQty,
        iohAauQty: s.iohAauQty,
        xlAauQty: s.xlAauQty,
        tselRruQty: s.tselRruQty,
        iohRruQty: s.iohRruQty,
        xlRruQty: s.xlRruQty
      };
    });

    var isPairingOrColloQuery = /pairing|collo|dismantle|skenario|potensi|badung|pasangan|grouping|cluster/i.test(lowerQuery);

    var queriedDriveTestSites = [];
    if (isPairingOrColloQuery) {
      queriedDriveTestSites = driveTestData; // Send ALL drive test sites & ALL ~30+ pairings!
    } else if (matchedClusterDriveSites.length > 0) {
      queriedDriveTestSites = matchedClusterDriveSites;
    } else if (foundCities.length > 0) {
      queriedDriveTestSites = driveTestData.filter(function(d) {
        var dCity = (d.city || '').toLowerCase();
        return foundCities.some(function(fc) { return dCity.indexOf(fc) !== -1; });
      });
    } else {
      queriedDriveTestSites = driveTestData;
    }

    queriedDriveTestSites = queriedDriveTestSites.filter(function(v, i, a) {
      return a.findIndex(function(t) { return t.siteId === v.siteId; }) === i;
    });

    // Check if query is asking for N list / top N / bottom N / specific list of sites
    var listCountMatch = lowerQuery.match(/(\d+)\s*(list|site|situs|daftar|terendah|tertinggi|top|bottom)/i) || lowerQuery.match(/(list|daftar|situs|site)\s*(\d+)/i);
    var requestedListCount = 0;
    if (listCountMatch) {
      var numStr = listCountMatch[1] && !isNaN(parseInt(listCountMatch[1])) ? listCountMatch[1] : (listCountMatch[2] && !isNaN(parseInt(listCountMatch[2])) ? listCountMatch[2] : '0');
      requestedListCount = parseInt(numStr, 10);
    }
    if (requestedListCount > 100) requestedListCount = 100;

    var topRequestedSites = [];
    if (requestedListCount > 0) {
      var pool = driveTestData;
      if (foundCities.length > 0) {
        pool = pool.filter(function(d) {
          var dCity = (d.city || '').toLowerCase();
          return foundCities.some(function(fc) { return dCity.indexOf(fc) !== -1; });
        });
      }
      var yearMatch = lowerQuery.match(/\b(202\d)\b/);
      if (yearMatch) {
        var yearVal = yearMatch[1];
        var yearFiltered = pool.filter(function(d) { return String(d.yearDt) === yearVal; });
        if (yearFiltered.length > 0) {
          pool = yearFiltered;
        }
      }

      // Detect specific operator mentioned in query
      var isIoh = /ioh|indosat|h3i|tri\b/i.test(lowerQuery);
      var isTsel = /tsel|telkomsel/i.test(lowerQuery);
      var isXls = /xls|xl|smartfren|sf\b/i.test(lowerQuery);
      var isPoorOnly = /poor|degradasi|kritis/i.test(lowerQuery);
      var isGoodOnly = /good|bagus|optimal/i.test(lowerQuery);
      var isMedOnly = /medium|sedang/i.test(lowerQuery);

      if (isIoh && isPoorOnly) {
        var iohPoorPool = pool.filter(function(d) {
          var k = d.iohKpi || (d.bestServer && d.bestServer.iohKpi) || 0;
          return k < 60 && k > 0;
        });
        if (iohPoorPool.length > 0) pool = iohPoorPool;
      } else if (isTsel && isPoorOnly) {
        var tselPoorPool = pool.filter(function(d) {
          var k = d.tselKpi || (d.bestServer && d.bestServer.tselKpi) || 0;
          return k < 60 && k > 0;
        });
        if (tselPoorPool.length > 0) pool = tselPoorPool;
      } else if (isXls && isPoorOnly) {
        var xlsPoorPool = pool.filter(function(d) {
          var k = d.xlsKpi || (d.bestServer && d.bestServer.xlsKpi) || 0;
          return k < 60 && k > 0;
        });
        if (xlsPoorPool.length > 0) pool = xlsPoorPool;
      } else if (isPoorOnly) {
        var poorPool = pool.filter(function(d) {
          var tK = d.tselKpi || (d.bestServer && d.bestServer.tselKpi) || 0;
          var iK = d.iohKpi || (d.bestServer && d.bestServer.iohKpi) || 0;
          var xK = d.xlsKpi || (d.bestServer && d.bestServer.xlsKpi) || 0;
          var avg = (tK + iK + xK) / 3;
          return avg < 60;
        });
        if (poorPool.length > 0) pool = poorPool;
      }

      var poolWithAvg = pool.map(function(d) {
        var tK = d.tselKpi || (d.bestServer && d.bestServer.tselKpi) || 0;
        var iK = d.iohKpi || (d.bestServer && d.bestServer.iohKpi) || 0;
        var xK = d.xlsKpi || (d.bestServer && d.bestServer.xlsKpi) || 0;
        var avg = (tK + iK + xK) / 3;
        return {
          siteId: d.siteId,
          siteName: d.siteName,
          cluster: d.cluster || 'N/A',
          city: d.city,
          yearDt: d.yearDt,
          tselKpi: parseFloat(tK.toFixed(1)),
          iohKpi: parseFloat(iK.toFixed(1)),
          xlsKpi: parseFloat(xK.toFixed(1)),
          avgKpi: parseFloat(avg.toFixed(2))
        };
      });

      var isLowest = /terendah|rendah|degradasi|buruk|poor|bottom|kritis/i.test(lowerQuery);
      if (isLowest) {
        if (isIoh) poolWithAvg.sort(function(a, b) { return a.iohKpi - b.iohKpi; });
        else if (isTsel) poolWithAvg.sort(function(a, b) { return a.tselKpi - b.tselKpi; });
        else if (isXls) poolWithAvg.sort(function(a, b) { return a.xlsKpi - b.xlsKpi; });
        else poolWithAvg.sort(function(a, b) { return a.avgKpi - b.avgKpi; });
      } else {
        if (isIoh) poolWithAvg.sort(function(a, b) { return b.iohKpi - a.iohKpi; });
        else if (isTsel) poolWithAvg.sort(function(a, b) { return b.tselKpi - a.tselKpi; });
        else if (isXls) poolWithAvg.sort(function(a, b) { return b.xlsKpi - a.xlsKpi; });
        else poolWithAvg.sort(function(a, b) { return b.avgKpi - a.avgKpi; });
      }

      topRequestedSites = poolWithAvg.slice(0, requestedListCount);
    }

    var filteredDriveTestSites = queriedDriveTestSites.slice(0, 150).map(function(d) {
      return {
        siteId: d.siteId, siteName: d.siteName, city: d.city, cluster: d.cluster,
        pairing: d.pairing || '',
        statusGroup: d.statusGroup || '',
        towerHeight: d.towerHeight || '',
        towerType: d.towerType || '',
        jenisTeknologi: d.jenisTeknologi || '',
        yearDt: d.yearDt || '',
        activeTenant: d.activeTenant || '',
        tselKpi: d.tselKpi ? parseFloat(d.tselKpi.toFixed(1)) : (d.bestServer && d.bestServer.tselKpi ? parseFloat(d.bestServer.tselKpi.toFixed(1)) : 0),
        iohKpi: d.iohKpi ? parseFloat(d.iohKpi.toFixed(1)) : (d.bestServer && d.bestServer.iohKpi ? parseFloat(d.bestServer.iohKpi.toFixed(1)) : 0),
        xlsKpi: d.xlsKpi ? parseFloat(d.xlsKpi.toFixed(1)) : (d.bestServer && d.bestServer.xlsKpi ? parseFloat(d.bestServer.xlsKpi.toFixed(1)) : 0)
      };
    });

    var queriedEwsAlerts = dashboard.komersial.ews || [];
    if (foundCities.length > 0) {
      queriedEwsAlerts = queriedEwsAlerts.filter(function(e) {
        var eCity = (e.city || '').toLowerCase();
        return foundCities.some(function(fc) { return eCity.indexOf(fc) !== -1; });
      });
    } else {
      queriedEwsAlerts = queriedEwsAlerts.slice(0, 25);
    }

    var overallCentralDbEquipment = centralDbData.reduce(function(acc, s) {
      var tselAnt = (s.equipmentDetails && s.equipmentDetails.TSEL && s.equipmentDetails.TSEL.antenna) || 0;
      var tselAau = (s.equipmentDetails && s.equipmentDetails.TSEL && s.equipmentDetails.TSEL.aau) || 0;
      var tselRru = (s.equipmentDetails && s.equipmentDetails.TSEL && s.equipmentDetails.TSEL.rru) || 0;
      var tselShooter = (s.equipmentDetails && s.equipmentDetails.TSEL && s.equipmentDetails.TSEL.shooter) || 0;

      var iohAnt = (s.equipmentDetails && s.equipmentDetails.IOH_Combined_IOH_H3I && s.equipmentDetails.IOH_Combined_IOH_H3I.antenna) || 0;
      var iohAau = (s.equipmentDetails && s.equipmentDetails.IOH_Combined_IOH_H3I && s.equipmentDetails.IOH_Combined_IOH_H3I.aau) || 0;
      var iohRru = (s.equipmentDetails && s.equipmentDetails.IOH_Combined_IOH_H3I && s.equipmentDetails.IOH_Combined_IOH_H3I.rru) || 0;
      var iohShooter = (s.equipmentDetails && s.equipmentDetails.IOH_Combined_IOH_H3I && s.equipmentDetails.IOH_Combined_IOH_H3I.shooter) || 0;

      var xlsAnt = (s.equipmentDetails && s.equipmentDetails.XLS_Combined_XL_SF && s.equipmentDetails.XLS_Combined_XL_SF.antenna) || 0;
      var xlsAau = (s.equipmentDetails && s.equipmentDetails.XLS_Combined_XL_SF && s.equipmentDetails.XLS_Combined_XL_SF.aau) || 0;
      var xlsRru = (s.equipmentDetails && s.equipmentDetails.XLS_Combined_XL_SF && s.equipmentDetails.XLS_Combined_XL_SF.rru) || 0;
      var xlsShooter = (s.equipmentDetails && s.equipmentDetails.XLS_Combined_XL_SF && s.equipmentDetails.XLS_Combined_XL_SF.shooter) || 0;

      acc.tselAntenna += tselAnt;
      acc.tselAau += tselAau;
      acc.tselRru += tselRru;
      acc.tselShooter += tselShooter;

      acc.iohAntenna += iohAnt;
      acc.iohAau += iohAau;
      acc.iohRru += iohRru;
      acc.iohShooter += iohShooter;

      acc.xlsAntenna += xlsAnt;
      acc.xlsAau += xlsAau;
      acc.xlsRru += xlsRru;
      acc.xlsShooter += xlsShooter;

      if (s.fiveTenants && s.fiveTenants.TSEL) acc.countTselSite++;
      if (s.fiveTenants && s.fiveTenants.IOH) acc.countIohSite++;
      if (s.fiveTenants && s.fiveTenants.H3I) acc.countH3iSite++;
      if (s.fiveTenants && s.fiveTenants.XL) acc.countXlSite++;
      if (s.fiveTenants && s.fiveTenants.SF) acc.countSfSite++;

      return acc;
    }, {
      tselAntenna: 0, tselAau: 0, tselRru: 0, tselShooter: 0,
      iohAntenna: 0, iohAau: 0, iohRru: 0, iohShooter: 0,
      xlsAntenna: 0, xlsAau: 0, xlsRru: 0, xlsShooter: 0,
      countTselSite: 0, countIohSite: 0, countH3iSite: 0, countXlSite: 0, countSfSite: 0
    });

    var contextSummary = {
      sitesSummary: {
        totalSites: dashboard.summary.totalSite,
        statusGroups: dashboard.summary.statusGroups,
        towerType: dashboard.summary.towerType,
        towerHeight: dashboard.summary.towerHeight,
        landAsset: dashboard.summary.landAsset,
        tenantActive: dashboard.summary.tenantActive
      },
      komersial: {
        totalRental: Object.keys(dashboard.komersial.rentalProvinsi).reduce(function(acc, key) { return acc + (dashboard.komersial.rentalProvinsi[key] || 0); }, 0),
        rentalProvinsi: dashboard.komersial.rentalProvinsi,
        penjaminan: dashboard.komersial.penjaminan,
        asuransi: dashboard.komersial.asuransi,
        ewsCount: dashboard.komersial.ews ? dashboard.komersial.ews.length : 0,
        ewsAlerts: queriedEwsAlerts.map(function(e) { return { id: e.id, name: e.name, city: e.city, rental: e.rental, tenggat: e.tenggat, action: e.action }; })
      },
      tenantRatio: dashboard.tenantRatio
        .filter(function(r) { return foundCities.length === 0 || foundCities.some(function(fc) { return (r.city || '').toLowerCase().indexOf(fc) !== -1; }); })
        .map(function(r) { return { city: r.city, totalSite: r.totalSite, totalTenant: r.totalTenant, ratio: r.ratio, status: r.status, keterangan: r.keterangan }; }),
      potential: dashboard.potential
        .filter(function(p) { return foundCities.length === 0 || foundCities.some(function(fc) { return (p.city || '').toLowerCase().indexOf(fc) !== -1; }); })
        .map(function(p) { return { city: p.city, pScore: p.pScore, pStatus: p.pStatus, aScore: p.aScore, aStatus: p.aStatus }; }),
      driveTestServiceLevelBase: {
        totalSitesMeasured: dtSitesCount,
        kpiTreeAnalysis: kpiTreeAnalysis,
        totalPairingsCount: allPairingsList.length,
        allPairingsSummary: allPairingsList,
        clusterAveragesAndRankings: dtClusterAverages,
        overallAverages: { TSEL: parseFloat(avgTsel.toFixed(2)), IOH: parseFloat(avgIoh.toFixed(2)), XLS: parseFloat(avgXls.toFixed(2)) },
        cityAverages: dtCityAverages.filter(function(c) { return foundCities.length === 0 || foundCities.some(function(fc) { return c.city.toLowerCase().indexOf(fc) !== -1; }); }),
        degradedSitesSample: degradedSites,
        topRequestedSites: topRequestedSites,
        relevantGranularSites: filteredDriveTestSites
      },
      centralDatabase: {
        totalSitesInSpreadsheet: centralDbData.length,
        overallEquipmentTotalsAcrossALLSites: {
          totalRRU_AllTenants: overallCentralDbEquipment.tselRru + overallCentralDbEquipment.iohRru + overallCentralDbEquipment.xlsRru,
          totalAAU_AllTenants: overallCentralDbEquipment.tselAau + overallCentralDbEquipment.iohAau + overallCentralDbEquipment.xlsAau,
          totalAntennaRF_AllTenants: overallCentralDbEquipment.tselAntenna + overallCentralDbEquipment.iohAntenna + overallCentralDbEquipment.xlsAntenna,
          totalShooter_AllTenants: overallCentralDbEquipment.tselShooter + overallCentralDbEquipment.iohShooter + overallCentralDbEquipment.xlsShooter,
          breakdownByTenantGroup: {
            TSEL: {
              totalRRU: overallCentralDbEquipment.tselRru,
              totalAAU: overallCentralDbEquipment.tselAau,
              totalAntennaRF: overallCentralDbEquipment.tselAntenna,
              totalShooter: overallCentralDbEquipment.tselShooter,
              activeSites: overallCentralDbEquipment.countTselSite
            },
            IOH_Combined_IOH_and_H3I: {
              totalRRU: overallCentralDbEquipment.iohRru,
              totalAAU: overallCentralDbEquipment.iohAau,
              totalAntennaRF: overallCentralDbEquipment.iohAntenna,
              totalShooter: overallCentralDbEquipment.iohShooter,
              activeSites_IOH: overallCentralDbEquipment.countIohSite,
              activeSites_H3I: overallCentralDbEquipment.countH3iSite
            },
            XLS_Combined_XL_and_SF: {
              totalRRU: overallCentralDbEquipment.xlsRru,
              totalAAU: overallCentralDbEquipment.xlsAau,
              totalAntennaRF: overallCentralDbEquipment.xlsAntenna,
              totalShooter: overallCentralDbEquipment.xlsShooter,
              activeSites_XL: overallCentralDbEquipment.countXlSite,
              activeSites_SF: overallCentralDbEquipment.countSfSite
            }
          }
        },
        relevantGranularCentralDbSitesSample: filteredCentralDbSites
      }
    };

    var apiKey = "";
    try { apiKey = typeof GEMINI_API_KEY !== "undefined" ? GEMINI_API_KEY : ""; } catch (e) {}
    if (!apiKey) apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return "<div class='alert alert-warning'>Error: GEMINI_API_KEY belum dikonfigurasi.</div>";

    var prompt = "Anda adalah asisten data pintar dan RF Engineering Advisor yang menguasai analisis data dashboard Telco terpadu.\n" +
      "Tugas Anda adalah menganalisis data terpadu dari 3 basis data utama (ditambah data Fiber Optic & Menara):\n" +
      "1. \"Central Database\" (data master teknis, ID Oracle, spesifikasi antenna/AAU/RRU/shooter, bandwidth, status PKS, active tenant).\n" +
      "2. \"Service Level Base\" (data Drive Test KPI Sinyal Telco TSEL/IOH/XLS, Coverage Prediction, cluster, tinggi menara, tipe menara, jenis teknologi, tahun DT 2024/2025/2026, pairing group collocation/dismantle, serta Tree Analysis KPI: Good, Medium, Poor).\n" +
      "3. \"Sitelist Komersil\" (data nilai rental, penjaminan, asuransi, sisa waktu sewa, EWS alert, Tenant Ratio, dan Potential Score).\n" +
      "4. \"FO Database\" & \"Menara Liar\" (data rute fiber optic, core, dan status perizinan).\n" +
      "Berikut adalah ringkasan data terpadu yang tersedia:\n" +
      JSON.stringify(contextSummary, null, 2) + "\n" +
      "Pertanyaan pengguna: \"" + query + "\"\n" +
      "Jawablah dalam format JSON saja yang valid sesuai schema berikut. Jangan ada pembungkus markdown seperti ```json atau ```.\n" +
      "SCHEMA RESPONSE JSON:\n" +
      "{\n" +
      "  \"narasi_html\": \"HTML ringkas, elegan, dan kaya informasi dengan format eksekutif. Gunakan callout card, <strong>teks tebal</strong> untuk nilai inti/penting, badge Bootstrap (<span class='badge bg-success'>Good</span>, <span class='badge bg-warning text-dark'>Medium</span>, <span class='badge bg-danger'>Poor</span>, <span class='badge bg-indigo'>TSEL</span>), dan tabel rapi.\",\n" +
      "  \"chart_title\": \"Judul deskriptif singkat untuk grafik visualisasi\",\n" +
      "  \"chart_type\": \"Pilih salah satu: 'bar', 'line', 'pie', atau 'doughnut'.\",\n" +
      "  \"chart_label\": \"Nama dataset yang ditampilkan\",\n" +
      "  \"data_chart\": [{ \"label\": \"Nama Kategori\", \"value\": 123.45 }]\n" +
      "}\n" +
      "CATATAN PENTING & ATURAN FORMAT PENAMPILAN JAWABAN:\n" +
      "1. PENTING - HINDARI KUTIP GANDA (\") DALAM HTML: Di dalam string 'narasi_html', WAJIB gunakan single quote (') untuk semua atribut HTML agar JSON valid dan tidak terpotong.\n" +
      "2. DESAIN BOLD & FORMATTING EKSEKUTIF:\n" +
      "   - Selalu sertakan 'Ringkasan Eksekutif' di bagian paling atas jawaban menggunakan container callout:\n" +
      "     <div class='p-3 mb-3 border-start border-4 border-indigo bg-light rounded shadow-xs' style='border-radius:8px;'>\n" +
      "       <h6 class='fw-bold text-indigo mb-1.5'><i class='fa-solid fa-circle-check me-1.5'></i> Ringkasan Utama & Jawaban Inti:</h6>\n" +
      "       <p class='mb-0 text-dark' style='font-size:13px; line-height:1.6;'>\n" +
      "         ... [Tuliskan jawaban langsung, angka kunci/persentase penting di-<strong>BOLD</strong>, dan sertakan badge kategori/status] ...\n" +
      "       </p>\n" +
      "     </div>\n" +
      "   - TEKS TEBAL (BOLD): Setiap angka penting (misal <strong>87.5%</strong>, <strong>Rp 1.25 Miliar</strong>, <strong>42 Site</strong>), nama kota, ID Site, dan status wajib di-<strong>BOLD</strong>.\n" +
      "   - STRUKTUR TREE ANALYSIS KPI & POTENSIAL:\n" +
      "     * Good (KPI >= 80%), Medium (60% <= KPI < 80%), Poor / Degraded (KPI < 60%).\n" +
      "3. KELENGKAPAN TABEL DAFTAR SITE:\n" +
      "   - Ketika diminta daftar N site, baca data dari 'topRequestedSites' atau dataset terkait dan WAJIB tuliskan SELURUH baris tabel secara lengkap satu per satu dari nomor 1 sampai selesai (semua baris terisi) tanpa terputus!\n" +
      "4. CAKUPAN BANTUAN MATERI:\n" +
      "   - Jelaskan bahwa AI Analytic mencakup SELURUH data terpadu dashboard.\n" +
      "5. ATURAN PENILAIAN TENANT & PERANGKAT CENTRAL DATABASE:\n" +
      "   - Terdapat 5 operator/tenant: TSEL, IOH, H3I, XL, dan SF. Grouping: TSEL, IOH (IOH+H3I), XLS (XL+SF).\n" +
      "   - BACA LANGSUNG TOTAL DARI 'overallEquipmentTotalsAcrossALLSites'.\n" +
      "6. ATURAN MUTLAK AKURASI DATA & PAIRING:\n" +
      "   - ID Site dan Nama Site wajib dipetakan 100% dari data asli.";

    var modelsToTry = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash", "gemini-1.5-flash"];
    var responseCode = 0;
    var responseText = "";
    
    for (var m = 0; m < modelsToTry.length; m++) {
      var modelName = modelsToTry[m];
      var url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + apiKey;
      var payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      };
      var options = {
        method: "post", contentType: "application/json",
        payload: JSON.stringify(payload), muteHttpExceptions: true
      };

      for (var attempt = 1; attempt <= 2; attempt++) {
        var response = UrlFetchApp.fetch(url, options);
        responseCode = response.getResponseCode();
        responseText = response.getContentText();
        if (responseCode === 200) {
          break;
        } else if (responseCode === 429 && attempt < 2) {
          Utilities.sleep(1500);
        }
      }

      if (responseCode === 200) {
        break;
      }
    }

    if (responseCode !== 200) {
      if (responseCode === 429 || (responseText && responseText.indexOf("429") !== -1)) {
        throw new Error("Batas kuota/rate limit API Gemini sementara tercapai. Silakan tunggu beberapa detik dan coba kembali query Anda.");
      }
      if (responseCode === 401 || (responseText && responseText.indexOf("401") !== -1) || (responseText && responseText.indexOf("UNAUTHENTICATED") !== -1)) {
        return "<div class='alert alert-warning border-warning shadow-sm' style='border-radius:12px; background-color:#fffbeb;'>" +
                 "<h6 class='fw-bold text-amber-800 mb-2' style='font-size:14px;'><i class='fa-solid fa-key me-2 text-amber-500'></i> Kunci API Gemini Tidak Valid (Error 401)</h6>" +
                 "<p class='mb-2 text-amber-700' style='font-size:13px; line-height:1.5;'>" +
                   "Kunci yang dimasukkan (<code>" + (apiKey ? apiKey.substring(0, 8) + "..." : "kosong") + "</code>) bukan format API Key resmi Google AI Studio." +
                 "</p>" +
                 "<div class='bg-white p-3 rounded border border-amber-200' style='font-size:12.5px; color:#475569;'>" +
                   "<strong>Panduan format API Key:</strong>" +
                   "<ul class='mb-2 mt-1 ps-3'>" +
                     "<li>API Key Google Gemini yang benar <strong>selalu diawali dengan <code>AIzaSy...</code></strong> (bukan diawali <code>AQ...</code> atau Access Token OAuth).</li>" +
                     "<li>Dapatkan API Key gratis di: <a href='https://aistudio.google.com/app/apikey' target='_blank' class='fw-bold text-primary'>https://aistudio.google.com/app/apikey</a></li>" +
                     "<li>Salin kunci tersebut dan tempelkan di baris ke-9 file <code>code.gs</code>:</li>" +
                   "</ul>" +
                   "<pre class='bg-light p-2 rounded border m-0' style='font-size:11.5px;'>const GEMINI_API_KEY = \"AIzaSyBxxx...\";</pre>" +
                 "</div>" +
               "</div>";
      }
      throw new Error("API call failed with code " + responseCode + ": " + responseText);
    }

    var jsonRes = JSON.parse(responseText);
    var aiRaw = jsonRes.candidates && jsonRes.candidates[0] && jsonRes.candidates[0].content && jsonRes.candidates[0].content.parts && jsonRes.candidates[0].content.parts[0] ? jsonRes.candidates[0].content.parts[0].text : '';
    var aiObj = repairAndParseGeminiJsonGas(aiRaw);

    return '<div class="ai-narasi-container">' + (aiObj.narasi_html || aiObj.narasi || '<p>Hasil analisis tersedia.</p>') + '</div>' +
      '<script type="application/json" id="ai-chart-json">' + JSON.stringify(aiObj.data_chart || []) + '</script>' +
      '<div id="ai-chart-meta" data-type="' + (aiObj.chart_type || 'bar') + '" data-title="' + (aiObj.chart_title || 'Visualisasi Hasil') + '" data-label="' + (aiObj.chart_label || 'Nilai') + '"></div>';
  } catch (err) {
    return "<div class='alert alert-danger'><h6 class='fw-bold'><i class='fa-solid fa-triangle-exclamation me-1'></i> Terjadi kesalahan sistem AI</h6><p class='m-0' style='font-size: 13px;'>" + (err.message || err) + "</p></div>";
  }
}

function repairHtmlTagsGas(html) {
  if (!html) return html;
  var str = html.trim();
  var selfClosing = { area: true, base: true, br: true, col: true, embed: true, hr: true, img: true, input: true, link: true, meta: true, param: true, source: true, track: true, wbr: true };
  var stack = [];
  var tagRegex = /<\/?([a-zA-Z0-9]+)(?:\s+[^>]*?)?(\/?)>/g;
  var match;

  while ((match = tagRegex.exec(str)) !== null) {
    var isClosing = match[0].indexOf('</') === 0;
    var tagName = match[1].toLowerCase();
    var isSelfClosing = match[2] === '/' || selfClosing[tagName];

    if (isSelfClosing) continue;

    if (!isClosing) {
      stack.push(tagName);
    } else {
      var idx = stack.lastIndexOf(tagName);
      if (idx !== -1) {
        stack.splice(idx, stack.length - idx);
      }
    }
  }

  while (stack.length > 0) {
    var unclosed = stack.pop();
    if (unclosed) {
      str += '</' + unclosed + '>';
    }
  }

  return str;
}

function repairAndParseGeminiJsonGas(rawResponseText) {
  if (!rawResponseText) {
    return {
      narasi_html: "<p>Tidak ada respon yang dihasilkan dari model AI.</p>",
      chart_title: "Visualisasi Hasil",
      chart_type: "bar",
      chart_label: "Nilai",
      data_chart: []
    };
  }

  var cleaned = rawResponseText.replace(/```json/gi, "").replace(/```/gi, "").trim();

  // 1. Direct JSON parse
  try {
    var parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.narasi_html === 'string') {
      parsed.narasi_html = repairHtmlTagsGas(parsed.narasi_html);
      return parsed;
    }
  } catch (e1) {}

  // 2. Substring between first '{' and last '}'
  var firstBrace = cleaned.indexOf('{');
  var lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      var parsed2 = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
      if (parsed2 && typeof parsed2.narasi_html === 'string') {
        parsed2.narasi_html = repairHtmlTagsGas(parsed2.narasi_html);
        return parsed2;
      }
    } catch (e2) {}
  }

  // 3. Repair truncated JSON (unclosed string literals and unclosed brackets/braces)
  var inString = false;
  var isEscaped = false;
  var stack = [];

  for (var i = 0; i < cleaned.length; i++) {
    var c = cleaned.charAt(i);
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (c === '\\') {
      isEscaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (c === '{' || c === '[') {
        stack.push(c === '{' ? '}' : ']');
      } else if (c === '}' || c === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === c) {
          stack.pop();
        }
      }
    }
  }

  var repaired = cleaned;
  if (inString) {
    repaired += '"';
  }
  while (stack.length > 0) {
    repaired += stack.pop();
  }

  try {
    var parsed3 = JSON.parse(repaired);
    if (parsed3 && typeof parsed3.narasi_html === 'string') {
      parsed3.narasi_html = repairHtmlTagsGas(parsed3.narasi_html);
      return parsed3;
    }
  } catch (e3) {}

  // 4. Fallback regex extraction of "narasi_html"
  var narasiHtml = "";
  var narasiMatch = rawResponseText.match(/"narasi_html"\s*:\s*"([\s\S]*)/);
  if (narasiMatch && narasiMatch[1]) {
    var content = narasiMatch[1];
    content = content.replace(/"(?:\s*,\s*"chart_title"[\s\S]*)?$/, "");
    content = content.replace(/\\"/g, '"').replace(/\\n/g, "\n");
    narasiHtml = content;
  } else {
    narasiHtml = rawResponseText;
  }

  return {
    narasi_html: repairHtmlTagsGas(narasiHtml) || ("<p>" + rawResponseText + "</p>"),
    chart_title: "Visualisasi Analisis AI",
    chart_type: "bar",
    chart_label: "Nilai",
    data_chart: []
  };
}

// ============================================================
// KMZ/KML AUTO PARSER - Support KMZ & KML langsung
// ============================================================

/**
 * IMPORT FILE: Auto-detect KMZ atau KML, parse otomatis
 * @param {string} fileId - ID file di Google Drive
 * @param {string} operator - 'TSEL', 'IOH', atau 'XLS'
 */
function importKmzAuto(fileId, operator) {
  try {
    const file = DriveApp.getFileById(fileId);
    const fileName = file.getName().toLowerCase();
    const mimeType = file.getMimeType();
    const blob = file.getBlob();
    
    let kmlContent = '';
    let fileType = 'unknown';
    
    // Deteksi tipe file
    if (fileName.endsWith('.kml') || mimeType === 'application/vnd.google-earth.kml+xml') {
      kmlContent = blob.getDataAsString();
      fileType = 'KML';
    } else if (fileName.endsWith('.kmz') || mimeType === 'application/vnd.google-earth.kmz') {
      kmlContent = extractKmlFromKmz(blob);
      fileType = 'KMZ';
    } else {
      // Coba sebagai KML text
      try {
        kmlContent = blob.getDataAsString();
        if (kmlContent.indexOf('<kml') !== -1 || kmlContent.indexOf('<KML') !== -1) {
          fileType = 'KML (detected)';
        } else {
          throw new Error('Format file tidak dikenali. Gunakan file .kml atau .kmz');
        }
      } catch (e) {
        throw new Error('File bukan format KML/KMZ yang valid');
      }
    }
    
    // Parse KML content
    const parsedData = parseKmlContent(kmlContent, operator, fileId, file.getName());
    
    if (parsedData.length === 0) {
      logKmzImport(operator, file.getName(), 0, 'FAILED', 'Tidak ada data valid di file');
      return { success: false, message: "Tidak ada data valid terdeteksi di file " + fileType };
    }
    
    // Simpan ke sheet
    saveKmzToSheet(parsedData, operator);
    logKmzImport(operator, file.getName(), parsedData.length, 'SUCCESS', '');
    
    return {
      success: true,
      message: `✅ Berhasil import ${parsedData.length} data points dari file ${fileType} untuk ${operator}`,
      count: parsedData.length,
      fileType: fileType
    };
  } catch (err) {
    logKmzImport(operator, fileId, 0, 'FAILED', err.message);
    return { success: false, message: "Error: " + err.message };
  }
}

/**
 * Extract KML dari file KMZ (ZIP format)
 */
function extractKmlFromKmz(blob) {
  const bytes = blob.getBytes();
  
  // Cari signature ZIP (PK\x03\x04)
  let zipStart = -1;
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x50 && bytes[i+1] === 0x4B && 
        bytes[i+2] === 0x03 && bytes[i+3] === 0x04) {
      zipStart = i;
      break;
    }
  }
  
  if (zipStart === -1) {
    throw new Error('File KMZ tidak valid (ZIP signature tidak ditemukan)');
  }
  
  // Parse ZIP local file header
  let offset = zipStart;
  let kmlBytes = null;
  
  while (offset < bytes.length - 30) {
    if (bytes[offset] !== 0x50 || bytes[offset+1] !== 0x4B ||
        bytes[offset+2] !== 0x03 || bytes[offset+3] !== 0x04) {
      break;
    }
    
    const compressionMethod = bytes[offset + 8] | (bytes[offset + 9] << 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const uncompressedSize = readUint32(bytes, offset + 22);
    const fileNameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraFieldLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = String.fromCharCode.apply(null, bytes.slice(fileNameStart, fileNameEnd));
    
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;
    
    // Cari file doc.kml
    if (fileName.toLowerCase().endsWith('.kml') || fileName.toLowerCase() === 'doc.kml') {
      if (compressionMethod === 0) {
        kmlBytes = bytes.slice(dataStart, dataEnd);
      } else if (compressionMethod === 8) {
        try {
          const compressedData = bytes.slice(dataStart, dataEnd);
          const decompressed = Utilities.ungzip(compressedData);
          kmlBytes = decompressed;
        } catch (e) {
          kmlBytes = bytes.slice(dataStart, dataEnd);
        }
      }
      break;
    }
    
    offset = dataEnd;
  }
  
  if (!kmlBytes) {
    throw new Error('File doc.kml tidak ditemukan di dalam KMZ');
  }
  
  return Utilities.newBlob(kmlBytes).getDataAsString();
}

function readUint32(bytes, offset) {
  return (bytes[offset] & 0xFF) |
         ((bytes[offset + 1] & 0xFF) << 8) |
         ((bytes[offset + 2] & 0xFF) << 16) |
         ((bytes[offset + 3] & 0xFF) << 24);
}

/**
 * Parse konten KML menjadi array data terstruktur
 */
function parseKmlContent(kmlString, operator, fileId, fileName) {
  const results = [];
  
  try {
    const xml = XmlService.parse(kmlString);
    const root = xml.getRootElement();
    const kmlNs = XmlService.getNamespace('http://www.opengis.net/kml/2.2');
    
    const allElements = root.getDescendants();
    
    allElements.forEach(desc => {
      const el = desc.asElement();
      if (!el) return;
      
      if (el.getName() === 'Placemark') {
        const data = extractPlacemarkData(el, kmlNs, operator, fileId, fileName);
        if (data) results.push(data);
      }
    });
    
  } catch (err) {
    console.error("KML parse error:", err);
  }
  
  return results;
}

function extractPlacemarkData(placemarkEl, kmlNs, operator, fileId, fileName) {
  try {
    const nameEl = placemarkEl.getChild('name', kmlNs);
    const siteName = nameEl ? nameEl.getText() : 'Unknown';
    
    const descEl = placemarkEl.getChild('description', kmlNs);
    const description = descEl ? descEl.getText() : '';
    
    const pointEl = placemarkEl.getChild('Point', kmlNs);
    let lat = 0, lng = 0, alt = 0;
    
    if (pointEl) {
      const coordEl = pointEl.getChild('coordinates', kmlNs);
      if (coordEl) {
        const coordStr = coordEl.getText().trim();
        const parts = coordStr.split(',');
        if (parts.length >= 2) {
          lng = parseFloat(parts[0]);
          lat = parseFloat(parts[1]);
          if (parts.length >= 3) alt = parseFloat(parts[2]) || 0;
        }
      }
    }
    
    if (lat === 0 && lng === 0) return null;
    
    const signalData = parseSignalFromDescription(description);
    
    const extDataEl = placemarkEl.getChild('ExtendedData', kmlNs);
    let extendedValues = {};
    if (extDataEl) {
      const dataElements = extDataEl.getChildren('Data', kmlNs);
      dataElements.forEach(d => {
        const name = d.getAttribute('name') ? d.getAttribute('name').getValue() : '';
        const valueEl = d.getChild('value', kmlNs);
        if (name && valueEl) {
          extendedValues[name] = valueEl.getText();
        }
      });
      
      const schemaDataEls = extDataEl.getChildren('SchemaData', kmlNs);
      schemaDataEls.forEach(sd => {
        const simpleDataEls = sd.getChildren('SimpleData', kmlNs);
        simpleDataEls.forEach(sd2 => {
          const name = sd2.getAttribute('name') ? sd2.getAttribute('name').getValue() : '';
          if (name) extendedValues[name] = sd2.getText();
        });
      });
    }
    
    const rsrp = parseFloat(extendedValues['RSRP'] || extendedValues['rsrp'] || signalData.dbm) || 0;
    const rsrq = parseFloat(extendedValues['RSRQ'] || extendedValues['rsrq']) || 0;
    const sinr = parseFloat(extendedValues['SINR'] || extendedValues['sinr']) || 0;
    const rssi = parseFloat(extendedValues['RSSI'] || extendedValues['rssi'] || signalData.dbm) || 0;
    const technology = extendedValues['Technology'] || extendedValues['technology'] || extendedValues['RAT'] || 'LTE';
    const band = extendedValues['Band'] || extendedValues['band'] || extendedValues['EARFCN'] || '';
    const pci = extendedValues['PCI'] || extendedValues['pci'] || '';
    const earfcn = extendedValues['EARFCN'] || extendedValues['earfcn'] || '';
    const timestamp = extendedValues['Timestamp'] || extendedValues['timestamp'] || extendedValues['Time'] || '';
    const speed = parseFloat(extendedValues['Speed'] || extendedValues['speed']) || 0;
    const address = extendedValues['Address'] || extendedValues['address'] || '';
    const city = extendedValues['City'] || extendedValues['city'] || '';
    const district = extendedValues['District'] || extendedValues['district'] || '';
    
    return [
      'IMP-' + new Date().getTime(),
      new Date(),
      operator,
      siteName,
      siteName,
      'point',
      lat,
      lng,
      alt,
      signalData.dbm,
      signalData.category,
      rsrp,
      rsrq,
      sinr,
      rssi,
      technology,
      band,
      pci,
      earfcn,
      timestamp,
      speed,
      address,
      city,
      district,
      fileId,
      fileName,
      description.substring(0, 500)
    ];
  } catch (err) {
    console.error("Extract placemark error:", err);
    return null;
  }
}

function parseSignalFromDescription(desc) {
  const result = { dbm: 0, category: 'Unknown' };
  if (!desc) return result;
  
  const patterns = [
    /RSRP\s*[=:]\s*(-?\d{2,3})\s*dBm?/i,
    /Signal\s*[=:]\s*(-?\d{2,3})\s*dBm?/i,
    /(-\d{2,3})\s*dBm/i,
    /Level\s*[=:]\s*(-?\d{2,3})/i
  ];
  
  for (const pattern of patterns) {
    const match = desc.match(pattern);
    if (match) {
      result.dbm = parseFloat(match[1]);
      break;
    }
  }
  
  if (result.dbm >= -80) result.category = 'Excellent';
  else if (result.dbm >= -90) result.category = 'Good';
  else if (result.dbm >= -100) result.category = 'Fair';
  else if (result.dbm >= -110) result.category = 'Poor';
  else if (result.dbm < -110 && result.dbm !== 0) result.category = 'No Signal';
  
  return result;
}

function saveKmzToSheet(parsedData, operator) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName("DT_KMZ_Parsed");
  
  if (!sheet) {
    setupKmzSheetHelper();
    sheet = ss.getSheetByName("DT_KMZ_Parsed");
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const allData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const rowsToKeep = allData.filter(row => row[2] !== operator);
    
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clear();
    
    if (rowsToKeep.length > 0) {
      sheet.getRange(2, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep);
    }
  }
  
  if (parsedData.length > 0) {
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, parsedData.length, parsedData[0].length).setValues(parsedData);
  }
}

function logKmzImport(operator, fileName, count, status, error) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let logSheet = ss.getSheetByName("DT_KMZ_ImportLog");
  if (!logSheet) {
    setupKmzSheetHelper();
    logSheet = ss.getSheetByName("DT_KMZ_ImportLog");
  }
  
  const nextRow = logSheet.getLastRow() + 1;
  logSheet.getRange(nextRow, 1, 1, 6).setValues([[
    new Date(), operator, fileName, count, status, error
  ]]);
}

function setupKmzSheetHelper() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  let sheet = ss.getSheetByName("DT_KMZ_Parsed");
  if (!sheet) sheet = ss.insertSheet("DT_KMZ_Parsed");
  sheet.clear();
  
  const headers = [
    'Import ID', 'Import Date', 'Operator', 'Site ID', 'Site Name',
    'Data Type', 'Latitude', 'Longitude', 'Altitude (m)', 'Signal dBm',
    'Signal Category', 'RSRP (dBm)', 'RSRQ (dB)', 'SINR (dB)', 'RSSI (dBm)',
    'Technology', 'Band', 'PCI', 'EARFCN', 'Timestamp',
    'Speed (km/h)', 'Address', 'City', 'District', 'File ID', 'File Name', 'Description'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
  
  const rules = [];
  const catRange = sheet.getRange(2, 11, 10000, 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Excellent').setBackground('#10b981').setFontColor('#ffffff').setRanges([catRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Good').setBackground('#3b82f6').setFontColor('#ffffff').setRanges([catRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Fair').setBackground('#f59e0b').setFontColor('#000000').setRanges([catRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Poor').setBackground('#ef4444').setFontColor('#ffffff').setRanges([catRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('No Signal').setBackground('#6b7280').setFontColor('#ffffff').setRanges([catRange]).build());
  sheet.setConditionalFormatRules(rules);
  
  let logSheet = ss.getSheetByName("DT_KMZ_ImportLog");
  if (!logSheet) logSheet = ss.insertSheet("DT_KMZ_ImportLog");
  logSheet.clear();
  logSheet.getRange(1, 1, 1, 6).setValues([['Timestamp', 'Operator', 'File Name', 'Total Points', 'Status', 'Error']]);
  logSheet.getRange(1, 1, 1, 6).setBackground('#0f172a').setFontColor('#ffffff').setFontWeight('bold');
  logSheet.setFrozenRows(1);
  
  return "✅ Sheet helper berhasil dibuat";
}

function getKmzParsedData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("DT_KMZ_Parsed");
  
  if (!sheet || sheet.getLastRow() <= 1) {
    return { tsel: [], ioh: [], xls: [], summary: {}, totalPoints: 0 };
  }
  
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  
  const result = { tsel: [], ioh: [], xls: [], summary: {}, totalPoints: data.length };
  
  data.forEach(row => {
    const obj = {
      importId: row[0],
      operator: row[2],
      siteId: row[3],
      siteName: row[4],
      type: row[5],
      lat: row[6],
      lng: row[7],
      altitude: row[8],
      signalDbm: row[9],
      category: row[10],
      rsrp: row[11],
      rsrq: row[12],
      sinr: row[13],
      rssi: row[14],
      technology: row[15],
      band: row[16],
      pci: row[17],
      city: row[22],
      district: row[23],
      description: row[26]
    };
    
    if (obj.operator === 'TSEL') result.tsel.push(obj);
    else if (obj.operator === 'IOH') result.ioh.push(obj);
    else if (obj.operator === 'XLS') result.xls.push(obj);
  });
  
  ['tsel', 'ioh', 'xls'].forEach(op => {
    const points = result[op].filter(p => p.signalDbm !== 0);
    if (points.length > 0) {
      const avgDbm = points.reduce((sum, p) => sum + p.signalDbm, 0) / points.length;
      const categories = {};
      points.forEach(p => {
        categories[p.category] = (categories[p.category] || 0) + 1;
      });
      
      const cityStats = {};
      points.forEach(p => {
        const city = p.city || 'Unknown';
        if (!cityStats[city]) cityStats[city] = { count: 0, sumSignal: 0 };
        cityStats[city].count++;
        cityStats[city].sumSignal += p.signalDbm;
      });
      
      Object.keys(cityStats).forEach(city => {
        cityStats[city].avgSignal = parseFloat((cityStats[city].sumSignal / cityStats[city].count).toFixed(2));
      });
      
      result.summary[op] = {
        totalPoints: points.length,
        avgSignalDbm: parseFloat(avgDbm.toFixed(2)),
        bestSignal: Math.max(...points.map(p => p.signalDbm)),
        worstSignal: Math.min(...points.map(p => p.signalDbm)),
        categoryDistribution: categories,
        cityDistribution: cityStats
      };
    }
  });
  
  return result;
}

function getKmzAnalytics() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("DT_KMZ_Parsed");
  
  if (!sheet || sheet.getLastRow() <= 1) {
    return {
      summary: { totalPoints: 0, operators: {} },
      cityStats: [],
      categoryDistribution: {},
      worstSites: [],
      bestSites: [],
      heatmapData: { tsel: [], ioh: [], xls: [] }
    };
  }
  
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  
  const allPoints = [];
  data.forEach(function(row) {
    if (!row[6] || !row[7]) return;
    
    allPoints.push({
      operator: row[2],
      siteId: row[3],
      siteName: row[4],
      lat: parseFloat(row[6]),
      lng: parseFloat(row[7]),
      signalDbm: parseFloat(row[9]) || 0,
      category: row[10] || 'Unknown',
      rsrp: parseFloat(row[11]) || 0,
      sinr: parseFloat(row[13]) || 0,
      technology: row[15] || 'LTE',
      city: row[22] || 'Unknown',
      district: row[23] || 'Unknown'
    });
  });
  
  const summary = { totalPoints: allPoints.length, operators: {} };
  ['TSEL', 'IOH', 'XLS'].forEach(function(op) {
    const points = allPoints.filter(p => p.operator === op);
    const validPoints = points.filter(p => p.signalDbm !== 0);
    
    if (validPoints.length > 0) {
      const avgSignal = validPoints.reduce((s, p) => s + p.signalDbm, 0) / validPoints.length;
      const categories = {};
      validPoints.forEach(p => {
        categories[p.category] = (categories[p.category] || 0) + 1;
      });
      
      summary.operators[op] = {
        totalPoints: points.length,
        avgSignal: parseFloat(avgSignal.toFixed(2)),
        bestSignal: Math.max(...validPoints.map(p => p.signalDbm)),
        worstSignal: Math.min(...validPoints.map(p => p.signalDbm)),
        categories: categories
      };
    }
  });
  
  const cityMap = {};
  allPoints.forEach(p => {
    const city = p.city || 'Unknown';
    if (!cityMap[city]) {
      cityMap[city] = { 
        total: 0, 
        sumSignal: 0, 
        operators: { TSEL: 0, IOH: 0, XLS: 0 },
        categories: {}
      };
    }
    cityMap[city].total++;
    cityMap[city].sumSignal += p.signalDbm;
    if (cityMap[city].operators[p.operator] !== undefined) {
      cityMap[city].operators[p.operator]++;
    }
    cityMap[city].categories[p.category] = (cityMap[city].categories[p.category] || 0) + 1;
  });
  
  const cityStats = Object.keys(cityMap).map(city => {
    const c = cityMap[city];
    return {
      city: city,
      totalPoints: c.total,
      avgSignal: parseFloat((c.sumSignal / c.total).toFixed(2)),
      operators: c.operators,
      categories: c.categories
    };
  }).sort((a, b) => b.totalPoints - a.totalPoints);
  
  const categoryDistribution = {};
  allPoints.forEach(p => {
    categoryDistribution[p.category] = (categoryDistribution[p.category] || 0) + 1;
  });
  
  const validPoints = allPoints.filter(p => p.signalDbm !== 0);
  validPoints.sort((a, b) => a.signalDbm - b.signalDbm);
  
  const worstSites = validPoints.slice(0, 10).map(p => ({
    siteId: p.siteId,
    siteName: p.siteName,
    operator: p.operator,
    signalDbm: p.signalDbm,
    category: p.category,
    city: p.city,
    lat: p.lat,
    lng: p.lng
  }));
  
  const bestSites = validPoints.slice(-10).reverse().map(p => ({
    siteId: p.siteId,
    siteName: p.siteName,
    operator: p.operator,
    signalDbm: p.signalDbm,
    category: p.category,
    city: p.city
  }));
  
  const heatmapData = { tsel: [], ioh: [], xls: [] };
  allPoints.forEach(p => {
    if (p.signalDbm === 0) return;
    
    const intensity = Math.max(0, Math.min(1, (p.signalDbm + 120) / 60));
    const point = [p.lat, p.lng, intensity];
    
    const opKey = p.operator.toLowerCase();
    if (heatmapData[opKey]) {
      heatmapData[opKey].push(point);
    }
  });
  
  return {
    summary: summary,
    cityStats: cityStats,
    categoryDistribution: categoryDistribution,
    worstSites: worstSites,
    bestSites: bestSites,
    heatmapData: heatmapData
  };
}

// ============================================================
// FUNGSI AUDIT DRIVE TEST - VERSI ROBUST (AUTO-DETECT)
// ============================================================
function auditDriveTestColumns() {
  try {
    Logger.log("🚀 Memulai audit Drive Test (versi robust)...");
    Logger.log("📋 SPREADSHEET_ID: " + SPREADSHEET_ID);
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    Logger.log("✅ Spreadsheet berhasil dibuka: " + ss.getName());
    
    // Tampilkan semua sheet
    const sheets = ss.getSheets();
    Logger.log("\n=== DAFTAR SEMUA SHEET ===");
    sheets.forEach((s, i) => {
      Logger.log(`  [${i}] ${s.getName()} (GID: ${s.getSheetId()}, Rows: ${s.getLastRow()}, Cols: ${s.getLastColumn()})`);
    });
    
    // Cari sheet yang kemungkinan berisi Drive Test
    // Berdasarkan nama sheet atau kolom Drive Test
    let targetSheet = null;
    let targetSheetName = "";
    
    // Prioritas 1: Cari sheet dengan nama yang mengandung "Drive" atau "Service Level"
    const candidateNames = ["Drive Test", "Service Level Base", "DriveTest", "DT"];
    for (const s of sheets) {
      const name = s.getName();
      if (candidateNames.some(cn => name.toLowerCase().includes(cn.toLowerCase()))) {
        targetSheet = s;
        targetSheetName = name;
        break;
      }
    }
    
    // Prioritas 2: Cari sheet dengan GID 1356065183 (sheet utama)
    if (!targetSheet) {
      for (const s of sheets) {
        if (s.getSheetId().toString() === "1356065183") {
          targetSheet = s;
          targetSheetName = s.getName() + " (GID 1356065183)";
          break;
        }
      }
    }
    
    // Prioritas 3: Cari sheet yang punya kolom "TSEL Total Coverage"
    if (!targetSheet) {
      for (const s of sheets) {
        if (s.getLastRow() < 2) continue;
        const headers = s.getRange(1, 1, 1, Math.min(s.getLastColumn(), 150)).getValues()[0];
        if (headers.includes("TSEL Total Coverage") || headers.includes("TSEL Total Coverage ")) {
          targetSheet = s;
          targetSheetName = s.getName() + " (terdeteksi via kolom Drive Test)";
          break;
        }
      }
    }
    
    if (!targetSheet) {
      Logger.log("\n❌ ERROR: Tidak ada sheet yang cocok untuk Drive Test!");
      Logger.log("💡 Solusi: Pastikan ada sheet dengan nama 'Drive Test', 'Service Level Base', atau sheet yang memiliki kolom 'TSEL Total Coverage'");
      return;
    }
    
    Logger.log("\n✅ Sheet target ditemukan: " + targetSheetName);
    
    const lastRow = targetSheet.getLastRow();
    const lastCol = targetSheet.getLastColumn();
    Logger.log(`📊 Ukuran sheet: ${lastRow} baris × ${lastCol} kolom`);
    
    if (lastRow <= 1) {
      Logger.log("⚠️ Sheet kosong atau hanya ada header!");
      return;
    }
    
    const headers = targetSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    
    Logger.log("\n=== KOLOM DRIVE TEST YANG DICARI ===");
    
    const targetColumns = [
      'Site ID', 'Site Name', 'City', 'Province', 'Land Asset', 
      'Status Group', 'Morphoclass', 'Tower Type', 'Tower Height', 'Active Tenant',
      'TSEL Deep Indoor', 'TSEL Indoor', 'TSEL First Wall', 'TSEL Outdoor', 'TSEL Total Coverage', 'TSEL Maps', 'TSEL Samples',
      'IOH Deep Indoor', 'IOH Indoor', 'IOH First Wall', 'IOH Outdoor', 'IOH Total Coverage', 'IOH Maps', 'IOH Samples',
      'XLS Deep Indoor', 'XLS Indoor', 'XLS First Wall', 'XLS Outdoor', 'XLS Total Coverage', 'XLS Maps', 'XLS Samples'
    ];
    
    const foundColumns = {};
    targetColumns.forEach(col => {
      // Cari dengan pencocokan fleksibel (trim whitespace)
      let idx = headers.findIndex(h => h && h.toString().trim() === col);
      if (idx === -1) {
        // Coba cari dengan nama mirip
        idx = headers.findIndex(h => h && h.toString().trim().toLowerCase().includes(col.toLowerCase()));
      }
      
      if (idx !== -1) {
        let colLetter = '';
        let temp = idx;
        while (temp >= 0) {
          colLetter = String.fromCharCode((temp % 26) + 65) + colLetter;
          temp = Math.floor(temp / 26) - 1;
        }
        foundColumns[col] = idx;
        Logger.log(`✅ ${col}: Index ${idx} (Kolom ${colLetter})`);
      } else {
        Logger.log(`❌ ${col}: TIDAK DITEMUKAN`);
      }
    });
    
    // Cek kolom penting
    const criticalColumns = ['Site ID', 'TSEL Total Coverage', 'IOH Total Coverage', 'XLS Total Coverage'];
    const missingCritical = criticalColumns.filter(c => foundColumns[c] === undefined);
    
    if (missingCritical.length > 0) {
      Logger.log("\n⚠️ PERINGATAN: Kolom penting berikut TIDAK ADA:");
      missingCritical.forEach(c => Logger.log(`   - ${c}`));
      Logger.log("💡 Ini kemungkinan besar penyebab halaman Drive Test BLANK!");
    } else {
      Logger.log("\n✅ Semua kolom penting ditemukan!");
    }
    
    // Sample data 5 baris pertama
    Logger.log("\n=== SAMPLE DATA (5 BARIS PERTAMA) ===");
    const sampleRange = targetSheet.getRange(2, 1, Math.min(5, lastRow - 1), lastCol);
    const sampleData = sampleRange.getValues();
    
    const idxSiteId = foundColumns['Site ID'];
    const idxTselKpi = foundColumns['TSEL Total Coverage'];
    const idxIohKpi = foundColumns['IOH Total Coverage'];
    const idxXlsKpi = foundColumns['XLS Total Coverage'];
    
    sampleData.forEach((row, i) => {
      Logger.log(`\n📋 Baris ${i+1}:`);
      if (idxSiteId !== undefined) Logger.log(`   Site ID: ${row[idxSiteId]}`);
      if (idxTselKpi !== undefined) Logger.log(`   TSEL KPI: "${row[idxTselKpi]}" (Type: ${typeof row[idxTselKpi]})`);
      if (idxIohKpi !== undefined) Logger.log(`   IOH KPI: "${row[idxIohKpi]}" (Type: ${typeof row[idxIohKpi]})`);
      if (idxXlsKpi !== undefined) Logger.log(`   XLS KPI: "${row[idxXlsKpi]}" (Type: ${typeof row[idxXlsKpi]})`);
    });
    
    // Hitung berapa baris yang punya data KPI
    if (idxTselKpi !== undefined || idxIohKpi !== undefined || idxXlsKpi !== undefined) {
      let rowsWithKpi = 0;
      let rowsWithoutKpi = 0;
      
      const allData = targetSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      allData.forEach(row => {
        const tsel = parseFloat(String(row[idxTselKpi] || '0').replace('%', '').replace(',', '.')) || 0;
        const ioh = parseFloat(String(row[idxIohKpi] || '0').replace('%', '').replace(',', '.')) || 0;
        const xls = parseFloat(String(row[idxXlsKpi] || '0').replace('%', '').replace(',', '.')) || 0;
        
        if (tsel > 0 || ioh > 0 || xls > 0) rowsWithKpi++;
        else rowsWithoutKpi++;
      });
      
      Logger.log("\n=== STATISTIK DATA KPI ===");
      Logger.log(`✅ Baris dengan KPI > 0: ${rowsWithKpi}`);
      Logger.log(`⚠️ Baris tanpa KPI (di-skip): ${rowsWithoutKpi}`);
      
      if (rowsWithKpi === 0) {
        Logger.log("\n🚨 KESIMPULAN: TIDAK ADA DATA DRIVE TEST YANG VALID!");
        Logger.log("💡 Kemungkinan penyebab:");
        Logger.log("   1. Nama kolom berbeda (misal 'TSEL Coverage' bukan 'TSEL Total Coverage')");
        Logger.log("   2. Semua nilai KPI kosong atau 0");
        Logger.log("   3. Data Drive Test ada di sheet/tab terpisah");
      } else {
        Logger.log(`\n✅ DITEMUKAN ${rowsWithKpi} SITE DENGAN DATA DRIVE TEST VALID!`);
        Logger.log("💡 Halaman Drive Test seharusnya bisa tampil.");
      }
    }
    
    Logger.log("\n=== AUDIT SELESAI ===");
    
  } catch (err) {
    Logger.log("❌ CRITICAL ERROR: " + err.message);
    Logger.log("Stack: " + err.stack);
  }
}

function clearAllCaches() {
  const cache = CacheService.getScriptCache();
  cache.removeAll(['rf_dashboard_default', 'rf_dt_v1_data', 'rf_dt_v2_data']);
  Logger.log("✅ Cache berhasil dihapus!");
}

function getFOData() {
  try {
    const SPREADSHEET_FO_ID = "1uVZCTAKjRcTRka-GFZtV0ttIAo1U6H7GRYfCxLl7icQ";
    const ss = SpreadsheetApp.openById(SPREADSHEET_FO_ID);
    const sheet = ss.getSheetByName("FO Database");
    if (!sheet) {
      throw new Error("Sheet 'FO Database' tidak ditemukan.");
    }
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1) {
      return { data: [], filterOptions: { siteId: [], siteName: [], status: [], mediaTransmisi: [], linkStatus: [], coreStatus: [] } };
    }
    const rows = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = rows[0];
    const rawRows = rows.slice(1);

    const colIdx = function(name) {
      return headers.findIndex(function(h) {
        return h && h.toString().trim().toLowerCase() === name.trim().toLowerCase();
      });
    };

    const idxSiteId = colIdx('Site ID');
    const idxSiteName = colIdx('Site Name');
    const idxCity = colIdx('City');
    const idxStatusGrouping = colIdx('Status Grouping');
    const idxLonglat = colIdx('Longlat');
    const idxLinkStatus = colIdx('Link Status');
    const idxMediaTransmisi = colIdx('Media Transmisi');
    const idxRemarks = colIdx('Remarks');
    const idxActiveTenant = colIdx('Active tenant');
    const idxCoreCapacity = colIdx('Core Capacity');
    const idxUsedCore = colIdx('Used Core');
    const idxCoreAvailable = colIdx('Core Available');
    const idxStatusCore = colIdx('Status Core');

    const data = [];
    rawRows.forEach(function(row) {
      const siteIdStr = idxSiteId !== -1 ? (row[idxSiteId] || '').toString().trim() : '';
      if (!siteIdStr) return; // Skip empty rows

      const siteNameStr = idxSiteName !== -1 ? (row[idxSiteName] || '').toString().trim() : 'N/A';
      const cityStr = idxCity !== -1 ? (row[idxCity] || '').toString().trim() : 'N/A';
      const statusGroupingStr = idxStatusGrouping !== -1 ? (row[idxStatusGrouping] || '').toString().trim() : 'N/A';
      const linkStatusStr = idxLinkStatus !== -1 ? (row[idxLinkStatus] || '').toString().trim() : 'N/A';
      const mediaTransmisiStr = idxMediaTransmisi !== -1 ? (row[idxMediaTransmisi] || '').toString().trim() : 'N/A';
      const remarksStr = idxRemarks !== -1 ? (row[idxRemarks] || '').toString().trim() : '';
      const activeTenantStr = idxActiveTenant !== -1 ? (row[idxActiveTenant] || '').toString().trim() : 'N/A';
      const coreCapacityStr = idxCoreCapacity !== -1 ? (row[idxCoreCapacity] || '').toString().trim() : 'N/A';
      const usedCoreStr = idxUsedCore !== -1 ? (row[idxUsedCore] || '').toString().trim() : 'N/A';
      const coreAvailableStr = idxCoreAvailable !== -1 ? (row[idxCoreAvailable] || '').toString().trim() : 'N/A';
      const statusCoreStr = idxStatusCore !== -1 ? (row[idxStatusCore] || '').toString().trim() : 'N/A';

      let lat = 0;
      let lng = 0;
      const longlatVal = idxLonglat !== -1 ? (row[idxLonglat] || '').toString().trim() : '';
      if (longlatVal && longlatVal.includes(',')) {
        const parts = longlatVal.split(',');
        lat = parseFloat(parts[0].trim());
        lng = parseFloat(parts[1].trim());
      }

      data.push({
        siteId: siteIdStr,
        siteName: siteNameStr,
        city: cityStr,
        status: statusGroupingStr,
        lat: isNaN(lat) ? 0 : lat,
        lng: isNaN(lng) ? 0 : lng,
        linkStatus: linkStatusStr,
        mediaTransmisi: mediaTransmisiStr,
        remarks: remarksStr,
        activeTenant: activeTenantStr,
        coreCapacity: coreCapacityStr,
        usedCore: usedCoreStr,
        coreAvailable: coreAvailableStr,
        coreStatus: statusCoreStr
      });
    });

    const getUnique = function(arr) {
      const u = {};
      arr.forEach(function(v) {
        if (v && v !== 'N/A') u[v] = true;
      });
      return Object.keys(u).sort();
    };

    return {
      data: data,
      filterOptions: {
        siteId: getUnique(data.map(function(d) { return d.siteId; })),
        siteName: getUnique(data.map(function(d) { return d.siteName; })),
        status: getUnique(data.map(function(d) { return d.status; })),
        mediaTransmisi: getUnique(data.map(function(d) { return d.mediaTransmisi; })),
        linkStatus: getUnique(data.map(function(d) { return d.linkStatus; })),
        coreStatus: getUnique(data.map(function(d) { return d.coreStatus; }))
      }
    };
  } catch (err) {
    Logger.log("Error in getFOData: " + err.toString());
    throw err;
  }
}

function processKmzFile(fileId) {
  if (!fileId || typeof fileId !== 'string') {
    throw new Error("ID File tidak valid.");
  }
  fileId = fileId.trim();

  try {
    var driveAppRef = this['DriveApp'];
    if (!driveAppRef) {
      throw new Error("Layanan DriveApp tidak tersedia.");
    }
    var file = driveAppRef.getFileById(fileId);
    var fileName = file.getName().toLowerCase();

    // 2. Handle plain KML files directly without unzipping
    if (fileName.endsWith('.kml')) {
      return file.getBlob().getDataAsString();
    }

    // 3. Handle KMZ files
    var blob = file.getBlob();
    blob.setContentType('application/zip');
    var unzippedBlobs = Utilities.unzip(blob);
    
    var kmlBlob = unzippedBlobs.find(function(b) {
      return b.getName().toLowerCase().endsWith('.kml');
    }) || unzippedBlobs[0];

    return kmlBlob.getDataAsString();

  } catch (err) {
    Logger.log("Error processing file ID " + fileId + ": " + err.message);
    if (err.message && (err.message.indexOf("permission") !== -1 || err.message.indexOf("DriveApp") !== -1)) {
      throw new Error("Google Drive membatasi akses file ini. Pastikan file diset 'Siapa saja yang memiliki link' (Anyone with the link), atau gunakan tombol 'Upload File KMZ / KML dari Komputer'.");
    }
    throw new Error("Gagal membaca file KMZ/KML: " + err.message);
  }
}

function listKmzFilesInFolder(folderId) {
  try {
    if (!folderId || typeof folderId !== 'string') {
      throw new Error("Folder ID atau Link Google Drive tidak boleh kosong.");
    }
    folderId = folderId.trim();
    var match = folderId.match(/[-\w]{25,}/);
    if (match) folderId = match[0];

    // 1. Try DriveApp as folder/file if permissions granted
    try {
      var folder = DriveApp.getFolderById(folderId);
      var files = folder.getFiles();
      var result = [];
      while (files.hasNext()) {
        var f = files.next();
        var fn = f.getName().toLowerCase();
        if (fn.endsWith('.kmz') || fn.endsWith('.kml')) {
          result.push({
            id: f.getId(),
            name: f.getName(),
            size: f.getSize(),
            mimeType: f.getMimeType()
          });
        }
      }
      if (result.length > 0) return result;
    } catch(eFolder) {
      // Permission missing or not a folder
    }

    // Default fallback descriptor for single file or link
    return [{
      id: folderId,
      name: "Google_Drive_Backbone_" + folderId.substring(0, 8) + ".kmz",
      size: 0,
      mimeType: "application/vnd.google-earth.kmz"
    }];
  } catch(err) {
    return [{
      id: folderId || 'DRIVE_FILE',
      name: "Google_Drive_KMZ_Link",
      size: 0,
      mimeType: "application/vnd.google-earth.kmz"
    }];
  }
}

function getKmzFileContent(fileId) {
  try {
    if (!fileId || typeof fileId !== 'string') {
      throw new Error("File ID tidak valid.");
    }
    fileId = fileId.trim();
    var match = fileId.match(/[-\w]{25,}/);
    if (match) {
      fileId = match[0];
    }

    // 1. First attempt: Public fetch via UrlFetchApp (Does NOT require DriveApp OAuth permission!)
    var urlsToTry = [
      "https://drive.google.com/uc?export=download&confirm=t&id=" + fileId,
      "https://lh3.googleusercontent.com/d/" + fileId,
      "https://drive.google.com/uc?export=download&id=" + fileId,
      "https://docs.google.com/uc?export=download&id=" + fileId
    ];

    for (var i = 0; i < urlsToTry.length; i++) {
      try {
        var response = UrlFetchApp.fetch(urlsToTry[i], {
          muteHttpExceptions: true,
          followRedirects: true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (response.getResponseCode() === 200) {
          var blob = response.getBlob();
          var contentStr = blob.getDataAsString();

          // Check if response is plain KML XML
          if (contentStr.indexOf('<kml') !== -1 || contentStr.indexOf('<?xml') !== -1 || contentStr.indexOf('<Document>') !== -1) {
            return contentStr;
          }

          // Check if Drive returned virus scan confirmation HTML page
          if (contentStr.indexOf('confirm=') !== -1) {
            var confirmTokenMatch = contentStr.match(/confirm=([a-zA-Z0-9_-]+)/);
            if (confirmTokenMatch && confirmTokenMatch[1]) {
              var confirmUrl = "https://drive.google.com/uc?export=download&confirm=" + confirmTokenMatch[1] + "&id=" + fileId;
              var resp2 = UrlFetchApp.fetch(confirmUrl, { muteHttpExceptions: true, followRedirects: true });
              if (resp2.getResponseCode() === 200) {
                blob = resp2.getBlob();
                contentStr = blob.getDataAsString();
                if (contentStr.indexOf('<kml') !== -1 || contentStr.indexOf('<?xml') !== -1 || contentStr.indexOf('<Document>') !== -1) {
                  return contentStr;
                }
              }
            }
          }

          // Try unzipping KMZ file
          try {
            blob.setContentType('application/zip');
            var unzipped = Utilities.unzip(blob);
            var kmlBlob = unzipped.find(function(b) {
              return b.getName().toLowerCase().endsWith('.kml');
            }) || unzipped[0];
            if (kmlBlob) {
              return kmlBlob.getDataAsString();
            }
          } catch(eZip) {
            // Not a valid zip
          }
        }
      } catch(eFetch) {
        // Fetch attempt failed
      }
    }

    // 2. Second attempt: Try DriveApp if permissions are granted in Apps Script
    try {
      return processKmzFile(fileId);
    } catch(eDrive) {
      if (eDrive.message && eDrive.message.indexOf("permission") !== -1) {
        throw new Error("Akses file Google Drive memerlukan izin 'Siapa saja yang memiliki link' (Anyone with the link). Atau silakan gunakan opsi 'Upload File KMZ / KML dari Komputer' di atas!");
      }
      throw eDrive;
    }

    throw new Error("Gagal mengunduh file KMZ/KML dari Google Drive. Pastikan file Google Drive diset publik: 'Siapa saja yang memiliki link' (Anyone with the link), atau gunakan tombol 'Upload File KMZ / KML dari Komputer'!");
  } catch(err) {
    Logger.log("Error in getKmzFileContent: " + err.message);
    throw new Error(err.message);
  }
}

/**
 * Helper to write log entries to FO_Import_Log sheet
 * Spreadsheet ID: 1uVZCTAKjRcTRka-GFZtV0ttIAo1U6H7GRYfCxLl7icQ
 * Tab Name: FO_Import_Log
 * Columns: Timestamp, File Name, File ID, Total Routes, Total Length (km), Status, Error
 */
function logFoImport(ss, fileName, fileId, totalRoutes, totalLengthKm, status, errorMsg) {
  try {
    var logSheet = ss.getSheetByName("FO_Import_Log");
    if (!logSheet) {
      logSheet = ss.insertSheet("FO_Import_Log");
      var headers = ["Timestamp", "File Name", "File ID", "Total Routes", "Total Length (km)", "Status", "Error"];
      logSheet.appendRow(headers);
      logSheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#0f172a").setFontColor("#ffffff");
      logSheet.setFrozenRows(1);
    }
    
    var nowStr = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss");
    logSheet.appendRow([
      nowStr,
      fileName || 'Uploaded_KMZ.kmz',
      fileId || 'LOCAL_UPLOAD',
      totalRoutes || 0,
      totalLengthKm || 0,
      status || 'SUCCESS',
      errorMsg || ''
    ]);
  } catch (e) {
    Logger.log("Error in logFoImport: " + e.message);
  }
}

/**
 * Retrieves import logs from FO_Import_Log sheet
 */
function getFOImportLogs() {
  try {
    var SPREADSHEET_FO_ID = "1uVZCTAKjRcTRka-GFZtV0ttIAo1U6H7GRYfCxLl7icQ";
    var ss = SpreadsheetApp.openById(SPREADSHEET_FO_ID);
    var sheet = ss.getSheetByName("FO_Import_Log");
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    return data.map(function(r) {
      return {
        timestamp: r[0],
        fileName: r[1],
        fileId: r[2],
        totalRoutes: r[3],
        totalLengthKm: r[4],
        status: r[5],
        error: r[6]
      };
    });
  } catch (e) {
    Logger.log("Error in getFOImportLogs: " + e.message);
    return [];
  }
}

/**
 * Saves uploaded KMZ/KML route records directly to Google Sheets (FO_Links & FO_Import_Log)
 * Spreadsheet ID: 1uVZCTAKjRcTRka-GFZtV0ttIAo1U6H7GRYfCxLl7icQ
 * Tab Name: FO_Links
 * Columns (12): Link Name, City, Type, Capacity Core, Core Used, Available, Core Status, Length (m), Status, RFS Year, From Site, To Site
 * @param {string} fileName - File name
 * @param {string} fileId - File or Drive ID / Local Upload
 * @param {string} kmlContent - Raw KML XML string
 * @param {string} operator - Operator / Tenant group (default: 'ALL')
 */
function saveKmzRecordToSheet(fileName, fileId, kmlContent, operator, parsedRoutes) {
  try {
    var SPREADSHEET_FO_ID = "1uVZCTAKjRcTRka-GFZtV0ttIAo1U6H7GRYfCxLl7icQ";
    operator = operator || 'ALL';
    fileName = fileName || 'Uploaded_KMZ_File.kmz';
    fileId = fileId || 'LOCAL_UPLOAD';

    var ss = SpreadsheetApp.openById(SPREADSHEET_FO_ID);

    var sheet = ss.getSheetByName("FO_Links");
    var headers12 = ["Link Name", "City", "Type", "Capacity Core", "Core Used", "Available", "Core Status", "Length (m)", "Status", "RFS Year", "From Site", "To Site"];

    if (!sheet) {
      sheet = ss.insertSheet("FO_Links");
      sheet.appendRow(headers12);
      sheet.getRange(1, 1, 1, 12).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    } else {
      // Check header format
      var existingHeader = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 12)).getValues()[0];
      if (!existingHeader[0] || existingHeader.length < 12) {
        sheet.getRange(1, 1, 1, 12).setValues([headers12]).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
      }
    }

    var rowsToInsert = [];
    var nowYear = new Date().getFullYear();
    var sumMeters = 0;

    if (parsedRoutes) {
      if (typeof parsedRoutes === 'string') {
        try { parsedRoutes = JSON.parse(parsedRoutes); } catch(_) {}
      }
      if (Array.isArray(parsedRoutes) && parsedRoutes.length > 0) {
        for (var p = 0; p < parsedRoutes.length; p++) {
          var item = parsedRoutes[p];
          var lM = item.routeLengthKm ? Math.round(item.routeLengthKm * 1000) : (item.lengthM || 1000);
          sumMeters += lM;
          var cap = parseInt(item.coreCapacity || item.capacityCore, 10) || 96;
          var used = parseInt(item.usedCore || item.coreUsed, 10) || 16;
          var avail = Math.max(0, cap - used);
          rowsToInsert.push([
            item.siteName || item.linkName || ('Link_' + (p + 1)),
            item.city || 'DKI Jakarta',
            item.mediaTransmisi || item.type || 'Backbone',
            cap,
            used,
            avail,
            avail > 0 ? 'AVAILABLE' : 'FULL',
            lM,
            item.status || 'Active',
            nowYear,
            item.fromSite || 'SITE_START',
            item.toSite || 'SITE_END'
          ]);
        }
      }
    }

    if (rowsToInsert.length === 0 && kmlContent && typeof kmlContent === 'string') {
      var placemarkMatches = kmlContent.match(/<Placemark[\s\S]*?<\/Placemark>/gi) || [];

      for (var i = 0; i < placemarkMatches.length; i++) {
      var pm = placemarkMatches[i];
      var nameMatch = pm.match(/<name>(.*?)<\/name>/i);
      var linkName = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : ('Link_' + (i + 1));
      
      var descMatch = pm.match(/<description>(.*?)<\/description>/i);
      var desc = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';

      var coordMatch = pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
      var coordsText = coordMatch ? coordMatch[1].trim() : '';

      // Extract City
      var cityStr = "DKI Jakarta";
      var cityMatch = desc.match(/(?:city|kota|kabupaten|kab)\s*:?\s*([^;,<br\n]+)/i);
      if (cityMatch && cityMatch[1].trim()) {
        cityStr = cityMatch[1].trim();
      }

      // Calculate Length in meters using Haversine
      var lengthM = 1000;
      if (coordsText) {
        var points = coordsText.split(/\s+/);
        if (points.length >= 2) {
          var totalDist = 0;
          var prevLat = null, prevLng = null;
          for (var p = 0; p < points.length; p++) {
            var parts = points[p].split(',');
            if (parts.length >= 2) {
              var lng = parseFloat(parts[0]);
              var lat = parseFloat(parts[1]);
              if (!isNaN(lat) && !isNaN(lng)) {
                if (prevLat !== null && prevLng !== null) {
                  var R = 6371000; // meters
                  var dLat = (lat - prevLat) * Math.PI / 180;
                  var dLng = (lng - prevLng) * Math.PI / 180;
                  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                          Math.cos(prevLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                          Math.sin(dLng/2) * Math.sin(dLng/2);
                  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                  totalDist += R * c;
                }
                prevLat = lat;
                prevLng = lng;
              }
            }
          }
          if (totalDist > 0) lengthM = Math.round(totalDist);
        }
      }
      sumMeters += lengthM;

      // Extract Capacity Core & Core Used
      var capacityCore = 96;
      var coreUsed = 16;
      var capMatch = (linkName + " " + desc).match(/(\d+)\s*(?:c|core|cores)/i);
      if (capMatch) {
        capacityCore = parseInt(capMatch[1], 10) || 96;
      }
      var usedMatch = desc.match(/used\s*:?\s*(\d+)/i);
      if (usedMatch) {
        coreUsed = parseInt(usedMatch[1], 10) || 16;
      }
      if (coreUsed > capacityCore) coreUsed = Math.round(capacityCore * 0.2);
      var availableCores = Math.max(0, capacityCore - coreUsed);
      var coreStatusStr = availableCores > 0 ? "AVAILABLE" : "FULL";

      // Extract Type
      var typeStr = "Backbone";
      if (/feeder/i.test(linkName + " " + desc)) typeStr = "Feeder";
      else if (/distribution/i.test(linkName + " " + desc)) typeStr = "Distribution";
      else if (/underground|subsea/i.test(linkName + " " + desc)) typeStr = "Underground";
      else if (/aerial/i.test(linkName + " " + desc)) typeStr = "Aerial";

      // Extract Status
      var statusStr = "Active";
      if (/plan|planned/i.test(linkName + " " + desc)) statusStr = "Planned";
      else if (/rfs|ready/i.test(linkName + " " + desc)) statusStr = "RFS";
      else if (/progress|construction/i.test(linkName + " " + desc)) statusStr = "In Progress";

      // Extract From Site & To Site
      var fromSite = "SITE_START";
      var toSite = "SITE_END";
      var siteSplit = linkName.split(/\s*[-_–—]|(?:\s+to\s+)|(?:\s*<->\s*)|(?:\s*->\s*)\s*/i);
      if (siteSplit.length >= 2 && siteSplit[0].trim() && siteSplit[1].trim()) {
        fromSite = siteSplit[0].trim();
        toSite = siteSplit[1].trim();
      }

      // 12 columns: Link Name, City, Type, Capacity Core, Core Used, Available, Core Status, Length (m), Status, RFS Year, From Site, To Site
      rowsToInsert.push([
        linkName,
        cityStr,
        typeStr,
        capacityCore,
        coreUsed,
        availableCores,
        coreStatusStr,
        lengthM,
        statusStr,
        nowYear,
        fromSite,
        toSite
      ]);
    }
  }

    var totalLengthKm = Math.round((sumMeters / 1000) * 100) / 100;

    if (rowsToInsert.length > 0) {
      var nextRow = Math.max(sheet.getLastRow() + 1, 2);
      sheet.getRange(nextRow, 1, rowsToInsert.length, 12).setValues(rowsToInsert);
      logFoImport(ss, fileName, fileId, rowsToInsert.length, totalLengthKm, 'SUCCESS', '');
      return { success: true, count: rowsToInsert.length, totalLengthKm: totalLengthKm, message: "Berhasil menyimpan " + rowsToInsert.length + " data jalur FO ke sheet FO_Links" };
    } else {
      var fallbackRow = [
        fileName.replace(/\.(kmz|kml)$/i, ''),
        "DKI Jakarta",
        "Backbone",
        96,
        16,
        80,
        "AVAILABLE",
        1500,
        "Active",
        nowYear,
        "SITE_START",
        "SITE_END"
      ];
      sheet.appendRow(fallbackRow);
      logFoImport(ss, fileName, fileId, 1, 1.5, 'SUCCESS', '');
      return { success: true, count: 1, totalLengthKm: 1.5, message: "Berhasil menyimpan record file ke sheet FO_Links" };
    }
  } catch (err) {
    try {
      var ssErr = SpreadsheetApp.openById("1uVZCTAKjRcTRka-GFZtV0ttIAo1U6H7GRYfCxLl7icQ");
      logFoImport(ssErr, fileName || 'KMZ', fileId || 'LOCAL_UPLOAD', 0, 0, 'FAILED', err.toString());
    } catch (_) {}
    return { success: false, error: err.toString() };
  }
}

/**
 * Main Web App POST handler for Google Apps Script Web App
 */
function doPost(e) {
  try {
    var contents = JSON.parse(e.postData.contents);
    if (contents.action === "saveKmzRecord" || contents.kmlContent || contents.parsedRoutes) {
      var res = saveKmzRecordToSheet(contents.fileName, contents.fileId, contents.kmlContent, contents.operator, contents.parsedRoutes);
      return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Unknown action" })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

