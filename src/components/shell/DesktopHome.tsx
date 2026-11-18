import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Calculator,
  ChevronRight,
  Clock,
  Folder,
  GitBranch,
  GraduationCap,
  MoreHorizontal,
  Play,
  Plus,
  Search,
} from 'lucide-react';
import deskBannerImg from '../../assets/images/teacher_desk_banner_1795006679389.jpg';
import { AppId } from '../../core/appRegistry';
import type { CanvasBoard, CanvasNodeRecord } from '../../types/canvas';
import { LessonPack, WorkflowRun } from '../../types/lesson';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';

interface DesktopHomeProps {
  packs: LessonPack[];
  workflows: WorkflowRun[];
  canvasBoards: CanvasBoard[];
  canvasNodes: CanvasNodeRecord[];
  hasActiveUnsavedDraft: boolean;
  onCreateNewPack: () => void;
  onOpenApp: (appId: AppId) => void;
  onOpenLibrary: () => void;
  onOpenPackInStudio: (pack: LessonPack) => void;
  onOpenCommandPalette: () => void;
  onOpenPackContextMenu: (pack: LessonPack, x: number, y: number) => void;
}

interface InProgressItem {
  id: string;
  title: string;
  subtitle: string;
  percent: number;
  kind: 'lesson' | 'workflow' | 'workspace';
  onOpen: () => void;
}

