import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileText,
  Printer,
  Redo2,
  RefreshCw,
  Save,
  Undo2,
} from 'lucide-react';
import {
  LessonPack,
  PrintSettings,
  ValidationErrors,
} from '../types/lesson';
import {
  validateStep1,
  validateStep2,
  validateStep3,
  validateStep4,
} from '../utils/allocation';
import {
  StorageFailureInfo,
  classifyStorageError,
  exportJsonBackupFile,
} from '../utils/storageResilience';
import {
  AutosaveState,
  UndoRedoHistory,
  createHistoryState,
  pushHistoryState,
  redoHistoryState,
  undoHistoryState,
} from '../core/workspaceTabs';
import { Step1Metadata } from './wizard/Step1Metadata';
import { Step2Activities } from './wizard/Step2Activities';
import { Step3Questions } from './wizard/Step3Questions';
import { Step4Rubric } from './wizard/Step4Rubric';
import { Step5PrintPreview } from './wizard/Step5PrintPreview';
import { useOptionalTutorial } from './tutorial/TutorialProvider';

interface WizardViewProps {
  initialPack: LessonPack;
  settings: PrintSettings;
  temporaryMode?: boolean;
  onSavePack: (pack: LessonPack, silent?: boolean) => Promise<LessonPack>;
  onOpenSettings: () => void;
  onBackToLibrary: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onAutosaveStateChange?: (state: AutosaveState) => void;
}

const STEPS = [
  { num: 1, short: 'Thông tin chung' },
  { num: 2, short: 'Hoạt động' },
  { num: 3, short: 'Phiếu học tập' },
  { num: 4, short: 'Rubric' },
  { num: 5, short: 'Xem trước in' },
] as const;

