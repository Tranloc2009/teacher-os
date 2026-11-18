import JSZip from 'jszip';
import { CompatibilityStatus, FileDetectionResult, SupportedImportFormat } from '../types/universalImport';
import { computeContentHash } from './mathIntegrity';

export const IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const IMPORT_MAX_ZIP_ENTRIES = 2500;
export const IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;

function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx === -1) return '';
  return fileName.slice(idx).toLowerCase().trim();
}

function bytesToAsciiPrefix(bytes: Uint8Array, start = 0, len = 16): string {
  const slice = bytes.subarray(start, Math.min(bytes.length, start + len));
  let out = '';
  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    out += b >= 32 && b <= 126 ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return out;
}

function findPdfHeaderOffset(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return i;
    }
  }
  return -1;
}

function isZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  );
}

function detectImageSignature(bytes: Uint8Array): string | null {
  if (bytes.length >= 8) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return 'PNG';
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'JPEG';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'WEBP';
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return 'TIFF';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'BMP';
  }
  return null;
}

function isExecutableSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return true; // MZ (Windows PE/EXE/DLL)
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return true; // ELF
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa) ||
      (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe) ||
      (bytes[0] === 0xca && bytes[1] === 0xfe && bytes[2] === 0xba && bytes[3] === 0xbe))
  ) {
    return true; // Mach-O / Java class
  }
  return false;
}

function computeBytesFingerprint(bytes: Uint8Array): string {
  // Fast deterministic hash combining length + sampled slices for files of any size
  let acc = `${bytes.length}:`;
  const step = Math.max(1, Math.floor(bytes.length / 8192));
  const chars: string[] = [];
  for (let i = 0; i < bytes.length; i += step) {
    chars.push(String.fromCharCode(bytes[i]));
  }
  acc += chars.join('');
  return computeContentHash(acc);
}

function classifyTextFormat(
  rawText: string,
  extension: string
): { format: SupportedImportFormat; signature: string; reason: string } {
  const trimmed = rawText.replace(/^\uFEFF/, '').trimStart();

  if (trimmed.startsWith('{\\rtf')) {
    return {
      format: 'rtf',
      signature: '{\\rtf',
      reason: 'Nhận diện tệp RTF (Rich Text Format).',
    };
  }

  if (
    extension === '.tex' ||
    extension === '.ltx' ||
    /\\documentclass(?:\[[^\]]*\])?\{|\\begin\{document\}|\\begin\{(?:enumerate|itemize|align\*?)\}/i.test(
      trimmed.slice(0, 4000)
    )
  ) {
    return {
      format: 'latex',
      signature: 'LATEX-SRC',
      reason: 'Nhận diện mã nguồn LaTeX (.tex).',
    };
  }

  if (
    extension === '.html' ||
    extension === '.htm' ||
    /^(?:<!doctype\s+html|<html\b|<head\b|<body\b|<table\b|<div\b|<p\b)/i.test(trimmed.slice(0, 2000))
  ) {
    return {
      format: 'html',
      signature: 'HTML-DOC',
      reason: 'Nhận diện tài liệu HTML cấu trúc.',
    };
  }

  if (extension === '.csv') {
    return {
      format: 'csv',
      signature: 'CSV-TEXT',
      reason: 'Nhận diện bảng dữ liệu CSV.',
    };
  }

  if (extension === '.md' || extension === '.markdown') {
    return {
      format: 'markdown',
      signature: 'MARKDOWN-UTF8',
      reason: 'Nhận diện tài liệu Markdown UTF-8.',
    };
  }

  return {
    format: 'txt',
    signature: 'PLAIN-UTF8',
    reason: 'Nhận diện văn bản thuần UTF-8.',
  };
}

/**
 * Kiểm tra chữ ký tệp thực tế (magic bytes + cấu trúc ZIP/XML nội bộ), phát hiện giả mạo phần mở rộng và chặn ZIP bomb / tệp thực thi.
 */
