import JSZip from 'jszip';
import type { ResourceItem } from '../../types/lesson';
import {
  MATH_SECTION_TITLES,
  type CognitiveLevel,
  type ExamSubjectId,
  type MathQuestion,
  type MathQuestionType,
} from '../../types/mathExam';
import type { BankQuestionRecord } from '../../types/examGenerator';
import type {
  QuestionAnswerStatus,
  QuestionSourceProvenance,
  QuestionSourceVerificationState,
  ResourceExtractionOutcome,
} from '../../types/resourceIntelligence';
import { computeContentHash } from '../mathIntegrity';
import {
  buildUniversalLockState,
  captureQuestionOriginalSnapshot,
  createImmutableContentPayload,
  getSubjectProfile,
  resolveSubjectId,
} from '../subjectProfileRegistry';
import { runUniversalImportSession } from '../universalImportAdapter';
import { parseUniversalExamText } from '../universalImportEngine';

function makeDeterministicId(prefix: string, seed: string): string {
  const hash = computeContentHash(seed).slice(0, 10);
  return `${prefix}-${hash}`;
}

export function normalizeFolderPath(resource: ResourceItem): string | undefined {
  const rel = resource.sourceFile?.relativePath?.trim();
  if (rel && rel.includes('/')) {
    const parts = rel.split('/').filter(Boolean);
    if (parts.length > 1) {
      return parts.slice(0, -1).join('/');
    }
  }
  const segments = [resource.subject, resource.grade, resource.chapterTopic]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return segments.length > 0 ? segments.join(' / ') : undefined;
}

function mapTierToCognitiveLevel(
  resource: ResourceItem,
  fallback: CognitiveLevel = 'thong-hieu'
): CognitiveLevel {
  if (resource.tier === 'basic') return 'nhan-biet';
  if (resource.tier === 'applied') return 'thong-hieu';
  if (resource.tier === 'extended') return 'van-dung';
  return fallback;
}

function cognitiveToDifficultyScore(level: CognitiveLevel): 1 | 2 | 3 | 4 {
  if (level === 'nhan-biet') return 1;
  if (level === 'thong-hieu') return 2;
  if (level === 'van-dung') return 3;
  return 4;
}

function inferCognitiveLevelFromText(text: string, fallback: CognitiveLevel): CognitiveLevel {
  const lower = text.toLowerCase();
  if (/vận dụng cao|van dung cao|\bvdc\b|nâng cao|tham số m|cực trị chứa tham số/.test(lower)) {
    return 'van-dung-cao';
  }
  if (/vận dụng|van dung|\bvd\b|bài toán thực tế|tối ưu/.test(lower)) {
    return 'van-dung';
  }
  if (/nhận biết|nhan biet|\bnb\b|khẳng định nào|tập xác định|đường tiệm cận/.test(lower)) {
    return 'nhan-biet';
  }
  if (/thông hiểu|thong hieu|\bth\b|tính giá trị|đồng biến|nghịch biến/.test(lower)) {
    return 'thong-hieu';
  }
  return fallback;
}

function hasFormulaBlocks(q: MathQuestion): boolean {
  const payloads = [
    q.stem,
    q.solutionGuide,
    ...(q.options ?? []).map((o) => o.content),
    ...(q.statements ?? []).map((s) => s.content),
  ];
  for (const p of payloads) {
    if (!p) continue;
    if (
      p.blocks.some(
        (b) => b.kind === 'latex' || b.kind === 'omml-raw' || b.kind === 'mathml'
      )
    ) {
      return true;
    }
    if (/\$[^$]+\$|\\frac|\\sqrt|\\int|\\sum|\\lim|x\^/.test(p.rawSource)) {
      return true;
    }
  }
  return false;
}

