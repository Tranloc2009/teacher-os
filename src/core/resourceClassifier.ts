import JSZip from 'jszip';
import {
  GRADE_OPTIONS,
  ResourceDocumentCategory,
  ResourceType,
  SUBJECT_OPTIONS,
} from '../types/lesson';
import {
  ExtractedFileAnalysis,
  ResourceClassificationSuggestion,
  SupportedResourceFormat,
} from '../types/resourceBulk';

export const UNKNOWN_SUBJECT_LABEL = 'Chưa rõ';
export const UNKNOWN_GRADE_LABEL = 'Chưa rõ';

const DANGEROUS_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'msi',
  'vbs',
  'vbe',
  'js',
  'jse',
  'ps1',
  'psm1',
  'scr',
  'pif',
  'hta',
  'dll',
  'sys',
  'sh',
  'apk',
  'jar',
]);

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'svg',
  'tif',
  'tiff',
]);

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'html',
  'htm',
  'xml',
]);

export function normalizeVietnameseText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'))
    .toLowerCase();
}

export function getFileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === base.length - 1) return '';
  return base.slice(dotIdx + 1).toLowerCase();
}

export function stripExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0) return base;
  return base.slice(0, dotIdx);
}

export function detectFormatAndSafety(
  fileName: string,
  mimeType = ''
): {
  format: SupportedResourceFormat;
  extension: string;
  safeToStore: boolean;
  blockedReason?: string;
} {
  const ext = getFileExtension(fileName);
  if (ext && DANGEROUS_EXTENSIONS.has(ext)) {
    return {
      format: 'attachment',
      extension: ext,
      safeToStore: false,
      blockedReason: `Định dạng thực thi (.${ext}) bị chặn để bảo vệ an toàn trình duyệt và dữ liệu giáo viên.`,
    };
  }

  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { format: 'docx', extension: ext || 'docx', safeToStore: true };
  }
  if (ext === 'pdf' || mimeType === 'application/pdf') {
    return { format: 'pdf', extension: ext || 'pdf', safeToStore: true };
  }
  if (ext === 'pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return { format: 'pptx', extension: ext || 'pptx', safeToStore: true };
  }
  if (ext === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return { format: 'xlsx', extension: ext || 'xlsx', safeToStore: true };
  }
  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) {
    return { format: 'image', extension: ext || 'png', safeToStore: true };
  }
  if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/')) {
    return { format: 'text', extension: ext || 'txt', safeToStore: true };
  }

  return { format: 'attachment', extension: ext || 'bin', safeToStore: true };
}

function decodeXmlBasic(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractXmlTagTexts(xml: string, tagPattern: string, maxChars = 4000): string {
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new Error('Phát hiện khai báo XML không an toàn (DOCTYPE/ENTITY).');
  }
  const re = new RegExp(`<${tagPattern}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagPattern}>`, 'gi');
  const parts: string[] = [];
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const clean = decodeXmlBasic(m[1]).replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    parts.push(clean);
    total += clean.length + 1;
    if (total >= maxChars) break;
  }
  return parts.join(' ').slice(0, maxChars).trim();
}

function extractCoreXmlMetadata(coreXml: string): {
  title?: string;
  subject?: string;
  author?: string;
  keywords?: string;
} {
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(coreXml)) return {};
  const pick = (tag: string): string | undefined => {
    const m = coreXml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    const val = m ? decodeXmlBasic(m[1]).trim() : '';
    return val || undefined;
  };
  return {
    title: pick('dc:title'),
    subject: pick('dc:subject'),
    author: pick('dc:creator'),
    keywords: pick('cp:keywords'),
  };
}

