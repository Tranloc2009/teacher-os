import { MouseEvent, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  FileText,
  Folder,
  GitBranch,
  GitMerge,
  GraduationCap,
  Layers,
  LayoutGrid,
  MoreHorizontal,
  Play,
  Plus,
  Rocket,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import { AppId } from '../../core/appRegistry';
import type { CanvasBoard, CanvasNodeRecord } from '../../types/canvas';
import { LessonPack, ResourceItem, WorkflowRun } from '../../types/lesson';
import type { MathExamProject } from '../../types/mathExam';
import type { GradingSession } from '../../types/grading';
import type { GeneratedExamDraft } from '../../types/examGenerator';
import type {
  ConnectedWorkspaceWorkflowSummary,
  DashboardNextStepSuggestion,
} from '../../types/connectedWorkflow';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { HeroShowcaseVideo } from './HeroShowcaseVideo';

interface DesktopHomeProps {
  isActive?: boolean;
  packs: LessonPack[];
  mathExams: MathExamProject[];
  resources: ResourceItem[];
  workflows: WorkflowRun[];
  gradingSessions?: GradingSession[];
  examDrafts?: GeneratedExamDraft[];
  canvasBoards: CanvasBoard[];
  canvasNodes: CanvasNodeRecord[];
  hasActiveUnsavedDraft: boolean;
  nextStepSuggestions?: DashboardNextStepSuggestion[];
  connectedWorkspaceSummaries?: ConnectedWorkspaceWorkflowSummary[];
  onCreateNewPack: () => void;
  onOpenApp: (appId: AppId) => void;
  onExecuteNextStep?: (
    suggestion: DashboardNextStepSuggestion,
    useSecondary?: boolean
  ) => void;
  onResumeWorkflow?: (summary: ConnectedWorkspaceWorkflowSummary) => void;
  onStartNewConnectedWorkflow?: () => void;
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

export function DesktopHome({
  isActive = true,
  packs,
  mathExams,
  resources,
  workflows,
  gradingSessions = [],
  examDrafts = [],
  canvasBoards,
  canvasNodes,
  hasActiveUnsavedDraft,
  nextStepSuggestions = [],
  connectedWorkspaceSummaries = [],
  onCreateNewPack,
  onOpenApp,
  onExecuteNextStep,
  onResumeWorkflow,
  onStartNewConnectedWorkflow,
  onOpenToolsHub,
  onOpenLibrary,
  onOpenPackInStudio,
  onOpenCommandPalette,
  onOpenPackContextMenu,
}: DesktopHomeProps) {
  const tutorial = useOptionalTutorial();

  const workspaceMetrics = useMemo(() => {
    const examsNeedingAnswerConfirm = mathExams.filter(
      (e) =>
        e.questions.length > 0 &&
        (!e.confirmedOriginalAnswers || e.questions.some((q) => !q.answerConfirmed))
    ).length;
    const totalGeneratedCodes = mathExams.reduce(
      (acc, e) => acc + e.generatedVersions.length,
      0
    );
    const pendingOmrSheets = gradingSessions.reduce((acc, s) => {
      return (
        acc +
        s.sheets.filter(
          (sh) =>
            !sh.archivedByDuplicateResolution &&
            !sh.confirmedByTeacher &&
            (sh.status === 'review-required' ||
              sh.status === 'error' ||
              sh.uncertainCount > 0)
        ).length
      );
    }, 0);
    return {
      draftExamsCount: examDrafts.length + mathExams.filter((e) => e.generatedVersions.length === 0).length,
      examsNeedingAnswerConfirm,
      totalGeneratedCodes,
      gradingSessionsCount: gradingSessions.length,
      pendingOmrSheets,
    };
  }, [examDrafts.length, gradingSessions, mathExams]);

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
      {/* Row 1 — Aurora Welcome Hero with Integrated 16:9 TeacherOS 4.0 Showcase Video */}
      <section
        data-tour-id="desktop-hero"
        className="aurora-surface-hero relative overflow-hidden rounded-[22px] p-5 sm:p-7 lg:p-8"
      >
        <div className="relative z-10 grid grid-cols-1 items-center gap-6 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5 space-y-4">
            <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#5046E5] dark:text-indigo-300">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
              <span>TeacherOS 4.0 · Không gian hợp nhất</span>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl sm:text-[32px] lg:text-[34px] font-bold tracking-tight text-[#172033] dark:text-white leading-[1.15] text-balance">
                Không gian giảng dạy của bạn
              </h1>
              <p className="text-sm sm:text-[15px] text-[#475569] dark:text-slate-300 leading-relaxed max-w-lg">
                Chuẩn bị bài dạy, trộn đề an toàn, tổ chức tài liệu và quản lý công việc tại một nơi.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onOpenApp('workspace')}
                className="aurora-btn-primary inline-flex min-h-[42px] items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
              >
                <Rocket className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Mở không gian làm việc</span>
              </button>

              <button
                type="button"
                onClick={onOpenToolsHub}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80 px-4 py-2.5 text-sm font-semibold text-[#172033] dark:text-slate-100 shadow-[0_1px_2px_rgba(23,32,51,0.04)] hover:border-[#635BFF]/40 hover:bg-white dark:hover:bg-slate-800 transition-all duration-150 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#635BFF]"
              >
                <LayoutGrid className="h-4 w-4 shrink-0 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
                <span>Khám phá công cụ</span>
              </button>
            </div>
          </div>

          {/* Right 16:9 Showcase Video Frame (visible across Desktop & Mobile) */}
          <div className="lg:col-span-7 w-full">
            <HeroShowcaseVideo isActive={isActive} />
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

      {/* Row 2.25 — My Teaching Workspace (Connected Workflows & Live Exam Pipeline Status) */}
      <section
        aria-labelledby="aurora-my-workspace-heading"
        data-testid="connected-workspace-dashboard"
        className="aurora-surface-glass rounded-[20px] p-5 space-y-4 border border-indigo-200/60 dark:border-indigo-900/50"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2
              id="aurora-my-workspace-heading"
              className="inline-flex items-center gap-2 text-[15px] font-bold text-[#172033] dark:text-slate-50"
            >
              <GitMerge className="h-4 w-4 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />
              <span>My Teaching Workspace · Quy trình kiểm tra liên thông</span>
            </h2>
            <p className="text-xs text-[#64748B] dark:text-slate-400">
              Theo dõi trạng thái thực tế của toàn bộ luồng từ Resource Vault → Tạo đề → Duyệt đáp án → Trộn mã → Chấm OMR.
            </p>
          </div>
          {onStartNewConnectedWorkflow && (
            <button
              type="button"
              onClick={onStartNewConnectedWorkflow}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-[#4338CA] dark:text-indigo-300 hover:bg-[#EEF0FF] dark:hover:bg-indigo-950/60 transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Quy trình mới</span>
            </button>
          )}
        </div>

        {/* 4 Real Workspace Status Counters */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => onOpenApp('exam-generator')}
            className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/85 dark:bg-slate-900/75 px-3.5 py-2.5 text-left hover:border-[#635BFF]/45 transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Đề đang soạn / nháp
            </div>
            <div className="mt-1 text-lg font-bold font-mono-num text-[#172033] dark:text-white">
              {workspaceMetrics.draftExamsCount}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenApp('math-mixer')}
            className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/85 dark:bg-slate-900/75 px-3.5 py-2.5 text-left hover:border-amber-400/60 transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Chờ xác nhận đáp án
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-bold font-mono-num text-amber-700 dark:text-amber-300">
                {workspaceMetrics.examsNeedingAnswerConfirm}
              </span>
              <span className="text-[11px] text-slate-500">đề</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenApp('print-studio')}
            className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/85 dark:bg-slate-900/75 px-3.5 py-2.5 text-left hover:border-violet-400/60 transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Mã đề đã tạo
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-bold font-mono-num text-violet-700 dark:text-violet-300">
                {workspaceMetrics.totalGeneratedCodes}
              </span>
              <span className="text-[11px] text-slate-500">mã</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenApp('grading-studio')}
            className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/85 dark:bg-slate-900/75 px-3.5 py-2.5 text-left hover:border-cyan-400/60 transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Phiên chấm OMR
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-bold font-mono-num text-cyan-700 dark:text-cyan-300">
                {workspaceMetrics.gradingSessionsCount}
              </span>
              <span className="text-[11px] text-slate-500 truncate">
                {workspaceMetrics.pendingOmrSheets > 0
                  ? `· ${workspaceMetrics.pendingOmrSheets} cần duyệt`
                  : 'phiên'}
              </span>
            </div>
          </button>
        </div>

        {/* Active & Recent Connected Workflows */}
        {connectedWorkspaceSummaries.length > 0 && (
          <div className="space-y-2.5">
            {connectedWorkspaceSummaries.slice(0, 3).map((summary) => {
              const wfTitle =
                summary.workflow.generatedExamTitle ||
                summary.workflow.examDraftTitle ||
                summary.workflow.resourceTitle ||
                summary.workflow.title;

              const badgeStyle =
                summary.validation.status === 'blocked'
                  ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                  : summary.validation.status === 'missing-reference'
                  ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                  : summary.validation.status === 'needs-review'
                  ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                  : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300';

              const badgeText =
                summary.validation.status === 'blocked'
                  ? 'Bị chặn kiểm chứng'
                  : summary.validation.status === 'missing-reference'
                  ? 'Thiếu liên kết nguồn'
                  : summary.validation.status === 'needs-review'
                  ? 'Cần duyệt'
                  : 'Đạt chuẩn';

              return (
                <div
                  key={summary.workflow.workflowId}
                  className={`rounded-2xl border p-3.5 transition-colors ${
                    summary.isActive
                      ? 'border-[#635BFF]/45 bg-white dark:bg-slate-900 shadow-xs'
                      : 'border-slate-200/80 dark:border-slate-800 bg-white/75 dark:bg-slate-900/60'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {summary.isActive && (
                          <span className="rounded-md bg-[#EEF0FF] dark:bg-indigo-950 px-2 py-0.5 text-[10.5px] font-bold text-[#4338CA] dark:text-indigo-300">
                            Đang mở
                          </span>
                        )}
                        <h3 className="text-sm font-bold text-[#172033] dark:text-slate-100 truncate">
                          {wfTitle}
                        </h3>
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10.5px] font-semibold ${badgeStyle}`}
                        >
                          {badgeText}
                        </span>
                        <span className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                          {summary.completedStageCount}/{summary.totalStageCount} chặng
                        </span>
                      </div>

                      {/* 5-step compact progress checklist */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {summary.fiveStepProgress.map((st, idx) => (
                          <div
                            key={st.key}
                            className="inline-flex items-center gap-1 text-[11px] font-medium"
                          >
                            {st.status === 'completed' ? (
                              <CheckCircle2
                                className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                                aria-hidden="true"
                              />
                            ) : st.status === 'blocked' ? (
                              <ShieldAlert
                                className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400"
                                aria-hidden="true"
                              />
                            ) : st.status === 'needs-review' ? (
                              <AlertTriangle
                                className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400"
                                aria-hidden="true"
                              />
                            ) : st.status === 'in-progress' ? (
                              <Clock
                                className="h-3.5 w-3.5 text-[#635BFF] dark:text-indigo-400"
                                aria-hidden="true"
                              />
                            ) : (
                              <Circle
                                className="h-3 w-3 text-slate-300 dark:text-slate-600"
                                aria-hidden="true"
                              />
                            )}
                            <span
                              className={
                                st.status === 'completed'
                                  ? 'text-emerald-800 dark:text-emerald-300'
                                  : st.status === 'blocked'
                                  ? 'text-rose-700 dark:text-rose-300'
                                  : st.status === 'needs-review'
                                  ? 'text-amber-800 dark:text-amber-300'
                                  : 'text-slate-600 dark:text-slate-400'
                              }
                            >
                              {st.label}
                            </span>
                            {idx < summary.fiveStepProgress.length - 1 && (
                              <span
                                className="text-slate-300 dark:text-slate-700 mx-0.5"
                                aria-hidden="true"
                              >
                                →
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onResumeWorkflow
                          ? onResumeWorkflow(summary)
                          : onOpenApp(summary.resumeAction.targetApp)
                      }
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#635BFF] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#5248f0] transition-colors shrink-0 whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Tiếp tục công việc</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
