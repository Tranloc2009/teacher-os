import JSZip from 'jszip';
import type {
  AzotaAvailabilityReport,
  AzotaCommitResult,
  AzotaExamExportOutput,
  AzotaExamExportRequest,
  AzotaIntegrationProvider,
  AzotaLocalActivityEntry,
  AzotaOperationCapability,
  AzotaOperationResult,
  AzotaParsedResultRow,
  AzotaResultColumnMapping,
  AzotaResultColumnRole,
  AzotaResultImportPreview,
  AzotaResultImportRequest,
  AzotaRowMatchState,
  AzotaRowScoreStatus,
  ExternalIntegrationConfig,
} from '../types/azota';
import type {
  GradingSession,
  IntelligentGradebookEntry,
  OfficialGradeAuditEntry,
  StudentRecord,
} from '../types/grading';
import type { MathExamProject, MixedExamVersion } from '../types/mathExam';
import {
  buildConsolidatedAnswerCsv,
  buildStudentExamDocxBuffer,
} from './examExportEngine';
import {
  MCQ_LABELS,
  TF_LABELS,
  getOptionLetterLabel,
  getStatementLetterLabel,
} from './mathIntegrity';
import { parseCsvTable, parseXlsxFirstSheetRows } from './grading/rosterParser';

export const AZOTA_OFFICIAL_STATUS_BANNER =
  'AZOTA DIRECT API — NOT AVAILABLE / NOT VERIFIED';

export const AZOTA_VERIFICATION_NOTES: readonly string[] = [
  'Azota (azota.vn) hiện không công bố cổng Official Public Third-Party Developer API hoặc OAuth chính thức cho ứng dụng bên thứ ba.',
  'Các endpoint nội bộ của web/app Azota không có tài liệu công khai và không được phép reverse-engineer hay gọi trái phép.',
  'TeacherOS chỉ hỗ trợ quy trình trao đổi tệp tin chuẩn (Local-First File Compatibility): xuất file .DOCX đề thi để giáo viên chủ động tải lên Azota và nhập file .XLSX/.CSV kết quả xuất từ Azota về Sổ điểm.',
];

export const AZOTA_SECURITY_GUARANTEES: readonly string[] = [
  'Không gọi endpoint Azota chưa được xác minh và không giả lập kết nối thành công.',
  'Không bao giờ yêu cầu mật khẩu Azota, cookie phiên đăng nhập, unofficial token hay client secret.',
  'Không bypass CORS, không scraping dữ liệu sau đăng nhập, không tự động tải Resource Vault hay điểm học sinh ra ngoài.',
  'Mọi thao tác xuất đề hoặc nhập bảng điểm đều yêu cầu giáo viên xem trước và xác nhận thủ công.',
];

export const AZOTA_PROVIDER_CAPABILITIES: readonly AzotaOperationCapability[] = [
  {
    operation: 'CheckAvailability',
    labelVi: 'Kiểm tra trạng thái hỗ trợ',
    directApiStatus: 'NOT_SUPPORTED',
    fileFallbackStatus: 'SUPPORTED',
    summaryVi:
      'Xác nhận trung thực trạng thái API trực tiếp (chưa có API chính thức) và chế độ trao đổi tệp tin cục bộ.',
  },
  {
    operation: 'Connect',
    labelVi: 'Kết nối tài khoản Azota (API)',
    directApiStatus: 'NOT_SUPPORTED',
    fileFallbackStatus: 'NOT_APPLICABLE',
    summaryVi:
      'Trả về NOT_SUPPORTED. Không hỗ trợ đăng nhập bằng mật khẩu/cookie/token không chính thức.',
  },
  {
    operation: 'Disconnect',
    labelVi: 'Ngắt kết nối API',
    directApiStatus: 'NOT_SUPPORTED',
    fileFallbackStatus: 'NOT_APPLICABLE',
    summaryVi: 'Trả về NOT_SUPPORTED vì không tồn tại phiên API trực tiếp nào.',
  },
  {
    operation: 'ImportQuestions',
    labelVi: 'Nhập câu hỏi từ Azota',
    directApiStatus: 'NOT_SUPPORTED',
    fileFallbackStatus: 'MANUAL_IN_TOOL',
    summaryVi:
      'API trực tiếp trả về NOT_SUPPORTED. Giáo viên tải file Word/PDF đề về máy rồi nhập qua Resource Vault hoặc Exam Mixer Pro.',
  },
  {
    operation: 'ExportExam',
    labelVi: 'Xuất đề kiểm tra sang định dạng Azota',
    directApiStatus: 'NOT_SUPPORTED',
    fileFallbackStatus: 'SUPPORTED',
    summaryVi:
      'Hỗ trợ xuất file .DOCX cấu trúc tương thích trình đọc Word của Azota (kèm bảng đáp án cuối đề tùy chọn) để giáo viên tự tải lên.',
  },
  {
    operation: 'ImportResults',
    labelVi: 'Nhập kết quả điểm xuất từ Azota',
    directApiStatus: 'NOT_SUPPORTED',
    fileFallbackStatus: 'SUPPORTED',
    summaryVi:
      'Hỗ trợ đọc file .XLSX / .CSV kết quả tải từ Azota, cho phép ánh xạ cột, kiểm tra lỗi và xác nhận trước khi ghi vào Sổ điểm TeacherOS.',
  },
  {
    operation: 'SyncMetadata',
    labelVi: 'Đồng bộ ngầm danh sách lớp / đề thi',
    directApiStatus: 'NOT_SUPPORTED',
    fileFallbackStatus: 'NOT_APPLICABLE',
    summaryVi: 'Trả về NOT_SUPPORTED. TeacherOS không đồng bộ ngầm với máy chủ ngoài.',
  },
];

const FORBIDDEN_CREDENTIAL_KEY_PATTERN =
  /(password|passwd|pwd|cookie|session|token|secret|apikey|api_key|authorization|bearer|credential)/i;

