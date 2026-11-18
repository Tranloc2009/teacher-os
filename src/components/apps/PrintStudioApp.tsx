import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  HelpCircle,
  Printer,
} from 'lucide-react';
import {
  LessonPack,
  MarginPreset,
  PrintSettings,
} from '../../types/lesson';
import {
  allocateThreeWorksheets,
  calculateActivityMinutes,
  normalizeWorksheetVariants,
} from '../../utils/allocation';
import { ContextualAcademyBar } from '../tutorial/ContextualAcademyBar';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { Step5PrintPreview } from '../wizard/Step5PrintPreview';
import { Button, PageBanner } from '../ui/DesignSystem';

interface PrintStudioAppProps {
  packs: LessonPack[];
  selectedPack: LessonPack;
  settings: PrintSettings;
  onSelectPackId: (id: string) => void;
  onMarkCompleted: (pack: LessonPack) => void;
  onOpenSettings: () => void;
  onOpenInLessonStudio: (pack: LessonPack) => void;
  onQuickUpdateSettings?: (next: PrintSettings) => Promise<void>;
}

export function PrintStudioApp({
  packs,
  selectedPack,
  settings,
  onSelectPackId,
  onMarkCompleted,
  onOpenSettings,
  onOpenInLessonStudio,
  onQuickUpdateSettings,
}: PrintStudioAppProps) {
  const [showInspector, setShowInspector] = useState(true);
  const tutorial = useOptionalTutorial();

  useEffect(() => {
    if (
      tutorial?.activeTutorial?.tutorialId === 'tutorial.print-studio' &&
      tutorial.currentStep?.stepId === 'ps-inspector-check' &&
      !showInspector
    ) {
      setShowInspector(true);
    }
  }, [
    showInspector,
    tutorial?.activeTutorial?.tutorialId,
    tutorial?.currentStep?.stepId,
  ]);

  const totalMinutes = calculateActivityMinutes(selectedPack);
  const variants = normalizeWorksheetVariants(selectedPack);
  const allocatedVariants = allocateThreeWorksheets(selectedPack.questions, variants);
  const shortfallCount = allocatedVariants.reduce(
    (sum, v) => sum + v.allocated.warnings.length,
    0
  );
  const rubricWeightSum = selectedPack.rubric.reduce(
    (sum, r) => sum + (Number(r.weightPercent) || 0),
    0
  );

  const inspectorChecks = [
    {
      id: 'meta',
      label: 'Thông tin bài & Mục tiêu',
      ok:
        Boolean(selectedPack.title.trim()) &&
        selectedPack.objectives.filter((o) => o.trim()).length > 0,
      detail: `${selectedPack.objectives.filter((o) => o.trim()).length} mục tiêu đã nhập`,
    },
    {
      id: 'time',
      label: 'Thời lượng chuỗi hoạt động',
      ok: totalMinutes === selectedPack.duration,
      detail: `${totalMinutes} / ${selectedPack.duration} phút`,
    },
    {
      id: 'questions',
      label: 'Ngân hàng câu hỏi 3 mức',
      ok: selectedPack.questions.length >= 3,
      detail: `${selectedPack.questions.length} câu (CB: ${
        selectedPack.questions.filter((q) => q.tier === 'basic').length
      }, VD: ${
        selectedPack.questions.filter((q) => q.tier === 'applied').length
      }, MR: ${
        selectedPack.questions.filter((q) => q.tier === 'extended').length
      })`,
    },
    {
      id: 'worksheets',
      label: 'Độ phủ 3 mẫu phiếu A / B / C',
      ok: shortfallCount === 0,
      detail:
        shortfallCount === 0
          ? 'Đủ câu hỏi cho cả 3 phiếu'
          : `Thiếu câu hỏi ở ${shortfallCount} mức phân bổ`,
    },
    {
      id: 'rubric',
      label: 'Rubric quá trình (3–5 tiêu chí)',
      ok:
        selectedPack.rubric.length >= 3 &&
        selectedPack.rubric.length <= 5 &&
        rubricWeightSum === 100,
      detail: `${selectedPack.rubric.length} tiêu chí · Tổng tỷ trọng ${rubricWeightSum}%`,
    },
    {
      id: 'margins',
      label: 'Khổ giấy A4 & Lề an toàn',
      ok:
        settings.marginsMm.top >= 5 &&
        settings.marginsMm.right >= 5 &&
        settings.marginsMm.bottom >= 5 &&
        settings.marginsMm.left >= 5,
      detail: `A4 · Lề ${settings.marginsMm.top}/${settings.marginsMm.right}/${settings.marginsMm.bottom}/${settings.marginsMm.left} mm`,
    },
  ];

  const passedCount = inspectorChecks.filter((c) => c.ok).length;

  const handleQuickMarginPreset = (preset: Exclude<MarginPreset, 'custom'>) => {
    tutorial?.emitTutorialEvent('print-inspector-or-margin-used');
    if (!onQuickUpdateSettings) return;
    const mm = preset === 'narrow' ? 10 : preset === 'wide' ? 20 : 15;
    void onQuickUpdateSettings({
      ...settings,
      marginPreset: preset,
      marginsMm: { top: mm, right: mm, bottom: mm, left: mm },
    });
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6 print:max-w-none print:m-0 print:p-0 print:space-y-0">
      <div className="no-print space-y-5">
        <ContextualAcademyBar
          tutorialId="tutorial.print-studio"
          label="Print Studio"
          description="Rà soát 6 hạng mục trước khi in, đổi nhanh lề A4 và xuất PDF từng mẫu phiếu."
        />

        <PageBanner
          title="Print Studio"
          subtitle="Xem trước, kiểm tra cấu trúc hồ sơ A4 và tùy chỉnh lề nhanh chóng trước khi in hoặc xuất PDF."
          icon={<Printer className="h-5 w-5" aria-hidden="true" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {tutorial && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-tour-id="ps-help-btn"
                  onClick={() =>
                    tutorial.startTutorial('tutorial.print-studio', { restart: true })
                  }
                  aria-label="Hướng dẫn sử dụng Print Studio"
                >
                  <HelpCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <span>Hướng dẫn</span>
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                data-tour-id="ps-inspector-toggle"
                onClick={() => {
                  setShowInspector((prev) => !prev);
                  tutorial?.emitTutorialEvent('print-inspector-or-margin-used');
                }}
              >
                <ClipboardCheck className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span className="font-mono-num">
                  Kiểm tra trước in ({passedCount}/{inspectorChecks.length})
                </span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onOpenInLessonStudio(selectedPack)}
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Chỉnh sửa bài dạy</span>
              </Button>
            </div>
          }
        />

        {/* Print Center Top Control Card */}
        <div
          data-tour-id="ps-topbar"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5 flex-1 min-w-0">
              <label
                htmlFor="print-studio-pack-select"
                className="block text-xs font-semibold text-slate-600 dark:text-slate-400"
              >
                Bộ tiết dạy đang xem trước &amp; xuất bản A4
              </label>
              <select
                id="print-studio-pack-select"
                data-tour-id="ps-pack-select"
                value={selectedPack.id}
                onChange={(e) => onSelectPackId(e.target.value)}
                className="w-full max-w-xl rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
              >
                {packs.length === 0 ? (
                  <option value={selectedPack.id}>
                    {selectedPack.title || '(Bộ tiết dạy mới chưa đặt tên)'}
                  </option>
                ) : (
                  packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title || '(Chưa đặt tên)'} — {p.subject} ({p.grade})
                    </option>
                  ))
                )}
              </select>
            </div>

            {onQuickUpdateSettings && (
              <div
                data-tour-id="ps-margin-presets"
                className="flex flex-wrap items-center gap-1.5 text-xs shrink-0"
              >
                <span className="text-slate-500 dark:text-slate-400 mr-1">Lề A4:</span>
                {(
                  [
                    { id: 'narrow', label: 'Hẹp 10mm' },
                    { id: 'standard', label: 'Chuẩn 15mm' },
                    { id: 'wide', label: 'Rộng 20mm' },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleQuickMarginPreset(p.id)}
                    className={`rounded-[10px] border px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                      settings.marginPreset === p.id
                        ? 'border-blue-600 bg-blue-600 dark:bg-blue-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Document Inspector Panel */}
          {showInspector && (
            <div
              data-tour-id="ps-inspector-panel"
              aria-label="Document Inspector — Kiểm tra chất lượng tài liệu trước khi in"
              className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Kiểm tra trước khi in · 6 hạng mục hồ sơ A4
                </span>
                <span className="font-mono-num text-slate-500 dark:text-slate-400">
                  Đạt {passedCount}/{inspectorChecks.length}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {inspectorChecks.map((chk) => (
                  <div
                    key={chk.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-3 flex items-start gap-2.5 text-xs"
                  >
                    {chk.ok ? (
                      <CheckCircle2
                        className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertTriangle
                        className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {chk.label}
                      </p>
                      <p className="text-slate-600 dark:text-slate-400 font-mono-num truncate">
                        {chk.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        data-tour-id="ps-preview-card"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 print:border-none print:p-0 print:rounded-none"
      >
        <Step5PrintPreview
          pack={selectedPack}
          settings={settings}
          onMarkCompleted={() => onMarkCompleted(selectedPack)}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </main>
  );
}
