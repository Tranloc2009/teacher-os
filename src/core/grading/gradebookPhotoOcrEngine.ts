import type {
  GradebookColumnMapping,
  NormalizedRect,
  OcrGradebookRow,
  OcrTableCell,
  PhotoCropRegion,
  RgbaImageBuffer,
} from '../../types/grading';

/**
 * Bản thiết kế bitmap cơ sở 7x7 cho chữ cái Latin, chữ số và dấu câu.
 * Được đặt vào vùng giữa (hàng 3..9, cột 1..7) của khung glyph chuẩn 9x13,
 * còn hàng 0..2 dành cho dấu mũ/dấu thanh tiếng Việt và hàng 10..12 dành cho chân chữ / dấu nặng.
 */
const BASE_GLYPHS_7X7: Record<string, readonly string[]> = {
  '0': ['0111110', '1100011', '1100111', '1101011', '1110011', '1100011', '0111110'],
  '1': ['0001100', '0011100', '0101100', '0001100', '0001100', '0001100', '0111111'],
  '2': ['0111110', '1100011', '0000011', '0001110', '0110000', '1100000', '1111111'],
  '3': ['0111110', '1100011', '0000011', '0011110', '0000011', '1100011', '0111110'],
  '4': ['0000110', '0001110', '0010110', '0100110', '1111111', '0000110', '0000110'],
  '5': ['1111111', '1100000', '1111110', '0000011', '0000011', '1100011', '0111110'],
  '6': ['0011110', '0110000', '1100000', '1111110', '1100011', '1100011', '0111110'],
  '7': ['1111111', '1100011', '0000110', '0001100', '0011000', '0011000', '0011000'],
  '8': ['0111110', '1100011', '1100011', '0111110', '1100011', '1100011', '0111110'],
  '9': ['0111110', '1100011', '1100011', '0111111', '0000011', '0000110', '0111100'],
  ',': ['0000000', '0000000', '0000000', '0000000', '0001100', '0001100', '0011000'],
  '.': ['0000000', '0000000', '0000000', '0000000', '0000000', '0011100', '0011100'],
  '-': ['0000000', '0000000', '0000000', '0111110', '0000000', '0000000', '0000000'],
  '/': ['0000011', '0000110', '0001100', '0011000', '0110000', '1100000', '1000000'],
  ':': ['0000000', '0011000', '0011000', '0000000', '0011000', '0011000', '0000000'],
  '?': ['0111110', '1100011', '0000110', '0001100', '0001100', '0000000', '0001100'],
  '(': ['0001100', '0011000', '0110000', '0110000', '0110000', '0011000', '0001100'],
  ')': ['0011000', '0001100', '0000110', '0000110', '0000110', '0001100', '0011000'],
  A: ['0011100', '0110110', '1100011', '1100011', '1111111', '1100011', '1100011'],
  B: ['1111110', '1100011', '1100011', '1111110', '1100011', '1100011', '1111110'],
  C: ['0111110', '1100011', '1100000', '1100000', '1100000', '1100011', '0111110'],
  D: ['1111100', '1100110', '1100011', '1100011', '1100011', '1100110', '1111100'],
  E: ['1111111', '1100000', '1100000', '1111110', '1100000', '1100000', '1111111'],
  F: ['1111111', '1100000', '1100000', '1111110', '1100000', '1100000', '1100000'],
  G: ['0111110', '1100011', '1100000', '1101111', '1100011', '1100011', '0111110'],
  H: ['1100011', '1100011', '1100011', '1111111', '1100011', '1100011', '1100011'],
  I: ['0111110', '0001100', '0001100', '0001100', '0001100', '0001100', '0111110'],
  J: ['0011111', '0000110', '0000110', '0000110', '1100110', '1100110', '0111100'],
  K: ['1100011', '1100110', '1101100', '1111000', '1101100', '1100110', '1100011'],
  L: ['1100000', '1100000', '1100000', '1100000', '1100000', '1100000', '1111111'],
  M: ['1100011', '1110111', '1111111', '1101011', '1100011', '1100011', '1100011'],
  N: ['1100011', '1110011', '1111011', '1101111', '1100111', '1100011', '1100011'],
  O: ['0111110', '1100011', '1100011', '1100011', '1100011', '1100011', '0111110'],
  P: ['1111110', '1100011', '1100011', '1111110', '1100000', '1100000', '1100000'],
  Q: ['0111110', '1100011', '1100011', '1100011', '1101011', '1100110', '0111011'],
  R: ['1111110', '1100011', '1100011', '1111110', '1101100', '1100110', '1100011'],
  S: ['0111110', '1100011', '1100000', '0111110', '0000011', '1100011', '0111110'],
  T: ['1111111', '0001100', '0001100', '0001100', '0001100', '0001100', '0001100'],
  U: ['1100011', '1100011', '1100011', '1100011', '1100011', '1100011', '0111110'],
  V: ['1100011', '1100011', '1100011', '1100011', '0110110', '0011100', '0001000'],
  W: ['1100011', '1100011', '1100011', '1101011', '1111111', '1110111', '1100011'],
  X: ['1100011', '0110110', '0011100', '0011100', '0011100', '0110110', '1100011'],
  Y: ['1100011', '0110110', '0011100', '0001100', '0001100', '0001100', '0001100'],
  Z: ['1111111', '0000110', '0001100', '0011000', '0110000', '1100000', '1111111'],
  a: ['0000000', '0000000', '0111100', '0000110', '0111110', '1100110', '0111111'],
  b: ['1100000', '1100000', '1111100', '1100110', '1100110', '1100110', '1111100'],
  c: ['0000000', '0000000', '0111110', '1100000', '1100000', '1100011', '0111110'],
  d: ['0000110', '0000110', '0111110', '1100110', '1100110', '1100110', '0111110'],
  e: ['0000000', '0000000', '0111110', '1100011', '1111111', '1100000', '0111110'],
  f: ['0011110', '0110000', '1111100', '0110000', '0110000', '0110000', '0110000'],
  g: ['0000000', '0000000', '0111110', '1100110', '1100110', '0111110', '0000110'],
  h: ['1100000', '1100000', '1111100', '1100110', '1100110', '1100110', '1100110'],
  i: ['0001100', '0000000', '0011100', '0001100', '0001100', '0001100', '0011110'],
  j: ['0000110', '0000000', '0001110', '0000110', '0000110', '1100110', '0111100'],
  k: ['1100000', '1100000', '1100110', '1101100', '1111000', '1101100', '1100110'],
  l: ['0011100', '0001100', '0001100', '0001100', '0001100', '0001100', '0011110'],
  m: ['0000000', '0000000', '1110110', '1111111', '1101011', '1101011', '1100011'],
  n: ['0000000', '0000000', '1111100', '1100110', '1100110', '1100110', '1100110'],
  o: ['0000000', '0000000', '0111100', '1100110', '1100110', '1100110', '0111100'],
  p: ['0000000', '0000000', '1111100', '1100110', '1100110', '1111100', '1100000'],
  q: ['0000000', '0000000', '0111110', '1100110', '1100110', '0111110', '0000110'],
  r: ['0000000', '0000000', '1101110', '1110011', '1100000', '1100000', '1100000'],
  s: ['0000000', '0000000', '0111110', '1100000', '0111100', '0000110', '1111100'],
  t: ['0011000', '0011000', '1111110', '0011000', '0011000', '0011010', '0001100'],
  u: ['0000000', '0000000', '1100110', '1100110', '1100110', '1100110', '0111110'],
  v: ['0000000', '0000000', '1100011', '1100011', '0110110', '0011100', '0001000'],
  w: ['0000000', '0000000', '1100011', '1101011', '1111111', '1110111', '0100010'],
  x: ['0000000', '0000000', '1100110', '0111100', '0011000', '0111100', '1100110'],
  y: ['0000000', '0000000', '1100110', '1100110', '1100110', '0111110', '0000110'],
  z: ['0000000', '0000000', '1111110', '0001100', '0011000', '0110000', '1111110'],
};

