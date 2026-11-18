const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { fileURLToPath } = require('node:url');
const { execFile } = require('node:child_process');

const MAX_STRUCTURED_BYTES = 20 * 1024 * 1024;
const MAX_RAW_STREAM_BYTES = 50 * 1024 * 1024;
const TEXT_HEAD_BYTES = 384 * 1024;
const TEXT_TAIL_BYTES = 64 * 1024;
const MAX_INFLATE_BYTES = 20 * 1024 * 1024;

const SENSITIVE_BASENAMES = [
  /^accounts\.json$/i,
  /^models\.json$/i,
  /^win-cred\.ps1$/i,
  /^credential-user-scope$/i,
  /^app_storage\.json$/i,
  /^\.env(\..+)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|pfx|p12|kdbx)$/i,
  /^\.(npmrc|pypirc|netrc)$/i,
];

const RAW_MIME_MAP = {
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function parseLineRange(fragment = '') {
  const m = String(fragment || '').match(/^#?L(\d+)(?:-L?(\d+))?/i);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  return Number.isFinite(start) && start > 0 ? { start, end: Math.max(start, end) } : null;
}

function resolveLocalFilePath(uriOrPath) {
  const raw = String(uriOrPath || '').trim();
  if (!raw) throw new Error('缺少文件路径参数');

  let lineRange = null;
  const hashIdx = raw.indexOf('#');
  let cleaned = raw;
  if (hashIdx !== -1) {
    lineRange = parseLineRange(raw.slice(hashIdx + 1));
    cleaned = raw.slice(0, hashIdx);
  }
  const qIdx = cleaned.indexOf('?');
  if (qIdx !== -1 && /^file:/i.test(cleaned)) {
    cleaned = cleaned.slice(0, qIdx);
  }

  let localPath = '';
  if (/^file:\/\//i.test(cleaned)) {
    try {
      localPath = fileURLToPath(cleaned);
    } catch {
      let stripped = cleaned.replace(/^file:\/\/(?:localhost)?/i, '');
      try {
        stripped = decodeURIComponent(stripped);
      } catch {}
      if (/^\/[A-Za-z]:/.test(stripped)) stripped = stripped.slice(1);
      localPath = path.normalize(stripped);
    }
  } else {
    let decoded = cleaned;
    if (/%[0-9A-Fa-f]{2}/.test(decoded) && !fs.existsSync(decoded)) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {}
    }
    localPath = path.resolve(decoded);
  }

  if (!localPath || !path.isAbsolute(localPath)) {
    throw new Error('仅支持预览本地绝对路径文件');
  }
  return { filePath: localPath, lineRange };
}

function isSensitiveFilePath(filePath) {
  const base = path.basename(String(filePath || ''));
  if (SENSITIVE_BASENAMES.some((re) => re.test(base))) return true;
  const norm = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  if (norm.includes('/.ssh/') || norm.includes('/.gnupg/') || norm.includes('/.aws/credentials')) {
    return true;
  }
  return false;
}

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function decodeTextBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { text: '', encoding: 'UTF-8' };
  }
  // 1. Explicit BOM checks
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(buf.subarray(2)),
      encoding: 'UTF-16LE',
    };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(buf.subarray(2)),
      encoding: 'UTF-16BE',
    };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return {
      text: new TextDecoder('utf-8').decode(buf.subarray(3)),
      encoding: 'UTF-8 (BOM)',
    };
  }

  // 2. Heuristic BOM-less UTF-16LE / UTF-16BE detection
  const sampleLen = Math.min(buf.length, 4096);
  if (sampleLen >= 4 && sampleLen % 2 === 0) {
    let evenZeros = 0;
    let oddZeros = 0;
    const pairs = Math.floor(sampleLen / 2);
    for (let i = 0; i < pairs * 2; i += 2) {
      if (buf[i] === 0) evenZeros++;
      if (buf[i + 1] === 0) oddZeros++;
    }
    if (oddZeros / pairs > 0.25 && evenZeros / pairs < 0.02) {
      return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'UTF-16LE' };
    }
    if (evenZeros / pairs > 0.25 && oddZeros / pairs < 0.02) {
      return { text: new TextDecoder('utf-16be').decode(buf), encoding: 'UTF-16BE' };
    }
  }

  // 3. Check if binary (excessive NUL bytes)
  let nulCount = 0;
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) nulCount++;
  }
  if (sampleLen > 0 && nulCount / sampleLen > 0.01) {
    return null;
  }

  // 4. Strict UTF-8 first, fallback to GB18030 (Windows Simplified Chinese)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text, encoding: 'UTF-8' };
  } catch {
    try {
      const text = new TextDecoder('gb18030', { fatal: false }).decode(buf);
      return { text, encoding: 'GB18030' };
    } catch {
      return { text: buf.toString('utf8'), encoding: 'UTF-8' };
    }
  }
}

