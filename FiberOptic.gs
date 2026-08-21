// ============================================================
// FIBER OPTIC KMZ PARSER MODULE
// File terpisah: FiberOptic.gs
// 
// Fitur:
// - Parse file KMZ/KML dari Google Drive
// - Extract LineString (rute kabel FO)
// - Hitung panjang route (Haversine formula)
// - Simpan ke sheet helper
// - Visualisasi di peta Leaflet
// ============================================================
// DriveApp.getFolderById("");

// Konstanta khusus untuk Fiber Optic
const SHEET_FO_DATA = "Fiber_Optic_Routes";
const SHEET_FO_LOG = "Fiber_Optic_ImportLog";

// ============================================================
// SETUP FUNCTIONS
// ============================================================

/**
 * Jalankan SEKALI untuk membuat sheet helper FO
 */
function setupFiberOpticSheet() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // Sheet 1: Data Routes
    let sheet = ss.getSheetByName(SHEET_FO_DATA);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_FO_DATA);
    } else {
      if (sheet.getLastRow() > 1) {
        // Backup dulu sebelum clear
        const backup = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
        sheet.clear();
        if (backup.length > 0) {
          sheet.getRange(2, 1, backup.length, backup[0].length).setValues(backup);
        }
      }
    }
    
    const headers = [
      'Route Name', 'Status', 'Core Count', 'Route Type', 
      'Length (km)', 'Start Point', 'End Point', 
      'Installation Date', 'Coordinates JSON', 'File ID', 'Import Date'
    ];
    
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#0ea5e9');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    
    // Auto-resize columns
    for (let i = 1; i <= headers.length; i++) {
      sheet.autoResizeColumn(i);
    }
    
    // Sheet 2: Import Log
    let logSheet = ss.getSheetByName(SHEET_FO_LOG);
    if (!logSheet) {
      logSheet = ss.insertSheet(SHEET_FO_LOG);
    } else {
      logSheet.clear();
    }
    
    const logHeaders = ['Timestamp', 'File Name', 'File ID', 'Total Routes', 'Total Length (km)', 'Status', 'Error'];
    logSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]);
    const logHeaderRange = logSheet.getRange(1, 1, 1, logHeaders.length);
    logHeaderRange.setBackground('#0f172a');
    logHeaderRange.setFontColor('#ffffff');
    logHeaderRange.setFontWeight('bold');
    logSheet.setFrozenRows(1);
    
    return {
      success: true,
      message: `✅ Sheet helper FO berhasil dibuat:\n• ${SHEET_FO_DATA}\n• ${SHEET_FO_LOG}`
    };
  } catch (err) {
    return { success: false, message: "Error: " + err.message };
  }
}

// ============================================================
// MAIN PARSER FUNCTIONS
// ============================================================

/**
 * Parse KMZ/KML untuk Fiber Optic Cable Routes
 * Auto-detect format file (KMZ atau KML)
 * 
 * @param {string} fileId - ID file di Google Drive
 * @returns {Object} { success, routes, totalRoutes, totalLength, error }
 */