type ToneKind = 'none' | 'acute' | 'grave' | 'hook' | 'tilde' | 'dot';
type ModKind = 'none' | 'circumflex' | 'breve' | 'horn' | 'stroke';

interface DecomposedVietChar {
  base: string;
  mod: ModKind;
  tone: ToneKind;
}

const VIET_CHAR_GROUPS: Array<{
  baseUpper: string;
  baseLower: string;
  mod: ModKind;
  tones: readonly [string, string, string, string, string, string]; // [none, acute, grave, hook, tilde, dot]
}> = [
  {
    baseUpper: 'A',
    baseLower: 'a',
    mod: 'none',
    tones: ['Aa', 'Áá', 'Àà', 'Ảả', 'Ãã', 'Ạạ'],
  },
  {
    baseUpper: 'A',
    baseLower: 'a',
    mod: 'breve',
    tones: ['Ăă', 'Ắắ', 'Ằằ', 'Ẳẳ', 'Ẵẵ', 'Ặặ'],
  },
  {
    baseUpper: 'A',
    baseLower: 'a',
    mod: 'circumflex',
    tones: ['Ââ', 'Ấấ', 'Ầầ', 'Ẩẩ', 'Ẫẫ', 'Ậậ'],
  },
  {
    baseUpper: 'E',
    baseLower: 'e',
    mod: 'none',
    tones: ['Ee', 'Éé', 'Èè', 'Ẻẻ', 'Ẽẽ', 'Ẹẹ'],
  },
  {
    baseUpper: 'E',
    baseLower: 'e',
    mod: 'circumflex',
    tones: ['Êê', 'Ếế', 'Ềề', 'Ểể', 'Ễễ', 'Ệệ'],
  },
  {
    baseUpper: 'I',
    baseLower: 'i',
    mod: 'none',
    tones: ['Ii', 'Íí', 'Ìì', 'Ỉỉ', 'Ĩĩ', 'Ịị'],
  },
  {
    baseUpper: 'O',
    baseLower: 'o',
    mod: 'none',
    tones: ['Oo', 'Óó', 'Òò', 'Ỏỏ', 'Õõ', 'Ọọ'],
  },
  {
    baseUpper: 'O',
    baseLower: 'o',
    mod: 'circumflex',
    tones: ['Ôô', 'Ốố', 'Ồồ', 'Ổổ', 'Ỗỗ', 'Ộộ'],
  },
  {
    baseUpper: 'O',
    baseLower: 'o',
    mod: 'horn',
    tones: ['Ơơ', 'Ớớ', 'Ờờ', 'Ởở', 'Ỡỡ', 'Ợợ'],
  },
  {
    baseUpper: 'U',
    baseLower: 'u',
    mod: 'none',
    tones: ['Uu', 'Úú', 'Ùù', 'Ủủ', 'Ũũ', 'Ụụ'],
  },
  {
    baseUpper: 'U',
    baseLower: 'u',
    mod: 'horn',
    tones: ['Ưư', 'Ứứ', 'Ừừ', 'Ửử', 'Ữữ', 'Ựự'],
  },
  {
    baseUpper: 'Y',
    baseLower: 'y',
    mod: 'none',
    tones: ['Yy', 'Ýý', 'Ỳỳ', 'Ỷỷ', 'Ỹỹ', 'Ỵỵ'],
  },
];

