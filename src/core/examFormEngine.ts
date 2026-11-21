import type {
  ExamFormExportWarning,
  ExamFormPaginationEstimate,
  ExamFormPlaceholderContext,
  ExamFormPlaceholderToken,
  ExamFormPresetKind,
  ExamFormTemplate,
  ExamOptionLayout,
} from '../types/examForm';
import type {
  ExamExportSettings,
  MathExamProject,
  MathQuestion,
  MixedExamVersion,
} from '../types/mathExam';
import { normalizeVietnameseText } from './examGenerator/smartQuestionRetrieval';

export const EXAM_FORM_TEMPLATES_META_KEY = 'exam_form_templates_v1';

export const SUGGESTED_FORM_DISCLAIMER =
  'Cấu hình trình bày gợi ý để giáo viên tùy chỉnh (không tuyên bố là biểu mẫu quy chuẩn chính thức của Bộ GD&ĐT).';

export const EXAM_FORM_PLACEHOLDERS: ExamFormPlaceholderToken[] = [
  { token: '{{departmentName}}', key: 'departmentName', label: 'Sở / Phòng GD', example: 'SỞ GD&ĐT TP.HCM' },
  { token: '{{schoolName}}', key: 'schoolName', label: 'Tên trường', example: 'TRƯỜNG THPT NGUYỄN DU' },
  { token: '{{subjectGroupName}}', key: 'subjectGroupName', label: 'Tổ chuyên môn', example: 'TỔ TOÁN - TIN' },
  { token: '{{examTitle}}', key: 'examTitle', label: 'Tiêu đề kỳ kiểm tra', example: 'ĐỀ KIỂM TRA GIỮA HỌC KỲ I' },
  { token: '{{subject}}', key: 'subject', label: 'Môn học', example: 'Toán học' },
  { token: '{{grade}}', key: 'grade', label: 'Khối lớp', example: '12' },
  { token: '{{duration}}', key: 'duration', label: 'Thời gian', example: '90 phút' },
  { token: '{{schoolYear}}', key: 'schoolYear', label: 'Năm học', example: '2025 - 2026' },
  { token: '{{examCode}}', key: 'examCode', label: 'Mã đề', example: '101' },
];

const PLACEHOLDER_KEYS: ReadonlySet<string> = new Set(
  EXAM_FORM_PLACEHOLDERS.map((p) => p.key)
);