function extractPdfAsciiAndMetadata(bytes: Uint8Array): {
  title?: string;
  subject?: string;
  author?: string;
  keywords?: string;
  snippet: string;
} {
  const headLen = Math.min(bytes.length, 65536);
  const tailStart = bytes.length > 65536 ? Math.max(headLen, bytes.length - 32768) : bytes.length;
  const decoder = new TextDecoder('latin1');
  const headStr = decoder.decode(bytes.subarray(0, headLen));
  const tailStr = tailStart < bytes.length ? decoder.decode(bytes.subarray(tailStart)) : '';
  const combined = `${headStr}\n${tailStr}`;

  const pickPdfInfo = (key: string): string | undefined => {
    const re = new RegExp(`\\/${key}\\s*\\(([^()]{1,200})\\)`, 'i');
    const m = combined.match(re);
    if (!m?.[1]) return undefined;
    const raw = m[1].replace(/\\([()\\])/g, '$1').trim();
    // Skip binary UTF-16 BOM noise if unreadable
    if (/^[\x00-\x1f\u0080-\u00ff]{2,}$/.test(raw) && !/[a-zA-Z0-9]/.test(raw)) {
      return undefined;
    }
    return raw.replace(/[^\x20-\x7E\u00A0-\u024F\u1E00-\u1EFF]/g, ' ').replace(/\s+/g, ' ').trim() || undefined;
  };

  // Extract readable plain text fragments from uncompressed Tj/TJ operators when available
  const textFragments: string[] = [];
  const tjRe = /\(([^()\\]{3,120})\)\s*(?:Tj|')/g;
  let m: RegExpExecArray | null;
  let len = 0;
  while ((m = tjRe.exec(headStr)) !== null && len < 1500) {
    const clean = m[1].replace(/[^\x20-\x7E\u00A0-\u024F\u1E00-\u1EFF]/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length >= 3 && /[A-Za-zÀ-ỹ0-9]/.test(clean)) {
      textFragments.push(clean);
      len += clean.length + 1;
    }
  }

  return {
    title: pickPdfInfo('Title'),
    subject: pickPdfInfo('Subject'),
    author: pickPdfInfo('Author'),
    keywords: pickPdfInfo('Keywords'),
    snippet: textFragments.join(' ').slice(0, 1500).trim(),
  };
}

/**
 * Đọc metadata & đoạn trích nội dung an toàn trên bản sao/buffer bộ nhớ,
 * tuyệt đối không làm biến đổi tệp nguồn hay công thức OMML/toán học.
 */
export async function analyzeFileContentSafe(
  fileName: string,
  bytes: Uint8Array,
  mimeType = ''
): Promise<ExtractedFileAnalysis> {
  const { format, extension, safeToStore, blockedReason } = detectFormatAndSafety(
    fileName,
    mimeType
  );
  const warnings: string[] = [];

  if (!safeToStore) {
    return {
      format,
      extension,
      safeToStore: false,
      blockedReason,
      extractedTextSnippet: '',
      hasOmml: false,
      formulaCount: 0,
      warnings: blockedReason ? [blockedReason] : [],
    };
  }

  if (bytes.byteLength === 0) {
    return {
      format,
      extension,
      safeToStore: true,
      extractedTextSnippet: '',
      hasOmml: false,
      formulaCount: 0,
      warnings: ['Tệp rỗng (0 byte).'],
    };
  }

  if (format === 'docx' || format === 'pptx' || format === 'xlsx') {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const entryNames = Object.keys(zip.files);
      if (entryNames.length > 2500) {
        warnings.push('Tệp nén Office chứa quá nhiều mục (>2500), chỉ lưu dạng đính kèm nguyên bản.');
        return {
          format,
          extension,
          safeToStore: true,
          extractedTextSnippet: '',
          hasOmml: false,
          formulaCount: 0,
          warnings,
        };
      }

      if (entryNames.some((n) => /vbaProject\.bin$/i.test(n))) {
        warnings.push('Tệp Office có chứa macro VBA — giữ nguyên tệp gốc nhưng không thực thi macro.');
      }

      let meta: ReturnType<typeof extractCoreXmlMetadata> = {};
      const coreFile = zip.file('docProps/core.xml');
      if (coreFile) {
        const coreXml = await coreFile.async('string');
        meta = extractCoreXmlMetadata(coreXml);
      }

      if (format === 'docx') {
        const docFile = zip.file('word/document.xml');
        if (!docFile) {
          warnings.push('Không tìm thấy word/document.xml trong tệp DOCX.');
          return {
            format,
            extension,
            safeToStore: true,
            extractedTitle: meta.title,
            metadataSubject: meta.subject,
            metadataAuthor: meta.author,
            metadataKeywords: meta.keywords,
            extractedTextSnippet: '',
            hasOmml: false,
            formulaCount: 0,
            warnings,
          };
        }
        const docXml = await docFile.async('string');
        const ommlMatches = docXml.match(/<m:oMath\b/g);
        const formulaCount = ommlMatches ? ommlMatches.length : 0;
        const text = extractXmlTagTexts(docXml, 'w:t', 3500);
        return {
          format,
          extension,
          safeToStore: true,
          extractedTitle: meta.title,
          metadataSubject: meta.subject,
          metadataAuthor: meta.author,
          metadataKeywords: meta.keywords,
          extractedTextSnippet: text,
          hasOmml: formulaCount > 0,
          formulaCount,
          warnings,
        };
      }

      if (format === 'pptx') {
        const slideFiles = entryNames
          .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const slideTexts: string[] = [];
        for (const sf of slideFiles.slice(0, 6)) {
          const xml = await zip.file(sf)!.async('string');
          const txt = extractXmlTagTexts(xml, 'a:t', 700);
          if (txt) slideTexts.push(txt);
        }
        return {
          format,
          extension,
          safeToStore: true,
          extractedTitle: meta.title,
          metadataSubject: meta.subject,
          metadataAuthor: meta.author,
          metadataKeywords: meta.keywords,
          extractedTextSnippet: slideTexts.join(' · ').slice(0, 3000),
          hasOmml: false,
          formulaCount: 0,
          slideCount: slideFiles.length,
          warnings,
        };
      }

      // XLSX
      const wbFile = zip.file('xl/workbook.xml');
      const sheetNames: string[] = [];
      if (wbFile) {
        const wbXml = await wbFile.async('string');
        const sheetRe = /<sheet\b[^>]*name="([^"]+)"/gi;
        let sm: RegExpExecArray | null;
        while ((sm = sheetRe.exec(wbXml)) !== null) {
          sheetNames.push(decodeXmlBasic(sm[1]));
        }
      }
      const ssFile = zip.file('xl/sharedStrings.xml');
      const ssText = ssFile
        ? extractXmlTagTexts(await ssFile.async('string'), 't', 2500)
        : '';
      const combinedSnippet = [
        sheetNames.length > 0 ? `Sheet: ${sheetNames.join(', ')}` : '',
        ssText,
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 3000);

      return {
        format,
        extension,
        safeToStore: true,
        extractedTitle: meta.title,
        metadataSubject: meta.subject,
        metadataAuthor: meta.author,
        metadataKeywords: meta.keywords,
        extractedTextSnippet: combinedSnippet,
        hasOmml: false,
        formulaCount: 0,
        sheetNames,
        warnings,
      };
    } catch {
      warnings.push(`Không thể đọc cấu trúc nén .${extension} (có thể tệp đang khóa mật khẩu hoặc định dạng đặc biệt); tệp vẫn được lưu nguyên bản.`);
      return {
        format,
        extension,
        safeToStore: true,
        extractedTextSnippet: '',
        hasOmml: false,
        formulaCount: 0,
        warnings,
      };
    }
  }

  if (format === 'pdf') {
    const pdfInfo = extractPdfAsciiAndMetadata(bytes);
    return {
      format,
      extension,
      safeToStore: true,
      extractedTitle: pdfInfo.title,
      metadataSubject: pdfInfo.subject,
      metadataAuthor: pdfInfo.author,
      metadataKeywords: pdfInfo.keywords,
      extractedTextSnippet: pdfInfo.snippet,
      hasOmml: false,
      formulaCount: 0,
      warnings,
    };
  }

  if (format === 'text') {
    const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8192));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(sample);
    const cleaned =
      extension === 'html' || extension === 'htm'
        ? decoded.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
        : decoded;
    return {
      format,
      extension,
      safeToStore: true,
      extractedTextSnippet: cleaned.replace(/\s+/g, ' ').trim().slice(0, 3000),
      hasOmml: false,
      formulaCount: 0,
      warnings,
    };
  }

  if (format === 'image') {
    return {
      format,
      extension,
      safeToStore: true,
      extractedTextSnippet: '',
      hasOmml: false,
      formulaCount: 0,
      warnings,
    };
  }

  return {
    format,
    extension,
    safeToStore: true,
    extractedTextSnippet: '',
    hasOmml: false,
    formulaCount: 0,
    warnings,
  };
}