export function createDefaultExternalIntegrationConfig(): ExternalIntegrationConfig {
  return {
    schemaVersion: '1.0',
    azota: {
      providerId: 'azota',
      activeMode: 'file-fallback',
      officialApiStatus: 'NOT_AVAILABLE_OR_NOT_VERIFIED',
      lastCheckedAt: null,
      lastExportAt: null,
      lastImportAt: null,
      preferredIncludeTrailingAnswerKey: true,
      preferredIncludeAnswerCsv: true,
      recentActivities: [],
    },
  };
}

/**
 * Bảo vệ tuyệt đối Mục 11.4 & Test #31:
 * Loại bỏ mọi khóa nhạy cảm (password/token/cookie/secret/apiKey) nếu có trước khi lưu IndexedDB/localStorage.
 */
export function sanitizeExternalIntegrationConfig(
  raw: unknown
): ExternalIntegrationConfig {
  const base = createDefaultExternalIntegrationConfig();
  if (!raw || typeof raw !== 'object') return base;

  const obj = raw as Record<string, unknown>;
  const rawAzota =
    obj.azota && typeof obj.azota === 'object'
      ? (obj.azota as Record<string, unknown>)
      : null;

  if (!rawAzota) return base;

  const cleanActivities: AzotaLocalActivityEntry[] = Array.isArray(
    rawAzota.recentActivities
  )
    ? rawAzota.recentActivities
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .slice(0, 20)
        .map((item, idx) => ({
          id: typeof item.id === 'string' && item.id ? item.id : `az-act-${idx}`,
          timestamp:
            typeof item.timestamp === 'string' && item.timestamp
              ? item.timestamp
              : new Date().toISOString(),
          action:
            item.action === 'availability-check' ||
            item.action === 'file-export' ||
            item.action === 'file-import' ||
            item.action === 'gradebook-commit'
              ? item.action
              : 'availability-check',
          summary: typeof item.summary === 'string' ? item.summary.slice(0, 240) : '',
          fileName:
            typeof item.fileName === 'string' ? item.fileName.slice(0, 160) : undefined,
        }))
    : [];

  return {
    schemaVersion: '1.0',
    azota: {
      providerId: 'azota',
      activeMode: 'file-fallback',
      officialApiStatus: 'NOT_AVAILABLE_OR_NOT_VERIFIED',
      lastCheckedAt:
        typeof rawAzota.lastCheckedAt === 'string' ? rawAzota.lastCheckedAt : null,
      lastExportAt:
        typeof rawAzota.lastExportAt === 'string' ? rawAzota.lastExportAt : null,
      lastImportAt:
        typeof rawAzota.lastImportAt === 'string' ? rawAzota.lastImportAt : null,
      preferredIncludeTrailingAnswerKey:
        typeof rawAzota.preferredIncludeTrailingAnswerKey === 'boolean'
          ? rawAzota.preferredIncludeTrailingAnswerKey
          : true,
      preferredIncludeAnswerCsv:
        typeof rawAzota.preferredIncludeAnswerCsv === 'boolean'
          ? rawAzota.preferredIncludeAnswerCsv
          : true,
      recentActivities: cleanActivities,
    },
  };
}

/**
 * Kiểm tra sâu đảm bảo đối tượng cấu hình không rò rỉ bất kỳ trường thông tin đăng nhập nào.
 */
export function hasForbiddenCredentialFields(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  if (Array.isArray(payload)) {
    return payload.some((item) => hasForbiddenCredentialFields(item));
  }
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (FORBIDDEN_CREDENTIAL_KEY_PATTERN.test(k)) return true;
    if (v && typeof v === 'object' && hasForbiddenCredentialFields(v)) return true;
  }
  return false;
}

