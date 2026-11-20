import katex from 'katex';

export type FormulaDecodeMode =
  | 'ole-mtef-latex'
  | 'ole-wmf-svg-preview'
  | 'unresolved-ole';

export interface OleFormulaDecodeResult {
  mode: FormulaDecodeMode;
  /** Có hiển thị được chính xác cho học sinh/giáo viên không */
  displayable: boolean;
  /** Có công thức máy đọc được (LaTeX đã qua KaTeX check) không */
  machineReadable: boolean;
  /** Chuỗi LaTeX (không bọc $) nếu giải mã MTEF thành công và KaTeX chấp nhận */
  latex?: string;
  /** Data URL SVG (`data:image/svg+xml;base64,...`) nếu dựng được từ WMF preview */
  svgDataUrl?: string;
  /** Raw sanitized SVG nếu dựng được từ WMF preview */
  svgMarkup?: string;
  /** Lý do fallback hoặc chưa giải mã được */
  reason?: string;
  /** Số bản ghi MTEF không nhận diện được (chỉ để chẩn đoán) */
  unknownRecordCount?: number;
  progId?: string;
}

export interface WmfToSvgResult {
  ok: boolean;
  svgMarkup?: string;
  svgDataUrl?: string;
  width?: number;
  height?: number;
  primitiveCount: number;
  reason?: string;
}

const CFBF_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const NOSTREAM = 0xffffffff;

function readU16LE(buf: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > buf.length) return 0;
  return buf[offset] | (buf[offset + 1] << 8);
}

function readI16LE(buf: Uint8Array, offset: number): number {
  const v = readU16LE(buf, offset);
  return v >= 0x8000 ? v - 0x10000 : v;
}

function readU32LE(buf: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > buf.length) return 0;
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  );
}