function formatDateVi(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function computeLessonPackProgress(pack: LessonPack): number {
  if (pack.status === 'completed') return 100;
  let score = Math.round((Math.min(Math.max(pack.lastStep || 1, 1), 5) / 5) * 60);
  if (pack.objectives.length > 0) score += 10;
  if (pack.activities.length > 0) score += 10;
  if (pack.questions.length > 0) score += 10;
  if ((pack.worksheetVariants?.length ?? 0) > 0 || pack.rubric.length > 0) {
    score += 10;
  }
  return Math.min(95, Math.max(15, score));
}

export function DesktopHome({
  packs,
  workflows,
  canvasBoards,
  canvasNodes,
  hasActiveUnsavedDraft,
  onCreateNewPack,
  onOpenApp,
  onOpenLibrary,
  onOpenPackInStudio,
  onOpenCommandPalette,
  onOpenPackContextMenu,
}: DesktopHomeProps) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [bannerImgFailed, setBannerImgFailed] = useState(false);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const tutorial = useOptionalTutorial();

  useEffect(() => {
    if (!createMenuOpen) return;
    const onPointerDown = (e: globalThis.MouseEvent) => {
      if (
        createMenuRef.current &&
        !createMenuRef.current.contains(e.target as Node)
      ) {
        setCreateMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCreateMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [createMenuOpen]);

  const drafts = useMemo(() => packs.filter((p) => p.status === 'draft'), [packs]);
  const recentPacks = useMemo(() => packs.slice(0, 3), [packs]);

  const resumeTargetPack = drafts[0] ?? packs[0] ?? null;

  const secondaryRecentBoard =
    recentPacks.length < 3 && canvasBoards.length > 0 ? canvasBoards[0] : null;
  const secondaryRecentWorkflow =
    recentPacks.length + (secondaryRecentBoard ? 1 : 0) < 3 && workflows.length > 0
      ? workflows[0]
      : null;

  const inProgressItems = useMemo<InProgressItem[]>(() => {
    const items: InProgressItem[] = [];

    for (const draft of drafts.slice(0, 2)) {
      items.push({
        id: `pack-${draft.id}`,
        title: draft.title || 'Bộ tiết dạy chưa đặt tên',
        subtitle: `${draft.subject} · ${draft.grade} · Bước ${draft.lastStep}/5`,
        percent: computeLessonPackProgress(draft),
        kind: 'lesson',
        onOpen: () => onOpenPackInStudio(draft),
      });
    }

    const activeWorkflow =
      workflows.find((w) => w.steps.some((s) => !s.done)) ?? workflows[0];
    if (activeWorkflow && activeWorkflow.steps.length > 0) {
      const doneSteps = activeWorkflow.steps.filter((s) => s.done).length;
      const pct = Math.round((doneSteps / activeWorkflow.steps.length) * 100);
      items.push({
        id: `wf-${activeWorkflow.id}`,
        title: activeWorkflow.title,
        subtitle: `Quy trình · ${doneSteps}/${activeWorkflow.steps.length} bước hoàn tất`,
        percent: pct,
        kind: 'workflow',
        onOpen: () => onOpenApp('workflow-center'),
      });
    }

    if (items.length < 3 && canvasBoards.length > 0) {
      const primaryBoard = canvasBoards[0];
      const boardNodes = canvasNodes.filter((n) => n.boardId === primaryBoard.id);
      const doneNodes = boardNodes.filter((n) => n.status === 'done').length;
      const pct =
        boardNodes.length > 0
          ? Math.round((doneNodes / boardNodes.length) * 100)
          : 0;
      items.push({
        id: `board-${primaryBoard.id}`,
        title: primaryBoard.title,
        subtitle: `Không gian · ${boardNodes.length} nút công việc`,
        percent: pct,
        kind: 'workspace',
        onOpen: () => onOpenApp('workspace'),
      });
    }

    return items.slice(0, 3);
  }, [
    canvasBoards,
    canvasNodes,
    drafts,
    onOpenApp,
    onOpenPackInStudio,
    workflows,
  ]);

  const handleCardContextMenu = (
    e: MouseEvent<HTMLElement>,
    pack: LessonPack
  ) => {
    e.preventDefault();
    onOpenPackContextMenu(pack, e.clientX, e.clientY);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-7">
      {/* Hero Banner — Intent-First Greeting + 3 Clear Actions */}
      <section
        data-tour-id="desktop-hero"
        className="relative overflow-visible rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
      >
        {/* Right-aligned minimalist desk accent image */}
        {!bannerImgFailed && (
          <div
            aria-hidden="true"
            className="pointer-events-none hidden md:block absolute inset-y-0 right-0 w-[42%] overflow-hidden rounded-r-2xl"
          >
            <img
              src={deskBannerImg}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setBannerImgFailed(true)}
              className="h-full w-full object-cover object-right opacity-85 dark:opacity-18"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-white via-white/85 to-transparent dark:from-slate-900 dark:via-slate-900/90 dark:to-transparent" />
          </div>
        )}

        <div className="relative z-10 p-6 sm:p-8 space-y-6">
          <div className="max-w-xl">
            <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-slate-950 dark:text-slate-50 leading-tight text-balance">
              Hôm nay thầy/cô muốn làm gì?
            </h1>
            <div
              aria-hidden="true"
              className="mt-2 h-[3px] w-14 rounded-full bg-blue-600 dark:bg-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {/* Action 1: Continue */}
            <button
              type="button"
              onClick={() => {
                if (resumeTargetPack && !hasActiveUnsavedDraft) {
                  onOpenPackInStudio(resumeTargetPack);
                } else {
                  onOpenApp('lesson-studio');
                }
              }}
              className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 p-4 text-left hover:border-blue-300 dark:hover:border-blue-600 hover:bg-white dark:hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/70 bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400">
                  <Play className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                    Tiếp tục
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {hasActiveUnsavedDraft
                      ? 'Quay lại bản đang soạn'
                      : resumeTargetPack
                      ? resumeTargetPack.title || 'Làm tiếp công việc đang dở'
                      : 'Mở Lesson Studio'}
                  </div>
                </div>
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                aria-hidden="true"
              />
            </button>

            {/* Action 2: Create New (Highlighted Primary Trigger + 3-option Quick Menu) */}
            <div ref={createMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setCreateMenuOpen((prev) => !prev)}
                aria-expanded={createMenuOpen}
                aria-haspopup="menu"
                className={`group flex w-full items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  createMenuOpen
                    ? 'border-blue-500 bg-white dark:bg-slate-800 ring-2 ring-blue-600/15'
                    : 'border-blue-300 dark:border-blue-700 bg-white/95 dark:bg-slate-800/95 hover:border-blue-500 dark:hover:border-blue-500'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                      Tạo mới
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      Bài dạy, không gian hoặc quy trình
                    </div>
                  </div>
                </div>
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 transition-transform ${
                    createMenuOpen ? 'rotate-90' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>

              {createMenuOpen && (
                <div
                  role="menu"
                  aria-label="Chọn loại nội dung muốn tạo"
                  className="absolute left-0 right-0 mt-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-lg z-30"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onCreateNewPack();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-blue-50 dark:hover:bg-blue-950/60 transition-colors"
                  >
                    <BookOpen className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                    <span>Bài dạy mới</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onOpenApp('workspace');
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-blue-50 dark:hover:bg-blue-950/60 transition-colors"
                  >
                    <Folder className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                    <span>Không gian làm việc</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onOpenApp('workflow-center');
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-blue-50 dark:hover:bg-blue-950/60 transition-colors"
                  >
                    <GitBranch className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                    <span>Quy trình công việc</span>
                  </button>
                </div>
              )}
            </div>

            {/* Action 3: Quick Search */}
            <button
              type="button"
              onClick={onOpenCommandPalette}
              data-tour-id="desktop-search-btn"
              className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 p-4 text-left hover:border-blue-300 dark:hover:border-blue-600 hover:bg-white dark:hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/70 bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400">
                  <Search className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                    Tìm kiếm
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    Tài liệu, bài dạy, tài nguyên...
                  </div>
                </div>
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </section>

      {/* Section 1: Recent Work (Max 3 Clean Cards, Single Click Opens, '...' Menu for Actions) */}
      <section aria-labelledby="desktop-recent-heading" className="space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="desktop-recent-heading"
            className="text-base font-bold text-slate-950 dark:text-slate-50"
          >
            Công việc gần đây
          </h2>
          <button
            type="button"
            onClick={onOpenLibrary}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            <span>Xem kho bài dạy</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {recentPacks.length === 0 && !secondaryRecentBoard ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Chưa có bộ tiết dạy nào trên máy.
            </p>
            <button
              type="button"
              onClick={onCreateNewPack}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Tạo bài dạy đầu tiên</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {recentPacks.map((pack) => (
              <article
                key={pack.id}
                onContextMenu={(e) => handleCardContextMenu(e, pack)}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      onOpenPackContextMenu(pack, rect.left, rect.bottom + 4);
                    }}
                    aria-label={`Menu thao tác nhanh cho ${pack.title || 'bộ tiết dạy'}`}
                    title="Thao tác nhanh"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenPackInStudio(pack)}
                  className="mt-3 text-left focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
                >
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {pack.title || '(Chưa đặt tên bài)'}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {pack.subject} · {pack.grade} · {pack.activities.length} hoạt động
                  </p>
                  <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-mono-num">
                    <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>Cập nhật {formatDateVi(pack.updatedAt)}</span>
                  </p>
                </button>
              </article>
            ))}

            {secondaryRecentBoard && (
              <button
                type="button"
                onClick={() => onOpenApp('workspace')}
                className="group flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                  <Folder className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="mt-3">
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {secondaryRecentBoard.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                    Không gian làm việc ·{' '}
                    {
                      canvasNodes.filter((n) => n.boardId === secondaryRecentBoard.id)
                        .length
                    }{' '}
                    nút sơ đồ
                  </p>
                  <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-mono-num">
                    <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>Cập nhật {formatDateVi(secondaryRecentBoard.updatedAt)}</span>
                  </p>
                </div>
              </button>
            )}

            {secondaryRecentWorkflow && (
              <button
                type="button"
                onClick={() => onOpenApp('workflow-center')}
                className="group flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="mt-3">
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {secondaryRecentWorkflow.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                    Quy trình · {secondaryRecentWorkflow.steps.length} bước thực hiện
                  </p>
                  <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-mono-num">
                    <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>Cập nhật {formatDateVi(secondaryRecentWorkflow.updatedAt)}</span>
                  </p>
                </div>
              </button>
            )}
          </div>
        )}
      </section>

      {/* Section 2: In Progress (Real Completion from IndexedDB State) */}
      {inProgressItems.length > 0 && (
        <section aria-labelledby="desktop-progress-heading" className="space-y-3.5">
          <h2
            id="desktop-progress-heading"
            className="text-base font-bold text-slate-950 dark:text-slate-50"
          >
            Đang thực hiện
          </h2>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {inProgressItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={item.onOpen}
                className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3.5 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
              >
                <div className="flex items-center gap-3 min-w-0 sm:w-[46%]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                    {item.kind === 'workflow' ? (
                      <GitBranch className="h-4 w-4" aria-hidden="true" />
                    ) : item.kind === 'workspace' ? (
                      <Folder className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <BookOpen className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {item.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {item.subtitle}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:w-[44%]">
                  <div
                    role="progressbar"
                    aria-valuenow={item.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Tiến độ ${item.title}`}
                    className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                  >
                    <div
                      className="h-full rounded-full bg-blue-600 dark:bg-blue-500 transition-[width]"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs font-semibold font-mono-num text-slate-700 dark:text-slate-300 shrink-0">
                    {item.percent}%
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Section 3: Compact TeacherOS Academy Strip */}
      <section
        aria-labelledby="desktop-academy-heading"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3.5 lg:w-[270px] shrink-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <GraduationCap className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2
                id="desktop-academy-heading"
                className="text-sm font-bold text-slate-950 dark:text-slate-50"
              >
                TeacherOS Academy
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Học nhanh các tính năng, xem hướng dẫn và gợi ý sử dụng hiệu quả.
              </p>
            </div>
          </div>

          <div className="flex-1 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Hướng dẫn nổi bật
              </span>
              {tutorial && (
                <button
                  type="button"
                  onClick={tutorial.openLauncher}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  Xem tất cả hướng dẫn
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => tutorial?.startTutorial('tutorial.workflow')}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 px-3 py-2.5 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <GitBranch className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      Workflow Center
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      Quy trình chuẩn bị tiết dạy
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => tutorial?.startTutorial('tutorial.lesson-studio')}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 px-3 py-2.5 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <BookOpen className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      Lesson Studio
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      Soạn bài &amp; phiếu học tập
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => tutorial?.startTutorial('tutorial.math-mixer')}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 px-3 py-2.5 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Calculator className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      Math Exam Mixer
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      Trộn đề Toán theo ma trận
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