function parseFiberOpticKMZ(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const fileName = file.getName();
    const mimeType = file.getMimeType();
    const blob = file.getBlob();
    
    let kmlContent = '';
    let fileType = 'Unknown';
    
    // Auto-detect format
    if (fileName.toLowerCase().endsWith('.kmz') || 
        mimeType === 'application/vnd.google-earth.kmz') {
      kmlContent = extractKmlFromKmz(blob);
      fileType = 'KMZ';
    } else if (fileName.toLowerCase().endsWith('.kml') || 
               mimeType === 'application/vnd.google-earth.kml+xml') {
      kmlContent = blob.getDataAsString();
      fileType = 'KML';
    } else {
      // Fallback: coba sebagai KML text
      try {
        kmlContent = blob.getDataAsString();
        if (kmlContent.indexOf('<kml') !== -1 || kmlContent.indexOf('<KML') !== -1) {
          fileType = 'KML (detected)';
        } else {
          throw new Error('Format file tidak dikenali');
        }
      } catch (e) {
        throw new Error('File bukan format KML/KMZ yang valid');
      }
    }
    
    // Parse KML content
    const cableRoutes = parseKmlRoutes(kmlContent);
    
    if (cableRoutes.length === 0) {
      logFoImport(fileName, fileId, 0, 0, 'FAILED', 'Tidak ada LineString ditemukan');
      return {
        success: false,
        error: "Tidak ada rute kabel (LineString) ditemukan di file " + fileType,
        routes: [],
        totalRoutes: 0,
        totalLength: 0
      };
    }
    
    // Simpan ke sheet
    saveFiberOpticData(cableRoutes, fileId);
    
    const totalLength = cableRoutes.reduce((sum, r) => sum + r.routeLength, 0);
    
    logFoImport(fileName, fileId, cableRoutes.length, totalLength, 'SUCCESS', '');
    
    return {
      success: true,
      routes: cableRoutes,
      totalRoutes: cableRoutes.length,
      totalLength: parseFloat(totalLength.toFixed(3)),
      fileType: fileType,
      message: `✅ Berhasil import ${cableRoutes.length} routes dari file ${fileType}`
    };
    
  } catch (err) {
    logFoImport(fileId, fileId, 0, 0, 'FAILED', err.message);
    return {
      success: false,
      error: err.message,
      routes: [],
      totalRoutes: 0,
      totalLength: 0
    };
  }
}

/**
 * Parse KML content untuk extract LineString routes
 */
function parseKmlRoutes(kmlString) {
  const cableRoutes = [];
  
  try {
    const xml = XmlService.parse(kmlString);
    const root = xml.getRootElement();
    const kmlNs = XmlService.getNamespace('http://www.opengis.net/kml/2.2');
    
    // Cari semua Placemark
    const allElements = root.getDescendants();
    
    allElements.forEach(desc => {
      const el = desc.asElement();
      if (!el || el.getName() !== 'Placemark') return;
      
      // Extract LineString (rute kabel)
      const lineStringEl = el.getChild('LineString', kmlNs);
      if (!lineStringEl) return;
      
      const coordEl = lineStringEl.getChild('coordinates', kmlNs);
      if (!coordEl) return;
      
      const coordText = coordEl.getText().trim();
      const coordinates = parseCoordinates(coordText);
      
      if (coordinates.length < 2) return; // Minimal 2 titik untuk route
      
      // Extract metadata
      const nameEl = el.getChild('name', kmlNs);
      const descEl = el.getChild('description', kmlNs);
      
      const cableName = nameEl ? nameEl.getText() : 'Unnamed Route';
      const description = descEl ? descEl.getText() : '';
      
      // Parse ExtendedData
      const cableData = parseExtendedData(el, kmlNs);
      
      // Hitung panjang route
      const routeLength = calculateRouteLength(coordinates);
      
      cableRoutes.push({
        name: cableName,
        coordinates: coordinates,
        routeLength: routeLength,
        coreCount: cableData.coreCount,
        status: cableData.status,
        routeType: cableData.routeType,
        installationDate: cableData.installationDate,
        description: description,
        startPoint: coordinates[0],
        endPoint: coordinates[coordinates.length - 1]
      });
    });
    
  } catch (err) {
    console.error("KML parse error:", err);
  }
  
  return cableRoutes;
}

/**
 * Parse ExtendedData dari Placemark
 */
