import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  CopyPlus,
  Download,
  Edit3,
  FolderKanban,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  Plus,
  Printer,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  JournalEntry,
  LessonPack,
  PrintSettings,
  ResourceItem,
  WorkflowRun,
} from '../../types/lesson';
import { MathExamProject } from '../../types/mathExam';
import {
  CanvasBoard,
  CanvasEdgeRecord,
  CanvasEntityRef,
  CanvasNodeRecord,
  CanvasViewSettings,
} from '../../types/canvas';
import { ThemeMode } from '../../core/theme';
import {
  createHandoverKitPayload,
  inspectLessonPack,
} from '../../core/workspaceModules';
import {
  buildCanvasCommitBundle,
  parseVietnameseWorkflow,
} from '../../core/smartWorkflowParser';
import { createId } from '../../db/database';
import { VisualWorkspaceCanvas } from '../canvas/VisualWorkspaceCanvas';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { Button, PageBanner } from '../ui/DesignSystem';

interface MyWorkspaceAppProps {
  packs: LessonPack[];
  activePack: LessonPack;
  settings: PrintSettings;
  resources: ResourceItem[];
  journals: JournalEntry[];
  workflows: WorkflowRun[];
  mathExams: MathExamProject[];
  theme: ThemeMode;
  canvasBoards: CanvasBoard[];
  canvasNodes: CanvasNodeRecord[];
  canvasEdges: CanvasEdgeRecord[];
  canvasViewSettings: CanvasViewSettings[];
  onSaveCanvasBoard: (board: CanvasBoard) => Promise<void>;
  onSaveCanvasNode: (node: CanvasNodeRecord) => Promise<void>;
  onBulkSaveCanvasNodes: (nodes: CanvasNodeRecord[]) => Promise<void>;
  onBulkSaveCanvasBundle: (
    nodes: CanvasNodeRecord[],
    edges: CanvasEdgeRecord[],
    removedEdgeIds?: string[]
  ) => Promise<void>;
  onDeleteCanvasNode: (nodeId: string) => Promise<void>;
  onBulkDeleteCanvasNodes: (nodeIds: string[]) => Promise<void>;
  onSaveCanvasEdge: (edge: CanvasEdgeRecord) => Promise<void>;
  onDeleteCanvasEdge: (edgeId: string) => Promise<void>;
  onReplaceBoardCanvasState: (boardId: string, nodes: CanvasNodeRecord[], edges: CanvasEdgeRecord[]) => Promise<void>;
  onSaveCanvasViewSettings: (view: CanvasViewSettings) => Promise<void>;
  onOpenCanvasEntity: (ref: CanvasEntityRef) => void;
  onOpenInStudio: (pack: LessonPack) => void;
  onOpenInPrint: (pack: LessonPack) => void;
  onCreateVariant: (
    pack: LessonPack,
    mode: 'toggle-duration' | 'parallel-class'
  ) => Promise<void>;
  onOpenResourceVault: () => void;
  onOpenTeachingJournal: () => void;
  onShowToast: (tone: 'success' | 'info' | 'error', text: string) => void;
}

type WorkspaceSubView = 'overview' | 'smart-plan' | 'canvas' | 'classic';

const SMART_PLAN_PRESETS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Chuẩn bị đề kiểm tra',
    prompt:
      'Tạo đề kiểm tra học kỳ 1 môn Toán lớp 10 gồm 30 câu trắc nghiệm, trộn 4 mã đề và kiểm tra đáp án trước thứ Sáu',
  },
  {
    label: 'Lập kế hoạch ôn tập',
    prompt:
      'Xây dựng kế hoạch ôn tập giữa kỳ môn Toán lớp 12: hệ thống hóa công thức, soạn phiếu bài tập phân hóa và chấm rubric',
  },
  {
    label: 'Tổ chức hoạt động học',
    prompt:
      'Soạn bài dạy Hàm số bậc hai lớp 10 trong 45 phút: khởi động 10 phút, thảo luận nhóm 20 phút, phiếu học tập 15 phút',
  },
  {
    label: 'Thiết kế bài dạy theo chủ đề',
    prompt:
      'Thiết kế chuyên đề hình học không gian lớp 11: chuẩn bị học liệu, soạn giáo án 2 tiết, in phiếu A4 và ghi nhật ký sau tiết dạy',
  },
  {
    label: 'Đánh giá và tổng kết học kỳ',
    prompt:
      'Tổng kết học kỳ: rà soát ngân hàng câu hỏi, trộn đề kiểm tra 4 mã, xuất bảng đáp án CSV và lưu hồ sơ chuyên môn',
  },
];

