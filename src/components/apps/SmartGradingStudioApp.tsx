import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Camera,
  CheckCircle2,
  Eye,
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
import {
  annotateDuplicateStudentWarnings,
  overrideSheetQuestion,
  recalculateSheetRecord,
} from '../../core/grading/gradingEngine';
import { renderAnnotatedEvidencePngBlob } from '../../core/grading/omrBrowserBridge';
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
import { GradingExportPanel } from '../grading/GradingExportPanel';

type GradingTabId =
  | 'dashboard'
  | 'roster'
  | 'sheet-gen'
  | 'upload'
  | 'review'
  | 'export';

interface SmartGradingStudioAppProps {
  mathExams: MathExamProject[];
  preferredExamId?: string | null;
  onOpenExamMixer: () => void;
  onNotify: (tone: 'success' | 'info' | 'error', message: string) => void;
}

export function SmartGradingStudioApp({
  mathExams,
  preferredExamId,
  onOpenExamMixer,
  onNotify,
}: SmartGradingStudioAppProps) {
  const [sessions, setSessions] = useState<GradingSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<GradingTabId>('dashboard');
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
        } else {
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

  // Đồng bộ đề gợi ý khi mở từ Exam Mixer Pro
  useEffect(() => {
    if (preferredExamId && gradableExams.some((e) => e.id === preferredExamId)) {
      setDraftExamId(preferredExamId);
      const existing = sessions.find((s) => s.examId === preferredExamId);
      if (existing) {
        setActiveSessionId(existing.id);
        setCreatingNew(false);
      } else {
        setCreatingNew(true);
      }
    } else if (!draftExamId && gradableExams.length > 0) {
      setDraftExamId(gradableExams[0].id);
    }
  }, [draftExamId, gradableExams, preferredExamId, sessions]);

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

  const persistSession = async (nextSession: GradingSession) => {
    const stamped: GradingSession = {
      ...nextSession,
      updatedAt: new Date().toISOString(),
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
    if (!draftExam) {
      onNotify('error', 'Vui lòng tạo và trộn ít nhất 1 mã đề trong Exam Mixer Pro trước.');
      return;
    }
    if (draftSelectedCodes.length === 0) {
      onNotify('error', 'Vui lòng chọn ít nhất 1 mã đề cho phiên chấm.');
      return;
    }

    const keys = buildExamAnswerKeyMap(draftExam, draftSelectedCodes);
    const validKey = Object.values(keys).find((k) => k.valid);
    if (!validKey) {
      const firstErr =
        Object.values(keys)[0]?.blockingErrors[0] ??
        'Các mã đề đã chọn chưa đạt điều kiện chấm OMR tự động.';
      onNotify('error', firstErr);
      return;
    }

    const now = new Date().toISOString();
    const newSession: GradingSession = {
      id: createId('grade'),
      title: draftTitle.trim() || `Chấm ${draftExam.title}`,
      examId: draftExam.id,
      examTitle: draftExam.title,
      subject: draftExam.subject,
      grade: draftExam.grade,
      className: draftClassName.trim() || '12A1',
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
    const refreshed = await regenerateAnnotatedEvidenceForSheet(
      activeSession,
      overridden
    );
    const nextSheets = annotateDuplicateStudentWarnings(
      activeSession.sheets.map((s) => (s.id === sheetId ? refreshed : s))
    );
    await persistSession({ ...activeSession, sheets: nextSheets });
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
        (s) => s.status === 'review-required' || s.status === 'error'
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
    { id: 'export', label: 'Xuất Excel & ZIP', icon: Archive },
  ];

  const draftKeysMap = useMemo(
    () => (draftExam ? buildExamAnswerKeyMap(draftExam) : {}),
    [draftExam]
  );

  return (
    <main className="mx-auto max-w-[1380px] px-4 py-5 sm:px-6 sm:py-6 space-y-5">
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
            onClick={() => setCreatingNew((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{creatingNew && activeSession ? 'Quay lại phiên hiện tại' : 'Phiên chấm mới'}</span>
          </button>
        </div>
      </header>

      {/* Create New Grading Session View */}
      {loadingSessions ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-500">
          Đang nạp dữ liệu Smart Grading Studio cục bộ...
        </div>
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
                Hãy mở Exam Mixer Pro, trộn và tạo ít nhất 1 mã đề (ví dụ Mã 101, 102) rồi quay lại Smart Grading Studio để tạo phiếu trả lời và chấm tự động.
              </p>
              <button
                type="button"
                onClick={onOpenExamMixer}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-xs font-semibold text-white"
              >
                <Layers className="h-4 w-4" aria-hidden="true" />
                <span>Mở Exam Mixer Pro</span>
              </button>
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
              onReviewSheet={(sheetId) => {
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
              onNotify={onNotify}
            />
          )}

          {activeTab === 'review' && (
            <ManualReviewPanel
              session={activeSession}
              answerKeysByCode={answerKeysByCode}
              selectedSheetId={selectedReviewSheetId}
              onSelectSheet={setSelectedReviewSheetId}
              onOverrideQuestion={(sheetId, qNum, val, reason) =>
                void handleOverrideQuestion(sheetId, qNum, val, reason)
              }
              onUpdateSheetMeta={(sheetId, patch) =>
                void handleUpdateSheetMeta(sheetId, patch)
              }
            />
          )}

          {activeTab === 'export' && (
            <GradingExportPanel
              session={activeSession}
              answerKeysByCode={answerKeysByCode}
              onNotify={onNotify}
            />
          )}
        </>
      )}
    </main>
  );
}