export async function detectFileFormatAndSignature(input: {
  fileName: string;
  mimeType?: string;
  buffer?: ArrayBuffer | Uint8Array;
  textContent?: string;
}): Promise<FileDetectionResult> {
  const extension = getFileExtension(input.fileName);
  const declaredMimeType = input.mimeType ?? '';
  const securityWarnings: string[] = [];

  const bytes =
    input.buffer instanceof Uint8Array
      ? input.buffer
      : input.buffer instanceof ArrayBuffer
      ? new Uint8Array(input.buffer)
      : undefined;

  const sizeBytes =
    bytes?.byteLength ?? (input.textContent !== undefined ? new TextEncoder().encode(input.textContent).byteLength : 0);

  if (sizeBytes === 0) {
    return {
      fileName: input.fileName,
      extension,
      declaredMimeType,
      detectedFormat: 'unknown',
      magicSignature: 'EMPTY',
      signatureValid: false,
      sizeBytes: 0,
      contentHash: computeContentHash('EMPTY'),
      supportTier: 'blocked',
      status: 'BLOCKED',
      reason: 'Tệp rỗng (0 byte) — không thể đọc nội dung.',
      securityWarnings: ['Tệp không có dữ liệu nhị phân hoặc văn bản.'],
    };
  }

  if (sizeBytes > IMPORT_MAX_FILE_BYTES) {
    return {
      fileName: input.fileName,
      extension,
      declaredMimeType,
      detectedFormat: 'unknown',
      magicSignature: bytes ? bytesToAsciiPrefix(bytes, 0, 8) : 'TEXT-LARGE',
      signatureValid: false,
      sizeBytes,
      contentHash: bytes ? computeBytesFingerprint(bytes) : computeContentHash(input.textContent ?? ''),
      supportTier: 'blocked',
      status: 'BLOCKED',
      reason: `Tệp vượt quá giới hạn an toàn 50 MB (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB).`,
      securityWarnings: ['Giới hạn kích thước 50 MB để bảo vệ bộ nhớ trình duyệt.'],
    };
  }

  if (bytes) {
    const contentHash = computeBytesFingerprint(bytes);

    if (isExecutableSignature(bytes)) {
      return {
        fileName: input.fileName,
        extension,
        declaredMimeType,
        detectedFormat: 'unknown',
        magicSignature: bytesToAsciiPrefix(bytes, 0, 8),
        signatureValid: false,
        sizeBytes,
        contentHash,
        supportTier: 'blocked',
        status: 'BLOCKED',
        reason: 'Phát hiện tệp nhị phân thực thi (EXE/ELF/Mach-O) — bị chặn vì lý do bảo mật.',
        securityWarnings: ['Từ chối xử lý tệp thực thi nguy hiểm.'],
      };
    }

    const pdfOffset = findPdfHeaderOffset(bytes);
    if (pdfOffset !== -1) {
      const signatureValid = extension === '' || extension === '.pdf';
      const status: CompatibilityStatus = signatureValid ? 'READY' : 'BLOCKED';
      const reason = signatureValid
        ? 'Xác thực chữ ký nhị phân %PDF- hợp lệ.'
        : `Phát hiện giả mạo phần mở rộng: tệp "${input.fileName}" có đuôi ${extension} nhưng chữ ký nhị phân thực tế là PDF (%PDF-).`;
      if (!signatureValid) {
        securityWarnings.push('Phần mở rộng tệp không khớp chữ ký nhị phân thực tế.');
      }
      return {
        fileName: input.fileName,
        extension,
        declaredMimeType,
        detectedFormat: 'pdf',
        magicSignature: bytesToAsciiPrefix(bytes, pdfOffset, 8),
        signatureValid,
        sizeBytes,
        contentHash,
        supportTier: signatureValid ? 'supported' : 'blocked',
        status,
        reason,
        securityWarnings,
      };
    }

    if (isZipSignature(bytes)) {
      try {
        const zip = await JSZip.loadAsync(bytes);
        const entryNames = Object.keys(zip.files);
        if (entryNames.length > IMPORT_MAX_ZIP_ENTRIES) {
          return {
            fileName: input.fileName,
            extension,
            declaredMimeType,
            detectedFormat: 'unknown',
            magicSignature: 'PK-ZIP-OVERFLOW',
            signatureValid: false,
            sizeBytes,
            contentHash,
            supportTier: 'blocked',
            status: 'BLOCKED',
            reason: `Tệp nén chứa quá nhiều mục (${entryNames.length} > ${IMPORT_MAX_ZIP_ENTRIES}) — từ chối để phòng chống ZIP bomb.`,
            securityWarnings: ['Phát hiện cấu trúc nén bất thường (quá số tệp tối đa).'],
          };
        }

        let totalUncompressed = 0;
        for (const name of entryNames) {
          const entry = zip.files[name] as JSZip.JSZipObject & {
            _data?: { uncompressedSize?: number };
          };
          const uSize = entry._data?.uncompressedSize;
          if (typeof uSize === 'number' && Number.isFinite(uSize) && uSize > 0) {
            totalUncompressed += uSize;
          }
        }
        if (totalUncompressed > IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES) {
          return {
            fileName: input.fileName,
            extension,
            declaredMimeType,
            detectedFormat: 'unknown',
            magicSignature: 'PK-ZIP-BOMB',
            signatureValid: false,
            sizeBytes,
            contentHash,
            supportTier: 'blocked',
            status: 'BLOCKED',
            reason: 'Dung lượng giải nén vượt quá 150 MB — từ chối vì nghi ngờ ZIP bomb.',
            securityWarnings: ['Tỷ lệ nén bất thường vượt ngưỡng an toàn.'],
          };
        }

        const hasWordDoc = Boolean(zip.file('word/document.xml'));
        const hasWorkbook = Boolean(zip.file('xl/workbook.xml'));
        const hasPresentation = Boolean(zip.file('ppt/presentation.xml'));
        const odtMimeFile = zip.file('mimetype');
        const odtMime = odtMimeFile ? (await odtMimeFile.async('text')).trim() : '';

        if (hasWordDoc) {
          const sigOk = extension === '' || extension === '.docx' || extension === '.docm';
          if (!sigOk) {
            securityWarnings.push(`Đuôi tệp ${extension} không khớp gói OOXML Word (.docx).`);
          }
          return {
            fileName: input.fileName,
            extension,
            declaredMimeType,
            detectedFormat: 'docx',
            magicSignature: 'PK-OOXML-WORD',
            signatureValid: sigOk,
            sizeBytes,
            contentHash,
            supportTier: sigOk ? 'supported' : 'blocked',
            status: sigOk ? 'READY' : 'BLOCKED',
            reason: sigOk
              ? 'Xác thực gói OOXML Word (.docx) hợp lệ với word/document.xml.'
              : `Phần mở rộng ${extension} không khớp cấu trúc Word OOXML bên trong.`,
            securityWarnings,
          };
        }

        if (hasWorkbook) {
          return {
            fileName: input.fileName,
            extension,
            declaredMimeType,
            detectedFormat: 'xlsx',
            magicSignature: 'PK-OOXML-EXCEL',
            signatureValid: extension === '' || extension === '.xlsx' || extension === '.xlsm',
            sizeBytes,
            contentHash,
            supportTier: 'deferred',
            status: 'UNSUPPORTED',
            reason: 'Đã nhận diện bảng tính Excel (.xlsx). Bộ nhập ngân hàng câu hỏi XLSX thuộc Giai đoạn 4 (chưa kích hoạt).',
            securityWarnings,
          };
        }

        if (hasPresentation) {
          return {
            fileName: input.fileName,
            extension,
            declaredMimeType,
            detectedFormat: 'pptx',
            magicSignature: 'PK-OOXML-PPT',
            signatureValid: extension === '' || extension === '.pptx',
            sizeBytes,
            contentHash,
            supportTier: 'deferred',
            status: 'UNSUPPORTED',
            reason: 'Đã nhận diện bài giảng PowerPoint (.pptx). Chuyển đổi slide thuộc lộ trình mở rộng (chưa kích hoạt).',
            securityWarnings,
          };
        }

        if (odtMime.includes('oasis.opendocument.text')) {
          return {
            fileName: input.fileName,
            extension,
            declaredMimeType,
            detectedFormat: 'odt',
            magicSignature: 'PK-ODF-TEXT',
            signatureValid: extension === '' || extension === '.odt',
            sizeBytes,
            contentHash,
            supportTier: 'deferred',
            status: 'UNSUPPORTED',
            reason: 'Đã nhận diện tài liệu OpenDocument (.odt). Hỗ trợ chuyển đổi ODT thuộc lộ trình mở rộng.',
            securityWarnings,
          };
        }

        return {
          fileName: input.fileName,
          extension,
          declaredMimeType,
          detectedFormat: 'unknown',
          magicSignature: 'PK-ZIP-UNKNOWN',
          signatureValid: false,
          sizeBytes,
          contentHash,
          supportTier: 'blocked',
          status: 'BLOCKED',
          reason: 'Gói ZIP không chứa word/document.xml hoặc định dạng đề thi được hỗ trợ.',
          securityWarnings: ['Không tìm thấy cấu trúc tài liệu hợp lệ trong tệp nén.'],
        };
      } catch {
        return {
          fileName: input.fileName,
          extension,
          declaredMimeType,
          detectedFormat: 'unknown',
          magicSignature: 'PK-CORRUPT',
          signatureValid: false,
          sizeBytes,
          contentHash,
          supportTier: 'blocked',
          status: 'BLOCKED',
          reason: 'Tệp nén bị hỏng cấu trúc ZIP — không thể mở an toàn.',
          securityWarnings: ['Cấu trúc ZIP hỏng hoặc không hợp lệ.'],
        };
      }
    }

    const imageSig = detectImageSignature(bytes);
    if (imageSig) {
      return {
        fileName: input.fileName,
        extension,
        declaredMimeType,
        detectedFormat: 'image',
        magicSignature: `IMG-${imageSig}`,
        signatureValid: true,
        sizeBytes,
        contentHash,
        supportTier: 'deferred',
        status: 'UNSUPPORTED',
        reason: `Nhận diện tệp hình ảnh (${imageSig}). Đọc đề trực tiếp từ ảnh (OCR) thuộc Giai đoạn 3; để chèn hình minh họa vào câu hỏi, hãy dùng nút "Gắn hình/đồ thị" trong trình soạn thảo.`,
        securityWarnings,
      };
    }

    // Check binary NUL bytes before interpreting as UTF-8 text
    let nulCount = 0;
    const probeLen = Math.min(bytes.length, 4096);
    for (let i = 0; i < probeLen; i++) {
      if (bytes[i] === 0x00) nulCount += 1;
    }
    if (nulCount > 4 || extension === '.docx' || extension === '.pdf') {
      return {
        fileName: input.fileName,
        extension,
        declaredMimeType,
        detectedFormat: 'unknown',
        magicSignature: bytesToAsciiPrefix(bytes, 0, 8),
        signatureValid: false,
        sizeBytes,
        contentHash,
        supportTier: 'blocked',
        status: 'BLOCKED',
        reason:
          extension === '.docx'
            ? `Tệp "${input.fileName}" có đuôi .docx nhưng không phải cấu trúc Word OOXML hợp lệ (bị giả mạo hoặc hỏng dữ liệu).`
            : extension === '.pdf'
            ? `Tệp "${input.fileName}" có đuôi .pdf nhưng thiếu chữ ký %PDF- hợp lệ.`
            : 'Tệp nhị phân không được hỗ trợ hoặc hỏng cấu trúc.',
        securityWarnings: ['Chữ ký nhị phân không khớp với phần mở rộng tệp.'],
      };
    }

    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const classified = classifyTextFormat(decoded, extension);
    const isTurn1TextSupported =
      classified.format === 'html' || classified.format === 'txt' || classified.format === 'markdown';

    return {
      fileName: input.fileName,
      extension,
      declaredMimeType,
      detectedFormat: classified.format,
      magicSignature: classified.signature,
      signatureValid: true,
      sizeBytes,
      contentHash,
      supportTier: isTurn1TextSupported ? 'supported' : 'deferred',
      status: isTurn1TextSupported ? 'READY' : 'UNSUPPORTED',
      reason: isTurn1TextSupported
        ? classified.reason
        : `${classified.reason} Định dạng này sẽ được kích hoạt ở giai đoạn tiếp theo.`,
      securityWarnings,
    };
  }

  // Fallback for raw pasted/text content without binary buffer
  const text = input.textContent ?? '';
  const contentHash = computeContentHash(text);
  if (extension === '.docx' || extension === '.pdf') {
    return {
      fileName: input.fileName,
      extension,
      declaredMimeType,
      detectedFormat: 'unknown',
      magicSignature: 'TEXT-ONLY-MISMATCH',
      signatureValid: false,
      sizeBytes,
      contentHash,
      supportTier: 'blocked',
      status: 'BLOCKED',
      reason: `Tệp ${extension} yêu cầu dữ liệu nhị phân để xác thực chữ ký tệp.`,
      securityWarnings: ['Không thể kiểm tra magic bytes từ chuỗi thuần.'],
    };
  }

  const classified = classifyTextFormat(text, extension);
  const isTurn1TextSupported =
    classified.format === 'html' || classified.format === 'txt' || classified.format === 'markdown';

  return {
    fileName: input.fileName,
    extension,
    declaredMimeType,
    detectedFormat: classified.format,
    magicSignature: classified.signature,
    signatureValid: true,
    sizeBytes,
    contentHash,
    supportTier: isTurn1TextSupported ? 'supported' : 'deferred',
    status: isTurn1TextSupported ? 'READY' : 'UNSUPPORTED',
    reason: isTurn1TextSupported
      ? classified.reason
      : `${classified.reason} Định dạng này thuộc giai đoạn mở rộng tiếp theo.`,
    securityWarnings,
  };
}
