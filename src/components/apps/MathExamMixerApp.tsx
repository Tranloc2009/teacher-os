import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Copy,
  Download,
  FilePlus2,
  HelpCircle,
  Lock,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { ContextualAcademyBar } from '../tutorial/ContextualAcademyBar';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { Button, PageBanner } from '../ui/DesignSystem';
import {
  COGNITIVE_LEVEL_LABELS,
  CognitiveLevel,
  MATH_QUESTION_TYPE_LABELS,
  MATH_TOPICS,
  MIX_LEVEL_DESCRIPTIONS,
  MathExamProject,
  MathExamStep,
  MathIntegrityReport,
  MathQuestionType,
  MixLevel,
} from '../../types/mathExam';
import {
  auditOriginalExamIntegrity,
  computeLockStats,
  createOriginalExamSnapshot,
  estimateMaxDistinctPermutations,
  evaluatePreMixIntegrity,
  verifyMixedExamIntegrity,
} from '../../core/mathIntegrity';
import {
  EXAM_CODE_PRESETS,
  MAX_EXAM_CODES,
  buildDefaultMatrixRules,
  generateMixedExams,
  validateMixConfiguration,
} from '../../core/mathShuffleEngine';
import { createEmptyMathExamProject } from '../../data/demoMathExams';
import { createId } from '../../db/database';
import { MathExamEditor } from '../math/MathExamEditor';
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
  { step: 1, label: '1. Nhập đề thi' },
  { step: 2, label: '2. Xác nhận đáp án gốc' },
  { step: 3, label: '3. Thiết lập quy tắc trộn' },
  { step: 4, label: '4. Kiểm tra mã đề' },
  { step: 5, label: '5. Tổng quan xuất đề' },
];

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
  const [step4ViewMode, setStep4ViewMode] = useState<'compare' | 'answer-matrix'>('compare');
  const [codeBatchPage, setCodeBatchPage] = useState<number>(0);
  const [mixErrors, setMixErrors] = useState<string[]>([]);
  const [mixWarnings, setMixWarnings] = useState<string[]>([]);
  const tutorial = useOptionalTutorial();

  useEffect(() => {
    if (tutorial?.activeTutorial?.tutorialId !== 'tutorial.math-mixer') return;
    const sid = tutorial.currentStep?.stepId;
    if ((sid === 'math-step-overview' || sid === 'math-lock-controls') && step !== 1) {
      setStep(1);
    } else if (sid === 'math-mix-rules' && step !== 3) {
      setStep(3);
    } else if (sid === 'math-verify-export' && step !== 5) {
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
    onShowToast('success', 'Đã tạo đề kiểm tra Toán mới.');
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

    const res = generateMixedExams(activeExam);
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
    setCodeBatchPage(0);
    setStep(4);
    onShowToast(
      'success',
      `Đã tạo và kiểm chứng toàn vẹn ${res.versions.length} mã đề.`
    );
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
    const anyBlocked = activeExam.generatedVersions.some(
      (v) => !v.integrityPassed || v.integrityStatus === 'BLOCKED'
    );
    if (anyBlocked || preMixReport?.status === 'BLOCKED') {
      onShowToast('error', 'Xuất đề bị chặn do phát hiện lỗi toàn vẹn BLOCKED.');
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      title: activeExam.title,
      grade: activeExam.grade,
      durationMinutes: activeExam.durationMinutes,
      versions: activeExam.generatedVersions.map((v) => ({
        code: v.code,
        integrityStatus: v.integrityStatus ?? 'PASS',
        answerKeyRows: v.answerKeyRows,
        questions: v.questions,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `math-exam-codes-${activeExam.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast('success', 'Đã xuất tệp JSON bộ mã đề đã kiểm chứng.');
  };

  if (!activeExam) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center space-y-3">
          <h1 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
            Math Exam Mixer Pro — Chưa có đề thi Toán nào
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Khởi tạo đề kiểm tra Toán học theo cấu trúc GDPT 2018 (4 dạng câu hỏi, hỗ trợ LaTeX &amp; KaTeX ngoại tuyến).
          </p>
          <Button variant="primary" onClick={() => void handleCreateExam()}>
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            <span>Tạo đề kiểm tra Toán mới</span>
          </Button>
        </div>
      </main>
    );
  }

  const activeVersion =
    activeExam.generatedVersions.find((v) => v.code === selectedCodeTab) ??
    activeExam.generatedVersions[0] ??
    null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <ContextualAcademyBar
        tutorialId="tutorial.math-mixer"
        label="Math Exam Mixer Pro"
        description="Khóa vị trí câu/phương án bằng Math Lock và kiểm chứng 6 hạng mục trước khi xuất mã đề."
      />

      <PageBanner
        tourId="math-header"
        title="Math Exam Mixer Pro"
        subtitle="Hoán vị khối dữ liệu bất biến theo ID · Khóa Math Lock · Bảo toàn 100% công thức toán học và đáp án gốc."
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
                          value={rule.type}
                          onChange={(e) =>
                            handleExamChange({
                              ...activeExam,
                              mixConfig: {
                                ...activeExam.mixConfig,
                                matrixRules: activeExam.mixConfig.matrixRules.map((r) =>
                                  r.id === rule.id
                                    ? { ...r, type: e.target.value as MathQuestionType }
                                    : r
                                ),
                              },
                            })
                          }
                          className="sm:col-span-3 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
                        >
                          {Object.entries(MATH_QUESTION_TYPE_LABELS).map(([k, lbl]) => (
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
                          {MATH_TOPICS.map((t) => (
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
                  disabled={configIssues.some((i) => i.severity === 'error')}
                  onClick={() => void handleRunShuffle()}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Trộn đề &amp; Kiểm chứng toàn vẹn</span>
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

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep4ViewMode('compare')}
                    className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                      step4ViewMode === 'compare'
                        ? 'border-slate-900 dark:border-slate-200 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    So sánh Đề gốc ↔ Mã đề
                  </button>
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

              {step4ViewMode === 'answer-matrix' ? (() => {
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
                                  {COGNITIVE_LEVEL_LABELS[mixedQ.cognitiveLevel]}
                                </span>
                              </div>
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
                              {origQ?.type === 'mcq' && origQ.options && (
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
                              {mixedQ.type === 'mcq' && mixedQ.options && (
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
                              {mixedQ.type === 'short-answer' && mixedQ.universalType === 'matching' && mixedQ.matching && (
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
                                          {String.fromCharCode(97 + rIdx)}.
                                        </span>
                                        <MathContentRenderer payload={ri.content} />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {mixedQ.type === 'short-answer' && mixedQ.universalType === 'ordering' && mixedQ.ordering && (
                                <div className="space-y-0.5 pt-1 text-[11px]">
                                  {mixedQ.ordering.items.map((it, oIdx) => (
                                    <div key={it.id}>
                                      <span className="font-mono-num font-bold mr-1">
                                        {String.fromCharCode(97 + oIdx)}.
                                      </span>
                                      <MathContentRenderer payload={it.content} />
                                    </div>
                                  ))}
                                </div>
                              )}
                              {mixedQ.type === 'short-answer' &&
                                mixedQ.universalType !== 'matching' &&
                                mixedQ.universalType !== 'ordering' &&
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

      {/* Step 5: Pre-Export Integrity Verification Table & Gate */}
      {step === 5 && (() => {
        const versions = activeExam.generatedVersions;
        const blockedVersion = versions.find(
          (v) => !v.integrityPassed || v.integrityStatus === 'BLOCKED' || v.integrityReport?.canExport === false
        );
        const warningVersion = versions.find((v) => v.integrityStatus === 'WARNING');
        const exportReport: MathIntegrityReport | null =
          blockedVersion?.integrityReport ??
          warningVersion?.integrityReport ??
          versions[0]?.integrityReport ??
          preMixReport;
        const canExport =
          versions.length > 0 &&
          !blockedVersion &&
          preMixReport?.status !== 'BLOCKED';

        return (
          <div className="space-y-4">
            <div
              data-tour-id="math-export-gate"
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-950 dark:text-slate-50">
                    <Printer className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    <span>Bước 5: Kiểm chứng trước khi xuất đề &amp; In A4</span>
                    {exportReport && <MathIntegrityBadge status={exportReport.status} />}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl">
                    Mọi mã đề phải vượt qua 6 hạng mục kiểm tra toàn vẹn (công thức, hình vẽ/bảng biến thiên, cấu trúc ID, đáp án, quy tắc khóa, bố cục A4) trước khi cho phép xuất hoặc in.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(4)}
                    className="rounded-[10px] border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    Quay lại đối soát mã đề
                  </button>
                  <button
                    type="button"
                    disabled={!canExport}
                    onClick={handleExportMixedBundleJson}
                    className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Xuất bộ mã đề (JSON)</span>
                  </button>
                </div>
              </div>

              {!canExport && versions.length > 0 && (
                <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50/80 dark:bg-red-950/50 p-3.5 text-xs text-red-900 dark:text-red-200 flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <div className="font-semibold">
                      Xuất đề bị CHẶN (BLOCKED) vì phát hiện lỗi toàn vẹn Toán học hoặc vi phạm Math Lock.
                    </div>
                    <p className="mt-0.5">
                      Vui lòng xử lý toàn bộ mục [BLOCKED] bên dưới và bấm "Kiểm tra toàn vẹn" lại trước khi xuất bản.
                    </p>
                  </div>
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
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCodeTab(ver.code);
                                setStep(4);
                              }}
                              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              Xem đối soát mã {ver.code}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {exportReport && (
              <MathIntegrityReportPanel
                report={exportReport}
                title="Bảng kiểm tra toàn vẹn trước khi xuất đề (Pre-Export Verification)"
                onManualCheck={() => void handleReverifyVersions()}
              />
            )}
          </div>
        );
      })()}
    </main>
  );
}