function hasOmmlOrBinaryBlocks(q: MathQuestion): boolean {
  const payloads = [
    q.stem,
    q.solutionGuide,
    ...(q.options ?? []).map((o) => o.content),
    ...(q.statements ?? []).map((s) => s.content),
  ];
  return payloads.some(
    (p) =>
      Boolean(p) &&
      p.blocks.some((b) => b.kind === 'omml-raw' || b.kind === 'mathml')
  );
}

function computeQuestionContentHash(q: MathQuestion): string {
  const parts = [
    q.type,
    q.stem.rawSource.trim(),
    ...(q.options ?? []).map((o) => `${o.originalLabel}:${o.content.rawSource.trim()}`),
    ...(q.statements ?? []).map((s) => `${s.originalLabel}:${s.content.rawSource.trim()}`),
    ...(q.visualAssets ?? []).map((a) => a.checksum),
  ];
  return computeContentHash(parts.join('||'));
}

function determineAnswerStatus(q: MathQuestion): QuestionAnswerStatus {
  const hasAnswerValue =
    (q.type === 'mcq' && Boolean(q.correctOptionId)) ||
    (q.type === 'true-false' &&
      Boolean(
        q.statements &&
          q.statements.length > 0 &&
          q.statements.some((s) => typeof s.isTrue === 'boolean')
      )) ||
    (q.type === 'short-answer' && Boolean(q.shortAnswer?.answerValue?.trim())) ||
    (q.type === 'essay' && Boolean(q.solutionGuide?.rawSource?.trim()));

  if (!hasAnswerValue) return 'missing';
  return q.answerConfirmed ? 'confirmed' : 'unconfirmed';
}

function determineVerificationStatus(
  q: MathQuestion,
  ommlWarning: boolean,
  answerStatus: QuestionAnswerStatus
): QuestionSourceVerificationState {
  if (q.sourceVerification?.verificationStatus === 'BLOCKED') return 'BLOCKED';
  if (
    ommlWarning ||
    q.sourceVerification?.verificationStatus === 'REVIEW_REQUIRED' ||
    answerStatus !== 'confirmed'
  ) {
    return 'REVIEW_REQUIRED';
  }
  return 'READY';
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === '"' && csvText[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csvText[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

function colRefToIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, col - 1);
}

/**
 * Đọc hàng từ sheet đầu tiên của tệp XLSX bằng JSZip có sẵn (không thêm dependency mới).
 */
async function readFirstXlsxSheetRows(bytes: Uint8Array): Promise<{
  sheetName: string;
  rows: string[][];
}> {
  const zip = await JSZip.loadAsync(bytes);
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings: string[] = [];
  if (sharedStringsXml) {
    const siMatches = sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi);
    for (const m of siMatches) {
      const textParts = Array.from(m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)).map((t) =>
        decodeXmlEntities(t[1])
      );
      sharedStrings.push(textParts.join(''));
    }
  }

  const sheetFiles = Object.keys(zip.files)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort();
  if (sheetFiles.length === 0) {
    return { sheetName: 'Sheet1', rows: [] };
  }

  const sheetXml = await zip.file(sheetFiles[0])!.async('string');
  const rows: string[][] = [];
  const rowMatches = sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi);
  for (const rm of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rm[1].matchAll(
      /<c\b([^>]*)>([\s\S]*?)<\/c>/gi
    );
    for (const cm of cellMatches) {
      const attrs = cm[1];
      const inner = cm[2];
      const refMatch = attrs.match(/\br="([A-Z]+\d+)"/i);
      const typeMatch = attrs.match(/\bt="([^"]+)"/i);
      const colIdx = refMatch ? colRefToIndex(refMatch[1]) : cells.length;
      const cellType = typeMatch?.[1] ?? '';

      let val = '';
      if (cellType === 'inlineStr') {
        val = Array.from(inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi))
          .map((t) => decodeXmlEntities(t[1]))
          .join('');
      } else {
        const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
        const rawVal = vMatch ? decodeXmlEntities(vMatch[1]) : '';
        if (cellType === 's') {
          val = sharedStrings[Number(rawVal)] ?? rawVal;
        } else {
          val = rawVal;
        }
      }
      while (cells.length < colIdx) cells.push('');
      cells[colIdx] = val.trim();
    }
    if (cells.some((c) => c.length > 0)) {
      rows.push(cells);
    }
  }

  return { sheetName: 'Sheet1', rows };
}