const TONE_KEYS: readonly ToneKind[] = [
  'none',
  'acute',
  'grave',
  'hook',
  'tilde',
  'dot',
];

const VIET_DECOMPOSE_MAP = new Map<string, DecomposedVietChar>();
for (const grp of VIET_CHAR_GROUPS) {
  grp.tones.forEach((pair, idx) => {
    const tone = TONE_KEYS[idx];
    const upper = pair[0];
    const lower = pair[1];
    VIET_DECOMPOSE_MAP.set(upper, { base: grp.baseUpper, mod: grp.mod, tone });
    VIET_DECOMPOSE_MAP.set(lower, { base: grp.baseLower, mod: grp.mod, tone });
  });
}
VIET_DECOMPOSE_MAP.set('Đ', { base: 'D', mod: 'stroke', tone: 'none' });
VIET_DECOMPOSE_MAP.set('đ', { base: 'd', mod: 'stroke', tone: 'none' });

export const GLYPH_WIDTH = 9;
export const GLYPH_HEIGHT = 13;

export interface GlyphTemplateEntry {
  char: string;
  bits: Uint8Array; // length = GLYPH_WIDTH * GLYPH_HEIGHT (117)
  inkCount: number;
}

/**
 * Tạo ma trận 9x13 bit chuẩn cho bất kỳ ký tự chữ số, chữ cái tiếng Việt hoặc dấu câu nào.
 */
export function buildCanonicalGlyphBitmap(ch: string): Uint8Array {
  const bits = new Uint8Array(GLYPH_WIDTH * GLYPH_HEIGHT);
  const decomp = VIET_DECOMPOSE_MAP.get(ch) ?? {
    base: ch,
    mod: 'none' as ModKind,
    tone: 'none' as ToneKind,
  };

  const basePattern = BASE_GLYPHS_7X7[decomp.base];
  if (!basePattern) return bits;

  const setBit = (x: number, y: number) => {
    if (x >= 0 && x < GLYPH_WIDTH && y >= 0 && y < GLYPH_HEIGHT) {
      bits[y * GLYPH_WIDTH + x] = 1;
    }
  };

  // Vẽ thân ký tự 7x7 vào hàng 3..9, cột 1..7
  for (let r = 0; r < 7; r += 1) {
    const rowStr = basePattern[r];
    for (let c = 0; c < 7; c += 1) {
      if (rowStr[c] === '1') {
        setBit(c + 1, r + 3);
      }
    }
  }

  // Chân chữ cho g, j, p, q, y
  if (decomp.base === 'g' || decomp.base === 'q' || decomp.base === 'y') {
    setBit(6, 10);
    setBit(5, 11);
    setBit(4, 11);
  } else if (decomp.base === 'p') {
    setBit(2, 10);
    setBit(2, 11);
  } else if (decomp.base === 'j') {
    setBit(5, 10);
    setBit(4, 11);
  }

  // Dấu phụ (mod): circumflex (^), breve (v), horn (+), stroke (Đ/đ)
  if (decomp.mod === 'circumflex') {
    setBit(4, 1);
    setBit(3, 2);
    setBit(5, 2);
  } else if (decomp.mod === 'breve') {
    setBit(2, 1);
    setBit(6, 1);
    setBit(3, 2);
    setBit(4, 2);
    setBit(5, 2);
  } else if (decomp.mod === 'horn') {
    setBit(8, 2);
    setBit(8, 3);
    setBit(7, 4);
  } else if (decomp.mod === 'stroke') {
    setBit(0, 6);
    setBit(1, 6);
    setBit(2, 6);
    setBit(3, 6);
    setBit(4, 6);
  }

  // Dấu thanh (tone): acute (/), grave (\), hook (?), tilde (~), dot (.)
  if (decomp.tone === 'acute') {
    setBit(6, 0);
    setBit(5, 1);
  } else if (decomp.tone === 'grave') {
    setBit(2, 0);
    setBit(3, 1);
  } else if (decomp.tone === 'hook') {
    setBit(4, 0);
    setBit(5, 0);
    setBit(5, 1);
  } else if (decomp.tone === 'tilde') {
    setBit(2, 0);
    setBit(3, 1);
    setBit(5, 0);
    setBit(6, 1);
  } else if (decomp.tone === 'dot') {
    setBit(4, 11);
    setBit(4, 12);
    setBit(5, 11);
  }

  return bits;
}

const ALL_SUPPORTED_CHARS = [
  ...Object.keys(BASE_GLYPHS_7X7),
  ...Array.from(VIET_DECOMPOSE_MAP.keys()),
];

const UNIQUE_SUPPORTED_CHARS = Array.from(new Set(ALL_SUPPORTED_CHARS));

export const GLYPH_ATLAS: readonly GlyphTemplateEntry[] = UNIQUE_SUPPORTED_CHARS.map(
  (char) => {
    const bits = buildCanonicalGlyphBitmap(char);
    let inkCount = 0;
    for (let i = 0; i < bits.length; i += 1) inkCount += bits[i];
    return { char, bits, inkCount };
  }
).filter((e) => e.inkCount > 0);

// ============================================================================
// SYNTHETIC GRADEBOOK PHOTO GENERATOR (PIXEL-LEVEL TABLE FIXTURE ENGINE)
// ============================================================================

export interface SyntheticGradebookCellOverride {
  rowIndex: number; // 0-based data row index
  columnIndex: number;
  /** Làm mờ / nhòe chữ viết tay không rõ nét để kiểm thử cờ uncertain/unreadable */
  lowContrastIntensity?: number; // 0..1 (ví dụ 0.18 cho vết mực mờ)
  handwrittenNoise?: boolean;
}