function parseExtendedData(placemarkEl, kmlNs) {
  const data = {
    coreCount: 0,
    status: 'Unknown',
    routeType: 'Unknown',
    installationDate: ''
  };
  
  const extDataEl = placemarkEl.getChild('ExtendedData', kmlNs);
  if (!extDataEl) return data;
  
  // Parse <Data> elements
  const dataElements = extDataEl.getChildren('Data', kmlNs);
  dataElements.forEach(d => {
    const name = d.getAttribute('name') ? d.getAttribute('name').getValue() : '';
    const valueEl = d.getChild('value', kmlNs);
    if (!name || !valueEl) return;
    
    const value = valueEl.getText();
    const nameLower = name.toLowerCase();
    
    if (nameLower.includes('core')) data.coreCount = parseInt(value) || 0;
    else if (nameLower.includes('status')) data.status = value;
    else if (nameLower.includes('route') || nameLower.includes('type')) data.routeType = value;
    else if (nameLower.includes('date') || nameLower.includes('install')) data.installationDate = value;
  });
  
  // Parse <SchemaData> elements (alternatif format)
  const schemaDataEls = extDataEl.getChildren('SchemaData', kmlNs);
  schemaDataEls.forEach(sd => {
    const simpleDataEls = sd.getChildren('SimpleData', kmlNs);
    simpleDataEls.forEach(sd2 => {
      const name = sd2.getAttribute('name') ? sd2.getAttribute('name').getValue() : '';
      if (!name) return;
      
      const value = sd2.getText();
      const nameLower = name.toLowerCase();
      
      if (nameLower.includes('core') && !data.coreCount) data.coreCount = parseInt(value) || 0;
      else if (nameLower.includes('status') && data.status === 'Unknown') data.status = value;
      else if (nameLower.includes('route') && data.routeType === 'Unknown') data.routeType = value;
      else if (nameLower.includes('date') && !data.installationDate) data.installationDate = value;
    });
  });
  
  return data;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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
  
  // Parse ZIP local file headers
  let offset = zipStart;
  let kmlBytes = null;
  
  while (offset < bytes.length - 30) {
    if (bytes[offset] !== 0x50 || bytes[offset+1] !== 0x4B ||
        bytes[offset+2] !== 0x03 || bytes[offset+3] !== 0x04) {
      break;
    }
    
    const compressionMethod = bytes[offset + 8] | (bytes[offset + 9] << 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const fileNameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraFieldLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = String.fromCharCode.apply(null, bytes.slice(fileNameStart, fileNameEnd));
    
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;
    
    // Cari file .kml (doc.kml atau lainnya)
    if (fileName.toLowerCase().endsWith('.kml')) {
      if (compressionMethod === 0) {
        // Stored (no compression)
        kmlBytes = bytes.slice(dataStart, dataEnd);
      } else if (compressionMethod === 8) {
        // Deflate compression
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
    throw new Error('File KML tidak ditemukan di dalam KMZ');
  }
  
  return Utilities.newBlob(kmlBytes).getDataAsString();
}

/**
 * Read 32-bit unsigned integer dari byte array
 */
function readUint32(bytes, offset) {
  return (bytes[offset] & 0xFF) |
         ((bytes[offset + 1] & 0xFF) << 8) |
         ((bytes[offset + 2] & 0xFF) << 16) |
         ((bytes[offset + 3] & 0xFF) << 24);
}

/**
 * Parse koordinat dari KML LineString
 * Format: "lng1,lat1,alt1 lng2,lat2,alt2 ..."
 */
function parseCoordinates(coordText) {
  const coords = [];
  const tuples = coordText.trim().split(/\s+/);
  
  tuples.forEach(tuple => {
    const parts = tuple.split(',');
    if (parts.length >= 2) {
      coords.push({
        lng: parseFloat(parts[0]),
        lat: parseFloat(parts[1]),
        alt: parts.length >= 3 ? parseFloat(parts[2]) : 0
      });
    }
  });
  
  return coords;
}

/**
 * Hitung panjang route dalam km menggunakan Haversine formula
 */
function calculateRouteLength(coordinates) {
  let totalLength = 0;
  
  for (let i = 0; i < coordinates.length - 1; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];
    totalLength += haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
  }
  
  return parseFloat(totalLength.toFixed(3));
}

/**
 * Haversine formula untuk hitung jarak 2 titik (dalam km)
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // Radius bumi dalam km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ============================================================
// DATA STORAGE FUNCTIONS
// ============================================================

/**
 * Simpan data FO ke sheet helper
 */
function saveFiberOpticData(routes, fileId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_FO_DATA);
  
  if (!sheet) {
    setupFiberOpticSheet();
    sheet = ss.getSheetByName(SHEET_FO_DATA);
  }
  
  const rows = routes.map(r => [
    r.name,
    r.status,
    r.coreCount,
    r.routeType,
    r.routeLength,
    `${r.startPoint.lat.toFixed(6)},${r.startPoint.lng.toFixed(6)}`,
    `${r.endPoint.lat.toFixed(6)},${r.endPoint.lng.toFixed(6)}`,
    r.installationDate,
    JSON.stringify(r.coordinates.map(c => [c.lat, c.lng])),
    fileId,
    new Date()
  ]);
  
  if (rows.length > 0) {
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, rows.length, rows[0].length).setValues(rows);
  }
}