function readI32LE(buf: Uint8Array, offset: number): number {
  return readU32LE(buf, offset) | 0;
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// 1. STATIC CFBF / OLE2 STREAM READER (ZERO EXECUTION, PURE BINARY PARSING)
// ============================================================================

export function extractOle2Stream(
  bytes: Uint8Array,
  targetStreamName: string
): Uint8Array | null {
  if (bytes.length < 512) return null;
  for (let i = 0; i < CFBF_SIGNATURE.length; i++) {
    if (bytes[i] !== CFBF_SIGNATURE[i]) return null;
  }

  const sectorShift = readU16LE(bytes, 30);
  if (sectorShift !== 9 && sectorShift !== 12) return null;
  const sectorSize = 1 << sectorShift;
  const miniSectorShift = readU16LE(bytes, 32) || 6;
  const miniSectorSize = 1 << miniSectorShift;

  const numFatSectors = readU32LE(bytes, 44);
  const firstDirSector = readU32LE(bytes, 48);
  const miniStreamCutoff = readU32LE(bytes, 56) || 4096;
  const firstMiniFatSector = readU32LE(bytes, 60);
  const numMiniFatSectors = readU32LE(bytes, 64);
  const firstDifatSector = readU32LE(bytes, 68);
  const numDifatSectors = readU32LE(bytes, 72);

  const sectorOffset = (secId: number): number => (secId + 1) * sectorSize;
  const maxSectorId = Math.floor((bytes.length - sectorSize) / sectorSize);
  if (maxSectorId < 0) return null;

  // Collect FAT sector IDs from header DIFAT (109 entries at offset 76) + DIFAT chain
  const fatSectorIds: number[] = [];
  for (let i = 0; i < 109; i++) {
    const sid = readU32LE(bytes, 76 + i * 4);
    if (sid !== FREESECT && sid !== ENDOFCHAIN && sid <= maxSectorId) {
      fatSectorIds.push(sid);
    }
  }

  let difatSec = firstDifatSector;
  const visitedDifat = new Set<number>();
  const entriesPerDifat = sectorSize / 4 - 1;
  let difatLoops = 0;
  while (
    difatSec !== ENDOFCHAIN &&
    difatSec !== FREESECT &&
    difatSec <= maxSectorId &&
    difatLoops < Math.max(numDifatSectors, 64) &&
    !visitedDifat.has(difatSec)
  ) {
    visitedDifat.add(difatSec);
    difatLoops += 1;
    const base = sectorOffset(difatSec);
    if (base + sectorSize > bytes.length) break;
    for (let i = 0; i < entriesPerDifat; i++) {
      const sid = readU32LE(bytes, base + i * 4);
      if (sid !== FREESECT && sid !== ENDOFCHAIN && sid <= maxSectorId) {
        fatSectorIds.push(sid);
      }
    }
    difatSec = readU32LE(bytes, base + entriesPerDifat * 4);
  }

  const effectiveFatIds =
    numFatSectors > 0 ? fatSectorIds.slice(0, numFatSectors) : fatSectorIds;

  // Build FAT table
  const fat: number[] = [];
  for (const fatSecId of effectiveFatIds) {
    const base = sectorOffset(fatSecId);
    if (base + sectorSize > bytes.length) continue;
    for (let off = 0; off < sectorSize; off += 4) {
      fat.push(readU32LE(bytes, base + off));
    }
  }
  if (fat.length === 0) return null;

  const readRegularChain = (startSec: number, expectedSize?: number): Uint8Array => {
    const chunks: Uint8Array[] = [];
    const visited = new Set<number>();
    let sec = startSec;
    let total = 0;
    const hardLimit = Math.min(bytes.length, expectedSize ? expectedSize + sectorSize : bytes.length);

    while (
      sec !== ENDOFCHAIN &&
      sec !== FREESECT &&
      sec !== FATSECT &&
      sec !== DIFSECT &&
      sec <= maxSectorId &&
      !visited.has(sec) &&
      total < hardLimit
    ) {
      visited.add(sec);
      const base = sectorOffset(sec);
      if (base + sectorSize > bytes.length) {
        chunks.push(bytes.subarray(base));
        total += bytes.length - base;
        break;
      }
      chunks.push(bytes.subarray(base, base + sectorSize));
      total += sectorSize;
      sec = sec < fat.length ? fat[sec] : ENDOFCHAIN;
    }

    const outSize =
      expectedSize !== undefined ? Math.min(expectedSize, total) : total;
    const out = new Uint8Array(outSize);
    let pos = 0;
    for (const c of chunks) {
      if (pos >= outSize) break;
      const take = Math.min(c.length, outSize - pos);
      out.set(c.subarray(0, take), pos);
      pos += take;
    }
    return out;
  };

  // Read Directory stream
  const dirBytes = readRegularChain(firstDirSector);
  const numDirEntries = Math.floor(dirBytes.length / 128);
  if (numDirEntries === 0) return null;

  interface DirEntry {
    name: string;
    objType: number;
    startSector: number;
    streamSize: number;
  }

  const entries: DirEntry[] = [];
  for (let i = 0; i < numDirEntries; i++) {
    const base = i * 128;
    const nameLen = readU16LE(dirBytes, base + 64);
    const objType = dirBytes[base + 66];
    const startSector = readU32LE(dirBytes, base + 116);
    const sizeLow = readU32LE(dirBytes, base + 120);
    if (objType === 0 || nameLen < 2 || nameLen > 64) {
      entries.push({ name: '', objType: 0, startSector: ENDOFCHAIN, streamSize: 0 });
      continue;
    }
    let name = '';
    const charCount = Math.floor((nameLen - 2) / 2);
    for (let c = 0; c < charCount; c++) {
      name += String.fromCharCode(readU16LE(dirBytes, base + c * 2));
    }
    entries.push({ name, objType, startSector, streamSize: sizeLow });
  }

  const targetLower = targetStreamName.trim().toLowerCase();
  const matched = entries.find(
    (e) => e.objType === 2 && e.name.trim().toLowerCase() === targetLower
  );
  if (!matched || matched.streamSize === 0) return null;

  // Regular stream (>= miniStreamCutoff)
  if (matched.streamSize >= miniStreamCutoff) {
    return readRegularChain(matched.startSector, matched.streamSize);
  }

  // Mini-stream (< miniStreamCutoff)
  const rootEntry = entries[0];
  if (!rootEntry || rootEntry.objType !== 5 || rootEntry.startSector === ENDOFCHAIN) {
    return readRegularChain(matched.startSector, matched.streamSize);
  }

  const miniStreamContainer = readRegularChain(
    rootEntry.startSector,
    rootEntry.streamSize || undefined
  );
  const miniFatBytes =
    firstMiniFatSector !== ENDOFCHAIN && numMiniFatSectors > 0
      ? readRegularChain(firstMiniFatSector, numMiniFatSectors * sectorSize)
      : new Uint8Array(0);
  const miniFat: number[] = [];
  for (let off = 0; off + 4 <= miniFatBytes.length; off += 4) {
    miniFat.push(readU32LE(miniFatBytes, off));
  }

  const out = new Uint8Array(matched.streamSize);
  const visitedMini = new Set<number>();
  let msec = matched.startSector;
  let written = 0;
  while (
    msec !== ENDOFCHAIN &&
    msec !== FREESECT &&
    !visitedMini.has(msec) &&
    written < matched.streamSize
  ) {
    visitedMini.add(msec);
    const mOff = msec * miniSectorSize;
    if (mOff >= miniStreamContainer.length) break;
    const take = Math.min(
      miniSectorSize,
      miniStreamContainer.length - mOff,
      matched.streamSize - written
    );
    out.set(miniStreamContainer.subarray(mOff, mOff + take), written);
    written += take;
    msec = msec < miniFat.length ? miniFat[msec] : ENDOFCHAIN;
  }

  return written > 0 ? out.subarray(0, written) : null;
}

// ============================================================================
// 2. MATHTYPE MTEF v3 / v5 DECODER → KATEX-VERIFIED LATEX
// ============================================================================

const SYMBOL_FONT_TO_LATEX: Record<number, string> = {
  0x22: '\\forall ',
  0x24: '\\exists ',
  0x27: '\\ni ',
  0x2a: '*',
  0x2d: '-',
  0x40: '\\cong ',
  0x41: 'A',
  0x42: 'B',
  0x43: 'X',
  0x44: '\\Delta ',
  0x45: 'E',
  0x46: '\\Phi ',
  0x47: '\\Gamma ',
  0x48: 'H',
  0x49: 'I',
  0x4a: '\\vartheta ',
  0x4b: 'K',
  0x4c: '\\Lambda ',
  0x4d: 'M',
  0x4e: 'N',
  0x4f: 'O',
  0x50: '\\Pi ',
  0x51: '\\Theta ',
  0x52: 'P',
  0x53: '\\Sigma ',
  0x54: 'T',
  0x55: '\\Upsilon ',
  0x56: '\\varsigma ',
  0x57: '\\Omega ',
  0x58: '\\Xi ',
  0x59: '\\Psi ',
  0x5a: 'Z',
  0x5c: '\\therefore ',
  0x5e: '\\perp ',
  0x61: '\\alpha ',
  0x62: '\\beta ',
  0x63: '\\chi ',
  0x64: '\\delta ',
  0x65: '\\varepsilon ',
  0x66: '\\phi ',
  0x67: '\\gamma ',
  0x68: '\\eta ',
  0x69: '\\iota ',
  0x6a: '\\varphi ',
  0x6b: '\\kappa ',
  0x6c: '\\lambda ',
  0x6d: '\\mu ',
  0x6e: '\\nu ',
  0x6f: 'o',
  0x70: '\\pi ',
  0x71: '\\theta ',
  0x72: '\\rho ',
  0x73: '\\sigma ',
  0x74: '\\tau ',
  0x75: '\\upsilon ',
  0x76: '\\varpi ',
  0x77: '\\omega ',
  0x78: '\\xi ',
  0x79: '\\psi ',
  0x7a: '\\zeta ',
  0x7e: '\\sim ',
  0xa3: '\\le ',
  0xa5: '\\infty ',
  0xab: '\\leftrightarrow ',
  0xac: '\\leftarrow ',
  0xad: '\\uparrow ',
  0xae: '\\rightarrow ',
  0xaf: '\\downarrow ',
  0xb0: '^\\circ ',
  0xb1: '\\pm ',
  0xb2: '\\prime\\prime ',
  0xb3: '\\ge ',
  0xb4: '\\times ',
  0xb5: '\\propto ',
  0xb6: '\\partial ',
  0xb7: '\\cdot ',
  0xb8: '\\div ',
  0xb9: '\\ne ',
  0xba: '\\equiv ',
  0xbb: '\\approx ',
  0xbc: '\\dots ',
  0xc0: '\\aleph ',
  0xc1: '\\Im ',
  0xc2: '\\Re ',
  0xc4: '\\otimes ',
  0xc5: '\\oplus ',
  0xc6: '\\emptyset ',
  0xc7: '\\cap ',
  0xc8: '\\cup ',
  0xc9: '\\supset ',
  0xca: '\\supseteq ',
  0xcb: '\\not\\subset ',
  0xcc: '\\subset ',
  0xcd: '\\subseteq ',
  0xce: '\\in ',
  0xcf: '\\notin ',
  0xd0: '\\angle ',
  0xd1: '\\nabla ',
  0xd5: '\\prod ',
  0xd6: '\\sqrt{}',
  0xd7: '\\cdot ',
  0xd8: '\\neg ',
  0xd9: '\\land ',
  0xda: '\\lor ',
  0xdb: '\\Leftrightarrow ',
  0xdc: '\\Leftarrow ',
  0xde: '\\Rightarrow ',
  0xe5: '\\sum ',
  0xf2: '\\int ',
};

const UNICODE_TO_LATEX_MAP: Record<number, string> = {
  0x00a0: ' ',
  0x00b0: '^\\circ ',
  0x00b1: '\\pm ',
  0x00b7: '\\cdot ',
  0x00d7: '\\times ',
  0x00f7: '\\div ',
  0x0393: '\\Gamma ',
  0x0394: '\\Delta ',
  0x0398: '\\Theta ',
  0x039b: '\\Lambda ',
  0x039e: '\\Xi ',
  0x03a0: '\\Pi ',
  0x03a3: '\\Sigma ',
  0x03a6: '\\Phi ',
  0x03a8: '\\Psi ',
  0x03a9: '\\Omega ',
  0x03b1: '\\alpha ',
  0x03b2: '\\beta ',
  0x03b3: '\\gamma ',
  0x03b4: '\\delta ',
  0x03b5: '\\varepsilon ',
  0x03b6: '\\zeta ',
  0x03b7: '\\eta ',
  0x03b8: '\\theta ',
  0x03b9: '\\iota ',
  0x03ba: '\\kappa ',
  0x03bb: '\\lambda ',
  0x03bc: '\\mu ',
  0x03bd: '\\nu ',
  0x03be: '\\xi ',
  0x03c0: '\\pi ',
  0x03c1: '\\rho ',
  0x03c3: '\\sigma ',
  0x03c4: '\\tau ',
  0x03c5: '\\upsilon ',
  0x03c6: '\\phi ',
  0x03c7: '\\chi ',
  0x03c8: '\\psi ',
  0x03c9: '\\omega ',
  0x03d5: '\\varphi ',
  0x2026: '\\dots ',
  0x2032: "'",
  0x2033: "''",
  0x2190: '\\leftarrow ',
  0x2192: '\\rightarrow ',
  0x2194: '\\leftrightarrow ',
  0x21d0: '\\Leftarrow ',
  0x21d2: '\\Rightarrow ',
  0x21d4: '\\Leftrightarrow ',
  0x2200: '\\forall ',
  0x2202: '\\partial ',
  0x2203: '\\exists ',
  0x2205: '\\emptyset ',
  0x2207: '\\nabla ',
  0x2208: '\\in ',
  0x2209: '\\notin ',
  0x2212: '-',
  0x2213: '\\mp ',
  0x2217: '*',
  0x221a: '\\sqrt{}',
  0x221e: '\\infty ',
  0x2220: '\\angle ',
  0x2225: '\\parallel ',
  0x2227: '\\land ',
  0x2228: '\\lor ',
  0x2229: '\\cap ',
  0x222a: '\\cup ',
  0x222b: '\\int ',
  0x222c: '\\iint ',
  0x222d: '\\iiint ',
  0x222e: '\\oint ',
  0x2248: '\\approx ',
  0x2260: '\\ne ',
  0x2261: '\\equiv ',
  0x2264: '\\le ',
  0x2265: '\\ge ',
  0x2282: '\\subset ',
  0x2283: '\\supset ',
  0x2286: '\\subseteq ',
  0x2287: '\\supseteq ',
  0x22a5: '\\perp ',
  0x22c5: '\\cdot ',
  0x22ef: '\\cdots ',
  0x211d: '\\mathbb{R}',
  0x2115: '\\mathbb{N}',
  0x2124: '\\mathbb{Z}',
  0x211a: '\\mathbb{Q}',
  0x2102: '\\mathbb{C}',
};

function mapMtefCharToLatex(mtcode: number, typeface?: number, encChar?: number): string {
  // Symbol font (usually typeface 6 or 134 in MTEF)
  if (typeface === 6 || typeface === 134) {
    const code = encChar ?? (mtcode & 0xff);
    if (SYMBOL_FONT_TO_LATEX[code]) return SYMBOL_FONT_TO_LATEX[code];
  }
  if (UNICODE_TO_LATEX_MAP[mtcode]) {
    return UNICODE_TO_LATEX_MAP[mtcode];
  }
  if (mtcode >= 0x20 && mtcode <= 0x7e) {
    const ch = String.fromCharCode(mtcode);
    if (ch === '%' || ch === '#' || ch === '&' || ch === '$') return `\\${ch}`;
    return ch;
  }
  if (mtcode > 0x7e && mtcode < 0xe000) {
    return String.fromCharCode(mtcode);
  }
  // Private Use Area (0xE000..0xF8FF): check Symbol fallback
  if (encChar !== undefined && SYMBOL_FONT_TO_LATEX[encChar]) {
    return SYMBOL_FONT_TO_LATEX[encChar];
  }
  if (mtcode >= 0xf000 && mtcode <= 0xf0ff) {
    const low = mtcode & 0xff;
    if (SYMBOL_FONT_TO_LATEX[low]) return SYMBOL_FONT_TO_LATEX[low];
  }
  return '';
}

function applyEmbellishments(base: string, embells: number[]): string {
  let result = base;
  for (const emb of embells) {
    switch (emb) {
      case 2: // 1DOT
        result = `\\dot{${result}}`;
        break;
      case 3: // 2DOT
        result = `\\ddot{${result}}`;
        break;
      case 5: // PRIME
        result = `${result}'`;
        break;
      case 6: // 2PRIME
        result = `${result}''`;
        break;
      case 8: // TILDE
        result = `\\tilde{${result}}`;
        break;
      case 9: // HAT
        result = `\\widehat{${result}}`;
        break;
      case 11: // RARROW (vector)
        result = `\\vec{${result}}`;
        break;
      case 12: // LARROW
        result = `\\overleftarrow{${result}}`;
        break;
      case 13: // BARROW
        result = `\\overleftrightarrow{${result}}`;
        break;
      case 17: // OBAR
        result = `\\overline{${result}}`;
        break;
      case 18: // UBAR
        result = `\\underline{${result}}`;
        break;
      default:
        break;
    }
  }
  return result;
}

function renderTemplateToLatex(
  selector: number,
  variation: number,
  slots: string[]
): { latex: string; supported: boolean } {
  const s = (i: number) => (slots[i] ?? '').trim();

  switch (selector) {
    case 0: // tmANGLE
      return { latex: `\\left\\langle ${s(0)} \\right\\rangle`, supported: true };
    case 1: // tmPAREN
      return { latex: `\\left(${s(0)}\\right)`, supported: true };
    case 2: // tmBRACE
      if (variation === 1) {
        // Left brace only (system of equations / piecewise)
        return { latex: `\\left\\{ ${s(0)} \\right.`, supported: true };
      }
      return { latex: `\\left\\{${s(0)}\\right\\}`, supported: true };
    case 3: // tmBRACK
      return { latex: `\\left[${s(0)}\\right]`, supported: true };
    case 4: // tmBAR
      return { latex: `\\left|${s(0)}\\right|`, supported: true };
    case 5: // tmDBAR
      return { latex: `\\left\\|${s(0)}\\right\\|`, supported: true };
    case 6: // tmFLOOR
      return { latex: `\\left\\lfloor ${s(0)} \\right\\rfloor`, supported: true };
    case 7: // tmCEILING
      return { latex: `\\left\\lceil ${s(0)} \\right\\rceil`, supported: true };
    case 8: // tmLBLB [[ ... ]]
      return { latex: `\\left\\llbracket ${s(0)} \\right\\rrbracket`, supported: true };
    case 9: // tmRBRB
      return { latex: `\\left]${s(0)}\\right[`, supported: true };
    case 10: // tmROOT
      if (variation === 1 && s(1)) {
        return { latex: `\\sqrt[${s(1)}]{${s(0)}}`, supported: true };
      }
      return { latex: `\\sqrt{${s(0)}}`, supported: true };
    case 11: // tmFRACT
      if (variation & 0x02) {
        return { latex: `${s(0)}/${s(1)}`, supported: true };
      }
      return { latex: `\\frac{${s(0)}}{${s(1)}}`, supported: true };
    case 12: // tmUBAR
      return { latex: `\\underline{${s(0)}}`, supported: true };
    case 13: // tmOBAR
      return { latex: `\\overline{${s(0)}}`, supported: true };
    case 14: // tmARROW
      return { latex: `\\overrightarrow{${s(0)}}`, supported: true };
    case 15: // tmINTEG
    case 16: // tmSUM
    case 17: // tmPROD
    case 18: // tmCOPROD
    case 19: // tmUNION
    case 20: // tmINTER
    case 21: // tmINTOP
    case 22: {
      // tmSUMOP
      const opMap: Record<number, string> = {
        15: variation === 2 ? '\\iint' : variation === 3 ? '\\iiint' : variation & 0x04 ? '\\oint' : '\\int',
        16: '\\sum',
        17: '\\prod',
        18: '\\coprod',
        19: '\\bigcup',
        20: '\\bigcap',
        21: '\\int',
        22: '\\sum',
      };
      const op = opMap[selector] ?? '\\sum';
      const integrand = s(0);
      const lower = s(1);
      const upper = s(2);
      const lim = `${lower ? `_{${lower}}` : ''}${upper ? `^{${upper}}` : ''}`;
      return { latex: `${op}${lim} ${integrand}`.trim(), supported: true };
    }
    case 23: // tmLIM
      return {
        latex: `${s(0) || '\\lim'}${s(1) ? `_{${s(1)}}` : ''}${s(2) ? `^{${s(2)}}` : ''}`,
        supported: true,
      };
    case 24: // tmHBRACE
      return {
        latex: `\\overbrace{${s(0)}}${s(1) ? `^{${s(1)}}` : ''}`,
        supported: true,
      };
    case 25: // tmHBRACK
      return {
        latex: `\\underbrace{${s(0)}}${s(1) ? `_{${s(1)}}` : ''}`,
        supported: true,
      };
    case 27: // tmSUB
      return { latex: `_{${s(0)}}`, supported: true };
    case 28: // tmSUP
      return { latex: `^{${s(0)}}`, supported: true };
    case 29: // tmSUBSUP
      return {
        latex: `${s(0) ? `_{${s(0)}}` : ''}${s(1) ? `^{${s(1)}}` : ''}`,
        supported: true,
      };
    case 30: // tmDIRAC
      return { latex: `\\left\\langle ${s(0)} \\middle| ${s(1)} \\right\\rangle`, supported: true };
    case 31: // tmVEC
      return { latex: `\\overrightarrow{${s(0)}}`, supported: true };
    case 32: // tmHAT
      return { latex: `\\widehat{${s(0)}}`, supported: true };
    case 33: // tmARC
      return { latex: `\\overset{\\frown}{${s(0)}}`, supported: true };
    case 34: // tmJSTATUS
    case 35: // tmSTRIKE
      return { latex: s(0), supported: true };
    case 36: // tmBOX
      return { latex: `\\boxed{${s(0)}}`, supported: true };
    case 40: // tmINTERVAL_OPEN_LEFT ]a, b]
      return { latex: `\\left]${s(0)}\\right]`, supported: true };
    case 41: // tmINTERVAL_OPEN_RIGHT [a, b[
      return { latex: `\\left[${s(0)}\\right[`, supported: true };
    case 42: // tmINTERVAL_HALF_OPEN (a, b]
      return { latex: `\\left(${s(0)}\\right]`, supported: true };
    case 43: // tmINTERVAL_HALF_CLOSED [a, b)
      return { latex: `\\left[${s(0)}\\right)`, supported: true };
    default:
      return { latex: slots.filter(Boolean).join(' '), supported: false };
  }
}

export function isValidKatexLatex(latex: string): boolean {
  const trimmed = latex.trim();
  if (!trimmed) return false;
  try {
    katex.renderToString(trimmed, { throwOnError: true, strict: false });
    return true;
  } catch {
    return false;
  }
}

export function decodeMathTypeMtef(rawBytes: Uint8Array): {
  ok: boolean;
  latex?: string;
  unknownRecordCount: number;
  reason?: string;
} {
  if (!rawBytes || rawBytes.length < 6) {
    return { ok: false, unknownRecordCount: 0, reason: 'Dữ liệu MTEF quá ngắn hoặc rỗng.' };
  }

  let pos = 0;
  // Detect Equation Native 28-byte header (cbHdr = 28 at offset 0)
  const possibleCbHdr = readU16LE(rawBytes, 0);
  if (
    possibleCbHdr === 28 &&
    rawBytes.length > 33 &&
    (rawBytes[28] === 5 || rawBytes[28] === 3)
  ) {
    pos = 28;
  }

  const mtefVersion = rawBytes[pos];
  if (mtefVersion !== 5 && mtefVersion !== 3) {
    return {
      ok: false,
      unknownRecordCount: 0,
      reason: `Phiên bản MTEF không được hỗ trợ (${mtefVersion}).`,
    };
  }

  // Skip MTEF header
  pos += 5; // ver, platform, product, prodVer, prodSubVer
  if (mtefVersion === 5) {
    // MTEF v5 header has null-terminated application key string + inline options byte
    while (pos < rawBytes.length && rawBytes[pos] !== 0) pos += 1;
    pos += 1; // null terminator
    if (pos < rawBytes.length) pos += 1; // inline options byte
  }

  let unknownRecordCount = 0;
  let unsupportedTemplateCount = 0;
  const maxSteps = 20000;
  let steps = 0;

  const readByte = (): number => {
    if (pos >= rawBytes.length) return 0;
    return rawBytes[pos++];
  };

  const readU16 = (): number => {
    const v = readU16LE(rawBytes, pos);
    pos += 2;
    return v;
  };

  const readSignedInt = (): number => {
    // MTEF compressed signed int: if byte == 0xFF, followed by 2-byte signed int
    const b = readByte();
    if (b === 0xff) {
      const v = readI16LE(rawBytes, pos);
      pos += 2;
      return v;
    }
    return b - 128;
  };

  const skipNudge = () => {
    const dx = readByte();
    const dy = readByte();
    if (dx === 128 && dy === 128) {
      pos += 4;
    }
  };

  const skipNullString = () => {
    while (pos < rawBytes.length && rawBytes[pos] !== 0) pos += 1;
    if (pos < rawBytes.length) pos += 1;
  };

  const parseEmbellList = (): number[] => {
    const embells: number[] = [];
    while (pos < rawBytes.length && steps < maxSteps) {
      steps += 1;
      const tag = readByte();
      const recType = tag & 0x0f;
      if (recType === 0) break; // END
      if (recType === 6) {
        // EMBELL
        const opts = mtefVersion === 5 ? readByte() : (tag >> 4) & 0x0f;
        if (opts & 0x08) skipNudge();
        const embType = readByte();
        embells.push(embType);
      } else {
        unknownRecordCount += 1;
        break;
      }
    }
    return embells;
  };

  const parseObjectList = (): string[] => {
    const items: string[] = [];
    while (pos < rawBytes.length && steps < maxSteps) {
      steps += 1;
      const tag = readByte();
      const recType = tag & 0x0f;
      if (recType === 0) {
        // END
        break;
      }

      const opts = mtefVersion === 5 ? readByte() : (tag >> 4) & 0x0f;

      if (recType === 1) {
        // LINE
        if (opts & 0x08) skipNudge(); // xfLMOVE / nudge
        if (opts & 0x04) {
          // line spacing
          readU16();
        }
        if (opts & 0x02) {
          // RULER follows (skip ruler record if inline)
          const rTag = readByte();
          if ((rTag & 0x0f) === 7) {
            const nStops = readByte();
            for (let i = 0; i < nStops; i++) {
              readByte();
              readU16();
            }
          }
        }
        if (opts & 0x01) {
          // xfNULL — empty line
          items.push('');
        } else {
          const lineItems = parseObjectList();
          items.push(lineItems.join(''));
        }
      } else if (recType === 2) {
        // CHAR
        if (opts & 0x08) skipNudge();
        const typeface = readSignedInt();
        let mtcode = 0;
        let encChar: number | undefined;
        if (mtefVersion === 5) {
          if (!(opts & 0x04)) {
            mtcode = readU16();
          }
          if (opts & 0x10) {
            encChar = readByte();
          } else if (opts & 0x20) {
            encChar = readU16();
          }
        } else {
          encChar = readByte();
          mtcode = encChar;
        }
        let ch = mapMtefCharToLatex(mtcode, typeface, encChar);
        if (opts & 0x01) {
          // xfEMBELL
          const embells = parseEmbellList();
          ch = applyEmbellishments(ch, embells);
        }
        items.push(ch);
      } else if (recType === 3) {
        // TMPL
        if (opts & 0x08) skipNudge();
        const selector = readByte();
        let variation = readByte();
        if (mtefVersion === 5 && (variation & 0x80)) {
          const high = readByte();
          variation = (variation & 0x7f) | (high << 8);
        }
        readByte(); // template-specific options
        const slots = parseObjectList();
        const rendered = renderTemplateToLatex(selector, variation, slots);
        if (!rendered.supported) unsupportedTemplateCount += 1;
        items.push(rendered.latex);
      } else if (recType === 4) {
        // PILE
        if (opts & 0x08) skipNudge();
        readByte(); // halign
        readByte(); // valign
        if (opts & 0x02) {
          // ruler
          const rTag = readByte();
          if ((rTag & 0x0f) === 7) {
            const nStops = readByte();
            for (let i = 0; i < nStops; i++) {
              readByte();
              readU16();
            }
          }
        }
        const lines = parseObjectList();
        if (lines.length <= 1) {
          items.push(lines[0] ?? '');
        } else {
          items.push(`\\begin{array}{l}${lines.join(' \\\\ ')}\\end{array}`);
        }
      } else if (recType === 5) {
        // MATRIX
        if (opts & 0x08) skipNudge();
        readByte(); // valign
        readByte(); // h_just
        readByte(); // v_just
        const rows = Math.max(1, readByte());
        const cols = Math.max(1, readByte());
        // Skip row & column partition line bitfields
        const rowPartBytes = Math.ceil((rows + 1) / 4);
        const colPartBytes = Math.ceil((cols + 1) / 4);
        pos += rowPartBytes + colPartBytes;
        const cells = parseObjectList();
        const rowStrs: string[] = [];
        for (let r = 0; r < rows; r++) {
          const rowCells: string[] = [];
          for (let c = 0; c < cols; c++) {
            rowCells.push(cells[r * cols + c] ?? '');
          }
          rowStrs.push(rowCells.join(' & '));
        }
        const colSpec = 'c'.repeat(cols);
        items.push(`\\begin{array}{${colSpec}}${rowStrs.join(' \\\\ ')}\\end{array}`);
      } else if (recType === 7) {
        // RULER
        const nStops = readByte();
        for (let i = 0; i < nStops; i++) {
          readByte();
          readU16();
        }
      } else if (recType === 8) {
        // FONT_STYLE_DEF
        readByte();
        readByte();
      } else if (recType === 9) {
        // SIZE
        const lsize = readByte();
        if (lsize === 101) {
          pos += 2;
        } else if (lsize === 100) {
          pos += 3;
        } else {
          pos += 1;
        }
      } else if (recType >= 10 && recType <= 14) {
        // FULL / SUB / SUB2 / SYM / SUBSYM — single byte size switch
      } else if (recType === 15) {
        // COLOR
        readU16();
      } else if (recType === 16) {
        // COLOR_DEF
        const colorOpts = opts;
        const nVals = colorOpts & 0x01 ? 4 : 3;
        pos += nVals * 2;
        if (colorOpts & 0x04) skipNullString();
      } else if (recType === 17) {
        // FONT_DEF
        readByte(); // enc_def_index
        skipNullString();
      } else if (recType === 18) {
        // EQN_PREFS
        readByte(); // options
        const nSizes = readByte();
        // Skip nibble-packed dimensions carefully (conservative: abort if corrupted)
        let nibbleCount = 0;
        const skipDimensions = (count: number) => {
          let readDims = 0;
          while (readDims < count && pos < rawBytes.length) {
            const b = readByte();
            const hi = (b >> 4) & 0x0f;
            const lo = b & 0x0f;
            if (hi === 0x0f) readDims += 1;
            if (lo === 0x0f) readDims += 1;
            nibbleCount += 1;
            if (nibbleCount > 256) break;
          }
        };
        skipDimensions(nSizes);
        const nSpaces = readByte();
        skipDimensions(nSpaces);
        const nStyles = readByte();
        for (let i = 0; i < nStyles && pos < rawBytes.length; i++) {
          const f = readByte();
          if (f !== 0) readByte();
        }
      } else if (recType === 19) {
        // ENCODING_DEF
        skipNullString();
      } else if (recType === 20) {
        // FUTURE — unknown record
        unknownRecordCount += 1;
        break;
      } else {
        unknownRecordCount += 1;
        break;
      }
    }
    return items;
  };

  const parts = parseObjectList();
  const latex = parts.join('').replace(/\s+/g, ' ').trim();

  if (!latex) {
    return {
      ok: false,
      unknownRecordCount,
      reason: 'MTEF không sinh ra biểu thức văn bản/LaTeX nào.',
    };
  }

  if (unknownRecordCount > 0 || unsupportedTemplateCount > 0) {
    return {
      ok: false,
      latex,
      unknownRecordCount: unknownRecordCount + unsupportedTemplateCount,
      reason: `MTEF chứa ${unknownRecordCount + unsupportedTemplateCount} cấu trúc chưa giải mã hoàn toàn — không cho phép xuất tự động như LaTeX tin cậy.`,
    };
  }

  if (!isValidKatexLatex(latex)) {
    return {
      ok: false,
      latex,
      unknownRecordCount,
      reason: `Biểu thức LaTeX giải mã từ MTEF không vượt qua kiểm định KaTeX ("${latex.slice(0, 60)}").`,
    };
  }

  return { ok: true, latex, unknownRecordCount: 0 };
}

// ============================================================================
// 3. WMF-TO-SVG STATIC VECTOR CONVERTER (NO EXECUTION, VERIFIED NON-EMPTY SVG)
// ============================================================================

const WMF_SYMBOL_BYTE_TO_UNICODE: Record<number, string> = {
  0x22: '∀',
  0x24: '∃',
  0x2d: '−',
  0x44: 'Δ',
  0x46: 'Φ',
  0x47: 'Γ',
  0x4c: 'Λ',
  0x50: 'Π',
  0x51: 'Θ',
  0x53: 'Σ',
  0x57: 'Ω',
  0x61: 'α',
  0x62: 'β',
  0x64: 'δ',
  0x65: 'ε',
  0x66: 'φ',
  0x67: 'γ',
  0x68: 'η',
  0x6c: 'λ',
  0x6d: 'μ',
  0x6e: 'ν',
  0x70: 'π',
  0x71: 'θ',
  0x72: 'ρ',
  0x73: 'σ',
  0x74: 'τ',
  0x77: 'ω',
  0xa3: '≤',
  0xa5: '∞',
  0xac: '←',
  0xae: '→',
  0xb0: '°',
  0xb1: '±',
  0xb3: '≥',
  0xb4: '×',
  0xb7: '·',
  0xb8: '÷',
  0xb9: '≠',
  0xba: '≡',
  0xbb: '≈',
  0xc6: '∅',
  0xc7: '∩',
  0xc8: '∪',
  0xcc: '⊂',
  0xcd: '⊆',
  0xce: '∈',
  0xcf: '∉',
  0xd6: '√',
  0xdb: '⇔',
  0xde: '⇒',
  0xe5: '∑',
  0xf2: '∫',
};

interface WmfPen {
  kind: 'pen';
  style: number; // 5 = PS_NULL
  width: number;
  color: string;
}

interface WmfBrush {
  kind: 'brush';
  style: number; // 1 = BS_NULL
  color: string;
}

interface WmfFont {
  kind: 'font';
  height: number;
  italic: boolean;
  bold: boolean;
  faceName: string;
}

type WmfGdiObj = WmfPen | WmfBrush | WmfFont | null;

function colorRefToHex(bytes: Uint8Array, offset: number): string {
  const r = bytes[offset] ?? 0;
  const g = bytes[offset + 1] ?? 0;
  const b = bytes[offset + 2] ?? 0;
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function decodeWmfTextBytes(raw: Uint8Array, faceName: string): string {
  const isSymbolFont = /^symbol$/i.test(faceName.trim());
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b === 0) break;
    if (isSymbolFont && WMF_SYMBOL_BYTE_TO_UNICODE[b]) {
      out += WMF_SYMBOL_BYTE_TO_UNICODE[b];
    } else if (b >= 0x20 && b <= 0x7e) {
      out += String.fromCharCode(b);
    } else if (b >= 0xa0) {
      // Windows-1252 subset fallback
      out += String.fromCharCode(b);
    }
  }
  return out;
}

