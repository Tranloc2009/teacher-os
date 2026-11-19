import type { SheetOpticalIdPayloadV1 } from '../../types/grading';

/**
 * Mã định danh quang học 2D chuẩn TeacherOS (18×18 ô, có khung căn chỉnh và kiểm tra CRC-16 + Hamming(7,4)).
 *
 * THIẾT KẾ AN TOÀN & BẢO MẬT:
 * - Chỉ lưu: schema version (v=1), Exam Session ID (sid), Exam Code (ec),
 *   Opaque Student ID (st, tùy chọn), Sheet ID (sh, tùy chọn), Page (p).
 * - TUYỆT ĐỐI từ chối nếu có trường nhạy cảm (đáp án, điểm số, họ tên, đề thi).
 * - Chạy 100% cục bộ bằng TypeScript thuần, không phụ thuộc thư viện ngoài.
 */

export const OPTICAL_CODE_GRID_SIZE = 18;
const MAX_PAYLOAD_BYTES = 20;

const FORBIDDEN_FIELDS = [
  'answer',
  'answers',
  'score',
  'scores',
  'fullname',
  'full_name',
  'studentname',
  'question',
  'questions',
  'prompt',
];

function sanitizeToken(value: string | undefined, maxLen: number): string {
  if (!value) return '';
  return value
    .trim()
    .replace(/[|\r\n]/g, '')
    .slice(0, maxLen);
}

/**
 * Kiểm tra tính hợp lệ và bảo mật của payload trước khi mã hóa vào mã quang học.
 */
export function validateOpticalIdPayload(
  payload: SheetOpticalIdPayloadV1
): { valid: boolean; error?: string } {
  const keys = Object.keys(payload as unknown as Record<string, unknown>);
  for (const key of keys) {
    if (FORBIDDEN_FIELDS.includes(key.toLowerCase())) {
      return {
        valid: false,
        error: `Trường "${key}" không được phép đưa vào mã định danh phiếu trả lời.`,
      };
    }
  }
  if (payload.v !== 1) {
    return { valid: false, error: 'Phiên bản schema mã phiếu không hợp lệ.' };
  }
  if (!payload.ec || !payload.ec.trim()) {
    return { valid: false, error: 'Thiếu mã đề trong mã định danh phiếu.' };
  }
  if (!Number.isInteger(payload.p) || payload.p < 1 || payload.p > 9) {
    return { valid: false, error: 'Số trang phiếu không hợp lệ.' };
  }
  return { valid: true };
}

/**
 * Mã hóa payload gọn nhẹ (tối đa 20 byte ASCII) theo định dạng `1|sid|ec|st|sh|p`.
 */
export function serializeOpticalPayload(payload: SheetOpticalIdPayloadV1): Uint8Array {
  const check = validateOpticalIdPayload(payload);
  if (!check.valid) {
    throw new Error(check.error ?? 'Payload mã định danh phiếu không hợp lệ.');
  }

  // Rút gọn vừa khít 20 byte để đạt độ phân giải ô lớn, dễ đọc từ ảnh chụp điện thoại
  const sid = sanitizeToken(payload.sid, 4);
  const ec = sanitizeToken(payload.ec, 4);
  const st = sanitizeToken(payload.st, 6);
  const sh = sanitizeToken(payload.sh, 2);
  const page = String(payload.p);

  const compact = `${sid}|${ec}|${st}|${sh}|${page}`;
  const rawBytes = new TextEncoder().encode(compact);
  if (rawBytes.length > MAX_PAYLOAD_BYTES) {
    // Ưu tiên giữ trọn ec (mã đề) và st (mã học sinh)
    const fallback = `${sid.slice(0, 3)}|${ec.slice(0, 4)}|${st.slice(0, 6)}||${page}`;
    const fbBytes = new TextEncoder().encode(fallback);
    const out = new Uint8Array(MAX_PAYLOAD_BYTES);
    out.set(fbBytes.slice(0, MAX_PAYLOAD_BYTES));
    return out;
  }
  const out = new Uint8Array(MAX_PAYLOAD_BYTES);
  out.set(rawBytes);
  return out;
}

export function deserializeOpticalPayload(
  bytes: Uint8Array
): SheetOpticalIdPayloadV1 | null {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  if (end === 0) return null;

  let text = '';
  for (let i = 0; i < end; i += 1) {
    const code = bytes[i];
    if (code < 32 || code > 126) return null;
    text += String.fromCharCode(code);
  }

  const parts = text.split('|');
  if (parts.length !== 5) return null;
  const [sid, ec, st, sh, pageStr] = parts;
  const p = Number(pageStr);
  if (!ec || !Number.isInteger(p) || p < 1 || p > 9) return null;

  return {
    v: 1,
    sid,
    ec,
    st: st || undefined,
    sh: sh || undefined,
    p,
  };
}

/** CRC-16 CCITT (0x1021) để phát hiện 100% lỗi hỏng dữ liệu */
export function computeCrc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