export interface SyntheticGradebookPhotoOptions {
  headers: string[];
  rows: string[][];
  /** Góc nghiêng nhẹ của bảng điểm (-4.5 .. +4.5 độ) */
  skewDegrees?: number;
  /** Góc xoay 0 / 90 / 180 / 270 độ */
  rotateDeg?: 0 | 90 | 180 | 270;
  /** Tùy chỉnh nhiễu/mờ trên từng ô cụ thể */
  cellOverrides?: SyntheticGradebookCellOverride[];
  /** Hệ số phóng pixel của mỗi điểm glyph (mặc định 2 => mỗi ký tự 18x26 px) */
  pixelScale?: number;
}

function setGrayPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  lum: number
) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = (y * width + x) * 4;
  data[idx] = lum;
  data[idx + 1] = lum;
  data[idx + 2] = lum;
  data[idx + 3] = 255;
}

function drawTextBitmapInCell(
  data: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number,
  text: string,
  scale: number,
  inkLum: number,
  handwrittenNoise = false
) {
  const clean = text.trim();
  if (!clean) return;
  const charStepX = (GLYPH_WIDTH + 2) * scale;
  const glyphPixelH = GLYPH_HEIGHT * scale;
  const startX = cellX + 8 * scale;
  const startY = cellY + Math.max(2 * scale, Math.floor((cellH - glyphPixelH) / 2));

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === ' ') continue;
    const gx0 = startX + i * charStepX;
    if (gx0 + GLYPH_WIDTH * scale >= cellX + cellW - 2 * scale) break;

    const bitmap = buildCanonicalGlyphBitmap(ch);
    for (let gy = 0; gy < GLYPH_HEIGHT; gy += 1) {
      for (let gx = 0; gx < GLYPH_WIDTH; gx += 1) {
        if (bitmap[gy * GLYPH_WIDTH + gx] === 1) {
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              setGrayPixel(
                data,
                imgWidth,
                imgHeight,
                gx0 + gx * scale + sx,
                startY + gy * scale + sy,
                inkLum
              );
            }
          }
        } else if (handwrittenNoise && (gx + gy + i) % 3 === 0) {
          // Thêm nét nguệch ngoạc giả lập chữ viết tay không rõ nét
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              setGrayPixel(
                data,
                imgWidth,
                imgHeight,
                gx0 + gx * scale + sx,
                startY + gy * scale + sy,
                Math.min(220, inkLum + 45)
              );
            }
          }
        }
      }
    }
  }
}

function rotateRgbaImage(
  img: RgbaImageBuffer,
  deg: 0 | 90 | 180 | 270
): RgbaImageBuffer {
  if (deg === 0) return img;
  const { width, height, data } = img;
  if (deg === 180) {
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const src = (y * width + x) * 4;
        const dst = ((height - 1 - y) * width + (width - 1 - x)) * 4;
        out[dst] = data[src];
        out[dst + 1] = data[src + 1];
        out[dst + 2] = data[src + 2];
        out[dst + 3] = 255;
      }
    }
    return { width, height, data: out };
  }
  const newW = height;
  const newH = width;
  const out = new Uint8ClampedArray(newW * newH * 4);
  if (deg === 90) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const src = (y * width + x) * 4;
        const dst = (x * newW + (height - 1 - y)) * 4;
        out[dst] = data[src];
        out[dst + 1] = data[src + 1];
        out[dst + 2] = data[src + 2];
        out[dst + 3] = 255;
      }
    }
    return { width: newW, height: newH, data: out };
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = ((width - 1 - x) * newW + y) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { width: newW, height: newH, data: out };
}

export function rotateArbitraryAngleRgba(
  img: RgbaImageBuffer,
  angleDegrees: number
): RgbaImageBuffer {
  if (Math.abs(angleDegrees) < 0.05) return img;
  const { width, height, data } = img;
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = width / 2;
  const cy = height / 2;
  const out = new Uint8ClampedArray(data.length);
  out.fill(255);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      // Inverse mapping từ đích về nguồn
      const sx = Math.round(dx * cos + dy * sin + cx);
      const sy = Math.round(-dx * sin + dy * cos + cy);
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const srcIdx = (sy * width + sx) * 4;
        const dstIdx = (y * width + x) * 4;
        out[dstIdx] = data[srcIdx];
        out[dstIdx + 1] = data[srcIdx + 1];
        out[dstIdx + 2] = data[srcIdx + 2];
        out[dstIdx + 3] = 255;
      }
    }
  }
  return { width, height, data: out };
}

/**
 * Kết xuất ảnh bảng điểm thực tế ở mức pixel (có đường kẻ bảng, tiêu đề cột,
 * dấu tiếng Việt, số thập phân dấu phẩy/chấm, nghiêng nhẹ hoặc ô mờ) để kiểm thử
 * pipeline OCR thị giác máy tính cục bộ.
 */
