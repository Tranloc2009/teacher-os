import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Copy,
  Download,
  FileArchive,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Lock,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react';
import { ContextualAcademyBar } from '../tutorial/ContextualAcademyBar';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { Button, PageBanner } from '../ui/DesignSystem';
import {
  COGNITIVE_LEVEL_LABELS,
  CognitiveLevel,
  ExamExportSettings,
  ExportIntegrityResult,
  MATH_TOPICS,
  MIX_LEVEL_DESCRIPTIONS,
  MathExamProject,
  MathExamStep,
  MathIntegrityReport,
  MathQuestion,
  MathQuestionType,
  MixLevel,
  QuestionGroup,
  UNIVERSAL_QUESTION_TYPE_LABELS,
  UniversalQuestionType,
} from '../../types/mathExam';
import {
  auditOriginalExamIntegrity,
  checkExamExportGate,
  computeLockStats,
  createOriginalExamSnapshot,
  estimateMaxDistinctPermutations,
  evaluatePreMixIntegrity,
  getOptionLetterLabel,
  getStatementLetterLabel,
  verifyMixedExamIntegrity,
} from '../../core/mathIntegrity';
import {
  EXAM_CODE_PRESETS,
  MAX_EXAM_CODES,
  buildDefaultMatrixRules,
  generateMixedExamsAsync,
  validateMixConfiguration,
} from '../../core/mathShuffleEngine';
import {
  getSubjectProfile,
  getUniversalQuestionType,
  resolveSubjectId,
} from '../../core/subjectProfileRegistry';
import {
  buildAnswerKeyDocxBuffer,
  buildConsolidatedAnswerCsv,
  buildStudentExamDocxBuffer,
  exportMixedExamZipBundle,
  verifyExportedDocxBuffer,
} from '../../core/examExportEngine';
import { createEmptyMathExamProject } from '../../data/demoMathExams';
import { createId } from '../../db/database';
import { MathExamEditor } from '../math/MathExamEditor';
import { MathExamPrintPreview } from '../math/MathExamPrintPreview';
import {
  MathContentRenderer,
  MathVisualAssetRenderer,
} from '../math/MathContentRenderer';
import {
  MathIntegrityBadge,
  MathIntegrityReportPanel,
} from '../math/MathIntegrityReportPanel';

interface MathExamMixerAppProps {
  mathExams: MathExamProject[];
  onSaveMathExam: (exam: MathExamProject, silent?: boolean) => Promise<MathExamProject>;
  onDeleteMathExam: (id: string) => Promise<void>;
  onDuplicateMathExam: (exam: MathExamProject) => Promise<void>;
  onShowToast: (tone: 'success' | 'info' | 'error', text: string) => void;
}

