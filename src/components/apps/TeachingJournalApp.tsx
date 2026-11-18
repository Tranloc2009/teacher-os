import { FormEvent, useState } from 'react';
import {
  BookOpenCheck,
  Check,
  Clock,
  HelpCircle,
  Plus,
  Trash2,
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

const PACING_LABELS: Record<PacingRating, string> = {
  'thieu-gio': 'Thiếu giờ (cần rút gọn hoạt động)',
  'vua-khit': 'Vừa khít thời lượng tiết dạy',
  'du-gio': 'Dư giờ (có thể thêm câu mở rộng)',
};

export function TeachingJournalApp({
  journals,
  packs,
  activePack,
  onSaveJournal,
  onDeleteJournal,
  onApplyAdjustmentToPack,
  onOpenPackInStudio,
}: TeachingJournalAppProps) {
  const [showForm, setShowForm] = useState(false);
  const tutorial = useOptionalTutorial();
  const [packId, setPackId] = useState<string>(activePack.id || packs[0]?.id || '');
  const [classLabel, setClassLabel] = useState('8A1');
  const [taughtDate, setTaughtDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [pacingRating, setPacingRating] = useState<PacingRating>('vua-khit');
  const [whatWorked, setWhatWorked] = useState('');
  const [bottlenecks, setBottlenecks] = useState('');
  const [nextAdjustment, setNextAdjustment] = useState('');
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!classLabel.trim() || !nextAdjustment.trim()) {
      setFormError('Vui lòng nhập tên lớp dạy và nội dung điều chỉnh rút kinh nghiệm.');
      return;
    }
    setFormError('');
    const entry: JournalEntry = {
      id: createId('jrn'),
      packId: packId || packs[0]?.id || '',
      classLabel: classLabel.trim(),
      taughtDate,
      pacingRating,
      whatWorked: whatWorked.trim(),
      bottlenecks: bottlenecks.trim(),
      nextAdjustment: nextAdjustment.trim(),
      updatedAt: new Date().toISOString(),
    };
    await onSaveJournal(entry);
    setWhatWorked('');
    setBottlenecks('');
    setNextAdjustment('');
    setShowForm(false);
  };

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
        subtitle="Ghi lại nhịp độ tiết dạy, vướng mắc của học sinh và chèn cải tiến trực tiếp vào bộ tiết dạy."
        icon={<BookOpenCheck className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
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
              variant="primary"
              data-tour-id="tj-add-btn"
              onClick={() => {
                setShowForm((prev) => !prev);
                tutorial?.emitTutorialEvent('tj-form-opened');
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>{showForm ? 'Đóng biểu mẫu' : 'Ghi nhật ký tiết dạy'}</span>
            </Button>
          </>
        }
      />

      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="tos-card-pad rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Thêm bản ghi Nhật ký giảng dạy mới
          </h2>

          {formError && (
            <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
              {formError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="jrn-pack" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Bộ tiết dạy đã thực hiện
              </label>
              <select
                id="jrn-pack"
                value={packId}
                onChange={(e) => setPackId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {packs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || '(Chưa đặt tên)'} ({p.subject} - {p.grade})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="jrn-class" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Lớp giảng dạy *
              </label>
              <input
                id="jrn-class"
                type="text"
                value={classLabel}
                onChange={(e) => setClassLabel(e.target.value)}
                placeholder="VD: 8A1, 9A3..."
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="jrn-date" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Ngày dạy
              </label>
              <input
                id="jrn-date"
                type="date"
                value={taughtDate}
                onChange={(e) => setTaughtDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-num"
              />
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Đánh giá nhịp độ thời gian trên lớp
            </span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(['thieu-gio', 'vua-khit', 'du-gio'] as PacingRating[]).map((rate) => {
                const active = pacingRating === rate;
                return (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setPacingRating(rate)}
                    className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-600 dark:bg-blue-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {PACING_LABELS[rate]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="jrn-worked" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Điểm hiệu quả / Học sinh hứng thú
              </label>
              <textarea
                id="jrn-worked"
                rows={2}
                value={whatWorked}
                onChange={(e) => setWhatWorked(e.target.value)}
                placeholder="Hoạt động hoặc câu hỏi nào phát huy tốt..."
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="jrn-bottlenecks" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Điểm học sinh còn lúng túng / Sai sót phổ biến
              </label>
              <textarea
                id="jrn-bottlenecks"
                rows={2}
                value={bottlenecks}
                onChange={(e) => setBottlenecks(e.target.value)}
                placeholder="Các bước giải hoặc khái niệm học sinh dễ nhầm..."
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="jrn-adjust" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Điều chỉnh cụ thể cho lần dạy lớp tiếp theo *
            </label>
            <textarea
              id="jrn-adjust"
              rows={2}
              value={nextAdjustment}
              onChange={(e) => setNextAdjustment(e.target.value)}
              placeholder="Nội dung này có thể chèn 1 chạm vào phần Lưu ý giáo viên của bài dạy..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowForm(false)}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Lưu nhật ký
            </Button>
          </div>
        </form>
      )}

      {/* Journal Entries */}
      {journals.length === 0 ? (
        <div
          data-tour-id="tj-cards"
          className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center"
        >
          <BookOpenCheck className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Chưa có nhật ký giảng dạy nào.
          </p>
        </div>
      ) : (
        <div data-tour-id="tj-cards" className="space-y-4">
          {journals.map((entry, idx) => {
            const linkedPack = packs.find((p) => p.id === entry.packId);
            return (
              <article
                key={entry.id}
                className="tos-card-pad rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono-num font-bold text-blue-600 dark:text-blue-400">
                      Lớp {entry.classLabel}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num text-slate-600 dark:text-slate-300">
                      Ngày {entry.taughtDate}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {PACING_LABELS[entry.pacingRating]}
                    </span>
                  </div>

                  {linkedPack && (
                    <button
                      type="button"
                      onClick={() => onOpenPackInStudio(linkedPack)}
                      className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Bài dạy: {linkedPack.title || '(Chưa đặt tên)'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Điểm hiệu quả
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-300 leading-relaxed">
                      {entry.whatWorked || '—'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Vướng mắc của học sinh
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-300 leading-relaxed">
                      {entry.bottlenecks || '—'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-blue-50/70 dark:bg-blue-950/35 p-3.5">
                    <div className="font-semibold text-blue-700 dark:text-blue-300">
                      Điều chỉnh cho lớp tiếp theo
                    </div>
                    <p className="mt-1 text-slate-700 dark:text-slate-200 leading-relaxed">
                      {entry.nextAdjustment}
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    data-tour-id={idx === 0 ? 'tj-apply-btn' : undefined}
                    onClick={() => void onApplyAdjustmentToPack(entry)}
                    className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500 whitespace-nowrap"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Áp dụng ghi chú cải tiến vào bộ tiết dạy</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void onDeleteJournal(entry.id)}
                    className="inline-flex items-center gap-1 rounded-[10px] px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-700 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Xóa nhật ký</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
