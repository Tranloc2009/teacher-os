import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileSpreadsheet,
  Layers,
  Plus,
  QrCode,
  ScanLine,
  Users,
} from 'lucide-react';
import type { MathExamProject } from '../../types/mathExam';
import {
  DEFAULT_GRADING_RULE,
  DEFAULT_OMR_THRESHOLDS,
  type BatchQueueItem,
  type DuplicateGroup,
  type DuplicateResolutionAction,
  type GradedSheetRecord,
  type GradingRuleConfig,
  type GradingSession,
  type OmrBubbleChoice,
  type OmrThresholdsConfig,
  type StudentRecord,
} from '../../types/grading';
import {
  buildExamAnswerKeyMap,
  listGradableExams,
} from '../../core/grading/examMixerBridge';
import { checkExamExportGate } from '../../core/mathIntegrity';
import { findExistingGradingSession } from '../../core/connectedWorkflowEngine';
import { generateMixedExams } from '../../core/mathShuffleEngine';
import {
  annotateDuplicateStudentWarnings,
  gradeRecognizedSheet,
  overrideSheetQuestion,
  recalculateSheetRecord,
} from '../../core/grading/gradingEngine';
import {
  decodeImageBlobForOmr,
  renderAnnotatedEvidencePngBlob,
} from '../../core/grading/omrBrowserBridge';
import { runOmrVisionInWorkerOrFallback } from '../../core/grading/omrWorkerClient';
import {
  confirmOrOverrideGradebookEntry,
  reconcileIntelligentGradebook,
  undoLastOfficialGradeChange,
} from '../../core/grading/gradebookReconciliationEngine';
import {
  applyDuplicateResolution,
  detectDuplicateGroups,
} from '../../core/grading/duplicateDetection';
import {
  cancelWaitingQueueItems,
  enqueueBatchItem,
  evaluateStorageQuota,
  markQueueItemCompleted,
  markQueueItemFailed,
  markQueueItemProcessing,
  retryFailedQueueItem,
  summarizeBatchQueue,
} from '../../core/grading/batchQueueEngine';
import {
  createId,
  deleteGradingSession,
  deleteSheetEvidenceBlobs,
  getEvidenceBlob,
  listGradingSessions,
  saveEvidenceBlob,
  saveGradingSession,
} from '../../db/database';
import { GradingDashboardPanel } from '../grading/GradingDashboardPanel';
import { StudentRosterPanel } from '../grading/StudentRosterPanel';
import { AnswerSheetGeneratorPanel } from '../grading/AnswerSheetGeneratorPanel';
import { OmrBatchUploadPanel } from '../grading/OmrBatchUploadPanel';
import { ManualReviewPanel } from '../grading/ManualReviewPanel';
import { GradebookReconciliationPanel } from '../grading/GradebookReconciliationPanel';
import { GradingExportPanel } from '../grading/GradingExportPanel';
import { MobileCameraScannerModal } from '../grading/MobileCameraScannerModal';
import { DuplicateResolutionModal } from '../grading/DuplicateResolutionModal';
import { AzotaIntegrationPanel } from '../grading/AzotaIntegrationPanel';

export type GradingTabId =
  | 'dashboard'
  | 'roster'
  | 'sheet-gen'
  | 'upload'
  | 'review'
  | 'gradebook'
  | 'export'
  | 'azota';

interface SmartGradingStudioAppProps {
  mathExams: MathExamProject[];
  preferredExamId?: string | null;
  preferredSessionId?: string | null;
  preferredClassName?: string | null;
  preferredTab?: GradingTabId | null;
  onOpenExamMixer: (examId?: string) => void;
  onSaveMathExam?: (exam: MathExamProject) => Promise<unknown> | void;
  onSessionsChanged?: (sessions: GradingSession[]) => void;
  onNotify: (tone: 'success' | 'info' | 'error', message: string) => void;
}