export function synthesizeGradebookTableImage(
  options: SyntheticGradebookPhotoOptions
): RgbaImageBuffer {
  const scale = options.pixelScale ?? 2;
  const colCount = Math.max(
    options.headers.length,
    ...options.rows.map((r) => r.length)
  );
  const allRows = [options.headers, ...options.rows];

  // Tính độ rộng cột theo độ dài chuỗi tối đa trong từng cột
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c += 1) {
    let maxChars = 4;
    for (const r of allRows) {
      const len = (r[c] ?? '').trim().length;
      if (len > maxChars) maxChars = len;
    }
    colWidths.push((maxChars * (GLYPH_WIDTH + 2) + 18) * scale);
  }

  const rowHeight = (GLYPH_HEIGHT + 12) * scale;
  const margin = 24 * scale;
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const tableHeight = allRows.length * rowHeight;
  const width = tableWidth + margin * 2;
  const height = tableHeight + margin * 2;

  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  const lineThickness = Math.max(2, scale);

  // Vẽ đường kẻ ngang của bảng
  for (let r = 0; r <= allRows.length; r += 1) {
    const y0 = margin + r * rowHeight;
    for (let t = 0; t < lineThickness; t += 1) {
      for (let x = margin; x <= margin + tableWidth; x += 1) {
        setGrayPixel(data, width, height, x, y0 + t, 20);
      }
    }
  }

  // Vẽ đường kẻ dọc của bảng
  let accX = margin;
  for (let c = 0; c <= colCount; c += 1) {
    for (let t = 0; t < lineThickness; t += 1) {
      for (let y = margin; y <= margin + tableHeight; y += 1) {
        setGrayPixel(data, width, height, accX + t, y, 20);
      }
    }
    if (c < colCount) accX += colWidths[c];
  }

  // Vẽ chữ từng ô
  for (let r = 0; r < allRows.length; r += 1) {
    let cellX = margin;
    const cellY = margin + r * rowHeight;
    const rowCells = allRows[r];
    for (let c = 0; c < colCount; c += 1) {
      const cellW = colWidths[c];
      const text = rowCells[c] ?? '';
      const override =
        r > 0
          ? options.cellOverrides?.find(
              (ov) => ov.rowIndex === r - 1 && ov.columnIndex === c
            )
          : undefined;
      const intensity = override?.lowContrastIntensity ?? 0.92;
      const inkLum = Math.round(255 * (1 - Math.max(0.05, Math.min(1, intensity))));

      drawTextBitmapInCell(
        data,
        width,
        height,
        cellX,
        cellY,
        cellW,
        rowHeight,
        text,
        scale,
        inkLum,
        Boolean(override?.handwrittenNoise)
      );
      cellX += cellW;
    }
  }

  let img: RgbaImageBuffer = { width, height, data };
  if (options.skewDegrees && Math.abs(options.skewDegrees) > 0.05) {
    img = rotateArbitraryAngleRgba(img, options.skewDegrees);
  }
  if (options.rotateDeg) {
    img = rotateRgbaImage(img, options.rotateDeg);
  }
  return img;
}

// ============================================================================
// STAGE 1 & 2: LOCAL TABLE VISION & GLYPH OCR PIPELINE
// ============================================================================

export interface LocalPhotoOcrPipelineOptions {
  rotationDeg?: 0 | 90 | 180 | 270;
  cropRegion?: PhotoCropRegion;
  /** Ngưỡng độ đậm pixel để coi là nét mực (mặc định 215 trên thang 0..255) */
  inkMaxLumThreshold?: number;
  onProgress?: (percent: number, stageLabel: string) => void;
}

export interface LocalPhotoOcrPipelineResult {
  detectedSkewDeg: number;
  imageWidth: number;
  imageHeight: number;
  headerCells: string[];
  rows: Array<{
    rowIndex: number;
    bbox: NormalizedRect;
    cells: OcrTableCell[];
  }>;
  isHandwrittenSuspected: boolean;
  warnings: string[];
  processingTimeMs: number;
}

function cropRgbaImage(
  img: RgbaImageBuffer,
  crop?: PhotoCropRegion
): { cropped: RgbaImageBuffer; offsetX: number; offsetY: number } {
  if (
    !crop ||
    (crop.x <= 0.001 &&
      crop.y <= 0.001 &&
      crop.width >= 0.999 &&
      crop.height >= 0.999)
  ) {
    return { cropped: img, offsetX: 0, offsetY: 0 };
  }
  const x0 = Math.max(0, Math.min(img.width - 10, Math.round(crop.x * img.width)));
  const y0 = Math.max(0, Math.min(img.height - 10, Math.round(crop.y * img.height)));
  const w = Math.max(10, Math.min(img.width - x0, Math.round(crop.width * img.width)));
  const h = Math.max(
    10,
    Math.min(img.height - y0, Math.round(crop.height * img.height))
  );

  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = ((y0 + y) * img.width + (x0 + x)) * 4;
      const dst = (y * w + x) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { cropped: { width: w, height: h, data: out }, offsetX: x0, offsetY: y0 };
}

/**
 * Ước lượng góc nghiêng bảng điểm trong khoảng [-5.5°, +5.5°] bằng cách tìm góc
 * tối đa hóa phương sai mật độ đường kẻ ngang (horizontal projection energy).
 */