interface SubjectRule {
  subject: (typeof SUBJECT_OPTIONS)[number];
  strongPatterns: RegExp[];
  weakPatterns: RegExp[];
}

const SUBJECT_RULES: SubjectRule[] = [
  {
    subject: 'Toán học',
    strongPatterns: [
      /\btoan\s*(hoc|10|11|12|9|8|7|6|5|4|3|2|1)?\b/,
      /\b(giai tich|dai so|hinh hoc|luong giac|tich phan|nguyen ham|dao ham|logarit|phuong trinh|bat phuong trinh|he phuong trinh|ham so|so phuc|xac suat)\b/,
    ],
    weakPatterns: [/\b(vecto|vector|ma tran|do thi|tiep tuyen|khoang cach|the tich)\b/],
  },
  {
    subject: 'Ngữ văn',
    strongPatterns: [
      /\b(ngu van|van hoc|lam van|nghi luan|doc hieu|tho ca|truyen ngan|tuy but|tac pham|tac gia)\b/,
      /\bvan\s*(10|11|12|9|8|7|6)\b/,
    ],
    weakPatterns: [/\b(doan van|bien phap tu tu|nhan vat|truyen kieu|chiec thuyen ngoai xa)\b/],
  },
  {
    subject: 'Tiếng Anh',
    strongPatterns: [
      /\b(tieng anh|anh van|english|ielts|grammar|vocabulary|reading comprehension|pronunciation|phonetics)\b/,
      /\banh\s*(10|11|12|9|8|7|6|5|4|3)\b/,
    ],
    weakPatterns: [/\b(unit\s*\d+|cloze|rewrite|synonym|antonym|tenses)\b/],
  },
  {
    subject: 'Khoa học tự nhiên',
    strongPatterns: [/\b(khoa hoc tu nhien|khtn)\b/],
    weakPatterns: [/\b(khoa hoc\s*[6789])\b/],
  },
  {
    subject: 'Vật lí',
    strongPatterns: [
      /\b(vat li|vat ly|co hoc|dien hoc|quang hoc|nhiet hoc|dao dong co|song co|dien xoay chieu|hat nhan)\b/,
      /\b(li|ly)\s*(10|11|12|9|8|7|6)\b/,
    ],
    weakPatterns: [/\b(van toc|gia toc|dong nang|the nang|cuong do dong dien|tu truong)\b/],
  },
  {
    subject: 'Hóa học',
    strongPatterns: [
      /\b(hoa hoc|hoa huu co|hoa vo co|phan ung hoa hoc|bang tuan hoan|este|lipit|hidrocacbon|axit|bazo|muoi)\b/,
      /\bhoa\s*(10|11|12|9|8)\b/,
    ],
    weakPatterns: [/\b(mol|nong do|o xi hoa|oxi hoa|kim loai kiem|polime)\b/],
  },
  {
    subject: 'Sinh học',
    strongPatterns: [
      /\b(sinh hoc|di truyen|bien di|te bao|quang hop|ho hap|tien hoa|sinh thai|adn|arn)\b/,
      /\bsinh\s*(10|11|12|9|8|7|6)\b/,
    ],
    weakPatterns: [/\b(nhiem sac the|nguyen phan|giam phan|quan the|he sinh thai)\b/],
  },
  {
    subject: 'Lịch sử',
    strongPatterns: [
      /\b(lich su|su hoc|cach mang thang tam|khang chien|chien tranh the gioi|trieu dai|phong kien)\b/,
      /\bsu\s*(10|11|12|9|8|7|6)\b/,
    ],
    weakPatterns: [/\b(su kien lich su|hiep dinh|chien dich)\b/],
  },
  {
    subject: 'Địa lí',
    strongPatterns: [
      /\b(dia li|dia ly|atlat|at lat|khi hau|dia hinh|kinh te vung|dan so|do thi hoa)\b/,
      /\bdia\s*(10|11|12|9|8|7|6)\b/,
    ],
    weakPatterns: [/\b(dong bang|mien nui|vung kinh te|nhiet do trung binh)\b/],
  },
  {
    subject: 'Giáo dục công dân',
    strongPatterns: [
      /\b(giao duc cong dan|gdcd|kinh te va phap luat|gdktpl|ktpl|phap luat|quyen cong dan)\b/,
    ],
    weakPatterns: [/\b(dao duc|ky nang song|hien phap)\b/],
  },
  {
    subject: 'Tin học',
    strongPatterns: [
      /\b(tin hoc|lap trinh|python|c\+\+|pascal|sql|co so du lieu|thuat toan|mang may tinh|scratch)\b/,
    ],
    weakPatterns: [/\b(html|css|chuong trinh con|bien mang)\b/],
  },
  {
    subject: 'Công nghệ',
    strongPatterns: [/\b(cong nghe|ve ky thuat|ve ki thuat|trong trot|chan nuoi|mach dien)\b/],
    weakPatterns: [/\b(co khi|thiet ke ky thuat)\b/],
  },
  {
    subject: 'Hoạt động trải nghiệm',
    strongPatterns: [/\b(hoat dong trai nghiem|hdtn|huong nghiep)\b/],
    weakPatterns: [],
  },
];