const STEP_TABS: Array<{ step: MathExamStep; label: string }> = [
  { step: 1, label: '1. Nhập đề & Hồ sơ môn' },
  { step: 2, label: '2. Xác nhận đáp án gốc' },
  { step: 3, label: '3. Quy tắc trộn & Số mã' },
  { step: 4, label: '4. Kiểm tra & So sánh' },
  { step: 5, label: '5. Kiểm chứng & Xuất đề' },
];

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function MathExamMixerApp({
  mathExams,
  onSaveMathExam,
  onDeleteMathExam,
  onDuplicateMathExam,
  onShowToast,
}: MathExamMixerAppProps) {
  const [selectedExamId, setSelectedExamId] = useState<string>(
    mathExams[0]?.id ?? ''
  );
  const [step, setStep] = useState<MathExamStep>(1);
  const [selectedCodeTab, setSelectedCodeTab] = useState<string>('');
  const [compareCodeTab, setCompareCodeTab] = useState<string>('');
  const [step4ViewMode, setStep4ViewMode] = useState<
    'compare' | 'compare-codes' | 'answer-matrix'
  >('compare');
  const [codeBatchPage, setCodeBatchPage] = useState<number>(0);
  const [mixErrors, setMixErrors] = useState<string[]>([]);
  const [mixWarnings, setMixWarnings] = useState<string[]>([]);
  const [mixProgress, setMixProgress] = useState<{ done: number; total: number } | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [lastExportIntegrity, setLastExportIntegrity] =
    useState<ExportIntegrityResult | null>(null);
  const mixAbortRef = useRef<AbortController | null>(null);
  const tutorial = useOptionalTutorial();

  useEffect(() => {
    return () => {
      mixAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (tutorial?.activeTutorial?.tutorialId !== 'tutorial.math-mixer') return;
    const sid = tutorial.currentStep?.stepId;
    if (
      (sid === 'math-step-overview' ||
        sid === 'math-subject-profile' ||
        sid === 'math-import-source' ||
        sid === 'math-lock-controls') &&
      step !== 1
    ) {
      setStep(1);
    } else if (sid === 'math-confirm-step' && step !== 2) {
      setStep(2);
    } else if (sid === 'math-mix-rules' && step !== 3) {
      setStep(3);
    } else if (sid === 'math-compare-codes' && step !== 4) {
      setStep(4);
    } else if (
      (sid === 'math-verify-export' || sid === 'math-export-formats') &&
      step !== 5
    ) {
      setStep(5);
    }
  }, [step, tutorial?.activeTutorial?.tutorialId, tutorial?.currentStep?.stepId]);

  const activeExam = useMemo(
    () =>
      mathExams.find((e) => e.id === selectedExamId) ??
      mathExams[0] ??
      null,
    [mathExams, selectedExamId]
  );

  useEffect(() => {
    setLastExportIntegrity(null);
  }, [activeExam?.id, activeExam?.generatedVersions.length]);

  const activeSubjectProfile = useMemo(
    () =>
      activeExam
        ? getSubjectProfile(resolveSubjectId(activeExam.subjectId || activeExam.subject))
        : getSubjectProfile('toan'),
    [activeExam]
  );

  const originalIssues = useMemo(
    () => (activeExam ? auditOriginalExamIntegrity(activeExam) : []),
    [activeExam]
  );

  const configIssues = useMemo(
    () => (activeExam ? validateMixConfiguration(activeExam) : []),
    [activeExam]
  );

  const lockStats = useMemo(
    () => (activeExam ? computeLockStats(activeExam) : null),
    [activeExam]
  );

  const maxDistinctPerms = useMemo(
    () => (activeExam ? estimateMaxDistinctPermutations(activeExam) : 1),
    [activeExam]
  );

  const preMixReport = useMemo(
    () => (activeExam ? evaluatePreMixIntegrity(activeExam) : null),
    [activeExam]
  );

  const exportGate = useMemo(
    () => (activeExam ? checkExamExportGate(activeExam) : null),
    [activeExam]
  );

  const handleExamChange = (next: MathExamProject) => {
    void onSaveMathExam(next, true);
  };

  const handleCreateExam = async () => {
    const fresh = createEmptyMathExamProject(createId);
    const saved = await onSaveMathExam(fresh, true);
    setSelectedExamId(saved.id);
    setStep(1);
    setMixErrors([]);
    setMixWarnings([]);
    setLastExportIntegrity(null);
    onShowToast('success', 'Đã tạo đề kiểm tra mới.');
  };

  const handleRunShuffle = async () => {
    if (!activeExam) return;
    if (!activeExam.confirmedOriginalAnswers) {
      setMixErrors([
        'Chưa xác nhận đáp án gốc ở Bước 2. Vui lòng rà soát và xác nhận đáp án trước khi trộn đề.',
      ]);
      setStep(2);
      return;
    }

    mixAbortRef.current?.abort();
    const controller = new AbortController();
    mixAbortRef.current = controller;
    const totalTarget = Math.max(1, activeExam.mixConfig.examCount || 4);
    setMixProgress({ done: 0, total: totalTarget });

    try {
      const res = await generateMixedExamsAsync(activeExam, {
        chunkSize: 5,
        signal: controller.signal,
        onProgress: (done, total) => setMixProgress({ done, total }),
      });

      if (res.cancelled) {
        onShowToast('info', 'Đã hủy quá trình trộn đề hàng loạt.');
        return;
      }

      setMixErrors(res.errors);
      setMixWarnings(res.warnings);

      if (res.errors.length > 0) {
        onShowToast('error', res.errors[0]);
        return;
      }

      const updated: MathExamProject = {
        ...activeExam,
        generatedVersions: res.versions,
        lastIntegrityReport: preMixReport ?? undefined,
        lastStep: 4,
        status: 'ready',
        updatedAt: new Date().toISOString(),
      };
      await onSaveMathExam(updated, true);
      setSelectedCodeTab(res.versions[0]?.code ?? '');
      setCompareCodeTab(res.versions[1]?.code ?? res.versions[0]?.code ?? '');
      setCodeBatchPage(0);
      setLastExportIntegrity(null);
      setStep(4);
      onShowToast(
        'success',
        `Đã tạo và kiểm chứng toàn vẹn ${res.versions.length} mã đề (${activeSubjectProfile.name}).`
      );
    } finally {
      setMixProgress(null);
      if (mixAbortRef.current === controller) {
        mixAbortRef.current = null;
      }
    }
  };

  const handleReverifyVersions = async () => {
    if (!activeExam || activeExam.generatedVersions.length === 0) return;
    const snap = createOriginalExamSnapshot(activeExam);
    const verifiedVersions = activeExam.generatedVersions.map((ver) => {
      const check = verifyMixedExamIntegrity(activeExam, ver, snap);
      return {
        ...ver,
        integrityPassed: check.passed,
        integrityStatus: check.status,
        integrityReport: check.report,
      };
    });
    const blockedCount = verifiedVersions.filter(
      (v) => !v.integrityPassed || v.integrityStatus === 'BLOCKED'
    ).length;
    await onSaveMathExam(
      {
        ...activeExam,
        generatedVersions: verifiedVersions,
        updatedAt: new Date().toISOString(),
      },
      true
    );
    if (blockedCount > 0) {
      onShowToast(
        'error',
        `Phát hiện ${blockedCount} mã đề có lỗi BLOCKED — hệ thống đã chặn xuất đề.`
      );
    } else {
      onShowToast(
        'success',
        `Đã kiểm tra lại ${verifiedVersions.length} mã đề: toàn bộ dữ liệu nguyên vẹn.`
      );
    }
  };

  const handleExportMixedBundleJson = () => {
    if (!activeExam || activeExam.generatedVersions.length === 0) return;
    if (!exportGate?.canExport) {
      onShowToast(
        'error',
        exportGate?.blockingReasons[0] ?? 'Xuất đề bị chặn do phát hiện lỗi toàn vẹn BLOCKED.'
      );
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      title: activeExam.title,
      subject: activeSubjectProfile.name,
      subjectId: activeSubjectProfile.id,
      grade: activeExam.grade,
      durationMinutes: activeExam.durationMinutes,
      versions: activeExam.generatedVersions.map((v) => ({
        code: v.code,
        integrityStatus: v.integrityStatus ?? 'PASS',
        answerKeyRows: v.answerKeyRows,
        questions: v.questions,
      })),
    };
    triggerBlobDownload(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      }),
      `exam-codes-${activeExam.id}.json`
    );
    onShowToast('success', 'Đã xuất tệp JSON bộ mã đề đã kiểm chứng.');
  };

  const handleExportZipBundle = async () => {
    if (!activeExam || !exportGate?.canExport) {
      onShowToast(
        'error',
        exportGate?.blockingReasons[0] ?? 'Xuất đề bị chặn do phát hiện lỗi toàn vẹn BLOCKED.'
      );
      return;
    }
    setExportBusy('zip');
    try {
      const { zipBytes, fileName, integrity } = await exportMixedExamZipBundle(activeExam);
      setLastExportIntegrity(integrity);
      const bufferCopy = new Uint8Array(zipBytes).buffer;
      triggerBlobDownload(new Blob([bufferCopy], { type: 'application/zip' }), fileName);
      onShowToast(
        'success',
        `Đã xuất & kiểm chứng ngược gói ZIP (${integrity.verifiedCodes.length} mã đề + đáp án DOCX/CSV).`
      );
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Không thể đóng gói tệp ZIP xuất đề.'
      );
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportSingleDocx = async (code: string) => {
    if (!activeExam || !exportGate?.canExport) {
      onShowToast(
        'error',
        exportGate?.blockingReasons[0] ?? 'Xuất DOCX bị chặn do lỗi toàn vẹn BLOCKED.'
      );
      return;
    }
    const ver = activeExam.generatedVersions.find((v) => v.code === code);
    if (!ver) return;
    setExportBusy(`docx-${ver.code}`);
    try {
      const bytes = await buildStudentExamDocxBuffer(activeExam, ver);
      const check = await verifyExportedDocxBuffer(bytes, ver, activeExam);
      if (!check.passed) {
        onShowToast(
          'error',
          check.issues[0]?.message ?? `Kiểm chứng DOCX Mã ${ver.code} không đạt.`
        );
        return;
      }
      const bufferCopy = new Uint8Array(bytes).buffer;
      triggerBlobDownload(
        new Blob([bufferCopy], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        `Ma_de_${ver.code}.docx`
      );
      onShowToast(
        'success',
        `Đã xuất & kiểm chứng sạch Mã đề ${ver.code}.docx (0% rò rỉ đáp án).`
      );
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Không thể tạo tệp Word (.docx).'
      );
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportAnswerKeyDocx = async () => {
    if (!activeExam || !exportGate?.canExport) {
      onShowToast(
        'error',
        exportGate?.blockingReasons[0] ?? 'Xuất Đáp án DOCX bị chặn do lỗi toàn vẹn BLOCKED.'
      );
      return;
    }
    setExportBusy('answer-docx');
    try {
      const bytes = await buildAnswerKeyDocxBuffer(activeExam);
      const bufferCopy = new Uint8Array(bytes).buffer;
      triggerBlobDownload(
        new Blob([bufferCopy], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        `Dap_an_va_Anh_xa_${activeExam.id}.docx`
      );
      onShowToast('success', 'Đã xuất file Word Đáp án tổng hợp & Bảng ánh xạ.');
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Không thể tạo file Đáp án DOCX.'
      );
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportAnswerCsv = () => {
    if (!activeExam || !exportGate?.canExport) {
      onShowToast(
        'error',
        exportGate?.blockingReasons[0] ?? 'Xuất CSV bị chặn do lỗi toàn vẹn BLOCKED.'
      );
      return;
    }
    const csv = buildConsolidatedAnswerCsv(activeExam);
    triggerBlobDownload(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `Bang_dap_an_${activeExam.id}.csv`
    );
    onShowToast('success', 'Đã xuất bảng đáp án CSV (hỗ trợ chấm trắc nghiệm/Excel).');
  };

  if (!activeExam) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center space-y-3">
          <h1 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
            Exam Mixer Pro 6.0 — Chưa có đề thi nào
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Khởi tạo đề kiểm tra đa môn (Toán, Lý, Hóa, Sinh, Văn, Anh, Sử, Địa, GDKT&amp;PL, Tin, Công nghệ...) bảo toàn nguyên vẹn công thức và đáp án gốc.
          </p>
          <Button variant="primary" onClick={() => void handleCreateExam()}>
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            <span>Tạo đề kiểm tra mới</span>
          </Button>
        </div>
      </main>
    );
  }

  const activeVersion =
    activeExam.generatedVersions.find((v) => v.code === selectedCodeTab) ??
    activeExam.generatedVersions[0] ??
    null;

  const compareVersionB =
    activeExam.generatedVersions.find((v) => v.code === compareCodeTab) ??
    activeExam.generatedVersions[1] ??
    activeExam.generatedVersions[0] ??
    null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <div className="no-print space-y-6">
        <ContextualAcademyBar
          tutorialId="tutorial.math-mixer"
          label="Exam Mixer Pro 6.0"
          description="Trộn đề đa môn 10 dạng câu hỏi với Hồ sơ môn học, khóa 5 lớp và xuất DOCX/ZIP/PDF đã kiểm chứng toàn vẹn."
        />

        <PageBanner
          tourId="math-header"
          title="Exam Mixer Pro 6.0"
          subtitle={`Đang mở: ${activeSubjectProfile.name} · Hoán vị khối dữ liệu bất biến theo ID · Xuất DOCX, ZIP & PDF A4 đã kiểm chứng toàn vẹn.`}
          icon={<Shuffle className="h-5 w-5" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleCreateExam()}
            >
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Đề mới</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onDuplicateMathExam(activeExam)}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Nhân bản</span>
            </Button>

            {tutorial && (
              <Button
                variant="secondary"
                size="sm"
                data-tour-id="math-help-btn"
                onClick={() =>
                  tutorial.startTutorial('tutorial.math-mixer', { restart: true })
                }
                aria-label="Hướng dẫn sử dụng Math Exam Mixer Pro"
              >
                <HelpCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Hướng dẫn</span>
              </Button>
            )}

            {mathExams.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const nextTarget = mathExams.find((e) => e.id !== activeExam.id);
                  void onDeleteMathExam(activeExam.id);
                  if (nextTarget) setSelectedExamId(nextTarget.id);
                }}
                aria-label="Xóa đề Toán hiện tại"
                className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="math-exam-select"
              className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              Đề kiểm tra đang mở:
            </label>
            <select
              id="math-exam-select"
              aria-label="Chọn đề thi Toán"
              value={activeExam.id}
              onChange={(e) => {
                setSelectedExamId(e.target.value);
                setMixErrors([]);
                setMixWarnings([]);
              }}
              className="w-full max-w-md rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
            >
              {mathExams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} ({ex.questions.length} câu)
                </option>
              ))}
            </select>
          </div>

          {/* 5-Step Progress Strip */}
          <nav
            aria-label="Quy trình 5 bước trộn đề Toán"
            data-tour-id="math-step-tabs"
            className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-3 border-t border-slate-100 dark:border-slate-800"
          >
            {STEP_TABS.map((item) => {
              const active = step === item.step;
              return (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => {
                    setStep(item.step);
                    tutorial?.emitTutorialEvent('math-step-nav-clicked');
                  }}
                  className={`rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors whitespace-nowrap truncate ${
                    active
                      ? 'border-blue-600 bg-blue-600 dark:bg-blue-600 text-white'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </PageBanner>
      </div>

      {/* Step 1 & Step 2 */}
      {(step === 1 || step === 2) && (
        <MathExamEditor
          exam={activeExam}
          stepMode={step}
          integrityIssues={originalIssues}
          onChangeExam={handleExamChange}
          onGoToStep={setStep}
        />
      )}

      {/* Step 3: Mix Rules Configuration */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Mix Levels 0-4 */}
            <section
              data-tour-id="math-mix-levels"
              className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
            >
              <div>
                <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                  Bước 3: Thiết lập mức độ &amp; quy tắc trộn đề
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Chọn mức trộn 0–4 phù hợp với ma trận kiểm tra. Thuật toán Fisher–Yates xác định theo seed.
                </p>
              </div>

              <div className="space-y-2">
                {MIX_LEVEL_DESCRIPTIONS.map((item) => {
                  const selected = activeExam.mixConfig.level === item.level;
                  return (
                    <button
                      key={item.level}
                      type="button"
                      onClick={() => {
                        const nextMatrixRules =
                          item.level === 3 && activeExam.mixConfig.matrixRules.length === 0
                            ? buildDefaultMatrixRules(activeExam.questions)
                            : activeExam.mixConfig.matrixRules;
                        handleExamChange({
                          ...activeExam,
                          mixConfig: {
                            ...activeExam.mixConfig,
                            level: item.level as MixLevel,
                            matrixRules: nextMatrixRules,
                          },
                        });
                      }}
                      className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                        selected
                          ? 'border-blue-600 dark:border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-950 dark:text-slate-50">
                          {item.title}
                        </span>
                        {selected && (
                          <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                            Đang chọn
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        {item.summary}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Level 3 Matrix Editor */}
              {activeExam.mixConfig.level === 3 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Bảng Ma trận đề (Rút câu theo dạng · mức nhận thức · chuyên đề)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: {
                              ...activeExam.mixConfig,
                              matrixRules: buildDefaultMatrixRules(activeExam.questions),
                            },
                          })
                        }
                        className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200"
                      >
                        Nạp từ đề gốc
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: {
                              ...activeExam.mixConfig,
                              matrixRules: [
                                ...activeExam.mixConfig.matrixRules,
                                {
                                  id: createId('mat'),
                                  type: 'mcq',
                                  topic: 'Tất cả',
                                  cognitiveLevel: 'thong-hieu',
                                  count: 1,
                                },
                              ],
                            },
                          })
                        }
                        className="rounded bg-blue-900 dark:bg-blue-700 px-2.5 py-1 text-[11px] font-medium text-white"
                      >
                        + Thêm dòng
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {activeExam.mixConfig.matrixRules.map((rule) => (
                      <div
                        key={rule.id}
                        className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                      >
                        <select
                          aria-label="Dạng câu ma trận"
                          value={rule.universalType ?? rule.type}
                          onChange={(e) => {
                            const selectedUType = e.target.value as UniversalQuestionType;
                            const mappedBase: MathQuestionType =
                              selectedUType === 'mcq' ||
                              selectedUType === 'multi-select' ||
                              selectedUType === 'reading-comprehension' ||
                              selectedUType === 'shared-context'
                                ? 'mcq'
                                : selectedUType === 'true-false'
                                ? 'true-false'
                                : selectedUType === 'essay'
                                ? 'essay'
                                : 'short-answer';
                            handleExamChange({
                              ...activeExam,
                              mixConfig: {
                                ...activeExam.mixConfig,
                                matrixRules: activeExam.mixConfig.matrixRules.map((r) =>
                                  r.id === rule.id
                                    ? { ...r, type: mappedBase, universalType: selectedUType }
                                    : r
                                ),
                              },
                            });
                          }}
                          className="sm:col-span-3 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
                        >
                          {Object.entries(UNIVERSAL_QUESTION_TYPE_LABELS).map(([k, lbl]) => (
                            <option key={k} value={k}>
                              {lbl}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Mức nhận thức ma trận"
                          value={rule.cognitiveLevel}
                          onChange={(e) =>
                            handleExamChange({
                              ...activeExam,
                              mixConfig: {
                                ...activeExam.mixConfig,
                                matrixRules: activeExam.mixConfig.matrixRules.map((r) =>
                                  r.id === rule.id
                                    ? { ...r, cognitiveLevel: e.target.value as CognitiveLevel }
                                    : r
                                ),
                              },
                            })
                          }
                          className="sm:col-span-3 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
                        >
                          {Object.entries(COGNITIVE_LEVEL_LABELS).map(([k, lbl]) => (
                            <option key={k} value={k}>
                              {lbl}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Chuyên đề ma trận"
                          value={rule.topic}
                          onChange={(e) =>
                            handleExamChange({
                              ...activeExam,
                              mixConfig: {
                                ...activeExam.mixConfig,
                                matrixRules: activeExam.mixConfig.matrixRules.map((r) =>
                                  r.id === rule.id ? { ...r, topic: e.target.value } : r
                                ),
                              },
                            })
                          }
                          className="sm:col-span-3 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
                        >
                          <option value="Tất cả">Tất cả chuyên đề</option>
                          {Array.from(
                            new Set([
                              ...activeExam.questions.map((q) => q.topic).filter(Boolean),
                              ...(activeSubjectProfile.id === 'toan' ? MATH_TOPICS : []),
                            ])
                          ).map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          aria-label="Số câu ma trận"
                          value={rule.count}
                          onChange={(e) =>
                            handleExamChange({
                              ...activeExam,
                              mixConfig: {
                                ...activeExam.mixConfig,
                                matrixRules: activeExam.mixConfig.matrixRules.map((r) =>
                                  r.id === rule.id
                                    ? { ...r, count: Math.max(0, Number(e.target.value) || 0) }
                                    : r
                                ),
                              },
                            })
                          }
                          className="sm:col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-mono-num"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            handleExamChange({
                              ...activeExam,
                              mixConfig: {
                                ...activeExam.mixConfig,
                                matrixRules: activeExam.mixConfig.matrixRules.filter(
                                  (r) => r.id !== rule.id
                                ),
                              },
                            })
                          }
                          className="sm:col-span-1 text-xs text-slate-400 hover:text-red-600 text-center"
                          title="Xóa dòng ma trận"
                        >
                          <Trash2 className="h-3.5 w-3.5 mx-auto" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Level 4 Granular Rules */}
              {activeExam.mixConfig.level === 4 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 space-y-2.5 text-xs">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Công tắc quy tắc tùy chỉnh sâu (Mức 4)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeExam.mixConfig.shuffleQuestions}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: {
                              ...activeExam.mixConfig,
                              shuffleQuestions: e.target.checked,
                            },
                          })
                        }
                      />
                      <span>Trộn thứ tự câu hỏi</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeExam.mixConfig.shuffleMcqOptions}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: {
                              ...activeExam.mixConfig,
                              shuffleMcqOptions: e.target.checked,
                            },
                          })
                        }
                      />
                      <span>Trộn phương án A/B/C/D</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeExam.mixConfig.keepVdcPositions}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: {
                              ...activeExam.mixConfig,
                              keepVdcPositions: e.target.checked,
                            },
                          })
                        }
                      />
                      <span>Giữ nguyên vị trí câu Vận dụng cao</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeExam.mixConfig.shufflePerSectionOnly}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: {
                              ...activeExam.mixConfig,
                              shufflePerSectionOnly: e.target.checked,
                            },
                          })
                        }
                      />
                      <span>Chỉ trộn bên trong từng phần I/II/III/IV</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={activeExam.mixConfig.shuffleIndependentTrueFalseStatements}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: {
                              ...activeExam.mixConfig,
                              shuffleIndependentTrueFalseStatements: e.target.checked,
                            },
                          })
                        }
                      />
                      <span>
                        Cho phép đảo ý a/b/c/d ở câu Đúng/Sai đã bật cờ độc lập (tự chặn ý tham chiếu)
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Subject Profile Overrides Card */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-3.5 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    <span>Tùy chỉnh Hồ sơ môn {activeSubjectProfile.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleExamChange({
                        ...activeExam,
                        subjectProfileOverrides: undefined,
                      })
                    }
                    className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    Khôi phục mặc định môn
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        activeExam.subjectProfileOverrides?.shufflePerSectionOnly ??
                        activeSubjectProfile.defaultMixPolicy.shufflePerSectionOnly
                      }
                      onChange={(e) =>
                        handleExamChange({
                          ...activeExam,
                          subjectProfileOverrides: {
                            ...(activeExam.subjectProfileOverrides ?? {}),
                            shufflePerSectionOnly: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>Chỉ trộn nội bộ từng Phần/Section</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        activeExam.subjectProfileOverrides?.lockSharedPassageGroups ??
                        activeSubjectProfile.defaultMixPolicy.lockSharedPassageGroups
                      }
                      onChange={(e) =>
                        handleExamChange({
                          ...activeExam,
                          subjectProfileOverrides: {
                            ...(activeExam.subjectProfileOverrides ?? {}),
                            lockSharedPassageGroups: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>Khóa nhóm ngữ liệu đọc hiểu / thí nghiệm</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        activeExam.subjectProfileOverrides?.detectEnglishDependentOptions ??
                        activeSubjectProfile.answerConstraints.detectEnglishDependentOptions
                      }
                      onChange={(e) =>
                        handleExamChange({
                          ...activeExam,
                          subjectProfileOverrides: {
                            ...(activeExam.subjectProfileOverrides ?? {}),
                            detectEnglishDependentOptions: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>Chặn trộn phương án phụ thuộc (All/Both/None)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        activeExam.subjectProfileOverrides?.preserveLineBreaksInPoetryOrCode ??
                        activeSubjectProfile.presentationRules.preserveLineBreaksInPoetryOrCode
                      }
                      onChange={(e) =>
                        handleExamChange({
                          ...activeExam,
                          subjectProfileOverrides: {
                            ...(activeExam.subjectProfileOverrides ?? {}),
                            preserveLineBreaksInPoetryOrCode: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>Giữ nguyên ngắt dòng thơ / thụt lề code</span>
                  </label>
                </div>
              </div>
            </section>

            {/* Right: Exam Codes, Seed, Validation & Trigger */}
            <section className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  Cấu hình số mã đề &amp; Seed ngẫu nhiên
                </h3>

                <div className="space-y-2">
                  <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Số mã đề cần tạo
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {EXAM_CODE_PRESETS.map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: { ...activeExam.mixConfig, examCount: cnt },
                          })
                        }
                        className={`rounded-[10px] border px-3 py-1.5 text-xs font-mono-num font-medium transition-colors ${
                          activeExam.mixConfig.examCount === cnt
                            ? 'border-blue-600 bg-blue-600 dark:bg-blue-600 text-white'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {cnt} mã
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="mix-custom-count"
                      className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                    >
                      Số mã đề tùy chỉnh (1–{MAX_EXAM_CODES})
                    </label>
                    <input
                      id="mix-custom-count"
                      type="number"
                      min={1}
                      max={MAX_EXAM_CODES}
                      value={activeExam.mixConfig.examCount}
                      onChange={(e) =>
                        handleExamChange({
                          ...activeExam,
                          mixConfig: {
                            ...activeExam.mixConfig,
                            examCount: Math.max(
                              1,
                              Math.min(MAX_EXAM_CODES, Number(e.target.value) || 1)
                            ),
                          },
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono-num"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="mix-start-code"
                      className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                    >
                      Mã đề bắt đầu
                    </label>
                    <input
                      id="mix-start-code"
                      type="number"
                      min={1}
                      max={9999}
                      value={activeExam.mixConfig.startCodeNumber}
                      onChange={(e) =>
                        handleExamChange({
                          ...activeExam,
                          mixConfig: {
                            ...activeExam.mixConfig,
                            startCodeNumber: Math.max(1, Number(e.target.value) || 101),
                          },
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono-num"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="mix-custom-names"
                    className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                  >
                    Hoặc nhập tên mã đề riêng (cách nhau bởi dấu phẩy, tùy chọn)
                  </label>
                  <input
                    id="mix-custom-names"
                    type="text"
                    value={activeExam.mixConfig.customCodeNames.join(', ')}
                    onChange={(e) =>
                      handleExamChange({
                        ...activeExam,
                        mixConfig: {
                          ...activeExam.mixConfig,
                          customCodeNames: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                    placeholder="VD: 101, 102, 103, 104"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="mix-seed-input"
                      className="text-[11px] font-medium text-slate-500 dark:text-slate-400"
                    >
                      Seed xác định (tái tạo lại đúng bộ mã đề)
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        handleExamChange({
                          ...activeExam,
                          mixConfig: {
                            ...activeExam.mixConfig,
                            seed: `seed-${Date.now().toString(36)}`,
                          },
                        })
                      }
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-900 dark:text-blue-400 hover:underline"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                      <span>Đổi seed mới</span>
                    </button>
                  </div>
                  <input
                    id="mix-seed-input"
                    type="text"
                    value={activeExam.mixConfig.seed}
                    onChange={(e) =>
                      handleExamChange({
                        ...activeExam,
                        mixConfig: { ...activeExam.mixConfig, seed: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>

                {/* Math Lock Summary Card */}
                {lockStats && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                        Tóm tắt quy tắc Math Lock
                      </span>
                      <span className="font-mono-num text-[11px] text-slate-600 dark:text-slate-400">
                        Tối đa ~{maxDistinctPerms >= 100000 ? '100.000+' : maxDistinctPerms.toLocaleString('vi-VN')} hoán vị
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 font-mono-num text-[11px] text-slate-600 dark:text-slate-400">
                      <span>Câu khóa: {lockStats.lockedQuestions}/{lockStats.totalQuestions}</span>
                      <span>Phương án khóa: {lockStats.lockedOptions}</span>
                      <span>Nhóm: {(activeExam.questionGroups ?? []).length}</span>
                      <span>Hình/BBT: {lockStats.visualAssetsCount}</span>
                    </div>
                  </div>
                )}

                {/* Live Validation Notices (BLOCKED vs WARNING) */}
                {(configIssues.length > 0 || mixErrors.length > 0) && (() => {
                  const blockingMsgs = Array.from(
                    new Set([
                      ...mixErrors,
                      ...configIssues.filter((i) => i.severity === 'error').map((i) => i.message),
                    ])
                  );
                  const warnMsgs = Array.from(
                    new Set(
                      configIssues.filter((i) => i.severity === 'warning').map((i) => i.message)
                    )
                  );
                  return (
                    <div className="space-y-2">
                      {blockingMsgs.length > 0 && (
                        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50/80 dark:bg-red-950/50 p-3 space-y-1 text-xs text-red-900 dark:text-red-200">
                          <div className="font-semibold flex items-center gap-1.5">
                            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>BLOCKED · Lỗi chặn trộn đề ({blockingMsgs.length})</span>
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {blockingMsgs.slice(0, 5).map((msg, idx) => (
                              <li key={idx}>{msg}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {warnMsgs.length > 0 && (
                        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 p-3 space-y-1 text-xs text-amber-950 dark:text-amber-200">
                          <div className="font-semibold flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>WARNING · Lưu ý an toàn ({warnMsgs.length})</span>
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {warnMsgs.slice(0, 4).map((msg, idx) => (
                              <li key={idx}>{msg}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {mixProgress && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/40 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-blue-900 dark:text-blue-200">
                      Đang sinh &amp; kiểm chứng toàn vẹn: {mixProgress.done}/{mixProgress.total} mã đề...
                    </span>
                    <button
                      type="button"
                      onClick={() => mixAbortRef.current?.abort()}
                      className="inline-flex items-center gap-1 rounded border border-red-300 dark:border-red-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300"
                    >
                      <XCircle className="h-3 w-3" aria-hidden="true" />
                      <span>Hủy trộn</span>
                    </button>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900">
                    <div
                      className="h-full bg-blue-600 transition-all"
                      style={{
                        width: `${Math.round((mixProgress.done / Math.max(1, mixProgress.total)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-[10px] border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  Quay lại Bước 2
                </button>
                <button
                  type="button"
                  disabled={
                    Boolean(mixProgress) || configIssues.some((i) => i.severity === 'error')
                  }
                  onClick={() => void handleRunShuffle()}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {mixProgress ? 'Đang xử lý hàng loạt...' : 'Trộn đề & Kiểm chứng toàn vẹn'}
                  </span>
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Step 4: Inspect Generated Exam Codes & Permutation Map */}
      {step === 4 && (
        <div className="space-y-4">
          {activeExam.generatedVersions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Chưa có mã đề nào được sinh từ bộ đề này.
              </p>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sang Bước 3 thiết lập và trộn đề</span>
              </button>
            </div>
          ) : (
            <>
              {/* Toolbar selecting Exam Code + View Mode */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 mr-1">
                    Chọn mã đề ({activeExam.generatedVersions.length}):
                  </span>
                  {activeExam.generatedVersions.length <= 16 ? (
                    activeExam.generatedVersions.map((ver) => {
                      const isSel = activeVersion?.code === ver.code;
                      const vStatus =
                        ver.integrityStatus ?? (ver.integrityPassed ? 'PASS' : 'BLOCKED');
                      return (
                        <button
                          key={ver.code}
                          type="button"
                          onClick={() => setSelectedCodeTab(ver.code)}
                          className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-mono-num font-semibold whitespace-nowrap ${
                            isSel
                              ? 'border-blue-600 bg-blue-600 dark:bg-blue-600 text-white'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span>Mã {ver.code}</span>
                          {vStatus === 'PASS' ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                          ) : vStatus === 'WARNING' ? (
                            <AlertTriangle className="h-3 w-3 text-amber-400" aria-hidden="true" />
                          ) : (
                            <ShieldAlert className="h-3 w-3 text-red-400" aria-hidden="true" />
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Chọn mã đề kiểm tra"
                        value={activeVersion?.code ?? ''}
                        onChange={(e) => setSelectedCodeTab(e.target.value)}
                        className="rounded-[10px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-mono-num font-semibold text-slate-900 dark:text-slate-100"
                      >
                        {activeExam.generatedVersions.map((ver) => {
                          const vStatus =
                            ver.integrityStatus ?? (ver.integrityPassed ? 'PASS' : 'BLOCKED');
                          return (
                            <option key={ver.code} value={ver.code}>
                              Mã {ver.code} · {vStatus}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const curIdx = activeExam.generatedVersions.findIndex(
                            (v) => v.code === activeVersion?.code
                          );
                          const prevIdx =
                            (curIdx - 1 + activeExam.generatedVersions.length) %
                            activeExam.generatedVersions.length;
                          setSelectedCodeTab(activeExam.generatedVersions[prevIdx]?.code ?? '');
                        }}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        ‹ Trước
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const curIdx = activeExam.generatedVersions.findIndex(
                            (v) => v.code === activeVersion?.code
                          );
                          const nextIdx =
                            (curIdx + 1) % activeExam.generatedVersions.length;
                          setSelectedCodeTab(activeExam.generatedVersions[nextIdx]?.code ?? '');
                        }}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Sau ›
                      </button>
                      <span className="text-[11px] font-mono-num text-emerald-700 dark:text-emerald-400">
                        {
                          activeExam.generatedVersions.filter((v) => v.integrityPassed)
                            .length
                        }
                        /{activeExam.generatedVersions.length} mã đạt
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep4ViewMode('compare')}
                    className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                      step4ViewMode === 'compare'
                        ? 'border-slate-900 dark:border-slate-200 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Đề gốc ↔ Mã {activeVersion?.code}
                  </button>
                  {activeExam.generatedVersions.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => setStep4ViewMode('compare-codes')}
                      className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                        step4ViewMode === 'compare-codes'
                          ? 'border-slate-900 dark:border-slate-200 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      So sánh 2 mã đề
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep4ViewMode('answer-matrix')}
                    className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                      step4ViewMode === 'answer-matrix'
                        ? 'border-slate-900 dark:border-slate-200 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Bảng đáp án tổng hợp
                  </button>
                </div>
              </div>

              {(mixWarnings.length > 0 || (activeVersion && activeVersion.integrityWarnings.length > 0)) && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 p-3.5 text-xs text-amber-950 dark:text-amber-200 space-y-1">
                  <div className="font-semibold">Lưu ý bảo vệ cấu trúc khi trộn đề:</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {Array.from(
                      new Set([
                        ...mixWarnings,
                        ...(activeVersion?.integrityWarnings ?? []),
                      ])
                    ).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {step4ViewMode === 'compare-codes' && activeVersion && compareVersionB ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Đối chiếu song song hai mã đề đã sinh:
                      </span>
                      <span className="font-mono-num font-bold text-blue-700 dark:text-blue-400">
                        Mã {activeVersion.code}
                      </span>
                      <span>↔</span>
                      <select
                        aria-label="Chọn mã đề đối chiếu thứ hai"
                        value={compareVersionB.code}
                        onChange={(e) => setCompareCodeTab(e.target.value)}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono-num font-semibold"
                      >
                        {activeExam.generatedVersions.map((ver) => (
                          <option key={ver.code} value={ver.code}>
                            Mã {ver.code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="font-mono-num text-[11px] text-slate-500">
                      Cùng ngân hàng {activeVersion.questions.length} câu · Độc lập thứ tự &amp; phương án
                    </span>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
                    <div className="px-4 py-3 bg-slate-50/70 dark:bg-slate-800/50 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <div className="lg:col-span-6">Mã đề {activeVersion.code}</div>
                      <div className="lg:col-span-6">Mã đề {compareVersionB.code}</div>
                    </div>
                    {activeVersion.questions.map((qA, idx) => {
                      const qB = compareVersionB.questions[idx];
                      const ansA = activeVersion.answerKeyRows[idx]?.answer ?? '—';
                      const ansB = compareVersionB.answerKeyRows[idx]?.answer ?? '—';
                      return (
                        <div
                          key={`${activeVersion.code}-${compareVersionB.code}-${idx}`}
                          className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs"
                        >
                          <div className="lg:col-span-6 space-y-1.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono-num font-bold text-blue-900 dark:text-blue-300">
                                Câu {idx + 1} · ID {qA.code}
                              </span>
                              <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-300">
                                ĐA: {ansA}
                              </span>
                            </div>
                            <div className="text-slate-900 dark:text-slate-100">
                              <MathContentRenderer payload={qA.stem} />
                            </div>
                          </div>
                          <div className="lg:col-span-6 space-y-1.5 rounded-lg border border-blue-200/70 dark:border-blue-900/50 bg-white dark:bg-slate-900 p-3">
                            {qB ? (
                              <>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono-num font-bold text-blue-900 dark:text-blue-300">
                                    Câu {idx + 1} · ID {qB.code}
                                  </span>
                                  <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-300">
                                    ĐA: {ansB}
                                  </span>
                                </div>
                                <div className="text-slate-900 dark:text-slate-100">
                                  <MathContentRenderer payload={qB.stem} />
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : step4ViewMode === 'answer-matrix' ? (() => {
                const pageSize = 20;
                const allVersions = activeExam.generatedVersions;
                const totalPages = Math.max(1, Math.ceil(allVersions.length / pageSize));
                const safePage = Math.min(codeBatchPage, totalPages - 1);
                const pageVersions = allVersions.slice(
                  safePage * pageSize,
                  (safePage + 1) * pageSize
                );

                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                        Bảng đáp án đối chiếu tất cả mã đề (ánh xạ theo ID)
                      </h3>
                      <div className="flex flex-wrap items-center gap-2">
                        {totalPages > 1 && (
                          <div className="flex items-center gap-1">
                            {Array.from({ length: totalPages }, (_, pIdx) => (
                              <button
                                key={pIdx}
                                type="button"
                                onClick={() => setCodeBatchPage(pIdx)}
                                className={`rounded px-2 py-0.5 text-[11px] font-mono-num ${
                                  safePage === pIdx
                                    ? 'bg-blue-600 text-white'
                                    : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {pIdx * pageSize + 1}–{Math.min((pIdx + 1) * pageSize, allVersions.length)}
                              </button>
                            ))}
                          </div>
                        )}
                        <span className="font-mono-num text-xs text-slate-500">
                          {allVersions.length} mã đề
                        </span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                          <tr>
                            <th className="px-4 py-2.5 font-semibold w-16">Câu</th>
                            {pageVersions.map((ver) => (
                              <th key={ver.code} className="px-4 py-2.5 font-mono-num font-semibold">
                                Mã {ver.code}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {Array.from(
                            {
                              length: Math.max(
                                0,
                                ...pageVersions.map((v) => v.answerKeyRows.length)
                              ),
                            },
                            (_, rowIdx) => (
                              <tr key={rowIdx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                                <td className="px-4 py-2 font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                                  Câu {rowIdx + 1}
                                </td>
                                {pageVersions.map((ver) => {
                                  const cell = ver.answerKeyRows[rowIdx];
                                  return (
                                    <td key={ver.code} className="px-4 py-2 font-mono-num">
                                      {cell ? (
                                        <div>
                                          <span className="font-bold text-blue-900 dark:text-blue-300">
                                            {cell.answer}
                                          </span>
                                          <span className="ml-1.5 text-[10px] text-slate-400">
                                            ({cell.originalCode})
                                          </span>
                                        </div>
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })() : (
                activeVersion && (
                  <div className="space-y-4">
                    {/* Integrity Report Panel + Manual Re-Verify */}
                    {activeVersion.integrityReport ? (
                      <MathIntegrityReportPanel
                        report={activeVersion.integrityReport}
                        title={`Kiểm chứng Mã đề ${activeVersion.code} (Seed: ${activeExam.mixConfig.seed})`}
                        onManualCheck={() => void handleReverifyVersions()}
                        compact
                      />
                    ) : (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <ShieldCheck
                            className={`h-4 w-4 ${
                              activeVersion.integrityPassed
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="font-semibold text-slate-950 dark:text-slate-50">
                            Mã đề {activeVersion.code}:{' '}
                            {activeVersion.integrityPassed
                              ? 'Kiểm chứng toàn vẹn ĐẠT'
                              : 'Cảnh báo kiểm chứng không đạt'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleReverifyVersions()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Kiểm tra toàn vẹn</span>
                        </button>
                      </div>
                    )}

                    {/* Side-by-Side Original vs Mixed Question Inspection + Permutation Map */}
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
                      <div className="px-4 py-3 bg-slate-50/70 dark:bg-slate-800/50 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <div className="lg:col-span-5">Đề gốc (vị trí &amp; đáp án gốc)</div>
                        <div className="lg:col-span-2 text-center">Ánh xạ hoán vị</div>
                        <div className="lg:col-span-5">Mã đề {activeVersion.code} (bản sau trộn)</div>
                      </div>

                      {activeVersion.questions.map((mixedQ, idx) => {
                        const mapping = activeVersion.permutationMap[idx];
                        const origQ = activeExam.questions.find((o) => o.id === mixedQ.id);
                        const uType = getUniversalQuestionType(mixedQ);
                        const groupObj: QuestionGroup | undefined = mixedQ.groupId
                          ? (activeExam.questionGroups ?? []).find((g) => g.id === mixedQ.groupId)
                          : undefined;
                        return (
                          <div
                            key={`${activeVersion.code}-${mixedQ.id}`}
                            className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs"
                          >
                            {/* Original Question */}
                            <div className="lg:col-span-5 space-y-2 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono-num font-bold text-slate-700 dark:text-slate-200">
                                  Gốc Câu {mapping.originalOrderNumber} ({origQ?.code})
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {UNIVERSAL_QUESTION_TYPE_LABELS[uType]} ·{' '}
                                  {COGNITIVE_LEVEL_LABELS[mixedQ.cognitiveLevel]}
                                </span>
                              </div>
                              {groupObj && (
                                <div className="rounded bg-blue-50/70 dark:bg-blue-950/30 px-2 py-1 text-[11px] text-blue-900 dark:text-blue-200">
                                  Nhóm: {groupObj.title}
                                </div>
                              )}
                              <div className="text-slate-800 dark:text-slate-200">
                                {origQ && <MathContentRenderer payload={origQ.stem} />}
                              </div>
                              {origQ?.visualAssets && origQ.visualAssets.length > 0 && (
                                <div className="space-y-1.5 pt-1">
                                  {origQ.visualAssets.map((a) => (
                                    <MathVisualAssetRenderer key={a.id} asset={a} compact />
                                  ))}
                                </div>
                              )}
                              {uType === 'multi-select' && origQ && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1">
                                  {(origQ.multiSelectOptions ?? origQ.options ?? []).map((opt, oIdx) => (
                                    <div
                                      key={opt.id}
                                      className={`rounded px-2 py-1 ${
                                        opt.isCorrect
                                          ? 'bg-emerald-50 dark:bg-emerald-950/40 font-medium text-emerald-900 dark:text-emerald-200'
                                          : 'text-slate-600 dark:text-slate-400'
                                      }`}
                                    >
                                      <span className="font-mono-num font-bold mr-1">
                                        {getOptionLetterLabel(oIdx)}.
                                      </span>
                                      <MathContentRenderer payload={opt.content} />
                                    </div>
                                  ))}
                                </div>
                              )}
                              {uType !== 'multi-select' && origQ?.type === 'mcq' && origQ.options && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1">
                                  {origQ.options.map((opt) => (
                                    <div
                                      key={opt.id}
                                      className={`rounded px-2 py-1 ${
                                        opt.id === origQ.correctOptionId
                                          ? 'bg-emerald-50 dark:bg-emerald-950/40 font-medium text-emerald-900 dark:text-emerald-200'
                                          : 'text-slate-600 dark:text-slate-400'
                                      }`}
                                    >
                                      <span className="font-mono-num font-bold mr-1">
                                        {opt.originalLabel}.
                                        {opt.lockPosition ? ' [Khóa]' : ''}
                                      </span>
                                      <MathContentRenderer payload={opt.content} />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Mapping Arrow */}
                            <div className="lg:col-span-2 flex flex-col items-center justify-center text-center gap-1.5 py-2">
                              <ArrowLeftRight
                                className="h-4 w-4 text-blue-800 dark:text-blue-400"
                                aria-hidden="true"
                              />
                              <div className="font-mono-num text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                #{mapping.originalOrderNumber} → #{mapping.newOrderNumber}
                              </div>
                              <div className="font-mono-num text-[11px] font-semibold text-blue-900 dark:text-blue-300">
                                {mapping.exactAnswerSummary}
                              </div>
                              {mapping.optionPermutation && (
                                <div className="font-mono-num text-[10px] text-slate-500">
                                  {mapping.optionPermutation
                                    .map((p) => `${p.newLabel}←${p.originalLabel}`)
                                    .join(' ')}
                                </div>
                              )}
                              {mapping.lockedPositionApplied && (
                                <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                  Khóa vị trí
                                </span>
                              )}
                              {mapping.groupId && (
                                <span className="text-[10px] font-medium text-blue-800 dark:text-blue-300">
                                  Nhóm liên kết
                                </span>
                              )}
                            </div>

                            {/* Mixed Question */}
                            <div className="lg:col-span-5 space-y-2 rounded-lg border border-blue-200/80 dark:border-blue-900/60 bg-white dark:bg-slate-900 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono-num font-bold text-blue-950 dark:text-blue-200">
                                  Câu {mapping.newOrderNumber} (Mã {activeVersion.code})
                                </span>
                                <span className="font-mono-num text-[11px] text-slate-500">
                                  ID: {mixedQ.code}
                                </span>
                              </div>
                              <div className="text-slate-900 dark:text-slate-100">
                                <MathContentRenderer payload={mixedQ.stem} />
                              </div>
                              {mixedQ.visualAssets && mixedQ.visualAssets.length > 0 && (
                                <div className="space-y-1.5 pt-1">
                                  {mixedQ.visualAssets.map((a) => (
                                    <MathVisualAssetRenderer key={a.id} asset={a} compact />
                                  ))}
                                </div>
                              )}
                              {uType === 'multi-select' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1">
                                  {(mixedQ.multiSelectOptions ?? mixedQ.options ?? []).map((opt, oIdx) => (
                                    <div
                                      key={opt.id}
                                      className={`rounded px-2 py-1 ${
                                        opt.isCorrect
                                          ? 'bg-emerald-50 dark:bg-emerald-950/40 font-medium text-emerald-900 dark:text-emerald-200'
                                          : 'text-slate-700 dark:text-slate-300'
                                      }`}
                                    >
                                      <span className="font-mono-num font-bold mr-1">
                                        {getOptionLetterLabel(oIdx)}.
                                      </span>
                                      <MathContentRenderer payload={opt.content} />
                                    </div>
                                  ))}
                                </div>
                              )}
                              {uType !== 'multi-select' && mixedQ.type === 'mcq' && mixedQ.options && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1">
                                  {mixedQ.options.map((opt, oIdx) => {
                                    const newLbl = (['A', 'B', 'C', 'D'] as const)[oIdx];
                                    const isCorr = opt.id === mixedQ.correctOptionId;
                                    return (
                                      <div
                                        key={opt.id}
                                        className={`rounded px-2 py-1 ${
                                          isCorr
                                            ? 'bg-emerald-50 dark:bg-emerald-950/40 font-medium text-emerald-900 dark:text-emerald-200'
                                            : 'text-slate-700 dark:text-slate-300'
                                        }`}
                                      >
                                        <span className="font-mono-num font-bold mr-1">
                                          {newLbl}.
                                          {opt.lockPosition ? ' [Khóa]' : ''}
                                        </span>
                                        <MathContentRenderer payload={opt.content} />
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {mixedQ.type === 'true-false' && mixedQ.statements && (
                                <div className="space-y-1 pt-1">
                                  {mixedQ.statements.map((st, sIdx) => {
                                    const newLbl = (['a', 'b', 'c', 'd'] as const)[sIdx];
                                    return (
                                      <div key={st.id} className="flex items-start justify-between gap-2">
                                        <div>
                                          <span className="font-mono-num font-bold mr-1">
                                            {newLbl})
                                          </span>
                                          <MathContentRenderer payload={st.content} />
                                        </div>
                                        <span className="font-mono-num font-semibold shrink-0 text-blue-900 dark:text-blue-300">
                                          {st.isTrue ? 'Đ' : 'S'}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {uType === 'fill-blank' && mixedQ.fillBlank && (
                                <div className="space-y-1 pt-1 text-[11px]">
                                  <div className="font-mono-num text-emerald-800 dark:text-emerald-300">
                                    Đáp án chỗ trống:{' '}
                                    {mixedQ.fillBlank.slots
                                      .map((sl) => `(${sl.slotNumber}) ${sl.acceptedAnswers[0] ?? '?'}`)
                                      .join(' · ')}
                                  </div>
                                  {mixedQ.fillBlank.wordBank && mixedQ.fillBlank.wordBank.length > 0 && (
                                    <div className="text-slate-600 dark:text-slate-300">
                                      Word Bank:{' '}
                                      {mixedQ.fillBlank.wordBank
                                        .map((w, bIdx) => `${getOptionLetterLabel(bIdx)}. ${w.content.rawSource}`)
                                        .join(' · ')}
                                    </div>
                                  )}
                                </div>
                              )}
                              {uType === 'matching' && mixedQ.matching && (
                                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                                  <div className="space-y-0.5">
                                    {mixedQ.matching.leftItems.map((li, lIdx) => (
                                      <div key={li.id}>
                                        <span className="font-mono-num font-bold mr-1">
                                          {li.originalLabel || lIdx + 1}.
                                        </span>
                                        <MathContentRenderer payload={li.content} />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="space-y-0.5">
                                    {mixedQ.matching.rightItems.map((ri, rIdx) => (
                                      <div key={ri.id}>
                                        <span className="font-mono-num font-bold mr-1">
                                          {getStatementLetterLabel(rIdx)}.
                                        </span>
                                        <MathContentRenderer payload={ri.content} />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {uType === 'ordering' && mixedQ.ordering && (
                                <div className="space-y-0.5 pt-1 text-[11px]">
                                  {mixedQ.ordering.items.map((it, oIdx) => (
                                    <div key={it.id}>
                                      <span className="font-mono-num font-bold mr-1">
                                        {getStatementLetterLabel(oIdx)}.
                                      </span>
                                      <MathContentRenderer payload={it.content} />
                                    </div>
                                  ))}
                                </div>
                              )}
                              {mixedQ.type === 'short-answer' &&
                                uType !== 'fill-blank' &&
                                uType !== 'matching' &&
                                uType !== 'ordering' &&
                                mixedQ.shortAnswer && (
                                  <div className="pt-1 font-mono-num text-emerald-800 dark:text-emerald-300">
                                    Đáp án cố định: {mixedQ.shortAnswer.answerValue}{' '}
                                    {mixedQ.shortAnswer.unit}
                                  </div>
                                )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}

      {/* Step 5: Pre-Export Integrity Verification, Universal Export Hub & A4 Print Preview */}
      {step === 5 && (() => {
        const versions = activeExam.generatedVersions;
        const blockedVersion = versions.find(
          (v) =>
            !v.integrityPassed ||
            v.integrityStatus === 'BLOCKED' ||
            v.integrityReport?.canExport === false
        );
        const warningVersion = versions.find((v) => v.integrityStatus === 'WARNING');
        const exportReport: MathIntegrityReport | null =
          blockedVersion?.integrityReport ??
          warningVersion?.integrityReport ??
          versions[0]?.integrityReport ??
          preMixReport;
        const canExport = Boolean(exportGate?.canExport);

        return (
          <div className="space-y-4">
            <div
              data-tour-id="math-export-gate"
              className="no-print rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-950 dark:text-slate-50">
                    <Printer className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    <span>Bước 5: Kiểm chứng toàn vẹn &amp; Trung tâm xuất đề 6.0</span>
                    {exportReport && <MathIntegrityBadge status={exportReport.status} />}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl">
                    Mọi mã đề phải vượt qua kiểm tra toàn vẹn (công thức, hình vẽ/bảng biểu, cấu trúc ID, đáp án, quy tắc khóa) và kiểm chứng ngược OOXML hậu xuất trước khi phát hành.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="rounded-[10px] border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  Quay lại đối soát mã đề
                </button>
              </div>

              {!canExport && versions.length > 0 && (
                <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50/80 dark:bg-red-950/50 p-3.5 text-xs text-red-900 dark:text-red-200 flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <div className="font-semibold">
                      Xuất đề bị CHẶN (BLOCKED) vì phát hiện lỗi toàn vẹn hoặc vi phạm quy tắc khóa.
                    </div>
                    <p className="mt-0.5">
                      {exportGate?.blockingReasons.join(' ') ||
                        'Vui lòng xử lý toàn bộ mục [BLOCKED] bên dưới và bấm "Kiểm tra toàn vẹn" lại trước khi xuất bản.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Universal Export Hub */}
              {versions.length > 0 && (
                <div
                  data-tour-id="math-export-hub"
                  className="rounded-xl border border-blue-200/80 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Xuất bản đề thi cục bộ (DOCX / ZIP / CSV / JSON / In A4 PDF)
                    </span>
                    <span className="font-mono-num text-[11px] text-slate-500">
                      {versions.length} mã đề · {activeSubjectProfile.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!canExport || exportBusy !== null}
                      onClick={() => void handleExportZipBundle()}
                      className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      <FileArchive className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {exportBusy === 'zip'
                          ? 'Đang đóng gói & kiểm chứng ZIP...'
                          : `Xuất trọn bộ .ZIP (${versions.length} mã DOCX + Đáp án)`}
                      </span>
                    </button>

                    {activeVersion && (
                      <button
                        type="button"
                        disabled={!canExport || exportBusy !== null}
                        onClick={() => void handleExportSingleDocx(activeVersion.code)}
                        className="inline-flex items-center gap-1.5 rounded-[10px] border border-blue-300 dark:border-blue-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-blue-900 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {exportBusy === `docx-${activeVersion.code}`
                            ? 'Đang xuất DOCX...'
                            : `Xuất Mã ${activeVersion.code} (.DOCX)`}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!canExport || exportBusy !== null}
                      onClick={() => void handleExportAnswerKeyDocx()}
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {exportBusy === 'answer-docx'
                          ? 'Đang tạo đáp án DOCX...'
                          : 'Đáp án & Ánh xạ (.DOCX)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={!canExport || exportBusy !== null}
                      onClick={handleExportAnswerCsv}
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Bảng đáp án (.CSV)</span>
                    </button>

                    <button
                      type="button"
                      disabled={!canExport || exportBusy !== null}
                      onClick={handleExportMixedBundleJson}
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>JSON</span>
                    </button>
                  </div>

                  {lastExportIntegrity && (
                    <div
                      className={`rounded-lg border p-3 text-xs space-y-1.5 ${
                        lastExportIntegrity.verified
                          ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-200'
                          : 'border-red-300 dark:border-red-800 bg-red-50/80 dark:bg-red-950/40 text-red-900 dark:text-red-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Kiểm chứng hậu xuất gói ZIP (Layer 7):{' '}
                          {lastExportIntegrity.verified ? 'PASS — Nguyên vẹn 100%' : 'BLOCKED'}
                        </span>
                        <span className="font-mono-num text-[11px]">
                          {lastExportIntegrity.fileCount} tệp · {lastExportIntegrity.verifiedCodes.length} mã đề đạt
                        </span>
                      </div>
                      <ul className="space-y-0.5 text-[11px]">
                        {lastExportIntegrity.checks.map((chk) => (
                          <li key={chk.id}>
                            {chk.passed ? '✓' : '✗'} {chk.label}: {chk.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {versions.length === 0 ? (
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  Chưa sinh mã đề nào. Hãy hoàn thành Bước 2 và Bước 3 trước.
                </div>
              ) : (() => {
                const step5PageSize = 16;
                const totalStep5Pages = Math.max(1, Math.ceil(versions.length / step5PageSize));
                const safeStep5Page = Math.min(codeBatchPage, totalStep5Pages - 1);
                const visibleVersions = versions.slice(
                  safeStep5Page * step5PageSize,
                  (safeStep5Page + 1) * step5PageSize
                );

                return (
                  <div className="space-y-3">
                    {totalStep5Pages > 1 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-mono-num text-slate-600 dark:text-slate-400">
                          Tổng {versions.length} mã đề · Hiển thị nhóm {safeStep5Page * step5PageSize + 1}–{Math.min((safeStep5Page + 1) * step5PageSize, versions.length)}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {Array.from({ length: totalStep5Pages }, (_, pIdx) => (
                            <button
                              key={pIdx}
                              type="button"
                              onClick={() => setCodeBatchPage(pIdx)}
                              className={`rounded px-2.5 py-1 text-[11px] font-mono-num ${
                                safeStep5Page === pIdx
                                  ? 'bg-blue-600 text-white'
                                  : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {pIdx * step5PageSize + 1}–{Math.min((pIdx + 1) * step5PageSize, versions.length)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {visibleVersions.map((ver) => {
                        const st = ver.integrityStatus ?? (ver.integrityPassed ? 'PASS' : 'BLOCKED');
                        return (
                          <div
                            key={ver.code}
                            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono-num text-sm font-bold text-slate-950 dark:text-slate-50">
                                Mã đề {ver.code}
                              </span>
                              <MathIntegrityBadge status={st} />
                            </div>
                            <div className="text-xs font-mono-num text-slate-600 dark:text-slate-400">
                              {ver.questions.length} câu hỏi · {ver.answerKeyRows.length} dòng đáp án
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCodeTab(ver.code);
                                  setStep(4);
                                }}
                                className="flex-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                Đối soát
                              </button>
                              <button
                                type="button"
                                disabled={!canExport || exportBusy !== null}
                                onClick={() => void handleExportSingleDocx(ver.code)}
                                className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 px-2.5 py-1.5 text-[11px] font-medium text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50"
                                title={`Tải Ma_de_${ver.code}.docx`}
                              >
                                DOCX
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {exportReport && (
              <div className="no-print">
                <MathIntegrityReportPanel
                  report={exportReport}
                  title="Bảng kiểm tra toàn vẹn trước khi xuất đề (Pre-Export Verification)"
                  onManualCheck={() => void handleReverifyVersions()}
                />
              </div>
            )}

            {versions.length > 0 && (
              <MathExamPrintPreview
                exam={activeExam}
                selectedCode={activeVersion?.code ?? versions[0].code}
                canExport={canExport}
                onChangeExportSettings={(nextSettings: ExamExportSettings) =>
                  handleExamChange({
                    ...activeExam,
                    exportSettings: nextSettings,
                  })
                }
                onTriggerPrint={() => {
                  if (!canExport) {
                    onShowToast(
                      'error',
                      'Không thể in vì đề đang có lỗi toàn vẹn BLOCKED.'
                    );
                    return;
                  }
                  window.print();
                }}
              />
            )}
          </div>
        );
      })()}
    </main>
  );
}
