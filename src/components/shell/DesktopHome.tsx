import { MouseEvent, useMemo } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  GitBranch,
  GraduationCap,
  Layers,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import { AppId } from '../../core/appRegistry';
import type { CanvasBoard, CanvasNodeRecord } from '../../types/canvas';
import { LessonPack, ResourceItem, WorkflowRun } from '../../types/lesson';
import type { MathExamProject } from '../../types/mathExam';
import type { DashboardNextStepSuggestion } from '../../types/connectedWorkflow';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';

interface DesktopHomeProps {
  packs: LessonPack[];
  mathExams: MathExamProject[];
  resources: ResourceItem[];
  workflows: WorkflowRun[];
  canvasBoards: CanvasBoard[];
  canvasNodes: CanvasNodeRecord[];
  hasActiveUnsavedDraft: boolean;
  nextStepSuggestions?: DashboardNextStepSuggestion[];
  onCreateNewPack: () => void;
  onOpenApp: (appId: AppId) => void;
  onExecuteNextStep?: (
    suggestion: DashboardNextStepSuggestion,
    useSecondary?: boolean
  ) => void;
  onOpenToolsHub: () => void;
  onOpenLibrary: () => void;
  onOpenPackInStudio: (pack: LessonPack) => void;
  onOpenCommandPalette: () => void;
  onOpenPackContextMenu: (pack: LessonPack, x: number, y: number) => void;
}

interface RecentActivityRow {
  id: string;
  title: string;
  moduleLabel: string;
  updatedAt: string;
  kind: 'lesson' | 'exam' | 'resource' | 'workflow' | 'workspace';
  pack?: LessonPack;
  onOpen: () => void;
}

function formatRelativeOrDateVi(iso: string): string {
  const date = new Date(iso);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return '';

  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60 && diffSec >= 0) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60 && diffMin >= 0) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24 && diffHours >= 0) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays > 1 && diffDays <= 7) return `${diffDays} ngày trước`;

  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function HeroGlassIllustration() {
  return (
    <svg
      viewBox="0 0 340 210"
      fill="none"
      aria-hidden="true"
      className="h-full w-full max-w-[330px] select-none"
    >
      <defs>
        <linearGradient id="tos-hero-glass-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.86" />
          <stop offset="100%" stopColor="#DCEBFF" stopOpacity="0.46" />
        </linearGradient>
        <linearGradient id="tos-hero-glass-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#C4D7FF" stopOpacity="0.34" />
        </linearGradient>
        <linearGradient id="tos-hero-stylus" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#A5B4FC" stopOpacity="0.62" />
        </linearGradient>
      </defs>

      {/* Soft ambient glass orbs */}
      <circle cx="242" cy="96" r="78" fill="#635BFF" fillOpacity="0.11" />
      <circle cx="152" cy="142" r="54" fill="#67D9E8" fillOpacity="0.16" />

      {/* Left tilted calendar glass card */}
      <g transform="translate(52 72) rotate(-7)">
        <rect
          width="96"
          height="92"
          rx="18"
          fill="url(#tos-hero-glass-b)"
          stroke="#FFFFFF"
          strokeOpacity="0.78"
          strokeWidth="1.5"
        />
        <rect x="16" y="18" width="64" height="10" rx="5" fill="#635BFF" fillOpacity="0.22" />
        <rect x="16" y="38" width="16" height="16" rx="4" fill="#635BFF" fillOpacity="0.18" />
        <rect x="40" y="38" width="16" height="16" rx="4" fill="#3B82F6" fillOpacity="0.22" />
        <rect x="64" y="38" width="16" height="16" rx="4" fill="#635BFF" fillOpacity="0.14" />
        <rect x="16" y="62" width="16" height="16" rx="4" fill="#635BFF" fillOpacity="0.14" />
        <rect x="40" y="62" width="40" height="16" rx="4" fill="#635BFF" fillOpacity="0.2" />
      </g>

      {/* Main foreground notebook glass card */}
      <g transform="translate(132 22) rotate(3)">
        <rect
          width="156"
          height="150"
          rx="24"
          fill="url(#tos-hero-glass-a)"
          stroke="#FFFFFF"
          strokeOpacity="0.88"
          strokeWidth="1.6"
        />
        {/* Mortarboard silhouette */}
        <path
          d="M78 30L116 47L78 64L40 47L78 30Z"
          fill="#FFFFFF"
          fillOpacity="0.9"
          stroke="#818CF8"
          strokeOpacity="0.35"
          strokeWidth="1.2"
        />
        <path
          d="M55 56V71C55 77 65 82 78 82C91 82 101 77 101 71V56"
          stroke="#635BFF"
          strokeOpacity="0.35"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <line
          x1="112"
          y1="49"
          x2="112"
          y2="71"
          stroke="#635BFF"
          strokeOpacity="0.38"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Minimal document lines */}
        <rect x="30" y="98" width="96" height="7" rx="3.5" fill="#635BFF" fillOpacity="0.2" />
        <rect x="30" y="114" width="76" height="7" rx="3.5" fill="#3B82F6" fillOpacity="0.18" />
        <rect x="30" y="130" width="54" height="7" rx="3.5" fill="#8B5CF6" fillOpacity="0.18" />
      </g>

      {/* Stylus accent */}
      <g transform="translate(274 72) rotate(32)">
        <rect
          x="0"
          y="0"
          width="17"
          height="108"
          rx="8.5"
          fill="url(#tos-hero-stylus)"
          stroke="#FFFFFF"
          strokeOpacity="0.9"
          strokeWidth="1.2"
        />
        <path d="M2 102L8.5 118L15 102H2Z" fill="#635BFF" fillOpacity="0.38" />
      </g>

      {/* Subtle four-point light sparkles */}
      <path
        d="M110 34L113 42L121 45L113 48L110 56L107 48L99 45L107 42L110 34Z"
        fill="#FFFFFF"
        fillOpacity="0.88"
      />
      <path
        d="M308 38L310 43L315 45L310 47L308 52L306 47L301 45L306 43L308 38Z"
        fill="#FFFFFF"
        fillOpacity="0.78"
      />
    </svg>
  );
}

