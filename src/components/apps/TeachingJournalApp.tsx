import { FormEvent, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Calendar,
  ChevronRight,
  Clock,
  HelpCircle,
  Lightbulb,
  PlayCircle,
  Plus,
  Save,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { ContextualAcademyBar } from '../tutorial/ContextualAcademyBar';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { Button, PageBanner } from '../ui/DesignSystem';
import {
  JournalEntry,
  LessonPack,
  PacingRating,
} from '../../types/lesson';
import { createId } from '../../db/database';

interface TeachingJournalAppProps {
  journals: JournalEntry[];
  packs: LessonPack[];
  activePack: LessonPack;
  onSaveJournal: (entry: JournalEntry) => Promise<void>;
  onDeleteJournal: (id: string) => Promise<void>;
  onApplyAdjustmentToPack: (entry: JournalEntry) => Promise<void>;
  onOpenPackInStudio: (pack: LessonPack) => void;
}

const PACING_SHORT_LABELS: Record<PacingRating, string> = {
  'thieu-gio': 'Thiếu giờ',
  'vua-khit': 'Vừa khít',
  'du-gio': 'Dư giờ',
};

const EFFECTIVENESS_LABELS: Record<number, string> = {
  1: '1/5 — Cần điều chỉnh gấp',
  2: '2/5 — Cần cải thiện',
  3: '3/5 — Đạt yêu cầu',
  4: '4/5 — Hiệu quả tốt',
  5: '5/5 — Rất hiệu quả',
};

function inferStarRating(entry: JournalEntry): number {
  if (entry.pacingRating === 'vua-khit' && entry.whatWorked.trim().length > 20) {
    return 5;
  }
  if (entry.pacingRating === 'vua-khit') return 4;
  if (entry.pacingRating === 'du-gio') return 4;
  return 3;
}

export function TeachingJournalApp({
  journals,
  packs,
  activePack,
  onSaveJournal,
  onDeleteJournal,
  onApplyAdjustmentToPack,
  onOpenPackInStudio,
}: TeachingJournalAppProps) {
  const tutorial = useOptionalTutorial();
  const [packId, setPackId] = useState<string>(activePack.id || packs[0]?.id || '');
  const [classLabel, setClassLabel] = useState('Toán 12');
  const [taughtDate, setTaughtDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [pacingRating, setPacingRating] = useState<PacingRating>('vua-khit');
  const [starRating, setStarRating] = useState<number>(4);
  const [whatWorked, setWhatWorked] = useState('');
  const [bottlenecks, setBottlenecks] = useState(
    'Nhiều học sinh còn nhầm lẫn giữa đạo hàm và hiệu số; còn lúng túng khi áp dụng quy tắc đạo hàm vào bài tập tổng hợp.'
  );
  const [nextAdjustment, setNextAdjustment] = useState(
    'Tăng thêm 1 ví dụ phân biệt; bổ sung bài luyện tập phân mức; dành 5 phút cuối để củng cố quy tắc.'
  );
  const [selectedJournalId, setSelectedJournalId] = useState<string>(
    journals[0]?.id ?? ''
  );
  const [showAllJournals, setShowAllJournals] = useState(false);
  const [formError, setFormError] = useState('');

  const handleLoadEntryToForm = (entry: JournalEntry) => {
    setSelectedJournalId(entry.id);
    setPackId(entry.packId || packs[0]?.id || '');
    setClassLabel(entry.classLabel);
    setTaughtDate(entry.taughtDate);
    setPacingRating(entry.pacingRating);
    setStarRating(inferStarRating(entry));
    setWhatWorked(entry.whatWorked);
    setBottlenecks(entry.bottlenecks);
    setNextAdjustment(entry.nextAdjustment);
    setFormError('');
  };

  const handleStartNewForm = () => {
    tutorial?.emitTutorialEvent('tj-form-opened');
    setSelectedJournalId('');
    setClassLabel('12A2');
    setTaughtDate(new Date().toISOString().slice(0, 10));
    setPacingRating('vua-khit');
    setStarRating(4);
    setWhatWorked('');
    setBottlenecks('');
    setNextAdjustment('');
    setFormError('');
  };

  const buildCurrentEntryPayload = (): JournalEntry | null => {
    if (!classLabel.trim() || !nextAdjustment.trim()) {
      setFormError('Vui lòng nhập tên lớp dạy và đề xuất điều chỉnh rút kinh nghiệm.');
      return null;
    }
    setFormError('');
    const effectiveSummary =
      whatWorked.trim() ||
      `Đánh giá mức hiệu quả ${EFFECTIVENESS_LABELS[starRating]}`;
    return {
      id: createId('jrn'),
      packId: packId || packs[0]?.id || '',
      classLabel: classLabel.trim(),
      taughtDate,
      pacingRating,
      whatWorked: effectiveSummary,
      bottlenecks: bottlenecks.trim(),
      nextAdjustment: nextAdjustment.trim(),
      updatedAt: new Date().toISOString(),
    };
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const entry = buildCurrentEntryPayload();
    if (!entry) return;
    await onSaveJournal(entry);
    setSelectedJournalId(entry.id);
  };

  const handleQuickApplyFromForm = async () => {
    const existing = journals.find((j) => j.id === selectedJournalId);
    if (existing && existing.nextAdjustment === nextAdjustment.trim()) {
      await onApplyAdjustmentToPack(existing);
      return;
    }
    const entry = buildCurrentEntryPayload();
    if (!entry) return;
    await onSaveJournal(entry);
    setSelectedJournalId(entry.id);
    await onApplyAdjustmentToPack(entry);
  };

  const visibleJournals = showAllJournals ? journals : journals.slice(0, 5);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <ContextualAcademyBar
        tutorialId="tutorial.teaching-journal"
        label="Teaching Journal"
        description="Ghi nhanh nhịp độ thực tế sau giờ dạy và chèn điều chỉnh thẳng vào giáo án."
      />

      <PageBanner
        tourId="tj-header"
        title="Teaching Journal"
        subtitle="Ghi lại sau tiết dạy để cải tiến nhanh"
        icon={<BookOpenCheck className="h-5 w-5" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {tutorial && (
              <Button
                variant="secondary"
                size="sm"
                data-tour-id="tj-help-btn"
                onClick={() =>
                  tutorial.startTutorial('tutorial.teaching-journal', { restart: true })
                }
                aria-label="Hướng dẫn sử dụng Teaching Journal"
              >
                <HelpCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Hướng dẫn</span>
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              data-tour-id="tj-add-btn"
              onClick={handleStartNewForm}
            >
              <Plus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Tạo bản ghi mới</span>
            </Button>
          </div>
        }
      />

      {/* 2-Column Teaching Journal 4.1 Workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Inline Journal Creation Card */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base sm:text-lg font-bold text-slate-950 dark:text-slate-50">
              Tạo nhật ký sau tiết dạy
            </h2>
            {selectedJournalId && (
              <span className="rounded-md bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                Đang xem / chỉnh sửa
              </span>
            )}
          </div>

          {formError && (
            <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300">
              {formError}
            </p>
          )}

          {/* Row 1: Class & Date */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="jrn-class"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                <Users className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Lớp</span>
              </label>
              <input
                id="jrn-class"
                type="text"
                value={classLabel}
                onChange={(e) => setClassLabel(e.target.value)}
                placeholder="VD: Toán 12, 12A2, 8A1..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="jrn-date"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                <Calendar className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Ngày dạy</span>
              </label>
              <input
                id="jrn-date"
                type="date"
                value={taughtDate}
                onChange={(e) => setTaughtDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Row 2: Linked Lesson Pack */}
          <div className="space-y-1.5">
            <label
              htmlFor="jrn-pack"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              <BookOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Bài dạy liên kết</span>
            </label>
            <select
              id="jrn-pack"
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
            >
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title || '(Chưa đặt tên)'} ({p.subject} · {p.grade})
                </option>
              ))}
            </select>
          </div>

          {/* Row 3: Pacing Radio Pills */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Nhịp độ thời gian</span>
            </span>
            <div className="grid grid-cols-3 gap-2">
              {(['thieu-gio', 'vua-khit', 'du-gio'] as PacingRating[]).map((rate) => {
                const active = pacingRating === rate;
                return (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setPacingRating(rate)}
                    className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50/90 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                        active
                          ? 'border-blue-600 bg-blue-600'
                          : 'border-slate-400 dark:border-slate-500'
                      }`}
                    >
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <span>{PACING_SHORT_LABELS[rate]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 4: Effectiveness 5-Star Rating */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <BarChart3 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Mức hiệu quả</span>
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-1" role="group" aria-label="Chọn mức hiệu quả tiết dạy từ 1 đến 5 sao">
                {[1, 2, 3, 4, 5].map((star) => {
                  const filled = star <= starRating;
                  return (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setStarRating(star)}
                      aria-label={`${star} trên 5 sao`}
                      className="rounded p-1 transition-transform hover:scale-110 focus:outline-none"
                    >
                      <Star
                        className={`h-5 w-5 ${
                          filled
                            ? 'fill-blue-600 text-blue-600 dark:fill-blue-400 dark:text-blue-400'
                            : 'text-slate-300 dark:text-slate-600'
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
              <span className="rounded-lg bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 font-mono-num">
                {EFFECTIVENESS_LABELS[starRating]}
              </span>
            </div>
          </div>

          {/* Row 5: Student Bottlenecks */}
          <div className="space-y-1.5">
            <label
              htmlFor="jrn-bottlenecks"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              <Users className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Vướng mắc của học sinh</span>
            </label>
            <div className="relative">
              <textarea
                id="jrn-bottlenecks"
                rows={3}
                maxLength={300}
                value={bottlenecks}
                onChange={(e) => setBottlenecks(e.target.value)}
                placeholder="Nhiều học sinh còn nhầm lẫn hoặc lúng túng ở bước nào..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/70 px-3.5 py-2.5 pb-6 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
              />
              <span className="pointer-events-none absolute right-3 bottom-2 text-[11px] font-mono-num text-slate-400">
                {bottlenecks.length}/300
              </span>
            </div>
          </div>

          {/* Row 6: Adjustment Proposal */}
          <div className="space-y-1.5">
            <label
              htmlFor="jrn-adjust"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              <Lightbulb className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Đề xuất điều chỉnh</span>
            </label>
            <div className="relative">
              <textarea
                id="jrn-adjust"
                rows={3}
                maxLength={300}
                value={nextAdjustment}
                onChange={(e) => setNextAdjustment(e.target.value)}
                placeholder="Tăng thêm ví dụ phân biệt; bổ sung bài luyện tập phân mức..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/70 px-3.5 py-2.5 pb-6 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
              />
              <span className="pointer-events-none absolute right-3 bottom-2 text-[11px] font-mono-num text-slate-400">
                {nextAdjustment.length}/300
              </span>
            </div>
          </div>

          {/* Bottom Actions: Apply to Lesson Pack & Save Journal */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              data-tour-id="tj-apply-btn"
              onClick={() => void handleQuickApplyFromForm()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/40 px-4 py-2.5 text-xs sm:text-sm font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100/70 dark:hover:bg-blue-900/50 transition-colors"
            >
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              <span>Áp dụng vào bài dạy</span>
            </button>

            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              <span>Lưu nhật ký</span>
            </button>
          </div>
        </form>

        {/* Right Column: Recent Journals Timeline */}
        <section
          data-tour-id="tj-cards"
          aria-label="Nhật ký gần đây"
          className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400">
                <Clock className="h-4 w-4" aria-hidden="true" />
              </span>
              <h2 className="text-base font-bold text-slate-950 dark:text-slate-50">
                Nhật ký gần đây
              </h2>
            </div>

            {journals.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllJournals((prev) => !prev)}
                className="inline-flex items-center gap-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                <span>{showAllJournals ? 'Thu gọn' : 'Xem tất cả'}</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {journals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
              <BookOpenCheck className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Chưa có nhật ký giảng dạy nào.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Điền biểu mẫu bên trái và nhấn &ldquo;Lưu nhật ký&rdquo; để lưu lại phản hồi sau tiết dạy.
              </p>
            </div>
          ) : (
            <div className="relative pl-5 space-y-3 before:absolute before:left-[7px] before:top-3 before:bottom-3 before:w-[1.5px] before:bg-slate-200 dark:before:bg-slate-800">
              {visibleJournals.map((entry, idx) => {
                const linkedPack = packs.find((p) => p.id === entry.packId);
                const isSelected =
                  selectedJournalId === entry.id ||
                  (!selectedJournalId && idx === 0);
                const stars = inferStarRating(entry);

                return (
                  <div key={entry.id} className="relative">
                    {/* Timeline Dot */}
                    <span
                      aria-hidden="true"
                      className={`absolute -left-5 top-4 h-3 w-3 rounded-full border-2 ${
                        isSelected
                          ? 'border-blue-600 bg-blue-600 ring-4 ring-blue-100 dark:ring-blue-950'
                          : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
                      }`}
                    />

                    <div
                      onClick={() => handleLoadEntryToForm(entry)}
                      className={`group cursor-pointer rounded-xl border p-3.5 transition-colors ${
                        isSelected
                          ? 'border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/35'
                          : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-200 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-100 dark:border-blue-900/60 bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400">
                            <BookOpen className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50 truncate">
                              {linkedPack?.title || `Nhật ký lớp ${entry.classLabel}`}
                            </h3>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                              {entry.classLabel} · {entry.taughtDate} · {PACING_SHORT_LABELS[entry.pacingRating]}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1 text-xs font-mono-num font-semibold text-slate-700 dark:text-slate-200">
                            <Star className="h-3.5 w-3.5 fill-blue-600 text-blue-600 dark:fill-blue-400 dark:text-blue-400" aria-hidden="true" />
                            <span>{stars}/5</span>
                          </span>
                          <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600" aria-hidden="true" />
                        </div>
                      </div>

                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                        <strong className="font-semibold text-slate-800 dark:text-slate-200">
                          Đề xuất:{' '}
                        </strong>
                        {entry.nextAdjustment}
                      </p>

                      <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onApplyAdjustmentToPack(entry);
                            }}
                            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Áp dụng vào bài dạy
                          </button>
                          {linkedPack && (
                            <>
                              <span aria-hidden="true">·</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenPackInStudio(linkedPack);
                                }}
                                className="text-slate-500 hover:text-slate-900 dark:hover:text-white"
                              >
                                Mở bài dạy
                              </button>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onDeleteJournal(entry.id);
                          }}
                          aria-label={`Xóa nhật ký lớp ${entry.classLabel}`}
                          className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
