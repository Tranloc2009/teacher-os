import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Upload,
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
  checkDraftExportGate,
  checkExamExportGate,
  computeLockStats,
  createOriginalExamSnapshot,
  estimateMaxDistinctPermutations,
  evaluatePreMixIntegrity,
  getOptionLetterLabel,
  getStatementLetterLabel,
  resolveEffectiveMixFlags,
  verifyMixedExamIntegrity,
} from '../../core/mathIntegrity';
import {
  EXAM_CODE_PRESETS,
  MAX_EXAM_CODES,
  analyzeQuestionShuffleEligibility,
  applyMixLevelPreset,
  applyMixToggleUpdate,
  buildDefaultMatrixRules,
  buildQuestionOrderDiagnostics,
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
  buildDraftStudentExamDocxBuffer,
  buildExamWithSolutionsDocxBuffer,
  buildMixedExamJsonExportPayload,
  buildPerCodeAnswerKeyDocxBuffer,
  buildSourceToOutputTraceabilityReport,
  buildStudentExamDocxBuffer,
  exportMixedExamZipBundle,
  verifyExportedAnswerKeyDocxBuffer,
  verifyExportedCsv,
  verifyExportedDocxBuffer,
} from '../../core/examExportEngine';
import {
  commitUniversalImportSessionToProject,
  runUniversalImportSession,
} from '../../core/universalImportAdapter';
import { createEmptyMathExamProject } from '../../data/demoMathExams';
import { createId } from '../../db/database';
import { MathExamEditor } from '../math/MathExamEditor';
import { AnswerKeyStudioPanel } from '../math/AnswerKeyStudioPanel';
import { DocumentImportDoctorPanel } from '../math/DocumentImportDoctorPanel';
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
  preferredExamId?: string | null;
  preferredStep?: MathExamStep | null;
  preferredStep2SubView?: 'editor' | 'import-doctor' | 'answer-studio' | null;
  preferredExamCode?: string | null;
  onClearPreferredTarget?: () => void;
  onSaveMathExam: (exam: MathExamProject, silent?: boolean) => Promise<MathExamProject>;
  onDeleteMathExam: (id: string) => Promise<void>;
  onDuplicateMathExam: (exam: MathExamProject) => Promise<void>;
  onShowToast: (tone: 'success' | 'info' | 'error', text: string) => void;
  onOpenPrintStudio?: (examId: string) => void;
  onOpenGradingStudio?: (examId: string) => void;
  onWorkflowExamSynced?: (exam: MathExamProject) => void;
}