export function appendAzotaActivity(
  config: ExternalIntegrationConfig,
  entry: Omit<AzotaLocalActivityEntry, 'id' | 'timestamp'>
): ExternalIntegrationConfig {
  const now = new Date().toISOString();
  const nextEntry: AzotaLocalActivityEntry = {
    id: `az-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: now,
    ...entry,
  };
  return sanitizeExternalIntegrationConfig({
    ...config,
    azota: {
      ...config.azota,
      lastCheckedAt:
        entry.action === 'availability-check' ? now : config.azota.lastCheckedAt,
      lastExportAt: entry.action === 'file-export' ? now : config.azota.lastExportAt,
      lastImportAt:
        entry.action === 'file-import' || entry.action === 'gradebook-commit'
          ? now
          : config.azota.lastImportAt,
      recentActivities: [nextEntry, ...config.azota.recentActivities].slice(0, 20),
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeViText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

function normalizeHeaderKey(raw: string): string {
  return normalizeViText(raw).replace(/[^a-z0-9]/g, '');
}

function sanitizeSafeFilePart(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

/**
 * Tạo bản sao chỉ đọc dạng MixedExamVersion từ đề gốc khi giáo viên muốn xuất
 * đề gốc sang định dạng DOCX tương thích Azota mà chưa trộn nhiều mã đề.
 * TUYỆT ĐỐI không thay đổi object `exam` gốc.
 */
function buildReadOnlyOriginalVersion(exam: MathExamProject): MixedExamVersion {
  const clonedQuestions = structuredClone(exam.questions);
  const answerKeyRows = clonedQuestions.map((q, idx) => {
    let answer = 'Tự luận';
    if (q.type === 'mcq' && q.options && q.options.length > 0) {
      const correctIdx = q.options.findIndex(
        (opt) => opt.isCorrect || opt.id === q.correctOptionId
      );
      answer =
        correctIdx >= 0
          ? getOptionLetterLabel(correctIdx) || MCQ_LABELS[correctIdx] || '?'
          : '?';
    } else if (q.type === 'true-false' && q.statements && q.statements.length > 0) {
      answer = q.statements
        .map(
          (st, sIdx) =>
            `${getStatementLetterLabel(sIdx) || TF_LABELS[sIdx] || `${sIdx + 1}`}:${
              st.isTrue ? 'Đ' : 'S'
            }`
        )
        .join(' ');
    } else if (q.type === 'short-answer' && q.shortAnswer) {
      answer = q.shortAnswer.answerValue;
    }
    return {
      number: idx + 1,
      questionId: q.id,
      originalCode: q.code,
      type: q.type,
      universalType: q.universalType,
      cognitiveLevel: q.cognitiveLevel,
      answer,
    };
  });

  const now = new Date().toISOString();
  return {
    code: 'GOC',
    seedUsed: 'original-readonly',
    generatedAt: now,
    questions: clonedQuestions,
    permutationMap: clonedQuestions.map((q, idx) => ({
      newOrderNumber: idx + 1,
      originalOrderNumber: idx + 1,
      questionId: q.id,
      originalCode: q.code,
      sectionTitle: q.sectionTitle,
      type: q.type,
      universalType: q.universalType,
      cognitiveLevel: q.cognitiveLevel,
      topic: q.topic,
      exactAnswerSummary: answerKeyRows[idx]?.answer ?? '',
      lockedPositionApplied: q.lockQuestionPosition,
      lockedOptionShuffleApplied: q.lockOptionShuffle,
    })),
    answerKeyRows,
    integrityPassed: true,
    integrityStatus: 'PASS',
    integrityWarnings: [],
  };
}

function makeAzotaAnswerSectionXml(version: MixedExamVersion): string {
  const lines: string[] = [];
  const makePara = (text: string, bold = false, before = 80) =>
    `<w:p><w:pPr><w:spacing w:before="${before}" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${
      bold ? '<w:b/>' : ''
    }<w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${escapeXml(
      text
    )}</w:t></w:r></w:p>`;

  lines.push(
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  );
  lines.push(
    makePara(
      `BẢNG ĐÁP ÁN (TƯƠNG THÍCH NHẬP FILE WORD AZOTA — MÃ ĐỀ ${version.code})`,
      true,
      120
    )
  );
  lines.push(
    makePara(
      'Ghi chú: Bảng đáp án này được đặt cuối tài liệu theo chuẩn phân tách đáp án Word để giáo viên kiểm tra nhanh khi tải tệp lên Azota.',
      false,
      40
    )
  );

  // Dòng tóm tắt chuẩn Azota: 1.A   2.C   3.B ...
  const compactEntries = version.answerKeyRows.map(
    (row) => `${row.number}.${row.answer}`
  );
  for (let i = 0; i < compactEntries.length; i += 5) {
    lines.push(makePara(compactEntries.slice(i, i + 5).join('    '), false, 40));
  }

  return lines.join('\n');
}

/**
 * Xây dựng file .DOCX tương thích Azota bằng cách tái sử dụng 100% engine xuất DOCX hiện có
 * (`buildStudentExamDocxBuffer`), giữ nguyên công thức OMML, hình ảnh, bảng biến thiên
 * và tùy chọn bổ sung phần BẢNG ĐÁP ÁN cuối tài liệu cho trình nhận diện Word của Azota.
 */
export async function buildAzotaCompatibleDocxBuffer(
  request: AzotaExamExportRequest
): Promise<AzotaExamExportOutput> {
  const targetVersion =
    request.version ?? buildReadOnlyOriginalVersion(request.exam);
  const warnings: string[] = [];

  if (!request.version) {
    warnings.push(
      'Đang xuất từ đề gốc (chưa trộn mã). Nếu muốn phát nhiều mã đề trên Azota, hãy trộn đề trong Exam Mixer Pro trước.'
    );
  }

  const hasNonMcq = targetVersion.questions.some((q) => q.type !== 'mcq');
  if (hasNonMcq) {
    warnings.push(
      'Đề có câu Đúng/Sai, Trả lời ngắn hoặc Tự luận — sau khi tải file lên Azota, giáo viên cần kiểm tra lại cấu hình điểm của các câu không phải trắc nghiệm 4 lựa chọn.'
    );
  }

  // Tái sử dụng 100% buildStudentExamDocxBuffer (bảo toàn công thức, đồ thị, hình ảnh)
  // Khi giáo viên chủ động xuất Đề gốc chưa trộn mã, cấp bản chiếu chỉ đọc chứa đúng 1 mã GOC (không sửa exam gốc)
  const examForExporter: MathExamProject =
    request.version || request.exam.generatedVersions.length > 0
      ? request.exam
      : {
          ...request.exam,
          generatedVersions: [targetVersion],
        };
  const baseBuffer = await buildStudentExamDocxBuffer(
    examForExporter,
    targetVersion,
    request.formTemplate ?? undefined
  );

  const zip = await JSZip.loadAsync(baseBuffer);
  const mediaFiles = Object.keys(zip.files).filter((f) =>
    f.startsWith('word/media/')
  );

  let finalBuffer = baseBuffer;
  if (request.includeTrailingAnswerKey) {
    const docEntry = zip.file('word/document.xml');
    if (docEntry) {
      const xml = await docEntry.async('string');
      const answerBlock = makeAzotaAnswerSectionXml(targetVersion);
      const patchedXml = xml.includes('<w:sectPr')
        ? xml.replace('<w:sectPr', `${answerBlock}\n<w:sectPr`)
        : xml.replace('</w:body>', `${answerBlock}\n</w:body>`);
      zip.file('word/document.xml', patchedXml);
      finalBuffer = await zip.generateAsync({ type: 'uint8array' });
    }
  }

  const safeTitle = sanitizeSafeFilePart(request.exam.title, 'DeKiemTra');
  const codeLabel = targetVersion.code;
  const docxFileName = `TeacherOS_Azota_${safeTitle}_Ma${codeLabel}.docx`;

  let answerCsvText: string | undefined;
  let answerCsvFileName: string | undefined;
  if (request.includeConsolidatedCsv) {
    if (request.exam.generatedVersions.length > 0) {
      answerCsvText = buildConsolidatedAnswerCsv(request.exam);
    } else {
      const header = 'Cau,MaDe_GOC,Diem';
      const rows = targetVersion.answerKeyRows.map((r, idx) => {
        const pts = targetVersion.questions[idx]?.points ?? 0;
        return `${r.number},"${r.answer.replace(/"/g, '""')}",${pts}`;
      });
      answerCsvText = `\uFEFF${[header, ...rows].join('\n')}`;
    }
    answerCsvFileName = `TeacherOS_Azota_DapAn_${safeTitle}_Ma${codeLabel}.csv`;
  }

  return {
    docxBuffer: finalBuffer,
    docxFileName,
    answerCsvText,
    answerCsvFileName,
    examCodeLabel: codeLabel,
    questionCount: targetVersion.questions.length,
    embeddedMediaCount: mediaFiles.length,
    manualUploadStepsVi: [
      'Bước 1: Mở tệp .DOCX vừa tải bằng Word/LibreOffice để kiểm tra nhanh hình ảnh và công thức.',
      'Bước 2: Đăng nhập tài khoản giáo viên trên azota.vn bằng trình duyệt của bạn (TeacherOS không bao giờ hỏi mật khẩu Azota).',
      'Bước 3: Chọn Đề thi → Tạo đề thi → Tải lên tệp .DOCX vừa xuất từ TeacherOS.',
      'Bước 4: Kiểm tra lại bảng đáp án Azota nhận diện so với file đáp án đi kèm rồi mới giao bài cho học sinh.',
    ],
    warnings,
  };
}