function readZipEntries(buf) {
  const minEocd = 22;
  if (!Buffer.isBuffer(buf) || buf.length < minEocd) {
    throw new Error('无效的 ZIP 容器');
  }
  const maxSearch = Math.max(0, buf.length - 65557);
  let eocdOffset = -1;
  for (let i = buf.length - minEocd; i >= maxSearch; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('未找到 ZIP 目录索引 (EOCD)');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > buf.length) throw new Error('ZIP 目录索引越界');

  const entries = [];
  let ptr = cdOffset;
  const end = cdOffset + cdSize;
  while (ptr + 46 <= end && entries.length < totalEntries) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(ptr + 8);
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const nameBuf = buf.subarray(ptr + 46, ptr + 46 + nameLen);
    const isUtf8 = (flags & 0x0800) !== 0;
    const name = isUtf8 ? nameBuf.toString('utf8') : (decodeTextBuffer(nameBuf)?.text || nameBuf.toString('utf8'));
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractZipEntry(buf, entry) {
  if (!entry || entry.isDirectory) return Buffer.alloc(0);
  const off = entry.localHeaderOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== 0x04034b50) {
    throw new Error('ZIP 局部文件头损坏');
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) throw new Error('ZIP 条目数据越界');
  const slice = buf.subarray(dataStart, dataEnd);
  if (entry.method === 0) {
    if (slice.length > MAX_INFLATE_BYTES) throw new Error('解压体积超出安全上限');
    return Buffer.from(slice);
  }
  if (entry.method === 8) {
    return zlib.inflateRawSync(slice, { maxOutputLength: MAX_INFLATE_BYTES });
  }
  throw new Error(`暂不支持的 ZIP 压缩算法 (method=${entry.method})`);
}

function parseDocxParagraph(pXml) {
  const styleMatch = pXml.match(/<w:pStyle\b[^>]*\bw:val="([^"]+)"/i);
  const rawStyle = styleMatch ? styleMatch[1] : '';
  let headingLevel = 0;
  const hMatch = rawStyle.match(/^(?:Heading|标题)\s*([1-6])$/i) || rawStyle.match(/^([1-6])$/);
  if (hMatch) headingLevel = Number(hMatch[1]);
  const isList = /<w:numPr\b/i.test(pXml);

  let text = '';
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/gi;
  let m;
  while ((m = tokenRe.exec(pXml)) !== null) {
    if (m[1] !== undefined) text += decodeXmlEntities(m[1]);
    else if (/^<w:tab/i.test(m[0])) text += '\t';
    else text += '\n';
  }
  const trimmed = text.replace(/\r/g, '').trimEnd();
  if (!trimmed.trim()) return null;
  if (headingLevel > 0) return { type: 'heading', level: headingLevel, text: trimmed.trim() };
  if (isList) return { type: 'list', text: trimmed.trim() };
  return { type: 'paragraph', text: trimmed };
}

function parseDocxBuffer(buf) {
  const entries = readZipEntries(buf);
  const docEntry = entries.find((e) => e.name === 'word/document.xml');
  if (!docEntry) throw new Error('未找到 Word 正文结构 (word/document.xml)');
  const xml = extractZipEntry(buf, docEntry).toString('utf8');
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i);
  const bodyXml = bodyMatch ? bodyMatch[1] : xml;

  const blocks = [];
  const blockRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/gi;
  let m;
  while ((m = blockRe.exec(bodyXml)) !== null && blocks.length < 1500) {
    const chunk = m[0];
    if (/^<w:tbl\b/i.test(chunk)) {
      const rows = [];
      const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/gi;
      let rm;
      while ((rm = rowRe.exec(chunk)) !== null && rows.length < 300) {
        const cells = [];
        const cellRe = /<w:tc\b[\s\S]*?<\/w:tc>/gi;
        let cm;
        while ((cm = cellRe.exec(rm[0])) !== null && cells.length < 50) {
          const cellParts = [];
          const pRe = /<w:p\b[\s\S]*?<\/w:p>/gi;
          let pm;
          while ((pm = pRe.exec(cm[0])) !== null) {
            const parsed = parseDocxParagraph(pm[0]);
            if (parsed?.text) cellParts.push(parsed.text);
          }
          cells.push(cellParts.join('\n'));
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) blocks.push({ type: 'table', rows });
    } else {
      const p = parseDocxParagraph(chunk);
      if (p) blocks.push(p);
    }
  }
  return { blocks };
}

