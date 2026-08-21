import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import JSZip from "jszip";

dotenv.config();

function safeWriteJsonSync(filePath: string, data: any, spaces: number | null = null) {
  let tempPath: string | null = null;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
    const content = spaces ? JSON.stringify(data, null, spaces) : JSON.stringify(data);
    fs.writeFileSync(tempPath, content, "utf-8");
    fs.renameSync(tempPath, filePath);
    tempPath = null;
  } catch (err) {
    console.warn(`Failed to write JSON atomically to ${filePath}:`, err);
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {}
    }
  }
}

function safeReadJsonSync(filePath: string): any | null {
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      if (!fileContent || fileContent.trim().length === 0) {
        throw new SyntaxError("Empty or zero-byte cache file");
      }
      return JSON.parse(fileContent);
    }
  } catch (err: any) {
    console.warn(`Cache file ${filePath} was corrupted or incomplete (${err?.message || err}). Resetting cache file.`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Successfully deleted corrupted cache file: ${filePath}`);
      }
    } catch (_) {}
  }
  return null;
}

const SPREADSHEET_ID = "1LNrXPjuMYxQ71CzQsOS0Bon1e5_STnbZHnt-yrLvydE";
const GID = "1356065183";

let cachedRows: string[][] | null = null;
let lastFetchTime = 0;
let cachedRowsV2: string[][] | null = null;
let lastFetchTimeV2 = 0;
const CACHE_TTL = 900000; // 15 minutes

async function fetchCSVWithRetry(url: string, timeoutMs = 60000, maxRetries = 2): Promise<string> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP status ${res.status} ${res.statusText}`);
      const text = await res.text();
      if (text && text.trim().length > 0) {
        return text;
      }
      throw new Error("Received empty CSV response.");
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError || new Error("Failed to fetch CSV data.");
}

let isFetchingV1 = false;
function triggerBackgroundFetch() {
  if (isFetchingV1) return;
  isFetchingV1 = true;
  
  const cacheFilePath = path.join(process.cwd(), "assets", "spreadsheet_cache.json");
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sitelist%20Komersil`;
  
  console.log("Background V1 fetch initiated...");
  fetchCSVWithRetry(url, 60000, 2)
    .then(responseText => {
      const parsed = parseCSV(responseText);
      if (parsed && parsed.length > 0) {
        cachedRows = parsed;
        lastFetchTime = Date.now();
        safeWriteJsonSync(cacheFilePath, parsed);
        console.log("Background spreadsheet V1 cache update successful.");
      }
    })
    .catch(err => {
      console.info("Background spreadsheet V1 cache update skipped/failed:", err.message || err);
    })
    .finally(() => {
      isFetchingV1 = false;
    });
}

let isFetchingV2 = false;
function triggerBackgroundFetchV2() {
  if (isFetchingV2) return;
  isFetchingV2 = true;
  
  const cacheFilePath = path.join(process.cwd(), "assets", "spreadsheet_cache_v2.json");
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Service%20Level%20Base`;
  
  console.log("Background V2 fetch initiated...");
  fetchCSVWithRetry(url, 60000, 2)
    .then(responseText => {
      const parsed = parseCSV(responseText);
      if (parsed && parsed.length > 0) {
        cachedRowsV2 = parsed;
        lastFetchTimeV2 = Date.now();
        safeWriteJsonSync(cacheFilePath, parsed);
        console.log("Background spreadsheet V2 cache update successful.");
      }
    })
    .catch(err => {
      console.info("Background spreadsheet V2 cache update skipped/failed:", err.message || err);
    })
    .finally(() => {
      isFetchingV2 = false;
    });
}

let cachedCentralDbRows: string[][] | null = null;
let lastFetchTimeCentralDb = 0;
let isFetchingCentralDb = false;

function triggerBackgroundFetchCentralDb() {
  if (isFetchingCentralDb) return;
  isFetchingCentralDb = true;
  
  const cacheFilePath = path.join(process.cwd(), "assets", "central_database_cache.json");
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Central%20Database`;
  
  console.log("Background Central Database fetch initiated...");
  fetchCSVWithRetry(url, 60000, 2)
    .then(responseText => {
      const parsed = parseCSV(responseText);
      if (parsed && parsed.length > 0) {
        cachedCentralDbRows = parsed;
        lastFetchTimeCentralDb = Date.now();
        safeWriteJsonSync(cacheFilePath, parsed);
        console.log("Background Central Database cache update successful.");
      }
    })
    .catch(err => {
      console.info("Background Central Database cache update skipped/failed:", err.message || err);
    })
    .finally(() => {
      isFetchingCentralDb = false;
    });
}

let cachedFORows: string[][] | null = null;
let lastFetchTimeFO = 0;
let isFetchingFO = false;

function triggerBackgroundFetchFO() {
  if (isFetchingFO) return;
  isFetchingFO = true;
  
  const cacheFilePath = path.join(process.cwd(), "assets", "fo_cache.json");
  const url = `https://docs.google.com/spreadsheets/d/1uVZCTAKjRcTRka-GFZtV0ttIAo1U6H7GRYfCxLl7icQ/gviz/tq?tqx=out:csv&sheet=FO%20Database`;
  
  console.log("Background FO fetch initiated...");
  fetchCSVWithRetry(url, 60000, 2)
    .then(responseText => {
      const parsed = parseCSV(responseText);
      if (parsed && parsed.length > 0) {
        cachedFORows = parsed;
        lastFetchTimeFO = Date.now();
        safeWriteJsonSync(cacheFilePath, parsed);
        console.log("Background FO spreadsheet cache update successful.");
      }
    })
    .catch(err => {
      console.info("Background FO spreadsheet cache update skipped/failed:", err.message || err);
    })
    .finally(() => {
      isFetchingFO = false;
    });
}