/**
 * Đọc bảng câu hỏi từ tệp XLSX/CSV trong Resource Vault (chỉ đọc, không sửa tệp gốc).
 */
async function parseSpreadsheetQuestionBank(
  bytes: Uint8Array,
  ext: string,
  resource: ResourceItem,
  subjectId: ExamSubjectId
): Promise<{ questions: MathQuestion[]; warnings: string[] }> {
  const warnings: string[] = [];
  const questions: MathQuestion[] = [];
  const now = new Date().toISOString();

  try {
    let sheetName = 'CSV';
    let rawRows: string[][];
    if (ext === 'csv') {
      const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
      rawRows = parseCsvRows(text);
    } else {
      const xlsxRes = await readFirstXlsxSheetRows(bytes);
      sheetName = xlsxRes.sheetName;
      rawRows = xlsxRes.rows;
    }

    if (rawRows.length < 2) {
      return {
        questions: [],
        warnings: ['Tệp bảng tính không có dòng tiêu đề và dữ liệu câu hỏi hợp lệ.'],
      };
    }

    const headers = rawRows[0].map((h) => h.trim().toLowerCase());
    const dataRows = rawRows.slice(1);

    const pickField = (cells: string[], patterns: RegExp[]): string => {
      for (let i = 0; i < headers.length; i += 1) {
        if (patterns.some((p) => p.test(headers[i]))) {
          return (cells[i] ?? '').trim();
        }
      }
      return '';
    };

    dataRows.forEach((cells, idx) => {
      const stemText = pickField(cells, [
        /câu hỏi|cau hoi|nội dung|noi dung|stem|question|đề bài|de bai/,
      ]);
      if (!stemText) return;

      const optA = pickField(cells, [/^a$|^pa\s*a|đáp án a|phuong an a|option\s*a/]);
      const optB = pickField(cells, [/^b$|^pa\s*b|đáp án b|phuong an b|option\s*b/]);
      const optC = pickField(cells, [/^c$|^pa\s*c|đáp án c|phuong an c|option\s*c/]);
      const optD = pickField(cells, [/^d$|^pa\s*d|đáp án d|phuong an d|option\s*d/]);
      const answerRaw = pickField(cells, [/đáp án đúng|dap an dung|đáp án|dap an|answer|key/]);
      const topicRaw =
        pickField(cells, [/chủ đề|chu de|chương|chuong|topic|chapter/]) ||
        resource.chapterTopic ||
        resource.title;
      const levelRaw = pickField(cells, [/mức độ|muc do|level|nhận thức/]);
      const solutionRaw = pickField(cells, [/lời giải|loi giai|giải thích|explanation|solution/]);
      const typeRaw = pickField(cells, [/loại|loai|type/]).toLowerCase();

      const has4Mcq = Boolean(optA && optB && optC && optD);
      let qType: MathQuestionType = has4Mcq ? 'mcq' : 'short-answer';
      if (/tự luận|tu luan|essay/.test(typeRaw)) qType = 'essay';
      else if (/trả lời ngắn|tra loi ngan|short/.test(typeRaw)) qType = 'short-answer';

      const qId = makeDeterministicId('rvxls', `${resource.id}::${idx}::${stemText}`);
      const cognitiveLevel = inferCognitiveLevelFromText(
        `${levelRaw} ${stemText}`,
        mapTierToCognitiveLevel(resource)
      );

      let options: MathQuestion['options'];
      let correctOptionId: string | undefined;
      let answerConfirmed = false;
      let shortAnswer: MathQuestion['shortAnswer'];

      if (qType === 'mcq' && has4Mcq) {
        const labels = ['A', 'B', 'C', 'D'] as const;
        const vals = [optA, optB, optC, optD];
        const ansLetter = answerRaw.trim().toUpperCase().match(/^([ABCD])\b/)?.[1];
        options = labels.map((lbl, i) => ({
          id: `${qId}-opt-${lbl}`,
          originalLabel: lbl,
          content: createImmutableContentPayload(vals[i], `${qId}-opt-${lbl}`),
          isCorrect: Boolean(ansLetter && ansLetter === lbl),
          isLockedPosition: false,
        }));
        if (ansLetter) {
          const found = options.find((o) => o.originalLabel === ansLetter);
          if (found) {
            correctOptionId = found.id;
            answerConfirmed = true;
          }
        }
      } else if (qType === 'short-answer') {
        if (answerRaw) {
          shortAnswer = {
            answerValue: answerRaw,
            acceptedFormats: [answerRaw],
          };
          answerConfirmed = true;
        }
      } else if (qType === 'essay') {
        answerConfirmed = Boolean(solutionRaw || answerRaw);
      }

      const question: MathQuestion = {
        id: qId,
        code: `RV-${String(idx + 1).padStart(2, '0')}`,
        type: qType,
        universalType: qType,
        subjectId,
        sectionTitle: MATH_SECTION_TITLES[qType],
        cognitiveLevel,
        difficultyScore: cognitiveToDifficultyScore(cognitiveLevel),
        topic: topicRaw,
        points: qType === 'mcq' ? 0.25 : 0.5,
        stem: createImmutableContentPayload(stemText, `${qId}-stem`),
        options,
        correctOptionId,
        shortAnswer,
        solutionGuide: createImmutableContentPayload(solutionRaw || '', `${qId}-sol`),
        answerConfirmed,
        lockQuestionPosition: false,
        lockOptionShuffle: false,
        allowStatementShuffle: false,
        dependencyFlags: [],
        hasVisualAsset: false,
        visualAssets: [],
        sourceVerification: {
          sourceFormat: ext,
          sourceBlockId: `sheet-row-${idx + 2}`,
          pageNumber: undefined,
          verificationStatus: answerConfirmed ? 'READY' : 'REVIEW_REQUIRED',
          verifiedByTeacher: false,
          reasons: answerConfirmed
            ? [`Trích xuất từ dòng ${idx + 2} trang "${sheetName}".`]
            : [`Dòng ${idx + 2} chưa có đáp án xác thực — hệ thống KHÔNG tự đoán.`],
          formulaRiskFlags: [],
        },
        createdAt: now,
        updatedAt: now,
      };
      question.universalLock = buildUniversalLockState(question);
      question.originalSnapshot = captureQuestionOriginalSnapshot(question);
      questions.push(question);
    });
  } catch (err) {
    warnings.push(
      `Không thể đọc bảng tính "${resource.sourceFile?.fileName ?? resource.title}": ${
        err instanceof Error ? err.message : 'Lỗi định dạng bảng tính.'
      }`
    );
  }

  return { questions, warnings };
}