function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

function parseXlsxBuffer(buf) {
  const entries = readZipEntries(buf);
  const sharedStrings = [];
  const ssEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  if (ssEntry) {
    const ssXml = extractZipEntry(buf, ssEntry).toString('utf8');
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
    let sm;
    while ((sm = siRe.exec(ssXml)) !== null) {
      let val = '';
      const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi;
      let tm;
      while ((tm = tRe.exec(sm[1])) !== null) val += decodeXmlEntities(tm[1]);
      sharedStrings.push(val);
    }
  }

  // Map workbook sheet names & r:id -> target worksheet path
  const relMap = new Map();
  const relEntry = entries.find((e) => e.name === 'xl/_rels/workbook.xml.rels');
  if (relEntry) {
    const relXml = extractZipEntry(buf, relEntry).toString('utf8');
    const relRe = /<Relationship\b[^>]*>/gi;
    let rm;
    while ((rm = relRe.exec(relXml)) !== null) {
      const id = rm[0].match(/\bId="([^"]+)"/i)?.[1];
      const target = rm[0].match(/\bTarget="([^"]+)"/i)?.[1];
      if (id && target) {
        const cleanTarget = target.replace(/^\/+/, '');
        relMap.set(id, cleanTarget.startsWith('xl/') ? cleanTarget : `xl/${cleanTarget}`);
      }
    }
  }

  const sheetDefs = [];
  const wbEntry = entries.find((e) => e.name === 'xl/workbook.xml');
  if (wbEntry) {
    const wbXml = extractZipEntry(buf, wbEntry).toString('utf8');
    const shRe = /<sheet\b[^>]*>/gi;
    let sm;
    while ((sm = shRe.exec(wbXml)) !== null) {
      const name = decodeXmlEntities(sm[0].match(/\bname="([^"]+)"/i)?.[1] || '');
      const rId = sm[0].match(/\br:id="([^"]+)"/i)?.[1] || '';
      const entryPath = relMap.get(rId) || `xl/worksheets/sheet${sheetDefs.length + 1}.xml`;
      sheetDefs.push({ name: name || `Sheet ${sheetDefs.length + 1}`, entryPath });
    }
  }
  if (sheetDefs.length === 0) {
    const wsEntries = entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    wsEntries.forEach((e, idx) => sheetDefs.push({ name: `Sheet ${idx + 1}`, entryPath: e.name }));
  }

  const sheets = [];
  for (const def of sheetDefs.slice(0, 12)) {
    const entry = entries.find((e) => e.name === def.entryPath);
    if (!entry) continue;
    const xml = extractZipEntry(buf, entry).toString('utf8');
    const rows = [];
    let totalRows = 0;
    let maxCols = 0;
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
    let rm;
    while ((rm = rowRe.exec(xml)) !== null) {
      totalRows++;
      if (rows.length >= 400) continue;
      const rowArr = [];
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
      let cm;
      let nextCol = 0;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        const attrs = cm[1];
        const inner = cm[2];
        const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
        const colIdx = refMatch ? colLettersToIndex(refMatch[1].toUpperCase()) : nextCol;
        nextCol = colIdx + 1;
        if (colIdx >= 60) continue;
        const type = attrs.match(/\bt="([^"]+)"/i)?.[1] || '';
        let cellVal = '';
        if (type === 'inlineStr') {
          const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi;
          let tm;
          while ((tm = tRe.exec(inner)) !== null) cellVal += decodeXmlEntities(tm[1]);
        } else {
          const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
          const rawV = vMatch ? decodeXmlEntities(vMatch[1].trim()) : '';
          if (type === 's') {
            const idx = Number(rawV);
            cellVal = Number.isFinite(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : rawV;
          } else if (type === 'b') {
            cellVal = rawV === '1' ? 'TRUE' : 'FALSE';
          } else {
            cellVal = rawV;
          }
        }
        while (rowArr.length < colIdx) rowArr.push('');
        rowArr[colIdx] = cellVal;
      }
      if (rowArr.length > maxCols) maxCols = rowArr.length;
      if (rowArr.some((v) => v !== '')) rows.push(rowArr);
    }
    for (const r of rows) {
      while (r.length < maxCols) r.push('');
    }
    sheets.push({
      name: def.name,
      rows,
      totalRows,
      truncated: totalRows > rows.length,
    });
  }
  return { sheets };
}

