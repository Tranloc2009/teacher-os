import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
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
  { num: 1, short: 'Thông tin & Mục tiêu' },
  { num: 2, short: 'Hoạt động 5–15p' },
  { num: 3, short: 'Câu hỏi & Phân bổ' },
  { num: 4, short: 'Biên tập Rubric' },
  { num: 5, short: 'Xem trước & In A4' },
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

  // Sync if user opens a different pack from Library or Home
  useEffect(() => {
    setPack(initialPack);
    setHistory(createHistoryState(initialPack));
    setStep(Math.min(5, Math.max(1, initialPack.lastStep || 1)));
    setErrors({});
    setSaveError(null);
    markDirty(false);
    onAutosaveStateChange?.('saved');
  }, [initialPack.id]);

  // Cảnh báo trình duyệt nếu rời trang khi còn dữ liệu chưa lưu xuống IndexedDB
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

  // Debounced autosave to IndexedDB (only when dirty, deduplicated by pack.id)
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
        // Giữ nguyên dữ liệu người dùng đang nhập và đánh dấu chưa lưu để không mất nội dung
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
    // When moving forward, validate the step being exited
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 space-y-6 print:max-w-none print:m-0 print:p-0 print:space-y-0">
      {/* Top Wizard Header (hidden when printing) */}
      <div className="no-print flex flex-col gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={onBackToLibrary}
              className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Kho của tôi</span>
            </button>
            <span aria-hidden="true">/</span>
            <span className="text-slate-900 dark:text-slate-100 font-medium truncate max-w-[260px] sm:max-w-md">
              {pack.title.trim() || 'Bộ tiết dạy mới'}
            </span>
            {pack.isDemo && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  Bộ mẫu DEMO
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{pack.status === 'completed' ? 'Hoàn thành' : 'Bản nháp'}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {lastSavedText && !saveError && (
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">{lastSavedText}</span>
            )}
            {saveError && (
              <span className="text-xs font-medium text-red-700 dark:text-red-400">
                Chưa lưu được vào IndexedDB
              </span>
            )}

            {/* Undo / Redo Controls */}
            <div
              role="group"
              aria-label="Hoàn tác và Làm lại chỉnh sửa"
              className="inline-flex items-center rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5"
            >
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                aria-label="Hoàn tác thao tác vừa sửa"
                title="Hoàn tác (Undo)"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
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
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
              >
                <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Làm lại</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleManualSave()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 whitespace-nowrap"
            >
              <Save className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>{saving ? 'Đang lưu...' : 'Lưu ngay'}</span>
            </button>
          </div>
        </div>

        {/* 5-Step Progress Bar */}
        <nav aria-label="Các bước soạn bộ tiết dạy" data-tour-id="ls-wizard-nav">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {STEPS.map((s) => {
              const isCurrent = step === s.num;
              const isDone = step > s.num;
              return (
                <li key={s.num}>
                  <button
                    type="button"
                    onClick={() => goToStep(s.num)}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                      isCurrent
                        ? 'border-blue-600 bg-blue-600 dark:bg-blue-600 dark:border-blue-500 text-white'
                        : isDone
                        ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-mono-num font-semibold ${
                        isCurrent
                          ? 'bg-white/20 text-white'
                          : isDone
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
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

      {/* Active Step Panel */}
      <div
        data-tour-id="ls-wizard-content"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 print:border-none print:p-0 print:rounded-none"
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
      </div>

      {/* Bottom Wizard Navigation (hidden when printing) */}
      <div className="no-print flex items-center justify-between gap-4 border-t border-slate-200 dark:border-slate-800 pt-4">
        <button
          type="button"
          onClick={() => goToStep(Math.max(1, step - 1))}
          disabled={step === 1}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Quay lại</span>
        </button>

        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
          Bước {step} / 5
        </div>

        {step < 5 ? (
          <button
            type="button"
            onClick={() => goToStep(step + 1)}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 whitespace-nowrap"
          >
            <span>Tiếp tục bước {step + 1}</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => handleManualSave('completed')}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            <span>Lưu &amp; Hoàn tất</span>
          </button>
        )}
      </div>
    </div>
  );
}