function detectSubject(
  normPathAndName: string,
  normContent: string
): { subject: string; score: number; reason?: string } {
  let bestSubject = UNKNOWN_SUBJECT_LABEL;
  let bestScore = 0;
  let bestReason = '';

  for (const rule of SUBJECT_RULES) {
    let score = 0;
    const reasons: string[] = [];

    for (const re of rule.strongPatterns) {
      if (re.test(normPathAndName)) {
        score += 0.58;
        reasons.push(`tên tệp/thư mục khớp "${rule.subject}"`);
        break;
      }
    }
    for (const re of rule.strongPatterns) {
      if (re.test(normContent)) {
        score += 0.42;
        reasons.push(`nội dung chứa thuật ngữ "${rule.subject}"`);
        break;
      }
    }
    for (const re of rule.weakPatterns) {
      if (re.test(normPathAndName) || re.test(normContent)) {
        score += 0.2;
        break;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestSubject = rule.subject;
      bestReason = reasons[0] ?? `gợi ý theo từ khóa "${rule.subject}"`;
    }
  }

  if (bestScore < 0.35) {
    return { subject: UNKNOWN_SUBJECT_LABEL, score: 0 };
  }

  return {
    subject: bestSubject,
    score: Math.min(1, bestScore),
    reason: bestReason,
  };
}

function detectGrade(
  normPathAndName: string,
  normContent: string
): { grade: string; score: number; reason?: string } {
  const combined = `${normPathAndName} ${normContent}`;

  // Explicit "lớp X" or "khối X" or "grade X" or "kX"
  const explicitPatterns = [
    /\b(?:lop|khoi|grade)\s*[-_:]?\s*(1[0-2]|[1-9])\b/,
    /\bk\s*(1[0-2]|[6-9])\b/,
    /\b(?:toan|van|ngu van|anh|tieng anh|khtn|li|ly|vat li|vat ly|hoa|hoa hoc|sinh|sinh hoc|su|lich su|dia|dia li|dia ly|tin|tin hoc|gdcd|ktpl|cong nghe)\s*[-_:]?\s*(1[0-2]|[1-9])\b/,
  ];

  for (const re of explicitPatterns) {
    const m = normPathAndName.match(re) ?? normContent.match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 12) {
        const label = `Lớp ${n}`;
        if ((GRADE_OPTIONS as readonly string[]).includes(label)) {
          return {
            grade: label,
            score: 0.9,
            reason: `khớp chỉ dấu khối "${label}"`,
          };
        }
      }
    }
  }

  if (/\b(thpt quoc gia|tot nghiep thpt|tn thpt|dai hoc|on thi thptqg)\b/.test(combined)) {
    return {
      grade: 'Lớp 12',
      score: 0.72,
      reason: 'tài liệu ôn thi THPT / tốt nghiệp',
    };
  }
  if (/\b(tuyen sinh vao 10|thi vao 10|chuyen vao 10)\b/.test(combined)) {
    return {
      grade: 'Lớp 9',
      score: 0.72,
      reason: 'tài liệu ôn thi vào lớp 10',
    };
  }

  return { grade: UNKNOWN_GRADE_LABEL, score: 0 };
}