export function estimateTableSkewAngleDeg(img: RgbaImageBuffer): number {
  const { width, height, data } = img;
  const cx = width / 2;
  const cy = height / 2;
  const stepX = Math.max(1, Math.floor(width / 180));
  const stepY = Math.max(1, Math.floor(height / 180));

  let bestAngle = 0;
  let bestEnergy = -1;

  for (let angle = -5.0; angle <= 5.0; angle += 0.5) {
    const rad = (-angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rowCounts = new Float64Array(height);

    for (let y = 0; y < height; y += stepY) {
      const dy = y - cy;
      for (let x = 0; x < width; x += stepX) {
        const lum = data[(y * width + x) * 4];
        if (lum < 140) {
          const dx = x - cx;
          const ry = Math.round(dx * sin + dy * cos + cy);
          if (ry >= 0 && ry < height) {
            rowCounts[ry] += 1;
          }
        }
      }
    }

    let energy = 0;
    for (let y = 0; y < height; y += stepY) {
      energy += rowCounts[y] * rowCounts[y];
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestAngle = angle;
    }
  }

  return Math.abs(bestAngle) < 0.3 ? 0 : bestAngle;
}

function mergeClosePositions(positions: number[], minGap: number): number[] {
  if (positions.length === 0) return [];
  const sorted = [...positions].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prevCluster = clusters[clusters.length - 1];
    if (sorted[i] - prevCluster[prevCluster.length - 1] <= minGap) {
      prevCluster.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }
  return clusters.map((cl) =>
    Math.round(cl.reduce((a, b) => a + b, 0) / cl.length)
  );
}

/**
 * Tìm tọa độ đường kẻ ngang (row dividers) và đường kẻ dọc (column dividers) của bảng điểm.
 */
export function detectTableGridLines(img: RgbaImageBuffer): {
  horizontalLines: number[];
  verticalLines: number[];
} {
  const { width, height, data } = img;

  // Tìm vùng bao của các pixel tối (bảng điểm)
  let minDarkX = width;
  let maxDarkX = 0;
  let minDarkY = height;
  let maxDarkY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4] < 120) {
        if (x < minDarkX) minDarkX = x;
        if (x > maxDarkX) maxDarkX = x;
        if (y < minDarkY) minDarkY = y;
        if (y > maxDarkY) maxDarkY = y;
      }
    }
  }

  const spanW = Math.max(1, maxDarkX - minDarkX);
  const spanH = Math.max(1, maxDarkY - minDarkY);

  const rawHorizontal: number[] = [];
  for (let y = minDarkY; y <= maxDarkY; y += 1) {
    let darkCount = 0;
    for (let x = minDarkX; x <= maxDarkX; x += 1) {
      if (data[(y * width + x) * 4] < 120) darkCount += 1;
    }
    if (darkCount >= spanW * 0.52) {
      rawHorizontal.push(y);
    }
  }

  const horizontalLines = mergeClosePositions(rawHorizontal, 8);
  const topY = horizontalLines[0] ?? minDarkY;
  const botY = horizontalLines[horizontalLines.length - 1] ?? maxDarkY;
  const tableH = Math.max(1, botY - topY);

  const rawVertical: number[] = [];
  for (let x = minDarkX; x <= maxDarkX; x += 1) {
    let darkCount = 0;
    for (let y = topY; y <= botY; y += 1) {
      if (data[(y * width + x) * 4] < 120) darkCount += 1;
    }
    if (darkCount >= tableH * 0.52) {
      rawVertical.push(x);
    }
  }

  const verticalLines = mergeClosePositions(rawVertical, 10);
  return { horizontalLines, verticalLines };
}

interface RecognizedCellContent {
  text: string;
  confidence: number;
  unreadable: boolean;
  uncertain: boolean;
}

/**
 * Nhận diện chuỗi ký tự trong 1 ô bảng điểm bằng phân đoạn cột ký tự (connected columns)
 * kết hợp so khớp ma trận chuẩn 9x13 của toàn bộ bảng chữ cái tiếng Việt & chữ số.
 */