/**
 * Log import ke sheet log
 */
function logFoImport(fileName, fileId, totalRoutes, totalLength, status, error) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let logSheet = ss.getSheetByName(SHEET_FO_LOG);
  
  if (!logSheet) {
    setupFiberOpticSheet();
    logSheet = ss.getSheetByName(SHEET_FO_LOG);
  }
  
  const nextRow = logSheet.getLastRow() + 1;
  logSheet.getRange(nextRow, 1, 1, 7).setValues([[
    new Date(), fileName, fileId, totalRoutes, 
    totalLength.toFixed(3), status, error
  ]]);
}

/**
 * Ambil semua data FO dari sheet
 */
function getFiberOpticData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_FO_DATA);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return { routes: [], totalRoutes: 0, totalLength: 0 };
    }
    
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    const routes = [];
    
    data.forEach(row => {
      const coordsJson = row[8];
      let coordinates = [];
      
      try {
        coordinates = JSON.parse(coordsJson);
      } catch (e) {
        console.error("Failed to parse coordinates:", e);
      }
      
      routes.push({
        name: row[0] || 'Unnamed Route',
        status: row[1] || 'Unknown',
        coreCount: parseInt(row[2]) || 0,
        routeType: row[3] || 'Unknown',
        routeLength: parseFloat(row[4]) || 0,
        startPoint: parseCoordinateString(row[5]),
        endPoint: parseCoordinateString(row[6]),
        installationDate: row[7] || '',
        coordinates: coordinates.map(c => ({ lat: c[0], lng: c[1] })),
        fileId: row[9] || '',
        importDate: row[10] || ''
      });
    });
    
    const totalLength = routes.reduce((sum, r) => sum + r.routeLength, 0);
    
    return {
      routes: routes,
      totalRoutes: routes.length,
      totalLength: parseFloat(totalLength.toFixed(3))
    };
  } catch (err) {
    console.error("Error getting FO data:", err);
    return { routes: [], totalRoutes: 0, totalLength: 0, error: err.message };
  }
}

/**
 * Parse coordinate string "lat,lng" to object
 */
function parseCoordinateString(coordStr) {
  if (!coordStr) return { lat: 0, lng: 0 };
  
  const parts = coordStr.toString().split(',');
  if (parts.length >= 2) {
    return {
      lat: parseFloat(parts[0]) || 0,
      lng: parseFloat(parts[1]) || 0
    };
  }
  return { lat: 0, lng: 0 };
}

/**
 * Clear semua data FO (untuk re-import)
 */
function clearFiberOpticData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_FO_DATA);
    
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clear();
      return { success: true, message: "✅ Data FO berhasil dihapus" };
    }
    
    return { success: true, message: "Tidak ada data untuk dihapus" };
  } catch (err) {
    return { success: false, message: "Error: " + err.message };
  }
}

/**
 * Get statistik FO untuk dashboard
 */
function getFiberOpticStats() {
  const data = getFiberOpticData();
  
  const statusCounts = {};
  const typeCounts = {};
  const coreTotal = data.routes.reduce((sum, r) => sum + r.coreCount, 0);
  
  data.routes.forEach(r => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    typeCounts[r.routeType] = (typeCounts[r.routeType] || 0) + 1;
  });
  
  return {
    totalRoutes: data.totalRoutes,
    totalLength: data.totalLength,
    totalCores: coreTotal,
    statusDistribution: statusCounts,
    typeDistribution: typeCounts
  };
}

// ==========================================
// GOOGLE DRIVE KMZ INTEGRATION
// ==========================================

/**
 * List all KMZ files in a Google Drive folder
 * @param {string} folderId - Google Drive folder ID
 * @return {Array} List of files with id, name, size
 */