function detectChapterTopic(rawPath: string, rawName: string, rawSnippet: string): string {
  const sources = [
    rawName.replace(/[_]+/g, ' '),
    rawPath.replace(/[_]+/g, ' '),
    rawSnippet,
  ];
  const patterns = [
    /\b(Ch[uư][oơ]ng\s*\d+(?:\s*[-:._]\s*[^\\/|.;\n]{2,48})?)/i,
    /\b(Ch[uủ]\s*[dđ][eề]\s*\d+(?:\s*[-:._]\s*[^\\/|.;\n]{2,48})?)/i,
    /\b(B[aà]i\s*\d+(?:\s*[-:._]\s*[^\\/|.;\n]{2,45})?)/i,
    /\b(Unit\s*\d+(?:\s*[-:._]\s*[^\\/|.;\n]{2,45})?)/i,
  ];

  for (const src of sources) {
    if (!src) continue;
    for (const re of patterns) {
      const m = src.match(re);
      if (m?.[1]) {
        const cleaned = m[1]
          .replace(/[_]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 64);
        if (cleaned.length >= 4) {
          return cleaned;
        }
      }
    }
  }

  // Try folder name in relativePath if meaningful (not generic root folder)
  const segments = rawPath.split(/[\\/]/).filter(Boolean);
  if (segments.length >= 2) {
    const parentFolder = segments[segments.length - 2]
      .replace(/[_-]+/g, ' ')
      .trim();
    const normFolder = normalizeVietnameseText(parentFolder);
    if (
      parentFolder.length >= 3 &&
      parentFolder.length <= 50 &&
      !/^(tai lieu|documents|desktop|downloads|new folder|folder|files|de thi|giao an)$/i.test(
        normFolder
      )
    ) {
      return parentFolder;
    }
  }

  return '';
}