function recognizeCellPixels(
  img: RgbaImageBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  inkMaxLum: number
): RecognizedCellContent {
  const { width, data } = img;
  const padX = Math.max(3, Math.round((x1 - x0) * 0.025));
  const padY = Math.max(3, Math.round((y1 - y0) * 0.08));
  const cx0 = Math.min(x1 - 1, x0 + padX);
  const cx1 = Math.max(cx0 + 1, x1 - padX);
  const cy0 = Math.min(y1 - 1, y0 + padY);
  const cy1 = Math.max(cy0 + 1, y1 - padY);

  // Tìm các cột X có chứa mực
  const colHasInk: boolean[] = [];
  let minLumInCell = 255;
  let totalInkPixels = 0;

  for (let x = cx0; x <= cx1; x += 1) {
    let hasInk = false;
    for (let y = cy0; y <= cy1; y += 1) {
      const lum = data[(y * width + x) * 4];
      if (lum < inkMaxLum) {
        hasInk = true;
        totalInkPixels += 1;
        if (lum < minLumInCell) minLumInCell = lum;
      }
    }
    colHasInk.push(hasInk);
  }

  if (totalInkPixels === 0) {
    return {
      text: '',
      confidence: 1,
      unreadable: false,
      uncertain: false,
    };
  }

  // Gom các cột liền nhau thành từng segment ký tự theo trục X
  const segments: Array<{ startX: number; endX: number }> = [];
  let inSeg = false;
  let segStart = cx0;
  for (let i = 0; i < colHasInk.length; i += 1) {
    const x = cx0 + i;
    if (colHasInk[i] && !inSeg) {
      inSeg = true;
      segStart = x;
    } else if (!colHasInk[i] && inSeg) {
      inSeg = false;
      segments.push({ startX: segStart, endX: x - 1 });
    }
  }
  if (inSeg) {
    segments.push({ startX: segStart, endX: cx1 });
  }

  if (segments.length === 0) {
    return { text: '', confidence: 1, unreadable: false, uncertain: false };
  }

  // Ước lượng hệ số scale từ chiều rộng segment trung vị
  const segWidths = segments.map((s) => s.endX - s.startX + 1);
  const sortedW = [...segWidths].sort((a, b) => a - b);
  const medianW = sortedW[Math.floor(sortedW.length / 2)] ?? 14;
  const estScale = Math.max(1, Math.round(medianW / 7));

  // Tìm biên trên/dưới toàn dòng trong ô để giữ chuẩn vị trí dấu câu (',' vs '.') và dấu thanh
  let rowMinY = cy1;
  let rowMaxY = cy0;
  for (let y = cy0; y <= cy1; y += 1) {
    for (let x = cx0; x <= cx1; x += 1) {
      if (data[(y * width + x) * 4] < inkMaxLum) {
        if (y < rowMinY) rowMinY = y;
        if (y > rowMaxY) rowMaxY = y;
      }
    }
  }

  const cellH = cy1 - cy0 + 1;
  const glyphPixelH = GLYPH_HEIGHT * estScale;
  const canonicalStartY =
    cy0 + Math.max(2 * estScale, Math.floor((cellH - glyphPixelH) / 2));

  const chars: string[] = [];
  let sumConf = 0;
  let charCount = 0;

  for (let idx = 0; idx < segments.length; idx += 1) {
    const seg = segments[idx];
    if (idx > 0) {
      const gap = seg.startX - segments[idx - 1].endX - 1;
      if (gap >= 5 * estScale) {
        chars.push(' ');
      }
    }

    // Tìm điểm khớp tốt nhất quanh lân cận (dx, dy) để bù sai số cắt biên 1-2px
    let bestChar = '?';
    let bestScore = -Infinity;
    let secondBestScore = -Infinity;

    const baseCharX = seg.startX - 1 * estScale;
    const candidateOffsets: Array<{ dx: number; dy: number }> = [
      { dx: 0, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -estScale, dy: 0 },
      { dx: estScale, dy: 0 },
    ];

    for (const entry of GLYPH_ATLAS) {
      let entryBest = -Infinity;
      for (const off of candidateOffsets) {
        const ox = baseCharX + off.dx;
        const oy = canonicalStartY + off.dy;
        let matchInk = 0;
        let falseInk = 0;
        let missedInk = 0;

        for (let gy = 0; gy < GLYPH_HEIGHT; gy += 1) {
          const py = oy + gy * estScale + Math.floor(estScale / 2);
          for (let gx = 0; gx < GLYPH_WIDTH; gx += 1) {
            const px = ox + gx * estScale + Math.floor(estScale / 2);
            const hasInk =
              px >= cx0 &&
              px <= cx1 &&
              py >= cy0 &&
              py <= cy1 &&
              data[(py * width + px) * 4] < inkMaxLum;
            const expected = entry.bits[gy * GLYPH_WIDTH + gx] === 1;
            if (expected && hasInk) matchInk += 1;
            else if (!expected && hasInk) falseInk += 1;
            else if (expected && !hasInk) missedInk += 1;
          }
        }

        const union = matchInk + falseInk + missedInk;
        const iou = union > 0 ? matchInk / union : 0;
        if (iou > entryBest) entryBest = iou;
      }

      if (entryBest > bestScore) {
        secondBestScore = bestScore;
        bestScore = entryBest;
        bestChar = entry.char;
      } else if (entryBest > secondBestScore) {
        secondBestScore = entryBest;
      }
    }

    // Hệ số độ tương phản mực thực tế (mực quá nhạt => hạ độ tin cậy để chuyển qua REVIEW_REQUIRED)
    const contrastFactor = Math.max(0.2, Math.min(1, (240 - minLumInCell) / 150));
    const charConfidence = Math.max(0, Math.min(1, bestScore * contrastFactor));

    chars.push(bestChar);
    sumConf += charConfidence;
    charCount += 1;
  }

  const avgConf = charCount > 0 ? sumConf / charCount : 1;
  const recognizedText = chars.join('').replace(/\s+/g, ' ').trim();
  const unreadable = avgConf < 0.38 || recognizedText.includes('?');
  const uncertain = avgConf < 0.72 || minLumInCell > 175;

  return {
    text: recognizedText,
    confidence: Number(avgConf.toFixed(3)),
    unreadable,
    uncertain,
  };
}

/**
 * Chạy pipeline thị giác máy tính + OCR bảng điểm lớp cục bộ 100% trên trình duyệt / Node.
 */