/**
 * Tự động đoán vai trò cột cho file bảng điểm Excel/CSV xuất từ Azota.
 */
export function inferAzotaColumnRole(headerText: string): AzotaResultColumnRole {
  const h = normalizeHeaderKey(headerText);
  if (!h) return 'ignore';
  if (['stt', 'sothutu', 'tt', 'no', 'index'].includes(h)) return 'stt';
  if (
    [
      'mahocsinh',
      'mahs',
      'sbd',
      'sobaodanh',
      'studentid',
      'id',
      'masv',
      'masohs',
      'mshs',
      'ma',
    ].includes(h)
  ) {
    return 'studentId';
  }
  if (
    [
      'hovaten',
      'hoten',
      'hocsinh',
      'tenhocsinh',
      'thisinh',
      'fullname',
      'studentname',
      'name',
      'ten',
    ].includes(h)
  ) {
    return 'fullName';
  }
  if (['lop', 'tenlop', 'class', 'classname', 'nhom'].includes(h)) {
    return 'className';
  }
  if (['made', 'madethi', 'examcode', 'code', 'de'].includes(h)) {
    return 'examCode';
  }
  if (
    [
      'diem',
      'diemso',
      'tongdiem',
      'diemthi',
      'diemtracnghiem',
      'score',
      'totalscore',
      'mark',
      'grade',
      'ketqua',
    ].includes(h)
  ) {
    return 'score';
  }
  if (
    [
      'socaudung',
      'caudung',
      'dung',
      'correct',
      'correctcount',
      'socaudungtn',
    ].includes(h)
  ) {
    return 'correctCount';
  }
  if (
    ['ghichu', 'nhanxet', 'trangthai', 'note', 'notes', 'comment', 'thoigiannop'].includes(
      h
    )
  ) {
    return 'notes';
  }
  return 'ignore';
}

function detectHeaderRowIndex(rawRows: string[][]): number {
  const maxCheck = Math.min(rawRows.length, 6);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < maxCheck; i += 1) {
    const row = rawRows[i];
    let recognized = 0;
    for (const cell of row) {
      if (inferAzotaColumnRole(cell) !== 'ignore') {
        recognized += 1;
      }
    }
    if (recognized > bestScore) {
      bestScore = recognized;
      bestIdx = i;
    }
  }
  return bestScore >= 2 ? bestIdx : 0;
}

function parseAzotaScoreCell(
  rawText: string,
  maxScore: number
): { numericScore: number | null; status: AzotaRowScoreStatus; warning?: string } {
  const trimmed = rawText.trim();
  if (!trimmed || trimmed === '-' || trimmed === '—') {
    return { numericScore: null, status: 'empty' };
  }

  const norm = normalizeViText(trimmed);
  if (
    ['v', 'vang', 'vang mat', 'chua nop', 'chua lam', 'absent', 'khong thi', 'bo thi'].includes(
      norm
    )
  ) {
    return {
      numericScore: null,
      status: 'absent',
      warning: `Trạng thái "${trimmed}" được giữ trống điểm (không quy đổi thành 0).`,
    };
  }

  // Hỗ trợ dạng "8,5" hoặc "8.5/10"
  const slashBase = trimmed.includes('/') ? trimmed.split('/')[0].trim() : trimmed;
  const normalizedNum = slashBase.replace(/,/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalizedNum)) {
    return {
      numericScore: null,
      status: 'invalid',
      warning: `Giá trị điểm "${trimmed}" không phải số hợp lệ.`,
    };
  }

  const parsed = Number(normalizedNum);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxScore) {
    return {
      numericScore: null,
      status: 'invalid',
      warning: `Điểm "${trimmed}" nằm ngoài thang 0..${maxScore}.`,
    };
  }

  return {
    numericScore: Math.round(parsed * 100) / 100,
    status: 'valid',
  };
}

function matchRowToRoster(
  studentId: string,
  fullName: string,
  roster: StudentRecord[]
): {
  matchState: AzotaRowMatchState;
  matchedStudentId: string | null;
  matchedStudentName: string | null;
  warning?: string;
} {
  if (roster.length === 0) {
    return {
      matchState: 'NO_ROSTER',
      matchedStudentId: studentId || null,
      matchedStudentName: fullName || null,
    };
  }

  const cleanId = studentId.trim().toUpperCase();
  if (cleanId) {
    const byId = roster.find((s) => s.studentId.trim().toUpperCase() === cleanId);
    if (byId) {
      return {
        matchState: 'MATCHED_ID',
        matchedStudentId: byId.studentId,
        matchedStudentName: byId.fullName,
      };
    }
  }

  const normName = normalizeViText(fullName);
  if (normName) {
    const byName = roster.filter((s) => normalizeViText(s.fullName) === normName);
    if (byName.length === 1) {
      return {
        matchState: 'MATCHED_NAME',
        matchedStudentId: byName[0].studentId,
        matchedStudentName: byName[0].fullName,
      };
    }
    if (byName.length > 1) {
      return {
        matchState: 'AMBIGUOUS',
        matchedStudentId: null,
        matchedStudentName: null,
        warning: `Có ${byName.length} học sinh trùng họ tên "${fullName}" trong danh sách lớp — cần bổ sung Mã HS/SBD để đối chiếu chính xác.`,
      };
    }
  }

  return {
    matchState: 'UNMATCHED',
    matchedStudentId: null,
    matchedStudentName: null,
    warning: `Không tìm thấy "${fullName || studentId}" trong danh sách lớp hiện tại.`,
  };
}