function buildSingleResourceQuestion(
  resource: ResourceItem,
  subjectId: ExamSubjectId
): MathQuestion {
  const now = new Date().toISOString();
  const qId = makeDeterministicId('rvtxt', `${resource.id}::${resource.content}`);
  const hasAnswer = Boolean(resource.answerOrNote && resource.answerOrNote.trim());
  const qType: MathQuestionType =
    resource.points && resource.points >= 2 ? 'essay' : 'short-answer';
  const cognitiveLevel = inferCognitiveLevelFromText(
    `${resource.title} ${resource.tags.join(' ')} ${resource.content}`,
    mapTierToCognitiveLevel(resource)
  );
  const question: MathQuestion = {
    id: qId,
    code: `RV-${computeContentHash(resource.id).slice(0, 4).toUpperCase()}`,
    type: qType,
    universalType: qType,
    subjectId,
    sectionTitle: MATH_SECTION_TITLES[qType],
    cognitiveLevel,
    difficultyScore: cognitiveToDifficultyScore(cognitiveLevel),
    topic: resource.chapterTopic?.trim() || resource.tags[0] || resource.title,
    points: resource.points ?? 1,
    stem: createImmutableContentPayload(resource.content.trim(), `${qId}-stem`),
    shortAnswer:
      qType === 'short-answer' && hasAnswer
        ? {
            answerValue: resource.answerOrNote.trim(),
            acceptedFormats: [resource.answerOrNote.trim()],
          }
        : undefined,
    solutionGuide: createImmutableContentPayload(
      hasAnswer ? resource.answerOrNote.trim() : '',
      `${qId}-sol`
    ),
    answerConfirmed: false, // Never auto-confirm free-form notes without teacher confirmation
    lockQuestionPosition: false,
    lockOptionShuffle: false,
    allowStatementShuffle: false,
    dependencyFlags: [],
    hasVisualAsset: false,
    visualAssets: [],
    sourceVerification: {
      sourceFormat: 'vault-text',
      sourceBlockId: `res-${resource.id}`,
      verificationStatus: 'REVIEW_REQUIRED',
      verifiedByTeacher: false,
      reasons: [
        'Trích xuất từ mục câu hỏi trong Resource Vault — cần giáo viên duyệt đáp án trước khi xuất bản.',
      ],
      formulaRiskFlags: [],
    },
    createdAt: now,
    updatedAt: now,
  };
  question.universalLock = buildUniversalLockState(question);
  question.originalSnapshot = captureQuestionOriginalSnapshot(question);
  return question;
}

