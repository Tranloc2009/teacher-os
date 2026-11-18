import {
  ExamSubjectId,
  MathExamProject,
  MathQuestion,
  MathVisualAsset,
  QuestionGroup,
  UniversalQuestionType,
} from '../types/mathExam';
import {
  CompatibilityStatus,
  DocumentCompatibilityReport,
  OriginalSourceRecord,
  PdfPageExtractionRecord,
  UniversalDocumentBlock,
  UniversalDocumentModel,
  UniversalImportSession,
} from '../types/universalImport';
import { detectFileFormatAndSignature } from './fileTypeDetector';
import { computeContentHash, createMathVisualAsset } from './mathIntegrity';
import { extractDocxDocument } from './ooxmlParser';
import {
  extractPdfExamDocument,
  PdfExtractionProgress,
} from './pdfImportAdapter';
import {
  captureQuestionOriginalSnapshot,
  createImmutableContentPayload,
  getSubjectProfile,
  suggestSubjectProfileFromText,
} from './subjectProfileRegistry';
import {
  mergeImportedExamIntoProject,
  parseUniversalExamText,
  parseUniversalHtmlExam,
  UniversalImportResult,
} from './universalImportEngine';

function createEmptyTypeCounts(): Record<UniversalQuestionType, number> {
  return {
    mcq: 0,
    'multi-select': 0,
    'true-false': 0,
    'short-answer': 0,
    'fill-blank': 0,
    matching: 0,
    ordering: 0,
    'reading-comprehension': 0,
    essay: 0,
    'shared-context': 0,
  };
}

function countFormulasInQuestions(questions: MathQuestion[]): number {
  let count = 0;
  for (const q of questions) {
    const payloads = [
      q.stem,
      q.solutionGuide,
      ...(q.options ?? []).map((o) => o.content),
      ...(q.multiSelectOptions ?? []).map((o) => o.content),
      ...(q.statements ?? []).map((s) => s.content),
    ];
    for (const p of payloads) {
      if (!p) continue;
      count += p.blocks.filter(
        (b) => b.kind === 'latex' || b.kind === 'omml-raw' || b.kind === 'mathml'
      ).length;
    }
  }
  return count;
}