/**
 * Xây dựng bảng xem trước & kiểm tra lỗi từ các hàng bảng đã đọc + ánh xạ cột (có thể chỉnh lại trực tiếp trên UI).
 */
export function buildAzotaImportPreviewFromRows(params: {
  fileName: string;
  fileType: 'xlsx' | 'csv';
  rawRows: string[][];
  roster?: StudentRecord[];
  maxScore?: number;
  columnOverrides?: Record<number, AzotaResultColumnRole>;
}): AzotaResultImportPreview {
  const maxScore = params.maxScore ?? 10;
  const roster = params.roster ?? [];
  const rawRows = params.rawRows.filter((r) => r.some((c) => c.trim().length > 0));

  if (rawRows.length === 0) {
    return {
      fileName: params.fileName,
      fileType: params.fileType,
      maxScore,
      rawRows: [],
      headerRowIndex: 0,
      columns: [],
      rows: [],
      validScoreCount: 0,
      emptyScoreCount: 0,
      invalidScoreCount: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      warnings: [],
      errors: ['Tệp bảng điểm trống, không tìm thấy dữ liệu nào.'],
    };
  }

  const headerRowIndex = detectHeaderRowIndex(rawRows);
  const headerRow = rawRows[headerRowIndex] ?? [];
  const dataRows = rawRows.slice(headerRowIndex + 1);
  const maxCols = Math.max(
    headerRow.length,
    ...dataRows.slice(0, 20).map((r) => r.length)
  );

  const usedSingletonRoles = new Set<AzotaResultColumnRole>();
  const columns: AzotaResultColumnMapping[] = [];

  for (let c = 0; c < maxCols; c += 1) {
    const headerText = (headerRow[c] ?? `Cột ${c + 1}`).trim() || `Cột ${c + 1}`;
    let role: AzotaResultColumnRole;
    if (params.columnOverrides && params.columnOverrides[c] !== undefined) {
      role = params.columnOverrides[c];
    } else {
      const inferred = inferAzotaColumnRole(headerText);
      if (inferred !== 'ignore' && inferred !== 'notes' && usedSingletonRoles.has(inferred)) {
        role = 'ignore';
      } else {
        role = inferred;
        if (role !== 'ignore' && role !== 'notes') {
          usedSingletonRoles.add(role);
        }
      }
    }
    const sampleValues = dataRows
      .slice(0, 3)
      .map((r) => (r[c] ?? '').trim())
      .filter((v) => v.length > 0);
    columns.push({
      columnIndex: c,
      headerText,
      role,
      sampleValues,
    });
  }

  const colOf = (role: AzotaResultColumnRole): number =>
    columns.find((col) => col.role === role)?.columnIndex ?? -1;

  const idCol = colOf('studentId');
  const nameCol = colOf('fullName');
  const classCol = colOf('className');
  const codeCol = colOf('examCode');
  const scoreCol = colOf('score');
  const correctCol = colOf('correctCount');
  const noteCols = columns.filter((col) => col.role === 'notes').map((c) => c.columnIndex);

  const errors: string[] = [];
  const warnings: string[] = [];

  if (scoreCol === -1) {
    errors.push(
      'Chưa ánh xạ cột "Điểm số". Hãy chọn đúng cột điểm trong bảng ánh xạ trước khi nhập.'
    );
  }
  if (idCol === -1 && nameCol === -1) {
    errors.push(
      'Cần ánh xạ ít nhất một cột định danh học sinh ("Mã HS / SBD" hoặc "Họ và tên").'
    );
  }

  const parsedRows: AzotaParsedResultRow[] = [];
  const seenKeys = new Set<string>();
  let validScoreCount = 0;
  let emptyScoreCount = 0;
  let invalidScoreCount = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;

  dataRows.forEach((cells, idx) => {
    const studentId = idCol >= 0 ? (cells[idCol] ?? '').trim() : '';
    const fullName = nameCol >= 0 ? (cells[nameCol] ?? '').trim() : '';
    const className = classCol >= 0 ? (cells[classCol] ?? '').trim() : '';
    const examCode = codeCol >= 0 ? (cells[codeCol] ?? '').trim() : '';
    const rawScoreText = scoreCol >= 0 ? (cells[scoreCol] ?? '').trim() : '';
    const rawCorrect = correctCol >= 0 ? (cells[correctCol] ?? '').trim() : '';
    const notes = noteCols
      .map((nc) => (cells[nc] ?? '').trim())
      .filter(Boolean)
      .join(' · ');

    if (!studentId && !fullName && !rawScoreText) {
      return;
    }

    const rowWarnings: string[] = [];
    const scoreParsed = parseAzotaScoreCell(rawScoreText, maxScore);
    if (scoreParsed.warning) rowWarnings.push(scoreParsed.warning);

    if (scoreParsed.status === 'valid') validScoreCount += 1;
    else if (scoreParsed.status === 'invalid') invalidScoreCount += 1;
    else emptyScoreCount += 1;

    const correctNum =
      rawCorrect && /^\d+$/.test(rawCorrect) ? Number(rawCorrect) : null;

    const match = matchRowToRoster(studentId, fullName, roster);
    if (match.warning) rowWarnings.push(match.warning);
    if (match.matchState === 'MATCHED_ID' || match.matchState === 'MATCHED_NAME') {
      matchedCount += 1;
    } else if (match.matchState === 'UNMATCHED' || match.matchState === 'AMBIGUOUS') {
      unmatchedCount += 1;
    }

    const dedupeKey = (
      match.matchedStudentId ||
      studentId ||
      normalizeViText(fullName)
    ).toUpperCase();
    if (dedupeKey) {
      if (seenKeys.has(dedupeKey)) {
        rowWarnings.push(
          `Trùng học sinh "${fullName || studentId}" trong cùng tệp Azota — hãy kiểm tra lần nộp chính thức.`
        );
      } else {
        seenKeys.add(dedupeKey);
      }
    }

    parsedRows.push({
      rowIndex: headerRowIndex + 2 + idx,
      rawCells: cells,
      studentId,
      fullName,
      className,
      examCode,
      rawScoreText,
      numericScore: scoreParsed.numericScore,
      scoreStatus: scoreParsed.status,
      correctCount: correctNum,
      notes,
      matchState: match.matchState,
      matchedStudentId: match.matchedStudentId,
      matchedStudentName: match.matchedStudentName,
      warnings: rowWarnings,
    });
  });

  if (parsedRows.length === 0 && errors.length === 0) {
    errors.push('Không tìm thấy dòng dữ liệu học sinh hợp lệ sau dòng tiêu đề.');
  }
  if (invalidScoreCount > 0) {
    warnings.push(
      `Có ${invalidScoreCount} dòng có giá trị điểm không hợp lệ (sẽ không tự ghi điểm).`
    );
  }
  if (emptyScoreCount > 0) {
    warnings.push(
      `Có ${emptyScoreCount} dòng để trống/vắng thi — TeacherOS giữ nguyên trạng thái trống, tuyệt đối không tự điền 0 điểm.`
    );
  }
  if (unmatchedCount > 0) {
    warnings.push(
      `Có ${unmatchedCount} dòng chưa khớp trực tiếp với danh sách lớp hiện tại.`
    );
  }

  return {
    fileName: params.fileName,
    fileType: params.fileType,
    maxScore,
    rawRows,
    headerRowIndex,
    columns,
    rows: parsedRows,
    validScoreCount,
    emptyScoreCount,
    invalidScoreCount,
    matchedCount,
    unmatchedCount,
    warnings,
    errors,
  };
}