function parsePptxBuffer(buf) {
  const entries = readZipEntries(buf);
  const slideEntries = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const slides = [];
  for (const entry of slideEntries.slice(0, 80)) {
    const numMatch = entry.name.match(/slide(\d+)\.xml$/i);
    const number = numMatch ? Number(numMatch[1]) : slides.length + 1;
    const xml = extractZipEntry(buf, entry).toString('utf8');
    const lines = [];
    const pRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
    let pm;
    while ((pm = pRe.exec(xml)) !== null) {
      let line = '';
      const tRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi;
      let tm;
      while ((tm = tRe.exec(pm[1])) !== null) line += decodeXmlEntities(tm[1]);
      const clean = line.trim();
      if (clean) lines.push(clean);
    }
    slides.push({
      number,
      title: lines[0] || `幻灯片 ${number}`,
      lines: lines.slice(1),
    });
  }
  return { slides };
}

function parseDelimitedText(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let totalRows = 0;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      if (row.length < 80) row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (row.length < 80) row.push(cell);
      cell = '';
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
        totalRows++;
        if (rows.length < 500) rows.push(row);
      }
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    if (row.length < 80) row.push(cell);
    totalRows++;
    if (rows.length < 500) rows.push(row);
  }
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of rows) {
    while (r.length < maxCols) r.push('');
  }
  return { rows, totalRows, truncated: totalRows > rows.length };
}

function parseIpynbText(text) {
  const nb = JSON.parse(text);
  const rawCells = Array.isArray(nb?.cells) ? nb.cells : [];
  const lang = nb?.metadata?.kernelspec?.language || nb?.metadata?.language_info?.name || 'python';
  const cells = rawCells.slice(0, 200).map((c, index) => {
    const src = Array.isArray(c.source) ? c.source.join('') : String(c.source || '');
    const outputs = [];
    if (Array.isArray(c.outputs)) {
      for (const out of c.outputs.slice(0, 12)) {
        if (out.output_type === 'stream') {
          const t = Array.isArray(out.text) ? out.text.join('') : String(out.text || '');
          if (t) outputs.push({ kind: 'text', text: t.slice(0, 8000) });
        } else if (out.output_type === 'error') {
          const tb = Array.isArray(out.traceback)
            ? out.traceback.join('\n').replace(/\x1b\[[0-9;]*m/g, '')
            : `${out.ename || 'Error'}: ${out.evalue || ''}`;
          outputs.push({ kind: 'error', text: tb.slice(0, 8000) });
        } else if (out.data) {
          if (out.data['image/png']) {
            const b64 = Array.isArray(out.data['image/png'])
              ? out.data['image/png'].join('').trim()
              : String(out.data['image/png']).trim();
            outputs.push({ kind: 'image', mime: 'image/png', data: b64 });
          } else if (out.data['text/plain']) {
            const t = Array.isArray(out.data['text/plain'])
              ? out.data['text/plain'].join('')
              : String(out.data['text/plain']);
            outputs.push({ kind: 'text', text: t.slice(0, 8000) });
          }
        }
      }
    }
    return {
      index: index + 1,
      cellType: c.cell_type || 'code',
      executionCount: c.execution_count ?? null,
      source: src,
      outputs,
    };
  });
  return { language: lang, cells, totalCells: rawCells.length };
}

function parseSqliteBuffer(buf) {
  const pageSizeRaw = buf.readUInt16BE(16);
  const pageSize = pageSizeRaw === 1 ? 65536 : pageSizeRaw;
  const pageCount = buf.length >= 32 ? buf.readUInt32BE(28) : 0;
  const encCode = buf.length >= 60 ? buf.readUInt32BE(56) : 1;
  const encoding = encCode === 2 ? 'UTF-16le' : encCode === 3 ? 'UTF-16be' : 'UTF-8';
  const scanSlice = buf.subarray(0, Math.min(buf.length, 512 * 1024)).toString('utf8');
  const ddlMatches = scanSlice.match(/CREATE\s+(?:TEMP\s+|VIRTUAL\s+)?(?:TABLE|VIEW|INDEX|UNIQUE\s+INDEX)\s+[\s\S]{1,1800}?\)/gi) || [];
  const schemas = [...new Set(ddlMatches.map((s) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]+/g, ' ').trim()))].slice(0, 60);
  return { pageSize, pageCount, encoding, schemas };
}