export function buildCompatibilityReport(params: {
  fileName: string;
  detectedFormat: UniversalImportSession['detection']['detectedFormat'];
  detectionStatus: CompatibilityStatus;
  detectionReason: string;
  supportTier: UniversalImportSession['detection']['supportTier'];
  questions: MathQuestion[];
  pages: PdfPageExtractionRecord[];
  assets: MathVisualAsset[];
  warnings: string[];
  technicalDetails: string[];
  ommlCount?: number;
  legacyOleCount?: number;
  unsupportedMediaCount?: number;
  suggestedSubjectOverride?: DocumentCompatibilityReport['suggestedSubject'];
}): DocumentCompatibilityReport {
  const countsByType = createEmptyTypeCounts();
  let validQuestions = 0;
  let reviewRequiredQuestions = 0;
  let blockedQuestions = 0;
  let formulaRiskCount = 0;

  for (const q of params.questions) {
    const uType = q.universalType ?? q.type;
    countsByType[uType] = (countsByType[uType] ?? 0) + 1;

    const sv = q.sourceVerification;
    if (!sv) {
      validQuestions += 1;
      continue;
    }

    formulaRiskCount += sv.formulaRiskFlags.length;
    if (sv.verifiedByTeacher || sv.verificationStatus === 'READY') {
      validQuestions += 1;
    } else if (sv.verificationStatus === 'REVIEW_REQUIRED') {
      reviewRequiredQuestions += 1;
    } else {
      blockedQuestions += 1;
    }
  }

  const scannedPages = params.pages.filter((p) => !p.hasTextLayer || p.isScannedLikely).length;
  const textLayerPages = params.pages.length - scannedPages;
  const pageRiskCount = params.pages.reduce((acc, p) => acc + p.riskRegions.length, 0);
  const formulaCount = countFormulasInQuestions(params.questions) + (params.ommlCount ?? 0);
  const imageCount =
    params.assets.length +
    params.questions.reduce((acc, q) => acc + (q.visualAssets?.length ?? 0), 0);
  const unsupportedObjectCount =
    (params.legacyOleCount ?? 0) +
    (params.unsupportedMediaCount ?? 0) +
    scannedPages;

  const combinedText = params.questions
    .map((q) => `${q.stem.rawSource} ${(q.options ?? []).map((o) => o.content.rawSource).join(' ')}`)
    .join('\n');
  const suggestedSubject =
    params.suggestedSubjectOverride ?? suggestSubjectProfileFromText(combinedText);

  let status: CompatibilityStatus = 'READY';
  const recommendations: string[] = [];

  if (params.detectionStatus === 'BLOCKED') {
    status = 'BLOCKED';
    recommendations.push(params.detectionReason);
  } else if (params.supportTier === 'deferred') {
    status = 'UNSUPPORTED';
    recommendations.push(params.detectionReason);
  } else if (
    params.detectedFormat === 'pdf' &&
    params.pages.length > 0 &&
    textLayerPages === 0
  ) {
    status = 'UNSUPPORTED';
    recommendations.push(
      'Tệp PDF chỉ gồm ảnh scan, chưa có lớp văn bản để đọc tự động trong Giai đoạn 1. Hãy dùng PDF xuất từ Word/LaTeX có thể bôi đen chữ, hoặc chuyển sang .docx.'
    );
  } else if (params.questions.length === 0) {
    status = 'BLOCKED';
    recommendations.push(
      'Không nhận diện được câu hỏi chuẩn ("Câu 1: ... A. ... B. ..."). Kiểm tra lại cấu trúc văn bản hoặc dùng tính năng tách/nhập thủ công.'
    );
  } else if (blockedQuestions > 0) {
    status = 'BLOCKED';
    recommendations.push(
      `Có ${blockedQuestions} câu bị lỗi ký tự vùng riêng (PUA/) hoặc vùng ảnh scan — bắt buộc đối chiếu trang PDF gốc và sửa/xác nhận trước khi trộn.`
    );
  } else if (reviewRequiredQuestions > 0 || unsupportedObjectCount > 0) {
    status = 'REVIEW_REQUIRED';
    recommendations.push(
      `Có ${reviewRequiredQuestions} câu có công thức/chỉ số/bố cục đa trang từ PDF cần giáo viên đối chiếu trực tiếp với trang gốc rồi bấm "Xác nhận".`
    );
  } else {
    status = 'READY';
    recommendations.push(
      'Toàn bộ câu hỏi và ký hiệu đã đạt trạng thái sẵn sàng để đưa vào đề và trộn mã đề.'
    );
  }

  return {
    status,
    detectedFormat: params.detectedFormat,
    fileName: params.fileName,
    totalPages: params.pages.length || 1,
    textLayerPages: params.pages.length ? textLayerPages : 1,
    scannedPages,
    totalDetectedQuestions: params.questions.length,
    validQuestions,
    reviewRequiredQuestions,
    blockedQuestions,
    formulaCount,
    formulaRiskCount: Math.max(formulaRiskCount, pageRiskCount),
    imageCount,
    unsupportedObjectCount,
    safeToMixCount: validQuestions,
    blockedCount: reviewRequiredQuestions + blockedQuestions,
    countsByType,
    suggestedSubject,
    warnings: Array.from(new Set(params.warnings)),
    technicalDetails: params.technicalDetails,
    recommendations,
  };
}