/**
 * Áp dụng kết quả Azota đã xem trước & được giáo viên xác nhận vào `GradingSession` hiện tại.
 * - BẮT BUỘC `teacherConfirmed === true` (không bao giờ nhập ngầm).
 * - Ghi nhận đầy đủ vào `gradebookEntries` và `gradeAuditTrail`.
 * - KHÔNG xóa phiếu OMR hay bằng chứng ảnh đã chấm trước đó.
 * - KHÔNG biến ô trống/vắng thành 0 điểm.
 */
export function commitAzotaResultsToSession(
  session: GradingSession,
  preview: AzotaResultImportPreview,
  teacherConfirmed: boolean
): AzotaCommitResult {
  if (!teacherConfirmed) {
    throw new Error(
      'Cần xác nhận trực tiếp của giáo viên trước khi ghi bảng điểm Azota vào TeacherOS.'
    );
  }
  if (preview.errors.length > 0) {
    throw new Error(preview.errors[0]);
  }

  const now = new Date().toISOString();
  const nextEntries: IntelligentGradebookEntry[] = structuredClone(
    session.gradebookEntries ?? []
  );
  const nextAudit: OfficialGradeAuditEntry[] = structuredClone(
    session.gradeAuditTrail ?? []
  );

  let importedCount = 0;
  let skippedEmptyCount = 0;
  let skippedInvalidCount = 0;
  let newAuditEntriesCount = 0;

  preview.rows.forEach((row, idx) => {
    if (row.scoreStatus === 'invalid') {
      skippedInvalidCount += 1;
      return;
    }
    if (row.scoreStatus !== 'valid' || row.numericScore === null) {
      skippedEmptyCount += 1;
      return;
    }

    const resolvedStudentId =
      row.matchedStudentId ||
      row.studentId ||
      `AZ-${String(idx + 1).padStart(3, '0')}`;
    const resolvedName =
      row.matchedStudentName || row.fullName || `Học sinh ${resolvedStudentId}`;
    const resolvedClass = row.className || session.className;

    const existingIdx = nextEntries.findIndex(
      (e) => e.studentId.trim().toUpperCase() === resolvedStudentId.trim().toUpperCase()
    );

    const noteSuffix = `Nhập từ file Azota (${preview.fileName})${
      row.notes ? ` · ${row.notes}` : ''
    }`;

    if (existingIdx >= 0) {
      const prev = nextEntries[existingIdx];
      const previousScore = prev.officialScore;
      const hasConflictWithOmr =
        prev.omrScore !== null && Math.abs(prev.omrScore - row.numericScore) > 0.001;

      nextEntries[existingIdx] = {
        ...prev,
        examCode: row.examCode || prev.examCode,
        officialScore: hasConflictWithOmr ? prev.officialScore : row.numericScore,
        officialScoreSource: hasConflictWithOmr ? prev.officialScoreSource : 'manual',
        reconciliationStatus: hasConflictWithOmr ? 'MISMATCH' : 'CONFIRMED',
        confirmedByTeacher: !hasConflictWithOmr,
        confirmedAt: !hasConflictWithOmr ? now : prev.confirmedAt,
        notes: hasConflictWithOmr
          ? `${prev.notes ? `${prev.notes} | ` : ''}Chênh lệch với điểm Azota (${row.numericScore}đ) — cần duyệt`
          : noteSuffix,
        updatedAt: now,
      };

      if (!hasConflictWithOmr) {
        nextAudit.push({
          id: `aud-az-${Date.now()}-${idx}`,
          studentId: resolvedStudentId,
          assessmentId: session.id,
          previousScore,
          newScore: row.numericScore,
          source: 'manual',
          timestamp: now,
          reason: `Nhập thủ công từ file kết quả Azota (${preview.fileName})`,
          confirmedStatus: 'CONFIRMED',
        });
        newAuditEntriesCount += 1;
      }
      importedCount += 1;
    } else {
      nextEntries.push({
        id: `gb-az-${Date.now()}-${idx}`,
        sessionId: session.id,
        orderNumber: nextEntries.length + 1,
        studentId: resolvedStudentId,
        fullName: resolvedName,
        className: resolvedClass,
        examCode: row.examCode || session.selectedExamCodes[0] || '',
        omrScore: null,
        photoScore: null,
        scoreDelta: null,
        officialScore: row.numericScore,
        officialScoreSource: 'manual',
        reconciliationStatus:
          row.matchState === 'AMBIGUOUS' ? 'REVIEW_REQUIRED' : 'CONFIRMED',
        confirmedByTeacher: row.matchState !== 'AMBIGUOUS',
        confirmedAt: row.matchState !== 'AMBIGUOUS' ? now : undefined,
        notes: noteSuffix,
        hasOmrEvidence: false,
        hasPhotoEvidence: false,
        updatedAt: now,
      });
      nextAudit.push({
        id: `aud-az-${Date.now()}-${idx}`,
        studentId: resolvedStudentId,
        assessmentId: session.id,
        previousScore: null,
        newScore: row.numericScore,
        source: 'manual',
        timestamp: now,
        reason: `Nhập thủ công từ file kết quả Azota (${preview.fileName})`,
        confirmedStatus:
          row.matchState === 'AMBIGUOUS' ? 'REVIEW_REQUIRED' : 'CONFIRMED',
      });
      newAuditEntriesCount += 1;
      importedCount += 1;
    }
  });

  const updatedSession: GradingSession = {
    ...session,
    gradebookEntries: nextEntries,
    gradeAuditTrail: nextAudit,
    updatedAt: now,
  };

  return {
    updatedSession,
    importedCount,
    skippedEmptyCount,
    skippedInvalidCount,
    newAuditEntriesCount,
  };
}