interface DocCategoryRule {
  category: ResourceDocumentCategory;
  resourceType: ResourceType;
  patterns: RegExp[];
  label: string;
}

const DOC_CATEGORY_RULES: DocCategoryRule[] = [
  {
    category: 'dap-an',
    resourceType: 'question-template',
    label: 'đáp án / hướng dẫn chấm',
    patterns: [
      /\b(dap an|huong dan cham|hdc|loi giai|giai chi tiet|bang dap an|answer key)\b/,
    ],
  },
  {
    category: 'de-thi',
    resourceType: 'question-template',
    label: 'đề thi / kiểm tra',
    patterns: [
      /\b(de thi|de kiem tra|kiem tra 15|kiem tra 45|kiem tra giua|kiem tra cuoi|giua ki|giua ky|cuoi ki|cuoi ky|hoc ki|hoc ky|hk1|hk2|khao sat chat luong|thi thu|ma tran de|de cuong on tap|bo de)\b/,
      /\b(de\s*(?:so|minh hoa|chinh thuc|on tap)\s*\d*)\b/,
    ],
  },
  {
    category: 'giao-an',
    resourceType: 'activity-idea',
    label: 'giáo án / kế hoạch bài dạy',
    patterns: [
      /\b(giao an|khbd|ke hoach bai day|ke hoach day hoc|soan bai|lesson plan)\b/,
    ],
  },
  {
    category: 'slide',
    resourceType: 'activity-idea',
    label: 'slide trình chiếu',
    patterns: [/\b(slide|powerpoint|trinh chieu|ppt)\b/],
  },
  {
    category: 'bai-giang',
    resourceType: 'reading-passage',
    label: 'bài giảng',
    patterns: [/\b(bai giang|elearning|e[\s-]?learning|ly thuyet trong tam)\b/],
  },
  {
    category: 'bai-tap',
    resourceType: 'question-template',
    label: 'bài tập / phiếu học tập',
    patterns: [
      /\b(bai tap|phieu hoc tap|phieu bai tap|pht|luyen tap|trac nghiem|tu luan|worksheet|van dung)\b/,
    ],
  },
  {
    category: 'tham-khao',
    resourceType: 'formula-sheet',
    label: 'tài liệu tham khảo / công thức',
    patterns: [
      /\b(tham khao|chuyen de|cong thuc|so do tu duy|sgk|sach giao khoa|rubric|tai lieu on)\b/,
    ],
  },
];

export function mapCategoryToResourceType(category: ResourceDocumentCategory): ResourceType {
  switch (category) {
    case 'de-thi':
    case 'bai-tap':
    case 'dap-an':
      return 'question-template';
    case 'giao-an':
    case 'slide':
      return 'activity-idea';
    case 'bai-giang':
      return 'reading-passage';
    case 'tham-khao':
    case 'khac':
    default:
      return 'formula-sheet';
  }
}