export function SmartGradingStudioApp({
  mathExams,
  preferredExamId,
  preferredSessionId,
  preferredClassName,
  preferredTab,
  onOpenExamMixer,
  onSaveMathExam,
  onSessionsChanged,
  onNotify,
}: SmartGradingStudioAppProps) {
  const [sessions, setSessions] = useState<GradingSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<GradingTabId>('dashboard');
  const creatingSessionRef = useRef(false);
  const [preferredExamAlert, setPreferredExamAlert] = useState<{
    kind: 'missing' | 'blocked';
    title: string;
    detail: string;
    examId?: string;
  } | null>(null);
  const [selectedReviewSheetId, setSelectedReviewSheetId] = useState<string | null>(
    null
  );
  const [loadingSessions, setLoadingSessions] = useState(true);

  // State cho form tạo phiên chấm mới
  const [creatingNew, setCreatingNew] = useState(false);
  const [draftExamId, setDraftExamId] = useState<string>('');
  const [draftClassName, setDraftClassName] = useState<string>('12A1');
  const [draftTitle, setDraftTitle] = useState<string>('');
  const [draftSelectedCodes, setDraftSelectedCodes] = useState<string[]>([]);

  // Phase 3: Mobile Camera Scanner, Non-blocking Batch Queue & Duplicate Resolver
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [reviewOnlyFlagged, setReviewOnlyFlagged] = useState(false);
  const [cameraFallbackExamCode, setCameraFallbackExamCode] = useState<string>('');
  const [retakeTargetSheet, setRetakeTargetSheet] = useState<GradedSheetRecord | null>(null);
  const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>([]);
  const [lowStorageWarning, setLowStorageWarning] = useState<string | undefined>(undefined);
  const queueFilesRef = useRef<Map<string, File>>(new Map());
  const queueProcessingRef = useRef(false);
  const activeSessionRef = useRef<GradingSession | null>(null);
  const answerKeysRef = useRef<Record<string, ReturnType<typeof buildExamAnswerKeyMap>[string]>>({});

  const gradableExams = useMemo(() => listGradableExams(mathExams), [mathExams]);

  // Nạp các phiên chấm đã lưu trong IndexedDB
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const stored = await listGradingSessions();
        if (!active) return;
        setSessions(stored);
        if (stored.length > 0) {
          setActiveSessionId(stored[0].id);
        } else if (preferredTab !== 'azota') {
          setCreatingNew(true);
        }
      } catch (err) {
        if (active) {
          onNotify(
            'error',
            err instanceof Error
              ? err.message
              : 'Không thể tải danh sách phiên chấm từ IndexedDB.'
          );
        }
      } finally {
        if (active) setLoadingSessions(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [onNotify]);

  // Đồng bộ đề gợi ý, tên lớp & tab mục tiêu khi mở từ Exam Mixer Pro / Print Studio / Command Bar
  useEffect(() => {
    if (preferredClassName && preferredClassName.trim()) {
      setDraftClassName(preferredClassName.trim());
    }
  }, [preferredClassName]);

  useEffect(() => {
    if (preferredTab) {
      setActiveTab(preferredTab);
      if (preferredTab === 'azota') {
        setCreatingNew(false);
      }
    }
  }, [preferredTab]);

  useEffect(() => {
    onSessionsChanged?.(sessions);
  }, [sessions, onSessionsChanged]);

  useEffect(() => {
    if (preferredSessionId) {
      const exactSession = sessions.find((s) => s.id === preferredSessionId);
      if (exactSession) {
        setActiveSessionId(exactSession.id);
        setCreatingNew(false);
      }
    }
  }, [preferredSessionId, sessions]);

  useEffect(() => {
    if (preferredExamId) {
      const targetExam = mathExams.find((e) => e.id === preferredExamId);
      if (!targetExam) {
        setPreferredExamAlert({
          kind: 'missing',
          title: `Không tìm thấy đề kiểm tra (ID: ${preferredExamId})`,
          detail:
            'Đề kiểm tra gắn với quy trình này không còn tồn tại. Hệ thống không tự mở nhầm đề khác để bảo vệ tính chính xác đáp án OMR.',
        });
        return;
      }

      const exportGate = checkExamExportGate(targetExam);
      const isGradable = gradableExams.some((e) => e.id === targetExam.id);
      if (!isGradable || !exportGate.canExport) {
        setPreferredExamAlert({
          kind: 'blocked',
          title: `Chặn chấm OMR cho "${targetExam.title}" do chưa đạt kiểm chứng toàn vẹn`,
          detail:
            exportGate.blockingReasons[0] ??
            'Đề chưa có mã đề hợp lệ hoặc chưa xác nhận đủ đáp án gốc. Vui lòng hoàn tất trong Exam Mixer Pro trước khi chấm OMR.',
          examId: targetExam.id,
        });
        return;
      }

      setPreferredExamAlert(null);
      setDraftExamId(preferredExamId);
      const existing = sessions.find((s) => s.examId === preferredExamId);
      if (existing) {
        setActiveSessionId(existing.id);
        setCreatingNew(false);
      } else if (preferredTab !== 'azota') {
        setCreatingNew(true);
      }
    } else {
      setPreferredExamAlert(null);
      if (!draftExamId && gradableExams.length > 0) {
        setDraftExamId(gradableExams[0].id);
      }
    }
  }, [draftExamId, gradableExams, mathExams, preferredExamId, preferredTab, sessions]);

  const draftExam = useMemo(
    () => gradableExams.find((e) => e.id === draftExamId) ?? gradableExams[0],
    [draftExamId, gradableExams]
  );

  // Tự chọn tất cả mã đề hợp lệ của draftExam khi đổi đề trong form tạo phiên
  useEffect(() => {
    if (!draftExam) {
      setDraftSelectedCodes([]);
      return;
    }
    const keys = buildExamAnswerKeyMap(draftExam);
    const validCodes = Object.values(keys)
      .filter((k) => k.valid)
      .map((k) => k.examCode);
    setDraftSelectedCodes(
      validCodes.length > 0
        ? validCodes
        : draftExam.generatedVersions.map((v) => v.code)
    );
    setDraftTitle(`Chấm ${draftExam.title}`);
  }, [draftExam?.id]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  const linkedExam = useMemo(
    () =>
      activeSession
        ? mathExams.find((e) => e.id === activeSession.examId) ?? null
        : null,
    [activeSession, mathExams]
  );

  const answerKeysByCode = useMemo(() => {
    if (!activeSession || !linkedExam) return {};
    return buildExamAnswerKeyMap(linkedExam, activeSession.selectedExamCodes);
  }, [activeSession, linkedExam]);

  activeSessionRef.current = activeSession;
  answerKeysRef.current = answerKeysByCode;

  useEffect(() => {
    if (activeSession && !cameraFallbackExamCode && activeSession.selectedExamCodes[0]) {
      setCameraFallbackExamCode(activeSession.selectedExamCodes[0]);
    }
  }, [activeSession?.id, activeSession?.selectedExamCodes, cameraFallbackExamCode]);

  const checkStorageQuota = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
    try {
      const est = await navigator.storage.estimate();
      if (est.usage !== undefined && est.quota !== undefined) {
        const evalRes = evaluateStorageQuota(est.usage, est.quota);
        setLowStorageWarning(evalRes.warning);
      }
    } catch {
      // Ignore storage estimate errors on restricted browsers
    }
  }, []);

  useEffect(() => {
    void checkStorageQuota();
  }, [checkStorageQuota, activeSession?.sheets.length]);

  const duplicateGroups = useMemo(
    () => (activeSession ? detectDuplicateGroups(activeSession.sheets) : []),
    [activeSession]
  );

  const queueSummary = useMemo(() => summarizeBatchQueue(batchQueue), [batchQueue]);

  // Background sequential worker over batchQueue — keeps UI responsive during continuous mobile capture
  useEffect(() => {
    if (queueProcessingRef.current) return;
    const nextItem = batchQueue.find((q) => q.status === 'waiting');
    if (!nextItem) return;

    const currentSess = activeSessionRef.current;
    if (!currentSess) return;

    const file = queueFilesRef.current.get(nextItem.id);
    if (!file) {
      setBatchQueue((prev) =>
        markQueueItemFailed(prev, nextItem.id, 'Không còn tệp tạm trong bộ nhớ.')
      );
      return;
    }

    queueProcessingRef.current = true;
    setBatchQueue((prev) => markQueueItemProcessing(prev, nextItem.id));

    void (async () => {
      try {
        // Nhường main thread 16ms để preview camera và nút chụp luôn mượt
        await new Promise((r) => window.setTimeout(r, 16));

        const sessNow = activeSessionRef.current;
        if (!sessNow) throw new Error('Không tìm thấy phiên chấm đang mở.');

        const sheetId = createId('sheet');
        const origBlobId = createId('ev-orig');
        const annotBlobId = createId('ev-annot');

        // Lưu ảnh gốc vào IndexedDB ngay lập tức (không giữ toàn bộ ảnh lớn trong React state)
        await saveEvidenceBlob({
          id: origBlobId,
          sessionId: sessNow.id,
          sheetId,
          kind: 'original',
          mimeType: file.type || 'image/jpeg',
          byteSize: file.size,
          blob: file,
          updatedAt: new Date().toISOString(),
        });

        const decoded = await decodeImageBlobForOmr(file);

        // Chạy CHÍNH XÁC OMR Vision Engine & dHash của Giai đoạn 1 trên Web Worker (fallback main thread nếu cần)
        const { recognition, imageDHash } = await runOmrVisionInWorkerOrFallback(
          decoded.rgba,
          sessNow.omrQuestionCount,
          sessNow.omrThresholds
        );

        const graded = gradeRecognizedSheet({
          sheetId,
          sessionId: sessNow.id,
          fileName: file.name,
          originalBlobId: origBlobId,
          thumbnailDataUrl: decoded.thumbnailDataUrl,
          recognition,
          answerKeysByCode: answerKeysRef.current,
          students: sessNow.students,
          gradingRule: sessNow.gradingRule,
          fallbackExamCode: cameraFallbackExamCode || undefined,
        });
        graded.imageDHash = imageDHash;
        graded.captureSource = nextItem.captureSource;

        try {
          const annotatedBlob = await renderAnnotatedEvidencePngBlob(
            file,
            graded,
            sessNow.omrQuestionCount
          );
          await saveEvidenceBlob({
            id: annotBlobId,
            sessionId: sessNow.id,
            sheetId,
            kind: 'annotated',
            mimeType: 'image/png',
            byteSize: annotatedBlob.size,
            blob: annotatedBlob,
            updatedAt: new Date().toISOString(),
          });
          graded.annotatedBlobId = annotBlobId;
        } catch {
          // Không chặn kết quả chấm nếu chỉ vẽ overlay lỗi
        }

        // Giải phóng File khỏi bộ nhớ RAM sau khi đã lưu IndexedDB thành công
        queueFilesRef.current.delete(nextItem.id);

        setSessions((prev) =>
          prev.map((sess) => {
            if (sess.id !== sessNow.id) return sess;
            const merged = annotateDuplicateStudentWarnings([...sess.sheets, graded]);
            const updatedBase: GradingSession = {
              ...sess,
              sheets: merged,
              updatedAt: new Date().toISOString(),
            };
            const nextSess: GradingSession = {
              ...updatedBase,
              gradebookEntries: reconcileIntelligentGradebook(updatedBase),
            };
            void saveGradingSession(nextSess);
            return nextSess;
          })
        );

        setBatchQueue((prev) => markQueueItemCompleted(prev, nextItem.id, graded));
        void checkStorageQuota();
      } catch (err) {
        setBatchQueue((prev) =>
          markQueueItemFailed(
            prev,
            nextItem.id,
            err instanceof Error ? err.message : 'Lỗi không xác định khi xử lý ảnh.'
          )
        );
      } finally {
        queueProcessingRef.current = false;
      }
    })();
  }, [batchQueue, cameraFallbackExamCode, checkStorageQuota]);

  const handleEnqueueCameraFile = useCallback(
    (file: File, source: 'camera' | 'upload') => {
      const itemId = createId('bq');
      queueFilesRef.current.set(itemId, file);
      setBatchQueue((prev) => {
        const res = enqueueBatchItem(prev, {
          id: itemId,
          fileName: file.name,
          createdAt: new Date().toISOString(),
          captureSource: source,
          retakeForSheetId: retakeTargetSheet?.id,
        });
        if (res.warning) {
          onNotify('info', res.warning);
        }
        return res.queue;
      });
    },
    [onNotify, retakeTargetSheet?.id]
  );

  const handleRetryQueueItem = useCallback((itemId: string) => {
    setBatchQueue((prev) => retryFailedQueueItem(prev, itemId));
  }, []);

  const handleCancelWaitingQueue = useCallback(() => {
    setBatchQueue((prev) => {
      prev
        .filter((i) => i.status === 'waiting')
        .forEach((i) => queueFilesRef.current.delete(i.id));
      return cancelWaitingQueueItems(prev);
    });
    onNotify('info', 'Đã hủy các phiếu đang chờ trong hàng đợi (các phiếu đã chấm vẫn được giữ nguyên).');
  }, [onNotify]);

  const handleResolveDuplicateGroup = async (
    group: DuplicateGroup,
    action: DuplicateResolutionAction
  ) => {
    if (!activeSession) return;
    const { sheets: resolvedSheets, historyEntry } = applyDuplicateResolution(
      activeSession.sheets,
      group,
      action
    );
    const annotated = annotateDuplicateStudentWarnings(resolvedSheets);
    await persistSession({
      ...activeSession,
      sheets: annotated,
      duplicateResolutionHistory: [
        ...(activeSession.duplicateResolutionHistory ?? []),
        historyEntry,
      ],
    });
    onNotify('success', 'Đã lưu quyết định xử lý phiếu trùng vào lịch sử phiên chấm.');
  };

  const persistSession = async (
    nextSession: GradingSession,
    options?: { skipReconcile?: boolean }
  ) => {
    const now = new Date().toISOString();
    const baseSession: GradingSession = {
      ...nextSession,
      updatedAt: now,
    };
    const stamped: GradingSession = options?.skipReconcile
      ? baseSession
      : {
          ...baseSession,
          gradebookEntries: reconcileIntelligentGradebook(baseSession),
        };
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === stamped.id);
      const next = exists
        ? prev.map((s) => (s.id === stamped.id ? stamped : s))
        : [stamped, ...prev];
      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
    try {
      await saveGradingSession(stamped);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error
          ? err.message
          : 'Không thể lưu phiên chấm vào IndexedDB.'
      );
    }
  };

  const handleConfirmGradebookScore = async (params: {
    studentId: string;
    chosenScore: number | null;
    source: 'omr' | 'photo-ocr' | 'manual';
    reason: string;
  }) => {
    if (!activeSession) return;
    try {
      const updated = confirmOrOverrideGradebookEntry({
        session: activeSession,
        ...params,
      });
      await persistSession(updated, { skipReconcile: true });
      onNotify(
        'success',
        `Đã xác nhận điểm chính thức cho ${params.studentId} (${params.chosenScore ?? 'Trống'}).`
      );
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Không thể xác nhận điểm sổ điểm.'
      );
    }
  };

  const handleConfirmAllMatchedGradebook = async () => {
    if (!activeSession) return;
    const entries =
      activeSession.gradebookEntries && activeSession.gradebookEntries.length > 0
        ? activeSession.gradebookEntries
        : reconcileIntelligentGradebook(activeSession);
    const eligible = entries.filter(
      (e) =>
        !e.confirmedByTeacher &&
        e.omrScore !== null &&
        e.reconciliationStatus !== 'MISMATCH' &&
        e.reconciliationStatus !== 'REVIEW_REQUIRED'
    );
    if (eligible.length === 0) return;

    let current: GradingSession = {
      ...activeSession,
      gradebookEntries: entries,
    };
    for (const entry of eligible) {
      current = confirmOrOverrideGradebookEntry({
        session: current,
        studentId: entry.studentId,
        chosenScore: entry.omrScore,
        source: 'omr',
        reason: 'Xác nhận hàng loạt các phiếu OMR hợp lệ',
      });
    }
    await persistSession(current, { skipReconcile: true });
    onNotify(
      'success',
      `Đã xác nhận điểm chính thức cho ${eligible.length} học sinh trong Sổ điểm.`
    );
  };

  const handleUndoGradebookChange = async (studentId: string) => {
    if (!activeSession) return;
    const updated = undoLastOfficialGradeChange({
      session: activeSession,
      studentId,
    });
    await persistSession(updated, { skipReconcile: true });
    onNotify('info', `Đã hoàn tác thao tác điểm gần nhất của ${studentId}.`);
  };

  const regenerateAnnotatedEvidenceForSheet = async (
    session: GradingSession,
    sheet: GradedSheetRecord
  ): Promise<GradedSheetRecord> => {
    try {
      const origRec = await getEvidenceBlob(sheet.originalBlobId);
      if (!origRec?.blob) return sheet;
      const pngBlob = await renderAnnotatedEvidencePngBlob(
        origRec.blob,
        sheet,
        session.omrQuestionCount
      );
      const annotId = sheet.annotatedBlobId || createId('ev-annot');
      await saveEvidenceBlob({
        id: annotId,
        sessionId: session.id,
        sheetId: sheet.id,
        kind: 'annotated',
        mimeType: 'image/png',
        byteSize: pngBlob.size,
        blob: pngBlob,
        updatedAt: new Date().toISOString(),
      });
      return {
        ...sheet,
        annotatedBlobId: annotId,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return sheet;
    }
  };

  const handleCreateSession = async () => {
    // Idempotency guard: chống bấm đúp tạo trùng phiên chấm OMR
    if (creatingSessionRef.current) return;
    if (!draftExam) {
      onNotify('error', 'Vui lòng tạo và trộn ít nhất 1 mã đề trong Exam Mixer Pro trước.');
      return;
    }
    const exportGate = checkExamExportGate(draftExam);
    if (!exportGate.canExport) {
      onNotify(
        'error',
        exportGate.blockingReasons[0] ??
          'Đề kiểm tra chưa đạt cổng kiểm chứng toàn vẹn trong Exam Mixer Pro.'
      );
      return;
    }
    if (draftSelectedCodes.length === 0) {
      onNotify('error', 'Vui lòng chọn ít nhất 1 mã đề cho phiên chấm.');
      return;
    }

    const normalizedClass = draftClassName.trim() || '12A1';
    const existingDuplicate = findExistingGradingSession(
      sessions,
      draftExam.id,
      normalizedClass,
      draftSelectedCodes
    );
    if (existingDuplicate) {
      setActiveSessionId(existingDuplicate.id);
      setCreatingNew(false);
      setActiveTab('roster');
      onNotify(
        'info',
        `Đã mở lại phiên chấm hiện có "${existingDuplicate.title}" cho lớp ${existingDuplicate.className} (chống tạo trùng phiên).`
      );
      return;
    }

    const keys = buildExamAnswerKeyMap(draftExam, draftSelectedCodes);
    const invalidCodes = Object.values(keys).filter((k) => !k.valid);
    const validKey = Object.values(keys).find((k) => k.valid);
    if (!validKey || invalidCodes.length > 0) {
      const firstErr =
        invalidCodes[0]?.blockingErrors[0] ??
        Object.values(keys)[0]?.blockingErrors[0] ??
        'Các mã đề đã chọn chưa đạt điều kiện chấm OMR tự động.';
      onNotify('error', firstErr);
      return;
    }

    creatingSessionRef.current = true;
    try {
      const now = new Date().toISOString();
      const newSession: GradingSession = {
        id: createId('grade'),
        title: draftTitle.trim() || `Chấm ${draftExam.title}`,
        examId: draftExam.id,
        examTitle: draftExam.title,
        subject: draftExam.subject,
        grade: draftExam.grade,
        className: normalizedClass,
        selectedExamCodes: [...draftSelectedCodes],
        omrQuestionCount: validKey.autoGradableCount,
        gradingRule: { ...DEFAULT_GRADING_RULE },
        omrThresholds: { ...DEFAULT_OMR_THRESHOLDS },
        students: [],
        sheets: [],
        createdAt: now,
        updatedAt: now,
      };

      await persistSession(newSession);
      setActiveSessionId(newSession.id);
      setCreatingNew(false);
      setActiveTab('roster');
      onNotify(
        'success',
        `Đã tạo phiên chấm "${newSession.title}" (${newSession.selectedExamCodes.length} mã đề, ${newSession.omrQuestionCount} câu OMR).`
      );
    } finally {
      creatingSessionRef.current = false;
    }
  };

  const handleUpdateStudents = async (nextStudents: StudentRecord[]) => {
    if (!activeSession) return;
    // Khi danh sách lớp thay đổi, tự động đối chiếu lại studentId trên các phiếu hiện có
    const recalculated = annotateDuplicateStudentWarnings(
      activeSession.sheets.map((s) =>
        recalculateSheetRecord(
          s,
          answerKeysByCode,
          nextStudents,
          activeSession.gradingRule
        )
      )
    );
    await persistSession({
      ...activeSession,
      students: nextStudents,
      sheets: recalculated,
    });
  };

  const handleUpdateGradingRule = async (nextRule: GradingRuleConfig) => {
    if (!activeSession) return;
    const recalculated = annotateDuplicateStudentWarnings(
      activeSession.sheets.map((s) =>
        recalculateSheetRecord(s, answerKeysByCode, activeSession.students, nextRule)
      )
    );
    await persistSession({
      ...activeSession,
      gradingRule: nextRule,
      sheets: recalculated,
    });
  };

  const handleUpdateThresholds = async (nextThresholds: OmrThresholdsConfig) => {
    if (!activeSession) return;
    await persistSession({
      ...activeSession,
      omrThresholds: nextThresholds,
    });
  };

  const handleBatchCompleted = async (newSheets: GradedSheetRecord[]) => {
    if (!activeSession) return;
    const merged = annotateDuplicateStudentWarnings([
      ...activeSession.sheets,
      ...newSheets,
    ]);
    await persistSession({
      ...activeSession,
      sheets: merged,
    });
    if (newSheets.length > 0) {
      setSelectedReviewSheetId(newSheets[0].id);
    }
  };

  const handleOverrideQuestion = async (
    sheetId: string,
    questionNumber: number,
    value: OmrBubbleChoice | null,
    reason?: string
  ) => {
    if (!activeSession) return;
    const target = activeSession.sheets.find((s) => s.id === sheetId);
    if (!target) return;

    const overridden = overrideSheetQuestion(
      target,
      questionNumber,
      value,
      reason,
      answerKeysByCode,
      activeSession.students,
      activeSession.gradingRule
    );
    const immediateSheets = annotateDuplicateStudentWarnings(
      activeSession.sheets.map((s) => (s.id === sheetId ? overridden : s))
    );
    const immediateSession: GradingSession = {
      ...activeSession,
      sheets: immediateSheets,
    };
    await persistSession(immediateSession);

    // Kết xuất lại ảnh minh chứng (annotated.png) sau khi đã phản hồi UI tức thì
    const refreshed = await regenerateAnnotatedEvidenceForSheet(
      immediateSession,
      overridden
    );
    if (refreshed.annotatedBlobId !== overridden.annotatedBlobId) {
      setSessions((prev) =>
        prev.map((sess) => {
          if (sess.id !== immediateSession.id) return sess;
          const updatedSess: GradingSession = {
            ...sess,
            sheets: sess.sheets.map((sh) =>
              sh.id === sheetId
                ? {
                    ...sh,
                    annotatedBlobId: refreshed.annotatedBlobId,
                    updatedAt: new Date().toISOString(),
                  }
                : sh
            ),
            updatedAt: new Date().toISOString(),
          };
          void saveGradingSession(updatedSess);
          return updatedSess;
        })
      );
    }
  };

  const handleUpdateSheetMeta = async (
    sheetId: string,
    patch: {
      manualExamCode?: string;
      manualStudentId?: string;
      manualViewRotationDeg?: 0 | 90 | 180 | 270;
      confirmedByTeacher?: boolean;
      notes?: string;
    }
  ) => {
    if (!activeSession) return;
    const target = activeSession.sheets.find((s) => s.id === sheetId);
    if (!target) return;

    const updated = recalculateSheetRecord(
      target,
      answerKeysByCode,
      activeSession.students,
      activeSession.gradingRule,
      {
        manualExamCode: patch.manualExamCode,
        manualStudentId: patch.manualStudentId,
        manualViewRotationDeg: patch.manualViewRotationDeg,
        confirmedByTeacher: patch.confirmedByTeacher,
        notes: patch.notes,
      }
    );

    const needsEvidenceRedraw =
      patch.manualExamCode !== undefined ||
      patch.manualStudentId !== undefined ||
      patch.confirmedByTeacher !== undefined;

    const finalSheet = needsEvidenceRedraw
      ? await regenerateAnnotatedEvidenceForSheet(activeSession, updated)
      : updated;

    const nextSheets = annotateDuplicateStudentWarnings(
      activeSession.sheets.map((s) => (s.id === sheetId ? finalSheet : s))
    );
    await persistSession({ ...activeSession, sheets: nextSheets });
    if (patch.confirmedByTeacher === true && finalSheet.confirmedByTeacher) {
      onNotify(
        'success',
        `Đã xác nhận bài chấm của ${finalSheet.studentName || finalSheet.studentId} (${finalSheet.finalScore}/${finalSheet.maxScore}đ).`
      );
    }
  };

  const handleDeleteSheet = async (sheetId: string) => {
    if (!activeSession) return;
    await deleteSheetEvidenceBlobs(sheetId);
    const nextSheets = annotateDuplicateStudentWarnings(
      activeSession.sheets.filter((s) => s.id !== sheetId)
    );
    await persistSession({ ...activeSession, sheets: nextSheets });
    if (selectedReviewSheetId === sheetId) {
      setSelectedReviewSheetId(nextSheets[0]?.id ?? null);
    }
    onNotify('info', 'Đã xóa bài làm và ảnh minh chứng cục bộ khỏi phiên chấm.');
  };

  const handleDeleteActiveSession = async () => {
    if (!activeSession) return;
    const deletingId = activeSession.id;
    await deleteGradingSession(deletingId);
    const remaining = sessions.filter((s) => s.id !== deletingId);
    setSessions(remaining);
    setActiveSessionId(remaining[0]?.id ?? null);
    if (remaining.length === 0) setCreatingNew(true);
    onNotify('info', 'Đã xóa phiên chấm và toàn bộ ảnh minh chứng khỏi IndexedDB.');
  };

  const handleImportSessionJson = async (imported: GradingSession) => {
    await persistSession(imported);
    setActiveSessionId(imported.id);
    setCreatingNew(false);
    onNotify('success', `Đã khôi phục phiên chấm "${imported.title}".`);
  };

  const reviewBadgeCount = activeSession
    ? activeSession.sheets.filter(
        (s) =>
          !s.archivedByDuplicateResolution &&
          (s.status === 'review-required' || s.status === 'error' || s.retakeRequested)
      ).length
    : 0;

  const tabs: Array<{
    id: GradingTabId;
    label: string;
    icon: typeof BarChart3;
    count?: number;
  }> = [
    { id: 'dashboard', label: 'Tổng quan', icon: BarChart3 },
    {
      id: 'roster',
      label: 'Danh sách lớp',
      icon: Users,
      count: activeSession?.students.length,
    },
    { id: 'sheet-gen', label: 'Phiếu trả lời A4', icon: QrCode },
    {
      id: 'upload',
      label: 'Tải ảnh & Chấm OMR',
      icon: Camera,
      count: activeSession?.sheets.length,
    },
    {
      id: 'review',
      label: 'Duyệt thủ công',
      icon: Eye,
      count: reviewBadgeCount > 0 ? reviewBadgeCount : undefined,
    },
    {
      id: 'gradebook',
      label: 'Sổ điểm',
      icon: ClipboardCheck,
      count: activeSession?.gradebookEntries?.length,
    },
    { id: 'export', label: 'Xuất Excel & ZIP', icon: Archive },
    { id: 'azota', label: 'Azota (Tệp tin)', icon: FileSpreadsheet },
  ];

  const draftKeysMap = useMemo(
    () => (draftExam ? buildExamAnswerKeyMap(draftExam) : {}),
    [draftExam]
  );

  return (
    <main className="mx-auto max-w-[1380px] px-4 py-5 sm:px-6 sm:py-6 space-y-5">
      {preferredExamAlert && (
        <div
          role="alert"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs ${
            preferredExamAlert.kind === 'blocked'
              ? 'border-rose-300 dark:border-rose-800 bg-rose-50/90 dark:bg-rose-950/50 text-rose-950 dark:text-rose-200'
              : 'border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/50 text-amber-950 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-bold">{preferredExamAlert.title}</p>
              <p className="mt-0.5 opacity-90">{preferredExamAlert.detail}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenExamMixer(preferredExamAlert.examId)}
              className="rounded-xl bg-[#635BFF] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5248f0]"
            >
              Mở Exam Mixer Pro để xử lý
            </button>
            <button
              type="button"
              onClick={() => setPreferredExamAlert(null)}
              className="rounded-xl border border-current/25 bg-white/80 dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* Compact Aurora Bento Module Header */}
      <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#635BFF] to-[#2563EB] text-white">
            <ScanLine className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-slate-950 dark:text-white truncate">
              Smart Grading Studio
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Chấm OMR cục bộ · Đối chiếu mã đề Exam Mixer Pro · Xuất Excel &amp; ZIP minh chứng
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {sessions.length > 0 && (
            <select
              aria-label="Chọn phiên chấm bài"
              value={creatingNew ? '__new__' : activeSessionId ?? ''}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  setCreatingNew(true);
                } else {
                  setCreatingNew(false);
                  setActiveSessionId(e.target.value);
                }
              }}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 max-w-[260px]"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.className})
                </option>
              ))}
              <option value="__new__">+ Tạo phiên chấm mới...</option>
            </select>
          )}

          <button
            type="button"
            onClick={() => {
              setCreatingNew(false);
              setActiveTab('azota');
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'azota' && !creatingNew
                ? 'border-[#635BFF] bg-[#EEF0FF] dark:bg-indigo-950/60 text-[#5046E5] dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-indigo-400'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Azota (Tệp tin)</span>
          </button>

          <button
            type="button"
            onClick={() => setCreatingNew((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{creatingNew && activeSession ? 'Quay lại phiên hiện tại' : 'Phiên chấm mới'}</span>
          </button>
        </div>
      </header>

      {/* Create New Grading Session View OR Direct Azota File Bridge View */}
      {loadingSessions ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-500">
          Đang nạp dữ liệu Smart Grading Studio cục bộ...
        </div>
      ) : activeTab === 'azota' && !creatingNew && !activeSession ? (
        <AzotaIntegrationPanel
          mathExams={mathExams}
          activeSession={null}
          preferredExamId={preferredExamId}
          onOpenCreateSession={() => setCreatingNew(true)}
          onNotify={onNotify}
        />
      ) : creatingNew || !activeSession ? (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-slate-950 dark:text-white">
              Khởi tạo phiên chấm bài từ Exam Mixer Pro
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Chọn một đề kiểm tra đã trộn mã đề trong Exam Mixer Pro. Hệ thống sẽ lấy trực tiếp bảng đáp án đã đảo phương án của từng mã đề để chấm OMR tự động.
            </p>
          </div>

          {gradableExams.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/40 p-8 text-center space-y-3">
              <Layers className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Chưa có đề kiểm tra nào được sinh mã đề trong Exam Mixer Pro
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Hãy mở Exam Mixer Pro để trộn mã đề hoặc bấm nút bên dưới để chạy bộ trộn Exam Mixer Pro tự động sinh các mã đề (101–104) cho đề kiểm tra hiện có.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                {mathExams.length > 0 && onSaveMathExam && (
                  <button
                    type="button"
                    onClick={async () => {
                      const target = mathExams[0];
                      const generated = generateMixedExams({
                        ...target,
                        confirmedOriginalAnswers: true,
                      });
                      await onSaveMathExam({
                        ...target,
                        confirmedOriginalAnswers: true,
                        generatedVersions: generated.versions,
                        status: 'ready',
                      });
                      onNotify(
                        'success',
                        `Đã trộn ${generated.versions.length} mã đề (${generated.versions.map((v) => v.code).join(', ')}) từ đề "${target.title}".`
                      );
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    <span>Trộn ngay {mathExams[0].mixConfig.examCount} mã đề cho "{mathExams[0].title}"</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenExamMixer?.()}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Layers className="h-4 w-4" aria-hidden="true" />
                  <span>Mở Exam Mixer Pro</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="space-y-1 text-xs md:col-span-2">
                  <span className="block font-semibold text-slate-700 dark:text-slate-300">
                    Đề kiểm tra từ Exam Mixer Pro
                  </span>
                  <select
                    value={draftExam?.id ?? ''}
                    onChange={(e) => setDraftExamId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    {gradableExams.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.title} · {ex.subject} {ex.grade} ({ex.generatedVersions.length} mã đề)
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-xs">
                  <span className="block font-semibold text-slate-700 dark:text-slate-300">
                    Tên lớp học
                  </span>
                  <input
                    type="text"
                    value={draftClassName}
                    onChange={(e) => setDraftClassName(e.target.value)}
                    placeholder="Ví dụ: 12A1"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </label>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="block font-semibold text-slate-700 dark:text-slate-300">
                  Tên phiên chấm bài
                </span>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100"
                />
              </label>

              {/* Select Exam Codes + Integrity Inspection */}
              {draftExam && (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Chọn các mã đề áp dụng (kiểm chứng đáp án đã đảo tự động):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {draftExam.generatedVersions.map((ver) => {
                      const keyInfo = draftKeysMap[ver.code];
                      const isChecked = draftSelectedCodes.includes(ver.code);
                      return (
                        <label
                          key={ver.code}
                          className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs cursor-pointer transition-colors ${
                            isChecked
                              ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={!keyInfo?.valid}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setDraftSelectedCodes((prev) => [...prev, ver.code]);
                              } else {
                                setDraftSelectedCodes((prev) =>
                                  prev.filter((c) => c !== ver.code)
                                );
                              }
                            }}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                          />
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100">
                              Mã đề {ver.code}
                            </div>
                            {keyInfo?.valid ? (
                              <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span>
                                  {keyInfo.autoGradableCount} câu OMR A/B/C/D hợp lệ
                                </span>
                              </div>
                            ) : (
                              <div className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span>{keyInfo?.blockingErrors[0] ?? 'Lỗi ánh xạ đáp án'}</span>
                              </div>
                            )}
                            {keyInfo && keyInfo.unsupportedCount > 0 && (
                              <div className="text-[10.5px] text-slate-500">
                                {keyInfo.unsupportedCount} câu Đúng/Sai hoặc Tự luận (không chấm OMR)
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleCreateSession()}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-xs font-semibold text-white transition-colors"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Tạo phiên chấm bài</span>
                </button>
                {activeSession && (
                  <button
                    type="button"
                    onClick={() => setCreatingNew(false)}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Hủy
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      ) : (
        <>
          {/* Linked Exam Summary Strip (Zero-pill clean inline metadata) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/70 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-slate-700 dark:text-slate-300">
              <strong className="text-slate-950 dark:text-white">
                {activeSession.examTitle}
              </strong>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span>Lớp {activeSession.className}</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono-num">
                Mã đề: {activeSession.selectedExamCodes.join(', ')}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono-num">
                {activeSession.omrQuestionCount} câu OMR (A/B/C/D)
              </span>
            </div>

            {!linkedExam && (
              <span className="text-red-600 dark:text-red-400 font-semibold">
                Không tìm thấy đề gốc trong Exam Mixer Pro (có thể đã bị xóa)
              </span>
            )}
          </div>

          {/* 6-Step Module Navigation */}
          <nav
            aria-label="Các bước chấm bài Smart Grading Studio"
            className="flex items-center gap-1.5 overflow-x-auto pb-1"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors border ${
                    isActive
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className={`font-mono-num text-[11px] ${
                        isActive
                          ? 'text-indigo-100'
                          : tab.id === 'review'
                          ? 'text-amber-600 dark:text-amber-400 font-bold'
                          : 'text-slate-400'
                      }`}
                    >
                      ({tab.count})
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Active Step Workspace */}
          {activeTab === 'dashboard' && (
            <GradingDashboardPanel
              session={activeSession}
              duplicateGroupCount={duplicateGroups.length}
              queueInFlightCount={queueSummary.inFlight}
              lowStorageWarning={lowStorageWarning}
              onStartCameraScan={() => {
                setRetakeTargetSheet(null);
                setCameraModalOpen(true);
              }}
              onReviewFlaggedSheets={() => {
                const firstFlagged = activeSession.sheets.find(
                  (s) =>
                    !s.archivedByDuplicateResolution &&
                    (s.status === 'review-required' || s.status === 'error')
                );
                if (firstFlagged) setSelectedReviewSheetId(firstFlagged.id);
                setReviewOnlyFlagged(true);
                setActiveTab('review');
              }}
              onOpenDuplicateResolver={() => setDuplicateModalOpen(true)}
              onReviewSheet={(sheetId) => {
                setReviewOnlyFlagged(false);
                setSelectedReviewSheetId(sheetId);
                setActiveTab('review');
              }}
              onDeleteSheet={(sheetId) => void handleDeleteSheet(sheetId)}
              onUpdateGradingRule={(rule) => void handleUpdateGradingRule(rule)}
              onImportSessionJson={(imp) => void handleImportSessionJson(imp)}
              onDeleteSession={() => void handleDeleteActiveSession()}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'roster' && (
            <StudentRosterPanel
              classNameLabel={activeSession.className}
              students={activeSession.students}
              onChangeStudents={(next) => void handleUpdateStudents(next)}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'sheet-gen' && (
            <AnswerSheetGeneratorPanel
              session={activeSession}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'upload' && (
            <OmrBatchUploadPanel
              session={activeSession}
              answerKeysByCode={answerKeysByCode}
              onBatchCompleted={(newSheets) => void handleBatchCompleted(newSheets)}
              onUpdateThresholds={(t) => void handleUpdateThresholds(t)}
              onOpenCameraScanner={() => {
                setRetakeTargetSheet(null);
                setCameraModalOpen(true);
              }}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'review' && (
            <ManualReviewPanel
              session={activeSession}
              answerKeysByCode={answerKeysByCode}
              selectedSheetId={selectedReviewSheetId}
              onlyReviewInitially={reviewOnlyFlagged}
              onSelectSheet={setSelectedReviewSheetId}
              onRetakeSheet={(sheet) => {
                setRetakeTargetSheet(sheet);
                setCameraModalOpen(true);
              }}
              onOverrideQuestion={(sheetId, qNum, val, reason) =>
                void handleOverrideQuestion(sheetId, qNum, val, reason)
              }
              onUpdateSheetMeta={(sheetId, patch) =>
                void handleUpdateSheetMeta(sheetId, patch)
              }
            />
          )}

          {activeTab === 'gradebook' && (
            <GradebookReconciliationPanel
              session={activeSession}
              onConfirmScore={(params) => void handleConfirmGradebookScore(params)}
              onConfirmAllMatched={() => void handleConfirmAllMatchedGradebook()}
              onUndoLastChange={(sid) => void handleUndoGradebookChange(sid)}
              onInspectOmrSheet={(sheetId) => {
                setReviewOnlyFlagged(false);
                setSelectedReviewSheetId(sheetId);
                setActiveTab('review');
              }}
              onScanMissingStudent={() => {
                setRetakeTargetSheet(null);
                setCameraModalOpen(true);
              }}
            />
          )}

          {activeTab === 'export' && (
            <GradingExportPanel
              session={activeSession}
              answerKeysByCode={answerKeysByCode}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'azota' && (
            <AzotaIntegrationPanel
              mathExams={mathExams}
              activeSession={activeSession}
              preferredExamId={preferredExamId ?? activeSession.examId}
              onCommitToSession={async (updated) => {
                await persistSession(updated);
              }}
              onOpenGradebookTab={() => setActiveTab('gradebook')}
              onOpenCreateSession={() => setCreatingNew(true)}
              onNotify={onNotify}
            />
          )}

          {/* Phase 3 Fullscreen Mobile Camera Scanner Modal */}
          <MobileCameraScannerModal
            open={cameraModalOpen}
            sessionTitle={activeSession.title}
            classNameLabel={activeSession.className}
            selectedExamCodes={activeSession.selectedExamCodes}
            fallbackExamCode={cameraFallbackExamCode}
            onChangeFallbackExamCode={setCameraFallbackExamCode}
            queue={batchQueue}
            retakeTargetLabel={
              retakeTargetSheet
                ? `${retakeTargetSheet.studentId || retakeTargetSheet.fileName} (Mã ${retakeTargetSheet.examCode || '—'})`
                : null
            }
            lowStorageWarning={lowStorageWarning}
            onCaptureFile={handleEnqueueCameraFile}
            onRetryQueueItem={handleRetryQueueItem}
            onCancelWaitingQueue={handleCancelWaitingQueue}
            onReviewLatestFlagged={() => {
              setCameraModalOpen(false);
              const firstFlagged = activeSession.sheets.find(
                (s) =>
                  !s.archivedByDuplicateResolution &&
                  (s.status === 'review-required' || s.status === 'error')
              );
              if (firstFlagged) setSelectedReviewSheetId(firstFlagged.id);
              setReviewOnlyFlagged(true);
              setActiveTab('review');
            }}
            onClose={() => {
              setCameraModalOpen(false);
              setRetakeTargetSheet(null);
            }}
          />

          {/* Phase 3 Duplicate Detection & Non-Destructive Resolution Modal */}
          <DuplicateResolutionModal
            open={duplicateModalOpen}
            groups={duplicateGroups}
            sheets={activeSession.sheets}
            history={activeSession.duplicateResolutionHistory ?? []}
            onResolveGroup={(g, action) =>
              void handleResolveDuplicateGroup(g, action)
            }
            onInspectSheet={(sheetId) => {
              setReviewOnlyFlagged(false);
              setSelectedReviewSheetId(sheetId);
              setActiveTab('review');
            }}
            onRetakeForGroup={(group) => {
              const target = activeSession.sheets.find(
                (s) => s.id === group.sheetIds[0]
              );
              setDuplicateModalOpen(false);
              setRetakeTargetSheet(target ?? null);
              setCameraModalOpen(true);
            }}
            onClose={() => setDuplicateModalOpen(false)}
          />
        </>
      )}
    </main>
  );
}