function mapQuestionToBankRecord(params: {
  question: MathQuestion;
  index: number;
  resource: ResourceItem;
  subjectId: ExamSubjectId;
  subjectName: string;
  folderPath?: string;
  indexedAt: string;
}): BankQuestionRecord {
  const { question, index, resource, subjectId, subjectName, folderPath, indexedAt } = params;
  const contentHash = computeQuestionContentHash(question);
  const stableId = `rvq::${resource.id}::${contentHash.slice(0, 10)}`;
  const ommlWarning = hasOmmlOrBinaryBlocks(question) || Boolean(resource.sourceFile?.hasOmml);
  const visualAssetCount = question.visualAssets?.length ?? 0;
  const hasVisual = Boolean(question.hasVisualAsset) || visualAssetCount > 0;
  const answerStatus = determineAnswerStatus(question);
  const verificationStatus = determineVerificationStatus(question, ommlWarning, answerStatus);

  // Use real PDF page number ONLY when provided by extractor — never fabricate page numbers
  const realSourcePage =
    typeof question.sourceVerification?.pageNumber === 'number' &&
    question.sourceVerification.pageNumber > 0
      ? question.sourceVerification.pageNumber
      : undefined;

  const sourceSection = question.sourceVerification?.sourceBlockId || `Câu #${index + 1}`;

  const topic =
    (question.topic && question.topic !== 'Tổng hợp' && question.topic.trim()) ||
    resource.chapterTopic?.trim() ||
    resource.tags[0] ||
    'Tổng hợp';

  const cognitiveLevel =
    question.cognitiveLevel ||
    inferCognitiveLevelFromText(
      `${question.stem.rawSource} ${resource.title}`,
      mapTierToCognitiveLevel(resource)
    );

  const excerptRaw = question.stem.rawSource.trim();
  const sourceExcerpt =
    excerptRaw.length > 260 ? `${excerptRaw.slice(0, 257)}...` : excerptRaw;

  const provenance: QuestionSourceProvenance = {
    resourceId: resource.id,
    resourceTitle: resource.title,
    fileName: resource.sourceFile?.fileName || `${resource.title}.txt`,
    folderPath,
    sourcePage: realSourcePage,
    sourceSection,
    sourceExcerpt,
    sourceQuestionId: question.id,
    contentHash,
    sourceFileSha256: resource.sourceFile?.sha256,
    resourceUpdatedAt: resource.updatedAt,
    subjectName,
    grade: resource.grade || 'Lớp 12',
    chapter: resource.chapterTopic?.trim() || undefined,
    topic,
    questionType: question.type,
    cognitiveLevel,
    answerStatus,
    verificationStatus,
    hasMathFormula: hasFormulaBlocks(question),
    visualAssetCount,
    ommlWarning: ommlWarning || undefined,
    teacherEdited: false,
    indexedAt,
  };

  const clonedQuestion: MathQuestion = structuredClone(question);
  clonedQuestion.id = stableId;
  clonedQuestion.topic = topic;
  clonedQuestion.cognitiveLevel = cognitiveLevel;
  clonedQuestion.subjectId = subjectId;

  return {
    id: stableId,
    code: question.code || `RV-${String(index + 1).padStart(2, '0')}`,
    subjectId,
    subjectName,
    grade: resource.grade || 'Lớp 12',
    topic,
    cognitiveLevel,
    type: question.type,
    points: question.points || (question.type === 'mcq' ? 0.25 : 1),
    sourceKind: 'resource-vault',
    sourceExamId: resource.id,
    sourceExamTitle: resource.title,
    sourceProvenance: provenance,
    hasBinaryFormulaOrOmml: ommlWarning,
    hasNonUpdatableVisualAsset: hasVisual,
    question: clonedQuestion,
    createdAt: indexedAt,
    updatedAt: indexedAt,
  };
}