const STEP_TABS: Array<{ step: MathExamStep; label: string; shortTitle: string }> = [
  { step: 1, label: '1. Nhập đề & Hồ sơ môn', shortTitle: 'Tải file' },
  { step: 2, label: '2. Xác nhận đáp án gốc', shortTitle: 'Xác nhận cấu trúc' },
  { step: 3, label: '3. Quy tắc trộn & Số mã', shortTitle: 'Chọn mã đề' },
  { step: 4, label: '4. Kiểm tra & So sánh', shortTitle: 'Kiểm tra' },
  { step: 5, label: '5. Kiểm chứng & Xuất đề', shortTitle: 'Xuất' },
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
  preferredExamId,
  preferredStep,
  preferredStep2SubView,
  preferredExamCode,
  onClearPreferredTarget,
  onSaveMathExam,
  onDeleteMathExam,
  onDuplicateMathExam,
  onShowToast,
  onOpenPrintStudio,
  onOpenGradingStudio,
  onWorkflowExamSynced,
}: MathExamMixerAppProps) {
  const [selectedExamId, setSelectedExamId] = useState<string>(
    preferredExamId || mathExams[0]?.id || ''
  );
  const [step, setStep] = useState<MathExamStep>(1);
  const [step2Tab, setStep2Tab] = useState<'editor' | 'import-doctor' | 'answer-studio'>('editor');
  const [doctorQuestionId, setDoctorQuestionId] = useState<string | null>(null);
  const [draftConfirmPending, setDraftConfirmPending] = useState(false);
  const [selectedCodeTab, setSelectedCodeTab] = useState<string>('');
  const [compareCodeTab, setCompareCodeTab] = useState<string>('');
  const [step4ViewMode, setStep4ViewMode] = useState<
    'compare' | 'compare-codes' | 'answer-matrix'
  >('compare');
  const [missingPreferredExamId, setMissingPreferredExamId] = useState<string | null>(null);
  const [missingPreferredCodeNotice, setMissingPreferredCodeNotice] = useState<string | null>(null);

  useEffect(() => {
    if (preferredExamId) {
      const exactExam = mathExams.find((e) => e.id === preferredExamId);
      if (exactExam) {
        setSelectedExamId(exactExam.id);
        setMissingPreferredExamId(null);
        setStep(preferredStep ?? 2);
        if (preferredStep2SubView) {
          setStep2Tab(preferredStep2SubView);
        }
        if (preferredExamCode) {
          const hasCode = exactExam.generatedVersions.some(
            (v) => v.code === preferredExamCode
          );
          if (hasCode) {
            setSelectedCodeTab(preferredExamCode);
            setStep(4);
            setStep4ViewMode('answer-matrix');
            setMissingPreferredCodeNotice(null);
          } else {
            setMissingPreferredCodeNotice(
              `Mã đề ${preferredExamCode} chưa tồn tại trong "${exactExam.title}". Hãy trộn mã đề ở Bước 3 trước khi xem bảng đáp án mã ${preferredExamCode}.`
            );
          }
        } else {
          setMissingPreferredCodeNotice(null);
        }
      } else {
        setMissingPreferredExamId(preferredExamId);
      }
    } else {
      setMissingPreferredExamId(null);
      if (preferredStep) {
        setStep(preferredStep);
      }
      if (preferredStep2SubView) {
        setStep2Tab(preferredStep2SubView);
      }
      if (preferredExamCode) {
        const currentExam = mathExams.find((e) => e.id === selectedExamId) ?? mathExams[0];
        if (currentExam?.generatedVersions.some((v) => v.code === preferredExamCode)) {
          setSelectedCodeTab(preferredExamCode);
          setStep(4);
          setStep4ViewMode('answer-matrix');
          setMissingPreferredCodeNotice(null);
        } else {
          setMissingPreferredCodeNotice(
            `Không tìm thấy mã đề ${preferredExamCode} trong đề đang mở.`
          );
        }
      } else {
        setMissingPreferredCodeNotice(null);
      }
    }
  }, [preferredExamId, preferredStep, preferredStep2SubView, preferredExamCode, mathExams]);
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

  const shuffleEligibility = useMemo(
    () => (activeExam ? analyzeQuestionShuffleEligibility(activeExam) : null),
    [activeExam]
  );

  const effectiveMixFlags = useMemo(
    () => (activeExam ? resolveEffectiveMixFlags(activeExam) : null),
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

  const draftExportGate = useMemo(
    () => (activeExam ? checkDraftExportGate(activeExam) : null),
    [activeExam]
  );

  const hasSourceSolutions = useMemo(
    () =>
      Boolean(
        activeExam?.questions.some(
          (q) =>
            Boolean(q.solutionGuide?.rawSource?.trim()) ||
            Boolean(q.essayParts?.some((p) => p.solutionOutline?.rawSource?.trim()))
        )
      ),
    [activeExam]
  );

  const questionOrderDiagnostics = useMemo(
    () => (activeExam ? buildQuestionOrderDiagnostics(activeExam) : null),
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
      const postDiag = buildQuestionOrderDiagnostics(updated);
      if (postDiag.shuffleQuestionsEnabled && postDiag.allVersionsUnchanged) {
        onShowToast(
          'error',
          `Đã tạo ${res.versions.length} mã đề nhưng thứ tự câu chưa đổi: ${
            postDiag.nonShuffleReasons[0] ?? 'Kiểm tra khóa vị trí hoặc nhóm phụ thuộc.'
          }`
        );
      } else {
        onShowToast(
          'success',
          `Đã tạo và kiểm chứng toàn vẹn ${res.versions.length} mã đề (${activeSubjectProfile.name}).`
        );
      }
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
    try {
      const payload = buildMixedExamJsonExportPayload(activeExam);
      triggerBlobDownload(
        new Blob([JSON.stringify(payload, null, 2)], {
          type: 'application/json;charset=utf-8',
        }),
        `exam-codes-${activeExam.id}.json`
      );
      onShowToast('success', 'Đã xuất tệp JSON bộ mã đề đã kiểm chứng.');
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Xuất JSON bị chặn bởi cổng kiểm chứng.'
      );
    }
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
      const ansCheck = await verifyExportedAnswerKeyDocxBuffer(bytes, activeExam);
      if (!ansCheck.passed) {
        onShowToast(
          'error',
          ansCheck.issues[0]?.message ?? 'Kiểm chứng ngược Đáp án DOCX không đạt.'
        );
        return;
      }
      const bufferCopy = new Uint8Array(bytes).buffer;
      triggerBlobDownload(
        new Blob([bufferCopy], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        `Dap_an_va_Anh_xa_${activeExam.id}.docx`
      );
      onShowToast('success', 'Đã xuất & kiểm chứng sạch file Word Đáp án tổng hợp & Bảng ánh xạ.');
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
    try {
      const csv = buildConsolidatedAnswerCsv(activeExam);
      const csvCheck = verifyExportedCsv(csv, activeExam);
      if (!csvCheck.passed) {
        onShowToast(
          'error',
          csvCheck.issues[0]?.message ?? 'Kiểm chứng ngược CSV đáp án không đạt.'
        );
        return;
      }
      triggerBlobDownload(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        `Bang_dap_an_${activeExam.id}.csv`
      );
      onShowToast('success', 'Đã xuất & kiểm chứng sạch bảng đáp án CSV.');
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Xuất CSV bị chặn bởi cổng kiểm chứng.'
      );
    }
  };

  const handleExportPerCodeAnswerDocx = async (code: string) => {
    if (!activeExam || !exportGate?.canExport) {
      onShowToast(
        'error',
        exportGate?.blockingReasons[0] ?? 'Xuất Đáp án theo mã bị chặn do lỗi toàn vẹn BLOCKED.'
      );
      return;
    }
    const ver = activeExam.generatedVersions.find((v) => v.code === code);
    if (!ver) return;
    setExportBusy(`percode-ans-${ver.code}`);
    try {
      const bytes = await buildPerCodeAnswerKeyDocxBuffer(activeExam, ver);
      const bufferCopy = new Uint8Array(bytes).buffer;
      triggerBlobDownload(
        new Blob([bufferCopy], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        `Dap_an_${ver.code}.docx`
      );
      onShowToast('success', `Đã xuất file Đáp án riêng Mã đề ${ver.code} (Dap_an_${ver.code}.docx).`);
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Không thể xuất file đáp án theo mã đề.'
      );
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportExamWithSolutionsDocx = async (code: string) => {
    if (!activeExam || !exportGate?.canExport) {
      onShowToast(
        'error',
        exportGate?.blockingReasons[0] ?? 'Xuất Đề kèm lời giải bị chặn do lỗi toàn vẹn BLOCKED.'
      );
      return;
    }
    const ver = activeExam.generatedVersions.find((v) => v.code === code);
    if (!ver) return;
    setExportBusy(`sol-docx-${ver.code}`);
    try {
      const bytes = await buildExamWithSolutionsDocxBuffer(activeExam, ver);
      const bufferCopy = new Uint8Array(bytes).buffer;
      triggerBlobDownload(
        new Blob([bufferCopy], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        `De_kem_loi_giai_${ver.code}.docx`
      );
      onShowToast('success', `Đã xuất Đề kèm lời giải gốc Mã ${ver.code}.docx.`);
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Không thể xuất Đề kèm lời giải.'
      );
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportDraftDocx = async () => {
    if (!activeExam || !draftExportGate?.canExportDraft) {
      onShowToast(
        'error',
        draftExportGate?.warningMessage ??
          'BLOCK OFFICIAL EXPORT — DOCUMENT INTEGRITY FAILED.'
      );
      return;
    }
    setExportBusy('draft-docx');
    try {
      const bytes = await buildDraftStudentExamDocxBuffer(
        activeExam,
        activeVersion ?? undefined
      );
      const bufferCopy = new Uint8Array(bytes).buffer;
      triggerBlobDownload(
        new Blob([bufferCopy], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        `Ban_nhap_khong_dap_an_${activeExam.id}.docx`
      );
      setDraftConfirmPending(false);
      onShowToast(
        'info',
        'Đã xuất Bản nháp học sinh KHÔNG kèm đáp án (.DOCX). Chỉ dùng rà soát in ấn.'
      );
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Không thể xuất bản nháp DOCX.'
      );
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportTraceabilityJson = () => {
    if (!activeExam || activeExam.generatedVersions.length === 0) return;
    const payload = buildSourceToOutputTraceabilityReport(activeExam);
    triggerBlobDownload(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
      `Bao_cao_truy_vet_nguon_${activeExam.id}.json`
    );
    onShowToast('success', 'Đã tải Báo cáo truy vết nguồn-đầu-ra (QA Traceability JSON).');
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
        {missingPreferredExamId && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/50 px-4 py-3 text-xs text-amber-950 dark:text-amber-200"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-bold">
                  Không tìm thấy đề kiểm tra được yêu cầu (ID: {missingPreferredExamId})
                </p>
                <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                  Đề kiểm tra này có thể đã bị xóa. Bạn có thể chọn thủ công một đề khác bên dưới hoặc tạo đề mới.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setMissingPreferredExamId(null);
                onClearPreferredTarget?.();
              }}
              className="rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200"
            >
              Đã hiểu
            </button>
          </div>
        )}

        {missingPreferredCodeNotice && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-[#EEF0FF]/90 dark:bg-indigo-950/50 px-4 py-3 text-xs text-indigo-950 dark:text-indigo-200"
          >
            <span>{missingPreferredCodeNotice}</span>
            <button
              type="button"
              onClick={() => {
                setMissingPreferredCodeNotice(null);
                onClearPreferredTarget?.();
              }}
              className="rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold"
            >
              Đóng
            </button>
          </div>
        )}

        <ContextualAcademyBar
          tutorialId="tutorial.math-mixer"
          label="Math Exam Mixer"
          description="Trộn đề thi nhanh chóng, bảo toàn công thức toán học và kiểm tra độ chính xác."
        />

        <PageBanner
          tourId="math-header"
          title="Math Exam Mixer"
          subtitle="Trộn đề thi nhanh chóng, bảo toàn công thức toán học và kiểm tra độ chính xác."
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

              {onOpenPrintStudio && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onWorkflowExamSynced?.(activeExam);
                    onOpenPrintStudio(activeExam.id);
                  }}
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Thiết kế mẫu đề</span>
                </Button>
              )}

              {onOpenGradingStudio && activeExam.generatedVersions.length > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!exportGate?.canExport}
                  onClick={() => {
                    if (!exportGate?.canExport) {
                      onShowToast(
                        'error',
                        exportGate?.blockingReasons[0] ??
                          'Không thể chuyển sang Smart Grading Studio OMR khi đề chưa xác nhận đáp án gốc hoặc đang BLOCKED.'
                      );
                      setStep(2);
                      setStep2Tab('answer-studio');
                      return;
                    }
                    onWorkflowExamSynced?.(activeExam);
                    onOpenGradingStudio(activeExam.id);
                  }}
                >
                  <ScanLine className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Chấm bài OMR</span>
                </Button>
              )}

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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 flex-1">
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
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Hồ sơ môn: <strong className="text-slate-800 dark:text-slate-200">{activeSubjectProfile.name}</strong>
              </span>
            </div>

            {/* Connected 5-Step Progress Strip matching Reference Image 6 */}
            <nav
              aria-label="Quy trình 5 bước trộn đề Toán"
              data-tour-id="math-step-tabs"
              className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-3 border-t border-slate-100 dark:border-slate-800"
            >
              {STEP_TABS.map((item) => {
                const active = step === item.step;
                const done = step > item.step;
                return (
                  <button
                    key={item.step}
                    type="button"
                    onClick={() => {
                      setStep(item.step);
                      tutorial?.emitTutorialEvent('math-step-nav-clicked');
                    }}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-all whitespace-nowrap truncate ${
                      active
                        ? 'border-blue-600 bg-blue-600 text-white shadow-2xs'
                        : done
                        ? 'border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-mono-num font-bold ${
                        active
                          ? 'bg-white/20 text-white'
                          : done
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {item.step}
                    </span>
                    <span className="truncate">{item.shortTitle}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </PageBanner>

        {/* Reference Image 6 Quick Mixer Card on Step 1 */}
        {step === 1 && (
          <QuickExamMixerCard
            exam={activeExam}
            onChangeExam={handleExamChange}
            onRunQuickMix={async () => {
              // TUYỆT ĐỐI KHÔNG tự động gán confirmedOriginalAnswers = true khi còn câu chưa xác nhận hoặc lỗi BLOCKED
              const currentPreMix = evaluatePreMixIntegrity(activeExam);
              const blockingIssues = currentPreMix.issues.filter((i) => i.severity === 'error');
              if (blockingIssues.length > 0) {
                onShowToast(
                  'error',
                  `Chặn trộn nhanh (${blockingIssues.length} lỗi BLOCKED): ${blockingIssues[0].message}`
                );
                setStep(2);
                return;
              }
              if (!activeExam.confirmedOriginalAnswers) {
                onShowToast(
                  'error',
                  'Chưa xác nhận đáp án gốc ở Bước 2 — vui lòng rà soát khóa chấm và bấm "Xác nhận toàn bộ đáp án gốc" trước khi trộn.'
                );
                setStep(2);
                return;
              }
              const res = await generateMixedExamsAsync(activeExam, { chunkSize: 5 });
              if (res.errors.length > 0) {
                onShowToast('error', res.errors[0]);
                return;
              }
              const updated: MathExamProject = {
                ...activeExam,
                generatedVersions: res.versions,
                lastIntegrityReport: currentPreMix,
                status: 'ready',
                updatedAt: new Date().toISOString(),
              };
              await onSaveMathExam(updated, true);
              setSelectedCodeTab(res.versions[0]?.code ?? '');
              setCompareCodeTab(res.versions[1]?.code ?? res.versions[0]?.code ?? '');
              const postDiag = buildQuestionOrderDiagnostics(updated);
              if (postDiag.shuffleQuestionsEnabled && postDiag.allVersionsUnchanged) {
                onShowToast(
                  'error',
                  `Thứ tự câu chưa đổi: ${
                    postDiag.nonShuffleReasons[0] ?? 'Kiểm tra khóa vị trí hoặc nhóm phụ thuộc.'
                  }`
                );
              } else {
                onShowToast(
                  'success',
                  `Đã tạo nhanh ${res.versions.length} mã đề (${res.versions
                    .slice(0, 4)
                    .map((v) => v.code)
                    .join(', ')}).`
                );
              }
            }}
            onQuickPrint={async () => {
              if (!exportGate?.canExport) {
                onShowToast(
                  'error',
                  exportGate?.blockingReasons[0] ??
                    'Không thể in/xuất PDF vì đề chưa xác nhận đáp án gốc hoặc đang có lỗi BLOCKED.'
                );
                setStep(activeExam.generatedVersions.length === 0 ? 2 : 5);
                return;
              }
              setStep(5);
              setTimeout(() => window.print(), 250);
            }}
            onShowToast={onShowToast}
          />
        )}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <MathExamEditor
          exam={activeExam}
          stepMode={1}
          integrityIssues={originalIssues}
          onChangeExam={handleExamChange}
          onGoToStep={setStep}
        />
      )}

      {/* Step 2: Editor + Document Import Doctor + Answer Key Studio */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900 px-3.5 py-2.5 shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'editor', label: 'Soạn & Rà soát đề' },
                  { id: 'import-doctor', label: 'Document Import Doctor' },
                  { id: 'answer-studio', label: 'Answer Key Studio' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStep2Tab(tab.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    step2Tab === tab.id
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {originalIssues.filter((i) => i.severity === 'error').length === 0
                ? 'Sẵn sàng chuyển sang Bước 3 trộn đề'
                : `${originalIssues.filter((i) => i.severity === 'error').length} lỗi chặn (BLOCKED) cần xử lý trước khi xuất chính thức`}
            </div>
          </div>

          {step2Tab === 'editor' && (
            <MathExamEditor
              exam={activeExam}
              stepMode={2}
              integrityIssues={originalIssues}
              onChangeExam={handleExamChange}
              onGoToStep={setStep}
            />
          )}

          {step2Tab === 'import-doctor' && (
            <DocumentImportDoctorPanel
              exam={activeExam}
              initialQuestionId={doctorQuestionId}
              onEditQuestion={() => setStep2Tab('editor')}
              onOpenAnswerStudio={() => setStep2Tab('answer-studio')}
              onConfirmAndProceed={() => {
                const blockingCount = originalIssues.filter((i) => i.severity === 'error').length;
                if (blockingCount > 0 || !activeExam.confirmedOriginalAnswers) {
                  setStep2Tab('answer-studio');
                  onShowToast(
                    'info',
                    blockingCount > 0
                      ? `Còn ${blockingCount} lỗi cần xử lý. Đã chuyển sang Answer Key Studio để hoàn tất xác nhận đáp án.`
                      : 'Hãy xác nhận toàn bộ đáp án gốc trước khi trộn đề.'
                  );
                } else {
                  setStep(3);
                  onShowToast('success', 'Đề đã đạt kiểm tra toàn vẹn — chuyển sang Bước 3 trộn mã đề.');
                }
              }}
            />
          )}

          {step2Tab === 'answer-studio' && (
            <AnswerKeyStudioPanel
              exam={activeExam}
              onUpdateExam={handleExamChange}
              onInspectQuestion={(qId) => {
                setDoctorQuestionId(qId);
                setStep2Tab('import-doctor');
              }}
              onEditQuestion={() => setStep2Tab('editor')}
              onToast={(msg, tone) =>
                onShowToast(tone === 'warning' ? 'info' : tone ?? 'info', msg)
              }
            />
          )}
        </div>
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
                        handleExamChange({
                          ...activeExam,
                          mixConfig: applyMixLevelPreset(
                            activeExam.mixConfig,
                            item.level as MixLevel,
                            activeExam.questions
                          ),
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

              {/* Independent Shuffle Toggles & Question Constraints (always visible for all levels) */}
              {effectiveMixFlags && (
                <div className="rounded-xl border border-blue-200/80 dark:border-blue-900/70 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-slate-950 dark:text-slate-50">
                      Công tắc trộn độc lập &amp; Ràng buộc câu hỏi
                    </div>
                    <span className="font-mono-num text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                      {effectiveMixFlags.shuffleQuestions && effectiveMixFlags.shuffleMcqOptions
                        ? 'Đảo câu + Đảo đáp án'
                        : effectiveMixFlags.shuffleQuestions
                        ? 'Chỉ đảo thứ tự câu hỏi'
                        : effectiveMixFlags.shuffleMcqOptions
                        ? 'Chỉ đảo phương án A/B/C/D'
                        : 'Giữ nguyên đề gốc'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        Đảo thứ tự câu hỏi
                      </span>
                      <input
                        type="checkbox"
                        checked={effectiveMixFlags.shuffleQuestions}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: applyMixToggleUpdate(activeExam.mixConfig, {
                              shuffleQuestions: e.target.checked,
                            }),
                            generatedVersions: [],
                          })
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        Đảo thứ tự phương án A/B/C/D
                      </span>
                      <input
                        type="checkbox"
                        checked={effectiveMixFlags.shuffleMcqOptions}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: applyMixToggleUpdate(activeExam.mixConfig, {
                              shuffleMcqOptions: e.target.checked,
                            }),
                            generatedVersions: [],
                          })
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer">
                      <span className="text-slate-700 dark:text-slate-300">
                        Giữ nguyên nhóm câu phụ thuộc
                      </span>
                      <input
                        type="checkbox"
                        checked={effectiveMixFlags.keepDependentGroups}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: applyMixToggleUpdate(activeExam.mixConfig, {
                              keepDependentGroups: e.target.checked,
                            }),
                            subjectProfileOverrides: activeExam.subjectProfileOverrides
                              ? {
                                  ...activeExam.subjectProfileOverrides,
                                  lockSharedPassageGroups: e.target.checked,
                                }
                              : undefined,
                            generatedVersions: [],
                          })
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer">
                      <span className="text-slate-700 dark:text-slate-300">
                        Chỉ trộn bên trong từng phần I/II/III/IV
                      </span>
                      <input
                        type="checkbox"
                        checked={effectiveMixFlags.shufflePerSectionOnly}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: applyMixToggleUpdate(activeExam.mixConfig, {
                              shufflePerSectionOnly: e.target.checked,
                            }),
                            subjectProfileOverrides: activeExam.subjectProfileOverrides
                              ? {
                                  ...activeExam.subjectProfileOverrides,
                                  shufflePerSectionOnly: e.target.checked,
                                }
                              : undefined,
                            generatedVersions: [],
                          })
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer">
                      <span className="text-slate-700 dark:text-slate-300">
                        Giữ nguyên vị trí câu Vận dụng cao
                      </span>
                      <input
                        type="checkbox"
                        checked={effectiveMixFlags.keepVdcPositions}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: applyMixToggleUpdate(activeExam.mixConfig, {
                              keepVdcPositions: e.target.checked,
                            }),
                            generatedVersions: [],
                          })
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer">
                      <span className="text-slate-700 dark:text-slate-300">
                        Đảo ý a/b/c/d ở câu Đúng/Sai độc lập
                      </span>
                      <input
                        type="checkbox"
                        checked={effectiveMixFlags.shuffleIndependentTrueFalseStatements}
                        onChange={(e) =>
                          handleExamChange({
                            ...activeExam,
                            mixConfig: applyMixToggleUpdate(activeExam.mixConfig, {
                              shuffleIndependentTrueFalseStatements: e.target.checked,
                            }),
                            generatedVersions: [],
                          })
                        }
                      />
                    </label>
                  </div>

                  {/* Quick Question Lock Selector */}
                  {activeExam.questions.length > 0 && (
                    <div className="pt-2 border-t border-blue-200/60 dark:border-blue-900/50 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          Khóa vị trí câu được chọn (nhấn để ghim/mở khóa nhanh):
                        </span>
                        {(activeExam.mixConfig.lockedQuestionIds.length > 0 ||
                          activeExam.questions.some(
                            (q) => q.lockQuestionPosition || q.universalLock?.positionLock
                          )) && (
                          <button
                            type="button"
                            onClick={() =>
                              handleExamChange({
                                ...activeExam,
                                mixConfig: {
                                  ...activeExam.mixConfig,
                                  lockedQuestionIds: [],
                                },
                                questions: activeExam.questions.map((q) => ({
                                  ...q,
                                  lockQuestionPosition: false,
                                  universalLock: q.universalLock
                                    ? { ...q.universalLock, positionLock: false }
                                    : undefined,
                                })),
                                generatedVersions: [],
                              })
                            }
                            className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline"
                          >
                            Mở khóa tất cả
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                        {activeExam.questions.map((q, qIdx) => {
                          const isLocked =
                            q.lockQuestionPosition ||
                            q.universalLock?.positionLock ||
                            activeExam.mixConfig.lockedQuestionIds.includes(q.id);
                          return (
                            <button
                              key={q.id}
                              type="button"
                              onClick={() => {
                                const nextLocked = !isLocked;
                                const nextLockedIds = nextLocked
                                  ? Array.from(
                                      new Set([...activeExam.mixConfig.lockedQuestionIds, q.id])
                                    )
                                  : activeExam.mixConfig.lockedQuestionIds.filter(
                                      (id) => id !== q.id
                                    );
                                handleExamChange({
                                  ...activeExam,
                                  mixConfig: {
                                    ...activeExam.mixConfig,
                                    lockedQuestionIds: nextLockedIds,
                                  },
                                  questions: activeExam.questions.map((item) =>
                                    item.id === q.id
                                      ? {
                                          ...item,
                                          lockQuestionPosition: nextLocked,
                                          universalLock: item.universalLock
                                            ? {
                                                ...item.universalLock,
                                                positionLock: nextLocked,
                                              }
                                            : undefined,
                                        }
                                      : item
                                  ),
                                  generatedVersions: [],
                                });
                              }}
                              aria-pressed={isLocked}
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-mono-num font-medium transition-colors ${
                                isLocked
                                  ? 'border-amber-500 bg-amber-100/80 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                              }`}
                            >
                              {isLocked && <Lock className="h-2.5 w-2.5" aria-hidden="true" />}
                              <span>C{qIdx + 1}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
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

                {/* Math Lock & Question Shuffle Eligibility Summary Card */}
                {lockStats && shuffleEligibility && (
                  <div
                    data-testid="shuffle-eligibility-summary"
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                        Phân tích khả năng đảo câu &amp; Math Lock
                      </span>
                      <span className="font-mono-num text-[11px] text-slate-600 dark:text-slate-400">
                        Tối đa ~{maxDistinctPerms >= 100000 ? '100.000+' : maxDistinctPerms.toLocaleString('vi-VN')} hoán vị
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 font-mono-num text-[11px] text-slate-700 dark:text-slate-300">
                      <span>
                        Đủ điều kiện đảo:{' '}
                        <strong className="text-blue-700 dark:text-blue-300">
                          {shuffleEligibility.eligibleQuestions}/{shuffleEligibility.totalQuestions}
                        </strong>
                      </span>
                      <span>
                        Câu bị khóa: <strong>{shuffleEligibility.lockedQuestions}</strong>
                      </span>
                      <span>
                        Nhóm phụ thuộc: <strong>{shuffleEligibility.dependentGroupCount}</strong>
                      </span>
                      <span>
                        Hoán vị thứ tự câu:{' '}
                        <strong>
                          {shuffleEligibility.maxQuestionPermutations >= 100000
                            ? '100.000+'
                            : shuffleEligibility.maxQuestionPermutations.toLocaleString('vi-VN')}
                        </strong>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 font-mono-num text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
                      <span>Phương án khóa: {lockStats.lockedOptions}</span>
                      <span>Hình/BBT: {lockStats.visualAssetsCount}</span>
                    </div>
                    {shuffleEligibility.warnings.length > 0 && (
                      <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/50 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                        {shuffleEligibility.warnings.map((w, idx) => (
                          <div key={idx} className="flex items-start gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}
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

              {questionOrderDiagnostics && questionOrderDiagnostics.rows.length > 1 && (
                <section
                  data-testid="question-order-debug-panel"
                  aria-label="Bảng chẩn đoán thứ tự câu hỏi"
                  className="rounded-xl border border-blue-200/80 dark:border-blue-900/70 bg-white dark:bg-slate-900 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        Bảng chẩn đoán thứ tự câu hỏi (Question Order Debug)
                      </span>
                      <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                        Đủ điều kiện đảo: {questionOrderDiagnostics.eligibleQuestions}/
                        {questionOrderDiagnostics.originalOrderIds.length} · Khóa:{' '}
                        {questionOrderDiagnostics.lockedQuestions} · Nhóm:{' '}
                        {questionOrderDiagnostics.dependentGroupCount}
                      </span>
                    </div>
                    <span className="font-mono-num text-[11px] text-blue-700 dark:text-blue-300">
                      Đảo câu: {questionOrderDiagnostics.shuffleQuestionsEnabled ? 'BẬT' : 'TẮT'} ·
                      Đảo PA: {questionOrderDiagnostics.shuffleOptionsEnabled ? 'BẬT' : 'TẮT'}
                    </span>
                  </div>

                  {questionOrderDiagnostics.nonShuffleReasons.length > 0 && (
                    <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-950 dark:text-amber-200 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>Lý do thứ tự câu hỏi chưa đổi ở một số/toàn bộ mã đề:</span>
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {questionOrderDiagnostics.nonShuffleReasons.map((reason, idx) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] text-slate-600 dark:text-slate-300">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                            Mã đề
                          </th>
                          <th className="px-3 py-2 text-left font-semibold">
                            Thứ tự ID câu gốc
                          </th>
                          <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                            Số vị trí thay đổi
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono-num">
                        {questionOrderDiagnostics.rows.slice(0, 12).map((row) => {
                          const previewList =
                            row.questionCodes.length <= 16
                              ? row.questionCodes.join(', ')
                              : `${row.questionCodes.slice(0, 12).join(', ')}, … (+${
                                  row.questionCodes.length - 12
                                })`;
                          return (
                            <tr
                              key={row.code}
                              className={
                                row.isOriginal
                                  ? 'bg-slate-50/70 dark:bg-slate-950/40'
                                  : 'bg-white dark:bg-slate-900'
                              }
                            >
                              <td className="px-3 py-1.5 font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                {row.code}
                              </td>
                              <td
                                className="px-3 py-1.5 text-[11px] text-slate-700 dark:text-slate-300 break-all"
                                title={row.questionIds.join(', ')}
                              >
                                {previewList}
                              </td>
                              <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                {row.isOriginal ? (
                                  <span className="text-slate-500">0 / {row.totalQuestions}</span>
                                ) : row.changedPositionsCount > 0 ? (
                                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                                    {row.changedPositionsCount} / {row.totalQuestions}
                                  </span>
                                ) : (
                                  <span className="font-bold text-amber-700 dark:text-amber-400">
                                    0 / {row.totalQuestions}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

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
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                                  {origQ.options.map((opt) => (
                                    <div
                                      key={opt.id}
                                      className={`rounded px-2 py-1 space-y-1 ${
                                        opt.id === origQ.correctOptionId
                                          ? 'bg-emerald-50 dark:bg-emerald-950/40 font-medium text-emerald-900 dark:text-emerald-200'
                                          : 'text-slate-600 dark:text-slate-400'
                                      }`}
                                    >
                                      <div>
                                        <span className="font-mono-num font-bold mr-1">
                                          {opt.originalLabel}.
                                          {opt.lockPosition ? ' [Khóa]' : ''}
                                        </span>
                                        <MathContentRenderer payload={opt.content} />
                                      </div>
                                      {opt.visualAsset && (
                                        <MathVisualAssetRenderer asset={opt.visualAsset} compact />
                                      )}
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
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                                  {mixedQ.options.map((opt, oIdx) => {
                                    const newLbl = (['A', 'B', 'C', 'D'] as const)[oIdx];
                                    const isCorr = opt.id === mixedQ.correctOptionId;
                                    return (
                                      <div
                                        key={opt.id}
                                        className={`rounded px-2 py-1 space-y-1 ${
                                          isCorr
                                            ? 'bg-emerald-50 dark:bg-emerald-950/40 font-medium text-emerald-900 dark:text-emerald-200'
                                            : 'text-slate-700 dark:text-slate-300'
                                        }`}
                                      >
                                        <div>
                                          <span className="font-mono-num font-bold mr-1">
                                            {newLbl}.
                                            {opt.lockPosition ? ' [Khóa]' : ''}
                                          </span>
                                          <MathContentRenderer payload={opt.content} />
                                        </div>
                                        {opt.visualAsset && (
                                          <MathVisualAssetRenderer asset={opt.visualAsset} compact />
                                        )}
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

                    {activeVersion && (
                      <button
                        type="button"
                        disabled={!canExport || exportBusy !== null}
                        onClick={() => void handleExportPerCodeAnswerDocx(activeVersion.code)}
                        className="inline-flex items-center gap-1.5 rounded-[10px] border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-emerald-900 dark:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {exportBusy === `percode-ans-${activeVersion.code}`
                            ? 'Đang tạo...'
                            : `Đáp án Mã ${activeVersion.code} (.DOCX)`}
                        </span>
                      </button>
                    )}

                    {activeVersion && hasSourceSolutions && (
                      <button
                        type="button"
                        disabled={!canExport || exportBusy !== null}
                        onClick={() => void handleExportExamWithSolutionsDocx(activeVersion.code)}
                        className="inline-flex items-center gap-1.5 rounded-[10px] border border-purple-300 dark:border-purple-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-purple-900 dark:text-purple-200 hover:bg-purple-50 dark:hover:bg-purple-950/40 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {exportBusy === `sol-docx-${activeVersion.code}`
                            ? 'Đang tạo...'
                            : `Đề kèm lời giải Mã ${activeVersion.code} (.DOCX)`}
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

                    {onOpenPrintStudio && (
                      <button
                        type="button"
                        onClick={() => {
                          onWorkflowExamSynced?.(activeExam);
                          onOpenPrintStudio(activeExam.id);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-[10px] border border-indigo-300 dark:border-indigo-700 bg-indigo-50/80 dark:bg-indigo-950/50 px-3 py-2 text-xs font-semibold text-indigo-800 dark:text-indigo-200 hover:bg-indigo-100 whitespace-nowrap"
                      >
                        <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Thiết kế mẫu đề &amp; In A4</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!canExport || exportBusy !== null}
                      onClick={handleExportMixedBundleJson}
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>JSON</span>
                    </button>

                    <button
                      type="button"
                      disabled={exportBusy !== null}
                      onClick={handleExportTraceabilityJson}
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                      title="Tải báo cáo truy vết nguồn-đến-đầu-ra (QA Traceability JSON)"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Truy vết QA (.JSON)</span>
                    </button>
                  </div>

                  {/* Draft Export Without Answer Key Gate */}
                  {!canExport && draftExportGate && (
                    <div
                      className={`rounded-lg border p-3 text-xs space-y-2 ${
                        draftExportGate.canExportDraft
                          ? 'border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 text-amber-950 dark:text-amber-200'
                          : 'border-rose-300 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200'
                      }`}
                    >
                      <div className="font-semibold">
                        {draftExportGate.canExportDraft
                          ? 'Chế độ Bản nháp không kèm đáp án (Chỉ dùng rà soát đề in)'
                          : 'BLOCK OFFICIAL EXPORT — DOCUMENT INTEGRITY FAILED'}
                      </div>
                      <p className="text-[11px]">{draftExportGate.warningMessage}</p>
                      {draftExportGate.canExportDraft && !draftConfirmPending && (
                        <button
                          type="button"
                          disabled={exportBusy !== null}
                          onClick={() => setDraftConfirmPending(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Xuất bản nháp không kèm đáp án (.DOCX)</span>
                        </button>
                      )}
                      {draftExportGate.canExportDraft && draftConfirmPending && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <span className="text-[11px] font-semibold">
                            Xác nhận xuất bản nháp KHÔNG kèm bảng đáp án và KHÔNG dùng chấm OMR?
                          </span>
                          <button
                            type="button"
                            disabled={exportBusy !== null}
                            onClick={() => void handleExportDraftDocx()}
                            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700"
                          >
                            {exportBusy === 'draft-docx' ? 'Đang tạo...' : 'Xác nhận tải Bản nháp'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraftConfirmPending(false)}
                            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100"
                          >
                            Hủy
                          </button>
                        </div>
                      )}
                    </div>
                  )}

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
                                className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 px-2 py-1.5 text-[11px] font-medium text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50"
                                title={`Tải Ma_de_${ver.code}.docx`}
                              >
                                Đề
                              </button>
                              <button
                                type="button"
                                disabled={!canExport || exportBusy !== null}
                                onClick={() => void handleExportPerCodeAnswerDocx(ver.code)}
                                className="rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 px-2 py-1.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50"
                                title={`Tải Dap_an_${ver.code}.docx`}
                              >
                                Đáp án
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
                onSelectCode={(code) => setSelectedCodeTab(code)}
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

interface QuickExamMixerCardProps {
  exam: MathExamProject;
  onChangeExam: (next: MathExamProject) => void;
  onRunQuickMix: () => Promise<void>;
  onQuickPrint: () => void | Promise<void>;
  onShowToast: (tone: 'success' | 'info' | 'error', text: string) => void;
}

function QuickExamMixerCard({
  exam,
  onChangeExam,
  onRunQuickMix,
  onQuickPrint,
  onShowToast,
}: QuickExamMixerCardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedPreviewCode, setSelectedPreviewCode] = useState<string>(
    exam.generatedVersions[0]?.code || '__ORIGINAL__'
  );
  const prevVersionCountRef = useRef<number>(exam.generatedVersions.length);

  const examCount = exam.mixConfig.examCount || 4;
  const startCodeNum = exam.mixConfig.startCodeNumber || 101;
  const effectiveFlags = useMemo(() => resolveEffectiveMixFlags(exam), [exam]);
  const quickEligibility = useMemo(() => analyzeQuestionShuffleEligibility(exam), [exam]);

  const previewCodes = useMemo(() => {
    if (exam.generatedVersions.length > 0) {
      return exam.generatedVersions.slice(0, 8).map((v) => v.code);
    }
    return [];
  }, [exam.generatedVersions]);

  useEffect(() => {
    const prevCount = prevVersionCountRef.current;
    prevVersionCountRef.current = previewCodes.length;
    if (previewCodes.length === 0) {
      if (selectedPreviewCode !== '__ORIGINAL__') {
        setSelectedPreviewCode('__ORIGINAL__');
      }
      return;
    }
    if (prevCount === 0 && previewCodes.length > 0) {
      setSelectedPreviewCode(previewCodes[0]);
      return;
    }
    if (
      selectedPreviewCode !== '__ORIGINAL__' &&
      !previewCodes.includes(selectedPreviewCode)
    ) {
      setSelectedPreviewCode(previewCodes[0] ?? '__ORIGINAL__');
    }
  }, [previewCodes, selectedPreviewCode]);

  const activePreviewRows = useMemo(() => {
    if (selectedPreviewCode !== '__ORIGINAL__') {
      const matchedVer = exam.generatedVersions.find(
        (v) => v.code === selectedPreviewCode
      );
      if (matchedVer && matchedVer.answerKeyRows.length > 0) {
        return matchedVer.answerKeyRows.slice(0, 10).map((row, idx) => {
          const mapEntry = matchedVer.permutationMap[idx];
          const origNum = mapEntry?.originalOrderNumber ?? idx + 1;
          return {
            qNum: idx + 1,
            origLabel: `G${origNum}`,
            origCode: mapEntry?.originalCode ?? row.originalCode,
            moved: origNum !== idx + 1,
            ans: row.answer || '—',
          };
        });
      }
    }
    return exam.questions.slice(0, 10).map((q, idx) => {
      let ans = '—';
      if (q.type === 'mcq' && q.options) {
        const correctIdx = q.options.findIndex((o) => o.id === q.correctOptionId);
        ans = correctIdx >= 0 ? getOptionLetterLabel(correctIdx) : '?';
      } else if (q.type === 'true-false' && q.statements) {
        ans = q.statements.map((s) => (s.isTrue ? 'Đ' : 'S')).join('');
      } else if (q.type === 'short-answer' && q.shortAnswer) {
        ans = q.shortAnswer.answerValue;
      } else if (q.type === 'essay') {
        ans = 'TL';
      }
      return {
        qNum: idx + 1,
        origLabel: `G${idx + 1}`,
        origCode: q.code,
        moved: false,
        ans,
      };
    });
  }, [exam.generatedVersions, exam.questions, selectedPreviewCode]);

  const selectedVersionMovedCount = useMemo(() => {
    if (selectedPreviewCode === '__ORIGINAL__') return 0;
    const matchedVer = exam.generatedVersions.find((v) => v.code === selectedPreviewCode);
    if (!matchedVer) return 0;
    return matchedVer.permutationMap.filter(
      (m) => m.newOrderNumber !== m.originalOrderNumber
    ).length;
  }, [exam.generatedVersions, selectedPreviewCode]);

  const updateCountAndStartCode = (nextCount: number, nextStart: number) => {
    const clampedCount = Math.max(1, Math.min(MAX_EXAM_CODES, nextCount));
    const codes = Array.from({ length: clampedCount }, (_, i) =>
      String(nextStart + i)
    );
    onChangeExam({
      ...exam,
      mixConfig: {
        ...exam.mixConfig,
        examCount: clampedCount,
        startCodeNumber: nextStart,
        customCodeNames: codes,
      },
    });
  };

  const handleFileUpload = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      onShowToast('error', 'Tệp vượt quá dung lượng tối đa 50 MB.');
      return;
    }
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const subjectId = resolveSubjectId(exam.subjectId || exam.subject);
      const session = await runUniversalImportSession(
        {
          fileName: file.name,
          mimeType: file.type,
          buffer,
        },
        createId,
        {
          subjectId,
          renderPreviews: false,
        }
      );

      if (session.questions.length > 0) {
        const nextExam = commitUniversalImportSessionToProject(exam, session, {
          applySuggestedSubject: true,
          replaceExisting: true,
        });
        onChangeExam(nextExam);
        onShowToast(
          'success',
          `Đã nạp ${session.questions.length} câu hỏi từ "${file.name}".`
        );
      } else {
        onShowToast(
          'info',
          `Đã đọc tệp "${file.name}". Hãy kiểm tra chi tiết ở khung nhập đề bên dưới.`
        );
      }
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Không thể đọc tệp .docx.'
      );
    } finally {
      setImporting(false);
    }
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFileUpload(file);
  };

  const onDropFile = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileUpload(file);
  };

  const shuffleQuestionsEnabled = effectiveFlags.shuffleQuestions;
  const shuffleOptionsEnabled = effectiveFlags.shuffleMcqOptions;

  return (
    <section
      aria-label="Trộn đề nhanh"
      className="space-y-4"
    >
      {/* Top 2-column grid: Dropzone + Quick Config */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-stretch">
        {/* Left: .docx Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDropFile}
          className={`lg:col-span-6 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors ${
            dragActive
              ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50'
              : 'border-blue-300/80 dark:border-blue-800/80 bg-blue-50/30 dark:bg-slate-900/80'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pdf,.txt,.md,.html"
            onChange={onFileInputChange}
            className="hidden"
          />
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100/80 dark:bg-blue-950 text-blue-600 dark:text-blue-400 mb-3">
            <Upload className="h-6 w-6" aria-hidden="true" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Kéo thả file đề thi vào đây
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            hoặc nhấn để chọn file .docx
          </p>
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-colors disabled:opacity-60"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{importing ? 'Đang đọc file...' : 'Chọn file .docx'}</span>
          </button>
          <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
            Định dạng hỗ trợ: .docx · Dung lượng tối đa: 50 MB
          </p>
        </div>

        {/* Right: Quick Mix Config */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-2xs flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
                Số lượng mã đề
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {[4, 10, 20, 40].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => updateCountAndStartCode(preset, startCodeNum)}
                    className={`rounded-xl border px-3.5 py-1.5 text-xs font-mono-num font-bold transition-colors ${
                      examCount === preset
                        ? 'border-blue-600 bg-blue-600 text-white shadow-2xs'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={MAX_EXAM_CODES}
                  aria-label="Số lượng mã đề tùy chỉnh"
                  value={examCount}
                  onChange={(e) =>
                    updateCountAndStartCode(
                      Number.parseInt(e.target.value, 10) || 4,
                      startCodeNum
                    )
                  }
                  placeholder="Tùy chỉnh"
                  className="w-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-mono-num font-semibold text-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label
                htmlFor="quick-start-code"
                className="text-xs font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap"
              >
                Mã bắt đầu
              </label>
              <input
                id="quick-start-code"
                type="number"
                min={1}
                max={9999}
                value={startCodeNum}
                onChange={(e) =>
                  updateCountAndStartCode(
                    examCount,
                    Number.parseInt(e.target.value, 10) || 101
                  )
                }
                className="w-28 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-mono-num font-bold text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* 4 Independent Real Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <label className="flex items-center justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 px-3.5 py-2.5 cursor-pointer">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Đảo thứ tự câu hỏi
                </span>
                <input
                  type="checkbox"
                  checked={shuffleQuestionsEnabled}
                  onChange={(e) =>
                    onChangeExam({
                      ...exam,
                      mixConfig: applyMixToggleUpdate(exam.mixConfig, {
                        shuffleQuestions: e.target.checked,
                      }),
                      generatedVersions: [],
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 px-3.5 py-2.5 cursor-pointer">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Đảo phương án A/B/C/D
                </span>
                <input
                  type="checkbox"
                  checked={shuffleOptionsEnabled}
                  onChange={(e) =>
                    onChangeExam({
                      ...exam,
                      mixConfig: applyMixToggleUpdate(exam.mixConfig, {
                        shuffleMcqOptions: e.target.checked,
                      }),
                      generatedVersions: [],
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 px-3.5 py-2.5 cursor-pointer">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Giữ nguyên nhóm phụ thuộc
                </span>
                <input
                  type="checkbox"
                  checked={effectiveFlags.keepDependentGroups}
                  onChange={(e) =>
                    onChangeExam({
                      ...exam,
                      mixConfig: applyMixToggleUpdate(exam.mixConfig, {
                        keepDependentGroups: e.target.checked,
                      }),
                      subjectProfileOverrides: exam.subjectProfileOverrides
                        ? {
                            ...exam.subjectProfileOverrides,
                            lockSharedPassageGroups: e.target.checked,
                          }
                        : undefined,
                      generatedVersions: [],
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 px-3.5 py-2.5 cursor-pointer">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Chỉ trộn trong từng phần
                </span>
                <input
                  type="checkbox"
                  checked={effectiveFlags.shufflePerSectionOnly}
                  onChange={(e) =>
                    onChangeExam({
                      ...exam,
                      mixConfig: applyMixToggleUpdate(exam.mixConfig, {
                        shufflePerSectionOnly: e.target.checked,
                      }),
                      subjectProfileOverrides: exam.subjectProfileOverrides
                        ? {
                            ...exam.subjectProfileOverrides,
                            shufflePerSectionOnly: e.target.checked,
                          }
                        : undefined,
                      generatedVersions: [],
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </label>
            </div>

            {/* Live Eligibility Strip */}
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono-num">
                Đủ điều kiện đảo: <strong className="text-blue-700 dark:text-blue-300">{quickEligibility.eligibleQuestions}/{quickEligibility.totalQuestions}</strong> câu · Khóa: <strong>{quickEligibility.lockedQuestions}</strong> · Nhóm: <strong>{quickEligibility.dependentGroupCount}</strong>
              </span>
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                Math Lock &amp; Integrity luôn bật
              </span>
            </div>

            {quickEligibility.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{quickEligibility.warnings[0]}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Preview Card: Xem trước kết quả (Đề gốc vs Mã 101..104) */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Xem trước kết quả &amp; Thứ tự câu hỏi
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {exam.questions.length} câu hỏi trong đề ·{' '}
            {selectedPreviewCode === '__ORIGINAL__'
              ? 'Đang xem Đề gốc'
              : exam.generatedVersions.some((v) => v.code === selectedPreviewCode)
              ? `Mã ${selectedPreviewCode}: ${selectedVersionMovedCount}/${exam.questions.length} câu đổi vị trí`
              : 'Nhấn "Tạo mã đề" để xem thứ tự câu sau khi trộn'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-center">
          {/* Left: Đề gốc + Các mã đề sẽ tạo */}
          <div className="lg:col-span-5 space-y-2">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Chuyển đổi Đề gốc &amp; Các mã đề ({examCount})
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedPreviewCode('__ORIGINAL__')}
                className={`rounded-xl border px-3.5 py-2 text-left transition-all ${
                  selectedPreviewCode === '__ORIGINAL__'
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 hover:bg-white text-slate-700 dark:text-slate-200'
                }`}
              >
                <div className="text-[10px] font-medium opacity-75">Bản chuẩn</div>
                <div className="text-sm font-bold">Đề gốc</div>
              </button>
              {previewCodes.length === 0 && (
                <div className="flex items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Chưa tạo mã đề — nhấn "Tạo mã đề" để trộn thứ tự câu hỏi
                </div>
              )}
              {previewCodes.map((code) => {
                const isSelected = selectedPreviewCode === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setSelectedPreviewCode(code)}
                    className={`rounded-xl border px-3.5 py-2 text-left transition-all ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/80 dark:bg-blue-950/60 ring-1 ring-blue-500/40'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 hover:bg-white'
                    }`}
                  >
                    <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      Mã đề
                    </div>
                    <div className="text-sm font-mono-num font-bold text-blue-600 dark:text-blue-400">
                      {code}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Tóm tắt thứ tự câu gốc & đáp án */}
          <div className="lg:col-span-7 space-y-2">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {selectedPreviewCode === '__ORIGINAL__'
                ? 'Thứ tự & đáp án Đề gốc (10 câu đầu)'
                : `Thứ tự câu gốc & đáp án (Mã ${selectedPreviewCode})`}
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
              <table className="w-full text-center text-xs font-mono-num">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400">
                    <th className="px-2.5 py-1.5 font-semibold text-left">Câu mới</th>
                    {activePreviewRows.map((item) => (
                      <th key={item.qNum} className="px-2 py-1.5 font-semibold">
                        {item.qNum}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/60 text-[11px]">
                    <td className="px-2.5 py-1.5 text-left font-sans font-semibold text-slate-500">
                      Câu gốc
                    </td>
                    {activePreviewRows.map((item) => (
                      <td
                        key={item.qNum}
                        title={item.origCode}
                        className={`px-2 py-1.5 font-semibold ${
                          item.moved
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.origLabel}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-slate-100">
                    <td className="px-2.5 py-2 text-left font-sans font-semibold text-slate-500">
                      Đáp án
                    </td>
                    {activePreviewRows.map((item) => (
                      <td
                        key={item.qNum}
                        className="px-2 py-2 text-blue-600 dark:text-blue-400"
                      >
                        {item.ans}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onQuickPrint}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
          >
            <Printer className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>Xuất PDF</span>
          </button>

          <button
            type="button"
            onClick={() => void onRunQuickMix()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-2 text-xs font-semibold text-white shadow-2xs transition-colors"
          >
            <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tạo mã đề</span>
          </button>
        </div>
      </div>
    </section>
  );
}

