import type { ResourceItem } from '../../types/lesson';
import {
  COGNITIVE_LEVEL_LABELS,
  MATH_QUESTION_TYPE_LABELS,
  type CognitiveLevel,
  type ExamSubjectId,
  type MathQuestionType,
} from '../../types/mathExam';
import type {
  BankQuestionRecord,
  ExamGenerationMode,
  GeneratedDraftItem,
  GeneratedExamDraft,
  MatrixShortfallDetail,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import type {
  DifficultyDistributionSpec,
  NaturalLanguageExamBuildResult,
  NaturalLanguageShortfallAdvice,
  ParsedCommandIntent,
  ParsedExamCommand,
  ParsedTypeCountsSpec,
  SmartRetrievalCandidate,
} from '../../types/resourceIntelligence';
import { computeContentHash } from '../mathIntegrity';
import { getSubjectProfile } from '../subjectProfileRegistry';
import { verifyDynamicGraphBinding } from './level3GraphTemplates';
import {
  normalizeFolderPath,
} from './resourceQuestionIndexer';
import {
  normalizeVietnameseText,
  searchUnifiedQuestionPool,
} from './smartQuestionRetrieval';
import {
  evaluateBankQuestionVariantSafety,
  generateVerifiedVariant,
} from './verifiedVariantEngine';

interface SubjectKeywordEntry {
  id: ExamSubjectId;
  name: string;
  patterns: RegExp[];
}

const SUBJECT_DICTIONARY: SubjectKeywordEntry[] = [
  {
    id: 'toan',
    name: 'Toán học',
    patterns: [/\btoan\s*hoc\b/, /\btoan\b/, /\bgiai\s*tich\b/, /\bdai\s*so\b/, /\bhinh\s*hoc\b/],
  },
  {
    id: 'vat-ly',
    name: 'Vật lí',
    patterns: [/\bvat\s*li\b/, /\bvat\s*ly\b/, /\bco\s*hoc\b/, /\bdien\s*hoc\b/],
  },
  {
    id: 'hoa-hoc',
    name: 'Hóa học',
    patterns: [/\bhoa\s*hoc\b/, /\bmon\s*hoa\b/, /\bhoa\s*\d{1,2}\b/],
  },
  {
    id: 'sinh-hoc',
    name: 'Sinh học',
    patterns: [/\bsinh\s*hoc\b/, /\bmon\s*sinh\b/, /\bsinh\s*\d{1,2}\b/],
  },
  {
    id: 'ngu-van',
    name: 'Ngữ văn',
    patterns: [/\bngu\s*van\b/, /\bmon\s*van\b/, /\bvan\s*\d{1,2}\b/],
  },
  {
    id: 'tieng-anh',
    name: 'Tiếng Anh',
    patterns: [/\btieng\s*anh\b/, /\banh\s*van\b/, /\benglish\b/],
  },
  {
    id: 'lich-su',
    name: 'Lịch sử',
    patterns: [/\blich\s*su\b/, /\bmon\s*su\b/, /\bsu\s*\d{1,2}\b/],
  },
  {
    id: 'dia-ly',
    name: 'Địa lí',
    patterns: [/\bdia\s*li\b/, /\bdia\s*ly\b/, /\bmon\s*dia\b/],
  },
  {
    id: 'tin-hoc',
    name: 'Tin học',
    patterns: [/\btin\s*hoc\b/, /\bmon\s*tin\b/],
  },
  {
    id: 'gdkt-pl',
    name: 'GDCD / KTPL',
    patterns: [/\bgdcd\b/, /\bktpl\b/, /\bgiao\s*duc\s*cong\s*dan\b/, /\bkinh\s*te\s*phap\s*luat\b/],
  },
];

const KNOWN_CURRICULUM_TOPICS: Array<{ norm: string; label: string }> = [
  { norm: 'ham so va do thi', label: 'Hàm số và Đồ thị' },
  { norm: 'khao sat ham so', label: 'Hàm số và Đồ thị' },
  { norm: 'ham so', label: 'Hàm số' },
  { norm: 'dao ham', label: 'Đạo hàm' },
  { norm: 'cuc tri', label: 'Cực trị' },
  { norm: 'don dieu', label: 'Đơn điệu' },
  { norm: 'tiem can', label: 'Tiệm cận' },
  { norm: 'do thi', label: 'Đồ thị' },
  { norm: 'bang bien thien', label: 'Bảng biến thiên' },
  { norm: 'phuong trinh bac hai', label: 'Phương trình bậc hai' },
  { norm: 'phuong trinh bac nhat', label: 'Phương trình bậc nhất' },
  { norm: 'phuong trinh va bat phuong trinh', label: 'Phương trình và bất phương trình' },
  { norm: 'he phuong trinh', label: 'Hệ phương trình' },
  { norm: 'cap so cong', label: 'Cấp số cộng' },
  { norm: 'ti le phan tram', label: 'Tỉ lệ phần trăm' },
  { norm: 'ti le thuc', label: 'Tỉ lệ thức' },
  { norm: 'bieu thuc dai so', label: 'Biểu thức đại số' },
  { norm: 'chuyen dong deu', label: 'Chuyển động đều' },
  { norm: 'nguyen ham', label: 'Nguyên hàm - Tích phân' },
  { norm: 'tich phan', label: 'Nguyên hàm - Tích phân' },
  { norm: 'logarit', label: 'Mũ và Logarit' },
  { norm: 'xac suat', label: 'Xác suất - Thống kê' },
  { norm: 'hinh hoc khong gian', label: 'Hình học không gian' },
];

function detectIntent(norm: string): ParsedCommandIntent {
  if (
    /\b(tao|sinh|lap|xay dung|soan|ra)\b.*\b(de|bai kiem tra|de thi|de kiem tra|de on tap)\b/.test(
      norm
    ) ||
    /\bde kiem tra\b|\bde thi\b|\bde on tap\b/.test(norm)
  ) {
    return 'generate-exam';
  }
  if (/\b(tim|loc|liet ke|xem|tra cuu)\b.*\b(cau hoi|cau|bai tap)\b/.test(norm)) {
    return 'search-questions';
  }
  return 'unknown';
}

function detectSubject(norm: string): { id?: ExamSubjectId; name?: string } {
  for (const entry of SUBJECT_DICTIONARY) {
    if (entry.patterns.some((re) => re.test(norm))) {
      return { id: entry.id, name: entry.name };
    }
  }
  return {};
}

function detectGrade(norm: string): string | undefined {
  // Match explicit "lop 12", "khoi 11", or "<subject> 12" (e.g., "toan 12", "vat li 10")
  const explicit =
    norm.match(/\b(?:lop|khoi)\s*(1[0-2]|[1-9])\b/) ||
    norm.match(
      /\b(?:toan|vat\s*l[iy]|hoa(?:\s*hoc)?|sinh(?:\s*hoc)?|van|ngu\s*van|tieng\s*anh|lich\s*su|dia\s*l[iy]|tin\s*hoc|gdcd|ktpl)\s*(1[0-2]|[1-9])\b/
    );
  if (explicit?.[1]) {
    return `Lớp ${explicit[1]}`;
  }
  return undefined;
}

function detectExamTypeAndImpliedDuration(norm: string): {
  examType?: string;
  impliedDuration?: number;
} {
  if (/giua\s*(?:hoc\s*)?(?:ki|ky)\s*(?:1|i)\b/.test(norm)) {
    return { examType: 'Giữa học kỳ I' };
  }
  if (/giua\s*(?:hoc\s*)?(?:ki|ky)\s*(?:2|ii)\b/.test(norm)) {
    return { examType: 'Giữa học kỳ II' };
  }
  if (/giua\s*(?:hoc\s*)?(?:ki|ky)\b/.test(norm)) {
    return { examType: 'Giữa học kỳ' };
  }
  if (/cuoi\s*(?:hoc\s*)?(?:ki|ky)\s*(?:1|i)\b/.test(norm)) {
    return { examType: 'Cuối học kỳ I' };
  }
  if (/cuoi\s*(?:hoc\s*)?(?:ki|ky)\s*(?:2|ii)\b/.test(norm)) {
    return { examType: 'Cuối học kỳ II' };
  }
  if (/cuoi\s*(?:hoc\s*)?(?:ki|ky)\b/.test(norm)) {
    return { examType: 'Cuối học kỳ' };
  }
  if (/thi\s*thu/.test(norm)) {
    return { examType: 'Đề thi thử' };
  }
  if (/on\s*tap|luyen\s*tap/.test(norm)) {
    return { examType: 'Đề ôn tập / luyện tập' };
  }
  if (/15\s*(?:phut|p)\b/.test(norm)) {
    return { examType: 'Kiểm tra 15 phút', impliedDuration: 15 };
  }
  if (/45\s*(?:phut|p)\b|1\s*tiet/.test(norm)) {
    return { examType: 'Kiểm tra 45 phút (1 tiết)', impliedDuration: 45 };
  }
  return {};
}

function detectDurationMinutes(norm: string, implied?: number): number | undefined {
  const m =
    norm.match(/thoi\s*gian\s*(?:lam\s*bai\s*)?(\d{1,3})\s*(?:phut|p)\b/) ||
    norm.match(/\b(\d{1,3})\s*(?:phut)\b/);
  if (m?.[1]) {
    const val = Number(m[1]);
    if (val >= 5 && val <= 300) return val;
  }
  return implied;
}

function detectTypeCounts(norm: string): {
  typeCounts: ParsedTypeCountsSpec;
  explicitTotalCount?: number;
} {
  const typeCounts: ParsedTypeCountsSpec = {};

  const mcqMatch = norm.match(
    /(\d{1,3})\s*(?:cau\s*)?(?:trac\s*nghiem(?:\s*4\s*(?:phuong\s*an|lua\s*chon|dap\s*an))?|mcq)\b/
  );
  if (mcqMatch?.[1]) typeCounts.mcq = Number(mcqMatch[1]);

  const tfMatch = norm.match(
    /(\d{1,3})\s*(?:cau\s*)?(?:dung\s*[/\\-]?\s*sai|true[\s-]*false)\b/
  );
  if (tfMatch?.[1]) typeCounts['true-false'] = Number(tfMatch[1]);

  const shortMatch = norm.match(
    /(\d{1,3})\s*(?:cau\s*)?(?:tra\s*loi\s*ngan|dien\s*dap\s*so|short[\s-]*answer)\b/
  );
  if (shortMatch?.[1]) typeCounts['short-answer'] = Number(shortMatch[1]);

  const essayMatch = norm.match(
    /(\d{1,3})\s*(?:cau\s*)?(?:tu\s*luan|essay)\b/
  );
  if (essayMatch?.[1]) typeCounts.essay = Number(essayMatch[1]);

  // Explicit overall total like "tong 20 cau", "gom 15 cau", "de 20 cau" (must NOT immediately be followed by a specific type!)
  let explicitTotalCount: number | undefined;
  const totalRegex =
    /(?:tong\s*(?:cong\s*|so\s*)?|gom\s*|co\s*|tao\s*(?:de\s*)?)(\d{1,3})\s*cau\b(?!\s*(?:trac\s*nghiem|dung\s*[/\\-]?\s*sai|tra\s*loi\s*ngan|tu\s*luan|mcq))/g;
  let match: RegExpExecArray | null;
  while ((match = totalRegex.exec(norm)) !== null) {
    const n = Number(match[1]);
    if (n > 0 && n <= 200) {
      explicitTotalCount = n;
      break;
    }
  }

  return { typeCounts, explicitTotalCount };
}

function detectChaptersAndTopics(
  rawPrompt: string,
  norm: string,
  availableTopics: readonly string[]
): string[] {
  const found = new Set<string>();

  // 1. Match explicit clause "chuong ...", "chu de ...", "uu tien ..."
  const clauseRegex =
    /(?:uu\s*tien\s*)?(?:chuong|chu\s*de|bai|phan\s*kien\s*thuc)\s+([^.,;!?]+)/gi;
  const rawLower = rawPrompt;
  let m: RegExpExecArray | null;
  while ((m = clauseRegex.exec(rawLower)) !== null) {
    const segment = m[1]
      .replace(/\b(?:mức độ|thời gian|gồm|tạo|lấy|những|trong resource vault).*$/i, '')
      .trim();
    if (!segment) continue;
    const parts = segment
      .split(/\s*(?:,|;|\/|\bvà\b|\bva\b)\s*/i)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && !/^\d+$/.test(s));
    for (const p of parts) {
      found.add(p);
    }
  }

  // 2. Match known curriculum topics appearing in prompt
  for (const entry of KNOWN_CURRICULUM_TOPICS) {
    if (norm.includes(entry.norm)) {
      // Avoid duplicating if a more specific label already includes it
      const existsSimilar = Array.from(found).some(
        (existing) =>
          normalizeVietnameseText(existing).includes(entry.norm) ||
          entry.norm.includes(normalizeVietnameseText(existing))
      );
      if (!existsSimilar) {
        found.add(entry.label);
      }
    }
  }

  // 3. Match exact existing bank/vault topic labels
  for (const topic of availableTopics) {
    const tNorm = normalizeVietnameseText(topic);
    if (tNorm.length >= 4 && norm.includes(tNorm)) {
      const existsSimilar = Array.from(found).some(
        (e) => normalizeVietnameseText(e) === tNorm
      );
      if (!existsSimilar) {
        found.add(topic);
      }
    }
  }

  return Array.from(found);
}