/**
 * Tạo tệp Excel mẫu (.xlsx) cấu trúc bảng điểm tương thích Azota (100% cục bộ bằng JSZip)
 * giúp giáo viên đối chiếu tên cột hoặc kiểm thử luồng ánh xạ trước khi nhập tệp thật.
 */
export async function buildAzotaSampleResultXlsxBuffer(
  students: StudentRecord[],
  classNameFallback = '12A1',
  examCodeFallback = '101'
): Promise<Uint8Array> {
  const zip = new JSZip();
  const sampleRows =
    students.length > 0
      ? students.slice(0, 8).map((st, idx) => [
          String(idx + 1),
          st.studentId,
          st.fullName,
          st.className || classNameFallback,
          examCodeFallback,
          idx === students.length - 1 ? '' : String(Math.min(10, 6.5 + (idx % 4) * 0.75)),
          idx === students.length - 1 ? 'Chưa nộp bài' : 'Đã nộp đúng hạn',
        ])
      : [
          ['1', 'HS001', 'Nguyễn Minh Anh', classNameFallback, examCodeFallback, '8.5', 'Đã nộp'],
          ['2', 'HS002', 'Trần Gia Huy', classNameFallback, examCodeFallback, '7,75', 'Đã nộp'],
          ['3', 'HS003', 'Lê Thảo Nguyên', classNameFallback, examCodeFallback, '9.25', 'Đã nộp'],
          ['4', 'HS004', 'Phạm Quốc Bảo', classNameFallback, examCodeFallback, '', 'Vắng thi'],
        ];

  const headers = ['STT', 'Mã HS', 'Họ và tên', 'Lớp', 'Mã đề', 'Điểm', 'Ghi chú'];
  const allRows = [headers, ...sampleRows];
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  const rowsXml = allRows
    .map((row, rIdx) => {
      const cells = row
        .map(
          (val, cIdx) =>
            `<c r="${cols[cIdx]}${rIdx + 1}" t="inlineStr"><is><t>${escapeXml(
              val
            )}</t></is></c>`
        )
        .join('');
      return `<row r="${rIdx + 1}">${cells}</row>`;
    })
    .join('');

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="BangDiem_Azota" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowsXml}</sheetData>
</worksheet>`
  );

  return zip.generateAsync({ type: 'uint8array' });
}

/**
 * Concrete Provider thực tế cho Azota:
 * - TUYỆT ĐỐI không gọi endpoint không xác minh.
 * - Mọi thao tác Direct API trả về trạng thái `NOT_SUPPORTED` rõ ràng.
 * - Hỗ trợ đầy đủ File-Based Fallback (xuất DOCX tương thích & nhập kết quả XLSX/CSV).
 */
export class LocalFileAzotaProvider implements AzotaIntegrationProvider {
  readonly providerId = 'azota' as const;

  async checkAvailability(): Promise<AzotaOperationResult<AzotaAvailabilityReport>> {
    const report: AzotaAvailabilityReport = {
      providerId: 'azota',
      displayName: 'Azota (azota.vn)',
      officialApiStatus: 'NOT_AVAILABLE_OR_NOT_VERIFIED',
      officialStatusBanner: AZOTA_OFFICIAL_STATUS_BANNER,
      directApiEnabled: false,
      fileFallbackSupported: true,
      checkedAt: new Date().toISOString(),
      verificationNotes: [...AZOTA_VERIFICATION_NOTES],
      securityGuarantees: [...AZOTA_SECURITY_GUARANTEES],
      capabilities: [...AZOTA_PROVIDER_CAPABILITIES],
    };
    return {
      operation: 'CheckAvailability',
      status: 'OK',
      code: 'AZOTA_DIRECT_API_NOT_VERIFIED_FILE_FALLBACK_READY',
      messageVi:
        'Azota chưa có Official Public API được xác minh. Đã kích hoạt chế độ Trao đổi tệp tin thủ công (Local-First).',
      mode: 'file-based',
      data: report,
    };
  }

  async connect(): Promise<AzotaOperationResult<never>> {
    return {
      operation: 'Connect',
      status: 'NOT_SUPPORTED',
      code: 'AZOTA_DIRECT_API_NOT_VERIFIED',
      messageVi:
        'NOT_SUPPORTED: Azota không có API công khai chính thức cho bên thứ ba. TeacherOS từ chối đăng nhập bằng mật khẩu/cookie hoặc giả lập kết nối.',
      mode: 'direct-api',
    };
  }

  async disconnect(): Promise<AzotaOperationResult<never>> {
    return {
      operation: 'Disconnect',
      status: 'NOT_SUPPORTED',
      code: 'AZOTA_DIRECT_API_NOT_VERIFIED',
      messageVi:
        'NOT_SUPPORTED: Không có phiên kết nối API trực tiếp nào tới Azota đang hoạt động.',
      mode: 'direct-api',
    };
  }

  async importQuestions(
    _params?: { mode?: 'direct-api' | 'file-based' }
  ): Promise<AzotaOperationResult<never>> {
    return {
      operation: 'ImportQuestions',
      status: 'NOT_SUPPORTED',
      code: 'AZOTA_DIRECT_API_NOT_VERIFIED',
      messageVi:
        'NOT_SUPPORTED qua API trực tiếp. Hãy tải file Word/PDF từ Azota về máy rồi nhập qua Resource Vault hoặc Exam Mixer Pro.',
      mode: 'direct-api',
    };
  }

  async syncMetadata(): Promise<AzotaOperationResult<never>> {
    return {
      operation: 'SyncMetadata',
      status: 'NOT_SUPPORTED',
      code: 'AZOTA_DIRECT_API_NOT_VERIFIED',
      messageVi:
        'NOT_SUPPORTED: TeacherOS không hỗ trợ đồng bộ ngầm danh sách bài thi hoặc điểm học sinh qua API chưa xác minh.',
      mode: 'direct-api',
    };
  }

  async exportExam(
    request: AzotaExamExportRequest
  ): Promise<AzotaOperationResult<AzotaExamExportOutput>> {
    if (request.mode === 'direct-api') {
      return {
        operation: 'ExportExam',
        status: 'NOT_SUPPORTED',
        code: 'AZOTA_DIRECT_API_NOT_VERIFIED',
        messageVi:
          'NOT_SUPPORTED: Chưa có API trực tiếp để đẩy đề lên Azota. Hãy dùng chế độ xuất tệp .DOCX thủ công.',
        mode: 'direct-api',
      };
    }

    if (!request.teacherConfirmedConsent) {
      return {
        operation: 'ExportExam',
        status: 'CONSENT_REQUIRED',
        code: 'TEACHER_CONSENT_REQUIRED',
        messageVi:
          'Cần giáo viên xác nhận trước khi xuất tệp đề kiểm tra chuẩn bị cho Azota.',
        mode: 'file-based',
      };
    }

    if (!request.exam || request.exam.questions.length === 0) {
      return {
        operation: 'ExportExam',
        status: 'VALIDATION_ERROR',
        code: 'EMPTY_EXAM',
        messageVi: 'Đề kiểm tra chưa có câu hỏi nào để xuất sang tệp tương thích Azota.',
        mode: 'file-based',
      };
    }

    const output = await buildAzotaCompatibleDocxBuffer(request);
    return {
      operation: 'ExportExam',
      status: 'OK',
      code: 'AZOTA_FILE_EXPORT_READY',
      messageVi: `Đã tạo tệp ${output.docxFileName} (${output.questionCount} câu). Giáo viên chủ động tải lên Azota theo hướng dẫn.`,
      mode: 'file-based',
      data: output,
      warnings: output.warnings,
    };
  }

  async importResults(
    request: AzotaResultImportRequest
  ): Promise<AzotaOperationResult<AzotaResultImportPreview>> {
    if (request.mode === 'direct-api') {
      return {
        operation: 'ImportResults',
        status: 'NOT_SUPPORTED',
        code: 'AZOTA_DIRECT_API_NOT_VERIFIED',
        messageVi:
          'NOT_SUPPORTED: Chưa có API trực tiếp để kéo điểm từ Azota. Hãy xuất file Excel/CSV từ Azota rồi nhập thủ công tại đây.',
        mode: 'direct-api',
      };
    }

    const lowerName = request.fileName.toLowerCase();
    const isXlsx = lowerName.endsWith('.xlsx');
    let rawRows: string[][] = [];

    try {
      if (isXlsx) {
        if (!request.fileBuffer) {
          return {
            operation: 'ImportResults',
            status: 'VALIDATION_ERROR',
            code: 'MISSING_FILE_BUFFER',
            messageVi: 'Thiếu dữ liệu nhị phân của tệp Excel (.xlsx).',
            mode: 'file-based',
          };
        }
        rawRows = await parseXlsxFirstSheetRows(request.fileBuffer);
      } else {
        const csvText =
          request.rawCsvText ??
          (request.fileBuffer
            ? new TextDecoder('utf-8').decode(
                request.fileBuffer instanceof Uint8Array
                  ? request.fileBuffer
                  : new Uint8Array(request.fileBuffer)
              )
            : '');
        rawRows = parseCsvTable(csvText);
      }
    } catch (err) {
      return {
        operation: 'ImportResults',
        status: 'VALIDATION_ERROR',
        code: 'FILE_PARSE_FAILED',
        messageVi:
          err instanceof Error
            ? `Không thể đọc tệp bảng điểm: ${err.message}`
            : 'Không thể phân tích tệp bảng điểm Excel/CSV.',
        mode: 'file-based',
      };
    }

    const preview = buildAzotaImportPreviewFromRows({
      fileName: request.fileName,
      fileType: isXlsx ? 'xlsx' : 'csv',
      rawRows,
      roster: request.roster,
      maxScore: request.maxScore,
      columnOverrides: request.columnOverrides,
    });

    if (preview.errors.length > 0 && preview.rawRows.length === 0) {
      return {
        operation: 'ImportResults',
        status: 'VALIDATION_ERROR',
        code: 'EMPTY_OR_INVALID_SHEET',
        messageVi: preview.errors[0],
        mode: 'file-based',
        data: preview,
      };
    }

    return {
      operation: 'ImportResults',
      status: 'OK',
      code: 'AZOTA_RESULTS_PREVIEW_READY',
      messageVi: `Đã đọc ${preview.rows.length} dòng từ "${request.fileName}" (${preview.validScoreCount} điểm hợp lệ). Vui lòng kiểm tra ánh xạ cột trước khi xác nhận nhập.`,
      mode: 'file-based',
      data: preview,
      warnings: preview.warnings,
    };
  }
}

export const defaultAzotaProvider = new LocalFileAzotaProvider();