export function runLocalGradebookPhotoOcrPipeline(
  sourceImg: RgbaImageBuffer,
  options: LocalPhotoOcrPipelineOptions = {}
): LocalPhotoOcrPipelineResult {
  const t0 = performance.now();
  const warnings: string[] = [];
  const inkMaxLum = options.inkMaxLumThreshold ?? 218;

  options.onProgress?.(10, 'Đang xoay & cắt vùng bảng điểm...');
  const rotated = options.rotationDeg
    ? rotateRgbaImage(sourceImg, options.rotationDeg)
    : sourceImg;
  const { cropped } = cropRgbaImage(rotated, options.cropRegion);

  options.onProgress?.(25, 'Đang ước lượng góc nghiêng và khử nghiêng bảng...');
  const detectedSkewDeg = estimateTableSkewAngleDeg(cropped);
  const deskewed =
    Math.abs(detectedSkewDeg) >= 0.3
      ? rotateArbitraryAngleRgba(cropped, -detectedSkewDeg)
      : cropped;

  options.onProgress?.(45, 'Đang phân đoạn lưới hàng & cột của bảng điểm...');
  let { horizontalLines, verticalLines } = detectTableGridLines(deskewed);

  if (horizontalLines.length < 2 || verticalLines.length < 2) {
    warnings.push(
      'Ảnh thiếu đường kẻ bảng rõ ràng — hệ thống đã chia vùng lưới ước lượng, vui lòng kiểm tra lại cấu trúc cột.'
    );
    if (horizontalLines.length < 2) {
      const estRows = 5;
      horizontalLines = Array.from({ length: estRows + 1 }, (_, i) =>
        Math.round((i / estRows) * (deskewed.height - 20) + 10)
      );
    }
    if (verticalLines.length < 2) {
      const estCols = 5;
      verticalLines = Array.from({ length: estCols + 1 }, (_, i) =>
        Math.round((i / estCols) * (deskewed.width - 20) + 10)
      );
    }
  }

  const totalTableRows = horizontalLines.length - 1;
  const totalCols = verticalLines.length - 1;

  // Hàng 0 là hàng tiêu đề cột
  const headerCells: string[] = [];
  for (let c = 0; c < totalCols; c += 1) {
    const rec = recognizeCellPixels(
      deskewed,
      verticalLines[c],
      horizontalLines[0],
      verticalLines[c + 1],
      horizontalLines[1],
      inkMaxLum
    );
    headerCells.push(rec.text || `Cột ${c + 1}`);
  }

  // Các hàng 1..totalTableRows-1 là hàng học sinh
  const dataRows: LocalPhotoOcrPipelineResult['rows'] = [];
  let lowConfCellCount = 0;
  let nonBlankCellCount = 0;

  for (let r = 1; r < totalTableRows; r += 1) {
    const dataRowIdx = r - 1;
    const y0 = horizontalLines[r];
    const y1 = horizontalLines[r + 1];
    const pct = 50 + Math.round((r / Math.max(1, totalTableRows - 1)) * 45);
    options.onProgress?.(
      pct,
      `Đang nhận diện OCR dòng học sinh ${r}/${totalTableRows - 1}...`
    );

    const rowBbox: NormalizedRect = {
      x: verticalLines[0] / deskewed.width,
      y: y0 / deskewed.height,
      width: (verticalLines[totalCols] - verticalLines[0]) / deskewed.width,
      height: (y1 - y0) / deskewed.height,
    };

    const cells: OcrTableCell[] = [];
    for (let c = 0; c < totalCols; c += 1) {
      const x0 = verticalLines[c];
      const x1 = verticalLines[c + 1];
      const rec = recognizeCellPixels(deskewed, x0, y0, x1, y1, inkMaxLum);
      if (rec.text.length > 0) {
        nonBlankCellCount += 1;
        if (rec.uncertain || rec.unreadable) lowConfCellCount += 1;
      }

      cells.push({
        rowIndex: dataRowIdx,
        columnIndex: c,
        rawText: rec.text,
        confidence: rec.confidence,
        bbox: {
          x: x0 / deskewed.width,
          y: y0 / deskewed.height,
          width: (x1 - x0) / deskewed.width,
          height: (y1 - y0) / deskewed.height,
        },
        unreadable: rec.unreadable,
        uncertain: rec.uncertain,
      });
    }

    // Bỏ qua dòng hoàn toàn không có chữ ở mọi cột
    if (cells.some((cell) => cell.rawText.trim().length > 0)) {
      dataRows.push({
        rowIndex: dataRowIdx,
        bbox: rowBbox,
        cells,
      });
    }
  }

  const isHandwrittenSuspected =
    nonBlankCellCount > 0 && lowConfCellCount / nonBlankCellCount >= 0.35;
  if (isHandwrittenSuspected) {
    warnings.push(
      'Phát hiện nhiều ô có nét chữ viết tay hoặc độ tương phản thấp. Hệ thống KHÔNG tự suy đoán điểm viết tay — vui lòng kiểm tra và xác nhận thủ công từng dòng.'
    );
  }

  options.onProgress?.(100, 'Hoàn tất nhận diện bảng điểm.');
  return {
    detectedSkewDeg,
    imageWidth: deskewed.width,
    imageHeight: deskewed.height,
    headerCells,
    rows: dataRows,
    isHandwrittenSuspected,
    warnings,
    processingTimeMs: Math.round(performance.now() - t0),
  };
}

/**
 * Tự động gợi ý ánh xạ cột từ tiêu đề bảng OCR (không mặc định cứng cột 3 là Điểm).
 * Giáo viên luôn phải xác nhận cấu trúc cột trước khi đưa vào Sổ điểm.
 */
export function inferSmartColumnMappings(
  headerCells: string[]
): GradebookColumnMapping[] {
  const normalize = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]/g, '');

  const usedRoles = new Set<string>();

  return headerCells.map((rawHeader, idx) => {
    const h = normalize(rawHeader);
    let role: GradebookColumnMapping['role'] = 'ignore';

    if (
      !usedRoles.has('stt') &&
      (h === 'stt' || h === 'tt' || h === 'sothutu' || h === 'no')
    ) {
      role = 'stt';
    } else if (
      !usedRoles.has('studentId') &&
      (h.includes('mahs') ||
        h.includes('mahocsinh') ||
        h.includes('sbd') ||
        h.includes('studentid') ||
        h === 'id' ||
        h === 'ma')
    ) {
      role = 'studentId';
    } else if (
      !usedRoles.has('lastName') &&
      (h === 'hodem' || h === 'ho' || h === 'holot')
    ) {
      role = 'lastName';
    } else if (!usedRoles.has('firstName') && h === 'ten') {
      role = 'firstName';
    } else if (
      !usedRoles.has('fullName') &&
      (h.includes('hoten') ||
        h.includes('hovaten') ||
        h.includes('tenhocsinh') ||
        h.includes('fullname'))
    ) {
      role = 'fullName';
    } else if (
      !usedRoles.has('className') &&
      (h === 'lop' || h.includes('tenlop') || h === 'class')
    ) {
      role = 'className';
    } else if (
      !usedRoles.has('examCode') &&
      (h.includes('made') || h === 'code')
    ) {
      role = 'examCode';
    } else if (
      !usedRoles.has('score') &&
      (h.includes('diem') || h.includes('score') || h === 'kq')
    ) {
      role = 'score';
    } else if (
      !usedRoles.has('notes') &&
      (h.includes('ghichu') || h.includes('nhanxet') || h.includes('note'))
    ) {
      role = 'notes';
    }

    if (role !== 'ignore') usedRoles.add(role);

    return {
      columnIndex: idx,
      headerText: rawHeader || `Cột ${idx + 1}`,
      customLabel: rawHeader || `Cột ${idx + 1}`,
      role,
      displayOrder: idx,
    };
  });
}