/**
 * Pipeline trích xuất & lập chỉ mục câu hỏi từ một tài liệu Resource Vault.
 * Tuyệt đối KHÔNG thay đổi tệp gốc hay ResourceItem gốc.
 */
export async function extractQuestionsFromResourceItem(
  resource: ResourceItem,
  attachment?: {
    blob?: Blob | null;
    bytes?: Uint8Array | ArrayBuffer | null;
    textOverride?: string;
  },
  options?: {
    pdfWorkerSrc?: string;
  }
): Promise<ResourceExtractionOutcome> {
  const indexedAt = new Date().toISOString();
  const subjectId = resolveSubjectId(resource.subject);
  const subjectName = resource.subject?.trim() || getSubjectProfile(subjectId).name;
  const folderPath = normalizeFolderPath(resource);
  const fileName = resource.sourceFile?.fileName || `${resource.title}.txt`;
  const ext = (resource.sourceFile?.extension || fileName.split('.').pop() || 'txt').toLowerCase();

  let rawBytes: Uint8Array | undefined;
  if (attachment?.bytes instanceof Uint8Array) {
    rawBytes = attachment.bytes;
  } else if (attachment?.bytes instanceof ArrayBuffer) {
    rawBytes = new Uint8Array(attachment.bytes);
  } else if (attachment?.blob) {
    const ab = await attachment.blob.arrayBuffer();
    rawBytes = new Uint8Array(ab);
  }

  let extractedQuestions: MathQuestion[] = [];
  let detectedFormat = ext;
  const warnings: string[] = [];

  const idCounter = { n: 0 };
  const createIdFn = (prefix: string) => {
    idCounter.n += 1;
    return `${prefix}-${computeContentHash(`${resource.id}:${idCounter.n}`).slice(0, 8)}`;
  };

  if (rawBytes && rawBytes.byteLength > 0) {
    if (ext === 'xlsx' || ext === 'csv') {
      detectedFormat = ext;
      const xlsRes = await parseSpreadsheetQuestionBank(rawBytes, ext, resource, subjectId);
      extractedQuestions = xlsRes.questions;
      warnings.push(...xlsRes.warnings);
    } else {
      const session = await runUniversalImportSession(
        {
          fileName,
          mimeType: resource.sourceFile?.mimeType,
          buffer: rawBytes,
        },
        createIdFn,
        {
          subjectId,
          workerSrc: options?.pdfWorkerSrc,
          renderPreviews: false,
        }
      );
      detectedFormat = session.detection.detectedFormat;
      extractedQuestions = session.questions;
      warnings.push(...session.compatibilityReport.warnings);
      if (
        session.compatibilityReport.status === 'UNSUPPORTED' ||
        session.compatibilityReport.status === 'BLOCKED'
      ) {
        warnings.push(...session.compatibilityReport.recommendations);
      }
    }
  }

  // Fallback to structured text stored inside ResourceItem (e.g., exam text or question-template)
  if (extractedQuestions.length === 0) {
    const sourceText = (attachment?.textOverride ?? resource.content ?? '').trim();
    if (sourceText) {
      const looksLikeMultiQuestion =
        /(?:^|\n)\s*(?:Câu|Bài|Question)\s*\d+\s*[:.)]/i.test(sourceText);

      if (looksLikeMultiQuestion) {
        detectedFormat = resource.sourceFile ? `${ext}-text-extract` : 'vault-exam-text';
        const parsed = parseUniversalExamText(sourceText, createIdFn, {
          subjectId,
          codePrefix: 'RV',
          fileName,
          sourceFormat: 'text',
        });
        extractedQuestions = parsed.questions;
        warnings.push(...parsed.report.warnings);
      } else if (
        resource.type === 'question-template' ||
        resource.documentCategory === 'de-thi' ||
        resource.documentCategory === 'bai-tap'
      ) {
        detectedFormat = 'vault-single-question';
        extractedQuestions = [buildSingleResourceQuestion(resource, subjectId)];
      } else {
        warnings.push(
          `Tài liệu "${resource.title}" không có cấu trúc câu hỏi chuẩn ("Câu 1: ... A. ... B. ...") hoặc không phải tệp đề thi/bài tập.`
        );
      }
    } else {
      warnings.push(`Tài liệu "${resource.title}" chưa có tệp nội dung để trích xuất câu hỏi.`);
    }
  }

  // Deduplicate within the same resource by contentHash
  const seenHashes = new Set<string>();
  const bankItems: BankQuestionRecord[] = [];
  let skippedDuplicateCount = 0;

  extractedQuestions.forEach((q, idx) => {
    const mapped = mapQuestionToBankRecord({
      question: q,
      index: idx,
      resource,
      subjectId,
      subjectName,
      folderPath,
      indexedAt,
    });
    const hash = mapped.sourceProvenance!.contentHash;
    if (seenHashes.has(hash)) {
      skippedDuplicateCount += 1;
      return;
    }
    seenHashes.add(hash);
    bankItems.push(mapped);
  });

  const unconfirmedAnswerCount = bankItems.filter(
    (b) => b.sourceProvenance?.answerStatus !== 'confirmed'
  ).length;
  const blockedForVariantCount = bankItems.filter(
    (b) => b.hasBinaryFormulaOrOmml || b.hasNonUpdatableVisualAsset
  ).length;

  return {
    items: bankItems,
    summary: {
      resourceId: resource.id,
      resourceTitle: resource.title,
      fileName,
      folderPath,
      detectedFormat,
      extractedCount: bankItems.length,
      addedCount: bankItems.length,
      updatedCount: 0,
      skippedDuplicateCount,
      preservedTeacherEditedCount: 0,
      unconfirmedAnswerCount,
      blockedForVariantCount,
      warnings: Array.from(new Set(warnings)),
      indexedAt,
      sourceResourceUpdatedAt: resource.updatedAt,
      sourceFileSha256: resource.sourceFile?.sha256,
    },
  };
}