function buildDocumentBlocksFromQuestions(
  questions: MathQuestion[],
  pages: PdfPageExtractionRecord[]
): UniversalDocumentBlock[] {
  const blocks: UniversalDocumentBlock[] = questions.map((q, idx) => {
    const sv = q.sourceVerification;
    const verificationStatus: CompatibilityStatus = !sv
      ? 'READY'
      : sv.verifiedByTeacher
      ? 'READY'
      : sv.verificationStatus;

    return {
      id: sv?.sourceBlockId ?? `blk-${q.id}`,
      kind: 'question',
      orderIndex: idx,
      sourceLocation: {
        pageNumber: sv?.pageNumber,
        pageSpan: sv?.pageSpan,
        columnIndex: sv?.columnIndex,
        bbox: sv?.bbox,
      },
      immutableSourceText: sv?.extractedRawText ?? q.stem.rawSource,
      relatedAssetIds: (q.visualAssets ?? []).map((a) => a.id),
      checksum: computeContentHash(q.stem.rawSource),
      recognitionStatus:
        verificationStatus === 'BLOCKED' ? 'partial' : 'parsed',
      verificationStatus,
      mixable: verificationStatus === 'READY',
      exportable: verificationStatus === 'READY',
      mathProtectionFlags: sv?.formulaRiskFlags ?? [],
      questionId: q.id,
    };
  });

  pages
    .filter((p) => !p.hasTextLayer || p.isScannedLikely)
    .forEach((p, idx) => {
      blocks.push({
        id: `blk-scan-page-${p.pageNumber}`,
        kind: 'image-region',
        orderIndex: questions.length + idx,
        sourceLocation: {
          pageNumber: p.pageNumber,
          bbox: { x: 0.04, y: 0.04, width: 0.92, height: 0.92 },
        },
        immutableSourceText: '',
        relatedAssetIds: [],
        checksum: computeContentHash(`scan-p${p.pageNumber}`),
        recognitionStatus: 'scanned',
        verificationStatus: 'UNSUPPORTED',
        mixable: false,
        exportable: false,
        mathProtectionFlags: [
          `Trang ${p.pageNumber} là ảnh scan không có lớp văn bản.`,
        ],
      });
    });

  return blocks;
}

export function recomputeImportSession(
  session: UniversalImportSession,
  extraWarnings?: string[]
): UniversalImportSession {
  const blocks = buildDocumentBlocksFromQuestions(
    session.questions,
    session.documentModel.pages
  );
  const warnings = Array.from(
    new Set([...session.documentModel.warnings, ...(extraWarnings ?? [])])
  );
  const compatibilityReport = buildCompatibilityReport({
    fileName: session.originalSource.fileName,
    detectedFormat: session.detection.detectedFormat,
    detectionStatus: session.detection.status,
    detectionReason: session.detection.reason,
    supportTier: session.detection.supportTier,
    questions: session.questions,
    pages: session.documentModel.pages,
    assets: session.documentModel.assets,
    warnings,
    technicalDetails: session.compatibilityReport.technicalDetails,
    suggestedSubjectOverride: session.compatibilityReport.suggestedSubject,
  });

  return {
    ...session,
    documentModel: {
      ...session.documentModel,
      blocks,
      warnings,
    },
    compatibilityReport,
    canCommitToProject: session.questions.length > 0,
  };
}

/**
 * Pipeline chuẩn hóa Exam Mixer Pro 7.0:
 * File Type Detector -> Format Adapter -> Layer 1 (OriginalSourceRecord) + Layer 2 (UniversalDocumentModel) -> Compatibility Report.
 */