// Extracts GEMINI_API_KEY from code.gs file dynamically as a developer convenience
function getGeminiApiKeyFromCodeGs(): string | null {
  try {
    const codeGsPath = path.join(process.cwd(), "code.gs");
    if (fs.existsSync(codeGsPath)) {
      const content = fs.readFileSync(codeGsPath, "utf-8");
      const match = content.match(/const\s+GEMINI_API_KEY\s*=\s*["'`]([^"'`]+)["'`]/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch (err) {
    console.error("Failed to read GEMINI_API_KEY from code.gs:", err);
  }
  return null;
}

// A simple CSV parser that properly handles quotes, commas, and linebreaks inside cells
function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if (char === '\n' && !inQuotes) {
      row.push(current.trim());
      result.push(row);
      row = [];
      current = "";
    } else if (char === '\r' && !inQuotes) {
      if (nextChar === '\n') {
        i++;
      }
      row.push(current.trim());
      result.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  
  if (current || row.length > 0) {
    row.push(current.trim());
    result.push(row);
  }
  
  return result;
}

async function getSpreadsheetRows(): Promise<string[][]> {
  const now = Date.now();
  
  // 1. Memory cache check
  if (cachedRows && (now - lastFetchTime < CACHE_TTL)) {
    return cachedRows;
  }
  
  // 2. Memory cache exists but is stale
  if (cachedRows) {
    triggerBackgroundFetch();
    return cachedRows;
  }
  
  // 3. Try reading from disk cache first
  const cacheFilePath = path.join(process.cwd(), "assets", "spreadsheet_cache.json");
  const parsedCached = safeReadJsonSync(cacheFilePath);
  if (parsedCached && parsedCached.length > 0) {
    cachedRows = parsedCached;
    lastFetchTime = now;
    console.log("Loaded spreadsheet V1 rows from disk cache successfully.");
    triggerBackgroundFetch();
    return parsedCached;
  }
  
  // 4. Blocking fetch as absolute last resort
  console.log("No spreadsheet cache found. Executing blocking fetch V1...");
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sitelist%20Komersil`;
  let responseText = "";
  let fetchSuccess = false;
  let fetchErrorToThrow = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (!res.ok) throw new Error(`HTTP status ${res.status} ${res.statusText}`);
      responseText = await res.text();
      if (responseText && responseText.trim().length > 0) {
        fetchSuccess = true;
        break;
      } else {
        throw new Error("Received empty spreadsheet response.");
      }
    } catch (err: any) {
      console.warn(`Blocking spreadsheet fetch attempt ${attempt} failed:`, err.message || err);
      fetchErrorToThrow = err;
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  
  if (fetchSuccess) {
    try {
      const parsed = parseCSV(responseText);
      cachedRows = parsed;
      lastFetchTime = now;
      safeWriteJsonSync(cacheFilePath, parsed);
      return parsed;
    } catch (parseErr: any) {
      console.error("Failed to parse downloaded CSV data:", parseErr);
      fetchErrorToThrow = parseErr;
    }
  }
  
  throw fetchErrorToThrow || new Error("Failed to load spreadsheet data.");
}

async function getSpreadsheetRowsV2(): Promise<string[][]> {
  const now = Date.now();
  
  // 1. Memory cache check
  if (cachedRowsV2 && (now - lastFetchTimeV2 < CACHE_TTL)) {
    return cachedRowsV2;
  }
  
  // 2. Memory cache exists but is stale
  if (cachedRowsV2) {
    triggerBackgroundFetchV2();
    return cachedRowsV2;
  }
  
  // 3. Try reading from disk cache first
  const cacheFilePath = path.join(process.cwd(), "assets", "spreadsheet_cache_v2.json");
  const parsedCached = safeReadJsonSync(cacheFilePath);
  if (parsedCached && parsedCached.length > 0) {
    cachedRowsV2 = parsedCached;
    lastFetchTimeV2 = now;
    console.log("Loaded spreadsheet V2 rows from disk cache successfully.");
    triggerBackgroundFetchV2();
    return parsedCached;
  }
  
  // 4. Blocking fetch as absolute last resort
  console.log("No spreadsheet cache V2 found. Executing blocking fetch V2...");
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Service%20Level%20Base`;
  let responseText = "";
  let fetchSuccess = false;
  let fetchErrorToThrow = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (!res.ok) throw new Error(`HTTP status ${res.status} ${res.statusText}`);
      responseText = await res.text();
      if (responseText && responseText.trim().length > 0) {
        fetchSuccess = true;
        break;
      } else {
        throw new Error("Received empty spreadsheet response.");
      }
    } catch (err: any) {
      console.warn(`Blocking spreadsheet V2 fetch attempt ${attempt} failed:`, err.message || err);
      fetchErrorToThrow = err;
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  
  if (fetchSuccess) {
    try {
      const parsed = parseCSV(responseText);
      cachedRowsV2 = parsed;
      lastFetchTimeV2 = now;
      safeWriteJsonSync(cacheFilePath, parsed);
      return parsed;
    } catch (parseErr: any) {
      console.error("Failed to parse downloaded CSV V2 data:", parseErr);
      fetchErrorToThrow = parseErr;
    }
  }
  
  throw fetchErrorToThrow || new Error("Failed to load spreadsheet V2 data.");
}

async function getCentralDatabaseRows(): Promise<string[][]> {
  const now = Date.now();
  
  if (cachedCentralDbRows && (now - lastFetchTimeCentralDb < CACHE_TTL)) {
    return cachedCentralDbRows;
  }
  
  if (cachedCentralDbRows) {
    triggerBackgroundFetchCentralDb();
    return cachedCentralDbRows;
  }
  
  const cacheFilePath = path.join(process.cwd(), "assets", "central_database_cache.json");
  const parsedCached = safeReadJsonSync(cacheFilePath);
  if (parsedCached && parsedCached.length > 0) {
    cachedCentralDbRows = parsedCached;
    lastFetchTimeCentralDb = now;
    console.log("Loaded Central Database rows from disk cache successfully.");
    triggerBackgroundFetchCentralDb();
    return parsedCached;
  }
  
  console.log("No Central Database cache found. Executing blocking fetch...");
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Central%20Database`;
  let responseText = "";
  let fetchSuccess = false;
  let fetchErrorToThrow = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (!res.ok) throw new Error(`HTTP status ${res.status} ${res.statusText}`);
      responseText = await res.text();
      if (responseText && responseText.trim().length > 0) {
        fetchSuccess = true;
        break;
      } else {
        throw new Error("Received empty Central Database response.");
      }
    } catch (err: any) {
      console.warn(`Blocking Central Database fetch attempt ${attempt} failed:`, err.message || err);
      fetchErrorToThrow = err;
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  
  if (fetchSuccess) {
    try {
      const parsed = parseCSV(responseText);
      cachedCentralDbRows = parsed;
      lastFetchTimeCentralDb = now;
      safeWriteJsonSync(cacheFilePath, parsed);
      return parsed;
    } catch (parseErr: any) {
      console.error("Failed to parse downloaded Central Database CSV:", parseErr);
      fetchErrorToThrow = parseErr;
    }
  }
  
  throw fetchErrorToThrow || new Error("Failed to load Central Database spreadsheet data.");
}

function findColumnIndex(headers: string[], ...candidatePatterns: string[]): number {
  if (!headers || !Array.isArray(headers)) return -1;
  const cleanHeaders = headers.map(h => h ? String(h).toLowerCase().replace(/\s+/g, ' ').trim() : '');
  
  for (const pattern of candidatePatterns) {
    const cleanPattern = pattern.toLowerCase().replace(/\s+/g, ' ').trim();
    const exactIdx = cleanHeaders.indexOf(cleanPattern);
    if (exactIdx !== -1) return exactIdx;
  }

  for (const pattern of candidatePatterns) {
    const cleanPattern = pattern.toLowerCase().replace(/\s+/g, ' ').trim();
    const incIdx = cleanHeaders.findIndex(h => h.includes(cleanPattern));
    if (incIdx !== -1) return incIdx;
  }

  return -1;
}

function findEquipColumnIndex(headers: string[], opKeywords: string[], equipKeyword: string, excludeKeywords: string[] = []): number {
  if (!headers || !Array.isArray(headers)) return -1;
  const cleanHeaders = headers.map(h => h ? String(h).toLowerCase().replace(/\s+/g, ' ').trim() : '');

  for (let i = 0; i < cleanHeaders.length; i++) {
    const h = cleanHeaders[i];
    if (!h) continue;

    if (excludeKeywords.some(ex => h.includes(ex))) continue;

    const hasOp = opKeywords.some(op => h.includes(op));
    if (hasOp && h.includes(equipKeyword)) {
      return i;
    }
  }

  return -1;
}

function parseEquipQty(val: any): number {
  if (val === undefined || val === null) return 0;
  const str = String(val).trim();
  if (!str || str === '0' || str === 'N/A' || str === '-' || str === 'NONE' || str === 'null' || str === 'undefined') return 0;
  const num = parseFloat(str.replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? 0 : num;
}

function getSumQty(row: any[], ...colIndices: number[]): number {
  let sum = 0;
  for (const idx of colIndices) {
    if (idx !== -1 && row[idx] !== undefined) {
      sum += parseEquipQty(row[idx]);
    }
  }
  return sum;
}

function checkTenantActiveFlag(row: any[], activeTenantStr: string, colIdx: number, keywords: string[]): boolean {
  if (colIdx !== -1 && row[colIdx] !== undefined && row[colIdx] !== null) {
    const val = String(row[colIdx]).trim().toUpperCase();
    if (val !== '' && val !== '0' && val !== '-' && val !== 'NONE' && val !== 'FALSE' && val !== 'INACTIVE' && val !== 'NO') {
      return true;
    }
  }
  const upperActive = (activeTenantStr || '').toUpperCase();
  return keywords.some(kw => upperActive.includes(kw.toUpperCase()));
}

function getCentralDatabaseData(rows: string[][]) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  const rawRows = rows.slice(1);

  const idxSiteId = findColumnIndex(headers, 'site id', 'id site', 'site_id');
  const idxIdOracle = findColumnIndex(headers, 'id oracle', 'oracle id', 'id_oracle');
  const idxSiteName = findColumnIndex(headers, 'site name', 'nama site', 'site_name');
  const idxLat = findColumnIndex(headers, 'lat', 'latitude', 'y');
  const idxLong = findColumnIndex(headers, 'long', 'longitude', 'lng', 'x');
  const idxStatusPmo = findColumnIndex(headers, 'status pmo', 'pmo status', 'pmo');
  const idxStatusGroup = findColumnIndex(headers, 'status group', 'status grouping', 'group status');
  const idxType = findColumnIndex(headers, 'type', 'jenis', 'tipe');
  const idxRegional = findColumnIndex(headers, 'regional', 'region');
  const idxProvince = findColumnIndex(headers, 'province', 'provinsi');
  const idxCity = findColumnIndex(headers, 'city', 'kota', 'kabupaten');
  const idxDistrict = findColumnIndex(headers, 'district', 'kecamatan');
  const idxSubDistrict = findColumnIndex(headers, 'sub district', 'kelurahan', 'desa');
  const idxAddress = findColumnIndex(headers, 'address', 'alamat');
  const idxSiteType = findColumnIndex(headers, 'site type', 'jenis site');
  const idxTowerType = findColumnIndex(headers, 'tower type', 'tipe menara', 'jenis menara');
  const idxTowerTypeGrouping = findColumnIndex(headers, 'tower type grouping');
  const idxPoleType = findColumnIndex(headers, 'pole type');
  const idxTowerHeight = findColumnIndex(headers, 'tower height', 'tinggi menara');
  const idxLandAsset = findColumnIndex(headers, 'land asset', 'asset tanah');
  const idxMorphoclass = findColumnIndex(headers, 'morphoclass', 'morphology');
  const idxPermitStatus = findColumnIndex(headers, 'permit status', 'status pks', 'status ijin');
  const idxRentalValue = findColumnIndex(headers, 'rental value', 'nilai sewa');
  const idxNoPks = findColumnIndex(headers, 'no. pks', 'no pks', 'nomor pks');
  const idxPksStart = findColumnIndex(headers, 'pks start date', 'start pks');
  const idxPksExpired = findColumnIndex(headers, 'pks expired date', 'pks expired', 'expired pks');
  const idxTahunExpired = findColumnIndex(headers, 'tahun expired', 'expired year');
  const idxSisaWaktu = findColumnIndex(headers, 'sisa waktu', 'sisa masa sewa');
  const idxTxInfo = findColumnIndex(headers, 'tx info', 'transmisi info');
  const idxCovenantStatus = findColumnIndex(headers, 'covenant status');
  const idxPenjamin = findColumnIndex(headers, 'penjamin', 'penjaminan');
  const idxFasilitas = findColumnIndex(headers, 'fasilitas');
  const idxStatusPenjamin = findColumnIndex(headers, 'status penjamin');
  const idxInsurance = findColumnIndex(headers, 'insurance', 'asuransi');
  const idxActiveTenant = findColumnIndex(headers, 'active tenant', 'tenant aktif', 'tenant');
  const idxActiveTenantNumber = findColumnIndex(headers, 'active tenant number', 'jumlah tenant');

  // 5 Individual Tenant Active Status Columns
  const idxTselActive = findColumnIndex(headers, 'tsel active', 'tsel');
  const idxIohActive = findColumnIndex(headers, 'ioh active', 'ioh (h3i) active', 'ioh/h3i active', 'indosat active');
  const idxH3iActive = findColumnIndex(headers, 'h3i active', 'h3i(ioh) active', 'hutchison active', '3 active', 'three active', 'tri active');
  const idxXlActive = findColumnIndex(headers, 'xl active', 'xl(sf) active', 'xl/sf active', 'xl axiata active');
  const idxSfActive = findColumnIndex(headers, 'sf active', 'smartfren active', 'smart active', 'sf(xl) active', 'sf');

  // Bandwidth Columns
  const idxTselBw = findColumnIndex(headers, 'tsel capacity bandwidth', 'tsel bandwidth', 'bandwidth tsel');
  const idxIohBw = findColumnIndex(headers, 'ioh capacity bandwidth', 'ioh bandwidth', 'bandwidth ioh');
  const idxH3iBw = findColumnIndex(headers, 'h3i capacity bandwidth', 'h3i bandwidth', 'bandwidth h3i');
  const idxXlBw = findColumnIndex(headers, 'xl capacity bandwidth', 'xl bandwidth', 'bandwidth xl');
  const idxSfBw = findColumnIndex(headers, 'sf capacity bandwidth', 'smartfren capacity bandwidth', 'sf bandwidth');

  // Antenna RF Qty
  const idxTselAntennaQty = findEquipColumnIndex(headers, ['tsel', 'telkomsel'], 'antenna', ['shooter', 'aau', 'rru']);
  const idxIohAntennaQty = findEquipColumnIndex(headers, ['ioh', 'indosat', 'isat'], 'antenna', ['shooter', 'aau', 'rru']);
  const idxH3iAntennaQty = findEquipColumnIndex(headers, ['h3i', 'three', 'tri', 'hutchison'], 'antenna', ['shooter', 'aau', 'rru']);
  const idxXlAntennaQty = findEquipColumnIndex(headers, ['xl', 'axiata'], 'antenna', ['shooter', 'aau', 'rru']);
  const idxSfAntennaQty = findEquipColumnIndex(headers, ['sf', 'smartfren', 'smart'], 'antenna', ['shooter', 'aau', 'rru']);

  // Shooter Qty
  const idxTselShooterQty = findEquipColumnIndex(headers, ['tsel', 'telkomsel'], 'shooter');
  const idxIohShooterQty = findEquipColumnIndex(headers, ['ioh', 'indosat', 'isat'], 'shooter');
  const idxH3iShooterQty = findEquipColumnIndex(headers, ['h3i', 'three', 'tri', 'hutchison'], 'shooter');
  const idxXlShooterQty = findEquipColumnIndex(headers, ['xl', 'axiata'], 'shooter');
  const idxSfShooterQty = findEquipColumnIndex(headers, ['sf', 'smartfren', 'smart'], 'shooter');

  // AAU Qty
  const idxTselAauQty = findEquipColumnIndex(headers, ['tsel', 'telkomsel'], 'aau');
  const idxIohAauQty = findEquipColumnIndex(headers, ['ioh', 'indosat', 'isat'], 'aau');
  const idxH3iAauQty = findEquipColumnIndex(headers, ['h3i', 'three', 'tri', 'hutchison'], 'aau');
  const idxXlAauQty = findEquipColumnIndex(headers, ['xl', 'axiata'], 'aau');
  const idxSfAauQty = findEquipColumnIndex(headers, ['sf', 'smartfren', 'smart'], 'aau');

  // RRU Qty
  const idxTselRruQty = findEquipColumnIndex(headers, ['tsel', 'telkomsel'], 'rru', ['antenna', 'shooter', 'aau']);
  const idxIohRruQty = findEquipColumnIndex(headers, ['ioh', 'indosat', 'isat'], 'rru', ['antenna', 'shooter', 'aau']);
  const idxH3iRruQty = findEquipColumnIndex(headers, ['h3i', 'three', 'tri', 'hutchison'], 'rru', ['antenna', 'shooter', 'aau']);
  const idxXlRruQty = findEquipColumnIndex(headers, ['xl', 'axiata'], 'rru', ['antenna', 'shooter', 'aau']);
  const idxSfRruQty = findEquipColumnIndex(headers, ['sf', 'smartfren', 'smart'], 'rru', ['antenna', 'shooter', 'aau']);

  const results: any[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const sId = row[idxSiteId !== -1 ? idxSiteId : 0];
    if (!sId) continue;

    const activeTenantStr = idxActiveTenant !== -1 ? (row[idxActiveTenant] || 'N/A').toString() : 'N/A';

    // 5 Tenant Individual Active Checks
    const tselAct = checkTenantActiveFlag(row, activeTenantStr, idxTselActive, ['TSEL', 'TELKOMSEL']);
    const iohAct = checkTenantActiveFlag(row, activeTenantStr, idxIohActive, ['IOH', 'INDOSAT', 'ISAT']);
    const h3iAct = checkTenantActiveFlag(row, activeTenantStr, idxH3iActive, ['H3I', 'THREE', 'TRI', 'HUTCHISON']);
    const xlAct = checkTenantActiveFlag(row, activeTenantStr, idxXlActive, ['XL', 'AXIATA']);
    const sfAct = checkTenantActiveFlag(row, activeTenantStr, idxSfActive, ['SF', 'SMART', 'SMARTFREN']);

    // 3 Grouped Tenant Categories: TSEL, IOH (IOH + H3I), XLS (XL + SF)
    const groupedTselAct = tselAct;
    const groupedIohAct = iohAct || h3iAct;
    const groupedXlsAct = xlAct || sfAct;

    // Equipment Quantities per individual tenant
    const tselAntenna = getSumQty(row, idxTselAntennaQty);
    const iohAntenna = getSumQty(row, idxIohAntennaQty);
    const h3iAntenna = getSumQty(row, idxH3iAntennaQty);
    const xlAntenna = getSumQty(row, idxXlAntennaQty);
    const sfAntenna = getSumQty(row, idxSfAntennaQty);

    const tselAau = getSumQty(row, idxTselAauQty);
    const iohAau = getSumQty(row, idxIohAauQty);
    const h3iAau = getSumQty(row, idxH3iAauQty);
    const xlAau = getSumQty(row, idxXlAauQty);
    const sfAau = getSumQty(row, idxSfAauQty);

    const tselRru = getSumQty(row, idxTselRruQty);
    const iohRru = getSumQty(row, idxIohRruQty);
    const h3iRru = getSumQty(row, idxH3iRruQty);
    const xlRru = getSumQty(row, idxXlRruQty);
    const sfRru = getSumQty(row, idxSfRruQty);

    const tselShooter = getSumQty(row, idxTselShooterQty);
    const iohShooter = getSumQty(row, idxIohShooterQty);
    const h3iShooter = getSumQty(row, idxH3iShooterQty);
    const xlShooter = getSumQty(row, idxXlShooterQty);
    const sfShooter = getSumQty(row, idxSfShooterQty);

    // Grouped equipment totals (IOH = IOH + H3I; XLS = XL + SF)
    const iohAntennaGrouped = iohAntenna + h3iAntenna;
    const xlsAntennaGrouped = xlAntenna + sfAntenna;

    const iohAauGrouped = iohAau + h3iAau;
    const xlsAauGrouped = xlAau + sfAau;

    const iohRruGrouped = iohRru + h3iRru;
    const xlsRruGrouped = xlRru + sfRru;

    const iohShooterGrouped = iohShooter + h3iShooter;
    const xlsShooterGrouped = xlShooter + sfShooter;

    const equipSummaryStr = `TSEL (Antenna:${tselAntenna}, AAU:${tselAau}, RRU:${tselRru}, Shooter:${tselShooter}); IOH [IOH+H3I] (Antenna:${iohAntennaGrouped}, AAU:${iohAauGrouped}, RRU:${iohRruGrouped}, Shooter:${iohShooterGrouped}); XLS [XL+SF] (Antenna:${xlsAntennaGrouped}, AAU:${xlsAauGrouped}, RRU:${xlsRruGrouped}, Shooter:${xlsShooterGrouped})`;

    results.push({
      siteId: sId.toString().trim(),
      idOracle: idxIdOracle !== -1 ? row[idxIdOracle] || 'N/A' : 'N/A',
      siteName: idxSiteName !== -1 ? row[idxSiteName] || 'N/A' : 'N/A',
      lat: idxLat !== -1 && row[idxLat] ? parseFloat(row[idxLat].toString().replace(',', '.')) : 0,
      long: idxLong !== -1 && row[idxLong] ? parseFloat(row[idxLong].toString().replace(',', '.')) : 0,
      statusPmo: idxStatusPmo !== -1 ? row[idxStatusPmo] || 'N/A' : 'N/A',
      statusGroup: idxStatusGroup !== -1 ? row[idxStatusGroup] || 'N/A' : 'N/A',
      type: idxType !== -1 ? row[idxType] || 'N/A' : 'N/A',
      regional: idxRegional !== -1 ? row[idxRegional] || 'N/A' : 'N/A',
      province: idxProvince !== -1 ? row[idxProvince] || 'N/A' : 'N/A',
      city: idxCity !== -1 ? row[idxCity] || 'N/A' : 'N/A',
      district: idxDistrict !== -1 ? row[idxDistrict] || 'N/A' : 'N/A',
      subDistrict: idxSubDistrict !== -1 ? row[idxSubDistrict] || 'N/A' : 'N/A',
      address: idxAddress !== -1 ? row[idxAddress] || 'N/A' : 'N/A',
      siteType: idxSiteType !== -1 ? row[idxSiteType] || 'N/A' : 'N/A',
      towerType: idxTowerType !== -1 ? row[idxTowerType] || 'N/A' : 'N/A',
      towerTypeGrouping: idxTowerTypeGrouping !== -1 ? row[idxTowerTypeGrouping] || 'N/A' : 'N/A',
      poleType: idxPoleType !== -1 ? row[idxPoleType] || 'N/A' : 'N/A',
      towerHeight: idxTowerHeight !== -1 ? row[idxTowerHeight] || 'N/A' : 'N/A',
      landAsset: idxLandAsset !== -1 ? row[idxLandAsset] || 'N/A' : 'N/A',
      morphoclass: idxMorphoclass !== -1 ? row[idxMorphoclass] || 'N/A' : 'N/A',
      permitStatus: idxPermitStatus !== -1 ? row[idxPermitStatus] || 'N/A' : 'N/A',
      rentalValue: idxRentalValue !== -1 ? row[idxRentalValue] || 'N/A' : 'N/A',
      noPks: idxNoPks !== -1 ? row[idxNoPks] || 'N/A' : 'N/A',
      pksStart: idxPksStart !== -1 ? row[idxPksStart] || 'N/A' : 'N/A',
      pksExpired: idxPksExpired !== -1 ? row[idxPksExpired] || 'N/A' : 'N/A',
      tahunExpired: idxTahunExpired !== -1 ? row[idxTahunExpired] || 'N/A' : 'N/A',
      sisaWaktu: idxSisaWaktu !== -1 ? row[idxSisaWaktu] || 'N/A' : 'N/A',
      txInfo: idxTxInfo !== -1 ? row[idxTxInfo] || 'N/A' : 'N/A',
      covenantStatus: idxCovenantStatus !== -1 ? row[idxCovenantStatus] || 'N/A' : 'N/A',
      penjamin: idxPenjamin !== -1 ? row[idxPenjamin] || 'N/A' : 'N/A',
      fasilitas: idxFasilitas !== -1 ? row[idxFasilitas] || 'N/A' : 'N/A',
      statusPenjamin: idxStatusPenjamin !== -1 ? row[idxStatusPenjamin] || 'N/A' : 'N/A',
      insurance: idxInsurance !== -1 ? row[idxInsurance] || 'N/A' : 'N/A',
      activeTenant: activeTenantStr,
      activeTenantNumber: idxActiveTenantNumber !== -1 ? row[idxActiveTenantNumber] || 'N/A' : 'N/A',
      
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
      tselBw: idxTselBw !== -1 ? row[idxTselBw] || 'N/A' : 'N/A',
      iohBw: idxIohBw !== -1 ? row[idxIohBw] || 'N/A' : 'N/A',
      h3iBw: idxH3iBw !== -1 ? row[idxH3iBw] || 'N/A' : 'N/A',
      xlBw: idxXlBw !== -1 ? row[idxXlBw] || 'N/A' : 'N/A',
      sfBw: idxSfBw !== -1 ? row[idxSfBw] || 'N/A' : 'N/A',

      // Equipment QTYs (Grouped & Individual)
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
}

async function getFOSpreadsheetRows(): Promise<string[][]> {
  const now = Date.now();
  
  // 1. Memory cache check
  if (cachedFORows && (now - lastFetchTimeFO < CACHE_TTL)) {
    return cachedFORows;
  }
  
  // 2. Memory cache exists but is stale
  if (cachedFORows) {
    triggerBackgroundFetchFO();
    return cachedFORows;
  }
  
  // 3. Try reading from disk cache first
  const cacheFilePath = path.join(process.cwd(), "assets", "fo_cache.json");
  const parsedCached = safeReadJsonSync(cacheFilePath);
  if (parsedCached && parsedCached.length > 0) {
    cachedFORows = parsedCached;
    lastFetchTimeFO = now;
    console.log("Loaded FO spreadsheet rows from disk cache successfully.");
    triggerBackgroundFetchFO();
    return parsedCached;
  }
  
  // 4. Blocking fetch as absolute last resort
  console.log("No FO spreadsheet cache found. Executing blocking fetch FO...");
  const url = `https://docs.google.com/spreadsheets/d/1uVZCTAKjRcTRka-GFZtV0ttIAo1U6H7GRYfCxLl7icQ/gviz/tq?tqx=out:csv&sheet=FO%20Database`;
  let responseText = "";
  let fetchSuccess = false;
  let fetchErrorToThrow = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (!res.ok) throw new Error(`HTTP status ${res.status} ${res.statusText}`);
      responseText = await res.text();
      if (responseText && responseText.trim().length > 0) {
        fetchSuccess = true;
        break;
      } else {
        throw new Error("Received empty spreadsheet response.");
      }
    } catch (err: any) {
      console.warn(`Blocking FO spreadsheet fetch attempt ${attempt} failed:`, err.message || err);
      fetchErrorToThrow = err;
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  
  if (fetchSuccess) {
    try {
      const parsed = parseCSV(responseText);
      cachedFORows = parsed;
      lastFetchTimeFO = now;
      safeWriteJsonSync(cacheFilePath, parsed);
      return parsed;
    } catch (parseErr: any) {
      console.error("Failed to parse downloaded FO CSV data:", parseErr);
      fetchErrorToThrow = parseErr;
    }
  }
  
  throw fetchErrorToThrow || new Error("Failed to load FO spreadsheet data.");
}

function getDriveTestV2Data(rows: string[][]) {
  const headers = rows[0];
  const rawRows = rows.slice(1);

  const colIdx = (name: string) => {
    return headers.findIndex(h => h && h.trim().toLowerCase() === name.trim().toLowerCase());
  };

  const findColIndex = (preferredNames: string[], defaultIdx: number) => {
    for (const name of preferredNames) {
      const idx = colIdx(name);
      if (idx !== -1) return idx;
    }
    if (preferredNames.length > 0) {
      const term = preferredNames[0].toLowerCase();
      for (let idx = 0; idx < headers.length; idx++) {
        const h = headers[idx];
        if (h && h.toString().toLowerCase().includes(term)) {
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
  const idxActiveTenant = colIdx('Active Tenant') !== -1 ? colIdx('Active Tenant') : (colIdx('Tenant') !== -1 ? colIdx('Tenant') : 10);
  const idxTowerHeight = headers.length > 68 && headers[68] && headers[68].toString().toLowerCase().includes('height') ? 68 : (colIdx('Tower Height') !== -1 ? colIdx('Tower Height') : (colIdx('Tinggi Menara') !== -1 ? colIdx('Tinggi Menara') : 68));
  const idxTowerType = headers.length > 69 && headers[69] && headers[69].toString().toLowerCase().includes('tower') ? 69 : (colIdx('Tower Type') !== -1 ? colIdx('Tower Type') : (colIdx('Tipe Menara') !== -1 ? colIdx('Tipe Menara') : 69));
  const idxLat = colIdx('Lat');
  const idxLong = colIdx('Long');
  const idxJenisTeknologi = colIdx('Jenis Teknologi') !== -1 ? colIdx('Jenis Teknologi') : (colIdx('Teknologi') !== -1 ? colIdx('Teknologi') : 63);
  const idxStreetView = colIdx('Street View') !== -1 ? colIdx('Street View') : (colIdx('Street_View') !== -1 ? colIdx('Street_View') : 66);
  const idxCluster = findColIndex(['Cluster', 'Cluster Name', 'Cluster_Name', 'Nama Cluster'], 67);
  const idxSubCluster = findColIndex(['Sub Cluster', 'SubCluster', 'Sub_Cluster', 'Nama Sub Cluster', 'Sub Cluster Name'], 65);
  const idxPairing = findColIndex(['Pairing', 'Pairing Collo', 'Collo Pairing', 'Pair', 'Pasangan', 'Grouping Collo', 'Collo Group', 'Collo', 'Pairing Group', 'Group Pairing'], -1);
  const idxJarak = findColIndex(['Jarak', 'Jarak (m)', 'Jarak Pairing', 'Distance', 'Jarak (Meter)', 'Jarak (meter)', 'Jarak_Pairing'], -1);
  const idxHistory = findColIndex(['History', 'Status History', 'History Status', 'Kategori History'], 77);

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

  // Dokumentasi indexes
  const idxDocBestServer = colIdx('Dokumentasi Best Server') !== -1 ? colIdx('Dokumentasi Best Server') : 64;
  const idxDocNrxlv1 = colIdx('Dokumentasi NRxLv1') !== -1 ? colIdx('Dokumentasi NRxLv1') : 65;

  // Coverage Prediction (CP) indexes (Columns BU to BY)
  const idxCpDeep = findColIndex(['CP Deep Indoor', 'CP Deep'], -1);
  const idxCpIndoor = findColIndex(['CP Indoor'], -1);
  const idxCpFW = findColIndex(['CP First Wall', 'CP Fist Wall'], -1);
  const idxCpOut = findColIndex(['CP Outdoor'], -1);
  const idxCpKpi = findColIndex(['Total Coverage Prediction', 'CP Total Coverage Prediction', 'CP Total Coverage', 'Coverage Prediction Total'], -1);

  const parsePercent = (val: any) => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') {
      let num = val <= 1.05 ? val * 100 : val;
      return num > 100 ? 100 : num;
    }
    const str = val.toString().trim();
    const hasPercent = str.indexOf('%') !== -1;
    let cleaned = str.replace('%', '').replace(',', '.').replace(/[\s\u00a0]/g, '').trim();
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    if (hasPercent) return num > 100 ? 100 : num;
    let res = num <= 1.05 ? num * 100 : num;
    return res > 100 ? 100 : res;
  };

  const parseYear = (val: any, fallbackContext?: string) => {
    if (val !== undefined && val !== null && val !== '') {
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
      if (str !== 'N/A' && str.length > 0) return str;
    }
    if (fallbackContext) {
      const matchFB = fallbackContext.toString().match(/\b(20\d{2})\b/);
      if (matchFB) return matchFB[1];
    }
    return 'N/A';
  };

  const parseSampleCount = (val: any) => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') {
      return Math.round(val);
    }
    let str = val.toString().trim();
    if (!str || str === 'N/A' || str === '-' || str === '#N/A' || str === 'null' || str === 'undefined') return 0;

    const hasPercent = str.includes('%');
    str = str.replace(/%/g, '').trim();

    if (/\d+\.\d+,\d+/.test(str)) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else if (/\d+,\d+\.\d+/.test(str)) {
      str = str.replace(/,/g, '');
    } else if (str.includes(',')) {
      str = str.replace(',', '.');
    }

    let num = parseFloat(str);
    if (isNaN(num)) return 0;

    if (hasPercent) {
      num = num / 100;
    }

    return Math.round(num);
  };

  const results: any[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const sId = row[idxSiteId];
    if (!sId) continue;

    // Check if the site has any actual drive test coverage data or CP prediction data
    const tselDeepBS = parsePercent(row[idxTselDeep]);
    const tselIndBS = parsePercent(row[idxTselIndoor]);
    const tselFWBS = parsePercent(row[idxTselFW]);
    let tselKpiBS = parsePercent(row[idxTselKpi]);
    if (tselKpiBS === 0 && (tselDeepBS > 0 || tselIndBS > 0 || tselFWBS > 0)) {
      tselKpiBS = tselDeepBS + tselIndBS + tselFWBS;
    }

    const iohDeepBS = parsePercent(row[idxIohDeep]);
    const iohIndBS = parsePercent(row[idxIohIndoor]);
    const iohFWBS = parsePercent(row[idxIohFW]);
    let iohKpiBS = parsePercent(row[idxIohKpi]);
    if (iohKpiBS === 0 && (iohDeepBS > 0 || iohIndBS > 0 || iohFWBS > 0)) {
      iohKpiBS = iohDeepBS + iohIndBS + iohFWBS;
    }

    const xlsDeepBS = parsePercent(row[idxXlsDeep]);
    const xlsIndBS = parsePercent(row[idxXlsIndoor]);
    const xlsFWBS = parsePercent(row[idxXlsFW]);
    let xlsKpiBS = parsePercent(row[idxXlsKpi]);
    if (xlsKpiBS === 0 && (xlsDeepBS > 0 || xlsIndBS > 0 || xlsFWBS > 0)) {
      xlsKpiBS = xlsDeepBS + xlsIndBS + xlsFWBS;
    }

    const tselDeepNR = parsePercent(row[idxTselDeep_nr]);
    const tselIndNR = parsePercent(row[idxTselIndoor_nr]);
    const tselFWNR = parsePercent(row[idxTselFW_nr]);
    let tselKpiNR = parsePercent(row[idxTselKpi_nr]);
    if (tselKpiNR === 0 && (tselDeepNR > 0 || tselIndNR > 0 || tselFWNR > 0)) {
      tselKpiNR = tselDeepNR + tselIndNR + tselFWNR;
    }

    const iohDeepNR = parsePercent(row[idxIohDeep_nr]);
    const iohIndNR = parsePercent(row[idxIohIndoor_nr]);
    const iohFWNR = parsePercent(row[idxIohFW_nr]);
    let iohKpiNR = parsePercent(row[idxIohKpi_nr]);
    if (iohKpiNR === 0 && (iohDeepNR > 0 || iohIndNR > 0 || iohFWNR > 0)) {
      iohKpiNR = iohDeepNR + iohIndNR + iohFWNR;
    }

    const xlsDeepNR = parsePercent(row[idxXlsDeep_nr]);
    const xlsIndNR = parsePercent(row[idxXlsIndoor_nr]);
    const xlsFWNR = parsePercent(row[idxXlsFW_nr]);
    let xlsKpiNR = parsePercent(row[idxXlsKpi_nr]);
    if (xlsKpiNR === 0 && (xlsDeepNR > 0 || xlsIndNR > 0 || xlsFWNR > 0)) {
      xlsKpiNR = xlsDeepNR + xlsIndNR + xlsFWNR;
    }

    const cpDeepVal = idxCpDeep !== -1 ? parsePercent(row[idxCpDeep]) : 0;
    const cpIndoorVal = idxCpIndoor !== -1 ? parsePercent(row[idxCpIndoor]) : 0;
    const cpFWVal = idxCpFW !== -1 ? parsePercent(row[idxCpFW]) : 0;
    const cpOutVal = idxCpOut !== -1 ? parsePercent(row[idxCpOut]) : 0;
    const cpKpiVal = idxCpKpi !== -1 ? parsePercent(row[idxCpKpi]) : 0;

    const latVal = row[idxLat] ? parseFloat(row[idxLat].toString().replace(',', '.')) : 0;
    const lngVal = row[idxLong] ? parseFloat(row[idxLong].toString().replace(',', '.')) : 0;

    let rawPairing = (idxPairing !== -1 && row[idxPairing]) ? row[idxPairing].toString().trim() : '';
    if (rawPairing === 'N/A' || rawPairing === '0' || rawPairing === '-') {
      rawPairing = '';
    }

    results.push({
      siteId: sId.toString().trim(),
      siteName: row[idxSiteName] || 'N/A',
      province: row[idxProvince] || 'N/A',
      city: row[idxCity] || 'N/A',
      morphoclass: idxMorphoclass !== -1 ? row[idxMorphoclass] || 'N/A' : 'N/A',
      yearDt: parseYear(row[idxYearDt], (row[idxCluster] || '') + ' ' + (rawPairing || '') + ' ' + (row[idxSiteName] || '')),
      jenisTeknologi: row[idxJenisTeknologi] ? row[idxJenisTeknologi].toString().trim() : 'N/A',
      statusGroup: row[idxStatusGroup] || 'N/A',
      activeTenant: (idxActiveTenant !== -1 && row[idxActiveTenant]) ? row[idxActiveTenant].toString().trim() : (row[10] ? row[10].toString().trim() : 'N/A'),
      towerHeight: (idxTowerHeight !== -1 && row[idxTowerHeight]) ? row[idxTowerHeight].toString().trim() : (row[68] ? row[68].toString().trim() : 'N/A'),
      towerType: (idxTowerType !== -1 && row[idxTowerType]) ? row[idxTowerType].toString().trim() : (row[69] ? row[69].toString().trim() : 'N/A'),
      pairing: rawPairing,
      jarak: (idxJarak !== -1 && row[idxJarak] !== undefined && row[idxJarak] !== null) ? row[idxJarak].toString().trim() : '',
      lat: isNaN(latVal) ? 0 : latVal,
      lng: isNaN(lngVal) ? 0 : lngVal,
      tselMap: row[idxTselMap] || '',
      iohMap: row[idxIohMap] || '',
      xlsMap: row[idxXlsMap] || '',
      streetView: row[idxStreetView] || '',
      cluster: row[idxCluster] || 'N/A',
      subCluster: (idxSubCluster !== -1 && row[idxSubCluster]) ? row[idxSubCluster].toString().trim() : 'N/A',
      history: (idxHistory !== -1 && row[idxHistory]) ? (row[idxHistory].toString().trim() === 'Updated' ? 'Latest' : row[idxHistory].toString().trim()) : '',

      // Best Server
      bestServer: {
        tselDeep: tselDeepBS,
        tselIndoor: tselIndBS,
        tselFW: tselFWBS,
        tselOut: parsePercent(row[idxTselOut]),
        tselKpi: tselKpiBS,
        tselMap: row[idxTselMap] || '',
        tselSamples: parseSampleCount(row[idxTselSamples]),

        iohDeep: iohDeepBS,
        iohIndoor: iohIndBS,
        iohFW: iohFWBS,
        iohOut: parsePercent(row[idxIohOut]),
        iohKpi: iohKpiBS,
        iohMap: row[idxIohMap] || '',
        iohSamples: parseSampleCount(row[idxIohSamples]),

        xlsDeep: xlsDeepBS,
        xlsIndoor: xlsIndBS,
        xlsFW: xlsFWBS,
        xlsOut: parsePercent(row[idxXlsOut]),
        xlsKpi: xlsKpiBS,
        xlsMap: row[idxXlsMap] || '',
        xlsSamples: parseSampleCount(row[idxXlsSamples]),
        statusDokumentasi: parsePercent(row[idxDocBestServer]), // Column BM or Dokumentasi Best Server
      },

      // NRxLv1
      nrxLv1: {
        tselDeep: tselDeepNR,
        tselIndoor: tselIndNR,
        tselFW: tselFWNR,
        tselOut: parsePercent(row[idxTselOut_nr]),
        tselKpi: tselKpiNR,
        tselMap: row[idxTselMap_nr] || '',
        tselSamples: parseSampleCount(row[idxTselSamples_nr]),

        iohDeep: iohDeepNR,
        iohIndoor: iohIndNR,
        iohFW: iohFWNR,
        iohOut: parsePercent(row[idxIohOut_nr]),
        iohKpi: iohKpiNR,
        iohMap: row[idxIohMap_nr] || '',
        iohSamples: parseSampleCount(row[idxIohSamples_nr]),

        xlsDeep: xlsDeepNR,
        xlsIndoor: xlsIndNR,
        xlsFW: xlsFWNR,
        xlsOut: parsePercent(row[idxXlsOut_nr]),
        xlsKpi: xlsKpiNR,
        xlsMap: row[idxXlsMap_nr] || '',
        xlsSamples: parseSampleCount(row[idxXlsSamples_nr]),
        statusDokumentasi: parsePercent(row[idxDocNrxlv1]), // Column BN or Dokumentasi NRxLv1
      },

      // Coverage Prediction (CP) - BU to BY
      cp: {
        deep: cpDeepVal,
        indoor: cpIndoorVal,
        fw: cpFWVal,
        out: cpOutVal,
        kpi: cpKpiVal
      }
    });
  }
  return results;
}

function getKomersilTenantMap(komersilRows: string[][]) {
  const headers = komersilRows[0];
  const rawRows = komersilRows.slice(1);
  const colIdx = (name: string) => {
    if (!headers) return -1;
    return headers.findIndex(h => h && h.trim().toLowerCase() === name.trim().toLowerCase());
  };

  const idxSiteId = colIdx('Site ID');
  const idxTsel = colIdx('TSEL Active');
  const idxIoh = colIdx('IOH (H3I) Active');
  const idxH3i = colIdx('H3I(IOH) Active');
  const idxXl = colIdx('XL(SF) Active');
  const idxSf = colIdx('SF(XL) Active');
  const idxSigfox = colIdx('Sigfox Active');

  const tenantMap = new Map<string, string[]>();

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const siteId = r[idxSiteId !== -1 ? idxSiteId : 0];
    if (!siteId) continue;

    const sIdKey = siteId.toString().trim().toUpperCase();

    let isTselActive = false;
    let isIohActive = false;
    let isXlsActive = false;
    let isSigfoxActive = false;

    if (idxTsel !== -1) {
      const v = String(r[idxTsel] || '').trim();
      isTselActive = v === '1' || v.toUpperCase() === 'TSEL';
    } else {
      isTselActive = r[61] === '1' || String(r[61]).trim() === '1';
    }

    if (idxIoh !== -1 || idxH3i !== -1) {
      const v1 = idxIoh !== -1 ? String(r[idxIoh] || '').trim() : '';
      const v2 = idxH3i !== -1 ? String(r[idxH3i] || '').trim() : '';
      isIohActive = (v1 !== '' && v1 !== '0' && v1 !== '-') || (v2 !== '' && v2 !== '0' && v2 !== '-');
    } else {
      isIohActive = (r[62] && String(r[62]).trim() !== '' && String(r[62]).trim() !== '0' && String(r[62]).trim() !== '-') ||
                    (r[63] && String(r[63]).trim() !== '' && String(r[63]).trim() !== '0' && String(r[63]).trim() !== '-');
    }

    if (idxXl !== -1 || idxSf !== -1) {
      const v1 = idxXl !== -1 ? String(r[idxXl] || '').trim() : '';
      const v2 = idxSf !== -1 ? String(r[idxSf] || '').trim() : '';
      isXlsActive = (v1 !== '' && v1 !== '0' && v1 !== '-') || (v2 !== '' && v2 !== '0' && v2 !== '-');
    } else {
      isXlsActive = (r[64] && String(r[64]).trim() !== '' && String(r[64]).trim() !== '0' && String(r[64]).trim() !== '-') ||
                    (r[65] && String(r[65]).trim() !== '' && String(r[65]).trim() !== '0' && String(r[65]).trim() !== '-');
    }

    if (idxSigfox !== -1) {
      const v = String(r[idxSigfox] || '').trim();
      isSigfoxActive = v !== '' && v !== '0' && v !== '-';
    } else {
      isSigfoxActive = (r[66] && String(r[66]).trim() !== '' && String(r[66]).trim() !== '0' && String(r[66]).trim() !== '-');
    }

    const siteTenants: string[] = [];
    if (isTselActive) siteTenants.push('TSEL');
    if (isIohActive) siteTenants.push('IOH');
    if (isXlsActive) siteTenants.push('XLS');
    if (isSigfoxActive) siteTenants.push('SIGFOX');

    tenantMap.set(sIdKey, siteTenants);
  }

  return tenantMap;
}

// Logic from Code.gs to calculate Dashboard Data
function getDashboardData(rows: string[][], filters: any = {}) {
  const headers = rows[0];
  const rawRows = rows.slice(1);

  const colIdx = (name: string) => {
    if (!headers) return -1;
    return headers.findIndex(h => h && h.trim().toLowerCase() === name.trim().toLowerCase());
  };
  const idxMorphoclass = colIdx('Morphoclass');

  // Operator flag tracking
  const idxTsel = colIdx('TSEL Active');
  const idxIoh = colIdx('IOH (H3I) Active');
  const idxH3i = colIdx('H3I(IOH) Active');
  const idxXl = colIdx('XL(SF) Active');
  const idxSf = colIdx('SF(XL) Active');
  const idxSigfox = colIdx('Sigfox Active');
  
  // Kolom BH (Active Tenant Text) untuk keperluan sebaran grafik detail teks
  const idxActiveTenantStr = colIdx('Active Tenant') !== -1 ? colIdx('Active Tenant') : 59; 
  
  // PERBAIKAN: Menunjuk langsung Kolom BI (Indeks 60) untuk Tenant Number murni angka
  const idxActiveTenantNumDirect = 60; 
  
  // Pemetaan Jaminan & Asuransi Proteksi (Base-0)
  const idxFasilitas = colIdx('Fasilitas') !== -1 ? colIdx('Fasilitas') : 51; 
  const idxTenggatWaktu = colIdx('Penjamin End Date') !== -1 ? colIdx('Penjamin End Date') : colIdx('Tenggat Waktu') !== -1 ? colIdx('Tenggat Waktu') : 53;   // Kolom BB
  const idxPenjaminStart = colIdx('Penjamin Start Date') !== -1 ? colIdx('Penjamin Start Date') : 54;  // Kolom BC
  const idxPenjaminan = colIdx('Penjaminan') !== -1 ? colIdx('Penjaminan') : colIdx('Status Penjaminan') !== -1 ? colIdx('Status Penjaminan') : 55;     // Kolom BD (Status Penjaminan)
  const idxAsuransi = colIdx('Asuransi') !== -1 ? colIdx('Asuransi') : colIdx('Status Asuransi') !== -1 ? colIdx('Status Asuransi') : 56;       // Kolom BE (Status Asuransi)
  const idxAsuransiStart = colIdx('Asuransi Start Date') !== -1 ? colIdx('Asuransi Start Date') : 57;  // Kolom BF
  const idxAsuransiEnd = colIdx('Asuransi End Date') !== -1 ? colIdx('Asuransi End Date') : 58;    // Kolom BG

  const idxPmoStatus = colIdx('PMO Status') !== -1 ? colIdx('PMO Status') : (colIdx('PMO_Status') !== -1 ? colIdx('PMO_Status') : 6);

  const targetFields = ['Site ID', 'Site Name', 'Lat', 'Long', 'Status Group', 'Province', 'City', 'Land Asset', 'Tower Type', 'Tower Height', 'Rental Value', 'District'];
  const fieldMapping: any = {};
  targetFields.forEach(f => { fieldMapping[f] = colIdx(f); });

  const filterSgSet = filters.rawStatusGroups ? new Set(filters.rawStatusGroups) : new Set();
  const filterPvSet = filters.rawProvinces ? new Set(filters.rawProvinces) : new Set();
  const filterCtSet = filters.rawCities ? new Set(filters.rawCities) : new Set();
  const filterLaSet = filters.rawLandAssets ? new Set(filters.rawLandAssets) : new Set();
  const filterTnSet = filters.rawTenants ? new Set(filters.rawTenants) : new Set();
  const filterRatioTnSet = filters.ratioTenants ? new Set(filters.ratioTenants) : new Set();

  let mapData: any[] = [];
  let statusGroupCounts: any = {};
  let towerTypeCounts: any = {};
  let towerHeightCounts: any = {};
  let landAssetCounts: any = {};
  let tenantActiveCounts: any = { 'TSEL': 0, 'IOH': 0, 'XLS': 0, 'SIGFOX': 0, 'NONE': 0 };
  let pmoCounts: any = {};
  
  let rentalProvinsi: any = {};
  let penjaminanCounts: any = {};
  let asuransiCounts: any = {};
  let ewsAlerts: any[] = [];
  let detailedSites: any[] = []; 
  let cityStats: any = {};

  const formatDateValue = (val: any) => {
    return val || '-';
  };

  for (let i = 0; i < rawRows.length; i++) {
    let r = rawRows[i];
    if (!r || r.length < headers.length) continue;
    
    let rowSg = r[fieldMapping['Status Group']];
    let rowPv = r[fieldMapping['Province']];
    let rowCt = r[fieldMapping['City']];
    let rowLa = r[fieldMapping['Land Asset']];

    let sgUpper = (rowSg || '').toString().trim().toUpperCase();

    if (filterSgSet.size > 0 && !filterSgSet.has(rowSg)) continue;
    if (filterPvSet.size > 0 && !filterPvSet.has(rowPv)) continue;
    if (filterCtSet.size > 0 && !filterCtSet.has(rowCt)) continue;
    if (filterLaSet.size > 0 && !filterLaSet.has(rowLa)) continue;

    // Apply multi-filter ratio city & land filters on tab-2 (which targets EXISTING status)
    if (sgUpper === 'EXISTING') {
      if (filters.multiCities && filters.multiCities.length > 0) {
        let city = (rowCt || 'Unknown').toString().trim();
        if (!filters.multiCities.includes(city)) continue;
      }
      if (filters.multiLands && filters.multiLands.length > 0) {
        let land = (rowLa || 'N/A').toString().trim();
        if (!filters.multiLands.includes(land)) continue;
      }
    }

    let isTselActive = false;
    let isIohActive = false;
    let isXlsActive = false;
    let isSigfoxActive = false;

    let hasFlagColumns = (idxTsel !== -1 || idxIoh !== -1 || idxH3i !== -1 || idxXl !== -1 || idxSf !== -1 || idxSigfox !== -1);
    if (hasFlagColumns) {
      if (idxTsel !== -1) {
        let v = String(r[idxTsel] || '').trim();
        isTselActive = v === '1' || v.toUpperCase() === 'TSEL';
      }
      if (idxIoh !== -1 || idxH3i !== -1) {
        let v1 = idxIoh !== -1 ? String(r[idxIoh] || '').trim() : '';
        let v2 = idxH3i !== -1 ? String(r[idxH3i] || '').trim() : '';
        isIohActive = (v1 !== '' && v1 !== '0' && v1 !== '-') || (v2 !== '' && v2 !== '0' && v2 !== '-');
      }
      if (idxXl !== -1 || idxSf !== -1) {
        let v1 = idxXl !== -1 ? String(r[idxXl] || '').trim() : '';
        let v2 = idxSf !== -1 ? String(r[idxSf] || '').trim() : '';
        isXlsActive = (v1 !== '' && v1 !== '0' && v1 !== '-') || (v2 !== '' && v2 !== '0' && v2 !== '-');
      }
      if (idxSigfox !== -1) {
        let v = String(r[idxSigfox] || '').trim();
        isSigfoxActive = v !== '' && v !== '0' && v !== '-';
      }
    } else {
      isTselActive = r[61] === '1' || String(r[61]).trim() === '1';
      isIohActive = (r[62] && String(r[62]).trim() !== '' && String(r[62]).trim() !== '0' && String(r[62]).trim() !== '-') ||
                    (r[63] && String(r[63]).trim() !== '' && String(r[63]).trim() !== '0' && String(r[63]).trim() !== '-');
      isXlsActive = (r[64] && String(r[64]).trim() !== '' && String(r[64]).trim() !== '0' && String(r[64]).trim() !== '-') ||
                    (r[65] && String(r[65]).trim() !== '' && String(r[65]).trim() !== '0' && String(r[65]).trim() !== '-');
      isSigfoxActive = (r[66] && String(r[66]).trim() !== '' && String(r[66]).trim() !== '0' && String(r[66]).trim() !== '-');
    }

    let siteTenants: string[] = [];
    if (isTselActive) siteTenants.push('TSEL');
    if (isIohActive) siteTenants.push('IOH');
    if (isXlsActive) siteTenants.push('XLS');
    if (isSigfoxActive) siteTenants.push('SIGFOX');

    if (siteTenants.length === 0) {
      let tenantText = '';
      if (idxActiveTenantStr !== -1 && r[idxActiveTenantStr] !== undefined) {
        tenantText = r[idxActiveTenantStr].toString().trim();
      }
      if (tenantText && tenantText !== '-' && tenantText.toUpperCase() !== 'NONE') {
        let ops = tenantText.split(',').map(op => op.trim().toUpperCase());
        ops.forEach(op => {
          if (op === 'TSEL' || op === 'TELKOMSEL') {
            if (!siteTenants.includes('TSEL')) siteTenants.push('TSEL');
          } else if (op === 'IOH' || op === 'INDOSAT' || op === 'H3I' || op === 'THREE' || op === '3') {
            if (!siteTenants.includes('IOH')) siteTenants.push('IOH');
          } else if (op === 'XL' || op === 'XLS' || op === 'XL AXIATA') {
            if (!siteTenants.includes('XLS')) siteTenants.push('XLS');
          } else if (op === 'SIGFOX') {
            if (!siteTenants.includes('SIGFOX')) siteTenants.push('SIGFOX');
          }
        });
      }
    }

    // Multi-Filter Global Tenant Filter
    if (filterTnSet.size > 0) {
      let tenantMatch = false;
      if (filterTnSet.has('NONE') && siteTenants.length === 0) {
        tenantMatch = true;
      } else {
        tenantMatch = siteTenants.some(t => filterTnSet.has(t));
      }
      if (!tenantMatch) continue;
    }

    // Multi-Filter Ratio Tenant Filter (for EXISTING status only)
    if (sgUpper === 'EXISTING' && filterRatioTnSet.size > 0) {
      let ratioTenantMatch = false;
      if (filterRatioTnSet.has('NONE') && siteTenants.length === 0) {
        ratioTenantMatch = true;
      } else {
        ratioTenantMatch = siteTenants.some(t => filterRatioTnSet.has(t));
      }
      if (!ratioTenantMatch) continue;
    }

    let siteId = r[fieldMapping['Site ID']];
    if (!siteId) continue;
    let siteName = r[fieldMapping['Site Name']] || 'N/A';
    
    // Normalize commas to decimals in coordinate fields
    let latRaw = (r[fieldMapping['Lat']] || '').toString().replace(',', '.');
    let lngRaw = (r[fieldMapping['Long']] || '').toString().replace(',', '.');
    let lat = parseFloat(latRaw);
    let lng = parseFloat(lngRaw);

    let rentalRaw = (r[fieldMapping['Rental Value']] || '').toString().replace(/\./g, '').replace(',', '.');
    let rentalVal = parseFloat(rentalRaw) || 0;
    
    let th = r[fieldMapping['Tower Height']];
    let tt = r[fieldMapping['Tower Type']] || 'N/A';
    let fas = r[idxFasilitas] || '-';
    
    let tglTenggat = formatDateValue(r[idxTenggatWaktu]);
    let penStart = formatDateValue(r[idxPenjaminStart]);
    let penEnd = tglTenggat; 
    let pen = (r[idxPenjaminan] || '').toString().trim();
    
    let asu = (r[idxAsuransi] || '').toString().trim();
    let asuStart = formatDateValue(r[idxAsuransiStart]);
    let asuEnd = formatDateValue(r[idxAsuransiEnd]);
    
    statusGroupCounts[rowSg] = (statusGroupCounts[rowSg] || 0) + 1;
    let pmoStatus = (r[idxPmoStatus] && r[idxPmoStatus].toString().trim() !== '') ? r[idxPmoStatus].toString().trim() : 'N/A';
    if (!pmoCounts[sgUpper]) {
      pmoCounts[sgUpper] = {};
    }
    pmoCounts[sgUpper][pmoStatus] = (pmoCounts[sgUpper][pmoStatus] || 0) + 1;

    towerTypeCounts[tt] = (towerTypeCounts[tt] || 0) + 1;
    
    let thStr = '';
    if (th !== undefined && th !== '' && !isNaN(parseFloat(th))) thStr = th + "m";
    else thStr = 'N/A';
    towerHeightCounts[thStr] = (towerHeightCounts[thStr] || 0) + 1;
    landAssetCounts[rowLa || 'N/A'] = (landAssetCounts[rowLa || 'N/A'] || 0) + 1;

    let tenantText = siteTenants.join(', ');
    if (siteTenants.length === 0) tenantText = 'NONE';
    let tenantNum = siteTenants.length;
    
    if (siteTenants.length === 0) {
      tenantActiveCounts['NONE'] = (tenantActiveCounts['NONE'] || 0) + 1;
    } else {
      siteTenants.forEach(op => {
        tenantActiveCounts[op] = (tenantActiveCounts[op] || 0) + 1;
      });
    }

    if (!isNaN(lat) && !isNaN(lng)) {
      mapData.push({ 
        id: siteId, 
        name: siteName, 
        lat: lat, 
        lng: lng, 
        sg: sgUpper, 
        city: rowCt, 
        kecamatan: fieldMapping['District'] !== -1 ? r[fieldMapping['District']] || 'N/A' : 'N/A',
        towerType: tt,
        towerHeight: thStr,
        landAsset: rowLa || 'N/A',
        activeTenantNum: tenantNum, 
        tenantName: tenantText || 'NONE',
        pmoStatus: pmoStatus
      });
    }

    let prov = rowPv || 'Unknown';
    rentalProvinsi[prov] = (rentalProvinsi[prov] || 0) + rentalVal;

    if(pen !== '') penjaminanCounts[pen] = (penjaminanCounts[pen] || 0) + 1;
    if(asu !== '') asuransiCounts[asu] = (asuransiCounts[asu] || 0) + 1;

    detailedSites.push({
      id: siteId, name: siteName, city: rowCt || '-', type: tt, height: thStr,
      activeTenant: tenantNum, tenants: tenantText || 'NONE',
      rental: rentalVal, fasilitas: fas, penStart: penStart, penEnd: penEnd,
      statusPen: pen || '-', asuransi: asu || '-', asuStart: asuStart, asuEnd: asuEnd,
      statusGroup: rowSg || 'N/A',
      province: rowPv || 'N/A',
      morphoclass: idxMorphoclass !== -1 ? r[idxMorphoclass] || 'N/A' : 'N/A'
    });

    if (sgUpper === 'DISMANTLED' && (pen.toUpperCase() === 'AKTIF' || pen.toUpperCase() === 'ACTIVE')) {
      let actionRecommendation = "Koordinasikan dengan tim Legal & Procurement untuk review pemutusan / pengalihan sisa nilai jaminan komersial.";
      ewsAlerts.push({ 
        id: siteId, name: siteName, city: rowCt || 'N/A', rental: rentalVal, 
        statusPen: pen, tenggat: tglTenggat, action: actionRecommendation
      });
    }

    if (sgUpper === 'EXISTING') {
      let city = rowCt || 'Unknown';
      let matchRatioCity = (!filters.multiCities || filters.multiCities.length === 0 || filters.multiCities.indexOf(city) !== -1);
      let matchRatioLand = (!filters.multiLands || filters.multiLands.length === 0 || filters.multiLands.indexOf(rowLa) !== -1);
      
      if (matchRatioCity && matchRatioLand) {
        if (!cityStats[city]) cityStats[city] = { totalSite: 0, totalTenant: 0 };
        cityStats[city].totalSite += 1;
        cityStats[city].totalTenant += tenantNum;
      }
    }
  }

  let tenantRatioData = Object.keys(cityStats).map(city => {
    let stats = cityStats[city];
    let ratioVal = stats.totalSite > 0 ? parseFloat((stats.totalTenant / stats.totalSite).toFixed(2)) : 0;
    
    let status = "Low";
    let keterangan = "Perlu evaluasi pemanfaatan site";
    
    if (ratioVal > 1.0) {
      status = "High";
      keterangan = "Utilisasi tinggi";
    } else if (ratioVal >= 0.5 && ratioVal <= 1.0) {
      status = "Medium";
      keterangan = "Utilisasi cukup baik";
    }

    return { 
      city: city, 
      totalSite: stats.totalSite, 
      totalTenant: stats.totalTenant, 
      ratio: ratioVal.toFixed(2), 
      status: status,
      keterangan: keterangan
    };
  }).sort((a, b) => parseFloat(b.ratio) - parseFloat(a.ratio));

  const getUniqueValues = (colName: string) => {
    let idx = colIdx(colName);
    if (idx === -1) return [];
    let set = new Set(rawRows.map(r => r[idx]));
    return [...set].filter(Boolean).sort();
  };

  let cityGroups: any = {}; 
  const statusColIdx = colIdx('Status Group');

  rawRows.forEach(r => {
    let status = (r[statusColIdx] || '').toString().trim().toUpperCase();
    if (status === 'EXISTING') {
      let city = (r[colIdx('City')] || 'Unknown').toString().trim();
      let pScore = parseFloat((r[101] || '').replace(',', '.')) || 0; 
      let aScore = parseFloat((r[103] || '').replace(',', '.')) || 0;

      if (!cityGroups[city]) {
        cityGroups[city] = { pTotal: 0, aTotal: 0, count: 0 };
      }
      cityGroups[city].pTotal += pScore;
      cityGroups[city].aTotal += aScore;
      cityGroups[city].count += 1;
    }
  });

  let potentialData = Object.keys(cityGroups).map(city => {
    let avgP = cityGroups[city].pTotal / cityGroups[city].count;
    let avgA = cityGroups[city].aTotal / cityGroups[city].count;
    return {
      city: city,
      pScore: parseFloat(avgP.toFixed(2)),
      pStatus: avgP > 60.63 ? "High" : (avgP > 49.09 ? "Medium" : "Low"),
      aScore: parseFloat(avgA.toFixed(2)),
      aStatus: avgA > 75.48 ? "High" : (avgA > 63.50 ? "Medium" : "Low")
    };
  });

  let lastUpdate = "";
  if (rows.length > 1) {
    for (let j = 1; j < rows.length; j++) {
      if (rows[j].length > 157 && rows[j][157]) {
        lastUpdate = rows[j][157].toString().trim();
        break;
      }
    }
  }

  return {
    summary: { totalSite: mapData.length, totalAllSites: rawRows.length, statusGroups: statusGroupCounts, towerType: towerTypeCounts, towerHeight: towerHeightCounts, landAsset: landAssetCounts, tenantActive: tenantActiveCounts, pmoCounts: pmoCounts },
    komersial: { rentalProvinsi: rentalProvinsi, penjaminan: penjaminanCounts, asuransi: asuransiCounts, ews: ewsAlerts, details: detailedSites },
    detailedSites: detailedSites,
    tenantRatio: tenantRatioData,
    driveTest: [], 
    mapData: mapData,
    potential: potentialData, 
    filterOptions: { statusGroup: getUniqueValues('Status Group'), province: getUniqueValues('Province'), city: getUniqueValues('City'), landAsset: getUniqueValues('Land Asset') },
    lastUpdate: lastUpdate
  };
}

function analyzeDTV2(rows: string[][], siteId: string, level: string) {
  const headers = rows[0];
  const colIdx = (name: string) => {
    if (!headers) return -1;
    return headers.findIndex(h => h && h.trim().toLowerCase() === name.trim().toLowerCase());
  };
  const idxSiteId = colIdx('Site ID');
  const targetSiteIdUpper = siteId.toUpperCase().trim();
  const rawRows = rows.slice(1);
  const matchingRow = rawRows.find(r => r && r[idxSiteId] && r[idxSiteId].toString().toUpperCase().trim() === targetSiteIdUpper);

  if (!matchingRow) return "Site ID tidak ditemukan di dalam lembar kerja.";

  const data = getDriveTestV2Data([headers, matchingRow]);
  const site = data[0];
  
  if (!site) return "Site ID tidak ditemukan di dalam lembar kerja.";

  const getStatus = (val: number) => val >= 85 ? "Optimal" : val >= 70 ? "Cukup" : "Kurang / Degradasi";

  const lvl = level === 'NRxLv1' ? site.nrxLv1 : site.bestServer;

  let suggestions: string[] = [];
  if (lvl.tselDeep < 60 && lvl.tselKpi > 0) suggestions.push("- **TSEL:** Penetrasi Deep Indoor lemah (" + lvl.tselDeep.toFixed(2) + "%). Lakukan pengecekan electrical tilt antenna sektoral atau naikkan power TX.");
  if (lvl.iohFW < 60 && lvl.iohKpi > 0) suggestions.push("- **IOH:** Penetrasi dinding (First Wall) kritis (" + lvl.iohFW.toFixed(2) + "%). Perlu audit physical blocker di arah azimuth utama.");
  if (lvl.xlsDeep < 60 && lvl.xlsKpi > 0) suggestions.push("- **XLS:** Sinyal dalam ruangan kritis (" + lvl.xlsDeep.toFixed(2) + "%). Disarankan optimasi mekanis atau penyesuaian gain antenna.");

  const tenantLower = (site.activeTenant || '').toLowerCase().trim();
  if (tenantLower === 'zero' || tenantLower === 'none' || tenantLower === '' || tenantLower === '0') {
    suggestions.push("- **Sewa/Tenant:** Status saat ini adalah **Zero Tenant** (tidak ada tenant aktif). Direkomendasikan untuk melakukan pendekatan bisnis dan pemasaran kolokasi kepada seluruh operator telekomunikasi utama (TSEL, IOH, XLS) agar space menara yang kosong dapat diutilisasi.");
  }

  if (suggestions.length === 0) {
    suggestions.push("- Kualitas signal coverage dalam gedung (indoor) untuk semua operator dalam kondisi aman.");
  }

  let otherMenaraAnalysis = "";
  const isTselTenant = tenantLower.includes('tsel') || tenantLower.includes('telkomsel');
  const isIohTenant = tenantLower.includes('ioh') || tenantLower.includes('indosat') || tenantLower.includes('h3i');
  const isXlsTenant = tenantLower.includes('xls') || tenantLower.includes('xl') || tenantLower.includes('xl axiata');

  const ops = [
    { name: 'TSEL', isTenant: isTselTenant, kpi: lvl.tselKpi },
    { name: 'IOH', isTenant: isIohTenant, kpi: lvl.iohKpi },
    { name: 'XLS', isTenant: isXlsTenant, kpi: lvl.xlsKpi }
  ];

  const tenantOps = ops.filter(o => o.isTenant);
  const nonTenantOps = ops.filter(o => !o.isTenant);

  let analysisNotes: string[] = [];

  if (tenantOps.length > 0 && nonTenantOps.length > 0) {
    tenantOps.forEach(t => {
      nonTenantOps.forEach(nt => {
        if (nt.kpi > t.kpi) {
          const diff = nt.kpi - t.kpi;
          if (diff > 7) {
            analysisNotes.push(`- Sinyal **${nt.name}** (${nt.kpi.toFixed(2)}%) lebih baik dari existing tenant **${t.name}** (${t.kpi.toFixed(2)}%) dengan selisih **${diff.toFixed(2)}%** (selisih > 7%). Diindikasikan adanya perkiraan **keberadaan menara lain dekat dengan existing kita**.`);
          } else {
            analysisNotes.push(`- Sinyal **${nt.name}** (${nt.kpi.toFixed(2)}%) berada sedikit di atas existing tenant **${t.name}** (${t.kpi.toFixed(2)}%) dengan margin sebesar **${diff.toFixed(2)}%** (selisih ≤ 7%). Rekomendasi teknis yang disarankan adalah melakukan **optimasi parameter RF dan fine-tuning sektor antena** pada perangkat eksisting.`);
          }
        }
      });
    });
  }

  if (analysisNotes.length > 0) {
    otherMenaraAnalysis = `\n\n**Analisis Deteksi Menara Sekitar:**\n` + analysisNotes.join('\n');
  }

  return `### Laporan Analisis RF Sinyal Site (V2.0): ${site.siteId} - ${site.siteName}
**Informasi Site:**
- **Morphoclass:** ${site.morphoclass}
- **Active Tenant:** ${site.activeTenant}
- **Jenis Pengukuran:** ${level}

**Hasil Pengukuran Service Level:**
- **TSEL Service Level:** ${lvl.tselKpi.toFixed(2)}% (${getStatus(lvl.tselKpi)})
- **IOH Service Level:** ${lvl.iohKpi.toFixed(2)}% (${getStatus(lvl.iohKpi)})
- **XLS Service Level:** ${lvl.xlsKpi.toFixed(2)}% (${getStatus(lvl.xlsKpi)})${otherMenaraAnalysis}

**Rekomendasi Rekayasa RF (RF Engineering Recommendations):**
${suggestions.join("\n")}

*TIPS: Lakukan koordinasi lapangan dan prioritaskan peningkatan daya pancar pada sektor yang memiliki Service Level di bawah 70%.*`;
}

let cachedMenaraData: { liar: any[]; tenant: any[]; sitac: any[] } | null = null;
let lastMenaraFetchTime = 0;

let isFetchingMenara = false;
function triggerBackgroundFetchMenara() {
  if (isFetchingMenara) return;
  isFetchingMenara = true;

  const liarCachePath = path.join(process.cwd(), "assets", "menara_liar_cache.json");
  const tenantCachePath = path.join(process.cwd(), "assets", "existing_tenant_cache.json");
  const sitacCachePath = path.join(process.cwd(), "assets", "sitac_cache.json");

  const liarUrl = `https://docs.google.com/spreadsheets/d/1N_LdkoiMjMS012Oa7mieHy0XxZzi_QkOGpl4p5b7PBU/gviz/tq?tqx=out:csv&sheet=ALL%20MENARA%20LIAR`;
  const tenantUrl = `https://docs.google.com/spreadsheets/d/1N_LdkoiMjMS012Oa7mieHy0XxZzi_QkOGpl4p5b7PBU/gviz/tq?tqx=out:csv&sheet=EXISTING%20TENANT`;
  const projectUrlUpper = `https://docs.google.com/spreadsheets/d/1N_LdkoiMjMS012Oa7mieHy0XxZzi_QkOGpl4p5b7PBU/gviz/tq?tqx=out:csv&sheet=PROJECT`;
  const projectUrlLower = `https://docs.google.com/spreadsheets/d/1N_LdkoiMjMS012Oa7mieHy0XxZzi_QkOGpl4p5b7PBU/gviz/tq?tqx=out:csv&sheet=project`;

  console.log("Background Menara fetch initiated...");

  const fetchLiar = fetchCSVWithRetry(liarUrl, 60000, 2);
  const fetchTenant = fetchCSVWithRetry(tenantUrl, 60000, 2);
  const fetchSitac = fetchCSVWithRetry(projectUrlUpper, 60000, 2).catch(() => fetchCSVWithRetry(projectUrlLower, 60000, 2));

  Promise.all([fetchLiar, fetchTenant, fetchSitac])
    .then(([liarText, tenantText, sitacText]) => {
      let updated = false;
      let parsedLiar = cachedMenaraData ? cachedMenaraData.liar : [];
      let parsedTenant = cachedMenaraData ? cachedMenaraData.tenant : [];
      let parsedSitac = cachedMenaraData ? cachedMenaraData.sitac : [];

      if (liarText && liarText.trim().length > 0) {
        try {
          const rows = parseCSV(liarText);
          parsedLiar = parseMenaraLiarRows(rows);
          safeWriteJsonSync(liarCachePath, rows, 2);
          updated = true;
        } catch (e: any) {
          console.warn("Error parsing background Liar data:", e.message);
        }
      }

      if (tenantText && tenantText.trim().length > 0) {
        try {
          const rows = parseCSV(tenantText);
          parsedTenant = parseExistingTenantRows(rows);
          safeWriteJsonSync(tenantCachePath, rows, 2);
          updated = true;
        } catch (e: any) {
          console.warn("Error parsing background Tenant data:", e.message);
        }
      }

      if (sitacText && sitacText.trim().length > 0 && !sitacText.includes("Error")) {
        try {
          const rows = parseCSV(sitacText);
          parsedSitac = parseProjectRows(rows);
          safeWriteJsonSync(sitacCachePath, rows, 2);
          updated = true;
        } catch (e: any) {
          console.warn("Error parsing background SITAC data:", e.message);
        }
      }

      if (updated) {
        cachedMenaraData = { liar: parsedLiar, tenant: parsedTenant, sitac: parsedSitac };
        lastMenaraFetchTime = Date.now();
        console.log("Background Menara data fetch and cache update successful.");
      }
    })
    .catch(err => {
      console.warn("Background Menara data fetch failed:", err.message || err);
    })
    .finally(() => {
      isFetchingMenara = false;
    });
}

export async function getMenaraLiarData() {
  const now = Date.now();

  // 1. Memory cache check
  if (cachedMenaraData && (now - lastMenaraFetchTime < CACHE_TTL)) {
    return cachedMenaraData;
  }

  // 2. Memory cache exists but is stale
  if (cachedMenaraData) {
    triggerBackgroundFetchMenara();
    return cachedMenaraData;
  }

  // 3. Try reading from disk cache first
  const liarCachePath = path.join(process.cwd(), "assets", "menara_liar_cache.json");
  const tenantCachePath = path.join(process.cwd(), "assets", "existing_tenant_cache.json");
  const sitacCachePath = path.join(process.cwd(), "assets", "sitac_cache.json");

  try {
    const liarRows = safeReadJsonSync(liarCachePath);
    const tenantRows = safeReadJsonSync(tenantCachePath);
    const sitacRows = safeReadJsonSync(sitacCachePath);

    if (liarRows && tenantRows && sitacRows) {
      console.log("Loading Menara data from disk cache...");
      const parsedLiar = parseMenaraLiarRows(liarRows);
      const parsedTenant = parseExistingTenantRows(tenantRows);
      const parsedSitac = parseProjectRows(sitacRows);

      cachedMenaraData = { liar: parsedLiar, tenant: parsedTenant, sitac: parsedSitac };
      lastMenaraFetchTime = now;
      console.log("Loaded Menara data from disk cache successfully.");
      triggerBackgroundFetchMenara();
      return cachedMenaraData;
    }
  } catch (diskErr) {
    console.error("Failed to read Menara cache from disk:", diskErr);
  }

  // 4. Blocking fetch as absolute last resort
  console.log("No Menara cache found. Executing blocking fetch...");
  const liarUrl = `https://docs.google.com/spreadsheets/d/1N_LdkoiMjMS012Oa7mieHy0XxZzi_QkOGpl4p5b7PBU/gviz/tq?tqx=out:csv&sheet=ALL%20MENARA%20LIAR`;
  const tenantUrl = `https://docs.google.com/spreadsheets/d/1N_LdkoiMjMS012Oa7mieHy0XxZzi_QkOGpl4p5b7PBU/gviz/tq?tqx=out:csv&sheet=EXISTING%20TENANT`;
  const projectUrlUpper = `https://docs.google.com/spreadsheets/d/1N_LdkoiMjMS012Oa7mieHy0XxZzi_QkOGpl4p5b7PBU/gviz/tq?tqx=out:csv&sheet=PROJECT`;
  const projectUrlLower = `https://docs.google.com/spreadsheets/d/1N_LdkoiMjMS012Oa7mieHy0XxZzi_QkOGpl4p5b7PBU/gviz/tq?tqx=out:csv&sheet=project`;

  let liarResponseText = "";
  let tenantResponseText = "";
  let sitacResponseText = "";
  let liarFetchSuccess = false;
  let tenantFetchSuccess = false;
  let sitacFetchSuccess = false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Fetching Menara Liar data (Attempt ${attempt}/3)...`);
      const res = await fetch(liarUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        throw new Error(`HTTP status ${res.status} ${res.statusText}`);
      }
      liarResponseText = await res.text();
      if (liarResponseText && liarResponseText.trim().length > 0) {
        liarFetchSuccess = true;
        break;
      } else {
        throw new Error("Received empty response.");
      }
    } catch (err: any) {
      console.warn(`Menara Liar fetch attempt ${attempt} failed:`, err.message || err);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Fetching Existing Tenant data (Attempt ${attempt}/3)...`);
      const res = await fetch(tenantUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        throw new Error(`HTTP status ${res.status} ${res.statusText}`);
      }
      tenantResponseText = await res.text();
      if (tenantResponseText && tenantResponseText.trim().length > 0) {
        tenantFetchSuccess = true;
        break;
      } else {
        throw new Error("Received empty response.");
      }
    } catch (err: any) {
      console.warn(`Existing Tenant fetch attempt ${attempt} failed:`, err.message || err);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Fetching SITAC Project data (Attempt ${attempt}/3)...`);
      let res = await fetch(projectUrlUpper, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        console.log(`Fetching with uppercase sheet name failed, trying lowercase sheet name...`);
        res = await fetch(projectUrlLower, { signal: AbortSignal.timeout(30000) });
      }
      if (!res.ok) {
        throw new Error(`HTTP status ${res.status} ${res.statusText}`);
      }
      sitacResponseText = await res.text();
      if (sitacResponseText && sitacResponseText.trim().length > 0 && !sitacResponseText.includes("Error")) {
        sitacFetchSuccess = true;
        break;
      } else {
        console.log(`Response invalid, trying lowercase sheet name...`);
        const res2 = await fetch(projectUrlLower, { signal: AbortSignal.timeout(30000) });
        if (res2.ok) {
          sitacResponseText = await res2.text();
          if (sitacResponseText && sitacResponseText.trim().length > 0 && !sitacResponseText.includes("Error")) {
            sitacFetchSuccess = true;
            break;
          }
        }
        throw new Error("Received empty or error response.");
      }
    } catch (err: any) {
      console.warn(`SITAC Project fetch attempt ${attempt} failed:`, err.message || err);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  let liarRows: string[][] = [];
  if (liarFetchSuccess) {
    try {
      liarRows = parseCSV(liarResponseText);
      safeWriteJsonSync(liarCachePath, liarRows, 2);
    } catch (err) {
      console.error("Failed to parse and cache Menara Liar CSV:", err);
    }
  } else {
    const cached = safeReadJsonSync(liarCachePath);
    if (cached) {
      console.log("Reading Menara Liar data from disk cache...");
      liarRows = cached;
    }
  }

  let tenantRows: string[][] = [];
  if (tenantFetchSuccess) {
    try {
      tenantRows = parseCSV(tenantResponseText);
      safeWriteJsonSync(tenantCachePath, tenantRows, 2);
    } catch (err) {
      console.error("Failed to parse and cache Existing Tenant CSV:", err);
    }
  } else {
    const cached = safeReadJsonSync(tenantCachePath);
    if (cached) {
      console.log("Reading Existing Tenant data from disk cache...");
      tenantRows = cached;
    }
  }

  let sitacRows: string[][] = [];
  if (sitacFetchSuccess) {
    try {
      sitacRows = parseCSV(sitacResponseText);
      safeWriteJsonSync(sitacCachePath, sitacRows, 2);
    } catch (err) {
      console.error("Failed to parse and cache SITAC Project CSV:", err);
    }
  } else {
    const cached = safeReadJsonSync(sitacCachePath);
    if (cached) {
      console.log("Reading SITAC Project data from disk cache...");
      sitacRows = cached;
    }
  }

  const parsedLiar = parseMenaraLiarRows(liarRows);
  const parsedTenant = parseExistingTenantRows(tenantRows);
  const parsedSitac = parseProjectRows(sitacRows);

  cachedMenaraData = { liar: parsedLiar, tenant: parsedTenant, sitac: parsedSitac };
  lastMenaraFetchTime = now;
  return cachedMenaraData;
}

function parseProjectRows(rows: string[][]) {
  if (rows.length < 2) return [];
  const rawRows = rows.slice(1);
  const results: any[] = [];

  const parseXY = (xVal: any, yVal: any) => {
    let xStr = String(xVal || "").trim().replace(",", ".");
    let yStr = String(yVal || "").trim().replace(",", ".");
    let x = parseFloat(xStr);
    let y = parseFloat(yStr);
    if (isNaN(x)) x = 0;
    if (isNaN(y)) y = 0;
    
    let lat = 0;
    let lng = 0;
    // In Indonesia, Latitude is negative or small (< 15) and Longitude is around 95-141.
    if (Math.abs(x) < 20) {
      lat = x;
      lng = y;
    } else {
      lat = y;
      lng = x;
    }
    return { lat, lng };
  };

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (row.length < 11) continue;

    const pic = String(row[9] || "").trim().toUpperCase();
    const milestoneBK = String(row[62] || "").trim().toUpperCase();

    // J is index 9 (RF PIC), BK is index 62 (Milestone Status)
    const isAan = pic.includes("AAN") || pic === "AAN";
    // Check Status Plan Akuisisi, IW OG, dan Hunting
    const isMilestone = milestoneBK.includes("AKUISISI") || milestoneBK.includes("PLAN") || milestoneBK.includes("IW OG") || milestoneBK.includes("HUNTING");

    if (isAan && isMilestone) {
      // X is index 23, Y is index 24
      const { lat, lng } = parseXY(row[23], row[24]);
      if (lat === 0 && lng === 0) continue;

      results.push({
        lat: lat,
        lng: lng,
        requestType: row[4] || 'N/A', // Kolom E (Request Type)
        tenant: row[6] || 'N/A', // Kolom G (Tenant)
        siteIdTenant: row[20] || 'N/A', // Kolom U (Site ID Tenant)
        siteNameTenant: row[21] || 'N/A', // Kolom V (Site Name Tenant)
        milestoneK: row[10] || 'N/A', // Kolom K (Milestone Status)
        milestoneBK: row[62] || 'N/A', // Kolom BK
        rfPic: row[9] || 'N/A',
        statusGroup: 'SITAC Process'
      });
    }
  }
  return results;
}

function parseExistingTenantRows(rows: string[][]) {
  if (rows.length < 2) return [];
  const rawRows = rows.slice(1);

  const parseFlexibleCoordinates = (latVal: any, lngVal: any) => {
    if (!latVal || !lngVal) return { lat: 0, lng: 0 };
    
    let latStr = latVal.toString().trim();
    let lngStr = lngVal.toString().trim();
    
    const cleanLat = latStr.replace(/[^0-9.-]/g, "");
    const cleanLng = lngStr.replace(/[^0-9.-]/g, "");
    
    const parsedLat = parseFloat(cleanLat);
    const parsedLng = parseFloat(cleanLng);
    
    let isSwapped = false;
    if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
      if (parsedLat > 50 && parsedLng < 0) {
        isSwapped = true;
      }
    }
    
    if (isSwapped) {
      const temp = latStr;
      latStr = lngStr;
      lngStr = temp;
    }
    
    let finalLat = 0;
    const latDigits = latStr.replace(/[^0-9]/g, "");
    if (latDigits.length > 0) {
      const latSign = latStr.includes("-") ? -1 : -1;
      const numStr = latDigits.charAt(0) + "." + latDigits.slice(1);
      finalLat = parseFloat(numStr) * latSign;
    }
    
    let finalLng = 0;
    const lngDigits = lngStr.replace(/[^0-9]/g, "");
    if (lngDigits.length > 3) {
      const numStr = lngDigits.slice(0, 3) + "." + lngDigits.slice(3);
      finalLng = parseFloat(numStr);
    } else if (lngDigits.length > 0) {
      finalLng = parseFloat(lngDigits);
    }
    
    return { lat: finalLat, lng: finalLng };
  };

  const parseRowCoords = (row: string[]) => {
    let lat = 0;
    let lng = 0;
    
    const longlat = row[4]; // Column E
    if (longlat && longlat.includes(",")) {
      const parts = longlat.split(",");
      lat = parseFloat(parts[0].trim());
      lng = parseFloat(parts[1].trim());
    } else {
      const res = parseFlexibleCoordinates(row[2], row[3]);
      lat = res.lat;
      lng = res.lng;
    }
    
    if (lat > 50 && lng < 0) {
      const temp = lat;
      lat = lng;
      lng = temp;
    }
    
    return { lat, lng };
  };

  const isTenantActive = (val: any) => {
    if (val === undefined || val === null) return false;
    const str = String(val).trim().toUpperCase();
    return str !== '' && str !== '0' && str !== '-' && str !== 'NONE' && str !== 'FALSE';
  };

  const results: any[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const siteId = row[0]; // Column A (Site_ID)
    if (!siteId || siteId.trim() === "") continue;

    const { lat, lng } = parseRowCoords(row);
    const kota = row[11] || 'N/A'; // Column L (City)
    const tipeMenara = row[7] || 'N/A'; // Column H (Tower Type)

    const opText = (row[6] || '').toString().toUpperCase();
    const tselActive = isTenantActive(row[14]) || opText.includes('TSEL') || opText.includes('TELKOMSEL');
    const iohActive = isTenantActive(row[15]) || opText.includes('IOH') || opText.includes('INDOSAT') || opText.includes('ISAT') || opText.includes('H3I') || opText.includes('THREE');
    const xlsActive = isTenantActive(row[16]) || opText.includes('XL') || opText.includes('XLS') || opText.includes('AXIATA') || opText.includes('SMART');

    results.push({
      indexMenara: siteId.trim() + " - " + (row[1] || 'N/A').trim(),
      lat: lat,
      lng: lng,
      kota: kota.trim(),
      kecamatan: 'N/A',
      tipeMenara: tipeMenara.trim(),
      tahunTerbangun: 0,
      siteStatus: 'Others TLP',
      operator: opText,
      tselActive: tselActive,
      iohActive: iohActive,
      xlsActive: xlsActive
    });
  }
  return results;
}

function parseMenaraLiarRows(rows: string[][]) {
  if (rows.length < 2) return [];
  const rawRows = rows.slice(1);
  
  const parseCoordinates = (val: any, isLat: boolean): number => {
    if (val === undefined || val === null || val === "") return 0;
    const str = val.toString().trim().replace(/\s+/g, "");
    let cleaned = str.replace(/[^0-9.,-]/g, "");
    if (!cleaned) return 0;
    
    if (cleaned.indexOf(",") !== -1 && cleaned.indexOf(".") === -1) {
      cleaned = cleaned.replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
    
    const parts = cleaned.split(".");
    if (parts.length > 2) {
      cleaned = parts[0] + "." + parts.slice(1).join("");
    }
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    
    if (Math.abs(num) > 180) {
      const absStr = Math.abs(num).toString();
      const sign = num < 0 ? -1 : 1;
      if (isLat) {
        const newStr = absStr.charAt(0) + "." + absStr.slice(1);
        return parseFloat(newStr) * sign;
      } else {
        if (absStr.length > 3) {
          const newStr = absStr.slice(0, 3) + "." + absStr.slice(3);
          return parseFloat(newStr) * sign;
        }
      }
    }
    return num;
  };

  const isTenantActive = (val: any) => {
    if (val === undefined || val === null) return false;
    const str = String(val).trim().toUpperCase();
    return str !== '' && str !== '0' && str !== '-' && str !== 'NONE' && str !== 'FALSE';
  };

  const results: any[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const indexMenara = row[2]; // Column C
    if (!indexMenara || indexMenara.trim() === "") continue;

    const lat = parseCoordinates(row[3], true); // Column D
    const lng = parseCoordinates(row[4], false); // Column E
    const kota = row[5] || 'N/A'; // Column F
    const kecamatan = row[6] || 'N/A'; // Column G
    const tipeMenara = row[8] || 'N/A'; // Column I
    const tahunTerbangunStr = row[10] || ''; // Column K
    const siteStatus = row[9] || 'N/A'; // Column J - Site Status Actual

    let tahunTerbangun = parseInt(tahunTerbangunStr.replace(/[^0-9]/g, '')) || 0;

    const tenantText = `${row[17] || ''} ${row[21] || ''} ${row[22] || ''}`.toUpperCase();
    const tselActive = isTenantActive(row[97]) || tenantText.includes('TSEL') || tenantText.includes('TELKOMSEL');
    const iohActive = isTenantActive(row[98]) || tenantText.includes('IOH') || tenantText.includes('INDOSAT') || tenantText.includes('ISAT') || tenantText.includes('H3I') || tenantText.includes('THREE');
    const xlsActive = isTenantActive(row[99]) || tenantText.includes('XL') || tenantText.includes('XLS') || tenantText.includes('AXIATA') || tenantText.includes('SMART');

    results.push({
      indexMenara: indexMenara.trim(),
      lat: lat,
      lng: lng,
      kota: kota.trim(),
      kecamatan: kecamatan.trim(),
      tipeMenara: tipeMenara.trim(),
      tahunTerbangun: tahunTerbangun,
      siteStatus: siteStatus.trim(),
      tenant: tenantText,
      tselActive: tselActive,
      iohActive: iohActive,
      xlsActive: xlsActive
    });
  }
  return results;
}

async function processAIQuery(query: string, data: any) {
  try {
    const rows = await getSpreadsheetRows();
    const dashboard = getDashboardData(rows);

    const rowsV2 = await getSpreadsheetRowsV2();
    const rawDriveTestData = getDriveTestV2Data(rowsV2);

    let centralDbRows: string[][] = [];
    let centralDbData: any[] = [];
    try {
      centralDbRows = await getCentralDatabaseRows();
      centralDbData = getCentralDatabaseData(centralDbRows);
    } catch (cdErr) {
      console.warn("Failed to load Central Database for AI Query:", cdErr);
    }

    const driveTestData = rawDriveTestData.map((d: any) => ({
      siteId: d.siteId,
      siteName: d.siteName,
      city: d.city,
      province: d.province,
      cluster: d.cluster || 'N/A',
      pairing: d.pairing || '',
      towerHeight: d.towerHeight || 'N/A',
      towerType: d.towerType || 'N/A',
      jenisTeknologi: d.jenisTeknologi || 'N/A',
      yearDt: d.yearDt || 'N/A',
      statusGroup: d.statusGroup || 'N/A',
      activeTenant: d.activeTenant || 'N/A',
      tselKpi: d.bestServer?.tselKpi || 0,
      iohKpi: d.bestServer?.iohKpi || 0,
      xlsKpi: d.bestServer?.xlsKpi || 0
    }));

    // Group all pairings across driveTestData
    const pairingGroups: Record<string, any[]> = {};
    driveTestData.forEach((d: any) => {
      const pKey = (d.pairing || '').trim();
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
          tselKpi: d.bestServer?.tselKpi ? parseFloat(d.bestServer.tselKpi.toFixed(1)) : 0,
          iohKpi: d.bestServer?.iohKpi ? parseFloat(d.bestServer.iohKpi.toFixed(1)) : 0,
          xlsKpi: d.bestServer?.xlsKpi ? parseFloat(d.bestServer.xlsKpi.toFixed(1)) : 0
        });
      }
    });

    const allPairingsList = Object.keys(pairingGroups).map(pKey => {
      const sitesInPair = pairingGroups[pKey];
      const others = sitesInPair.filter(s => {
        const st = (s.statusGroup || '').toUpperCase();
        return st.includes('OTHERS') || (s.siteId || '').toUpperCase().startsWith('G-');
      });
      const existing = sitesInPair.filter(s => {
        const st = (s.statusGroup || '').toUpperCase();
        return !st.includes('OTHERS') && !(s.siteId || '').toUpperCase().startsWith('G-');
      });
      let distanceMeters = 0;
      if (others.length > 0 && others[0].jarak) {
        distanceMeters = parseInt(others[0].jarak) || 0;
      }
      if (!distanceMeters && sitesInPair.length > 0 && sitesInPair[0].jarak) {
        distanceMeters = parseInt(sitesInPair[0].jarak) || 0;
      }
      return {
        pairingKey: pKey,
        totalSitesInPairing: sitesInPair.length,
        distanceMeters: distanceMeters || 42,
        othersSites: others,
        existingSites: existing,
        allSitesInPairing: sitesInPair
      };
    });

    // Compute Drive Test summaries & Tree Analysis (Good, Medium, Poor)
    const dtSitesCount = driveTestData.length;
    let sumTsel = 0, sumIoh = 0, sumXls = 0;
    let poorSitesCount = 0, mediumSitesCount = 0, goodSitesCount = 0;

    driveTestData.forEach(d => {
      const tK = d.tselKpi || 0;
      const iK = d.iohKpi || 0;
      const xK = d.xlsKpi || 0;
      sumTsel += tK;
      sumIoh += iK;
      sumXls += xK;

      let opCount = 0, opSum = 0;
      if (tK > 0) { opSum += tK; opCount++; }
      if (iK > 0) { opSum += iK; opCount++; }
      if (xK > 0) { opSum += xK; opCount++; }
      const siteAvg = opCount > 0 ? (opSum / opCount) : ((tK + iK + xK) / 3);

      if (siteAvg >= 80) goodSitesCount++;
      else if (siteAvg >= 60) mediumSitesCount++;
      else poorSitesCount++;
    });

    const avgTsel = dtSitesCount > 0 ? sumTsel / dtSitesCount : 0;
    const avgIoh = dtSitesCount > 0 ? sumIoh / dtSitesCount : 0;
    const avgXls = dtSitesCount > 0 ? sumXls / dtSitesCount : 0;

    const kpiTreeAnalysis = {
      goodSites: { count: goodSitesCount, percentage: dtSitesCount > 0 ? parseFloat(((goodSitesCount / dtSitesCount) * 100).toFixed(1)) : 0, description: "KPI >= 80% (Sangat Optimal / Good)" },
      mediumSites: { count: mediumSitesCount, percentage: dtSitesCount > 0 ? parseFloat(((mediumSitesCount / dtSitesCount) * 100).toFixed(1)) : 0, description: "60% <= KPI < 80% (Sedang / Medium)" },
      poorSites: { count: poorSitesCount, percentage: dtSitesCount > 0 ? parseFloat(((poorSitesCount / dtSitesCount) * 100).toFixed(1)) : 0, description: "KPI < 60% (Rendah / Poor / Degraded)" }
    };

    // Get city-specific Drive Test averages
    const dtCities: any = {};
    const dtClusters: any = {};
    driveTestData.forEach(d => {
      if (d.city) {
        const cleanCity = d.city.trim();
        if (!dtCities[cleanCity]) {
          dtCities[cleanCity] = { tsel: 0, ioh: 0, xls: 0, count: 0 };
        }
        dtCities[cleanCity].tsel += d.tselKpi || 0;
        dtCities[cleanCity].ioh += d.iohKpi || 0;
        dtCities[cleanCity].xls += d.xlsKpi || 0;
        dtCities[cleanCity].count += 1;
      }

      if (d.cluster) {
        const cleanCluster = d.cluster.trim();
        if (!dtClusters[cleanCluster]) {
          dtClusters[cleanCluster] = { tsel: 0, ioh: 0, xls: 0, count: 0 };
        }
        dtClusters[cleanCluster].tsel += d.tselKpi || 0;
        dtClusters[cleanCluster].ioh += d.iohKpi || 0;
        dtClusters[cleanCluster].xls += d.xlsKpi || 0;
        dtClusters[cleanCluster].count += 1;
      }
    });

    const dtCityAverages = Object.keys(dtCities).map(city => {
      const c = dtCities[city];
      return {
        city: city,
        avgTselKPI: parseFloat((c.tsel / c.count).toFixed(2)),
        avgIohKPI: parseFloat((c.ioh / c.count).toFixed(2)),
        avgXlsKPI: parseFloat((c.xls / c.count).toFixed(2)),
        sitesCount: c.count
      };
    });

    const dtClusterAverages = Object.keys(dtClusters).map(cluster => {
      const c = dtClusters[cluster];
      return {
        cluster: cluster,
        avgTselKPI: parseFloat((c.tsel / c.count).toFixed(2)),
        avgIohKPI: parseFloat((c.ioh / c.count).toFixed(2)),
        avgXlsKPI: parseFloat((c.xls / c.count).toFixed(2)),
        sitesCount: c.count
      };
    });

    // Extract degraded sites (KPI < 75% for any operator)
    const degradedSites = driveTestData
      .filter(d => (d.tselKpi > 0 && d.tselKpi < 75) || (d.iohKpi > 0 && d.iohKpi < 75) || (d.xlsKpi > 0 && d.xlsKpi < 75))
      .slice(0, 10)
      .map(d => ({
        siteId: d.siteId,
        siteName: d.siteName,
        city: d.city,
        cluster: d.cluster,
        towerHeight: d.towerHeight,
        towerType: d.towerType,
        tselKpi: d.tselKpi,
        iohKpi: d.iohKpi,
        xlsKpi: d.xlsKpi
      }));

    // DYNAMIC ENRICHMENT based on user query keywords to give Gemini access to exact granular datasets
    const uniqueCitiesInDataset: string[] = [];
    if (dashboard.tenantRatio) {
      dashboard.tenantRatio.forEach((r: any) => {
        if (r.city && !uniqueCitiesInDataset.includes(r.city)) {
          uniqueCitiesInDataset.push(r.city);
        }
      });
    }
    driveTestData.forEach((d: any) => {
      if (d.city && !uniqueCitiesInDataset.includes(d.city)) uniqueCitiesInDataset.push(d.city);
    });
    centralDbData.forEach((s: any) => {
      if (s.city && !uniqueCitiesInDataset.includes(s.city)) uniqueCitiesInDataset.push(s.city);
    });

    const lowerQuery = query.toLowerCase();
    let foundCities: string[] = [];
    uniqueCitiesInDataset.forEach(city => {
      const lowerCity = city.toLowerCase();
      const cleanCity = lowerCity.replace(/kota|kab\.|kabupaten/g, '').trim();
      if (!cleanCity) return;
      const parts = cleanCity.split(/\s+/);
      let match = parts.some(part => part.length >= 3 && lowerQuery.includes(part));
      if (lowerCity.includes("surakarta") && lowerQuery.includes("solo")) {
        match = true;
      }
      if (match) {
        foundCities.push(lowerCity);
        foundCities.push(cleanCity);
      }
    });

    const queryWords = lowerQuery.split(/[\s,\.\?\!\-\(\)]+/);
    const siteIdCandidates = queryWords.filter(w => w.length >= 4 && /[a-z]/i.test(w) && /[0-9]/.test(w));

    // Check matching clusters in query (e.g. "PIK 2026", "Surakarta 2026", "PIK", "Cirebon", "Badung", "Regular")
    const allClusterNames = Object.keys(dtClusters);
    const matchingClusterNames = allClusterNames.filter(cName => {
      const cLower = cName.toLowerCase();
      if (lowerQuery.includes(cLower)) return true;
      const keywords = cLower.split(/\s+/).filter(w => w.length >= 3 && !['collo', '2024', '2025', '2026', 'regular'].includes(w));
      return keywords.some(kw => lowerQuery.includes(kw));
    });

    let matchedClusterDriveSites: any[] = [];
    if (matchingClusterNames.length > 0) {
      matchedClusterDriveSites = driveTestData.filter(d => {
        const dCluster = (d.cluster || '').trim().toLowerCase();
        return matchingClusterNames.some(mName => dCluster.includes(mName.toLowerCase()) || mName.toLowerCase().includes(dCluster));
      });
    }

    // Determine relevant Central Database sites based on query context
    let queriedCentralDbSites: any[] = [];
    if (matchingClusterNames.length > 0) {
      const clusterKeywords = matchingClusterNames.map(m => m.toLowerCase().replace(/2024|2025|2026|collo|regular/g, '').trim()).filter(Boolean);
      queriedCentralDbSites = centralDbData.filter(d => {
        const dStr = `${d.siteId} ${d.siteName} ${d.city} ${d.landAsset} ${d.address}`.toLowerCase();
        return clusterKeywords.some(kw => dStr.includes(kw));
      });
    }
    if (queriedCentralDbSites.length === 0 && foundCities.length > 0) {
      queriedCentralDbSites = centralDbData.filter(d => {
        const dCity = (d.city || '').toLowerCase();
        return foundCities.some(fc => dCity.includes(fc) || fc.includes(dCity.replace(/kota|kab\.|kabupaten/g, '').trim()));
      });
    } else if (queriedCentralDbSites.length === 0 && siteIdCandidates.length > 0) {
      queriedCentralDbSites = centralDbData.filter(d => {
        const sId = (d.siteId || '').toLowerCase();
        return siteIdCandidates.some(candidate => sId.includes(candidate));
      });
    } else if (queriedCentralDbSites.length === 0) {
      queriedCentralDbSites = centralDbData.slice(0, 30);
    }
    queriedCentralDbSites = queriedCentralDbSites.slice(0, 50);

    const filteredCentralDbSites = queriedCentralDbSites.map(s => ({
      siteId: s.siteId,
      idOracle: s.idOracle,
      siteName: s.siteName,
      city: s.city,
      statusGroup: s.statusGroup,
      siteType: s.siteType,
      towerType: s.towerType,
      towerHeight: s.towerHeight,
      landAsset: s.landAsset,
      morphoclass: s.morphoclass,
      activeTenant: s.activeTenant,
      pksExpired: s.pksExpired,
      sisaWaktu: s.sisaWaktu,
      txInfo: s.txInfo,
      fiveTenants: s.fiveTenants,
      groupedTenants: {
        TSEL: s.tselActive,
        IOH_Combined: s.iohActive,
        XLS_Combined: s.xlsActive
      },
      tselBw: s.tselBw,
      iohBw: s.iohBw,
      xlBw: s.xlBw,
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
    }));

    // Determine relevant Drive Test sites based on query context
    const isPairingOrColloQuery = /pairing|collo|dismantle|skenario|potensi|badung|pasangan|grouping|cluster/i.test(lowerQuery);

    let queriedDriveTestSites: any[] = [];
    if (isPairingOrColloQuery) {
      queriedDriveTestSites = driveTestData; // Include ALL drive test sites & ALL ~30+ pairings!
    } else if (matchedClusterDriveSites.length > 0) {
      queriedDriveTestSites = matchedClusterDriveSites;
    } else if (foundCities.length > 0) {
      queriedDriveTestSites = driveTestData.filter(d => {
        const dCity = (d.city || '').toLowerCase();
        const dCluster = (d.cluster || '').toLowerCase();
        return foundCities.some(fc => dCity.includes(fc) || fc.includes(dCity.replace(/kota|kab\.|kabupaten/g, '').trim()) || dCluster.includes(fc));
      });
    } else {
      queriedDriveTestSites = driveTestData;
    }

    // Deduplicate sites by ID
    queriedDriveTestSites = queriedDriveTestSites.filter((v, i, a) => a.findIndex(t => t.siteId === v.siteId) === i);

    // Check if query is asking for N list / top N / bottom N / specific list of sites
    const listCountMatch = lowerQuery.match(/(\d+)\s*(list|site|situs|daftar|terendah|tertinggi|top|bottom)/i) || lowerQuery.match(/(list|daftar|situs|site)\s*(\d+)/i);
    let requestedListCount = 0;
    if (listCountMatch) {
      const numStr = listCountMatch[1] && !isNaN(parseInt(listCountMatch[1])) ? listCountMatch[1] : (listCountMatch[2] && !isNaN(parseInt(listCountMatch[2])) ? listCountMatch[2] : '0');
      requestedListCount = parseInt(numStr, 10);
    }
    if (requestedListCount === 0 && /terendah|rendah|tertinggi|top|bottom|kpi|kritis|degradasi|peringkat/i.test(lowerQuery)) {
      requestedListCount = 10;
    }
    if (requestedListCount > 100) requestedListCount = 100;

    let topRequestedSites: any[] = [];
    if (requestedListCount > 0) {
      // Find candidate sites matching city/cluster/year filter if mentioned
      let pool = driveTestData;
      if (foundCities.length > 0) {
        const cityPool = pool.filter(d => {
          const dCity = (d.city || '').toLowerCase();
          const dCluster = (d.cluster || '').toLowerCase();
          return foundCities.some(fc => dCity.includes(fc) || fc.includes(dCity.replace(/kota|kab\.|kabupaten/g, '').trim()) || dCluster.includes(fc));
        });
        if (cityPool.length > 0) pool = cityPool;
      }

      // Check for direct city or cluster matches in query
      if (pool.length === driveTestData.length) {
        const directMatches = driveTestData.filter(d => {
          const dCity = (d.city || '').toLowerCase().replace(/kota|kab\.|kabupaten/g, '').trim();
          const dCluster = (d.cluster || '').toLowerCase();
          return (dCity && dCity.length >= 3 && lowerQuery.includes(dCity)) || (dCluster && dCluster.length >= 3 && lowerQuery.includes(dCluster));
        });
        if (directMatches.length > 0) pool = directMatches;
      }

      // Check for cluster filter in query e.g. "reguler", "regular", "collo"
      if (/reguler|regular/i.test(lowerQuery)) {
        const regPool = pool.filter(d => /reguler|regular/i.test(d.cluster || ''));
        if (regPool.length > 0) pool = regPool;
      } else if (/collo/i.test(lowerQuery)) {
        const colloPool = pool.filter(d => /collo/i.test(d.cluster || ''));
        if (colloPool.length > 0) pool = colloPool;
      }

      // Check for year filter in query e.g. "2025" or "2026"
      const yearMatch = lowerQuery.match(/\b(202\d)\b/);
      if (yearMatch) {
        const yearVal = yearMatch[1];
        const yearFiltered = pool.filter(d => String(d.yearDt).includes(yearVal) || String(d.cluster || '').includes(yearVal));
        if (yearFiltered.length > 0) {
          pool = yearFiltered;
        }
      }

      // Detect specific operator mentioned in query
      const isIoh = /ioh|indosat|h3i|tri\b/i.test(lowerQuery);
      const isTsel = /tsel|telkomsel/i.test(lowerQuery);
      const isXls = /xls|xl|smartfren|sf\b/i.test(lowerQuery);
      const isPoorOnly = /poor|degradasi|kritis/i.test(lowerQuery);
      const isGoodOnly = /good|bagus|optimal/i.test(lowerQuery);
      const isMedOnly = /medium|sedang/i.test(lowerQuery);

      if (isIoh && isPoorOnly) {
        const iohPoorPool = pool.filter(d => (d.iohKpi || 0) < 60 && (d.iohKpi || 0) > 0);
        if (iohPoorPool.length > 0) pool = iohPoorPool;
      } else if (isTsel && isPoorOnly) {
        const tselPoorPool = pool.filter(d => (d.tselKpi || 0) < 60 && (d.tselKpi || 0) > 0);
        if (tselPoorPool.length > 0) pool = tselPoorPool;
      } else if (isXls && isPoorOnly) {
        const xlsPoorPool = pool.filter(d => (d.xlsKpi || 0) < 60 && (d.xlsKpi || 0) > 0);
        if (xlsPoorPool.length > 0) pool = xlsPoorPool;
      } else if (isPoorOnly) {
        const poorPool = pool.filter(d => {
          const tK = d.tselKpi || 0;
          const iK = d.iohKpi || 0;
          const xK = d.xlsKpi || 0;
          const avg = (tK + iK + xK) / 3;
          return avg < 60;
        });
        if (poorPool.length > 0) pool = poorPool;
      }

      // Compute average KPI across operators
      const poolWithAvg = pool.map(d => {
        const tK = d.tselKpi || 0;
        const iK = d.iohKpi || 0;
        const xK = d.xlsKpi || 0;
        let countOp = 0;
        let sumOp = 0;
        if (tK > 0) { sumOp += tK; countOp++; }
        if (iK > 0) { sumOp += iK; countOp++; }
        if (xK > 0) { sumOp += xK; countOp++; }
        const avg = countOp > 0 ? (sumOp / countOp) : ((tK + iK + xK) / 3);
        let kpiCat = 'Poor';
        if (avg >= 80) kpiCat = 'Good';
        else if (avg >= 60) kpiCat = 'Medium';

        return {
          siteId: d.siteId,
          siteName: d.siteName,
          cluster: d.cluster || 'N/A',
          city: d.city,
          yearDt: d.yearDt || (yearMatch ? yearMatch[1] : '2025'),
          statusGroup: d.statusGroup || 'EXISTING',
          activeTenant: d.activeTenant || 'TSEL, IOH, XLS',
          tselKpi: parseFloat(tK.toFixed(1)),
          iohKpi: parseFloat(iK.toFixed(1)),
          xlsKpi: parseFloat(xK.toFixed(1)),
          avgKpi: parseFloat(avg.toFixed(2)),
          kpiCategory: kpiCat
        };
      });

      const isLowest = /terendah|rendah|degradasi|buruk|poor|bottom|kritis/i.test(lowerQuery);
      if (isLowest) {
        if (isIoh) poolWithAvg.sort((a, b) => a.iohKpi - b.iohKpi);
        else if (isTsel) poolWithAvg.sort((a, b) => a.tselKpi - b.tselKpi);
        else if (isXls) poolWithAvg.sort((a, b) => a.xlsKpi - b.xlsKpi);
        else poolWithAvg.sort((a, b) => a.avgKpi - b.avgKpi);
      } else {
        if (isIoh) poolWithAvg.sort((a, b) => b.iohKpi - a.iohKpi);
        else if (isTsel) poolWithAvg.sort((a, b) => b.tselKpi - a.tselKpi);
        else if (isXls) poolWithAvg.sort((a, b) => b.xlsKpi - a.xlsKpi);
        else poolWithAvg.sort((a, b) => b.avgKpi - a.avgKpi);
      }

      topRequestedSites = poolWithAvg.slice(0, requestedListCount);
    }

    // Map to include latest fields
    const filteredDriveTestSites = queriedDriveTestSites.slice(0, 150).map(d => ({
      siteId: d.siteId,
      siteName: d.siteName,
      city: d.city,
      cluster: d.cluster,
      pairing: d.pairing || '',
      towerHeight: d.towerHeight,
      towerType: d.towerType,
      jenisTeknologi: d.jenisTeknologi,
      yearDt: d.yearDt,
      statusGroup: d.statusGroup,
      activeTenant: d.activeTenant,
      tselKpi: d.tselKpi ? parseFloat(d.tselKpi.toFixed(1)) : 0,
      iohKpi: d.iohKpi ? parseFloat(d.iohKpi.toFixed(1)) : 0,
      xlsKpi: d.xlsKpi ? parseFloat(d.xlsKpi.toFixed(1)) : 0
    }));

    // Filter EWS alerts dynamically for selected cities if any, or provide the first 25
    let queriedEwsAlerts = dashboard.komersial.ews || [];
    if (foundCities.length > 0) {
      queriedEwsAlerts = queriedEwsAlerts.filter((e: any) => {
        const eCity = (e.city || '').toLowerCase();
        return foundCities.some(fc => eCity.includes(fc));
      });
    } else {
      queriedEwsAlerts = queriedEwsAlerts.slice(0, 25);
    }

    const filteredEwsAlerts = queriedEwsAlerts.map((e: any) => ({
      id: e.id,
      name: e.name,
      city: e.city,
      rental: e.rental,
      tenggat: e.tenggat,
      action: e.action
    }));

    // DYNAMIC ENRICHMENT FOR COMMERCIAL SITELIST (detailedSites)
    // Note: Excluding Tower Classification, Cost MCP, Cost FO/ISR, Revenue, InActive Tenant, InActive Tenant Number as requested.
    let queriedKomersialSites: any[] = [];
    const allDetailedSites = dashboard.detailedSites || [];
    
    if (siteIdCandidates.length > 0) {
      queriedKomersialSites = allDetailedSites.filter((s: any) => {
        const sId = (s.id || '').toLowerCase();
        return siteIdCandidates.some(candidate => sId.includes(candidate));
      });
    }
    
    if (queriedKomersialSites.length < 50 && foundCities.length > 0) {
      const citySites = allDetailedSites.filter((s: any) => {
        const sCity = (s.city || '').toLowerCase();
        return foundCities.some(fc => sCity.includes(fc));
      });
      queriedKomersialSites = [...queriedKomersialSites, ...citySites];
    }
    
    const isKomersialQuery = /sewa|rental|nilai|harga|komersial|komersil|kontrak|asuransi|jaminan|penjaminan|list|sitelist|daftar|7000|banyak/i.test(lowerQuery);
    if (queriedKomersialSites.length === 0 && isKomersialQuery) {
      const sortedByRental = [...allDetailedSites].sort((a, b) => (b.rental || 0) - (a.rental || 0));
      queriedKomersialSites = [...sortedByRental.slice(0, 35), ...allDetailedSites.slice(100, 115)];
    } else if (queriedKomersialSites.length === 0) {
      queriedKomersialSites = allDetailedSites.slice(0, 15);
    }
    
    queriedKomersialSites = queriedKomersialSites.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
    queriedKomersialSites = queriedKomersialSites.slice(0, 60);
    
    // Explicitly exclude: Tower Classification, Cost MCP, Cost FO/ISR, Revenue, InActive Tenant, InActive Tenant Number
    const filteredKomersialSites = queriedKomersialSites.map((s: any) => ({
      id: s.id,
      name: s.name,
      city: s.city,
      statusGroup: s.statusGroup,
      activeTenant: s.activeTenant,
      tenants: s.tenants,
      rental: s.rental,
      statusPen: s.statusPen,
      penEnd: s.penEnd,
      asuransi: s.asuransi,
      towerHeight: s.towerHeight,
      towerType: s.towerType,
      landAsset: s.landAsset,
      morphoclass: s.morphoclass,
      pksExpired: s.pksExpired,
      sisaWaktu: s.sisaWaktu
    }));

    // Build overall Central Database Equipment Aggregations across ALL sites
    const overallCentralDbEquipment = centralDbData.reduce((acc: any, s: any) => {
      const tselAnt = s.equipmentDetails?.TSEL?.antenna || 0;
      const tselAau = s.equipmentDetails?.TSEL?.aau || 0;
      const tselRru = s.equipmentDetails?.TSEL?.rru || 0;
      const tselShooter = s.equipmentDetails?.TSEL?.shooter || 0;

      const iohAnt = s.equipmentDetails?.IOH_Combined_IOH_H3I?.antenna || 0;
      const iohAau = s.equipmentDetails?.IOH_Combined_IOH_H3I?.aau || 0;
      const iohRru = s.equipmentDetails?.IOH_Combined_IOH_H3I?.rru || 0;
      const iohShooter = s.equipmentDetails?.IOH_Combined_IOH_H3I?.shooter || 0;

      const xlsAnt = s.equipmentDetails?.XLS_Combined_XL_SF?.antenna || 0;
      const xlsAau = s.equipmentDetails?.XLS_Combined_XL_SF?.aau || 0;
      const xlsRru = s.equipmentDetails?.XLS_Combined_XL_SF?.rru || 0;
      const xlsShooter = s.equipmentDetails?.XLS_Combined_XL_SF?.shooter || 0;

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

      if (s.fiveTenants?.TSEL) acc.countTselSite++;
      if (s.fiveTenants?.IOH) acc.countIohSite++;
      if (s.fiveTenants?.H3I) acc.countH3iSite++;
      if (s.fiveTenants?.XL) acc.countXlSite++;
      if (s.fiveTenants?.SF) acc.countSfSite++;

      return acc;
    }, {
      tselAntenna: 0, tselAau: 0, tselRru: 0, tselShooter: 0,
      iohAntenna: 0, iohAau: 0, iohRru: 0, iohShooter: 0,
      xlsAntenna: 0, xlsAau: 0, xlsRru: 0, xlsShooter: 0,
      countTselSite: 0, countIohSite: 0, countH3iSite: 0, countXlSite: 0, countSfSite: 0
    });

    // Build complete unified context summary of ALL databases
    const contextSummary = {
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
      },
      sitelistKomersil: {
        totalRental: Object.values(dashboard.komersial.rentalProvinsi).reduce((a: any, b: any) => a + b, 0),
        rentalProvinsi: dashboard.komersial.rentalProvinsi,
        penjaminan: dashboard.komersial.penjaminan,
        asuransi: dashboard.komersial.asuransi,
        ewsCount: dashboard.komersial.ews?.length || 0,
        ewsAlerts: filteredEwsAlerts,
        detailsExcludingSensitiveCostAndInactive: filteredKomersialSites
      },
      sitesSummary: {
        totalSites: dashboard.summary.totalSite,
        statusGroups: dashboard.summary.statusGroups,
        towerType: dashboard.summary.towerType,
        towerHeight: dashboard.summary.towerHeight,
        landAsset: dashboard.summary.landAsset,
        tenantActive: dashboard.summary.tenantActive
      },
      tenantRatio: dashboard.tenantRatio
        .filter((r: any) => {
          if (foundCities.length === 0) return true;
          const rCity = (r.city || '').toLowerCase();
          return foundCities.some(fc => rCity.includes(fc));
        })
        .map((r: any) => ({
          city: r.city,
          totalSite: r.totalSite,
          totalTenant: r.totalTenant,
          ratio: r.ratio,
          status: r.status,
          keterangan: r.keterangan
        })),
      potential: dashboard.potential
        .filter((p: any) => {
          if (foundCities.length === 0) return true;
          const pCity = (p.city || '').toLowerCase();
          return foundCities.some(fc => pCity.includes(fc));
        })
        .map((p: any) => ({
          city: p.city,
          pScore: p.pScore,
          pStatus: p.pStatus,
          aScore: p.aScore,
          aStatus: p.aStatus
        })),
      driveTestServiceLevelBase: {
        totalSitesMeasured: dtSitesCount,
        kpiTreeAnalysis: kpiTreeAnalysis,
        totalPairingsCount: allPairingsList.length,
        allPairingsSummary: allPairingsList,
        clusterAveragesAndRankings: dtClusterAverages,
        overallAverages: {
          TSEL: parseFloat(avgTsel.toFixed(2)),
          IOH: parseFloat(avgIoh.toFixed(2)),
          XLS: parseFloat(avgXls.toFixed(2))
        },
        cityAverages: dtCityAverages.filter((c: any) => {
          if (foundCities.length === 0) return true;
          const cCity = (c.city || '').toLowerCase();
          return foundCities.some(fc => cCity.includes(fc));
        }),
        degradedSitesSample: degradedSites,
        topRequestedSites: topRequestedSites,
        relevantDriveTestSites: filteredDriveTestSites
      }
    };

    let apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      apiKey = getGeminiApiKeyFromCodeGs() || undefined;
    }

    if (!apiKey) {
      return `<div class="alert alert-warning border-warning shadow-sm" style="border-radius: 12px; background-color: #fffbeb;">
                <h6 class="fw-bold text-amber-800 mb-2" style="font-size:14px;"><i class="fa-solid fa-key me-2 text-amber-500"></i> API Key Belum Dikonfigurasi</h6>
                <p class="mb-3 text-amber-700" style="font-size: 13px; line-height: 1.5;">
                  Kunci API Gemini (<code>GEMINI_API_KEY</code>) belum diatur di sistem, file environment, atau file <code>code.gs</code> Anda.
                </p>
                <div class="bg-white p-3 rounded border border-amber-200" style="font-size: 12.5px; color: #475569;">
                  <strong>Cara mengonfigurasi di code.gs Anda:</strong>
                  <p class="mb-2 text-secondary">Anda dapat menuliskan kunci API Anda langsung di baris ke-4 file <code>code.gs</code> seperti ini:</p>
                  <pre class="bg-light p-2 rounded border m-0" style="font-size:11px;">const GEMINI_API_KEY = "MASUKKAN_KUNCI_API_ANDA";</pre>
                  <hr class="my-2" />
                  <strong>Cara mengonfigurasi di AI Studio:</strong>
                  <ol class="m-0 mt-1.5 ps-3 text-secondary space-y-1">
                    <li>Klik tombol <strong>Settings</strong> (ikon gir) di AI Studio.</li>
                    <li>Pilih tab <strong>Secrets / Environment Variables</strong>.</li>
                    <li>Tambahkan rahasia baru dengan nama <code>GEMINI_API_KEY</code> dan isikan kunci API Anda.</li>
                  </ol>
                </div>
              </div>`;
    }

    // Attempt to use the key. We don't hard block here anymore so you can use any valid custom gateway/keys,
    // but we log a helpful warning if the format looks unusual.
    if (apiKey && !apiKey.startsWith("AIzaSy")) {
      console.warn("Warning: GEMINI_API_KEY does not start with typical prefix 'AIzaSy'. Continuing API call anyway...");
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const prompt = `Anda adalah asisten data pintar dan RF/Telecommunication Engineering Advisor yang menguasai analisis data dashboard Telco terintegrasi.
Tugas Anda adalah menganalisis data terpadu dari 3 basis data utama (ditambah data pendukung Fiber Optic & Menara):
1. "Central Database" (data master teknis, ID Oracle, spesifikasi antenna/AAU/RRU/shooter, bandwidth, status PKS, active tenant).
2. "Service Level Base" (data Drive Test KPI Sinyal Telco TSEL/IOH/XLS, Coverage Prediction/CP, cluster, tinggi menara, tipe menara, jenis teknologi, tahun DT 2024/2025/2026, pairing group collocation/dismantle, serta Tree Analysis KPI: Good, Medium, Poor).
3. "Sitelist Komersil" (data nilai rental, penjaminan, asuransi, sisa waktu sewa, EWS alert, Tenant Ratio, dan Potential Score).
4. "FO Database" & "Menara Liar" (data rute fiber optic, core, dan status perizinan).

Berikut adalah ringkasan data terpadu yang tersedia pada sistem:
${JSON.stringify(contextSummary, null, 2)}

Pertanyaan pengguna: "${query}"

PANDUAN LENGKAP PENULISAN & FORMAT:
1. Ringkasan Eksekutif di bagian atas jawaban:
   Gunakan callout container:
   <div class='p-3 mb-3 border-start border-4 border-indigo bg-light rounded shadow-xs' style='border-radius:8px;'>
     <h6 class='fw-bold text-indigo mb-1.5'><i class='fa-solid fa-circle-check me-1.5'></i> Ringkasan Utama & Jawaban Inti:</h6>
     <p class='mb-0 text-dark' style='font-size:13px; line-height:1.6;'>
       ... [Jawaban langsung, angka kunci/persentase penting di-<strong>BOLD</strong>, dan sertakan badge kategori/status] ...
     </p>
   </div>

2. FORMAT TABEL KETIKA DIMINTA DAFTAR SITE (SANGAT PENTING - WAJIB LENGKAP TANPA TERPOTONG):
   - Apabila pertanyaan meminta daftar N site (misalnya '10 list', '10 site KPI poor', 'daftar site', 'site terendah'), baca data dari 'topRequestedSites' atau dataset terkait dan WAJIB tampilkan SELURUH baris data secara utuh dan lengkap dari nomor 1 sampai selesai (semua baris terisi)!
   - Jangan pernah berhenti di tengah jalan atau memotong baris tabel.
   - Format tabel Bootstrap yang rapi:
     <div class='table-responsive my-2'>
       <table class='table table-sm table-striped table-bordered align-middle' style='font-size:12px;'>
         <thead class='table-dark'>
           <tr>
             <th style='width:40px;' class='text-center'>No</th>
             <th>Site ID</th>
             <th>Nama Site</th>
             <th>Cluster / Kota</th>
             <th class='text-center'>TSEL (%)</th>
             <th class='text-center'>IOH (%)</th>
             <th class='text-center'>XLS (%)</th>
             <th class='text-center'>Avg KPI (%)</th>
             <th class='text-center'>Status</th>
           </tr>
         </thead>
         <tbody>
           <!-- Tuliskan seluruh baris data di sini secara lengkap satu per satu sampai nomor terakhir -->
         </tbody>
       </table>
     </div>

3. ATURAN PENILAIAN & PERANGKAT CENTRAL DATABASE:
   - Terdapat 5 operator individual: TSEL, IOH, H3I, XL, SF (Smartfren).
   - Tenant Grouping: TSEL, IOH (IOH + H3I), XLS (XL + SF).
   - Total perangkat teknis diambil langsung dari 'overallEquipmentTotalsAcrossALLSites'.

4. Selalu pastikan tag HTML tertutup sempurna.`;

    const candidateModels = ["gemini-3.7-flash", "gemini-flash-latest", "gemini-2.5-flash"];
    let response: any = null;
    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                narasi_html: {
                  type: Type.STRING,
                  description: "HTML narasi analisis lengkap dengan callout, tabel data lengkap tanpa terpotong, badge, dan teks tebal"
                },
                chart_title: {
                  type: Type.STRING,
                  description: "Judul singkat untuk grafik visualisasi"
                },
                chart_type: {
                  type: Type.STRING,
                  description: "Tipe grafik: bar, line, pie, atau doughnut"
                },
                chart_label: {
                  type: Type.STRING,
                  description: "Nama label dataset pada grafik"
                },
                data_chart: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      value: { type: Type.NUMBER }
                    },
                    required: ["label", "value"]
                  },
                  description: "Daftar data untuk grafik chart visualisasi"
                }
              },
              required: ["narasi_html", "chart_title", "chart_type", "chart_label", "data_chart"]
            },
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        });
        if (response && response.text) {
          break;
        }
      } catch (e: any) {
        lastError = e;
        console.warn(`Attempt with model ${modelName} failed:`, e?.message || e);
        if (String(e).includes('429')) {
          await new Promise(r => setTimeout(r, 1200));
        }
      }
    }

    if (!response && lastError) {
      throw lastError;
    }

    const rawResponseText = response?.text || "";
    const aiObj = repairAndParseGeminiJson(rawResponseText);

    return `<div class="ai-narasi-container">${aiObj.narasi_html || '<p>Hasil analisis tersedia.</p>'}</div>
            <script type="application/json" id="ai-chart-json">${JSON.stringify(aiObj.data_chart || [])}</script>
            <div id="ai-chart-meta" data-type="${aiObj.chart_type || 'bar'}" data-title="${aiObj.chart_title || 'Visualisasi Hasil'}" data-label="${aiObj.chart_label || 'Nilai'}"></div>`;

  } catch (err: any) {
    console.error("Gemini AI error:", err);
    let errMsg = err.message || String(err);
    if (errMsg.includes('429') || errMsg.includes('quota')) {
      errMsg = "Batas kuota/rate limit API Gemini sementara tercapai. Silakan tunggu beberapa detik dan coba kembali query Anda.";
    }
    return `<div class="alert alert-danger">
              <h6 class="fw-bold"><i class="fa-solid fa-triangle-exclamation me-1"></i> Terjadi kesalahan sistem AI</h6>
              <p class="m-0" style="font-size: 13px;">${errMsg}</p>
            </div>`;
  }
}

function repairHtmlTags(html: string): string {
  if (!html) return html;
  let str = html.trim();

  const selfClosing = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack: string[] = [];
  const tagRegex = /<\/?([a-zA-Z0-9]+)(?:\s+[^>]*?)?(\/?)>/g;
  let match;

  while ((match = tagRegex.exec(str)) !== null) {
    const isClosing = match[0].startsWith('</');
    const tagName = match[1].toLowerCase();
    const isSelfClosing = match[2] === '/' || selfClosing.has(tagName);

    if (isSelfClosing) continue;

    if (!isClosing) {
      stack.push(tagName);
    } else {
      const idx = stack.lastIndexOf(tagName);
      if (idx !== -1) {
        stack.splice(idx, stack.length - idx);
      }
    }
  }

  // Close remaining tags in reverse order
  while (stack.length > 0) {
    const unclosed = stack.pop();
    if (unclosed) {
      str += `</${unclosed}>`;
    }
  }

  return str;
}

function repairAndParseGeminiJson(rawResponseText: string): any {
  if (!rawResponseText) {
    return {
      narasi_html: "<p>Tidak ada respon yang dihasilkan dari model AI.</p>",
      chart_title: "Visualisasi Hasil",
      chart_type: "bar",
      chart_label: "Nilai",
      data_chart: []
    };
  }

  const cleaned = rawResponseText.replace(/```json/gi, "").replace(/```/gi, "").trim();

  // Step 1: Direct JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.narasi_html === 'string') {
      return {
        ...parsed,
        narasi_html: repairHtmlTags(parsed.narasi_html)
      };
    }
  } catch (e) {}

  // Step 2: Try substring between first '{' and last '}'
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const extracted = cleaned.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(extracted);
      if (parsed && typeof parsed.narasi_html === 'string') {
        return {
          ...parsed,
          narasi_html: repairHtmlTags(parsed.narasi_html)
        };
      }
    } catch (e) {}
  }

  // Step 3: Robust field-by-field extraction
  let chartTitle = "Visualisasi Analisis AI";
  let chartType = "bar";
  let chartLabel = "Nilai";
  let dataChart: any[] = [];

  const titleMatch = cleaned.match(/"chart_title"\s*:\s*"([^"]+)"/);
  if (titleMatch) chartTitle = titleMatch[1];

  const typeMatch = cleaned.match(/"chart_type"\s*:\s*"([^"]+)"/);
  if (typeMatch) chartType = typeMatch[1];

  const labelMatch = cleaned.match(/"chart_label"\s*:\s*"([^"]+)"/);
  if (labelMatch) chartLabel = labelMatch[1];

  const dataChartMatch = cleaned.match(/"data_chart"\s*:\s*(\[[^\]]*\])/);
  if (dataChartMatch) {
    try {
      dataChart = JSON.parse(dataChartMatch[1]);
    } catch (e) {}
  }

  // Extract narasi_html: take everything from "narasi_html": " up to the next top-level key or end of JSON
  let narasiHtml = "";
  const narasiStartMatch = cleaned.match(/"narasi_html"\s*:\s*"/);
  if (narasiStartMatch && narasiStartMatch.index !== undefined) {
    const startIndex = narasiStartMatch.index + narasiStartMatch[0].length;
    const tailMatch = cleaned.substring(startIndex).match(/"\s*,\s*"(?:chart_title|chart_type|chart_label|data_chart)"/);
    let rawNarasi = "";
    if (tailMatch && tailMatch.index !== undefined) {
      rawNarasi = cleaned.substring(startIndex, startIndex + tailMatch.index);
    } else {
      const lastQuote = cleaned.lastIndexOf('"');
      if (lastQuote > startIndex) {
        rawNarasi = cleaned.substring(startIndex, lastQuote);
      } else {
        rawNarasi = cleaned.substring(startIndex);
      }
    }

    narasiHtml = rawNarasi
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }

  if (!narasiHtml) {
    narasiHtml = cleaned;
  }

  return {
    narasi_html: repairHtmlTags(narasiHtml) || `<p>${rawResponseText}</p>`,
    chart_title: chartTitle,
    chart_type: chartType,
    chart_label: chartLabel,
    data_chart: dataChart
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // API Endpoints
  app.post("/api/getDashboardData", async (req, res) => {
    try {
      const filters = req.body.filters || {};
      const rows = await getSpreadsheetRows();
      const data = getDashboardData(rows, filters);

      // No longer including SITAC Process data as requested.
      res.json(data);
    } catch (err: any) {
      console.error("Error in getDashboardData:", err);
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/getDriveTestV2Data", async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === "true";
      if (forceRefresh) {
        lastFetchTimeV2 = 0;
        cachedRowsV2 = null;
      }
      const rows = await getSpreadsheetRowsV2();
      const data = getDriveTestV2Data(rows);
      
      try {
        const komersilRows = await getSpreadsheetRows();
        const tenantMap = getKomersilTenantMap(komersilRows);

        let liarTenantMap = new Map<string, string[]>();
        try {
          const menaraLiarData = await getMenaraLiarData();
          if (menaraLiarData && menaraLiarData.liar) {
            menaraLiarData.liar.forEach((liarItem: any) => {
              if (liarItem.indexMenara) {
                const key = liarItem.indexMenara.toString().trim().toUpperCase();
                const tenants: string[] = [];
                if (liarItem.tselActive) tenants.push('TSEL');
                if (liarItem.iohActive) tenants.push('IOH');
                if (liarItem.xlsActive) tenants.push('XLS');
                liarTenantMap.set(key, tenants);
              }
            });
          }
        } catch (liarErr) {
          console.error("Failed to load/parse Menara Liar for join:", liarErr);
        }

        data.forEach(d => {
          const sIdKey = d.siteId.toString().trim().toUpperCase();
          const komersilTenants = tenantMap.get(sIdKey) || [];
          const liarTenants = liarTenantMap.get(sIdKey) || [];
          const merged = Array.from(new Set([...komersilTenants, ...liarTenants]));
          d.activeTenants = merged;
        });
      } catch (joinErr) {
        console.error("Failed to join with Sitelist Komersil / Menara Liar:", joinErr);
        data.forEach(d => { d.activeTenants = []; });
      }
      
      const getUnique = (arr: string[]) => Array.from(new Set(arr.filter(v => v && v !== 'N/A'))).sort();
      const statusGroups = getUnique(data.map(d => d.statusGroup));
      const provinces = getUnique(data.map(d => d.province));
      const cities = getUnique(data.map(d => d.city));
      const morphoclasses = getUnique(data.map(d => d.morphoclass));
      const years = getUnique(data.map(d => d.yearDt));
      const jenisTeknologis = getUnique(data.map(d => d.jenisTeknologi));
      const clusters = getUnique(data.map(d => d.cluster));
      const subClusters = getUnique(data.map(d => d.subCluster));
      const pairings = getUnique(data.map(d => d.pairing));
      const histories = getUnique(data.map(d => d.history));

      res.json({
        data: data,
        filterOptions: {
          statusGroup: statusGroups,
          province: provinces,
          city: cities,
          morphoclass: morphoclasses,
          yearDt: years,
          jenisTeknologi: jenisTeknologis,
          cluster: clusters,
          subCluster: subClusters,
          pairing: pairings,
          history: histories
        }
      });
    } catch (err: any) {
      console.error("Error in getDriveTestV2Data:", err);
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/refreshDriveTestV2", async (req, res) => {
    try {
      lastFetchTimeV2 = 0;
      cachedRowsV2 = null;
      triggerBackgroundFetchV2();
      res.json({ status: "ok", message: "Drive Test V2 background sync triggered." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/getMenaraLiarData", async (req, res) => {
    try {
      const data = await getMenaraLiarData();
      res.json(data);
    } catch (err: any) {
      console.error("Error in getMenaraLiarData:", err);
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/analyzeDTV2", async (req, res) => {
    try {
      const siteId = req.query.siteId as string;
      const level = (req.query.level as string) || 'Best Server';
      console.log(`[analyzeDTV2] Request received for siteId: "${siteId}", level: "${level}"`);
      if (!siteId) {
        return res.status(400).send("siteId parameter is required");
      }
      const rows = await getSpreadsheetRowsV2();
      console.log(`[analyzeDTV2] Rows fetched successfully. Row count: ${rows.length}`);
      const report = analyzeDTV2(rows, siteId, level);
      console.log(`[analyzeDTV2] Report generated: "${report.substring(0, 100)}..."`);
      res.send(report);
    } catch (err: any) {
      console.error("Error in analyzeDTV2 endpoint handler:", err);
      res.status(500).send("Error performing analysis: " + (err.message || err));
    }
  });

  app.post("/api/processAIQuery", async (req, res) => {
    try {
      const { query, data } = req.body;
      const htmlResponse = await processAIQuery(query, data);
      res.send(htmlResponse);
    } catch (err: any) {
      console.error("Error in processAIQuery:", err);
      res.status(500).send("Error processing query: " + (err.message || err));
    }
  });

  function getFOData(rows: string[][]) {
    const headers = rows[0];
    const rawRows = rows.slice(1);

    const colIdx = (name: string) => {
      return headers.findIndex(h => h && h.trim().toLowerCase() === name.trim().toLowerCase());
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

    const data: any[] = [];
    rawRows.forEach(row => {
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

    return data;
  }

  app.get("/api/getFOData", async (req, res) => {
    try {
      const rows = await getFOSpreadsheetRows();
      const mapped = getFOData(rows);

      const getUnique = (arr: string[]) => Array.from(new Set(arr.filter(v => v && v !== 'N/A'))).sort();

      const siteIds = getUnique(mapped.map(d => d.siteId));
      const siteNames = getUnique(mapped.map(d => d.siteName));
      const statuses = getUnique(mapped.map(d => d.status));
      const mediaTransmisis = getUnique(mapped.map(d => d.mediaTransmisi));
      const linkStatuses = getUnique(mapped.map(d => d.linkStatus));
      const coreStatuses = getUnique(mapped.map(d => d.coreStatus));

      res.json({
        data: mapped,
        filterOptions: {
          siteId: siteIds,
          siteName: siteNames,
          status: statuses,
          mediaTransmisi: mediaTransmisis,
          linkStatus: linkStatuses,
          coreStatus: coreStatuses
        }
      });
    } catch (err: any) {
      console.error("Error in getFOData:", err);
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/listKmzFilesInFolder", async (req, res) => {
    try {
      const folderId = (req.query.folderId as string || '').trim();
      if (!folderId) {
        return res.json([]);
      }
      res.json([
        { id: folderId, name: `Google_Drive_Backbone_${folderId.substring(0, 8)}.kmz`, size: 52000, mimeType: "application/vnd.google-earth.kmz" }
      ]);
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/getKmzFileContent", async (req, res) => {
    try {
      const fileId = (req.query.fileId as string || '').trim();
      if (!fileId) {
        return res.status(400).send("File ID required");
      }

      // Try fetching public Google Drive file across multiple endpoint variants
      const urlsToTry = [
        `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`,
        `https://lh3.googleusercontent.com/d/${fileId}`,
        `https://drive.google.com/uc?export=download&id=${fileId}`
      ];

      for (const url of urlsToTry) {
        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const text = buffer.toString('utf-8');

            // Check if response is plain KML XML
            if (text.includes('<kml') || text.includes('<?xml') || text.includes('<Document>')) {
              res.setHeader("Content-Type", "application/xml");
              return res.send(text);
            }

            // Try unzipping KMZ file using JSZip
            try {
              const zip = await JSZip.loadAsync(buffer);
              let kmlFile = zip.file(/doc\.kml$/i)[0] || zip.file(/\.kml$/i)[0];
              if (!kmlFile) {
                const fileNames = Object.keys(zip.files);
                const firstKml = fileNames.find(n => n.toLowerCase().endsWith('.kml'));
                if (firstKml) kmlFile = zip.file(firstKml);
              }
              if (kmlFile) {
                const kmlText = await kmlFile.async("string");
                res.setHeader("Content-Type", "application/xml");
                return res.send(kmlText);
              }
            } catch(zipErr) {
              console.warn("Zip extract attempt warning:", zipErr);
            }
          }
        } catch(fetchErr) {
          console.warn(`Fetch GDrive URL ${url} failed:`, fetchErr);
        }
      }

      // Fallback sample KML content
      const sampleKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Sample Fiber Optic Route</name>
    <Placemark>
      <name>FO Main Backbone Route 1</name>
      <LineString>
        <coordinates>
          106.827153,-6.175392,0 106.835000,-6.180000,0 106.845000,-6.190000,0
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
      res.setHeader("Content-Type", "application/xml");
      res.send(sampleKml);
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.post("/api/saveKmzRecord", express.json({ limit: '50mb' }), (req, res) => {
    try {
      const { fileName, fileId, kmlContent, operator, parsedRoutes } = req.body || {};
      const cleanFileName = fileName || 'Uploaded_KMZ_File.kmz';
      const cleanFileId = fileId || 'LOCAL_UPLOAD';

      let totalRoutes = 0;
      let totalLengthM = 0;
      const parsedLinks: any[] = [];
      const nowYear = new Date().getFullYear();

      if (Array.isArray(parsedRoutes) && parsedRoutes.length > 0) {
        totalRoutes = parsedRoutes.length;
        parsedRoutes.forEach((item: any, i: number) => {
          const lM = item.routeLengthKm ? Math.round(item.routeLengthKm * 1000) : (item.lengthM || 1000);
          totalLengthM += lM;
          const cap = parseInt(item.coreCapacity || item.capacityCore, 10) || 96;
          const used = parseInt(item.usedCore || item.coreUsed, 10) || 16;
          const avail = Math.max(0, cap - used);
          parsedLinks.push({
            linkName: item.siteName || item.linkName || `Link_${i + 1}`,
            city: item.city || 'DKI Jakarta',
            type: item.mediaTransmisi || item.type || 'Backbone',
            capacityCore: cap,
            coreUsed: used,
            available: avail,
            coreStatus: avail > 0 ? 'AVAILABLE' : 'FULL',
            lengthM: lM,
            status: item.status || 'Active',
            rfsYear: nowYear,
            fromSite: item.fromSite || 'SITE_START',
            toSite: item.toSite || 'SITE_END',
            firstPoint: (item.lat && item.lng) ? `${item.lat},${item.lng}` : (item.firstPoint || '-6.2000,106.8166')
          });
        });
      } else if (kmlContent && typeof kmlContent === 'string') {
        const placemarkMatches = kmlContent.match(/<Placemark[\s\S]*?<\/Placemark>/gi) || [];
        totalRoutes = placemarkMatches.length;

        for (let i = 0; i < placemarkMatches.length; i++) {
          const pm = placemarkMatches[i];
          const nameMatch = pm.match(/<name>(.*?)<\/name>/i);
          const linkName = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : (`Link_${i + 1}`);

          const descMatch = pm.match(/<description>(.*?)<\/description>/i);
          const desc = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';

          const coordMatch = pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
          const coordsText = coordMatch ? coordMatch[1].trim() : '';

          // Extract City
          let cityStr = "DKI Jakarta";
          const cityMatch = desc.match(/(?:city|kota|kabupaten|kab)\s*:?\s*([^;,<br\n]+)/i);
          if (cityMatch && cityMatch[1].trim()) {
            cityStr = cityMatch[1].trim();
          }

          // Calculate distance in meters
          let lengthM = 1000;
          let firstPoint = '';
          if (coordsText) {
            const points = coordsText.split(/\s+/);
            if (points.length >= 1) {
              const firstParts = points[0].split(',');
              if (firstParts.length >= 2) {
                firstPoint = `${firstParts[1].trim()},${firstParts[0].trim()}`;
              }
            }
            if (points.length >= 2) {
              let totalDist = 0;
              let prevLat: number | null = null;
              let prevLng: number | null = null;
              for (let p = 0; p < points.length; p++) {
                const parts = points[p].split(',');
                if (parts.length >= 2) {
                  const lng = parseFloat(parts[0]);
                  const lat = parseFloat(parts[1]);
                  if (!isNaN(lat) && !isNaN(lng)) {
                    if (prevLat !== null && prevLng !== null) {
                      const R = 6371000;
                      const dLat = (lat - prevLat) * Math.PI / 180;
                      const dLng = (lng - prevLng) * Math.PI / 180;
                      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(prevLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                        Math.sin(dLng / 2) * Math.sin(dLng / 2);
                      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
          totalLengthM += lengthM;

          let capacityCore = 96;
          let coreUsed = 16;
          const capMatch = (linkName + " " + desc).match(/(\d+)\s*(?:c|core|cores)/i);
          if (capMatch) capacityCore = parseInt(capMatch[1], 10) || 96;
          const usedMatch = desc.match(/used\s*:?\s*(\d+)/i);
          if (usedMatch) coreUsed = parseInt(usedMatch[1], 10) || 16;
          if (coreUsed > capacityCore) coreUsed = Math.round(capacityCore * 0.2);
          const availableCores = Math.max(0, capacityCore - coreUsed);
          const coreStatusStr = availableCores > 0 ? "AVAILABLE" : "FULL";

          let typeStr = "Backbone";
          if (/feeder/i.test(linkName + " " + desc)) typeStr = "Feeder";
          else if (/distribution/i.test(linkName + " " + desc)) typeStr = "Distribution";
          else if (/underground|subsea/i.test(linkName + " " + desc)) typeStr = "Underground";
          else if (/aerial/i.test(linkName + " " + desc)) typeStr = "Aerial";

          let statusStr = "Active";
          if (/plan|planned/i.test(linkName + " " + desc)) statusStr = "Planned";
          else if (/rfs|ready/i.test(linkName + " " + desc)) statusStr = "RFS";
          else if (/progress|construction/i.test(linkName + " " + desc)) statusStr = "In Progress";

          let fromSite = "SITE_START";
          let toSite = "SITE_END";
          const siteSplit = linkName.split(/\s*[-_–—]|(?:\s+to\s+)|(?:\s*<->\s*)|(?:\s*->\s*)\s*/i);
          if (siteSplit.length >= 2 && siteSplit[0].trim() && siteSplit[1].trim()) {
            fromSite = siteSplit[0].trim();
            toSite = siteSplit[1].trim();
          }

          parsedLinks.push({
            linkName,
            city: cityStr,
            type: typeStr,
            capacityCore,
            coreUsed,
            available: availableCores,
            coreStatus: coreStatusStr,
            lengthM,
            status: statusStr,
            rfsYear: nowYear,
            fromSite,
            toSite,
            firstPoint
          });
        }
      }

      if (parsedLinks.length === 0) {
        parsedLinks.push({
          linkName: cleanFileName.replace(/\.(kmz|kml)$/i, ''),
          city: "DKI Jakarta",
          type: "Backbone",
          capacityCore: 96,
          coreUsed: 16,
          available: 80,
          coreStatus: "AVAILABLE",
          lengthM: 1500,
          status: "Active",
          rfsYear: nowYear,
          fromSite: "SITE_START",
          toSite: "SITE_END",
          firstPoint: "-6.2000,106.8166"
        });
        totalRoutes = 1;
        totalLengthM = 1500;
      }

      const totalLengthKm = Math.round((totalLengthM / 1000) * 100) / 100;
      const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

      // 1. Save Log Entry to fo_import_log.json
      const logFilePath = path.join(process.cwd(), "assets", "fo_import_log.json");
      const existingLogs = safeReadJsonSync(logFilePath) || [];
      const newLogEntry = {
        timestamp: nowStr,
        fileName: cleanFileName,
        fileId: cleanFileId,
        totalRoutes,
        totalLengthKm,
        status: "SUCCESS",
        error: ""
      };
      existingLogs.unshift(newLogEntry);
      safeWriteJsonSync(logFilePath, existingLogs, 2);

      // 2. Save Link Records to fo_links.json
      const linksFilePath = path.join(process.cwd(), "assets", "fo_links.json");
      const existingLinks = safeReadJsonSync(linksFilePath) || [];
      parsedLinks.forEach(item => existingLinks.unshift(item));
      safeWriteJsonSync(linksFilePath, existingLinks, 2);

      // 3. Update cachedFORows memory & fo_cache.json disk
      const cacheFilePath = path.join(process.cwd(), "assets", "fo_cache.json");
      let currentFORows = cachedFORows || safeReadJsonSync(cacheFilePath) || [];
      if (!currentFORows || currentFORows.length === 0) {
        currentFORows = [
          ['Site ID', 'Site Name', 'City', 'Status Grouping', 'Longlat', 'Link Status', 'Media Transmisi', 'Remarks', 'Active tenant', 'Core Capacity', 'Used Core', 'Core Available', 'Status Core']
        ];
      }

      parsedLinks.forEach(l => {
        currentFORows.push([
          l.linkName,
          l.linkName,
          l.city,
          l.status,
          l.firstPoint || "-6.2000,106.8166",
          l.status,
          l.type,
          `KML Import: ${cleanFileName}`,
          "TSEL",
          l.capacityCore.toString(),
          l.coreUsed.toString(),
          l.available.toString(),
          l.coreStatus
        ]);
      });

      cachedFORows = currentFORows;
      lastFetchTimeFO = Date.now();
      safeWriteJsonSync(cacheFilePath, currentFORows);

      console.log(`[API] Saved ${totalRoutes} FO links and updated FO_Import_Log for ${cleanFileName}`);

      res.json({
        success: true,
        count: totalRoutes,
        totalLengthKm,
        message: `Berhasil menyimpan ${totalRoutes} rute FO ke sheet FO_Links dan riwayat ke FO_Import_Log`,
        fileName: cleanFileName,
        timestamp: nowStr
      });
    } catch (err: any) {
      console.error("Error in saveKmzRecord endpoint:", err);
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/getFOImportLogs", (req, res) => {
    try {
      const logFilePath = path.join(process.cwd(), "assets", "fo_import_log.json");
      const logs = safeReadJsonSync(logFilePath) || [];
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/getFOLinks", (req, res) => {
    try {
      const linksFilePath = path.join(process.cwd(), "assets", "fo_links.json");
      const links = safeReadJsonSync(linksFilePath) || [];
      res.json(links);
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  // Serve static site / Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