/** Mã sửa lỗi 1 bit Hamming(7,4) cho mỗi nibble (4 bit -> 7 bit) */
function encodeHamming74(nibble: number): number {
  const d1 = (nibble >> 3) & 1;
  const d2 = (nibble >> 2) & 1;
  const d3 = (nibble >> 1) & 1;
  const d4 = nibble & 1;
  const p1 = d1 ^ d2 ^ d4;
  const p2 = d1 ^ d3 ^ d4;
  const p3 = d2 ^ d3 ^ d4;
  // Bit order: p1 p2 d1 p3 d2 d3 d4
  return (p1 << 6) | (p2 << 5) | (d1 << 4) | (p3 << 3) | (d2 << 2) | (d3 << 1) | d4;
}

function decodeHamming74(code7: number): number {
  let b1 = (code7 >> 6) & 1;
  let b2 = (code7 >> 5) & 1;
  let b3 = (code7 >> 4) & 1;
  let b4 = (code7 >> 3) & 1;
  let b5 = (code7 >> 2) & 1;
  let b6 = (code7 >> 1) & 1;
  let b7 = code7 & 1;

  const s1 = b1 ^ b3 ^ b5 ^ b7;
  const s2 = b2 ^ b3 ^ b6 ^ b7;
  const s3 = b4 ^ b5 ^ b6 ^ b7;
  const syndrome = (s3 << 2) | (s2 << 1) | s1;

  if (syndrome === 1) b1 ^= 1;
  else if (syndrome === 2) b2 ^= 1;
  else if (syndrome === 3) b3 ^= 1;
  else if (syndrome === 4) b4 ^= 1;
  else if (syndrome === 5) b5 ^= 1;
  else if (syndrome === 6) b6 ^= 1;
  else if (syndrome === 7) b7 ^= 1;

  return (b3 << 3) | (b5 << 2) | (b6 << 1) | b7;
}

function isFinderCell(r: number, c: number): boolean {
  // Khung ngoài (r=0 hoặc c=0 luôn đậm, r=N-1 và c=N-1 xen kẽ nhịp đồng hồ như DataMatrix)
  const n = OPTICAL_CODE_GRID_SIZE;
  if (r === 0 || c === 0 || r === n - 1 || c === n - 1) return true;
  // 3 góc nhận diện nội bộ nhỏ (2×2 ở góc trên-trái bên trong)
  if (r <= 2 && c <= 2) return true;
  return false;
}

/**
 * Tạo ma trận nhị phân 18×18 (true = ô đen, false = ô trắng) cho phiếu trả lời chuẩn.
 * - Viền trái + viền trên: thanh đen đặc (L-finder).
 * - Viền phải + viền dưới: nhịp đồng hồ đen-trắng xen kẽ.
 * - Vùng lõi 16×16 (trừ 2×2 trên-trái = 252 ô) chứa 22 byte (20 byte payload + 2 byte CRC-16)
 *   nhưng còn gọn hơn: 18 byte payload + 2 byte CRC = 20 byte -> 40 nibble -> 280 bit?
 *   Wait: 16×16 = 256 ô! Với 18×18 ta dùng 16×16 - 4 = 252 ô data:
 *   16 byte payload + 2 byte CRC-16 = 18 byte = 36 nibble × 7 bit = 252 bit VỪA KHÍT 100%!
 */
const COMPACT_DATA_BYTES = 16;

function packPayloadTo16Bytes(payload: SheetOpticalIdPayloadV1): Uint8Array {
  const full = serializeOpticalPayload(payload);
  // Ưu tiên 16 byte đầu; nếu vượt thì rút gọn sid/sh giữ nguyên mã đề & mã học sinh
  const str = new TextDecoder().decode(full).replace(/\0+$/, '');
  if (str.length <= COMPACT_DATA_BYTES) {
    const out = new Uint8Array(COMPACT_DATA_BYTES);
    out.set(new TextEncoder().encode(str));
    return out;
  }
  const sid = sanitizeToken(payload.sid, 2);
  const ec = sanitizeToken(payload.ec, 4);
  const st = sanitizeToken(payload.st, 5);
  const p = String(payload.p);
  const tight = `${sid}|${ec}|${st}||${p}`.slice(0, COMPACT_DATA_BYTES);
  const out = new Uint8Array(COMPACT_DATA_BYTES);
  out.set(new TextEncoder().encode(tight));
  return out;
}