export async function runUniversalImportSession(
  input: {
    fileName: string;
    mimeType?: string;
    buffer?: ArrayBuffer | Uint8Array;
    textContent?: string;
  },
  createIdFn: (prefix: string) => string,
  options?: {
    subjectId?: ExamSubjectId;
    workerSrc?: string;
    renderPreviews?: boolean;
    onProgress?: (progress: PdfExtractionProgress) => void;
    signal?: AbortSignal;
  }
): Promise<UniversalImportSession> {
  const bytes =
    input.buffer instanceof Uint8Array
      ? input.buffer
      : input.buffer instanceof ArrayBuffer
      ? new Uint8Array(input.buffer)
      : undefined;

  const detection = await detectFileFormatAndSignature({
    fileName: input.fileName,
    mimeType: input.mimeType,
    buffer: bytes,
    textContent: input.textContent,
  });

  const sessionId = createIdFn('impsess');
  const sourceId = createIdFn('src');
  const importedAt = new Date().toISOString();

  const originalSource: OriginalSourceRecord = {
    sourceId,
    fileName: input.fileName,
    mimeType: input.mimeType || detection.declaredMimeType || 'application/octet-stream',
    detectedFormat: detection.detectedFormat,
    sizeBytes: detection.sizeBytes,
    contentHash: detection.contentHash,
    signatureValid: detection.signatureValid,
    importedAt,
    rawBytes: bytes,
    rawText: input.textContent,
  };

  // Early return for blocked / spoofed / deferred formats (never silently guess!)
  if (detection.status === 'BLOCKED' || detection.supportTier === 'deferred') {
    const compat = buildCompatibilityReport({
      fileName: input.fileName,
      detectedFormat: detection.detectedFormat,
      detectionStatus: detection.status,
      detectionReason: detection.reason,
      supportTier: detection.supportTier,
      questions: [],
      pages: [],
      assets: [],
      warnings: [detection.reason, ...detection.securityWarnings],
      technicalDetails: [
        `Magic signature: ${detection.magicSignature}`,
        `Kích thước: ${detection.sizeBytes} bytes`,
        `Hash nguồn: ${detection.contentHash}`,
      ],
    });
    return {
      sessionId,
      detection,
      originalSource,
      documentModel: {
        modelId: createIdFn('mdl'),
        sourceId,
        sourceFormat: detection.detectedFormat,
        blocks: [],
        pages: [],
        assets: [],
        warnings: compat.warnings,
      },
      compatibilityReport: compat,
      questions: [],
      questionGroups: [],
      canCommitToProject: false,
    };
  }

  // 1. PDF Text-Layer Adapter
  if (detection.detectedFormat === 'pdf') {
    if (!bytes) {
      throw new Error('Thiếu dữ liệu nhị phân của tệp PDF.');
    }
    const pdfRes = await extractPdfExamDocument(bytes, createIdFn, {
      fileName: input.fileName,
      subjectId: options?.subjectId,
      workerSrc: options?.workerSrc,
      renderPreviews: options?.renderPreviews,
      onProgress: options?.onProgress,
      signal: options?.signal,
    });

    const blocks = buildDocumentBlocksFromQuestions(
      pdfRes.parsed.questions,
      pdfRes.pages
    );
    const compat = buildCompatibilityReport({
      fileName: input.fileName,
      detectedFormat: 'pdf',
      detectionStatus: detection.status,
      detectionReason: detection.reason,
      supportTier: detection.supportTier,
      questions: pdfRes.parsed.questions,
      pages: pdfRes.pages,
      assets: [],
      warnings: pdfRes.warnings,
      technicalDetails: [
        `Magic signature: ${detection.magicSignature}`,
        ...pdfRes.technicalDetails,
      ],
      suggestedSubjectOverride: pdfRes.parsed.report.suggestedSubject,
    });

    return {
      sessionId,
      detection,
      originalSource,
      documentModel: {
        modelId: createIdFn('mdl'),
        sourceId,
        sourceFormat: 'pdf',
        blocks,
        pages: pdfRes.pages,
        assets: [],
        warnings: pdfRes.warnings,
      },
      compatibilityReport: compat,
      questions: pdfRes.parsed.questions,
      questionGroups: pdfRes.parsed.questionGroups,
      canCommitToProject: pdfRes.parsed.questions.length > 0,
    };
  }

  // 2. DOCX OOXML Adapter
  if (detection.detectedFormat === 'docx') {
    if (!bytes) {
      throw new Error('Thiếu dữ liệu nhị phân của tệp .docx.');
    }
    const extracted = await extractDocxDocument(bytes);
    const parsed = parseUniversalExamText(extracted.plainTextWithMarkers, createIdFn, {
      subjectId: options?.subjectId,
      sourceFormat: 'docx',
      fileName: input.fileName,
      assets: extracted.assets,
      ommlFragments: extracted.ommlFragments,
      legacyOleCount: extracted.legacyOleCount,
      unsupportedMediaCount: extracted.unsupportedMediaCount,
      preWarnings: extracted.warnings,
    });

    const blocks = buildDocumentBlocksFromQuestions(parsed.questions, []);
    const compat = buildCompatibilityReport({
      fileName: input.fileName,
      detectedFormat: 'docx',
      detectionStatus: detection.status,
      detectionReason: detection.reason,
      supportTier: detection.supportTier,
      questions: parsed.questions,
      pages: [],
      assets: extracted.assets,
      warnings: parsed.report.warnings,
      technicalDetails: [
        `OOXML Word: ${extracted.ommlFragments.length} OMML · ${extracted.assets.length} ảnh/bảng · ${extracted.legacyOleCount ?? 0} MathType OLE cũ`,
      ],
      ommlCount: extracted.ommlFragments.length,
      legacyOleCount: extracted.legacyOleCount,
      unsupportedMediaCount: extracted.unsupportedMediaCount,
      suggestedSubjectOverride: parsed.report.suggestedSubject,
    });

    return {
      sessionId,
      detection,
      originalSource,
      documentModel: {
        modelId: createIdFn('mdl'),
        sourceId,
        sourceFormat: 'docx',
        blocks,
        pages: [],
        assets: extracted.assets,
        warnings: parsed.report.warnings,
      },
      compatibilityReport: compat,
      questions: parsed.questions,
      questionGroups: parsed.questionGroups,
      canCommitToProject: parsed.questions.length > 0,
    };
  }

  // 3. HTML / Text / Markdown Adapter
  const rawText =
    input.textContent ??
    (bytes ? new TextDecoder('utf-8', { fatal: false }).decode(bytes) : '');
  const parsed =
    detection.detectedFormat === 'html'
      ? parseUniversalHtmlExam(rawText, createIdFn, {
          subjectId: options?.subjectId,
          fileName: input.fileName,
        })
      : parseUniversalExamText(rawText, createIdFn, {
          subjectId: options?.subjectId,
          sourceFormat: 'text',
          fileName: input.fileName,
        });

  const blocks = buildDocumentBlocksFromQuestions(parsed.questions, []);
  const compat = buildCompatibilityReport({
    fileName: input.fileName,
    detectedFormat: detection.detectedFormat,
    detectionStatus: detection.status,
    detectionReason: detection.reason,
    supportTier: detection.supportTier,
    questions: parsed.questions,
    pages: [],
    assets: [],
    warnings: parsed.report.warnings,
    technicalDetails: [`Định dạng văn bản: ${detection.magicSignature}`],
    suggestedSubjectOverride: parsed.report.suggestedSubject,
  });

  return {
    sessionId,
    detection,
    originalSource: {
      ...originalSource,
      rawText,
    },
    documentModel: {
      modelId: createIdFn('mdl'),
      sourceId,
      sourceFormat: detection.detectedFormat,
      blocks,
      pages: [],
      assets: [],
      warnings: parsed.report.warnings,
    },
    compatibilityReport: compat,
    questions: parsed.questions,
    questionGroups: parsed.questionGroups,
    canCommitToProject: parsed.questions.length > 0,
  };
}