/**
 * Hợp nhất an toàn các câu hỏi trích xuất từ Resource Vault vào ngân hàng câu hỏi hợp nhất.
 * - Dùng stable ID + contentHash chống trùng lặp.
 * - KHÔNG BAO GIỜ ghi đè câu hỏi đã được giáo viên chỉnh sửa hoặc xác nhận thủ công.
 */
export function reconcileResourceBankIndex(
  existingBank: readonly BankQuestionRecord[],
  extractedItems: readonly BankQuestionRecord[],
  resourceId: string
): {
  mergedBank: BankQuestionRecord[];
  toPersist: BankQuestionRecord[];
  addedCount: number;
  updatedCount: number;
  skippedDuplicateCount: number;
  preservedTeacherEditedCount: number;
} {
  const existingById = new Map(existingBank.map((b) => [b.id, b]));
  const existingHashesOtherResources = new Set<string>();

  for (const item of existingBank) {
    if (item.sourceProvenance?.resourceId !== resourceId) {
      const h = item.sourceProvenance?.contentHash ?? computeQuestionContentHash(item.question);
      existingHashesOtherResources.add(h);
    }
  }

  const nextById = new Map(existingBank.map((b) => [b.id, structuredClone(b)]));
  const toPersist: BankQuestionRecord[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  let skippedDuplicateCount = 0;
  let preservedTeacherEditedCount = 0;

  for (const incoming of extractedItems) {
    const hash =
      incoming.sourceProvenance?.contentHash ?? computeQuestionContentHash(incoming.question);
    const existingSameId = existingById.get(incoming.id);

    if (existingSameId) {
      if (existingSameId.sourceProvenance?.teacherEdited) {
        preservedTeacherEditedCount += 1;
        continue;
      }
      const updatedRecord: BankQuestionRecord = {
        ...incoming,
        templateId: existingSameId.templateId ?? incoming.templateId,
        createdAt: existingSameId.createdAt,
      };
      nextById.set(updatedRecord.id, updatedRecord);
      toPersist.push(updatedRecord);
      updatedCount += 1;
      continue;
    }

    if (existingHashesOtherResources.has(hash)) {
      skippedDuplicateCount += 1;
      continue;
    }

    nextById.set(incoming.id, structuredClone(incoming));
    toPersist.push(structuredClone(incoming));
    existingHashesOtherResources.add(hash);
    addedCount += 1;
  }

  const mergedBank = Array.from(nextById.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  return {
    mergedBank,
    toPersist,
    addedCount,
    updatedCount,
    skippedDuplicateCount,
    preservedTeacherEditedCount,
  };
}

/**
 * Phát hiện tài liệu trong Resource Vault đã thay đổi so với lần lập chỉ mục trước đó.
 */
export function detectResourceIndexStatus(
  resource: ResourceItem,
  bank: readonly BankQuestionRecord[]
): {
  indexedCount: number;
  status: 'not-indexed' | 'up-to-date' | 'stale';
  lastIndexedAt?: string;
} {
  const linked = bank.filter(
    (b) => b.sourceKind === 'resource-vault' && b.sourceProvenance?.resourceId === resource.id
  );
  if (linked.length === 0) {
    return { indexedCount: 0, status: 'not-indexed' };
  }
  const latest = linked.reduce((acc, cur) =>
    (cur.sourceProvenance?.indexedAt ?? '') > (acc.sourceProvenance?.indexedAt ?? '') ? cur : acc
  );
  const prov = latest.sourceProvenance;
  const shaChanged =
    Boolean(resource.sourceFile?.sha256) &&
    Boolean(prov?.sourceFileSha256) &&
    resource.sourceFile?.sha256 !== prov?.sourceFileSha256;
  const updatedChanged =
    Boolean(resource.updatedAt) &&
    Boolean(prov?.resourceUpdatedAt) &&
    resource.updatedAt > (prov?.resourceUpdatedAt ?? '');

  return {
    indexedCount: linked.length,
    status: shaChanged || updatedChanged ? 'stale' : 'up-to-date',
    lastIndexedAt: prov?.indexedAt,
  };
}