export function convertWmfToSvg(wmfBytes: Uint8Array): WmfToSvgResult {
  if (!wmfBytes || wmfBytes.length < 22) {
    return { ok: false, primitiveCount: 0, reason: 'Tệp WMF quá ngắn hoặc không hợp lệ.' };
  }

  let offset = 0;
  let bboxLeft = 0;
  let bboxTop = 0;
  let bboxRight = 0;
  let bboxBottom = 0;
  let hasPlaceableBBox = false;
  let unitsPerInch = 96;

  // Check Aldus Placeable Metafile Header (0x9AC6CDD7)
  if (readU32LE(wmfBytes, 0) === 0x9ac6cdd7) {
    bboxLeft = readI16LE(wmfBytes, 6);
    bboxTop = readI16LE(wmfBytes, 8);
    bboxRight = readI16LE(wmfBytes, 10);
    bboxBottom = readI16LE(wmfBytes, 12);
    unitsPerInch = readU16LE(wmfBytes, 14) || 96;
    hasPlaceableBBox = true;
    offset = 22;
  }

  if (offset + 18 > wmfBytes.length) {
    return { ok: false, primitiveCount: 0, reason: 'Thiếu header chuẩn WMF (18 byte).' };
  }

  const metaType = readU16LE(wmfBytes, offset);
  const headerSizeWords = readU16LE(wmfBytes, offset + 2);
  if ((metaType !== 1 && metaType !== 2) || headerSizeWords < 9) {
    return {
      ok: false,
      primitiveCount: 0,
      reason: `Header WMF không hợp lệ (type=${metaType}, headerSize=${headerSizeWords}).`,
    };
  }
  offset += headerSizeWords * 2;

  let winOrgX = hasPlaceableBBox ? bboxLeft : 0;
  let winOrgY = hasPlaceableBBox ? bboxTop : 0;
  let winExtX = hasPlaceableBBox ? bboxRight - bboxLeft : 0;
  let winExtY = hasPlaceableBBox ? bboxBottom - bboxTop : 0;

  let curX = 0;
  let curY = 0;
  let textColor = '#111827';
  let textAlign = 0;
  let polyFillRule: 'evenodd' | 'nonzero' = 'evenodd';

  let activePen: WmfPen = { kind: 'pen', style: 0, width: 1, color: '#111827' };
  let activeBrush: WmfBrush = { kind: 'brush', style: 1, color: 'none' };
  let activeFont: WmfFont = {
    kind: 'font',
    height: 14,
    italic: false,
    bold: false,
    faceName: 'Times New Roman',
  };

  const objectTable: WmfGdiObj[] = [];
  const allocObject = (obj: WmfGdiObj) => {
    const freeIdx = objectTable.findIndex((o) => o === null);
    if (freeIdx >= 0) objectTable[freeIdx] = obj;
    else objectTable.push(obj);
  };

  interface DcSnapshot {
    winOrgX: number;
    winOrgY: number;
    winExtX: number;
    winExtY: number;
    curX: number;
    curY: number;
    textColor: string;
    textAlign: number;
    polyFillRule: 'evenodd' | 'nonzero';
    activePen: WmfPen;
    activeBrush: WmfBrush;
    activeFont: WmfFont;
  }
  const dcStack: DcSnapshot[] = [];

  const primitives: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const trackPoint = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const strokeAttr = () => {
    if (activePen.style === 5) return 'stroke="none"';
    const sw = Math.max(1, activePen.width);
    const dash = activePen.style === 1 ? ' stroke-dasharray="6,4"' : activePen.style === 2 ? ' stroke-dasharray="2,3"' : '';
    return `stroke="${activePen.color}" stroke-width="${sw}"${dash}`;
  };

  const fillAttr = () => {
    if (activeBrush.style === 1) return 'fill="none"';
    return `fill="${activeBrush.color}"`;
  };

  let recordsProcessed = 0;
  const maxRecords = 25000;

  while (offset + 6 <= wmfBytes.length && recordsProcessed < maxRecords) {
    recordsProcessed += 1;
    const sizeWords = readU32LE(wmfBytes, offset);
    const fn = readU16LE(wmfBytes, offset + 4);
    if (fn === 0x0000) break; // META_EOF
    if (sizeWords < 3 || offset + sizeWords * 2 > wmfBytes.length) break;

    const p = offset + 6;
    switch (fn) {
      case 0x020b: {
        // META_SETWINDOWORG (y, x)
        winOrgY = readI16LE(wmfBytes, p);
        winOrgX = readI16LE(wmfBytes, p + 2);
        break;
      }
      case 0x020c: {
        // META_SETWINDOWEXT (y, x)
        winExtY = readI16LE(wmfBytes, p);
        winExtX = readI16LE(wmfBytes, p + 2);
        break;
      }
      case 0x020f: {
        // META_OFFSETWINDOWORG
        winOrgY += readI16LE(wmfBytes, p);
        winOrgX += readI16LE(wmfBytes, p + 2);
        break;
      }
      case 0x0209: {
        // META_SETTEXTCOLOR
        textColor = colorRefToHex(wmfBytes, p);
        break;
      }
      case 0x012e: {
        // META_SETTEXTALIGN
        textAlign = readU16LE(wmfBytes, p);
        break;
      }
      case 0x0106: {
        // META_SETPOLYFILLMODE
        polyFillRule = readU16LE(wmfBytes, p) === 2 ? 'nonzero' : 'evenodd';
        break;
      }
      case 0x001e: {
        // META_SAVEDC
        dcStack.push({
          winOrgX,
          winOrgY,
          winExtX,
          winExtY,
          curX,
          curY,
          textColor,
          textAlign,
          polyFillRule,
          activePen: { ...activePen },
          activeBrush: { ...activeBrush },
          activeFont: { ...activeFont },
        });
        break;
      }
      case 0x0127: {
        // META_RESTOREDC
        const snap = dcStack.pop();
        if (snap) {
          winOrgX = snap.winOrgX;
          winOrgY = snap.winOrgY;
          winExtX = snap.winExtX;
          winExtY = snap.winExtY;
          curX = snap.curX;
          curY = snap.curY;
          textColor = snap.textColor;
          textAlign = snap.textAlign;
          polyFillRule = snap.polyFillRule;
          activePen = snap.activePen;
          activeBrush = snap.activeBrush;
          activeFont = snap.activeFont;
        }
        break;
      }
      case 0x02fa: {
        // META_CREATEPENINDIRECT
        const style = readU16LE(wmfBytes, p);
        const width = Math.abs(readI16LE(wmfBytes, p + 2)) || 1;
        const color = colorRefToHex(wmfBytes, p + 6);
        allocObject({ kind: 'pen', style, width, color });
        break;
      }
      case 0x02fc: {
        // META_CREATEBRUSHINDIRECT
        const style = readU16LE(wmfBytes, p);
        const color = colorRefToHex(wmfBytes, p + 2);
        allocObject({ kind: 'brush', style, color });
        break;
      }
      case 0x02fb: {
        // META_CREATEFONTINDIRECT
        const height = Math.abs(readI16LE(wmfBytes, p)) || 14;
        const weight = readU16LE(wmfBytes, p + 8);
        const italic = wmfBytes[p + 10] !== 0;
        const nameMax = Math.min(32, offset + sizeWords * 2 - (p + 18));
        let faceName = '';
        for (let i = 0; i < nameMax; i++) {
          const ch = wmfBytes[p + 18 + i];
          if (ch === 0) break;
          faceName += String.fromCharCode(ch);
        }
        allocObject({
          kind: 'font',
          height,
          italic,
          bold: weight >= 600,
          faceName: faceName || 'Times New Roman',
        });
        break;
      }
      case 0x012d: {
        // META_SELECTOBJECT
        const idx = readU16LE(wmfBytes, p);
        const obj = objectTable[idx];
        if (obj) {
          if (obj.kind === 'pen') activePen = obj;
          else if (obj.kind === 'brush') activeBrush = obj;
          else if (obj.kind === 'font') activeFont = obj;
        }
        break;
      }
      case 0x01f0: {
        // META_DELETEOBJECT
        const idx = readU16LE(wmfBytes, p);
        if (idx < objectTable.length) objectTable[idx] = null;
        break;
      }
      case 0x0214: {
        // META_MOVETO (y, x)
        curY = readI16LE(wmfBytes, p);
        curX = readI16LE(wmfBytes, p + 2);
        trackPoint(curX, curY);
        break;
      }
      case 0x0213: {
        // META_LINETO (y, x)
        const ny = readI16LE(wmfBytes, p);
        const nx = readI16LE(wmfBytes, p + 2);
        trackPoint(curX, curY);
        trackPoint(nx, ny);
        primitives.push(
          `<line x1="${curX}" y1="${curY}" x2="${nx}" y2="${ny}" ${strokeAttr()} stroke-linecap="round" />`
        );
        curX = nx;
        curY = ny;
        break;
      }
      case 0x0325: {
        // META_POLYLINE
        const n = readU16LE(wmfBytes, p);
        const pts: string[] = [];
        for (let i = 0; i < n && p + 2 + i * 4 + 4 <= offset + sizeWords * 2; i++) {
          const x = readI16LE(wmfBytes, p + 2 + i * 4);
          const y = readI16LE(wmfBytes, p + 2 + i * 4 + 2);
          trackPoint(x, y);
          pts.push(`${x},${y}`);
        }
        if (pts.length >= 2) {
          primitives.push(
            `<polyline points="${pts.join(' ')}" fill="none" ${strokeAttr()} stroke-linejoin="round" stroke-linecap="round" />`
          );
        }
        break;
      }
      case 0x0324: {
        // META_POLYGON
        const n = readU16LE(wmfBytes, p);
        const pts: string[] = [];
        for (let i = 0; i < n && p + 2 + i * 4 + 4 <= offset + sizeWords * 2; i++) {
          const x = readI16LE(wmfBytes, p + 2 + i * 4);
          const y = readI16LE(wmfBytes, p + 2 + i * 4 + 2);
          trackPoint(x, y);
          pts.push(`${x},${y}`);
        }
        if (pts.length >= 2) {
          primitives.push(
            `<polygon points="${pts.join(' ')}" ${fillAttr()} ${strokeAttr()} fill-rule="${polyFillRule}" />`
          );
        }
        break;
      }
      case 0x0538: {
        // META_POLYPOLYGON
        const numPolys = readU16LE(wmfBytes, p);
        const counts: number[] = [];
        for (let i = 0; i < numPolys; i++) {
          counts.push(readU16LE(wmfBytes, p + 2 + i * 2));
        }
        let ptOff = p + 2 + numPolys * 2;
        const dParts: string[] = [];
        for (const cnt of counts) {
          for (let i = 0; i < cnt && ptOff + 4 <= offset + sizeWords * 2; i++) {
            const x = readI16LE(wmfBytes, ptOff);
            const y = readI16LE(wmfBytes, ptOff + 2);
            ptOff += 4;
            trackPoint(x, y);
            dParts.push(`${i === 0 ? 'M' : 'L'}${x} ${y}`);
          }
          if (cnt > 0) dParts.push('Z');
        }
        if (dParts.length > 0) {
          primitives.push(
            `<path d="${dParts.join(' ')}" ${fillAttr()} ${strokeAttr()} fill-rule="${polyFillRule}" />`
          );
        }
        break;
      }
      case 0x041b:
      case 0x061c: {
        // META_RECTANGLE / META_ROUNDRECT (bottom, right, top, left)
        const base = fn === 0x061c ? p + 4 : p;
        const bottom = readI16LE(wmfBytes, base);
        const right = readI16LE(wmfBytes, base + 2);
        const top = readI16LE(wmfBytes, base + 4);
        const left = readI16LE(wmfBytes, base + 6);
        const x = Math.min(left, right);
        const y = Math.min(top, bottom);
        const w = Math.abs(right - left);
        const h = Math.abs(bottom - top);
        trackPoint(x, y);
        trackPoint(x + w, y + h);
        if (w > 0 || h > 0) {
          primitives.push(
            `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${fillAttr()} ${strokeAttr()} />`
          );
        }
        break;
      }
      case 0x0418: {
        // META_ELLIPSE (bottom, right, top, left)
        const bottom = readI16LE(wmfBytes, p);
        const right = readI16LE(wmfBytes, p + 2);
        const top = readI16LE(wmfBytes, p + 4);
        const left = readI16LE(wmfBytes, p + 6);
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const rx = Math.abs(right - left) / 2;
        const ry = Math.abs(bottom - top) / 2;
        trackPoint(left, top);
        trackPoint(right, bottom);
        if (rx > 0 || ry > 0) {
          primitives.push(
            `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${fillAttr()} ${strokeAttr()} />`
          );
        }
        break;
      }
      case 0x0521: {
        // META_TEXTOUT: len (2), text (padded to even), y (2), x (2)
        const strLen = readU16LE(wmfBytes, p);
        const paddedLen = strLen + (strLen % 2);
        if (strLen > 0 && p + 2 + paddedLen + 4 <= offset + sizeWords * 2) {
          const rawStr = wmfBytes.subarray(p + 2, p + 2 + strLen);
          const y = readI16LE(wmfBytes, p + 2 + paddedLen);
          const x = readI16LE(wmfBytes, p + 2 + paddedLen + 2);
          const txt = decodeWmfTextBytes(rawStr, activeFont.faceName);
          if (txt.trim()) {
            const fs = Math.max(8, activeFont.height);
            const baselineShift = (textAlign & 0x18) === 0x18 ? 0 : Math.round(fs * 0.85);
            trackPoint(x, y);
            trackPoint(x + txt.length * fs * 0.6, y + fs);
            const italicAttr = activeFont.italic ? ' font-style="italic"' : '';
            const boldAttr = activeFont.bold ? ' font-weight="bold"' : '';
            primitives.push(
              `<text x="${x}" y="${y + baselineShift}" fill="${textColor}" font-family="Cambria Math, Times New Roman, serif" font-size="${fs}"${italicAttr}${boldAttr}>${escapeXmlText(txt)}</text>`
            );
          }
        }
        break;
      }
      case 0x0a32: {
        // META_EXTTEXTOUT: y (2), x (2), len (2), fwOpts (2), [clipRect 8], text...
        const y = readI16LE(wmfBytes, p);
        const x = readI16LE(wmfBytes, p + 2);
        const strLen = readU16LE(wmfBytes, p + 4);
        const fwOpts = readU16LE(wmfBytes, p + 6);
        const hasClipRect = Boolean(fwOpts & 0x0006);
        const strStart = p + 8 + (hasClipRect ? 8 : 0);
        if (strLen > 0 && strStart + strLen <= offset + sizeWords * 2) {
          const rawStr = wmfBytes.subarray(strStart, strStart + strLen);
          const txt = decodeWmfTextBytes(rawStr, activeFont.faceName);
          if (txt.trim()) {
            const fs = Math.max(8, activeFont.height);
            const baselineShift = (textAlign & 0x18) === 0x18 ? 0 : Math.round(fs * 0.85);
            trackPoint(x, y);
            trackPoint(x + txt.length * fs * 0.6, y + fs);
            const italicAttr = activeFont.italic ? ' font-style="italic"' : '';
            const boldAttr = activeFont.bold ? ' font-weight="bold"' : '';
            primitives.push(
              `<text x="${x}" y="${y + baselineShift}" fill="${textColor}" font-family="Cambria Math, Times New Roman, serif" font-size="${fs}"${italicAttr}${boldAttr}>${escapeXmlText(txt)}</text>`
            );
          }
        }
        break;
      }
      default:
        break;
    }

    offset += sizeWords * 2;
  }

  if (primitives.length === 0) {
    return {
      ok: false,
      primitiveCount: 0,
      reason: 'Tệp WMF không chứa đối tượng vẽ/chữ hiển thị hợp lệ nào (trống hoặc chỉ chứa lệnh bitmap/raster không hỗ trợ).',
    };
  }

  let vx = winOrgX;
  let vy = winOrgY;
  let vw = winExtX;
  let vh = winExtY;

  if (vw <= 0 || vh <= 0) {
    if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX) {
      const pad = Math.max(4, Math.round((maxX - minX) * 0.04));
      vx = minX - pad;
      vy = minY - pad;
      vw = maxX - minX + pad * 2;
      vh = Math.max(12, maxY - minY + pad * 2);
    } else {
      return {
        ok: false,
        primitiveCount: primitives.length,
        reason: 'Không xác định được kích thước khung hình (viewBox) hợp lệ cho tệp WMF.',
      };
    }
  }

  // Convert logical units to readable CSS px (bounded cleanly)
  const scale = unitsPerInch > 0 ? 96 / unitsPerInch : 1;
  const pxWidth = Math.max(16, Math.min(960, Math.round(vw * scale) || vw));
  const pxHeight = Math.max(14, Math.min(720, Math.round(vh * scale) || vh));

  const svgMarkup = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${pxWidth}" height="${pxHeight}" role="img">`,
    ...primitives,
    `</svg>`,
  ].join('');

  const svgDataUrl = `data:image/svg+xml;base64,${encodeBase64Utf8(svgMarkup)}`;

  return {
    ok: true,
    svgMarkup,
    svgDataUrl,
    width: pxWidth,
    height: pxHeight,
    primitiveCount: primitives.length,
  };
}