export function toggleConfirmImportedQuestion(
  session: UniversalImportSession,
  questionId: string,
  verified: boolean
): UniversalImportSession {
  const now = new Date().toISOString();
  const nextQuestions = session.questions.map((q) => {
    if (q.id !== questionId || !q.sourceVerification) return q;
    return {
      ...q,
      sourceVerification: {
        ...q.sourceVerification,
        verifiedByTeacher: verified,
        verifiedAt: verified ? now : undefined,
      },
      updatedAt: now,
    };
  });
  return recomputeImportSession({ ...session, questions: nextQuestions });
}

export function confirmAllReviewableQuestions(
  session: UniversalImportSession
): UniversalImportSession {
  const now = new Date().toISOString();
  const nextQuestions = session.questions.map((q) => {
    if (!q.sourceVerification) return q;
    // Chỉ xác nhận hàng loạt các câu REVIEW_REQUIRED (câu BLOCKED PUA/scan phải kiểm tra và sửa từng câu)
    if (q.sourceVerification.verificationStatus === 'BLOCKED' || q.sourceVerification.verificationStatus === 'UNSUPPORTED') {
      return q;
    }
    return {
      ...q,
      sourceVerification: {
        ...q.sourceVerification,
        verifiedByTeacher: true,
        verifiedAt: now,
      },
      updatedAt: now,
    };
  });
  return recomputeImportSession({ ...session, questions: nextQuestions });
}