/**
 * Mendapatkan daftar file KMZ/KML dari Folder Google Drive tertentu
 */
function listKmzFilesInFolder(folderId) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    const result = [];
    
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName().toLowerCase();
      // Cek apakah file berakhiran .kmz atau .kml
      if (name.endsWith('.kmz') || name.endsWith('.kml') || f.getMimeType().includes('kml')) {
        result.push({
          id: f.getId(),
          name: f.getName(),
          size: f.getSize(),
          mimeType: f.getMimeType()
        });
      }
    }
    return result;
  } catch (e) {
    throw new Error('Gagal membaca folder. Pastikan Folder ID benar dan script memiliki izin akses Drive. Detail: ' + e.message);
  }
}

/**
 * Mengekstrak konten KML dari file KMZ/KML
 */
function getKmzFileContent(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    
    // Jika file sudah berupa KML murni
    if (file.getMimeType() === 'application/vnd.google-earth.kml+xml' || file.getName().toLowerCase().endsWith('.kml')) {
      return blob.getDataAsString();
    }
    
    // Jika file KMZ (format ZIP), ekstrak untuk mencari file .kml di dalamnya
    const unzipped = Utilities.unzip(blob);
    for (let i = 0; i < unzipped.length; i++) {
      const fName = unzipped[i].getName().toLowerCase();
      if (fName.endsWith('.kml')) {
        return unzipped[i].getDataAsString();
      }
    }
    throw new Error('Tidak ditemukan file .kml di dalam arsip .kmz tersebut.');
  } catch (e) {
    throw new Error('Gagal membaca file: ' + e.message);
  }
}

/**
 * Get KMZ file content, extract KML from ZIP
 * @param {string} fileId - Google Drive file ID
 * @return {string} KML content as string
 */
/**
 * Get KMZ file content, extract KML from ZIP
 * FIX: Force content type to application/zip before unzipping
 * @param {string} fileId - Google Drive file ID
 * @return {string} KML content as string
 */
function getKmzFileContent(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const originalBlob = file.getBlob();
    
    // 🔑 KEY FIX: Create new blob with CORRECT content type
    // KMZ is actually a ZIP file, so we must tell Apps Script to treat it as such
    const zipBlob = originalBlob.setContentType('application/zip');
    
    // Unzip the blob
    const unzipped = Utilities.unzip(zipBlob);
    
    // Find the .kml file inside the ZIP
    let kmlBlob = null;
    for (let i = 0; i < unzipped.length; i++) {
      const name = unzipped[i].getName().toLowerCase();
      if (name.endsWith('.kml')) {
        kmlBlob = unzipped[i];
        break;
      }
    }
    
    if (!kmlBlob) {
      throw new Error('No KML file found inside KMZ. Available files: ' + 
        unzipped.map(b => b.getName()).join(', '));
    }
    
    // Return KML content as string (auto-detect encoding)
    return kmlBlob.getDataAsString('UTF-8');
    
  } catch (e) {
    // Better error message for debugging
    console.error('getKmzFileContent error:', e);
    throw new Error('Failed to read KMZ: ' + e.message);
  }
}

/**
 * Optional: Enhanced FO data with cross-reference to other sheets
 */
function getFODataEnhanced() {
  const baseData = getFOData(); // Your existing function
  
  // Enrich with DT data correlation
  if (baseData && baseData.data) {
    const dtData = getDriveTestV2Data();
    if (dtData && dtData.data) {
      const dtByCity = {};
      dtData.data.forEach(dt => {
        const city = (dt.city || '').toUpperCase();
        if (!dtByCity[city]) dtByCity[city] = { sum: 0, count: 0 };
        const lvl = dt.bestServer || {};
        const avg = ((lvl.tselKpi||0) + (lvl.iohKpi||0) + (lvl.xlsKpi||0)) / 3;
        dtByCity[city].sum += avg;
        dtByCity[city].count += 1;
      });
      
      baseData.data.forEach(fo => {
        const city = (fo.city || '').toUpperCase();
        const dt = dtByCity[city];
        fo.avgDtKpi = dt ? (dt.sum / dt.count).toFixed(2) : null;
      });
    }
  }
  
  return baseData;
}