export function classifyResourceFromAnalysis(
  fileName: string,
  relativePath: string,
  analysis: ExtractedFileAnalysis
): ResourceClassificationSuggestion {
  const normName = normalizeVietnameseText(
    `${relativePath || fileName} ${analysis.extractedTitle ?? ''} ${analysis.metadataSubject ?? ''} ${analysis.metadataKeywords ?? ''}`
  ).replace(/[\\/_.\-]+/g, ' ');
  const normContent = normalizeVietnameseText(analysis.extractedTextSnippet ?? '').replace(
    /[\\/_]+/g,
    ' '
  );

  const subjResult = detectSubject(normName, normContent);
  const gradeResult = detectGrade(normName, normContent);
  const chapterTopic = detectChapterTopic(
    relativePath || fileName,
    stripExtension(fileName),
    analysis.extractedTextSnippet
  );

  let docCategory: ResourceDocumentCategory = 'khac';
  let catScore = 0;
  const reasons: string[] = [];

  for (const rule of DOC_CATEGORY_RULES) {
    const inName = rule.patterns.some((p) => p.test(normName));
    const inContent = rule.patterns.some((p) => p.test(normContent));
    if (inName || inContent) {
      docCategory = rule.category;
      catScore = inName ? 0.9 : 0.65;
      reasons.push(
        inName ? `tên tệp chỉ rõ ${rule.label}` : `nội dung chứa từ khóa ${rule.label}`
      );
      break;
    }
  }

  // Format-level reliable signals (only when filename didn't override)
  if (docCategory === 'khac' && analysis.format === 'pptx') {
    docCategory = 'slide';
    catScore = 0.85;
    reasons.push('định dạng .pptx là bài trình chiếu Slide');
  } else if (docCategory === 'khac' && analysis.format === 'xlsx') {
    docCategory = 'tham-khao';
    catScore = 0.52;
    reasons.push('bảng tính .xlsx lưu dạng tài liệu/ma trận tham khảo');
  }

  if (subjResult.reason) reasons.push(subjResult.reason);
  if (gradeResult.reason) reasons.push(gradeResult.reason);
  if (analysis.hasOmml) {
    reasons.push(`bảo toàn ${analysis.formulaCount} công thức toán OMML`);
  }

  // Calibrate confidence conservatively — never inflate score when key signals are missing
  const signalsPresent = [
    subjResult.score > 0 ? subjResult.score : 0,
    gradeResult.score > 0 ? gradeResult.score : 0,
    catScore > 0 ? catScore : 0,
  ];
  const rawAvg = (signalsPresent[0] * 0.4 + signalsPresent[1] * 0.25 + signalsPresent[2] * 0.35);
  const confidence = Number(Math.max(0.12, Math.min(0.98, rawAvg)).toFixed(2));
  const needsManualReview =
    confidence < 0.45 ||
    (subjResult.subject === UNKNOWN_SUBJECT_LABEL && docCategory === 'khac');

  if (reasons.length === 0) {
    reasons.push('Thiếu từ khóa môn học/loại tài liệu trong tên tệp và nội dung trích xuất — giữ để giáo viên xác nhận.');
  }

  const rawCleanTitle = (analysis.extractedTitle || stripExtension(fileName))
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tags: string[] = [];
  if (subjResult.subject !== UNKNOWN_SUBJECT_LABEL) {
    tags.push(subjResult.subject.toLowerCase());
  }
  if (gradeResult.grade !== UNKNOWN_GRADE_LABEL) {
    tags.push(gradeResult.grade.toLowerCase());
  }
  if (docCategory !== 'khac') {
    tags.push(docCategory);
  }
  if (analysis.extension) {
    tags.push(analysis.extension);
  }
  if (analysis.hasOmml) {
    tags.push('omml');
  }

  return {
    subject: subjResult.subject,
    grade: gradeResult.grade,
    chapterTopic,
    documentCategory: docCategory,
    resourceType: mapCategoryToResourceType(docCategory),
    suggestedTitle: rawCleanTitle || fileName,
    tags: Array.from(new Set(tags)),
    confidence,
    needsManualReview,
    reasons,
  };
}