export function updateImportedQuestion(
  session: UniversalImportSession,
  questionId: string,
  updater: (prev: MathQuestion) => MathQuestion
): UniversalImportSession {
  const nextQuestions = session.questions.map((q) => {
    if (q.id !== questionId) return q;
    const updated = updater(q);
    updated.originalSnapshot = captureQuestionOriginalSnapshot(updated);
    return updated;
  });
  return recomputeImportSession({ ...session, questions: nextQuestions });
}

export function attachVisualAssetToImportedQuestion(
  session: UniversalImportSession,
  questionId: string,
  params: {
    id: string;
    label: string;
    sourceData: string;
    sourceLocation?: string;
  }
): UniversalImportSession {
  const asset = createMathVisualAsset({
    id: params.id,
    kind: 'image',
    label: params.label,
    sourceData: params.sourceData,
    sourceLocation: params.sourceLocation,
  });
  return updateImportedQuestion(session, questionId, (q) => ({
    ...q,
    visualAssets: [...(q.visualAssets ?? []), asset],
    hasVisualAsset: true,
    updatedAt: new Date().toISOString(),
  }));
}

export function mergeImportedQuestionWithPrevious(
  session: UniversalImportSession,
  questionId: string
): UniversalImportSession {
  const idx = session.questions.findIndex((q) => q.id === questionId);
  if (idx <= 0) return session;

  const prev = session.questions[idx - 1];
  const curr = session.questions[idx];
  const mergedStemText = `${prev.stem.rawSource}\n${curr.stem.rawSource}`.trim();
  const mergedPages = Array.from(
    new Set([
      ...(prev.sourceVerification?.pageSpan ?? (prev.sourceVerification?.pageNumber ? [prev.sourceVerification.pageNumber] : [])),
      ...(curr.sourceVerification?.pageSpan ?? (curr.sourceVerification?.pageNumber ? [curr.sourceVerification.pageNumber] : [])),
    ])
  ).sort((a, b) => a - b);

  const mergedPrev: MathQuestion = {
    ...prev,
    stem: createImmutableContentPayload(mergedStemText, `${prev.id}-stem`),
    visualAssets: [...(prev.visualAssets ?? []), ...(curr.visualAssets ?? [])],
    hasVisualAsset:
      Boolean(prev.hasVisualAsset || curr.hasVisualAsset) ||
      (prev.visualAssets?.length ?? 0) + (curr.visualAssets?.length ?? 0) > 0,
    ...(curr.options && curr.options.length === 4 && (!prev.options || prev.options.length < 4)
      ? { options: curr.options, correctOptionId: curr.correctOptionId }
      : {}),
    sourceVerification: prev.sourceVerification
      ? {
          ...prev.sourceVerification,
          pageSpan: mergedPages.length > 0 ? mergedPages : prev.sourceVerification.pageSpan,
          verifiedByTeacher: false,
          verificationStatus:
            prev.sourceVerification.verificationStatus === 'BLOCKED' ||
            curr.sourceVerification?.verificationStatus === 'BLOCKED'
              ? 'BLOCKED'
              : 'REVIEW_REQUIRED',
          formulaRiskFlags: Array.from(
            new Set([
              ...prev.sourceVerification.formulaRiskFlags,
              ...(curr.sourceVerification?.formulaRiskFlags ?? []),
            ])
          ),
        }
      : undefined,
    updatedAt: new Date().toISOString(),
  };

  const nextQuestions = [
    ...session.questions.slice(0, idx - 1),
    mergedPrev,
    ...session.questions.slice(idx + 1),
  ];
  const nextGroups = session.questionGroups.map((g) => ({
    ...g,
    questionIds: g.questionIds.filter((id) => id !== curr.id),
  }));

  return recomputeImportSession({
    ...session,
    questions: nextQuestions,
    questionGroups: nextGroups,
  });
}

