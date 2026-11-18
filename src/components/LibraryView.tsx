import { MouseEvent, useMemo, useState } from 'react';
import { Copy, Edit3, FolderOpen, MoreHorizontal, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import {
  GRADE_OPTIONS,
  LessonPack,
  SUBJECT_OPTIONS,
} from '../types/lesson';
import { Button, PageBanner } from './ui/DesignSystem';

interface LibraryViewProps {
  packs: LessonPack[];
  onCreateNew: () => void;
  onEditPack: (pack: LessonPack) => void;
  onDuplicatePack: (pack: LessonPack) => void;
  onDeletePack: (pack: LessonPack) => void;
  onClearAllDemos: () => void;
  onRestoreDemos: () => void;
  onOpenPackContextMenu?: (pack: LessonPack, x: number, y: number) => void;
}

type StatusFilter = 'all' | 'draft' | 'completed' | 'demo';

export function LibraryView({
  packs,
  onCreateNew,
  onEditPack,
  onDuplicatePack,
  onDeletePack,
  onClearAllDemos,
  onRestoreDemos,
  onOpenPackContextMenu,
}: LibraryViewProps) {
  const [query, setQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const demoCount = useMemo(
    () => packs.filter((p) => p.isDemo).length,
    [packs]
  );

  const availableSubjects = useMemo(() => {
    const set = new Set<string>(SUBJECT_OPTIONS);
    for (const p of packs) {
      if (p.subject.trim()) set.add(p.subject);
    }
    return Array.from(set);
  }, [packs]);

  const filteredPacks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return packs.filter((pack) => {
      if (q) {
        const hay = `${pack.title} ${pack.subject} ${pack.grade}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (subjectFilter && pack.subject !== subjectFilter) return false;
      if (gradeFilter && pack.grade !== gradeFilter) return false;
      if (statusFilter === 'draft' && pack.status !== 'draft') return false;
      if (statusFilter === 'completed' && pack.status !== 'completed') return false;
      if (statusFilter === 'demo' && !pack.isDemo) return false;
      return true;
    });
  }, [packs, query, subjectFilter, gradeFilter, statusFilter]);

  const resetFilters = () => {
    setQuery('');
    setSubjectFilter('');
    setGradeFilter('');
    setStatusFilter('all');
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <PageBanner
        title="Kho bộ tiết dạy"
        subtitle="Tìm kiếm theo tên bài, môn học, khối lớp; chỉnh sửa, nhân bản hoặc quản lý dữ liệu đã lưu trên thiết bị."
        icon={<FolderOpen className="h-5 w-5" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {demoCount > 0 ? (
              <Button variant="secondary" size="sm" onClick={onClearAllDemos}>
                <Trash2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span>Xóa mẫu DEMO ({demoCount})</span>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onRestoreDemos}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Nạp lại mẫu DEMO</span>
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={onCreateNew}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tạo bộ tiết dạy</span>
            </Button>
          </div>
        }
      />

      {/* Filter Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-6">
            <label htmlFor="lib-search" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Tìm theo tên bài / chủ đề
            </label>
            <div className="relative mt-1">
              <Search
                className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="lib-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nhập tên chủ đề hoặc từ khóa..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="md:col-span-3">
            <label htmlFor="lib-subject" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Môn học
            </label>
            <select
              id="lib-subject"
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
            >
              <option value="">Tất cả môn học</option>
              {availableSubjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label htmlFor="lib-grade" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Khối lớp
            </label>
            <select
              id="lib-grade"
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
            >
              <option value="">Tất cả khối lớp</option>
              {GRADE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: 'draft', label: 'Bản nháp' },
                { id: 'completed', label: 'Hoàn thành' },
                { id: 'demo', label: 'Chỉ DEMO' },
              ] as Array<{ id: StatusFilter; label: string }>
            ).map((tab) => {
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono-num">
              Hiển thị {filteredPacks.length} / {packs.length} bộ tiết dạy
            </span>
            {(query || subjectFilter || gradeFilter || statusFilter !== 'all') && (
              <button
                type="button"
                onClick={resetFilters}
                className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Xóa bộ lọc
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {packs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center">
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">Kho lưu trữ đang trống</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Bạn chưa lưu bộ tiết dạy nào trên thiết bị này. Hãy tạo mới hoặc nạp lại bộ mẫu DEMO để tham khảo cấu trúc.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onCreateNew}
              className="rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500"
            >
              Tạo bộ tiết dạy mới
            </button>
            <button
              type="button"
              onClick={onRestoreDemos}
              className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Nạp bộ mẫu DEMO
            </button>
          </div>
        </div>
      ) : filteredPacks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Không tìm thấy bộ tiết dạy phù hợp bộ lọc hiện tại.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-3 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Đặt lại bộ lọc
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPacks.map((pack) => {
            const updatedDate = new Date(pack.updatedAt).toLocaleDateString('vi-VN');
            return (
              <article
                key={pack.id}
                onContextMenu={(e) => {
                  if (!onOpenPackContextMenu) return;
                  e.preventDefault();
                  onOpenPackContextMenu(pack, e.clientX, e.clientY);
                }}
                className="tos-card-pad flex flex-col gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {pack.isDemo && (
                      <>
                        <span className="font-semibold text-amber-700 dark:text-amber-300">
                          DEMO
                        </span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span className="font-medium text-slate-700 dark:text-slate-200">{pack.subject}</span>
                    <span aria-hidden="true">·</span>
                    <span>{pack.grade}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">{pack.duration} phút</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {pack.status === 'completed' ? 'Hoàn thành' : `Bản nháp (Bước ${pack.lastStep}/5)`}
                    </span>
                  </div>

                  <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50 break-words">
                    {pack.title || '(Chưa đặt tên bài)'}
                  </h2>

                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                    {pack.activities.length} hoạt động · {pack.questions.length} câu hỏi · {pack.rubric.length} tiêu chí rubric · Cập nhật {updatedDate}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onEditPack(pack)}
                    aria-label={`Chỉnh sửa "${pack.title || 'bộ tiết dạy'}"`}
                    className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500 whitespace-nowrap"
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Chỉnh sửa</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicatePack(pack)}
                    aria-label={`Nhân bản "${pack.title || 'bộ tiết dạy'}"`}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Nhân bản</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeletePack(pack)}
                    aria-label={`Xóa "${pack.title || 'bộ tiết dạy'}"`}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:border-red-200 dark:hover:border-red-800 whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Xóa</span>
                  </button>
                  {onOpenPackContextMenu && (
                    <button
                      type="button"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        onOpenPackContextMenu(pack, rect.left, rect.bottom + 4);
                      }}
                      aria-label={`Thao tác khác cho "${pack.title || 'bộ tiết dạy'}"`}
                      title="Menu thao tác nhanh"
                      className="inline-flex items-center justify-center rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