export function WizardView({
  initialPack,
  settings,
  temporaryMode = false,
  onSavePack,
  onOpenSettings,
  onBackToLibrary,
  onDirtyChange,
  onAutosaveStateChange,
}: WizardViewProps) {
  const [pack, setPack] = useState<LessonPack>(initialPack);
  const [history, setHistory] = useState<UndoRedoHistory<LessonPack>>(() =>
    createHistoryState(initialPack)
  );
  const [step, setStep] = useState<number>(
    Math.min(5, Math.max(1, initialPack.lastStep || 1))
  );
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<StorageFailureInfo | null>(null);
  const [lastSavedText, setLastSavedText] = useState<string>('');
  const dirtyRef = useRef(false);
  const tutorial = useOptionalTutorial();

  const markDirty = (dirty: boolean) => {
    dirtyRef.current = dirty;
    onDirtyChange?.(dirty);
    if (dirty) {
      onAutosaveStateChange?.('dirty');
    }
  };

  useEffect(() => {
    setPack(initialPack);
    setHistory(createHistoryState(initialPack));
    setStep(Math.min(5, Math.max(1, initialPack.lastStep || 1)));
    setErrors({});
    setSaveError(null);
    markDirty(false);
    onAutosaveStateChange?.('saved');
  }, [initialPack.id]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || saveError !== null) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveError]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(async () => {
      try {
        setSaving(true);
        onAutosaveStateChange?.('saving');
        const saved = await onSavePack({ ...pack, lastStep: step }, true);
        setPack((prev) => ({ ...prev, updatedAt: saved.updatedAt }));
        markDirty(false);
        setSaveError(null);
        onAutosaveStateChange?.('saved');
        const time = new Date(saved.updatedAt).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setLastSavedText(
          temporaryMode ? `Đã giữ tạm lúc ${time}` : `Đã tự lưu lúc ${time}`
        );
      } catch (err) {
        markDirty(true);
        setSaveError(classifyStorageError(err));
        onAutosaveStateChange?.('error');
      } finally {
        setSaving(false);
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [pack, step, onSavePack, temporaryMode, onAutosaveStateChange]);

  const handlePackChange = (updater: (prev: LessonPack) => LessonPack) => {
    markDirty(true);
    setPack((prev) => {
      const next = updater(prev);
      setHistory((h) => pushHistoryState(h, next));
      return next;
    });
  };

  const handleUndo = () => {
    if (history.past.length === 0) return;
    const nextHist = undoHistoryState(history);
    setHistory(nextHist);
    setPack(nextHist.present);
    markDirty(true);
  };

  const handleRedo = () => {
    if (history.future.length === 0) return;
    const nextHist = redoHistoryState(history);
    setHistory(nextHist);
    setPack(nextHist.present);
    markDirty(true);
  };

  const validateCurrentStep = (targetStep: number): ValidationErrors => {
    if (targetStep === 1) return validateStep1(pack);
    if (targetStep === 2) return validateStep2(pack);
    if (targetStep === 3) return validateStep3(pack);
    if (targetStep === 4) return validateStep4(pack);
    return {};
  };

  const handleManualSave = async (nextStatus?: LessonPack['status']) => {
    setSaving(true);
    onAutosaveStateChange?.('saving');
    try {
      const payload: LessonPack = {
        ...pack,
        status: nextStatus ?? pack.status,
        lastStep: step,
      };
      const saved = await onSavePack(payload, false);
      setPack(saved);
      markDirty(false);
      setSaveError(null);
      onAutosaveStateChange?.('saved');
      const time = new Date(saved.updatedAt).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      });
      setLastSavedText(
        temporaryMode ? `Đã giữ tạm lúc ${time}` : `Đã lưu lúc ${time}`
      );
    } catch (err) {
      markDirty(true);
      setSaveError(classifyStorageError(err));
      onAutosaveStateChange?.('error');
    } finally {
      setSaving(false);
    }
  };

  const handleEmergencyExport = () => {
    exportJsonBackupFile(
      [{ ...pack, lastStep: step }],
      settings,
      'teacheros-ban-nhap-khan-cap'
    );
  };

  const goToStep = async (nextStep: number) => {
    if (nextStep > step) {
      const stepErrors = validateCurrentStep(step);
      const blockingErrors = { ...stepErrors };
      if (step === 3) {
        for (const key of Object.keys(blockingErrors)) {
          if (key.startsWith('variant_') && key.endsWith('_shortfall')) {
            delete blockingErrors[key];
          }
        }
      }
      if (step === 4) {
        delete blockingErrors.weightSum;
      }
      if (Object.keys(blockingErrors).length > 0) {
        setErrors(stepErrors);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }

    setErrors({});
    setStep(nextStep);
    markDirty(true);
    tutorial?.emitTutorialEvent('lesson-wizard-step-changed');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleMarkCompleted = async () => {
    await handleManualSave('completed');
  };

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // Compute live Document Inspector readiness checklist
  const inspectorChecks = useMemo(() => {
    const step1Valid =
      pack.title.trim().length > 0 &&
      pack.subject.trim().length > 0 &&
      pack.grade.trim().length > 0 &&
      pack.objectives.some((o) => o.trim().length > 0);

    const totalMinutes = pack.activities.reduce((sum, a) => sum + (Number(a.durationMinutes) || 0), 0);
    const step2Valid =
      pack.activities.length > 0 && totalMinutes === pack.duration;

    const step3Valid = pack.questions.length >= 6;

    const rubricWeightSum = pack.rubric.reduce((sum, r) => sum + (Number(r.weightPercent) || 0), 0);
    const step4Valid = pack.rubric.length >= 2 && rubricWeightSum === 100;

    const items = [
      {
        id: 'info',
        stepNum: 1,
        label: 'Thông tin bài dạy đầy đủ',
        detail: step1Valid
          ? `${pack.subject} · ${pack.grade} (${pack.objectives.filter((o) => o.trim()).length} mục tiêu)`
          : 'Cần bổ sung tên bài hoặc mục tiêu bài dạy',
        passed: step1Valid,
      },
      {
        id: 'activities',
        stepNum: 2,
        label: 'Có hoạt động dạy học',
        detail: `${pack.activities.length} hoạt động · ${totalMinutes}/${pack.duration} phút`,
        passed: step2Valid,
      },
      {
        id: 'worksheet',
        stepNum: 3,
        label: 'Có phiếu học tập',
        detail: `${pack.questions.length} câu hỏi phân hóa (Đề A/B/C)`,
        passed: step3Valid,
      },
      {
        id: 'rubric',
        stepNum: 4,
        label: 'Có rubric đánh giá',
        detail: `${pack.rubric.length} tiêu chí · Tổng trọng số ${rubricWeightSum}%`,
        passed: step4Valid,
      },
    ];

    const passedCount = items.filter((i) => i.passed).length;
    const readinessPercent = Math.round((passedCount / items.length) * 100);

    return { items, passedCount, readinessPercent };
  }, [pack]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 space-y-5 print:max-w-none print:m-0 print:p-0 print:space-y-0">
      {/* Top Lesson Summary Card & Tab Strip (hidden when printing) */}
      <div className="no-print rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 border border-blue-200/70 dark:border-blue-800/70">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                  Bài: {pack.title.trim() || 'Bộ tiết dạy mới'}
                </h2>
                {pack.isDemo && (
                  <span className="rounded-md bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    DEMO
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {pack.subject || 'Chưa chọn môn'} · {pack.grade || 'Chưa chọn lớp'}
                </span>
                <span aria-hidden="true">|</span>
                <span className="font-mono-num">
                  {pack.duration === 90 ? '2 tiết (90 phút)' : '1 tiết (45 phút)'}
                </span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={onBackToLibrary}
                  className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                  <span>Kho bộ tiết dạy</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 shrink-0">
            <div className="min-w-[180px] rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 px-3.5 py-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-400">
                  Mức hoàn thiện
                </span>
                <span className="font-mono-num font-bold text-blue-600 dark:text-blue-400">
                  {inspectorChecks.readinessPercent}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${inspectorChecks.readinessPercent}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {lastSavedText && !saveError && (
                <span className="hidden xl:inline text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                  {lastSavedText}
                </span>
              )}

              <div
                role="group"
                aria-label="Hoàn tác và Làm lại chỉnh sửa"
                className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5"
              >
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  aria-label="Hoàn tác thao tác vừa sửa"
                  title="Hoàn tác (Undo)"
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Hoàn tác</span>
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  aria-label="Làm lại thao tác vừa hoàn tác"
                  title="Làm lại (Redo)"
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
                >
                  <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Làm lại</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Clean 5-Tab Bar matching Reference Image 4 */}
        <nav
          aria-label="Các bước soạn bộ tiết dạy"
          data-tour-id="ls-wizard-nav"
          className="border-t border-slate-100 dark:border-slate-800 pt-3.5"
        >
          <ol className="flex flex-wrap items-center gap-2">
            {STEPS.map((s) => {
              const isCurrent = step === s.num;
              const isDone = step > s.num;
              return (
                <li key={s.num} className="flex-1 min-w-[130px]">
                  <button
                    type="button"
                    onClick={() => goToStep(s.num)}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all focus-visible:outline-2 focus-visible:outline-blue-600 ${
                      isCurrent
                        ? 'border-blue-600 bg-blue-600 text-white shadow-2xs'
                        : isDone
                        ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700'
                        : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-mono-num font-bold ${
                        isCurrent
                          ? 'bg-white/20 text-white'
                          : isDone
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {isDone ? <Check className="h-3 w-3" aria-hidden="true" /> : s.num}
                    </span>
                    <span className="truncate">{s.short}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {saveError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/60 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-2.5 text-xs text-red-900 dark:text-red-100">
              <AlertTriangle className="h-4 w-4 text-red-700 dark:text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-semibold">
                  {saveError.title} — dữ liệu bạn đang nhập vẫn được giữ trên màn hình
                </p>
                <p>{saveError.message}</p>
                <p className="text-red-800 dark:text-red-200">{saveError.guidance}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleManualSave()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-red-900 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-950 whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Thử lưu lại</span>
              </button>
              <button
                type="button"
                onClick={handleEmergencyExport}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-900 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Xuất JSON khẩn cấp</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area: 2-column with Document Inspector for steps 1-4; full width for step 5 A4 print preview */}
      <div
        className={
          step < 5
            ? 'grid grid-cols-1 gap-6 lg:grid-cols-12 items-start'
            : 'block'
        }
      >
        <div
          data-tour-id="ls-wizard-content"
          className={`${
            step < 5 ? 'lg:col-span-8' : ''
          } rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-2xs print:border-none print:p-0 print:rounded-none print:shadow-none`}
        >
          {step === 1 && (
            <Step1Metadata pack={pack} errors={errors} onChange={handlePackChange} />
          )}
          {step === 2 && (
            <Step2Activities pack={pack} errors={errors} onChange={handlePackChange} />
          )}
          {step === 3 && (
            <Step3Questions pack={pack} errors={errors} onChange={handlePackChange} />
          )}
          {step === 4 && (
            <Step4Rubric pack={pack} errors={errors} onChange={handlePackChange} />
          )}
          {step === 5 && (
            <Step5PrintPreview
              pack={pack}
              settings={settings}
              onMarkCompleted={handleMarkCompleted}
              onOpenSettings={onOpenSettings}
            />
          )}

          {/* Bottom Wizard Navigation inside Editor Card */}
          <div className="no-print mt-6 flex items-center justify-between gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => goToStep(Math.max(1, step - 1))}
              disabled={step === 1}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Quay lại</span>
            </button>

            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
              Bước {step} / 5
            </div>

            {step < 5 ? (
              <button
                type="button"
                onClick={() => goToStep(step + 1)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shadow-2xs"
              >
                <span>Tiếp tục bước {step + 1}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleManualSave('completed')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shadow-2xs"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Lưu &amp; Hoàn tất</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Sticky Sidebar: Kiểm tra bài dạy (Document Inspector) matching Reference Image 4 */}
        {step < 5 && (
          <aside
            aria-label="Kiểm tra bài dạy"
            className="no-print lg:col-span-4 lg:sticky lg:top-20 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-4"
          >
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Kiểm tra bài dạy
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Rà soát tiêu chuẩn giáo án trước khi xuất bản &amp; in A4
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Mức sẵn sàng
                </span>
                <span className="font-mono-num text-sm font-bold text-blue-600 dark:text-blue-400">
                  {inspectorChecks.readinessPercent}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${inspectorChecks.readinessPercent}%` }}
                />
              </div>
            </div>

            <ul className="space-y-2">
              {inspectorChecks.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => goToStep(item.stepNum)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      step === item.stepNum
                        ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {item.passed ? (
                        <CheckCircle2
                          className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <AlertCircle
                          className="h-4 w-4 text-amber-500 dark:text-amber-400 mt-0.5 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {item.label}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {item.detail}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="pt-2 space-y-2.5 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => void handleManualSave()}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white shadow-2xs transition-colors disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{saving ? 'Đang lưu bài dạy...' : 'Lưu bài dạy'}</span>
              </button>

              <button
                type="button"
                onClick={() => goToStep(5)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                <Printer className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Xem trước in</span>
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