export function splitImportedQuestionAtBreak(
  session: UniversalImportSession,
  questionId: string,
  createIdFn: (prefix: string) => string
): UniversalImportSession {
  const idx = session.questions.findIndex((q) => q.id === questionId);
  if (idx === -1) return session;
  const target = session.questions[idx];
  const lines = target.stem.rawSource.split(/\r?\n/);
  if (lines.length < 2) return session;

  const mid = Math.ceil(lines.length / 2);
  const firstStem = lines.slice(0, mid).join('\n').trim();
  const secondStem = lines.slice(mid).join('\n').trim();
  if (!firstStem || !secondStem) return session;

  const firstUpdated: MathQuestion = {
    ...target,
    stem: createImmutableContentPayload(firstStem, `${target.id}-stem`),
    updatedAt: new Date().toISOString(),
  };

  const newId = createIdFn('mq');
  const secondCreated: MathQuestion = {
    ...target,
    id: newId,
    code: `${target.code}-B`,
    stem: createImmutableContentPayload(secondStem, `${newId}-stem`),
    visualAssets: [],
    hasVisualAsset: false,
    answerConfirmed: false,
    sourceVerification: target.sourceVerification
      ? {
          ...target.sourceVerification,
          sourceBlockId: `blk-${newId}`,
          verificationStatus: 'REVIEW_REQUIRED',
          verifiedByTeacher: false,
          reasons: [
            ...target.sourceVerification.reasons,
            'Câu được tách thủ công từ khối PDF — cần kiểm tra lại đáp án.',
          ],
        }
      : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const nextQuestions = [
    ...session.questions.slice(0, idx),
    firstUpdated,
    secondCreated,
    ...session.questions.slice(idx + 1),
  ];

  return recomputeImportSession({
    ...session,
    questions: nextQuestions,
  });
}

export function renumberImportedQuestions(
  session: UniversalImportSession,
  startNumber = 1
): UniversalImportSession {
  const prefix =
    session.detection.detectedFormat === 'pdf'
      ? 'PDF'
      : session.detection.detectedFormat === 'docx'
      ? 'DOCX'
      : 'IMP';
  const nextQuestions = session.questions.map((q, idx) => {
    const num = startNumber + idx;
    const padded = String(num).padStart(2, '0');
    return {
      ...q,
      code: `${prefix}-${padded}`,
    };
  });
  return recomputeImportSession({ ...session, questions: nextQuestions });
}

export function commitUniversalImportSessionToProject(
  exam: MathExamProject,
  session: UniversalImportSession,
  options?: { applySuggestedSubject?: boolean; replaceExisting?: boolean }
): MathExamProject {
  const legacyResult: UniversalImportResult = {
    questions: session.questions,
    questionGroups: session.questionGroups,
    report: {
      sourceFormat:
        session.detection.detectedFormat === 'docx'
          ? 'docx'
          : session.detection.detectedFormat === 'html'
          ? 'html'
          : 'text',
      fileName: session.originalSource.fileName,
      suggestedSubject: session.compatibilityReport.suggestedSubject,
      totalParsed: session.questions.length,
      countsByType: session.compatibilityReport.countsByType,
      groupsCreated: session.questionGroups.length,
      assetsAttached: session.compatibilityReport.imageCount,
      ommlCount: 0,
      confirmedAnswerCount: session.questions.filter((q) => q.answerConfirmed).length,
      unconfirmedAnswerCount: session.questions.filter((q) => !q.answerConfirmed).length,
      warnings: session.compatibilityReport.warnings,
      unparsedSegments: [],
      canImport: session.questions.length > 0,
    },
  };

  const merged = mergeImportedExamIntoProject(exam, legacyResult, options);
  return {
    ...merged,
    sourceRecord: {
      sourceId: session.originalSource.sourceId,
      fileName: session.originalSource.fileName,
      detectedFormat: session.originalSource.detectedFormat,
      sizeBytes: session.originalSource.sizeBytes,
      contentHash: session.originalSource.contentHash,
      importedAt: session.originalSource.importedAt,
    },
  };
}