function detectDifficultyDistribution(norm: string): DifficultyDistributionSpec {
  const dist: DifficultyDistributionSpec = {};

  const nb =
    norm.match(/(\d{1,3})\s*%\s*(?:nhan\s*biet|\bnb\b)/) ||
    norm.match(/(?:nhan\s*biet|\bnb\b)\s*[:=]?\s*(\d{1,3})\s*%/);
  if (nb?.[1]) dist.nhanBietPercent = Number(nb[1]);

  const th =
    norm.match(/(\d{1,3})\s*%\s*(?:thong\s*hieu|\bth\b)/) ||
    norm.match(/(?:thong\s*hieu|\bth\b)\s*[:=]?\s*(\d{1,3})\s*%/);
  if (th?.[1]) dist.thongHieuPercent = Number(th[1]);

  const vdc =
    norm.match(/(\d{1,3})\s*%\s*(?:van\s*dung\s*cao|\bvdc\b)/) ||
    norm.match(/(?:van\s*dung\s*cao|\bvdc\b)\s*[:=]?\s*(\d{1,3})\s*%/);
  if (vdc?.[1]) dist.vanDungCaoPercent = Number(vdc[1]);

  // Match "van dung" NOT followed by "cao"
  const vd =
    norm.match(/(\d{1,3})\s*%\s*(?:van\s*dung(?!\s*cao)|\bvd\b(?!c))/) ||
    norm.match(/(?:van\s*dung(?!\s*cao)|\bvd\b(?!c))\s*[:=]?\s*(\d{1,3})\s*%/);
  if (vd?.[1]) dist.vanDungPercent = Number(vd[1]);

  return dist;
}