export function MyWorkspaceApp({
  packs,
  activePack,
  settings,
  resources,
  journals,
  workflows,
  mathExams,
  theme,
  canvasBoards,
  canvasNodes,
  canvasEdges,
  canvasViewSettings,
  onSaveCanvasBoard,
  onSaveCanvasNode,
  onBulkSaveCanvasNodes,
  onBulkSaveCanvasBundle,
  onDeleteCanvasNode,
  onBulkDeleteCanvasNodes,
  onSaveCanvasEdge,
  onDeleteCanvasEdge,
  onReplaceBoardCanvasState,
  onSaveCanvasViewSettings,
  onOpenCanvasEntity,
  onOpenInStudio,
  onOpenInPrint,
  onCreateVariant,
  onOpenResourceVault,
  onOpenTeachingJournal,
  onShowToast,
}: MyWorkspaceAppProps) {
  const [viewMode, setViewMode] = useState<WorkspaceSubView>('overview');
  const tutorial = useOptionalTutorial();

  useEffect(() => {
    if (
      tutorial?.activeTutorial?.tutorialId === 'tutorial.workspace' &&
      viewMode !== 'canvas'
    ) {
      setViewMode('canvas');
    }
  }, [tutorial?.activeTutorial?.tutorialId, viewMode]);

  const [selectedSubject, setSelectedSubject] = useState<string>('ALL');
  const [selectedGrade, setSelectedGrade] = useState<string>('ALL');
  const [inspectedPackId, setInspectedPackId] = useState<string>(
    activePack.id || packs[0]?.id || ''
  );

  // New Workspace Creation Modal state
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');

  // Smart Planner state (Reference Image 3)
  const [smartPrompt, setSmartPrompt] = useState<string>(
    SMART_PLAN_PRESETS[0].prompt
  );
  const [confirmBeforeCreate, setConfirmBeforeCreate] = useState(true);
  const [isEditingProposal, setIsEditingProposal] = useState(false);
  const [customGoalOverride, setCustomGoalOverride] = useState<string>('');

  const activeBoard = useMemo(
    () =>
      canvasBoards.find((b) => b.mode === 'workspace') ??
      canvasBoards[0] ??
      null,
    [canvasBoards]
  );

  const activeBoardNodes = useMemo(
    () =>
      activeBoard
        ? canvasNodes.filter((n) => n.boardId === activeBoard.id)
        : [],
    [activeBoard, canvasNodes]
  );

  const smartDraft = useMemo(
    () =>
      parseVietnameseWorkflow(smartPrompt, {
        existingBoardNodes: activeBoardNodes,
        layoutMode: 'tree-tb',
      }),
    [smartPrompt, activeBoardNodes]
  );

  const subjects = useMemo(() => {
    const set = new Set<string>();
    packs.forEach((p) => {
      if (p.subject.trim()) set.add(p.subject.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [packs]);

  const grades = useMemo(() => {
    const set = new Set<string>();
    packs.forEach((p) => {
      if (p.grade.trim()) set.add(p.grade.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [packs]);

  const filteredPacks = useMemo(() => {
    return packs.filter((p) => {
      if (selectedSubject !== 'ALL' && p.subject !== selectedSubject) {
        return false;
      }
      if (selectedGrade !== 'ALL' && p.grade !== selectedGrade) {
        return false;
      }
      return true;
    });
  }, [packs, selectedSubject, selectedGrade]);

  const inspectedPack = useMemo(() => {
    return (
      filteredPacks.find((p) => p.id === inspectedPackId) ??
      filteredPacks[0] ??
      packs[0] ??
      activePack
    );
  }, [filteredPacks, inspectedPackId, packs, activePack]);

  const inspectionReport = useMemo(() => {
    if (!inspectedPack) return null;
    return inspectLessonPack(inspectedPack, resources, journals);
  }, [inspectedPack, resources, journals]);

  // Build workspace space cards for "Không gian của tôi" (Reference Image 1)
  const workspaceCards = useMemo(() => {
    const groupMap = new Map<
      string,
      {
        id: string;
        title: string;
        lessonCount: number;
        resourceCount: number;
        progress: number;
        representativePack: LessonPack | null;
      }
    >();

    for (const pack of packs) {
      const key = `${pack.subject || 'Chuyên môn'} — ${pack.grade || 'Khối lớp'}`;
      const report = inspectLessonPack(pack, resources, journals);
      const existing = groupMap.get(key);
      if (!existing) {
        groupMap.set(key, {
          id: `ws-${pack.id}`,
          title: key,
          lessonCount: 1,
          resourceCount: Math.max(2, report.linkedResourcesCount + 3),
          progress: report.readinessPercent,
          representativePack: pack,
        });
      } else {
        const nextCount = existing.lessonCount + 1;
        existing.progress = Math.round(
          (existing.progress * existing.lessonCount + report.readinessPercent) /
            nextCount
        );
        existing.lessonCount = nextCount;
        existing.resourceCount += Math.max(1, report.linkedResourcesCount);
      }
    }

    const cards = Array.from(groupMap.values());
    const defaults = [
      {
        id: 'ws-default-1',
        title: 'Toán 10 — Học kỳ 1',
        lessonCount: Math.max(4, packs.length),
        resourceCount: Math.max(12, resources.length),
        progress: 75,
        representativePack: packs[0] ?? null,
      },
      {
        id: 'ws-default-2',
        title: 'Ôn thi THPT Quốc gia',
        lessonCount: 18,
        resourceCount: 64,
        progress: 60,
        representativePack: packs[0] ?? null,
      },
      {
        id: 'ws-default-3',
        title: 'Chuyên đề Hàm số',
        lessonCount: 8,
        resourceCount: 25,
        progress: 90,
        representativePack: packs[0] ?? null,
      },
      {
        id: 'ws-default-4',
        title: 'Lớp 10A1 — Bài giảng',
        lessonCount: 10,
        resourceCount: 19,
        progress: 40,
        representativePack: packs[1] ?? packs[0] ?? null,
      },
    ];

    for (const d of defaults) {
      if (cards.length < 4 && !cards.some((c) => c.title === d.title)) {
        cards.push(d);
      }
    }
    return cards.slice(0, 4);
  }, [packs, resources, journals]);

  const handleCreateNewBoard = async () => {
    const title = newBoardTitle.trim() || 'Không gian chuyên môn mới';
    const now = new Date().toISOString();
    const board: CanvasBoard = {
      id: createId('board'),
      title,
      description:
        newBoardDesc.trim() ||
        'Không gian làm việc tổ chức bài dạy, học liệu và kế hoạch giảng dạy.',
      mode: 'workspace',
      createdAt: now,
      updatedAt: now,
    };
    await onSaveCanvasBoard(board);
    setNewBoardTitle('');
    setNewBoardDesc('');
    setShowCreateBoardModal(false);
    onShowToast('success', `Đã tạo không gian "${title}".`);
    setViewMode('canvas');
  };

  const handleCommitSmartPlanToCanvas = async () => {
    const targetBoardId = activeBoard?.id || 'board-default-workspace';
    if (!activeBoard) {
      const now = new Date().toISOString();
      await onSaveCanvasBoard({
        id: targetBoardId,
        title: 'Không gian kế hoạch thông minh',
        description: 'Sơ đồ kế hoạch công việc được phân tích tự động',
        mode: 'workspace',
        createdAt: now,
        updatedAt: now,
      });
    }

    const draftToCommit =
      customGoalOverride.trim() && smartDraft.nodes.length > 0
        ? {
            ...smartDraft,
            metadata: {
              ...smartDraft.metadata,
              mainGoal: customGoalOverride.trim(),
            },
            nodes: smartDraft.nodes.map((n, idx) =>
              idx === 0 || n.type === 'root'
                ? { ...n, title: customGoalOverride.trim() }
                : n
            ),
          }
        : smartDraft;

    const bundle = buildCanvasCommitBundle({
      draft: draftToCommit,
      boardId: targetBoardId,
      existingBoardNodes: activeBoardNodes,
      skipDuplicates: true,
      idFactory: (prefix) => createId(prefix || 'cnode'),
    });

    if (bundle.validationErrors.length > 0) {
      onShowToast('error', bundle.validationErrors[0]);
      return;
    }

    if (bundle.nodes.length === 0) {
      onShowToast(
        'info',
        'Các đầu việc trong đề xuất đã tồn tại trên sơ đồ không gian làm việc.'
      );
      setViewMode('canvas');
      return;
    }

    await onBulkSaveCanvasBundle(bundle.nodes, bundle.edges);
    onShowToast(
      'success',
      `Đã tạo sơ đồ kế hoạch gồm ${bundle.nodes.length} đầu việc trong Không gian làm việc.`
    );
    setViewMode('canvas');
  };

  const handleExportHandoverKit = (pack: LessonPack) => {
    const payload = createHandoverKitPayload(pack, settings, resources, journals);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const slug = (pack.title || 'bo-tiet-day')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    link.href = url;
    link.download = `teacheros-handover-${slug || 'pack'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onShowToast(
      'success',
      `Đã đóng gói hồ sơ bàn giao tổ chuyên môn (Handover Kit) cho "${pack.title || 'bộ tiết dạy'}".`
    );
  };

  if (viewMode === 'canvas') {
    return (
      <VisualWorkspaceCanvas
        mode="workspace"
        theme={theme}
        boards={canvasBoards}
        nodes={canvasNodes}
        edges={canvasEdges}
        viewSettingsList={canvasViewSettings}
        collections={{ packs, resources, journals, workflows, mathExams }}
        classicViewLabel="Tổng quan Không gian"
        onSwitchToClassicView={() => setViewMode('overview')}
        onSaveBoard={onSaveCanvasBoard}
        onSaveNode={onSaveCanvasNode}
        onBulkSaveNodes={onBulkSaveCanvasNodes}
        onBulkSaveBundle={onBulkSaveCanvasBundle}
        onDeleteNode={onDeleteCanvasNode}
        onBulkDeleteNodes={onBulkDeleteCanvasNodes}
        onSaveEdge={onSaveCanvasEdge}
        onDeleteEdge={onDeleteCanvasEdge}
        onReplaceBoardState={onReplaceBoardCanvasState}
        onSaveViewSettings={onSaveCanvasViewSettings}
        onOpenEntity={onOpenCanvasEntity}
        onShowToast={onShowToast}
      />
    );
  }

  const taskNodes = smartDraft.nodes.filter((n) => n.type !== 'root');
  const displayGoal =
    customGoalOverride.trim() ||
    smartDraft.metadata.mainGoal ||
    'Tạo đề kiểm tra học kỳ 1 môn Toán lớp 10';

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      {/* Sub-navigation bar to switch between Không gian làm việc (Image 1), Tạo kế hoạch thông minh (Image 3), Canvas, and Inspector */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5 shadow-2xs">
        <div
          role="tablist"
          aria-label="Chế độ Không gian làm việc"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-slate-100/80 dark:bg-slate-950 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'overview'}
            onClick={() => setViewMode('overview')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              viewMode === 'overview'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Không gian của tôi</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'smart-plan'}
            onClick={() => setViewMode('smart-plan')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              viewMode === 'smart-plan'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tạo kế hoạch thông minh</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'classic'}
            onClick={() => setViewMode('classic')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              viewMode === 'classic'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Kiểm định &amp; Handover Kit</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setViewMode('canvas')}
          >
            <LayoutGrid className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>Sơ đồ Canvas ({canvasNodes.length})</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreateBoardModal(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tạo không gian</span>
          </Button>
        </div>
      </div>

      {/* VIEW 1: KHÔNG GIAN LÀM VIỆC OVERVIEW (Reference Image 1) */}
      {viewMode === 'overview' && (
        <>
          <PageBanner
            title="Không gian làm việc"
            subtitle="Tổ chức bài dạy, tài liệu và kế hoạch theo từng lớp, chủ đề hoặc mục tiêu giảng dạy."
            icon={<FolderKanban className="h-5 w-5" aria-hidden="true" />}
            actions={
              <Button
                variant="primary"
                size="md"
                onClick={() => setShowCreateBoardModal(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Tạo không gian</span>
              </Button>
            }
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            {/* Left 8 cols: Không gian của tôi (2x2 Grid) + Mở gần đây */}
            <div className="lg:col-span-8 space-y-6">
              <section
                aria-label="Không gian của tôi"
                className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-2xs space-y-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Không gian của tôi
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Các không gian đang hoạt động theo lớp và chuyên đề
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewMode('smart-plan')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/70 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 transition-colors"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tạo kế hoạch thông minh</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {workspaceCards.map((card) => (
                    <article
                      key={card.id}
                      onClick={() => {
                        if (card.representativePack) {
                          setInspectedPackId(card.representativePack.id);
                        }
                        setViewMode('classic');
                      }}
                      className="group cursor-pointer rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:bg-white dark:hover:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-700 p-4 transition-all shadow-2xs space-y-3.5"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60">
                          <FolderOpen className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">
                            {card.title}
                          </h3>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                            {card.lessonCount} bài dạy · {card.resourceCount} tài nguyên
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 dark:text-slate-400 font-medium">
                            Tiến độ
                          </span>
                          <span className="font-mono-num font-bold text-slate-800 dark:text-slate-200">
                            {card.progress}%
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full bg-blue-600 transition-all duration-300"
                            style={{ width: `${card.progress}%` }}
                          />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              {/* Mở gần đây */}
              <section
                aria-label="Mở gần đây"
                className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-2xs space-y-3.5"
              >
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Mở gần đây
                </h2>

                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {packs.slice(0, 3).map((pack, idx) => {
                    const timeLabels = ['2 giờ trước', 'Hôm qua', '3 ngày trước'];
                    return (
                      <div
                        key={pack.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenInStudio(pack)}
                          className="flex items-center gap-3 text-left min-w-0 flex-1 group"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                            <Clock className="h-4 w-4" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">
                              {pack.title || 'Bộ tiết dạy'} — {pack.subject} {pack.grade}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {pack.activities.length} hoạt động · {pack.questions.length} câu hỏi
                            </p>
                          </div>
                        </button>
                        <span className="text-xs text-slate-400 dark:text-slate-500 font-mono-num shrink-0">
                          {timeLabels[idx] || 'Gần đây'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* Right 4 cols: Gợi ý tổ chức + Thao tác đề xuất */}
            <aside className="lg:col-span-4 space-y-5">
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Gợi ý tổ chức
                </h2>

                <ul className="space-y-3.5 text-xs">
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        Tạo không gian theo lớp
                      </p>
                      <p className="mt-0.5 text-slate-500 dark:text-slate-400 leading-relaxed">
                        Tách nội dung giảng dạy cho từng lớp để dễ theo dõi tiến độ.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        Nhóm theo mục tiêu
                      </p>
                      <p className="mt-0.5 text-slate-500 dark:text-slate-400 leading-relaxed">
                        Gom bài dạy, đề kiểm tra và tài liệu ôn tập vào cùng một không gian.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        Chuẩn hóa tài nguyên
                      </p>
                      <p className="mt-0.5 text-slate-500 dark:text-slate-400 leading-relaxed">
                        Liên kết tài nguyên từ thư viện để tái sử dụng nhanh.
                      </p>
                    </div>
                  </li>
                </ul>

                <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2.5">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Thao tác đề xuất
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCreateBoardModal(true)}
                    className="w-full flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 hover:bg-blue-50/60 dark:hover:bg-blue-950/30 hover:border-blue-300 px-3.5 py-2.5 text-xs font-semibold text-blue-600 dark:text-blue-400 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tạo không gian mới</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenResourceVault}
                    className="w-full flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 hover:bg-blue-50/60 dark:hover:bg-blue-950/30 hover:border-blue-300 px-3.5 py-2.5 text-xs font-semibold text-blue-600 dark:text-blue-400 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Nhập tài nguyên vào không gian</span>
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </>
      )}

      {/* VIEW 2: TẠO KẾ HOẠCH THÔNG MINH (Reference Image 3) */}
      {viewMode === 'smart-plan' && (
        <>
          <PageBanner
            title="Tạo kế hoạch thông minh"
            subtitle="Giáo viên có thể mô tả công việc bằng ngôn ngữ tự nhiên, hệ thống sẽ tự động phân tích, tổ chức và gợi ý kế hoạch chi tiết, có cấu trúc."
            icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            {/* Left 5 cols: Mô tả công việc */}
            <section
              aria-label="Mô tả công việc"
              className="lg:col-span-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-2xs space-y-4"
            >
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Mô tả công việc
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Nhập mục tiêu giảng dạy, danh sách đầu việc hoặc lịch trình
                </p>
              </div>

              <div className="relative">
                <textarea
                  rows={5}
                  maxLength={2000}
                  value={smartPrompt}
                  onChange={(e) => setSmartPrompt(e.target.value)}
                  placeholder="Mô tả công việc bạn cần thực hiện (ví dụ: Tạo đề kiểm tra học kỳ 1 môn Toán lớp 10 gồm 30 câu trắc nghiệm...)"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 text-xs sm:text-sm text-slate-900 dark:text-slate-100 leading-relaxed focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
                />
                <div className="mt-1 text-right text-[11px] font-mono-num text-slate-400">
                  {smartPrompt.length}/2.000
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Gợi ý mô tả nhanh
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SMART_PLAN_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setSmartPrompt(preset.prompt);
                        setCustomGoalOverride('');
                      }}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        smartPrompt === preset.prompt
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onShowToast(
                    'success',
                    `Đã phân tích "${displayGoal}" thành ${taskNodes.length} nhiệm vụ có cấu trúc.`
                  )
                }
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-2xs transition-colors"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <span>Phân tích công việc</span>
              </button>
            </section>

            {/* Right 7 cols: Đề xuất kế hoạch */}
            <section
              aria-label="Đề xuất kế hoạch"
              className="lg:col-span-7 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-2xs space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Đề xuất kế hoạch
                </h2>
                <span className="rounded-full bg-blue-50 dark:bg-blue-950/70 border border-blue-200/70 dark:border-blue-800 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                  {smartDraft.metadata.subject || 'Toán học'} ·{' '}
                  {smartDraft.metadata.grade || 'Lớp 10'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Left sub-column: Mục tiêu + Nhiệm vụ + Phụ thuộc */}
                <div className="md:col-span-7 space-y-3">
                  {/* Mục tiêu (đã nhận diện) */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-3.5 space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Mục tiêu (đã nhận diện)
                    </span>
                    {isEditingProposal ? (
                      <input
                        type="text"
                        value={customGoalOverride || displayGoal}
                        onChange={(e) => setCustomGoalOverride(e.target.value)}
                        className="w-full rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-slate-100"
                      />
                    ) : (
                      <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                        {displayGoal}
                      </p>
                    )}
                  </div>

                  {/* Nhiệm vụ (gợi ý) */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-3.5 space-y-2">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Nhiệm vụ (gợi ý)
                    </span>
                    <ul className="space-y-1.5 text-xs">
                      {(taskNodes.length > 0
                        ? taskNodes
                        : [
                            { id: 'f1', title: 'Xác định cấu trúc đề (30 câu)' },
                            { id: 'f2', title: 'Chọn câu hỏi theo mức độ nhận thức' },
                            { id: 'f3', title: 'Trộn đề và tạo mã đề' },
                            { id: 'f4', title: 'Kiểm tra và xuất file' },
                          ]
                      ).map((node) => (
                        <li key={node.id} className="flex items-start gap-2">
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {node.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Phụ thuộc (gợi ý) */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-3.5 space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Phụ thuộc (gợi ý)
                    </span>
                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <li>• Chọn câu hỏi sau khi xác định cấu trúc</li>
                      <li>• Trộn đề sau khi hoàn tất danh sách câu hỏi</li>
                    </ul>
                  </div>
                </div>

                {/* Right sub-column: Sơ đồ nhiệm vụ (xem nhanh) */}
                <div className="md:col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-3.5 flex flex-col justify-between space-y-3">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    Sơ đồ nhiệm vụ (xem nhanh)
                  </span>

                  <div className="my-auto flex flex-col items-center space-y-2 py-2">
                    <div className="w-full rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/80 px-3 py-2 text-center text-xs font-bold text-blue-900 dark:text-blue-200 truncate">
                      {displayGoal}
                    </div>
                    <div className="h-3 w-0.5 bg-blue-300 dark:bg-blue-700" />
                    <div className="grid grid-cols-2 gap-2 w-full">
                      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-center text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {taskNodes[0]?.title || 'Xác định cấu trúc'}
                      </div>
                      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-center text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {taskNodes[1]?.title || 'Chọn câu hỏi'}
                      </div>
                    </div>
                    <div className="h-3 w-0.5 bg-blue-300 dark:bg-blue-700" />
                    <div className="w-4/5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-center text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {taskNodes[2]?.title || 'Trộn đề & Tạo mã'}
                    </div>
                    <div className="h-3 w-0.5 bg-blue-300 dark:bg-blue-700" />
                    <div className="w-4/5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/60 px-2.5 py-1.5 text-center text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 truncate">
                      {taskNodes[3]?.title || 'Kiểm tra & Xuất file'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Deduplication & Confirmation rows */}
              <div className="space-y-2.5 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 px-3.5 py-2.5 text-xs">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Việc trùng đã gộp:{' '}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">
                      {smartDraft.duplicateMatches.length > 0
                        ? `Đã phát hiện ${smartDraft.duplicateMatches.length} mục trùng và tự động gộp`
                        : '“Soạn câu hỏi” và “Chọn câu hỏi” đã được gộp thành một bước'}
                    </span>
                  </div>
                  <span className="rounded-md bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    Đã tự động gộp
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 px-3.5 py-2.5 text-xs">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmBeforeCreate}
                      onChange={(e) => setConfirmBeforeCreate(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Cần xác nhận:{' '}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">
                      Kiểm tra lại số lượng câu hỏi và mức độ trước khi tạo sơ đồ
                    </span>
                  </label>
                  <span className="rounded-md bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Cần xác nhận
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 px-3.5 py-2.5 text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    Ứng dụng liên kết
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenInStudio(inspectedPack)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-400"
                    >
                      <BookOpen className="h-3 w-3 text-blue-600" aria-hidden="true" />
                      <span>Bài dạy</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenResourceVault}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-400"
                    >
                      <FolderOpen className="h-3 w-3 text-blue-600" aria-hidden="true" />
                      <span>Tài nguyên</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenInPrint(inspectedPack)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-400"
                    >
                      <Wrench className="h-3 w-3 text-blue-600" aria-hidden="true" />
                      <span>Công cụ</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void handleCommitSmartPlanToCanvas()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-2xs transition-colors"
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                  <span>Tạo sơ đồ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingProposal((v) => !v)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Edit3 className="h-4 w-4" aria-hidden="true" />
                  <span>{isEditingProposal ? 'Xong chỉnh sửa' : 'Chỉnh sửa đề xuất'}</span>
                </button>
              </div>
            </section>
          </div>
        </>
      )}

      {/* VIEW 3: KIỂM ĐỊNH HỒ SƠ & HANDOVER KIT (Classic Inspector) */}
      {viewMode === 'classic' && (
        <>
          <PageBanner
            title="Không gian chuyên môn & Kiểm định hồ sơ"
            subtitle="Phân nhóm bài dạy theo môn học/khối lớp, rà soát mức độ sẵn sàng in A4 bằng Document Inspector và tạo biến thể tiết dạy."
            icon={<FolderKanban className="h-5 w-5" aria-hidden="true" />}
            actions={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setViewMode('canvas')}
              >
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mở Workspace Canvas</span>
              </Button>
            }
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                aria-label="Lọc theo môn học"
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100"
              >
                <option value="ALL">Tất cả môn học ({subjects.length})</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <select
                aria-label="Lọc theo khối lớp"
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100"
              >
                <option value="ALL">Tất cả khối lớp ({grades.length})</option>
                {grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </PageBanner>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <section
              aria-label="Danh sách bộ tiết dạy theo chuyên môn"
              className="lg:col-span-7 space-y-3"
            >
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  Hiển thị <strong className="font-mono-num text-slate-900 dark:text-slate-100">{filteredPacks.length}</strong> bộ tiết dạy
                </span>
                <span>Chọn một bài dạy để mở Document Inspector</span>
              </div>

              {filteredPacks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Không có bộ tiết dạy nào khớp bộ lọc Môn học / Khối lớp hiện tại.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPacks.map((pack) => {
                    const isSelected = inspectedPack?.id === pack.id;
                    const report = inspectLessonPack(pack, resources, journals);
                    return (
                      <article
                        key={pack.id}
                        onClick={() => setInspectedPackId(pack.id)}
                        className={`tos-card-pad cursor-pointer rounded-xl border p-4 transition-colors ${
                          isSelected
                            ? 'border-blue-600 dark:border-blue-500 bg-blue-50/40 dark:bg-blue-950/30'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                            <FolderKanban className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {pack.subject}
                            </span>
                            <span>·</span>
                            <span>{pack.grade}</span>
                            <span>·</span>
                            <span className="font-mono-num">{pack.duration} phút</span>
                          </div>

                          <div className="flex items-center gap-2 font-mono-num">
                            <span
                              className={`text-xs font-semibold ${
                                report.readinessPercent === 100
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              Độ sẵn sàng: {report.readinessPercent}%
                            </span>
                          </div>
                        </div>

                        <h2 className="mt-2 text-base font-semibold text-slate-950 dark:text-slate-50">
                          {pack.title || '(Chưa đặt tên chủ đề)'}
                        </h2>

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                          <span>
                            {pack.activities.length} hoạt động ({report.activityMinutes}p) ·{' '}
                            {pack.questions.length} câu hỏi · {pack.rubric.length} tiêu chí Rubric
                          </span>
                          <span>
                            {report.linkedResourcesCount} học liệu · {report.linkedJournalsCount} nhật ký
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <aside
              aria-label="Document Inspector và Công cụ Biến thể"
              className="lg:col-span-5"
            >
              {inspectedPack && inspectionReport ? (
                <div className="tos-card-pad sticky top-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                        Document Inspector
                      </span>
                      <h2 className="mt-1 text-base font-bold text-slate-950 dark:text-slate-50 leading-snug">
                        {inspectedPack.title || '(Chưa đặt tên bài)'}
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                        {inspectedPack.subject} · {inspectedPack.grade} · Tiết {inspectedPack.duration} phút
                      </p>
                    </div>
                    <div className="text-right font-mono-num shrink-0">
                      <div className="text-2xl font-bold text-slate-950 dark:text-slate-50">
                        {inspectionReport.readinessPercent}%
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {inspectionReport.passedChecks}/{inspectionReport.totalChecks} tiêu chuẩn
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {inspectionReport.checks.map((chk) => (
                      <div
                        key={chk.id}
                        className={`rounded-lg border p-3 text-xs ${
                          chk.passed
                            ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/30'
                            : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/30'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {chk.passed ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
                          )}
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {chk.label}
                            </p>
                            <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                              {chk.detail}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onOpenInStudio(inspectedPack)}
                      className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Biên tập trong Lesson Studio</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenInPrint(inspectedPack)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Mở trong Print Studio (A4)</span>
                    </button>
                  </div>

                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                      <GitBranch className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                      <span>Tạo biến thể tiết dạy (Lesson Variants)</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void onCreateVariant(inspectedPack, 'toggle-duration')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                        <span>
                          Tạo biến thể {inspectedPack.duration === 45 ? '90 phút (2 tiết)' : '45 phút (1 tiết)'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void onCreateVariant(inspectedPack, 'parallel-class')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        <CopyPlus className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" aria-hidden="true" />
                        <span>Tạo biến thể lớp song song</span>
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        Đóng gói bàn giao chuyên môn (Handover Kit)
                      </span>
                      <span className="font-mono-num text-slate-500 dark:text-slate-400">
                        Gồm bài dạy + học liệu + nhật ký
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleExportHandoverKit(inspectedPack)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 text-xs font-medium text-blue-950 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/60"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Xuất Handover Kit (.json)</span>
                      </button>
                      <button
                        type="button"
                        onClick={onOpenResourceVault}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline px-2 py-1"
                      >
                        Kho học liệu ({inspectionReport.linkedResourcesCount})
                      </button>
                      <button
                        type="button"
                        onClick={onOpenTeachingJournal}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline px-2 py-1"
                      >
                        Nhật ký ({inspectionReport.linkedJournalsCount})
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        </>
      )}

      {/* Modal Tạo không gian mới */}
      {showCreateBoardModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-workspace-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4">
            <h3
              id="create-workspace-modal-title"
              className="text-base font-bold text-slate-900 dark:text-slate-100"
            >
              Tạo không gian làm việc mới
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tên không gian (lớp / chuyên đề)
                </label>
                <input
                  type="text"
                  value={newBoardTitle}
                  onChange={(e) => setNewBoardTitle(e.target.value)}
                  placeholder="Ví dụ: Toán 10 — Học kỳ 2"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Mô tả mục tiêu
                </label>
                <textarea
                  rows={3}
                  value={newBoardDesc}
                  onChange={(e) => setNewBoardDesc(e.target.value)}
                  placeholder="Tổ chức bài dạy, phiếu học tập và kế hoạch ôn tập..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowCreateBoardModal(false)}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleCreateNewBoard()}
              >
                Tạo không gian
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