// ============================================================================
// 4. UNIFIED OLE FORMULA DECODER (MTEF PRIMARY → VERIFIED WMF SVG FALLBACK)
// ============================================================================

export function decodeOleFormulaPayload(params: {
  oleBytes?: Uint8Array | null;
  wmfPreviewBytes?: Uint8Array | null;
  progId?: string;
}): OleFormulaDecodeResult {
  const { oleBytes, wmfPreviewBytes, progId } = params;

  // Step 1: Try static CFBF/OLE2 -> 'Equation Native' -> MTEF -> KaTeX-verified LaTeX
  let mtefReason: string | undefined;
  let unknownRecordCount = 0;
  if (oleBytes && oleBytes.length > 0) {
    const eqNative = extractOle2Stream(oleBytes, 'Equation Native');
    if (eqNative) {
      const mtef = decodeMathTypeMtef(eqNative);
      unknownRecordCount = mtef.unknownRecordCount;
      if (mtef.ok && mtef.latex) {
        return {
          mode: 'ole-mtef-latex',
          displayable: true,
          machineReadable: true,
          latex: mtef.latex,
          unknownRecordCount: 0,
          progId,
        };
      }
      mtefReason = mtef.reason;
    } else {
      mtefReason = 'Không tìm thấy luồng "Equation Native" trong đối tượng OLE nhúng.';
    }
  } else {
    mtefReason = 'Thiếu tệp nhị phân OLE (embeddings/oleObject*.bin).';
  }

  // Step 2: Static WMF preview fallback -> verified non-empty SVG (displayable=true, machineReadable=false)
  if (wmfPreviewBytes && wmfPreviewBytes.length > 0) {
    const wmf = convertWmfToSvg(wmfPreviewBytes);
    if (wmf.ok && wmf.svgDataUrl && wmf.svgMarkup) {
      return {
        mode: 'ole-wmf-svg-preview',
        displayable: true,
        machineReadable: false,
        svgDataUrl: wmf.svgDataUrl,
        svgMarkup: wmf.svgMarkup,
        reason: mtefReason || 'Đã dựng ảnh vector SVG từ WMF preview (chưa có biểu thức LaTeX máy đọc được).',
        unknownRecordCount,
        progId,
      };
    }
    return {
      mode: 'unresolved-ole',
      displayable: false,
      machineReadable: false,
      reason: `${mtefReason ?? 'Không đọc được MTEF.'} Fallback WMF cũng thất bại: ${wmf.reason ?? 'WMF không hợp lệ.'}`,
      unknownRecordCount,
      progId,
    };
  }

  return {
    mode: 'unresolved-ole',
    displayable: false,
    machineReadable: false,
    reason: mtefReason || 'Không thể giải mã đối tượng công thức OLE và không có WMF preview hợp lệ.',
    unknownRecordCount,
    progId,
  };
}