function detectResourceVaultScope(
  rawPrompt: string,
  norm: string,
  resources: readonly ResourceItem[],
  subjectName?: string,
  grade?: string
): ParsedExamCommand['resourceVaultScope'] {
  const mentionsVault =
    /resource\s*vault|kho\s*tai\s*lieu|thu\s*muc|tai\s*lieu\s*da\s*luu|file\s*de/.test(norm);

  let folderOrDocumentQuery: string | undefined;
  const folderMatch =
    rawPrompt.match(/thư\s*mục\s+([^.,;!?]+?)(?:\s+trong\s+Resource\s*Vault|\s+trong\s+kho|\s*$|[,.;])/i) ||
    rawPrompt.match(/thu\s*muc\s+([^.,;!?]+?)(?:\s+trong\s+resource\s*vault|\s+trong\s+kho|\s*$|[,.;])/i) ||
    rawPrompt.match(/từ\s+(?:tài\s*liệu|file|tệp)\s+["“]?([^"”.,;!?]+)["”]?/i);
  if (folderMatch?.[1]) {
    folderOrDocumentQuery = folderMatch[1].trim();
  }

  const matchedResources: ResourceItem[] = [];
  if (mentionsVault || folderOrDocumentQuery) {
    const queryNorm = normalizeVietnameseText(
      folderOrDocumentQuery || `${subjectName ?? ''} ${grade ?? ''}`
    );
    const queryTokens = queryNorm.split(/\s+/).filter((t) => t.length >= 2);
    for (const r of resources) {
      const hay = normalizeVietnameseText(
        `${r.title} ${r.subject} ${r.grade} ${r.chapterTopic ?? ''} ${normalizeFolderPath(r) ?? ''} ${r.sourceFile?.fileName ?? ''}`
      );
      if (queryNorm && hay.includes(queryNorm)) {
        matchedResources.push(r);
      } else if (
        queryTokens.length > 0 &&
        queryTokens.every((tok) => hay.includes(tok))
      ) {
        matchedResources.push(r);
      }
    }
  }

  const strictlyVaultOnly =
    /chi\s*(?:lay|dung)\s*(?:tu|trong)\s*(?:resource\s*vault|kho\s*tai\s*lieu|thu\s*muc)/.test(norm);

  return {
    requested: mentionsVault || matchedResources.length > 0,
    folderOrDocumentQuery,
    matchedResourceIds: matchedResources.map((r) => r.id),
    matchedResourceTitles: matchedResources.map((r) => r.title),
    includeQuestionBankFallback: !strictlyVaultOnly,
  };
}

function detectVariationMode(norm: string): {
  mode: ExamGenerationMode;
  explicit: boolean;
  contradiction?: string;
} {
  const wantsBankOnly =
    /chi\s*(?:lay|dung)\s*cau\s*goc|khong\s*doi\s*so|giu\s*nguyen\s*so|bank\s*only/.test(norm);
  const wantsOnlyVariants =
    /chi\s*(?:lay|sinh|dung)\s*bien\s*the|100%\s*(?:doi\s*so|bien\s*the)|verified\s*variants/.test(
      norm
    );
  const wantsVariantWhenSupported =
    /doi\s*so|bien\s*the|tao\s*cau\s*moi|tinh\s*lai\s*dap\s*an|hybrid|ket\s*hop/.test(norm);

  if (wantsBankOnly && (wantsOnlyVariants || /hay\s*doi\s*so|doi\s*so\s*de\s*tao/.test(norm))) {
    return {
      mode: 'hybrid',
      explicit: true,
      contradiction:
        'Yêu cầu vừa muốn "chỉ lấy câu gốc / không đổi số" vừa yêu cầu "đổi số tạo câu mới". Hãy chọn một chế độ sinh đề rõ ràng.',
    };
  }
  if (wantsBankOnly) return { mode: 'bank-only', explicit: true };
  if (wantsOnlyVariants) return { mode: 'verified-variants', explicit: true };
  if (wantsVariantWhenSupported) return { mode: 'hybrid', explicit: true };
  return { mode: 'hybrid', explicit: false };
}

function detectExamVersions(norm: string): { count?: number; codes: string[] } {
  const countMatch = norm.match(/(\d{1,2})\s*ma\s*de\b/);
  const count = countMatch?.[1] ? Number(countMatch[1]) : undefined;

  const codesClause = norm.match(/ma\s*de\s*[:\s]*([0-9,\s]+(?:va\s*\d+)?)/);
  const codes: string[] = [];
  if (codesClause?.[1]) {
    const nums = codesClause[1].match(/\b\d{3,4}\b/g);
    if (nums) {
      for (const n of nums) {
        if (!codes.includes(n)) codes.push(n);
      }
    }
  }
  return {
    count: count ?? (codes.length > 0 ? codes.length : undefined),
    codes,
  };
}

function detectFormAndExport(rawPrompt: string, norm: string): {
  examFormLabel?: string;
  exportFormat?: 'docx' | 'pdf' | 'both';
} {
  let examFormLabel: string | undefined;
  const formMatch = rawPrompt.match(
    /(?:theo\s*)?(?:mẫu|mau)\s+([^.,;!?]+)/i
  );
  if (formMatch?.[1]) {
    examFormLabel = `Mẫu ${formMatch[1].trim()}`;
  }

  const wantsDocx = /\bdocx\b|\bword\b/.test(norm);
  const wantsPdf = /\bpdf\b/.test(norm);
  const exportFormat =
    wantsDocx && wantsPdf
      ? 'both'
      : wantsDocx
      ? 'docx'
      : wantsPdf
      ? 'pdf'
      : undefined;

  return { examFormLabel, exportFormat };
}

/**
 * Kiểm tra mâu thuẫn & trường còn thiếu của một ParsedExamCommand (dùng cả sau khi giáo viên chỉnh tay trên UI).
 */
export function validateParsedExamCommand(cmd: ParsedExamCommand): ParsedExamCommand {
  const missingFields: ParsedExamCommand['missingFields'] = [];
  const conflicts: string[] = [];

  if (!cmd.subjectId) {
    missingFields.push({
      field: 'subjectId',
      label: 'Môn học',
      reason: 'Yêu cầu chưa nêu rõ môn học (ví dụ: Toán, Vật lí, Hóa học...).',
    });
  }
  if (!cmd.grade) {
    missingFields.push({
      field: 'grade',
      label: 'Khối lớp',
      reason: 'Yêu cầu chưa nêu rõ khối lớp (ví dụ: Lớp 8, Lớp 10, Lớp 12...).',
    });
  }
  if (!cmd.durationMinutes) {
    missingFields.push({
      field: 'durationMinutes',
      label: 'Thời gian làm bài',
      reason: 'Chưa xác định thời gian làm bài (phút).',
    });
  }

  const typeSum =
    (cmd.typeCounts.mcq ?? 0) +
    (cmd.typeCounts['true-false'] ?? 0) +
    (cmd.typeCounts['short-answer'] ?? 0) +
    (cmd.typeCounts.essay ?? 0);

  if (typeSum === 0 && (!cmd.requestedTotalCount || cmd.requestedTotalCount <= 0)) {
    missingFields.push({
      field: 'requestedTotalCount',
      label: 'Số lượng câu hỏi',
      reason: 'Chưa xác định tổng số câu hoặc số lượng từng loại câu hỏi.',
    });
  }

  if (
    cmd.requestedTotalCount !== undefined &&
    typeSum > 0 &&
    cmd.requestedTotalCount !== typeSum
  ) {
    conflicts.push(
      `Tổng số câu yêu cầu (${cmd.requestedTotalCount} câu) không khớp tổng các loại câu (${typeSum} câu). Hãy điều chỉnh cho khớp trước khi tạo đề.`
    );
  }

  const diffVals = [
    cmd.difficultyDistribution.nhanBietPercent,
    cmd.difficultyDistribution.thongHieuPercent,
    cmd.difficultyDistribution.vanDungPercent,
    cmd.difficultyDistribution.vanDungCaoPercent,
  ].filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

  if (diffVals.length > 0) {
    const diffSum = diffVals.reduce((acc, v) => acc + v, 0);
    if (diffSum !== 100) {
      conflicts.push(
        `Tổng tỷ lệ mức độ nhận thức hiện bằng ${diffSum}% (phải đúng bằng 100%).`
      );
    }
  }

  if (
    cmd.examVersionCount &&
    cmd.examVersionCodes.length > 0 &&
    cmd.examVersionCount !== cmd.examVersionCodes.length
  ) {
    conflicts.push(
      `Số mã đề yêu cầu (${cmd.examVersionCount}) không khớp số mã cụ thể (${cmd.examVersionCodes.join(', ')}).`
    );
  }

  // Keep existing variation contradiction if present
  const existingVariationConflict = cmd.conflicts.find((c) =>
    c.includes('chỉ lấy câu gốc')
  );
  if (existingVariationConflict && !conflicts.includes(existingVariationConflict)) {
    // Only keep if user hasn't explicitly resolved it
  }

  const highlights: string[] = [];
  if (cmd.subjectName) highlights.push(`Môn: ${cmd.subjectName}`);
  if (cmd.grade) highlights.push(`Lớp: ${cmd.grade}`);
  if (cmd.examType) highlights.push(`Loại đề: ${cmd.examType}`);
  if (cmd.durationMinutes) highlights.push(`Thời gian: ${cmd.durationMinutes} phút`);
  const effectiveTotal = cmd.requestedTotalCount ?? (typeSum > 0 ? typeSum : undefined);
  if (effectiveTotal) highlights.push(`Số câu: ${effectiveTotal}`);
  if (cmd.typeCounts.mcq) highlights.push(`Trắc nghiệm: ${cmd.typeCounts.mcq}`);
  if (cmd.typeCounts['true-false']) highlights.push(`Đúng/Sai: ${cmd.typeCounts['true-false']}`);
  if (cmd.typeCounts['short-answer']) highlights.push(`Trả lời ngắn: ${cmd.typeCounts['short-answer']}`);
  if (cmd.typeCounts.essay) highlights.push(`Tự luận: ${cmd.typeCounts.essay}`);
  if (cmd.chaptersOrTopics.length > 0) {
    highlights.push(`Chủ đề ưu tiên: ${cmd.chaptersOrTopics.join(', ')}`);
  }
  if (cmd.resourceVaultScope.requested) {
    highlights.push(
      `Nguồn: Resource Vault${
        cmd.resourceVaultScope.folderOrDocumentQuery
          ? ` / ${cmd.resourceVaultScope.folderOrDocumentQuery}`
          : ''
      }`
    );
  }
  highlights.push(
    `Chế độ: ${
      cmd.variationMode === 'bank-only'
        ? 'BANK ONLY (Câu gốc)'
        : cmd.variationMode === 'verified-variants'
        ? 'VERIFIED VARIANTS (Chỉ biến thể kiểm chứng)'
        : 'HYBRID (Kết hợp câu gốc & biến thể)'
    }`
  );
  if (cmd.examVersionCount) {
    highlights.push(
      `Số mã đề: ${cmd.examVersionCount}${
        cmd.examVersionCodes.length > 0 ? ` (${cmd.examVersionCodes.join(', ')})` : ''
      }`
    );
  }
  if (cmd.examFormLabel) highlights.push(`Mẫu trình bày: ${cmd.examFormLabel}`);

  return {
    ...cmd,
    missingFields,
    conflicts,
    parsedHighlights: highlights,
  };
}

/**
 * Bộ phân tích câu lệnh tiếng Việt có kiểm soát (Rule-Based + Từ điển + Kiểm tra mâu thuẫn).
 * 100% Local-First · KHÔNG dùng AI API · KHÔNG tự đoán thông số quan trọng khi thiếu.
 */
export function parseVietnameseExamCommand(
  rawPrompt: string,
  resources: readonly ResourceItem[] = [],
  availableTopics: readonly string[] = []
): ParsedExamCommand {
  const trimmed = rawPrompt.trim();
  const norm = normalizeVietnameseText(trimmed);

  const intent = detectIntent(norm);
  const subject = detectSubject(norm);
  const grade = detectGrade(norm);
  const { examType, impliedDuration } = detectExamTypeAndImpliedDuration(norm);
  const durationMinutes = detectDurationMinutes(norm, impliedDuration);
  const { typeCounts, explicitTotalCount } = detectTypeCounts(norm);
  const chaptersOrTopics = detectChaptersAndTopics(trimmed, norm, availableTopics);
  const difficultyDistribution = detectDifficultyDistribution(norm);
  const resourceVaultScope = detectResourceVaultScope(
    trimmed,
    norm,
    resources,
    subject.name,
    grade
  );
  const variation = detectVariationMode(norm);
  const versions = detectExamVersions(norm);
  const { examFormLabel, exportFormat } = detectFormAndExport(trimmed, norm);

  const typeSum =
    (typeCounts.mcq ?? 0) +
    (typeCounts['true-false'] ?? 0) +
    (typeCounts['short-answer'] ?? 0) +
    (typeCounts.essay ?? 0);

  const requestedTotalCount =
    explicitTotalCount !== undefined
      ? explicitTotalCount
      : typeSum > 0
      ? typeSum
      : undefined;

  const notes: string[] = [
    'Phân tích cục bộ bằng bộ quy tắc & từ điển tiếng Việt (không dùng AI API). Hãy kiểm tra và chỉnh sửa trước khi xác nhận tạo đề.',
  ];
  if (resourceVaultScope.requested && resourceVaultScope.matchedResourceIds.length === 0) {
    notes.push(
      `Chưa thấy tài liệu Resource Vault nào khớp chính xác "${
        resourceVaultScope.folderOrDocumentQuery || `${subject.name ?? ''} ${grade ?? ''}`.trim()
      }". Bạn có thể chọn tài liệu thủ công hoặc lập chỉ mục trước.`
    );
  }
  if (!variation.explicit) {
    notes.push(
      'Chưa nêu rõ chế độ đổi số — mặc định gợi ý HYBRID (ưu tiên đổi số những câu có mẫu kiểm chứng, giữ nguyên câu gốc còn lại).'
    );
  }

  const baseCmd: ParsedExamCommand = {
    rawPrompt: trimmed,
    intent,
    subjectId: subject.id,
    subjectName: subject.name,
    grade,
    examType,
    durationMinutes,
    requestedTotalCount,
    typeCounts,
    chaptersOrTopics,
    difficultyDistribution,
    resourceVaultScope,
    variationMode: variation.mode,
    variationExplicitlyRequested: variation.explicit,
    examVersionCount: versions.count,
    examVersionCodes: versions.codes,
    examFormLabel,
    exportFormat,
    missingFields: [],
    conflicts: variation.contradiction ? [variation.contradiction] : [],
    parsedHighlights: [],
    notes,
  };

  const validated = validateParsedExamCommand(baseCmd);
  if (variation.contradiction && !validated.conflicts.includes(variation.contradiction)) {
    validated.conflicts.push(variation.contradiction);
  }
  return validated;
}

interface MatrixSlotTarget {
  rowId: string;
  type: MathQuestionType;
  cognitiveLevel: CognitiveLevel;
  count: number;
  pointsPerQuestion: number;
}

function allocateCountsByDifficulty(
  totalForType: number,
  dist: DifficultyDistributionSpec
): Array<{ level: CognitiveLevel; count: number }> {
  const entries: Array<{ level: CognitiveLevel; pct: number }> = [
    { level: 'nhan-biet', pct: dist.nhanBietPercent ?? 0 },
    { level: 'thong-hieu', pct: dist.thongHieuPercent ?? 0 },
    { level: 'van-dung', pct: dist.vanDungPercent ?? 0 },
    { level: 'van-dung-cao', pct: dist.vanDungCaoPercent ?? 0 },
  ];
  const pctSum = entries.reduce((acc, e) => acc + e.pct, 0);

  if (pctSum !== 100) {
    // No explicit distribution -> keep a balanced default split or single open slot
    const nb = Math.round(totalForType * 0.4);
    const th = Math.round(totalForType * 0.4);
    const vd = Math.max(0, totalForType - nb - th);
    const fallback: Array<{ level: CognitiveLevel; count: number }> = [
      { level: 'nhan-biet', count: nb },
      { level: 'thong-hieu', count: th },
      { level: 'van-dung', count: vd },
    ];
    return fallback.filter((e) => e.count > 0);
  }

  const active = entries.filter((e) => e.pct > 0);
  const rawFloors = active.map((e) => {
    const exact = (totalForType * e.pct) / 100;
    return {
      level: e.level,
      floor: Math.floor(exact),
      rem: exact - Math.floor(exact),
    };
  });
  let assigned = rawFloors.reduce((acc, r) => acc + r.floor, 0);
  const byRem = [...rawFloors].sort((a, b) => b.rem - a.rem);
  let cursor = 0;
  while (assigned < totalForType && byRem.length > 0) {
    byRem[cursor % byRem.length].floor += 1;
    assigned += 1;
    cursor += 1;
  }

  return rawFloors
    .filter((r) => r.floor > 0)
    .map((r) => ({ level: r.level, count: r.floor }));
}

function buildMatrixSlotsFromCommand(cmd: ParsedExamCommand): MatrixSlotTarget[] {
  const typeEntries: Array<{ type: MathQuestionType; count: number; pts: number }> = [];
  if (cmd.typeCounts.mcq && cmd.typeCounts.mcq > 0) {
    typeEntries.push({ type: 'mcq', count: cmd.typeCounts.mcq, pts: 0.25 });
  }
  if (cmd.typeCounts['true-false'] && cmd.typeCounts['true-false'] > 0) {
    typeEntries.push({ type: 'true-false', count: cmd.typeCounts['true-false'], pts: 1 });
  }
  if (cmd.typeCounts['short-answer'] && cmd.typeCounts['short-answer'] > 0) {
    typeEntries.push({ type: 'short-answer', count: cmd.typeCounts['short-answer'], pts: 0.5 });
  }
  if (cmd.typeCounts.essay && cmd.typeCounts.essay > 0) {
    typeEntries.push({ type: 'essay', count: cmd.typeCounts.essay, pts: 1.5 });
  }

  if (typeEntries.length === 0 && cmd.requestedTotalCount && cmd.requestedTotalCount > 0) {
    typeEntries.push({ type: 'mcq', count: cmd.requestedTotalCount, pts: 0.5 });
  }

  const slots: MatrixSlotTarget[] = [];
  let rowIdx = 0;
  for (const te of typeEntries) {
    const levelBuckets = allocateCountsByDifficulty(te.count, cmd.difficultyDistribution);
    for (const bucket of levelBuckets) {
      rowIdx += 1;
      slots.push({
        rowId: `nl-row-${rowIdx}`,
        type: te.type,
        cognitiveLevel: bucket.level,
        count: bucket.count,
        pointsPerQuestion: te.pts,
      });
    }
  }
  return slots;
}

/**
 * Thực thi toàn bộ pipeline Phase A sau khi giáo viên xác nhận cấu hình:
 * Resource Vault + Unified Question Bank → Smart Retrieval (BM25 + Metadata)
 * → Verified Variant Engine (L1/L2/L3) → Matrix Assembly → Draft sẵn sàng duyệt.
 *
 * Tuyệt đối KHÔNG tự bịa câu hỏi khi thiếu nguồn; báo cáo thiếu câu trung thực.
 */
export function buildExamFromNaturalLanguageCommand(params: {
  command: ParsedExamCommand;
  unifiedBank: readonly BankQuestionRecord[];
  templates: readonly QuestionTemplateDefinition[];
  seed?: string;
  relaxTopicFilter?: boolean;
  relaxDifficultyFilter?: boolean;
  relaxResourceScope?: boolean;
}): NaturalLanguageExamBuildResult {
  const validated = validateParsedExamCommand(params.command);
  if (validated.conflicts.length > 0) {
    throw new Error(
      `Không thể tạo đề khi cấu hình còn mâu thuẫn: ${validated.conflicts.join(' | ')}`
    );
  }

  const { unifiedBank, templates } = params;
  const seed = params.seed?.trim() || `NL-${computeContentHash(validated.rawPrompt || 'exam').slice(0, 6).toUpperCase()}`;
  const subjectId: ExamSubjectId = validated.subjectId ?? 'toan';
  const subjectName = validated.subjectName ?? getSubjectProfile(subjectId).name;
  const grade = validated.grade ?? 'Lớp 12';
  const durationMinutes = validated.durationMinutes ?? 45;
  const slots = buildMatrixSlotsFromCommand(validated);
  const templateById = new Map(templates.map((t) => [t.id, t]));

  const usedRecordIds = new Set<string>();
  const usedContentHashes = new Set<string>();
  const usedVariantSignatures = new Set<string>();
  const usedVariantContentKeys = new Set<string>();
  const retrievalByItemId: Record<string, SmartRetrievalCandidate> = {};
  const sourceResourceIdsUsed = new Set<string>();

  const items: GeneratedDraftItem[] = [];
  const shortfalls: MatrixShortfallDetail[] = [];
  const warnings: string[] = [];

  let requestedTotal = 0;
  let originalCount = 0;
  let variantCount = 0;
  let reviewRequiredCount = 0;
  let blockedCount = 0;
  let totalFoundMatching = 0;
  let totalBlockedFromVariants = 0;

  const scopedResourceIds =
    !params.relaxResourceScope &&
    validated.resourceVaultScope.requested &&
    validated.resourceVaultScope.matchedResourceIds.length > 0 &&
    !validated.resourceVaultScope.includeQuestionBankFallback
      ? validated.resourceVaultScope.matchedResourceIds
      : undefined;

  const preferredResourceIdSet = new Set(
    validated.resourceVaultScope.matchedResourceIds
  );

  // Helper to rank candidates prioritizing Resource Vault scoped items first
  const retrieveForSlot = (
    slot: MatrixSlotTarget,
    options: { ignoreTopic?: boolean; ignoreLevel?: boolean } = {}
  ): SmartRetrievalCandidate[] => {
    const res = searchUnifiedQuestionPool(unifiedBank, templates, {
      queryText: options.ignoreTopic ? undefined : validated.chaptersOrTopics.join(' '),
      subjectId,
      grade,
      chaptersOrTopics: options.ignoreTopic ? undefined : validated.chaptersOrTopics,
      questionTypes: [slot.type],
      cognitiveLevels: options.ignoreLevel ? undefined : [slot.cognitiveLevel],
      resourceIds: scopedResourceIds,
      onlyVariantCapable: validated.variationMode === 'verified-variants',
      excludeIds: Array.from(usedRecordIds),
      excludeContentHashes: Array.from(usedContentHashes),
    });

    totalBlockedFromVariants += res.blockedVariantCount;

    // Sort with explicit preference for matched Resource Vault documents when scope requested
    return [...res.candidates].sort((a, b) => {
      const aInVault =
        a.record.sourceProvenance?.resourceId &&
        preferredResourceIdSet.has(a.record.sourceProvenance.resourceId)
          ? 1
          : 0;
      const bInVault =
        b.record.sourceProvenance?.resourceId &&
        preferredResourceIdSet.has(b.record.sourceProvenance.resourceId)
          ? 1
          : 0;
      if (bInVault !== aInVault) return bInVault - aInVault;
      return b.totalScore - a.totalScore;
    });
  };

  for (const slot of slots) {
    requestedTotal += slot.count;
    let fulfilled = 0;

    let candidates = retrieveForSlot(slot, {
      ignoreTopic: params.relaxTopicFilter,
      ignoreLevel: params.relaxDifficultyFilter,
    });
    totalFoundMatching += candidates.length;

    // In HYBRID or VERIFIED VARIANTS mode, try matched candidates first
    for (const cand of candidates) {
      if (fulfilled >= slot.count) break;
      if (usedRecordIds.has(cand.record.id)) continue;

      const rec = cand.record;
      const recHash =
        rec.sourceProvenance?.contentHash ??
        computeContentHash(rec.question.stem.rawSource.trim());
      if (usedContentHashes.has(recHash)) continue;

      const linkedTemplate =
        cand.matchedTemplateId ? templateById.get(cand.matchedTemplateId) : undefined;
      const safety = evaluateBankQuestionVariantSafety(rec, linkedTemplate);

      // Try verified variant generation ONLY when mode allows AND question maps to a verified template AND is not BLOCKED
      const shouldTryVariant =
        validated.variationMode !== 'bank-only' &&
        safety.canGenerateVariant &&
        Boolean(linkedTemplate && linkedTemplate.verifiedTemplate);

      if (shouldTryVariant && linkedTemplate) {
        const outcome = generateVerifiedVariant({
          template: linkedTemplate,
          parentQuestionId: rec.id,
          seed: `${seed}::${slot.rowId}::${fulfilled + 1}::${rec.id}`,
          variantIndex: items.length + 1,
          excludeSignatures: usedVariantSignatures,
        });

        if (outcome.ok && outcome.variant) {
          const graphCheck = verifyDynamicGraphBinding({
            question: outcome.variant.question,
            functionAnalysis: outcome.variant.functionAnalysis,
            variationTable: outcome.variant.variationTable,
            graphFingerprint: outcome.variant.graphFingerprint,
          });
          if (graphCheck.valid) {
            usedRecordIds.add(rec.id);
            usedContentHashes.add(recHash);
            usedVariantSignatures.add(outcome.variant.parameterSignature);
            if (outcome.variant.normalizedContentKey) {
              usedVariantContentKeys.add(outcome.variant.normalizedContentKey);
            }
            const qClone = structuredClone(outcome.variant.question);
            qClone.points = slot.pointsPerQuestion;
            const itemId = `nl-item-${items.length + 1}-${outcome.variant.id}`;
            if (rec.sourceProvenance?.resourceId) {
              sourceResourceIdsUsed.add(rec.sourceProvenance.resourceId);
            }
            items.push({
              id: itemId,
              orderNumber: items.length + 1,
              origin: 'verified-variant',
              status: 'REVIEW_REQUIRED',
              parentQuestionId: rec.id,
              templateId: linkedTemplate.id,
              variantId: outcome.variant.id,
              variantCode: outcome.variant.variantCode,
              parameterSignature: outcome.variant.parameterSignature,
              parameterValues: outcome.variant.parameterValues,
              graphFingerprint: outcome.variant.graphFingerprint,
              functionAnalysis: outcome.variant.functionAnalysis,
              variationTable: outcome.variant.variationTable,
              sourceProvenance: rec.sourceProvenance,
              selectionReasons: [
                ...cand.matchReasons,
                `Đã đổi số kiểm chứng qua mẫu ${linkedTemplate.code} (${outcome.variant.variantCode})`,
              ],
              contentRelevancePercent: cand.contentRelevancePercent,
              verificationSummary: outcome.variant.verification.independentCheckSummary,
              locked: false,
              teacherConfirmed: false,
              question: qClone,
            });
            retrievalByItemId[itemId] = cand;
            variantCount += 1;
            reviewRequiredCount += 1;
            fulfilled += 1;
            continue;
          } else {
            blockedCount += 1;
            warnings.push(
              `Câu ${rec.code}: ${graphCheck.reason ?? 'BLOCK EXPORT — STALE GRAPH DATA'}.`
            );
          }
        }
      }

      if (validated.variationMode === 'verified-variants') {
        blockedCount += 1;
        continue;
      }

      // Use original verified/sourced question cleanly (NEVER mutate numbers via regex!)
      usedRecordIds.add(rec.id);
      usedContentHashes.add(recHash);
      if (rec.sourceProvenance?.resourceId) {
        sourceResourceIdsUsed.add(rec.sourceProvenance.resourceId);
      }
      const qClone = structuredClone(rec.question);
      qClone.points = slot.pointsPerQuestion;
      const itemId = `nl-item-${items.length + 1}-${rec.id}`;
      const isBlockedForVariant = !safety.canGenerateVariant;

      items.push({
        id: itemId,
        orderNumber: items.length + 1,
        origin: 'bank-original',
        status:
          rec.sourceProvenance?.verificationStatus === 'BLOCKED'
            ? 'BLOCKED'
            : qClone.answerConfirmed
            ? 'ORIGINAL'
            : 'REVIEW_REQUIRED',
        parentQuestionId: rec.id,
        templateId: rec.templateId,
        graphFingerprint: qClone.variantMeta?.graphFingerprint,
        sourceProvenance: rec.sourceProvenance,
        selectionReasons: [
          ...cand.matchReasons,
          isBlockedForVariant
            ? `Giữ nguyên bản gốc (${safety.reasons[0] ?? 'chưa có mẫu đổi số'})`
            : 'Giữ câu gốc từ nguồn đã chọn',
        ],
        contentRelevancePercent: cand.contentRelevancePercent,
        verificationSummary: qClone.answerConfirmed
          ? `Câu gốc từ ${cand.sourceLabel} (đã có đáp án).`
          : `Câu gốc từ ${cand.sourceLabel} — chưa xác nhận đáp án, cần giáo viên duyệt.`,
        locked: false,
        teacherConfirmed: qClone.answerConfirmed && rec.sourceKind !== 'resource-vault',
        question: qClone,
      });
      retrievalByItemId[itemId] = cand;
      originalCount += 1;
      if (!qClone.answerConfirmed || rec.sourceKind === 'resource-vault') {
        reviewRequiredCount += 1;
      }
      fulfilled += 1;
    }

    // Also allow pure verified templates for remaining variant slots in VERIFIED VARIANTS or HYBRID mode
    if (
      fulfilled < slot.count &&
      validated.variationMode !== 'bank-only' &&
      !scopedResourceIds
    ) {
      const matchingTemplates = templates.filter((t) => {
        if (!t.verifiedTemplate) return false;
        if (t.subjectId !== subjectId) return false;
        if (t.questionType !== slot.type) return false;
        if (!params.relaxDifficultyFilter && t.cognitiveLevel !== slot.cognitiveLevel) {
          return false;
        }
        if (
          !params.relaxTopicFilter &&
          validated.chaptersOrTopics.length > 0
        ) {
          const tNorm = normalizeVietnameseText(`${t.topic} ${t.title}`);
          const okTopic = validated.chaptersOrTopics.some((ct) => {
            const ctNorm = normalizeVietnameseText(ct);
            return tNorm.includes(ctNorm) || ctNorm.includes(tNorm);
          });
          if (!okTopic) return false;
        }
        return true;
      });

      let cursor = 0;
      let guard = 0;
      while (
        fulfilled < slot.count &&
        matchingTemplates.length > 0 &&
        guard < matchingTemplates.length * 3
      ) {
        guard += 1;
        const tpl = matchingTemplates[cursor % matchingTemplates.length];
        cursor += 1;
        const outcome = generateVerifiedVariant({
          template: tpl,
          parentQuestionId: tpl.sourceQuestionId ?? tpl.id,
          seed: `${seed}::TPL::${slot.rowId}::${guard}::${tpl.id}`,
          variantIndex: items.length + 1,
          excludeSignatures: usedVariantSignatures,
        });
        if (!outcome.ok || !outcome.variant) continue;
        const graphCheck = verifyDynamicGraphBinding({
          question: outcome.variant.question,
          functionAnalysis: outcome.variant.functionAnalysis,
          variationTable: outcome.variant.variationTable,
          graphFingerprint: outcome.variant.graphFingerprint,
        });
        if (!graphCheck.valid) continue;

        usedVariantSignatures.add(outcome.variant.parameterSignature);
        if (outcome.variant.normalizedContentKey) {
          usedVariantContentKeys.add(outcome.variant.normalizedContentKey);
        }
        const qClone = structuredClone(outcome.variant.question);
        qClone.points = slot.pointsPerQuestion;
        const itemId = `nl-item-${items.length + 1}-${outcome.variant.id}`;
        items.push({
          id: itemId,
          orderNumber: items.length + 1,
          origin: 'verified-variant',
          status: 'REVIEW_REQUIRED',
          parentQuestionId: tpl.sourceQuestionId ?? tpl.id,
          templateId: tpl.id,
          variantId: outcome.variant.id,
          variantCode: outcome.variant.variantCode,
          parameterSignature: outcome.variant.parameterSignature,
          parameterValues: outcome.variant.parameterValues,
          graphFingerprint: outcome.variant.graphFingerprint,
          functionAnalysis: outcome.variant.functionAnalysis,
          variationTable: outcome.variant.variationTable,
          selectionReasons: [
            `Sinh biến thể kiểm chứng từ mẫu ${tpl.code} (${tpl.topic})`,
            `Đúng loại câu: ${MATH_QUESTION_TYPE_LABELS[slot.type]} · ${COGNITIVE_LEVEL_LABELS[slot.cognitiveLevel]}`,
          ],
          contentRelevancePercent: 92,
          verificationSummary: outcome.variant.verification.independentCheckSummary,
          locked: false,
          teacherConfirmed: false,
          question: qClone,
        });
        variantCount += 1;
        reviewRequiredCount += 1;
        fulfilled += 1;
      }
    }

    if (fulfilled < slot.count) {
      const missing = slot.count - fulfilled;
      const topicLabel =
        validated.chaptersOrTopics.length > 0 && !params.relaxTopicFilter
          ? validated.chaptersOrTopics.join(', ')
          : 'Tất cả chủ đề';
      shortfalls.push({
        rowId: slot.rowId,
        topic: topicLabel,
        type: slot.type,
        cognitiveLevel: slot.cognitiveLevel,
        requested: slot.count,
        fulfilled,
        shortfall: missing,
        reason: `Thiếu ${missing} câu ${MATH_QUESTION_TYPE_LABELS[slot.type]} mức ${
          COGNITIVE_LEVEL_LABELS[slot.cognitiveLevel]
        } (chủ đề: ${topicLabel}). Hệ thống KHÔNG tự bịa câu hỏi để đủ số lượng.`,
      });
    }
  }

  const suggestedRelaxations: string[] = [];
  if (shortfalls.length > 0) {
    if (validated.chaptersOrTopics.length > 0 && !params.relaxTopicFilter) {
      suggestedRelaxations.push(
        `Nới điều kiện chủ đề ("${validated.chaptersOrTopics.join(', ')}") để lấy thêm câu cùng môn ${subjectName} ${grade}.`
      );
    }
    if (!params.relaxDifficultyFilter) {
      suggestedRelaxations.push(
        'Nới phân bổ mức độ nhận thức (cho phép bù chéo giữa Nhận biết / Thông hiểu / Vận dụng).'
      );
    }
    if (scopedResourceIds && !params.relaxResourceScope) {
      suggestedRelaxations.push(
        'Cho phép lấy bổ sung từ Ngân hàng câu hỏi hợp nhất ngoài thư mục Resource Vault đã chọn.'
      );
    }
    if (validated.variationMode === 'verified-variants') {
      suggestedRelaxations.push(
        'Chuyển từ VERIFIED VARIANTS sang HYBRID để sử dụng thêm câu gốc chưa có mẫu đổi số.'
      );
    }
    suggestedRelaxations.push(
      'Hoặc lập chỉ mục thêm tệp đề kiểm tra (DOCX / PDF / XLSX) trong Resource Vault.'
    );
  }

  const now = new Date().toISOString();
  const totalPoints = Number(
    items.reduce((acc, it) => acc + (it.question.points || 0), 0).toFixed(2)
  );
  const draftTitle = `${validated.examType ? `Đề ${validated.examType}` : 'Đề kiểm tra'} — ${subjectName} ${grade}`;

  const draft: GeneratedExamDraft = {
    id: `nldraft-${computeContentHash(`${seed}:${now}`).slice(0, 8)}`,
    draftNumber: 1,
    draftLabel: 'Đề tạo từ yêu cầu tiếng Việt',
    title: draftTitle,
    subjectId,
    subjectName,
    grade,
    durationMinutes,
    mode: validated.variationMode,
    seed,
    totalPoints,
    status: 'draft',
    allAnswersConfirmed: items.length > 0 && items.every((i) => i.teacherConfirmed),
    items,
    report: {
      requestedTotal,
      generatedTotal: items.length,
      originalCount,
      variantCount,
      reviewRequiredCount,
      unsupportedCount: 0,
      blockedCount,
      shortfalls,
      warnings: Array.from(new Set(warnings)),
      cancelled: false,
      seedUsed: seed,
      generatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  const shortfallAdvice: NaturalLanguageShortfallAdvice = {
    shortfalls,
    totalFoundMatching,
    totalBlockedFromVariants,
    suggestedRelaxations,
  };

  return {
    draft,
    retrievalByItemId,
    shortfallAdvice,
    sourceResourceIdsUsed: Array.from(sourceResourceIdsUsed),
  };
}