function detectBinarySignature(buf) {
  if (!buf || buf.length < 4) return 'Binary Data';
  if (buf[0] === 0x4d && buf[1] === 0x5a) return 'Windows PE Executable / DLL (MZ)';
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'Linux ELF Binary';
  if (buf[0] === 0x1f && buf[1] === 0x8b) return 'GZIP Compressed Stream';
  if (buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return '7-Zip Archive';
  if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return 'RAR Archive';
  if (buf[0] === 0x50 && buf[1] === 0x41 && buf[2] === 0x52 && buf[3] === 0x31) return 'Apache Parquet Columnar File';
  if (buf[0] === 0x93 && buf.subarray(1, 6).toString('ascii') === 'NUMPY') return 'NumPy Array (.npy)';
  if (buf[0] === 0x00 && buf[1] === 0x61 && buf[2] === 0x73 && buf[3] === 0x6d) return 'WebAssembly Module (.wasm)';
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'Legacy Microsoft Office OLE2 Document';
  return 'Binary File';
}

function formatHexPreview(buf, maxBytes = 256) {
  const len = Math.min(buf.length, maxBytes);
  const lines = [];
  for (let offset = 0; offset < len; offset += 16) {
    const slice = buf.subarray(offset, Math.min(len, offset + 16));
    const hexParts = [];
    let ascii = '';
    for (let i = 0; i < 16; i++) {
      if (i < slice.length) {
        const b = slice[i];
        hexParts.push(b.toString(16).padStart(2, '0'));
        ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
      } else {
        hexParts.push('  ');
      }
    }
    lines.push(
      `${offset.toString(16).padStart(4, '0')}  ${hexParts.slice(0, 8).join(' ')}  ${hexParts.slice(8).join(' ')}  |${ascii}|`
    );
  }
  return lines.join('\n');
}

function readLargeFileSample(filePath, size) {
  const fd = fs.openSync(filePath, 'r');
  try {
    if (size <= TEXT_HEAD_BYTES + TEXT_TAIL_BYTES) {
      const full = Buffer.alloc(size);
      fs.readSync(fd, full, 0, size, 0);
      return { head: full, tail: null, truncated: false };
    }
    const head = Buffer.alloc(TEXT_HEAD_BYTES);
    const tail = Buffer.alloc(TEXT_TAIL_BYTES);
    fs.readSync(fd, head, 0, TEXT_HEAD_BYTES, 0);
    fs.readSync(fd, tail, 0, TEXT_TAIL_BYTES, size - TEXT_TAIL_BYTES);
    return { head, tail, truncated: true };
  } finally {
    fs.closeSync(fd);
  }
}

function inspectFilePreview(uriOrPath, options = {}) {
  const { filePath, lineRange } = resolveLocalFilePath(uriOrPath);
  if (isSensitiveFilePath(filePath)) {
    throw new Error('出于安全保护，敏感凭据或密钥文件不支持侧边预览');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`未找到文件: ${path.basename(filePath)}`);
  }
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    const items = fs.readdirSync(filePath, { withFileTypes: true }).slice(0, 300).map((d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
    }));
    return {
      ok: true,
      kind: 'directory',
      fileName: path.basename(filePath) || filePath,
      filePath,
      ext: '',
      size: 0,
      mtime: stat.mtime.toISOString(),
      items,
    };
  }

  const ext = path.extname(filePath).toLowerCase();
  const baseMeta = {
    ok: true,
    fileName: path.basename(filePath),
    filePath,
    ext,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    lineRange,
  };

  // 1. Native media & PDF
  if (ext === '.pdf') {
    let pageCount = null;
    if (stat.size > 0 && stat.size <= MAX_RAW_STREAM_BYTES) {
      try {
        const sampleSize = Math.min(stat.size, 4 * 1024 * 1024);
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(sampleSize);
        fs.readSync(fd, buf, 0, sampleSize, 0);
        fs.closeSync(fd);
        const matches = buf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g);
        if (matches && matches.length > 0 && sampleSize === stat.size) {
          pageCount = matches.length;
        }
      } catch {}
    }
    return {
      ...baseMeta,
      kind: 'pdf',
      pageCount,
      streamable: stat.size <= MAX_RAW_STREAM_BYTES,
    };
  }

  if (RAW_MIME_MAP[ext] && ext !== '.svg') {
    const mime = RAW_MIME_MAP[ext];
    const mediaType = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('audio/')
      ? 'audio'
      : 'video';
    return {
      ...baseMeta,
      kind: 'media',
      mediaType,
      mime,
      streamable: stat.size <= MAX_RAW_STREAM_BYTES,
    };
  }

  // 2. Office & ZIP containers
  if (['.docx', '.xlsx', '.pptx', '.zip', '.whl', '.vsix', '.jar', '.nupkg'].includes(ext)) {
    if (stat.size > MAX_STRUCTURED_BYTES) {
      throw new Error(`容器文件体积较大 (${(stat.size / 1048576).toFixed(1)} MB)，请点击右上角使用系统默认应用打开`);
    }
    const buf = fs.readFileSync(filePath);
    if (ext === '.docx') {
      const { blocks } = parseDocxBuffer(buf);
      return { ...baseMeta, kind: 'docx', blocks };
    }
    if (ext === '.xlsx') {
      const { sheets } = parseXlsxBuffer(buf);
      return { ...baseMeta, kind: 'xlsx', sheets };
    }
    if (ext === '.pptx') {
      const { slides } = parsePptxBuffer(buf);
      return { ...baseMeta, kind: 'pptx', slides };
    }
    const entries = readZipEntries(buf);
    if (options.zipEntry) {
      const targetEntry = entries.find((e) => e.name === options.zipEntry && !e.isDirectory);
      if (!targetEntry) throw new Error('压缩包内未找到指定条目');
      const rawEntry = extractZipEntry(buf, targetEntry);
      const decoded = decodeTextBuffer(rawEntry);
      return {
        ...baseMeta,
        kind: 'zip-entry',
        entryName: targetEntry.name,
        entrySize: targetEntry.uncompressedSize,
        encoding: decoded ? decoded.encoding : 'BINARY',
        content: decoded ? decoded.text.slice(0, 200_000) : formatHexPreview(rawEntry, 512),
        isBinary: !decoded,
      };
    }
    return {
      ...baseMeta,
      kind: 'archive',
      totalEntries: entries.length,
      entries: entries.slice(0, 400).map((e) => ({
        name: e.name,
        size: e.uncompressedSize,
        compressedSize: e.compressedSize,
        isDirectory: e.isDirectory,
      })),
    };
  }

  // 3. SQLite databases
  if (['.sqlite', '.sqlite3', '.db'].includes(ext) && stat.size >= 100) {
    const fd = fs.openSync(filePath, 'r');
    const sample = Buffer.alloc(Math.min(stat.size, 512 * 1024));
    fs.readSync(fd, sample, 0, sample.length, 0);
    fs.closeSync(fd);
    if (sample.subarray(0, 16).toString('ascii') === 'SQLite format 3\0') {
      return {
        ...baseMeta,
        kind: 'sqlite',
        sqliteInfo: parseSqliteBuffer(sample),
      };
    }
  }

  // 4. Structured text & general text / UTF-16 / GB18030 / Large logs
  const sample = readLargeFileSample(filePath, stat.size);
  const decodedHead = decodeTextBuffer(sample.head);
  if (!decodedHead) {
    return {
      ...baseMeta,
      kind: 'binary',
      signature: detectBinarySignature(sample.head),
      hexPreview: formatHexPreview(sample.head, 256),
    };
  }

  if (ext === '.ipynb' && !sample.truncated) {
    try {
      const nb = parseIpynbText(decodedHead.text);
      return { ...baseMeta, kind: 'ipynb', encoding: decodedHead.encoding, ...nb };
    } catch {}
  }

  if ((ext === '.csv' || ext === '.tsv') && !sample.truncated) {
    const parsed = parseDelimitedText(decodedHead.text, ext === '.tsv' ? '\t' : ',');
    return {
      ...baseMeta,
      kind: 'table',
      encoding: decodedHead.encoding,
      ...parsed,
    };
  }

  if (ext === '.jsonl' || ext === '.ndjson') {
    const rawLines = decodedHead.text.split(/\r?\n/).filter((l) => l.trim());
    const records = rawLines.slice(0, 200).map((line, i) => {
      try {
        return { line: i + 1, ok: true, value: JSON.parse(line) };
      } catch {
        return { line: i + 1, ok: false, raw: line.slice(0, 1000) };
      }
    });
    return {
      ...baseMeta,
      kind: 'jsonl',
      encoding: decodedHead.encoding,
      records,
      totalLines: rawLines.length,
      truncated: sample.truncated || rawLines.length > records.length,
    };
  }

  if (ext === '.svg' && !sample.truncated) {
    return {
      ...baseMeta,
      kind: 'svg',
      encoding: decodedHead.encoding,
      content: decodedHead.text,
    };
  }

  if ((ext === '.html' || ext === '.htm') && !sample.truncated) {
    return {
      ...baseMeta,
      kind: 'html',
      encoding: decodedHead.encoding,
      content: decodedHead.text,
    };
  }

  if (ext === '.md' || ext === '.markdown') {
    const tailText = sample.tail ? decodeTextBuffer(sample.tail)?.text || '' : '';
    return {
      ...baseMeta,
      kind: 'markdown',
      encoding: decodedHead.encoding,
      content: sample.truncated
        ? `${decodedHead.text}\n\n...\n\n${tailText}`
        : decodedHead.text,
      truncated: sample.truncated,
    };
  }

  const tailText = sample.tail ? decodeTextBuffer(sample.tail)?.text || '' : '';
  return {
    ...baseMeta,
    kind: 'text',
    encoding: decodedHead.encoding,
    content: decodedHead.text,
    tailContent: sample.truncated ? tailText : '',
    truncated: sample.truncated,
  };
}