function makeBaseTemplate(params: {
  id: string;
  name: string;
  description: string;
  presetKind: ExamFormPresetKind;
  isDefault?: boolean;
  header?: Partial<ExamFormTemplate['headerSettings']>;
  studentInfo?: Partial<ExamFormTemplate['studentInfoSettings']>;
  page?: Partial<ExamFormTemplate['pageSettings']>;
  body?: Partial<ExamFormTemplate['bodySettings']>;
  answer?: Partial<ExamFormTemplate['answerLayout']>;
  footer?: Partial<ExamFormTemplate['footerSettings']>;
}): ExamFormTemplate {
  const ts = '2026-11-20T00:00:00.000Z';
  return {
    id: params.id,
    name: params.name,
    description: params.description,
    presetKind: params.presetKind,
    version: '1.1.0',
    isBuiltIn: true,
    isDefault: Boolean(params.isDefault),
    disclaimer: SUGGESTED_FORM_DISCLAIMER,
    pageSettings: {
      paperSize: 'A4',
      orientation: 'portrait',
      marginTopMm: 15,
      marginRightMm: 15,
      marginBottomMm: 15,
      marginLeftMm: 15,
      fontFamily: 'Times New Roman',
      fontSizePt: 12,
      lineHeight: 1.4,
      questionSpacingPx: 12,
      paragraphSpacingPt: 4,
      bodyAlignment: 'left',
      columns: 1,
      showPageNumbers: true,
      pageNumberFormat: 'page-of-total',
      showPageBreaks: true,
      examCodePosition: 'header-right',
      ...params.page,
    },
    headerSettings: {
      departmentName: 'SỞ GIÁO DỤC VÀ ĐÀO TẠO',
      schoolName: 'TRƯỜNG THPT / THCS',
      subjectGroupName: 'TỔ CHUYÊN MÔN',
      schoolYear: '2025 - 2026',
      examTitle: 'ĐỀ KIỂM TRA ĐỊNH KỲ',
      subjectOverride: '',
      gradeOverride: '',
      durationOverrideMinutes: null,
      showExamCode: true,
      showQuestionCountSubtitle: true,
      headerNote: 'Thí sinh không được sử dụng tài liệu. Giám thị không giải thích gì thêm.',
      schoolLogoDataUrl: '',
      schoolLogoWidthPx: 52,
      ...params.header,
    },
    studentInfoSettings: {
      showStudentBlock: true,
      showFullName: true,
      showClassName: true,
      showExamNumber: true,
      showStudentId: false,
      showExamDate: false,
      ...params.studentInfo,
    },
    bodySettings: {
      showSectionTitles: true,
      showSectionInstructions: true,
      sectionInstructionsOverride: '',
      showPointsPerQuestion: true,
      showSectionPointsSummary: true,
      questionNumberPrefix: 'Câu',
      optionLayout: 'auto',
      optionLabelStyle: 'dot',
      imageAlignment: 'center',
      formulaDisplayMode: 'preserve-original',
      shortAnswerBoxStyle: 'dotted-line',
      shortAnswerBlankLines: 1,
      essayAnswerLines: 4,
      essayLineStyle: 'dotted',
      ...params.body,
    },
    answerLayout: {
      includeSeparateAnswerKey: true,
      includePerCodeAnswerTable: true,
      includeDetailedSolutions: true,
      includeScoringRubric: true,
      includeMappingAuditTable: true,
      answerTableStyle: 'multi-column',
      answerColumns: 4,
      ...params.answer,
    },
    footerSettings: {
      showEndMarker: true,
      endMarkerText: '——— HẾT ———',
      footerNote: 'Thí sinh không viết vào phần đề thi khi chưa được giáo viên cho phép.',
      showCodeInFooter: true,
      ...params.footer,
    },
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * 10 mẫu gợi ý chuyên nghiệp có thể chỉnh sửa đầy đủ (không ghi đè bản gốc).
 */
export const BUILT_IN_EXAM_FORM_PRESETS: ExamFormTemplate[] = [
  makeBaseTemplate({
    id: 'form-preset-midterm',
    name: 'Kiểm tra giữa học kỳ',
    description: 'Bố cục đề giữa học kỳ chuẩn mực, khung Họ tên + SBD + Lớp và mã đề nổi bật.',
    presetKind: 'midterm',
    isDefault: true,
    header: {
      examTitle: 'ĐỀ KIỂM TRA GIỮA HỌC KỲ',
      durationOverrideMinutes: null,
    },
    studentInfo: {
      showFullName: true,
      showClassName: true,
      showExamNumber: true,
      showExamDate: true,
    },
    body: {
      optionLayout: '2-col',
    },
    answer: {
      answerTableStyle: 'multi-column',
      answerColumns: 4,
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-15m',
    name: 'Kiểm tra 15 phút',
    description: 'Bố cục gọn nhẹ cho bài kiểm tra thường xuyên 15 phút trên 1 mặt giấy A4.',
    presetKind: 'quiz-15m',
    page: {
      marginTopMm: 12,
      marginRightMm: 12,
      marginBottomMm: 12,
      marginLeftMm: 12,
      fontSizePt: 11.5,
      questionSpacingPx: 8,
    },
    header: {
      examTitle: 'ĐỀ KIỂM TRA THƯỜNG XUYÊN (15 PHÚT)',
      durationOverrideMinutes: 15,
      headerNote: 'Học sinh làm bài trực tiếp vào giấy kiểm tra.',
    },
    studentInfo: {
      showFullName: true,
      showClassName: true,
      showExamNumber: false,
      showStudentId: false,
      showExamDate: true,
    },
    body: {
      optionLayout: '2-col',
      showSectionInstructions: false,
      essayAnswerLines: 2,
    },
    answer: {
      answerTableStyle: 'horizontal',
      answerColumns: 5,
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-45m',
    name: 'Kiểm tra 45 phút',
    description: 'Cấu trúc kiểm tra 1 tiết (45 phút) cân đối giữa tiêu đề, thông tin học sinh và câu hỏi.',
    presetKind: 'test-45m',
    header: {
      examTitle: 'ĐỀ KIỂM TRA 45 PHÚT',
      durationOverrideMinutes: 45,
    },
    studentInfo: {
      showFullName: true,
      showClassName: true,
      showExamNumber: true,
      showExamDate: true,
    },
    body: {
      optionLayout: 'auto',
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-final',
    name: 'Kiểm tra cuối học kỳ',
    description: 'Trình bày trang trọng cho kỳ kiểm tra cuối học kỳ, kèm bảng điểm & đáp án riêng từng mã.',
    presetKind: 'final',
    page: {
      marginTopMm: 15,
      marginBottomMm: 15,
      marginLeftMm: 18,
      marginRightMm: 15,
      examCodePosition: 'top-box',
    },
    header: {
      examTitle: 'ĐỀ KIỂM TRA CUỐI HỌC KỲ',
      headerNote: 'Thí sinh kiểm tra đủ số trang đề thi trước khi làm bài. Không sử dụng tài liệu.',
    },
    studentInfo: {
      showFullName: true,
      showClassName: true,
      showExamNumber: true,
      showStudentId: true,
      showExamDate: true,
    },
    answer: {
      answerTableStyle: 'per-code',
      answerColumns: 4,
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-practice',
    name: 'Đề luyện tập',
    description: 'Phiếu ôn tập/luyện tập trên lớp hoặc về nhà, tối ưu khoảng trắng dễ ghi chú.',
    presetKind: 'practice',
    page: {
      fontFamily: 'Be Vietnam Pro',
      lineHeight: 1.5,
      questionSpacingPx: 14,
    },
    header: {
      examTitle: 'PHIẾU ĐỀ LUYỆN TẬP & CỦNG CỐ',
      showExamCode: false,
      headerNote: 'Học sinh trình bày rõ các bước biến đổi và tự đối chiếu đáp án sau khi hoàn thành.',
    },
    studentInfo: {
      showFullName: true,
      showClassName: true,
      showExamNumber: false,
      showExamDate: true,
    },
    body: {
      optionLayout: 'auto',
      shortAnswerBoxStyle: 'box',
      essayAnswerLines: 5,
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-mock',
    name: 'Thi thử tốt nghiệp THPT',
    description: 'Cấu trúc mô phỏng kỳ thi thử THPT nhiều mã đề, mã đề đóng khung rõ ràng, bảng đáp án theo từng phần.',
    presetKind: 'mock-exam',
    page: {
      examCodePosition: 'top-box',
      fontSizePt: 11.5,
      lineHeight: 1.35,
    },
    header: {
      examTitle: 'ĐỀ THI THỬ TỐT NGHIỆP THPT',
      headerNote: 'Đề thi gồm nhiều mã đề. Thí sinh tô đúng mã đề {{examCode}} vào phiếu trả lời trắc nghiệm.',
    },
    studentInfo: {
      showFullName: true,
      showClassName: false,
      showExamNumber: true,
      showStudentId: true,
      showExamDate: true,
    },
    body: {
      optionLayout: 'auto',
      shortAnswerBoxStyle: 'box',
      shortAnswerBlankLines: 1,
    },
    answer: {
      answerTableStyle: 'by-section',
      answerColumns: 4,
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-mcq',
    name: 'Đề trắc nghiệm nhiều mã',
    description: 'Tối ưu hiển thị phương án A/B/C/D gọn gàng cho đề 100% trắc nghiệm nhiều mã đề.',
    presetKind: 'mcq-only',
    page: {
      fontSizePt: 11.5,
      questionSpacingPx: 10,
    },
    header: {
      examTitle: 'ĐỀ KIỂM TRA TRẮC NGHIỆM',
      headerNote: 'Chọn một phương án đúng nhất cho mỗi câu hỏi và tô vào phiếu trả lời (Mã đề {{examCode}}).',
    },
    body: {
      optionLayout: '4-col',
      optionLabelStyle: 'dot',
      showPointsPerQuestion: false,
    },
    answer: {
      answerTableStyle: 'multi-column',
      answerColumns: 5,
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-essay',
    name: 'Đề tự luận',
    description: 'Giãn dòng thoáng, hiển thị điểm rõ từng câu/ý và vùng kẻ dòng cho bài kiểm tra tự luận.',
    presetKind: 'essay-only',
    page: {
      fontSizePt: 12.5,
      lineHeight: 1.55,
      questionSpacingPx: 18,
    },
    header: {
      examTitle: 'ĐỀ KIỂM TRA TỰ LUẬN',
      showExamCode: false,
      headerNote: 'Trình bày lời giải chi tiết, lập luận chặt chẽ và vẽ hình rõ ràng.',
    },
    body: {
      optionLayout: '1-col',
      showPointsPerQuestion: true,
      showSectionPointsSummary: true,
      essayAnswerLines: 6,
      essayLineStyle: 'dotted',
    },
    answer: {
      answerTableStyle: 'by-section',
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-hybrid',
    name: 'Đề kết hợp trắc nghiệm và tự luận',
    description: 'Tách rõ từng Phần I, II, III, IV theo cấu trúc đề kết hợp (TN + Đ/S + TLN + Tự luận).',
    presetKind: 'hybrid',
    header: {
      examTitle: 'ĐỀ KIỂM TRA KẾT HỢP TRẮC NGHIỆM & TỰ LUẬN',
      headerNote: 'Đề gồm nhiều phần câu hỏi. Đọc kỹ hướng dẫn đầu mỗi phần trước khi làm bài.',
    },
    body: {
      showSectionTitles: true,
      showSectionInstructions: true,
      showPointsPerQuestion: true,
      showSectionPointsSummary: true,
      optionLayout: 'auto',
      shortAnswerBoxStyle: 'box',
      essayAnswerLines: 4,
    },
    answer: {
      answerTableStyle: 'by-section',
      answerColumns: 4,
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-custom',
    name: 'Mẫu tùy chỉnh của giáo viên',
    description: 'Khung mẫu cơ bản để giáo viên tự thiết lập phong cách riêng và lưu dùng lại lâu dài.',
    presetKind: 'custom',
    page: {
      fontFamily: 'Be Vietnam Pro',
      fontSizePt: 12,
      lineHeight: 1.45,
    },
    header: {
      examTitle: 'ĐỀ KIỂM TRA',
      headerNote: '',
    },
  }),
];

/**
 * Xây dựng ngữ cảnh thay thế biến tự động (placeholder) từ đề thi, mã đề và mẫu hiện tại.
 */
export function buildPlaceholderContext(
  exam: MathExamProject,
  version: MixedExamVersion | null,
  template: ExamFormTemplate
): ExamFormPlaceholderContext {
  const durationMinutes =
    template.headerSettings.durationOverrideMinutes ?? exam.durationMinutes;
  const subject = template.headerSettings.subjectOverride.trim() || exam.subject;
  const grade = template.headerSettings.gradeOverride.trim() || exam.grade;
  const examCode = version?.code || 'GỐC';

  return {
    departmentName: template.headerSettings.departmentName,
    schoolName: template.headerSettings.schoolName,
    subjectGroupName: template.headerSettings.subjectGroupName,
    examTitle: template.headerSettings.examTitle || exam.title,
    subject,
    grade,
    duration: `${durationMinutes} phút`,
    schoolYear: template.headerSettings.schoolYear,
    examCode,
  };
}

/**
 * Thay thế AN TOÀN các placeholder hợp lệ (`{{schoolName}}`, `{{examCode}}`, ...) trong
 * tiêu đề, ghi chú đầu trang, chân trang.
 * TUYỆT ĐỐI KHÔNG bao giờ gọi lên nội dung câu hỏi hoặc công thức toán học.
 */
export function resolveExamFormPlaceholders(
  rawText: string,
  context: ExamFormPlaceholderContext
): string {
  if (!rawText || !rawText.includes('{{')) return rawText;
  return rawText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (fullMatch, key: string) => {
    if (!PLACEHOLDER_KEYS.has(key)) return fullMatch;
    const typedKey = key as keyof ExamFormPlaceholderContext;
    const val = context[typedKey];
    return typeof val === 'string' ? val : fullMatch;
  });
}

/**
 * Chọn bố cục cột phương án A/B/C/D tự động ('1-col' | '2-col' | '4-col') cho từng câu trắc nghiệm
 * dựa trên độ dài phương án, công thức và số cột trang A4 — đảm bảo không bóp nghẹt công thức/hình.
 */
export function resolveAutoOptionLayout(
  question: MathQuestion,
  template: ExamFormTemplate
): '1-col' | '2-col' | '4-col' {
  const options = question.options ?? [];
  if (options.length === 0) return '1-col';

  const hasVisualOption = options.some((o) => Boolean(o.visualAsset));
  if (hasVisualOption) return '1-col';

  const requested = template.bodySettings.optionLayout;
  if (requested !== 'auto') {
    return requested;
  }

  const lengths = options.map((opt) => {
    const plain = (opt.content.rawSource || '').replace(/\s+/g, ' ').trim();
    const formulaWeight =
      (opt.content.blocks ?? []).filter((b) => b.kind === 'latex').length * 6;
    return plain.length + formulaWeight;
  });
  const maxLen = Math.max(...lengths, 0);
  const hasMultiline = options.some((opt) => /\n/.test(opt.content.rawSource || ''));

  if (hasMultiline) return '1-col';

  if (template.pageSettings.columns === 2) {
    if (maxLen <= 22) return '2-col';
    return '1-col';
  }

  if (maxLen <= 18 && options.length === 4) return '4-col';
  if (maxLen <= 44) return '2-col';
  return '1-col';
}

/**
 * Ước lượng phân trang A4 và vị trí ngắt trang cho Live Preview & cảnh báo tràn trang.
 */
export function estimateExamFormPagination(
  questions: MathQuestion[],
  template: ExamFormTemplate
): ExamFormPaginationEstimate {
  const isLandscape = template.pageSettings.orientation === 'landscape';
  const pageWidthMm = isLandscape ? 297 : 210;
  const pageHeightMm = isLandscape ? 210 : 297;
  const usableWidthMm = Math.max(
    80,
    pageWidthMm - template.pageSettings.marginLeftMm - template.pageSettings.marginRightMm
  );
  const usableHeightMm = Math.max(
    100,
    pageHeightMm - template.pageSettings.marginTopMm - template.pageSettings.marginBottomMm - 14
  );

  const fontScale = template.pageSettings.fontSizePt / 12;
  const lineStepMm = 4.6 * fontScale * (template.pageSettings.lineHeight / 1.4);
  const spacingMm = (template.pageSettings.questionSpacingPx || 12) * 0.264;
  const columns = template.pageSettings.columns === 2 ? 2 : 1;
  const effectiveColHeightMm = usableHeightMm * columns;

  // Header + student block consumes space on page 1
  const headerCostMm =
    36 +
    (template.headerSettings.schoolLogoDataUrl ? 8 : 0) +
    (template.studentInfoSettings.showStudentBlock ? 14 : 0) +
    (template.headerSettings.headerNote.trim() ? 8 : 0);

  let currentPageUsedMm = headerCostMm;
  let pages = 1;
  const pageBreakBeforeIndices: number[] = [];

  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    const stemChars = (q.stem.rawSource || '').length;
    const charsPerLine = Math.max(32, Math.floor((usableWidthMm / columns) * (0.48 / fontScale)));
    const stemLines = Math.max(1, Math.ceil(stemChars / charsPerLine));
    let qHeightMm = stemLines * lineStepMm + spacingMm;

    if (q.visualAssets && q.visualAssets.length > 0) {
      qHeightMm += q.visualAssets.length * 42;
    }

    if (q.type === 'mcq' && q.options && q.options.length > 0) {
      const optLayout = resolveAutoOptionLayout(q, template);
      const rows =
        optLayout === '4-col'
          ? Math.ceil(q.options.length / 4)
          : optLayout === '2-col'
            ? Math.ceil(q.options.length / 2)
            : q.options.length;
      qHeightMm += rows * (lineStepMm + 1.2);
    } else if (q.type === 'true-false' && q.statements?.length) {
      qHeightMm += q.statements.length * (lineStepMm + 1.5);
    } else if (q.type === 'short-answer') {
      const blankLines = template.bodySettings.shortAnswerBlankLines ?? 1;
      qHeightMm += blankLines * 7 + (template.bodySettings.shortAnswerBoxStyle === 'box' ? 8 : 4);
    } else if (q.type === 'essay') {
      const essayLines = template.bodySettings.essayAnswerLines ?? 4;
      qHeightMm += essayLines * 6.5;
    }

    if (currentPageUsedMm + qHeightMm > effectiveColHeightMm && idx > 0) {
      pages += 1;
      pageBreakBeforeIndices.push(idx);
      currentPageUsedMm = qHeightMm;
    } else {
      currentPageUsedMm += qHeightMm;
    }
  }

  const avgMmPerQuestion =
    questions.length > 0 ? (pages * effectiveColHeightMm) / questions.length : 0;
  const densityLevel: ExamFormPaginationEstimate['densityLevel'] =
    template.pageSettings.fontSizePt <= 11 && template.pageSettings.lineHeight <= 1.2
      ? 'dense'
      : avgMmPerQuestion > 52
        ? 'comfortable'
        : 'balanced';

  const hasOverflowRisk =
    usableWidthMm < 150 ||
    template.pageSettings.marginTopMm < 10 ||
    template.pageSettings.marginBottomMm < 10 ||
    template.pageSettings.marginLeftMm < 10 ||
    template.pageSettings.marginRightMm < 10 ||
    (columns === 2 &&
      questions.some((q) => (q.visualAssets?.length ?? 0) > 0));

  return {
    estimatedPages: Math.max(1, pages),
    pageBreakBeforeIndices,
    hasOverflowRisk,
    densityLevel,
    usableHeightMm: Math.round(usableHeightMm),
    usableWidthMm: Math.round(usableWidthMm),
  };
}

/**
 * Hợp nhất danh sách mẫu đã lưu với 10 mẫu built-in mà không bao giờ làm mất mẫu tùy chỉnh cũ của giáo viên.
 */
export function mergeStoredExamFormTemplates(stored: unknown): ExamFormTemplate[] {
  const validStored: ExamFormTemplate[] = Array.isArray(stored)
    ? stored.filter(isValidExamFormTemplateShape)
    : [];

  const defaultBase = BUILT_IN_EXAM_FORM_PRESETS[0];
  const byId = new Map<string, ExamFormTemplate>();
  for (const preset of BUILT_IN_EXAM_FORM_PRESETS) {
    byId.set(preset.id, structuredClone(preset));
  }
  for (const item of validStored) {
    const builtInBase = byId.get(item.id);
    if (builtInBase) {
      byId.set(item.id, {
        ...builtInBase,
        ...item,
        isBuiltIn: true,
        pageSettings: { ...builtInBase.pageSettings, ...item.pageSettings },
        headerSettings: { ...builtInBase.headerSettings, ...item.headerSettings },
        studentInfoSettings: { ...builtInBase.studentInfoSettings, ...item.studentInfoSettings },
        bodySettings: { ...builtInBase.bodySettings, ...item.bodySettings },
        answerLayout: { ...builtInBase.answerLayout, ...item.answerLayout },
        footerSettings: { ...builtInBase.footerSettings, ...item.footerSettings },
        disclaimer: SUGGESTED_FORM_DISCLAIMER,
      });
    } else {
      byId.set(item.id, {
        ...structuredClone(defaultBase),
        ...item,
        isBuiltIn: false,
        pageSettings: { ...defaultBase.pageSettings, ...item.pageSettings },
        headerSettings: { ...defaultBase.headerSettings, ...item.headerSettings },
        studentInfoSettings: { ...defaultBase.studentInfoSettings, ...item.studentInfoSettings },
        bodySettings: { ...defaultBase.bodySettings, ...item.bodySettings },
        answerLayout: { ...defaultBase.answerLayout, ...item.answerLayout },
        footerSettings: { ...defaultBase.footerSettings, ...item.footerSettings },
        disclaimer: item.disclaimer || SUGGESTED_FORM_DISCLAIMER,
      });
    }
  }

  const list = Array.from(byId.values());
  if (!list.some((t) => t.isDefault) && list.length > 0) {
    list[0] = { ...list[0], isDefault: true };
  }
  return list;
}

export function isValidExamFormTemplateShape(val: unknown): val is ExamFormTemplate {
  if (!val || typeof val !== 'object') return false;
  const o = val as Partial<ExamFormTemplate>;
  return (
    typeof o.id === 'string' &&
    o.id.trim().length > 0 &&
    typeof o.name === 'string' &&
    o.name.trim().length > 0 &&
    typeof o.pageSettings === 'object' &&
    o.pageSettings !== null &&
    typeof o.headerSettings === 'object' &&
    o.headerSettings !== null &&
    typeof o.studentInfoSettings === 'object' &&
    o.studentInfoSettings !== null &&
    typeof o.bodySettings === 'object' &&
    o.bodySettings !== null &&
    typeof o.answerLayout === 'object' &&
    o.answerLayout !== null &&
    typeof o.footerSettings === 'object' &&
    o.footerSettings !== null
  );
}

export function createCustomFormTemplate(
  base: ExamFormTemplate,
  customName: string,
  nowIso = new Date().toISOString()
): ExamFormTemplate {
  const cleanName = customName.trim() || `${base.name} (Bản riêng)`;
  return {
    ...structuredClone(base),
    id: `form-custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    presetKind: 'custom',
    isBuiltIn: false,
    isDefault: false,
    disclaimer: SUGGESTED_FORM_DISCLAIMER,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function duplicateFormTemplate(
  source: ExamFormTemplate,
  nowIso = new Date().toISOString()
): ExamFormTemplate {
  return createCustomFormTemplate(source, `${source.name} (Bản sao)`, nowIso);
}

/**
 * Đổi tên mẫu tùy chỉnh. Mẫu built-in gốc được bảo vệ (không bị ghi đè).
 */
export function renameCustomFormTemplate(
  templates: ExamFormTemplate[],
  targetId: string,
  newName: string,
  nowIso = new Date().toISOString()
): { templates: ExamFormTemplate[]; renamed: boolean; reason?: string } {
  const cleanName = newName.trim();
  if (!cleanName) {
    return { templates, renamed: false, reason: 'Tên mẫu không được để trống.' };
  }
  const target = templates.find((t) => t.id === targetId);
  if (!target) {
    return { templates, renamed: false, reason: 'Không tìm thấy mẫu cần đổi tên.' };
  }
  if (target.isBuiltIn) {
    return {
      templates,
      renamed: false,
      reason: 'Không thể đổi tên trực tiếp mẫu chuẩn sẵn có — hãy nhân bản thành mẫu riêng.',
    };
  }
  return {
    renamed: true,
    templates: templates.map((t) =>
      t.id === targetId ? { ...t, name: cleanName, updatedAt: nowIso } : t
    ),
  };
}

/**
 * Lưu mẫu an toàn: nếu giáo viên đang sửa mẫu built-in gốc, tự động lưu thành bản tùy chỉnh mới
 * để KHÔNG BAO GIỜ ghi đè mẫu gốc của hệ thống.
 */
export function saveTemplateSafely(
  templates: ExamFormTemplate[],
  draft: ExamFormTemplate,
  customName?: string,
  nowIso = new Date().toISOString()
): { templates: ExamFormTemplate[]; savedTemplate: ExamFormTemplate; createdCopy: boolean } {
  if (draft.isBuiltIn) {
    const copy = createCustomFormTemplate(
      draft,
      customName?.trim() || `${draft.name} (Tùy chỉnh)`,
      nowIso
    );
    return {
      templates: upsertFormTemplate(templates, copy),
      savedTemplate: copy,
      createdCopy: true,
    };
  }
  const updated: ExamFormTemplate = {
    ...structuredClone(draft),
    name: customName?.trim() || draft.name,
    isBuiltIn: false,
    updatedAt: nowIso,
  };
  return {
    templates: upsertFormTemplate(templates, updated),
    savedTemplate: updated,
    createdCopy: false,
  };
}

/**
 * Xóa mẫu tùy chỉnh. Mẫu built-in gốc được bảo vệ tuyệt đối.
 */
export function deleteCustomFormTemplate(
  templates: ExamFormTemplate[],
  targetId: string
): { templates: ExamFormTemplate[]; deleted: boolean; reason?: string } {
  const target = templates.find((t) => t.id === targetId);
  if (!target) {
    return { templates, deleted: false, reason: 'Không tìm thấy mẫu.' };
  }
  if (target.isBuiltIn) {
    return {
      templates,
      deleted: false,
      reason: 'Không thể xóa mẫu gợi ý sẵn có của hệ thống.',
    };
  }
  const remaining = templates.filter((t) => t.id !== targetId);
  if (remaining.length > 0 && !remaining.some((t) => t.isDefault)) {
    remaining[0] = { ...remaining[0], isDefault: true };
  }
  return { templates: remaining, deleted: true };
}

export function setDefaultFormTemplate(
  templates: ExamFormTemplate[],
  targetId: string,
  nowIso = new Date().toISOString()
): ExamFormTemplate[] {
  if (!templates.some((t) => t.id === targetId)) return templates;
  return templates.map((t) => ({
    ...t,
    isDefault: t.id === targetId,
    updatedAt: t.id === targetId ? nowIso : t.updatedAt,
  }));
}

export function upsertFormTemplate(
  templates: ExamFormTemplate[],
  next: ExamFormTemplate
): ExamFormTemplate[] {
  const exists = templates.some((t) => t.id === next.id);
  if (!exists) return [next, ...templates];
  return templates.map((t) => (t.id === next.id ? next : t));
}

export function matchFormTemplateByLabelOrId(
  templates: ExamFormTemplate[],
  preferredId?: string | null,
  preferredLabel?: string | null
): ExamFormTemplate {
  if (preferredId) {
    const exact = templates.find((t) => t.id === preferredId);
    if (exact) return exact;
  }
  if (preferredLabel && preferredLabel.trim()) {
    const norm = normalizeVietnameseText(preferredLabel);
    const byName = templates.find((t) => {
      const tNorm = normalizeVietnameseText(t.name);
      return tNorm.includes(norm) || norm.includes(tNorm);
    });
    if (byName) return byName;
    if (norm.includes('15 phut')) {
      const m = templates.find((t) => t.presetKind === 'quiz-15m');
      if (m) return m;
    }
    if (norm.includes('45 phut')) {
      const m = templates.find((t) => t.presetKind === 'test-45m');
      if (m) return m;
    }
    if (norm.includes('giua hoc ky') || norm.includes('giua ky')) {
      const m = templates.find((t) => t.presetKind === 'midterm');
      if (m) return m;
    }
    if (norm.includes('cuoi hoc ky') || norm.includes('cuoi ky')) {
      const m = templates.find((t) => t.presetKind === 'final');
      if (m) return m;
    }
    if (norm.includes('thi thu')) {
      const m = templates.find((t) => t.presetKind === 'mock-exam');
      if (m) return m;
    }
    if (norm.includes('luyen tap')) {
      const m = templates.find((t) => t.presetKind === 'practice');
      if (m) return m;
    }
    if (norm.includes('tu luan')) {
      const m = templates.find((t) => t.presetKind === 'essay-only');
      if (m) return m;
    }
    if (norm.includes('trac nghiem')) {
      const m = templates.find((t) => t.presetKind === 'mcq-only');
      if (m) return m;
    }
  }
  return templates.find((t) => t.isDefault) ?? templates[0] ?? BUILT_IN_EXAM_FORM_PRESETS[0];
}

/**
 * Chuyển ExamFormTemplate thành ExamExportSettings tương thích ngược với Exam Mixer & Print Studio
 * mà KHÔNG làm thay đổi bất kỳ câu hỏi, công thức, hình ảnh hay đáp án nào của đề.
 */
export function mapFormTemplateToExportSettings(
  template: ExamFormTemplate
): ExamExportSettings {
  const avgMargin = Math.round(
    (template.pageSettings.marginTopMm +
      template.pageSettings.marginRightMm +
      template.pageSettings.marginBottomMm +
      template.pageSettings.marginLeftMm) /
      4
  );
  const clampedMargin: 10 | 15 | 20 =
    avgMargin <= 12 ? 10 : avgMargin >= 18 ? 20 : 15;

  return {
    departmentName: template.headerSettings.departmentName,
    schoolName: template.headerSettings.schoolName,
    examTitleOverride: template.headerSettings.examTitle,
    headerNote: template.headerSettings.headerNote,
    footerNote: template.footerSettings.footerNote,
    paperMarginMm: clampedMargin,
    fontFamily:
      template.pageSettings.fontFamily === 'Be Vietnam Pro'
        ? 'Be Vietnam Pro'
        : 'Times New Roman',
    includeAnswerKey: template.answerLayout.includeSeparateAnswerKey,
    includeAnswerMatrix: template.answerLayout.includePerCodeAnswerTable,
    includeMappingTable: template.answerLayout.includeMappingAuditTable,
    includeIntegritySummary: template.answerLayout.includeScoringRubric,
    separateAnswerKeySection: template.answerLayout.includeSeparateAnswerKey,
  };
}

/**
 * Xuất mẫu đề ra chuỗi JSON có cấu trúc hợp lệ.
 */
export function serializeFormTemplateJson(template: ExamFormTemplate): string {
  return JSON.stringify(
    {
      schema: 'teacheros.exam-form.v1',
      exportedAt: new Date().toISOString(),
      template,
    },
    null,
    2
  );
}

/**
 * Nhập mẫu đề từ chuỗi JSON và kiểm tra cấu trúc nghiêm ngặt.
 */
export function parseImportedFormTemplateJson(
  jsonText: string,
  nowIso = new Date().toISOString()
): { ok: true; template: ExamFormTemplate } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const candidate =
      parsed &&
      typeof parsed === 'object' &&
      'template' in parsed &&
      (parsed as { template?: unknown }).template
        ? (parsed as { template: unknown }).template
        : parsed;

    if (!isValidExamFormTemplateShape(candidate)) {
      return {
        ok: false,
        error:
          'File JSON không đúng cấu trúc mẫu đề TeacherOS (thiếu trường pageSettings/headerSettings/bodySettings).',
      };
    }

    const base = BUILT_IN_EXAM_FORM_PRESETS[0];
    const validOptionLayouts: ExamOptionLayout[] = ['auto', '1-col', '2-col', '4-col'];
    const rawOptionLayout = candidate.bodySettings.optionLayout;
    const optionLayout: ExamOptionLayout = validOptionLayouts.includes(rawOptionLayout)
      ? rawOptionLayout
      : 'auto';

    const imported: ExamFormTemplate = {
      ...structuredClone(base),
      ...candidate,
      id: `form-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      isBuiltIn: false,
      isDefault: false,
      disclaimer: SUGGESTED_FORM_DISCLAIMER,
      pageSettings: {
        ...base.pageSettings,
        ...candidate.pageSettings,
        paperSize: 'A4',
        marginTopMm: Math.max(8, Math.min(35, Number(candidate.pageSettings.marginTopMm) || 15)),
        marginRightMm: Math.max(8, Math.min(35, Number(candidate.pageSettings.marginRightMm) || 15)),
        marginBottomMm: Math.max(8, Math.min(35, Number(candidate.pageSettings.marginBottomMm) || 15)),
        marginLeftMm: Math.max(8, Math.min(35, Number(candidate.pageSettings.marginLeftMm) || 15)),
        fontSizePt: Math.max(10, Math.min(16, Number(candidate.pageSettings.fontSizePt) || 12)),
        columns: candidate.pageSettings.columns === 2 ? 2 : 1,
      },
      headerSettings: { ...base.headerSettings, ...candidate.headerSettings },
      studentInfoSettings: { ...base.studentInfoSettings, ...candidate.studentInfoSettings },
      bodySettings: { ...base.bodySettings, ...candidate.bodySettings, optionLayout },
      answerLayout: { ...base.answerLayout, ...candidate.answerLayout },
      footerSettings: { ...base.footerSettings, ...candidate.footerSettings },
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    return { ok: true, template: imported };
  } catch {
    return {
      ok: false,
      error: 'Không thể đọc JSON — vui lòng kiểm tra cú pháp file mẫu đề.',
    };
  }
}

/**
 * Kiểm tra cảnh báo & chốt chặn chất lượng trước khi xuất DOCX/PDF theo mẫu:
 * tuyệt đối không xuất lỗi im lặng.
 */
export function inspectFormExportWarnings(
  exam: MathExamProject,
  version: MixedExamVersion | null,
  template: ExamFormTemplate
): ExamFormExportWarning[] {
  const warnings: ExamFormExportWarning[] = [];

  if (!version || exam.generatedVersions.length === 0) {
    warnings.push({
      id: 'warn-no-version',
      severity: 'blocking',
      message: 'Đề kiểm tra chưa tạo mã đề nào trong Exam Mixer Pro.',
      recommendation:
        'Hãy mở Exam Mixer Pro để kiểm tra đáp án gốc và tạo ít nhất 1 mã đề trước khi xuất DOCX/PDF chính thức.',
    });
  }

  const unconfirmedCount = exam.questions.filter((q) => !q.answerConfirmed).length;
  if (!exam.confirmedOriginalAnswers || unconfirmedCount > 0) {
    warnings.push({
      id: 'warn-unconfirmed-answers',
      severity: 'blocking',
      message: `Còn ${unconfirmedCount || exam.questions.length} câu hỏi chưa xác nhận đáp án gốc chính thức.`,
      recommendation:
        'Mở Answer Key Studio hoặc Exam Mixer Pro để rà soát và xác nhận đầy đủ đáp án gốc trước khi xuất chính thức.',
    });
  }

  const questionsToInspect = version ? version.questions : exam.questions;

  const unrenderableVisuals = questionsToInspect.reduce((acc, q) => {
    const isBrokenAsset = (a: { required?: boolean; sourceData?: string }) =>
      Boolean(a.required) && (!a.sourceData || !a.sourceData.trim());
    const qBad = (q.visualAssets ?? []).filter(isBrokenAsset).length;
    const optBad = (q.options ?? []).filter(
      (o) => o.visualAsset && isBrokenAsset(o.visualAsset)
    ).length;
    return acc + qBad + optBad;
  }, 0);

  if (unrenderableVisuals > 0) {
    warnings.push({
      id: 'warn-unrenderable-media',
      severity: 'blocking',
      message: `Phát hiện ${unrenderableVisuals} hình ảnh/đồ thị bị hỏng hoặc không hiển thị được.`,
      recommendation:
        'Mở Document Import Doctor để kiểm tra và thay thế hình ảnh bị lỗi trước khi xuất DOCX.',
    });
  }

  const hasWideVisuals = questionsToInspect.some(
    (q) =>
      (q.visualAssets?.length ?? 0) > 0 ||
      (q.options ?? []).some((o) => Boolean(o.visualAsset))
  );

  if (template.pageSettings.columns === 2 && hasWideVisuals) {
    warnings.push({
      id: 'warn-2col-visuals',
      severity: 'warning',
      message: 'Mẫu đang chọn chia 2 cột trong khi đề có hình vẽ / bảng biến thiên / đồ thị.',
      recommendation:
        'Nên chuyển về 1 cột hoặc kiểm tra kỹ trang A4 sau khi xuất DOCX để hình và bảng biến thiên không bị thu hẹp.',
    });
  }

  if (template.pageSettings.columns === 2 && template.bodySettings.optionLayout === '4-col') {
    warnings.push({
      id: 'warn-2col-4opt',
      severity: 'warning',
      message: 'Chia 2 cột trang kết hợp 4 cột phương án A/B/C/D có thể làm chật công thức Toán.',
      recommendation:
        'Khuyến nghị đổi định dạng phương án sang Tự động, 1 cột hoặc 2 cột khi dùng bố cục trang 2 cột.',
    });
  }

  const minMargin = Math.min(
    template.pageSettings.marginTopMm,
    template.pageSettings.marginRightMm,
    template.pageSettings.marginBottomMm,
    template.pageSettings.marginLeftMm
  );
  if (minMargin < 10) {
    warnings.push({
      id: 'warn-narrow-margin',
      severity: 'warning',
      message: `Lề trang tối thiểu hiện là ${minMargin}mm (< 10mm), một số máy in văn phòng có thể cắt mép.`,
      recommendation: 'Nên đặt lề tối thiểu từ 10–15mm để in A4 an toàn.',
    });
  }

  const pagination = estimateExamFormPagination(questionsToInspect, template);
  if (pagination.densityLevel === 'dense') {
    warnings.push({
      id: 'warn-dense-layout',
      severity: 'warning',
      message: 'Cỡ chữ nhỏ kết hợp giãn dòng hẹp có thể làm khó đọc công thức phân số / tích phân.',
      recommendation: 'Nên dùng cỡ chữ 11.5–13pt và giãn dòng tối thiểu 1.35 cho đề Toán.',
    });
  }

  return warnings;
}

/**
 * Tạo dòng thông tin học sinh thống nhất cho cả Preview A4 và file DOCX.
 */
export function buildStudentInfoLine(template: ExamFormTemplate): string {
  const s = template.studentInfoSettings;
  if (!s.showStudentBlock) return '';
  const parts: string[] = [];
  if (s.showFullName) parts.push('Họ và tên thí sinh: .............................................');
  if (s.showClassName) parts.push('Lớp: ............');
  if (s.showExamNumber) parts.push('Số báo danh: ....................');
  if (s.showStudentId) parts.push('Mã HS: ................');
  if (s.showExamDate) parts.push('Ngày kiểm tra: ..../..../20....');
  return parts.join('   ');
}