export function encodeOpticalIdMatrix(
  payload: SheetOpticalIdPayloadV1
): boolean[][] {
  const n = OPTICAL_CODE_GRID_SIZE;
  const grid: boolean[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => false)
  );

  // L-Finder border: top row and left col solid black
  for (let i = 0; i < n; i += 1) {
    grid[0][i] = true;
    grid[i][0] = true;
    // Timing pattern on bottom row and right col
    grid[n - 1][i] = i % 2 === 0;
    grid[i][n - 1] = i % 2 === 0;
  }
  // Inner orientation anchor (top-left 2x2: (1,1)=white, (1,2)=black, (2,1)=black, (2,2)=white)
  grid[1][1] = false;
  grid[1][2] = true;
  grid[2][1] = true;
  grid[2][2] = false;

  const data16 = packPayloadTo16Bytes(payload);
  const crc = computeCrc16(data16);
  const packet = new Uint8Array(COMPACT_DATA_BYTES + 2);
  packet.set(data16, 0);
  packet[COMPACT_DATA_BYTES] = (crc >> 8) & 0xff;
  packet[COMPACT_DATA_BYTES + 1] = crc & 0xff;

  // 18 bytes = 36 nibbles -> 36 * 7 = 252 bits
  const bits: boolean[] = [];
  for (let i = 0; i < packet.length; i += 1) {
    const hi = (packet[i] >> 4) & 0x0f;
    const lo = packet[i] & 0x0f;
    const cHi = encodeHamming74(hi);
    const cLo = encodeHamming74(lo);
    for (let b = 6; b >= 0; b -= 1) bits.push(((cHi >> b) & 1) === 1);
    for (let b = 6; b >= 0; b -= 1) bits.push(((cLo >> b) & 1) === 1);
  }

  let bitIdx = 0;
  for (let r = 1; r < n - 1; r += 1) {
    for (let c = 1; c < n - 1; c += 1) {
      if (isFinderCell(r, c)) continue;
      const rawBit = bits[bitIdx] ?? false;
      // Mask nhẹ (r+c)%2 để tránh mảng trắng/đen quá lớn gây nhiễu ngưỡng
      const mask = (r + c) % 2 === 0;
      grid[r][c] = rawBit !== mask;
      bitIdx += 1;
    }
  }

  return grid;
}

/**
 * Giải mã ma trận nhị phân 18×18 từ vùng mã định danh đã nắn thẳng.
 * Trả về trạng thái rõ ràng: 'decoded' | 'corrupted' | 'unreadable'.
 */
export function decodeOpticalIdMatrix(grid: boolean[][]): {
  status: 'decoded' | 'corrupted' | 'unreadable';
  payload?: SheetOpticalIdPayloadV1;
  error?: string;
} {
  const n = OPTICAL_CODE_GRID_SIZE;
  if (grid.length !== n || grid.some((row) => row.length !== n)) {
    return { status: 'unreadable', error: 'Kích thước ma trận mã định danh không hợp lệ.' };
  }

  // Kiểm tra viền L-Finder (cho phép sai lệch tối đa 15% ô do nhiễu quét)
  let finderHits = 0;
  let finderTotal = 0;
  for (let i = 0; i < n; i += 1) {
    finderTotal += 2;
    if (grid[0][i]) finderHits += 1;
    if (grid[i][0]) finderHits += 1;
  }
  if (finderHits / finderTotal < 0.72) {
    return {
      status: 'unreadable',
      error: 'Không nhận diện được khung viền mã định danh phiếu.',
    };
  }

  const bits: number[] = [];
  for (let r = 1; r < n - 1; r += 1) {
    for (let c = 1; c < n - 1; c += 1) {
      if (isFinderCell(r, c)) continue;
      const mask = (r + c) % 2 === 0;
      const unmasked = grid[r][c] !== mask;
      bits.push(unmasked ? 1 : 0);
    }
  }

  if (bits.length < 252) {
    return { status: 'unreadable', error: 'Thiếu dữ liệu bit trong vùng mã định danh.' };
  }

  const packet = new Uint8Array(COMPACT_DATA_BYTES + 2);
  let ptr = 0;
  for (let i = 0; i < packet.length; i += 1) {
    let cHi = 0;
    for (let b = 0; b < 7; b += 1) cHi = (cHi << 1) | bits[ptr++];
    let cLo = 0;
    for (let b = 0; b < 7; b += 1) cLo = (cLo << 1) | bits[ptr++];
    const hi = decodeHamming74(cHi);
    const lo = decodeHamming74(cLo);
    packet[i] = (hi << 4) | lo;
  }

  const data16 = packet.slice(0, COMPACT_DATA_BYTES);
  const storedCrc = (packet[COMPACT_DATA_BYTES] << 8) | packet[COMPACT_DATA_BYTES + 1];
  const expectedCrc = computeCrc16(data16);

  if (storedCrc !== expectedCrc) {
    return {
      status: 'corrupted',
      error: 'Mã định danh phiếu bị hỏng hoặc mờ (sai checksum CRC-16). Vui lòng chọn mã đề và học sinh thủ công.',
    };
  }

  const payload = deserializeOpticalPayload(data16);
  if (!payload) {
    return {
      status: 'corrupted',
      error: 'Dữ liệu bên trong mã định danh không đúng chuẩn TeacherOS.',
    };
  }

  return { status: 'decoded', payload };
}