export function DesktopHome({
  packs,
  mathExams,
  resources,
  workflows,
  canvasBoards,
  canvasNodes,
  hasActiveUnsavedDraft,
  nextStepSuggestions = [],
  onCreateNewPack,
  onOpenApp,
  onExecuteNextStep,
  onOpenToolsHub,
  onOpenLibrary,
  onOpenPackInStudio,
  onOpenCommandPalette,
  onOpenPackContextMenu,
}: DesktopHomeProps) {
  const tutorial = useOptionalTutorial();

  const drafts = useMemo(
    () => packs.filter((p) => p.status === 'draft'),
    [packs]
  );

  const incompleteWorkflows = useMemo(
    () => workflows.filter((w) => w.steps.some((s) => !s.done)),
    [workflows]
  );

  const recentActivities = useMemo<RecentActivityRow[]>(() => {
    const merged: RecentActivityRow[] = [];

    for (const pack of packs) {
      merged.push({
        id: `pack-${pack.id}`,
        title: pack.title?.trim() || 'Bộ tiết dạy chưa đặt tên',
        moduleLabel: 'Lesson Studio',
        updatedAt: pack.updatedAt,
        kind: 'lesson',
        pack,
        onOpen: () => onOpenPackInStudio(pack),
      });
    }

    for (const exam of mathExams) {
      merged.push({
        id: `exam-${exam.id}`,
        title: exam.title?.trim() || 'Đề kiểm tra chưa đặt tên',
        moduleLabel: 'Exam Mixer Pro',
        updatedAt: exam.updatedAt,
        kind: 'exam',
        onOpen: () => onOpenApp('math-mixer'),
      });
    }

    for (const res of resources) {
      merged.push({
        id: `res-${res.id}`,
        title: res.title?.trim() || 'Tài liệu học tập',
        moduleLabel: 'Resource Vault',
        updatedAt: res.updatedAt,
        kind: 'resource',
        onOpen: () => onOpenApp('resource-vault'),
      });
    }

    for (const wf of workflows) {
      merged.push({
        id: `wf-${wf.id}`,
        title: wf.title?.trim() || 'Quy trình giảng dạy',
        moduleLabel: 'Workflow Center',
        updatedAt: wf.updatedAt,
        kind: 'workflow',
        onOpen: () => onOpenApp('workflow-center'),
      });
    }

    for (const board of canvasBoards) {
      merged.push({
        id: `board-${board.id}`,
        title: board.title?.trim() || 'Bảng không gian làm việc',
        moduleLabel: 'Không gian',
        updatedAt: board.updatedAt,
        kind: 'workspace',
        onOpen: () => onOpenApp('workspace'),
      });
    }

    merged.sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime() || 0;
      const tb = new Date(b.updatedAt).getTime() || 0;
      return tb - ta;
    });

    return merged.slice(0, 4);
  }, [
    canvasBoards,
    mathExams,
    onOpenApp,
    onOpenPackInStudio,
    packs,
    resources,
    workflows,
  ]);

  const continueWorkMeta = useMemo(() => {
    if (hasActiveUnsavedDraft) {
      return {
        subtitle: 'Bạn đang có bản soạn chưa lưu trong Lesson Studio',
        onClick: () => onOpenApp('lesson-studio'),
      };
    }
    if (incompleteWorkflows.length > 0) {
      return {
        subtitle: `Bạn đang có ${incompleteWorkflows.length} workflow dở dang`,
        onClick: () => onOpenApp('workflow-center'),
      };
    }
    if (drafts.length > 0) {
      return {
        subtitle: `Bạn đang có ${drafts.length} giáo án đang soạn dở`,
        onClick: () => onOpenPackInStudio(drafts[0]),
      };
    }
    if (canvasBoards.length > 0) {
      const nodeCount = canvasNodes.length;
      return {
        subtitle:
          nodeCount > 0
            ? `Mở không gian làm việc (${nodeCount} nút sơ đồ)`
            : 'Mở bảng không gian làm việc của bạn',
        onClick: () => onOpenApp('workspace'),
      };
    }
    return {
      subtitle: 'Bắt đầu soạn bộ tiết dạy đầu tiên ngay hôm nay',
      onClick: onCreateNewPack,
    };
  }, [
    canvasBoards.length,
    canvasNodes.length,
    drafts,
    hasActiveUnsavedDraft,
    incompleteWorkflows.length,
    onCreateNewPack,
    onOpenApp,
    onOpenPackInStudio,
  ]);

  const handleRowContextMenu = (
    e: MouseEvent<HTMLElement>,
    pack: LessonPack
  ) => {
    e.preventDefault();
    onOpenPackContextMenu(pack, e.clientX, e.clientY);
  };

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6 sm:py-6 space-y-6">
      {/* Row 1 — Compact Aurora Welcome Hero */}
      <section
        data-tour-id="desktop-hero"
        className="aurora-surface-hero relative overflow-hidden rounded-[22px] px-6 py-6 sm:px-8 sm:py-7"
      >
        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl space-y-3.5">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/80 dark:bg-slate-900/70 border border-white/90 dark:border-indigo-500/25 px-3 py-1 text-xs font-semibold text-[#5046E5] dark:text-indigo-300 shadow-[0_1px_2px_rgba(23,32,51,0.04)]">
              <Sparkles className="h-3.5 w-3.5 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
              <span>Chào mừng đến với TeacherOS</span>
            </div>

            <div className="space-y-1.5">
              <h1 className="text-2xl sm:text-[32px] font-bold tracking-tight text-[#172033] dark:text-white leading-[1.18] text-balance">
                Không gian giảng dạy của bạn
              </h1>
              <p className="text-sm sm:text-[15px] text-[#475569] dark:text-slate-300 leading-relaxed max-w-lg">
                Chuẩn bị bài dạy, tổ chức tài liệu và quản lý công việc tại một nơi.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onOpenApp('workspace')}
                className="aurora-btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
              >
                <Rocket className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Mở không gian làm việc</span>
              </button>

              <button
                type="button"
                onClick={onOpenToolsHub}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80 px-4 py-2.5 text-sm font-semibold text-[#172033] dark:text-slate-100 shadow-[0_1px_2px_rgba(23,32,51,0.04)] hover:border-[#635BFF]/40 hover:bg-white dark:hover:bg-slate-800 transition-all duration-150 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#635BFF]"
              >
                <LayoutGrid className="h-4 w-4 shrink-0 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
                <span>Khám phá công cụ</span>
              </button>
            </div>
          </div>

          {/* Right Lightweight Glass Illustration */}
          <div className="hidden md:flex items-center justify-end w-[270px] lg:w-[320px] h-[168px] shrink-0 pointer-events-none">
            <HeroGlassIllustration />
          </div>
        </div>
      </section>

      {/* Row 2 — Thao tác nhanh (4 Crisp Quick Actions) */}
      <section aria-labelledby="aurora-quick-actions-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="aurora-quick-actions-heading"
            className="inline-flex items-center gap-2 text-[15px] font-bold text-[#172033] dark:text-slate-50"
          >
            <Zap className="h-4 w-4 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
            <span>Thao tác nhanh</span>
          </h2>

          <button
            type="button"
            data-tour-id="desktop-search-btn"
            onClick={onOpenCommandPalette}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-[#5046E5] dark:text-indigo-400 hover:bg-[#EEF0FF] dark:hover:bg-indigo-950/60 transition-colors whitespace-nowrap"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tìm nhanh (Ctrl+K)</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => onOpenApp('exam-generator')}
            className="aurora-quick-card group flex items-center justify-between gap-3 rounded-2xl p-3.5 text-left focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F3F0FF] dark:bg-indigo-950/80 text-[#635BFF] dark:text-indigo-400 border border-[#635BFF]/15">
                <Sparkles className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-[#172033] dark:text-slate-100 truncate">
                  Tạo đề kiểm tra
                </div>
                <div className="text-xs text-[#64748B] dark:text-slate-400 truncate">
                  Nhập yêu cầu tiếng Việt
                </div>
              </div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-[#635BFF] dark:group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={() => onOpenApp('math-mixer')}
            className="aurora-quick-card group flex items-center justify-between gap-3 rounded-2xl p-3.5 text-left focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5F0FF] dark:bg-violet-950/80 text-[#7C3AED] dark:text-violet-400 border border-violet-500/15">
                <Layers className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-[#172033] dark:text-slate-100 truncate">
                  Trộn đề kiểm tra
                </div>
                <div className="text-xs text-[#64748B] dark:text-slate-400 truncate">
                  Tạo và quản lý đề
                </div>
              </div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-[#7C3AED] dark:group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={() => onOpenApp('resource-vault')}
            className="aurora-quick-card group flex items-center justify-between gap-3 rounded-2xl p-3.5 text-left focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFF6FF] dark:bg-sky-950/80 text-[#2563EB] dark:text-sky-400 border border-blue-500/15">
                <Folder className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-[#172033] dark:text-slate-100 truncate">
                  Mở kho tài liệu
                </div>
                <div className="text-xs text-[#64748B] dark:text-slate-400 truncate">
                  Tìm kiếm và sử dụng
                </div>
              </div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-[#2563EB] dark:group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={() => onOpenApp('grading-studio')}
            className="aurora-quick-card group flex items-center justify-between gap-3 rounded-2xl p-3.5 text-left focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ECFEFF] dark:bg-cyan-950/80 text-[#0891B2] dark:text-cyan-400 border border-cyan-500/20">
                <Target className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-[#172033] dark:text-slate-100 truncate">
                  Chấm bài & Bảng điểm
                </div>
                <div className="text-xs text-[#64748B] dark:text-slate-400 truncate">
                  Phiếu OMR & tổng hợp
                </div>
              </div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-[#0891B2] dark:group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all"
              aria-hidden="true"
            />
          </button>
        </div>
      </section>

      {/* Row 2.5 — Gợi ý bước tiếp theo từ trạng thái dữ liệu thực (Section 10 — 100% cục bộ) */}
      {nextStepSuggestions.length > 0 && (
        <section
          aria-labelledby="aurora-next-steps-heading"
          className="space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="aurora-next-steps-heading"
              className="inline-flex items-center gap-2 text-[15px] font-bold text-[#172033] dark:text-slate-50"
            >
              <Target className="h-4 w-4 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
              <span>Gợi ý bước tiếp theo (dựa trên dữ liệu hiện có)</span>
            </h2>
            <button
              type="button"
              onClick={onCreateNewPack}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#5046E5] dark:text-indigo-400 hover:underline whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Soạn giáo án mới</span>
            </button>
          </div>

          <div
            className={`grid grid-cols-1 gap-3 ${
              nextStepSuggestions.length === 1
                ? 'md:grid-cols-1'
                : nextStepSuggestions.length === 2
                ? 'md:grid-cols-2'
                : 'lg:grid-cols-3'
            }`}
          >
            {nextStepSuggestions.map((item) => (
              <div
                key={item.id}
                className="aurora-surface-glass rounded-2xl p-4 flex flex-col justify-between gap-3 border border-indigo-200/60 dark:border-indigo-900/50"
              >
                <div className="space-y-1.5">
                  <span className="inline-flex items-center rounded-md bg-[#EEF0FF] dark:bg-indigo-950/70 px-2 py-0.5 text-[11px] font-semibold text-[#4338CA] dark:text-indigo-300">
                    {item.badgeText}
                  </span>
                  <h3 className="text-sm font-bold text-[#172033] dark:text-slate-100 leading-snug">
                    {item.title}
                  </h3>
                  <p className="text-xs text-[#64748B] dark:text-slate-400 leading-relaxed">
                    {item.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      onExecuteNextStep
                        ? onExecuteNextStep(item, false)
                        : onOpenApp(item.targetApp)
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5248f0] transition-colors"
                  >
                    <span>{item.primaryActionLabel}</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  {item.secondaryActionLabel && item.secondaryTargetApp && (
                    <button
                      type="button"
                      onClick={() =>
                        onExecuteNextStep
                          ? onExecuteNextStep(item, true)
                          : onOpenApp(item.secondaryTargetApp!)
                      }
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-300"
                    >
                      <span>{item.secondaryActionLabel}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Row 3 — Các ứng dụng của TeacherOS (2x2 Premium Aurora Bento Grid) */}
      <section aria-labelledby="aurora-apps-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="aurora-apps-heading"
            className="inline-flex items-center gap-2 text-[15px] font-bold text-[#172033] dark:text-slate-50"
          >
            <LayoutGrid className="h-4 w-4 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
            <span>Các ứng dụng của TeacherOS</span>
          </h2>

          <button
            type="button"
            onClick={onOpenToolsHub}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#5046E5] dark:text-indigo-400 hover:underline whitespace-nowrap"
          >
            <span>Tất cả công cụ</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Card 1: Lesson Studio */}
          <button
            type="button"
            onClick={() => onOpenApp('lesson-studio')}
            className="aurora-module-card aurora-card-lesson group flex items-center justify-between gap-4 rounded-[20px] p-5 sm:p-6 text-left min-h-[124px] focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <div className="relative z-10 flex items-center gap-4 min-w-0">
              <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#635BFF] to-[#3B82F6] text-white shadow-[0_8px_18px_-4px_rgba(99,91,255,0.45)]">
                <BookOpen className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="text-[17px] sm:text-lg font-bold tracking-tight text-[#172033] dark:text-white truncate">
                  Lesson Studio
                </h3>
                <p className="text-xs sm:text-[13px] text-[#475569] dark:text-slate-300 truncate">
                  Soạn và tổ chức bài giảng
                </p>
              </div>
            </div>

            {/* Subtle decorative open-book watermark */}
            <BookOpen
              aria-hidden="true"
              className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 h-24 w-24 text-[#3B82F6]/[0.11] dark:text-blue-400/[0.12] transition-transform duration-200 group-hover:scale-105"
            />

            <span className="relative z-10 mt-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/90 dark:bg-slate-900/80 text-[#5046E5] dark:text-indigo-300 shadow-sm group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>

          {/* Card 2: Exam Mixer Pro */}
          <button
            type="button"
            onClick={() => onOpenApp('math-mixer')}
            className="aurora-module-card aurora-card-exam group flex items-center justify-between gap-4 rounded-[20px] p-5 sm:p-6 text-left min-h-[124px] focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <span className="absolute right-4 top-3.5 z-10 inline-flex items-center rounded-full bg-amber-100/95 dark:bg-amber-900/60 border border-amber-300/70 dark:border-amber-600/40 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">
              Pro
            </span>

            <div className="relative z-10 flex items-center gap-4 min-w-0">
              <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#635BFF] text-white shadow-[0_8px_18px_-4px_rgba(139,92,246,0.45)]">
                <Layers className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="text-[17px] sm:text-lg font-bold tracking-tight text-[#172033] dark:text-white truncate">
                  Exam Mixer Pro
                </h3>
                <p className="text-xs sm:text-[13px] text-[#475569] dark:text-slate-300 truncate">
                  Quản lý và trộn đề kiểm tra
                </p>
              </div>
            </div>

            <Layers
              aria-hidden="true"
              className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 h-24 w-24 text-[#8B5CF6]/[0.12] dark:text-violet-400/[0.13] transition-transform duration-200 group-hover:scale-105"
            />

            <span className="relative z-10 mt-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/90 dark:bg-slate-900/80 text-[#7C3AED] dark:text-violet-300 shadow-sm group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>

          {/* Card 3: Resource Vault */}
          <button
            type="button"
            onClick={() => onOpenApp('resource-vault')}
            className="aurora-module-card aurora-card-vault group flex items-center justify-between gap-4 rounded-[20px] p-5 sm:p-6 text-left min-h-[124px] focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <div className="relative z-10 flex items-center gap-4 min-w-0">
              <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#38BDF8] to-[#2563EB] text-white shadow-[0_8px_18px_-4px_rgba(37,99,235,0.38)]">
                <Folder className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="text-[17px] sm:text-lg font-bold tracking-tight text-[#172033] dark:text-white truncate">
                  Resource Vault
                </h3>
                <p className="text-xs sm:text-[13px] text-[#475569] dark:text-slate-300 truncate">
                  Lưu trữ và tìm kiếm tài liệu
                </p>
              </div>
            </div>

            <Folder
              aria-hidden="true"
              className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 h-24 w-24 text-[#0EA5E9]/[0.12] dark:text-sky-400/[0.12] transition-transform duration-200 group-hover:scale-105"
            />

            <span className="relative z-10 mt-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/90 dark:bg-slate-900/80 text-[#0284C7] dark:text-sky-300 shadow-sm group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>

          {/* Card 4: Workflow Center */}
          <button
            type="button"
            onClick={() => onOpenApp('workflow-center')}
            className="aurora-module-card aurora-card-workflow group flex items-center justify-between gap-4 rounded-[20px] p-5 sm:p-6 text-left min-h-[124px] focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <div className="relative z-10 flex items-center gap-4 min-w-0">
              <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#A855F7] to-[#635BFF] text-white shadow-[0_8px_18px_-4px_rgba(168,85,247,0.42)]">
                <GitBranch className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="text-[17px] sm:text-lg font-bold tracking-tight text-[#172033] dark:text-white truncate">
                  Workflow Center
                </h3>
                <p className="text-xs sm:text-[13px] text-[#475569] dark:text-slate-300 truncate">
                  Tổ chức quy trình làm việc
                </p>
              </div>
            </div>

            <GitBranch
              aria-hidden="true"
              className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 h-24 w-24 text-[#9333EA]/[0.11] dark:text-purple-400/[0.12] transition-transform duration-200 group-hover:scale-105"
            />

            <span className="relative z-10 mt-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/90 dark:bg-slate-900/80 text-[#7C3AED] dark:text-purple-300 shadow-sm group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        </div>
      </section>

      {/* Row 4 — Bottom 2-Column Bento Split (100% Real IndexedDB Data) */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-stretch">
        {/* Left: Hoạt động gần đây */}
        <div
          aria-labelledby="aurora-recent-heading"
          className="lg:col-span-7 aurora-surface-glass rounded-[20px] p-5 space-y-3.5 flex flex-col"
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="aurora-recent-heading"
              className="inline-flex items-center gap-2 text-[15px] font-bold text-[#172033] dark:text-slate-50"
            >
              <Clock className="h-4 w-4 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
              <span>Hoạt động gần đây</span>
            </h2>
            <button
              type="button"
              onClick={onOpenLibrary}
              className="text-xs font-semibold text-[#5046E5] dark:text-indigo-400 hover:underline whitespace-nowrap"
            >
              Xem tất cả
            </button>
          </div>

          {recentActivities.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300/90 dark:border-slate-700 bg-white/70 dark:bg-slate-900/50 px-5 py-8 text-center">
              <p className="text-sm font-medium text-[#172033] dark:text-slate-200">
                Chưa có hoạt động gần đây
              </p>
              <p className="mt-1 text-xs text-[#64748B] dark:text-slate-400">
                Các giáo án, đề kiểm tra, tài liệu hoặc workflow bạn tạo sẽ hiển thị tại đây.
              </p>
              <button
                type="button"
                onClick={onCreateNewPack}
                className="aurora-btn-primary mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tạo giáo án đầu tiên</span>
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200/60 dark:divide-slate-800/80">
              {recentActivities.map((item) => {
                const iconBoxClass =
                  item.kind === 'exam'
                    ? 'bg-[#F5F0FF] dark:bg-violet-950/75 text-[#7C3AED] dark:text-violet-400'
                    : item.kind === 'resource'
                    ? 'bg-[#EFF6FF] dark:bg-sky-950/75 text-[#2563EB] dark:text-sky-400'
                    : item.kind === 'workflow'
                    ? 'bg-[#ECFEFF] dark:bg-cyan-950/75 text-[#0891B2] dark:text-cyan-400'
                    : 'bg-[#F3F0FF] dark:bg-indigo-950/75 text-[#635BFF] dark:text-indigo-400';

                return (
                  <li
                    key={item.id}
                    onContextMenu={
                      item.pack
                        ? (e) => handleRowContextMenu(e, item.pack!)
                        : undefined
                    }
                    className="group flex items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-0.5"
                  >
                    <button
                      type="button"
                      onClick={item.onOpen}
                      className="flex flex-1 items-center gap-3 min-w-0 rounded-xl px-2 py-1.5 -mx-2 text-left hover:bg-[#EEF0FF]/65 dark:hover:bg-slate-800/70 transition-colors focus-visible:outline-2 focus-visible:outline-[#635BFF]"
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBoxClass}`}
                      >
                        {item.kind === 'exam' ? (
                          <Layers className="h-4 w-4" aria-hidden="true" />
                        ) : item.kind === 'resource' ? (
                          <Folder className="h-4 w-4" aria-hidden="true" />
                        ) : item.kind === 'workflow' ? (
                          <GitBranch className="h-4 w-4" aria-hidden="true" />
                        ) : item.kind === 'workspace' ? (
                          <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold text-[#172033] dark:text-slate-100 truncate group-hover:text-[#5046E5] dark:group-hover:text-indigo-300 transition-colors">
                          {item.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#64748B] dark:text-slate-400 truncate">
                          <span>{item.moduleLabel}</span>
                          {item.updatedAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-num">
                                {formatRelativeOrDateVi(item.updatedAt)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>

                    {item.pack ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          onOpenPackContextMenu(
                            item.pack!,
                            rect.left,
                            rect.bottom + 4
                          );
                        }}
                        aria-label={`Thao tác nhanh cho ${item.title}`}
                        title="Thao tác nhanh"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-[#EEF0FF] dark:hover:bg-slate-800 hover:text-[#172033] dark:hover:text-slate-200 transition-colors shrink-0"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={item.onOpen}
                        aria-label={`Mở ${item.title}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-[#EEF0FF] dark:hover:bg-slate-800 hover:text-[#5046E5] dark:hover:text-indigo-400 transition-colors shrink-0"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: Không gian làm việc (100% Real IndexedDB Counts + Real Resume Card) */}
        <div
          aria-labelledby="aurora-workspace-heading"
          className="lg:col-span-5 aurora-surface-glass rounded-[20px] p-5 flex flex-col justify-between gap-4"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2
                id="aurora-workspace-heading"
                className="inline-flex items-center gap-2 text-[15px] font-bold text-[#172033] dark:text-slate-50"
              >
                <BarChart3 className="h-4 w-4 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
                <span>Không gian làm việc</span>
              </h2>

              {tutorial && (
                <button
                  type="button"
                  onClick={tutorial.openLauncher}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#5046E5] dark:text-indigo-400 hover:underline whitespace-nowrap"
                >
                  <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Hướng dẫn</span>
                </button>
              )}
            </div>

            {/* 3 Real IndexedDB Count Tiles */}
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={onOpenLibrary}
                className="group rounded-2xl border border-slate-200/75 dark:border-slate-700/80 bg-[#F8F9FF]/90 dark:bg-slate-800/75 p-3 text-left hover:border-[#635BFF]/40 hover:bg-white dark:hover:bg-slate-800 transition-all focus-visible:outline-2 focus-visible:outline-[#635BFF]"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F3F0FF] dark:bg-indigo-950/90 text-[#635BFF] dark:text-indigo-400">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-lg font-bold font-mono-num text-[#172033] dark:text-white">
                    {packs.length}
                  </span>
                </div>
                <div className="mt-1.5 text-[11.5px] font-medium text-[#64748B] dark:text-slate-400 truncate">
                  Giáo án
                </div>
              </button>

              <button
                type="button"
                onClick={() => onOpenApp('math-mixer')}
                className="group rounded-2xl border border-slate-200/75 dark:border-slate-700/80 bg-[#F8F9FF]/90 dark:bg-slate-800/75 p-3 text-left hover:border-violet-500/40 hover:bg-white dark:hover:bg-slate-800 transition-all focus-visible:outline-2 focus-visible:outline-[#635BFF]"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F5F0FF] dark:bg-violet-950/90 text-[#7C3AED] dark:text-violet-400">
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-lg font-bold font-mono-num text-[#172033] dark:text-white">
                    {mathExams.length}
                  </span>
                </div>
                <div className="mt-1.5 text-[11.5px] font-medium text-[#64748B] dark:text-slate-400 truncate">
                  Đề kiểm tra
                </div>
              </button>

              <button
                type="button"
                onClick={() => onOpenApp('resource-vault')}
                className="group rounded-2xl border border-slate-200/75 dark:border-slate-700/80 bg-[#F8F9FF]/90 dark:bg-slate-800/75 p-3 text-left hover:border-sky-500/40 hover:bg-white dark:hover:bg-slate-800 transition-all focus-visible:outline-2 focus-visible:outline-[#635BFF]"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] dark:bg-emerald-950/80 text-[#059669] dark:text-emerald-400">
                    <Folder className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-lg font-bold font-mono-num text-[#172033] dark:text-white">
                    {resources.length}
                  </span>
                </div>
                <div className="mt-1.5 text-[11.5px] font-medium text-[#64748B] dark:text-slate-400 truncate">
                  Tài liệu
                </div>
              </button>
            </div>

            {/* Tiếp tục công việc (Real Resume Card) */}
            <button
              type="button"
              onClick={continueWorkMeta.onClick}
              className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-[#635BFF]/20 dark:border-indigo-500/30 bg-gradient-to-r from-[#F5F2FF] to-[#EEF4FF] dark:from-indigo-950/75 dark:to-slate-900/85 p-3.5 text-left hover:border-[#635BFF]/45 transition-all focus-visible:outline-2 focus-visible:outline-[#635BFF]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/90 dark:bg-slate-900/90 text-[#635BFF] dark:text-indigo-400 shadow-sm">
                  <Target className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-[#172033] dark:text-white">
                    Tiếp tục công việc
                  </div>
                  <div className="text-xs text-[#475569] dark:text-slate-300 truncate">
                    {continueWorkMeta.subtitle}
                  </div>
                </div>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-[#635BFF] dark:text-indigo-400 group-hover:translate-x-0.5 transition-transform"
                aria-hidden="true"
              />
            </button>
          </div>

          {/* Subtle Real Workspace Footer Metadata */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200/60 dark:border-slate-800/80 text-[11.5px] text-[#64748B] dark:text-slate-400">
            <span className="font-mono-num">
              {canvasBoards.length} bảng không gian · {workflows.length} quy trình
            </span>
            <button
              type="button"
              onClick={() => onOpenApp('settings')}
              className="font-medium text-[#5046E5] dark:text-indigo-400 hover:underline whitespace-nowrap"
            >
              Sao lưu JSON
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