function streamRawFile(uriOrPath, req, res, origin = '') {
  const { filePath } = resolveLocalFilePath(uriOrPath);
  if (isSensitiveFilePath(filePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden sensitive file');
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('File not found');
    return;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_RAW_STREAM_BYTES) {
    res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('File too large for inline stream');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = RAW_MIME_MAP[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Private-Network': 'true',
  };

  const rangeHeader = req.headers?.range;
  if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
    const [startStr, endStr] = rangeHeader.replace(/^bytes=/, '').split('-');
    let start = startStr ? parseInt(startStr, 10) : 0;
    let end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    if (!startStr && endStr) {
      start = Math.max(0, stat.size - parseInt(endStr, 10));
      end = stat.size - 1;
    }
    start = Math.max(0, Math.min(start, stat.size - 1));
    end = Math.max(start, Math.min(end, stat.size - 1));
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    headers['Content-Length'] = String(end - start + 1);
    res.writeHead(206, headers);
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  headers['Content-Length'] = String(stat.size);
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function openSystemFileAction(uriOrPath, action) {
  if (process.env.AGY_SUITE_TEST) {
    const { filePath } = resolveLocalFilePath(uriOrPath);
    if (isSensitiveFilePath(filePath)) throw new Error('Forbidden sensitive file');
    return { ok: true, simulated: true, filePath, action };
  }
  const { filePath } = resolveLocalFilePath(uriOrPath);
  if (isSensitiveFilePath(filePath)) {
    throw new Error('出于安全保护，敏感凭据文件禁止此操作');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error('目标文件不存在');
  }
  if (action === 'reveal') {
    execFile('explorer.exe', [`/select,${filePath}`], { windowsHide: true }, () => {});
    return { ok: true, filePath };
  }
  if (action === 'openExternal') {
    const escaped = filePath.replace(/'/g, "''");
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${escaped}'`],
      { windowsHide: true },
      () => {}
    );
    return { ok: true, filePath };
  }
  throw new Error('未知的文件系统操作');
}

module.exports = {
  resolveLocalFilePath,
  isSensitiveFilePath,
  decodeTextBuffer,
  readZipEntries,
  extractZipEntry,
  parseDocxBuffer,
  parseXlsxBuffer,
  parsePptxBuffer,
  parseDelimitedText,
  inspectFilePreview,
  streamRawFile,
  openSystemFileAction,
};
