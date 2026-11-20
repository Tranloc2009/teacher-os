import type {
  ExamFormExportWarning,
  ExamFormPresetKind,
  ExamFormTemplate,
} from '../types/examForm';
import type {
  ExamExportSettings,
  MathExamProject,
  MixedExamVersion,
} from '../types/mathExam';
import { normalizeVietnameseText } from './examGenerator/smartQuestionRetrieval';

export const EXAM_FORM_TEMPLATES_META_KEY = 'exam_form_templates_v1';

export const SUGGESTED_FORM_DISCLAIMER =
  'Cấu hình trình bày gợi ý để giáo viên tùy chỉnh (không tuyên bố là biểu mẫu quy chuẩn chính thức của Bộ GD&ĐT).';

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
    version: '1.0.0',
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
      columns: 1,
      showPageNumbers: true,
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
      optionLayout: '2-col',
      optionLabelStyle: 'dot',
      imageAlignment: 'center',
      formulaDisplayMode: 'preserve-original',
      ...params.body,
    },
    answerLayout: {
      includeSeparateAnswerKey: true,
      includePerCodeAnswerTable: true,
      includeDetailedSolutions: true,
      includeScoringRubric: true,
      includeMappingAuditTable: true,
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
 * 10 mẫu gợi ý có thể chỉnh sửa đầy đủ theo Section 12.1.
 */
export const BUILT_IN_EXAM_FORM_PRESETS: ExamFormTemplate[] = [
  makeBaseTemplate({
    id: 'form-preset-midterm',
    name: 'Kiểm tra giữa học kỳ',
    description: 'Bố cục đề giữa học kỳ chuẩn mực, có khung Họ tên + SBD + Lớp và mã đề nổi bật.',
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
  }),
  makeBaseTemplate({
    id: 'form-preset-mock',
    name: 'Đề thi thử',
    description: 'Cấu trúc mô phỏng kỳ thi thử với khung mã đề rõ ràng, có thể bật 2 cột tiết kiệm giấy.',
    presetKind: 'mock-exam',
    page: {
      examCodePosition: 'top-box',
      fontSizePt: 11.5,
      lineHeight: 1.35,
    },
    header: {
      examTitle: 'ĐỀ THI THỬ TỔNG HỢP',
      headerNote: 'Đề thi gồm nhiều mã đề. Thí sinh tô đúng mã đề vào phiếu trả lời trắc nghiệm.',
    },
    studentInfo: {
      showFullName: true,
      showClassName: false,
      showExamNumber: true,
      showStudentId: true,
      showExamDate: true,
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-mcq',
    name: 'Đề trắc nghiệm',
    description: 'Tối ưu hiển thị phương án A/B/C/D gọn gàng cho đề 100% trắc nghiệm.',
    presetKind: 'mcq-only',
    page: {
      fontSizePt: 11.5,
      questionSpacingPx: 10,
    },
    header: {
      examTitle: 'ĐỀ KIỂM TRA TRẮC NGHIỆM',
      headerNote: 'Chọn một phương án đúng nhất cho mỗi câu hỏi và tô vào phiếu trả lời.',
    },
    body: {
      optionLayout: '4-col',
      optionLabelStyle: 'dot',
      showPointsPerQuestion: false,
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-essay',
    name: 'Đề tự luận',
    description: 'Giãn dòng thoáng, hiển thị điểm rõ từng câu/ý cho bài kiểm tra tự luận.',
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
    },
  }),
  makeBaseTemplate({
    id: 'form-preset-hybrid',
    name: 'Đề kết hợp (TN + Đ/S + TLN + Tự luận)',
    description: 'Tách rõ từng Phần I, II, III, IV theo hướng dẫn đề kết hợp hiện hành.',
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
      optionLayout: '2-col',
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
 * Hợp nhất danh sách mẫu đã lưu với 10 mẫu built-in mà không bao giờ làm mất mẫu tùy chỉnh cũ của giáo viên.
 */
export function mergeStoredExamFormTemplates(stored: unknown): ExamFormTemplate[] {
  const validStored: ExamFormTemplate[] = Array.isArray(stored)
    ? stored.filter(isValidExamFormTemplateShape)
    : [];

  const byId = new Map<string, ExamFormTemplate>();
  for (const preset of BUILT_IN_EXAM_FORM_PRESETS) {
    byId.set(preset.id, structuredClone(preset));
  }
  for (const item of validStored) {
    // Giữ nguyên mẫu tùy chỉnh của người dùng và các chỉnh sửa trên mẫu sẵn có
    const builtInBase = byId.get(item.id);
    if (builtInBase) {
      byId.set(item.id, {
        ...builtInBase,
        ...item,
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
        ...item,
        isBuiltIn: false,
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
 * Xuất mẫu đề ra chuỗi JSON có cấu trúc hợp lệ (Section 12.4).
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
        error: 'File JSON không đúng cấu trúc mẫu đề TeacherOS (thiếu trường pageSettings/headerSettings/bodySettings).',
      };
    }

    const base = BUILT_IN_EXAM_FORM_PRESETS[0];
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
      bodySettings: { ...base.bodySettings, ...candidate.bodySettings },
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
 * Kiểm tra cảnh báo trước khi xuất DOCX/PDF theo mẫu (Section 12.5):
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

  const questionsToInspect = version ? version.questions : exam.questions;
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
        'Khuyến nghị đổi định dạng phương án sang 1 cột hoặc 2 cột khi dùng bố cục trang 2 cột.',
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
