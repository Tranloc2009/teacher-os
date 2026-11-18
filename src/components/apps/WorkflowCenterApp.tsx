import { FormEvent, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  CheckSquare,
  LayoutGrid,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import {
  JournalEntry,
  LessonPack,
  ResourceItem,
  WorkflowPhase,
  WorkflowRun,
  WorkflowStepItem,
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
import { AppId } from '../../core/appRegistry';
import { createId } from '../../db/database';
import { VisualWorkspaceCanvas } from '../canvas/VisualWorkspaceCanvas';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { Button, PageBanner } from '../ui/DesignSystem';

interface WorkflowCenterAppProps {
  workflows: WorkflowRun[];
  packs: LessonPack[];
  resources: ResourceItem[];
  journals: JournalEntry[];
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
  onShowToast: (tone: 'success' | 'info' | 'error', text: string) => void;
  onSaveWorkflow: (item: WorkflowRun) => Promise<void>;
  onDeleteWorkflow: (id: string) => Promise<void>;
  onNavigateApp: (appId: AppId, linkedPackId?: string) => void;
}

const PHASE_META: Array<{
  id: WorkflowPhase;
  label: string;
  subtitle: string;
}> = [
  {
    id: 'pre-class',
    label: 'Trước tiết dạy (Chuẩn bị & In A4)',
    subtitle: 'Xác định mục tiêu, phân bổ câu hỏi 3 mức và kiểm tra bản in A4',
  },
  {
    id: 'in-class',
    label: 'Trong tiết dạy (Tổ chức & Quan sát)',
    subtitle: 'Triển khai hoạt động 5–15p, phát phiếu A/B/C và đánh giá quá trình',
  },
  {
    id: 'post-class',
    label: 'Sau tiết dạy (Rút kinh nghiệm)',
    subtitle: 'Ghi nhận nhịp độ thực tế và cải tiến câu hỏi cho lớp tiếp theo',
  },
];

export function WorkflowCenterApp({
  workflows,
  packs,
  resources,
  journals,
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
  onShowToast,
  onSaveWorkflow,
  onDeleteWorkflow,
  onNavigateApp,
}: WorkflowCenterAppProps) {
  const [viewMode, setViewMode] = useState<'canvas' | 'classic'>('canvas');
  const tutorial = useOptionalTutorial();

  useEffect(() => {
    if (
      tutorial?.activeTutorial?.tutorialId === 'tutorial.workflow-center' &&
      viewMode !== 'canvas'
    ) {
      setViewMode('canvas');
    }
  }, [tutorial?.activeTutorial?.tutorialId, viewMode]);

  const [selectedId, setSelectedId] = useState<string>(workflows[0]?.id ?? '');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newLinkedPackId, setNewLinkedPackId] = useState<string>(
    packs[0]?.id ?? ''
  );

  // Add step inline inputs per phase
  const [stepInputs, setStepInputs] = useState<Record<WorkflowPhase, string>>({
    'pre-class': '',
    'in-class': '',
    'post-class': '',
  });

  const activeWorkflow =
    workflows.find((w) => w.id === selectedId) ?? workflows[0] ?? null;

  const handleCreateWorkflow = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const created: WorkflowRun = {
      id: createId('wf'),
      title: newTitle.trim(),
      linkedPackId: newLinkedPackId,
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: createId('wfs'),
          phase: 'pre-class',
          label: 'Hoàn thiện mục tiêu và kiểm tra phân bổ câu hỏi Phiếu A/B/C',
          done: false,
          targetApp: 'lesson-studio',
        },
        {
          id: createId('wfs'),
          phase: 'pre-class',
          label: 'Xem trước và in bộ phiếu A4 kèm Rubric đánh giá quá trình',
          done: false,
          targetApp: 'print-studio',
        },
        {
          id: createId('wfs'),
          phase: 'in-class',
          label: 'Tổ chức hoạt động nhóm và quan sát mức độ hoàn thành trên lớp',
          done: false,
        },
        {
          id: createId('wfs'),
          phase: 'post-class',
          label: 'Ghi nhật ký giảng dạy và cập nhật lưu ý cho lớp dạy tiếp theo',
          done: false,
          targetApp: 'teaching-journal',
        },
      ],
    };
    await onSaveWorkflow(created);
    setSelectedId(created.id);
    setNewTitle('');
    setShowNewForm(false);
  };

  const handleToggleStep = async (stepId: string) => {
    if (!activeWorkflow) return;
    const nextSteps = activeWorkflow.steps.map((s) =>
      s.id === stepId ? { ...s, done: !s.done } : s
    );
    await onSaveWorkflow({ ...activeWorkflow, steps: nextSteps });
  };

  const handleAddStep = async (phase: WorkflowPhase) => {
    if (!activeWorkflow) return;
    const text = stepInputs[phase].trim();
    if (!text) return;
    const newStep: WorkflowStepItem = {
      id: createId('wfs'),
      phase,
      label: text,
      done: false,
    };
    await onSaveWorkflow({
      ...activeWorkflow,
      steps: [...activeWorkflow.steps, newStep],
    });
    setStepInputs((prev) => ({ ...prev, [phase]: '' }));
  };

  const handleRemoveStep = async (stepId: string) => {
    if (!activeWorkflow) return;
    await onSaveWorkflow({
      ...activeWorkflow,
      steps: activeWorkflow.steps.filter((s) => s.id !== stepId),
    });
  };

  const linkedPack = packs.find((p) => p.id === activeWorkflow?.linkedPackId);
  const doneCount = activeWorkflow
    ? activeWorkflow.steps.filter((s) => s.done).length
    : 0;
  const totalCount = activeWorkflow ? activeWorkflow.steps.length : 0;
  const percent =
    totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  if (viewMode === 'canvas') {
    return (
      <VisualWorkspaceCanvas
        mode="workflow"
        theme={theme}
        boards={canvasBoards}
        nodes={canvasNodes}
        edges={canvasEdges}
        viewSettingsList={canvasViewSettings}
        collections={{ packs, resources, journals, workflows, mathExams }}
        classicViewLabel="Bảng 3 giai đoạn"
        onSwitchToClassicView={() => setViewMode('classic')}
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
        onOpenEntity={(ref) => {
          if (ref.kind === 'WorkflowRun') {
            const exists = workflows.some((w) => w.id === ref.entityId);
            if (exists) {
              setSelectedId(ref.entityId);
              setViewMode('classic');
              return;
            }
          }
          onOpenCanvasEntity(ref);
        }}
        onNavigateApp={(appId) =>
          onNavigateApp(appId, activeWorkflow?.linkedPackId || undefined)
        }
        onShowToast={onShowToast}
      />
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <PageBanner
        title="Điều phối quy trình giảng dạy"
        subtitle="Theo dõi tiến độ chuẩn bị bài dạy Trước – Trong – Sau tiết học, phiếu in A4 và nhật ký sau giờ lên lớp."
        icon={<LayoutGrid className="h-5 w-5" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setViewMode('canvas')}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Mở Workflow Canvas</span>
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowNewForm((prev) => !prev)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>{showNewForm ? 'Đóng biểu mẫu' : 'Tạo quy trình mới'}</span>
            </Button>
          </div>
        }
      />

      {showNewForm && (
        <form
          onSubmit={(e) => void handleCreateWorkflow(e)}
          className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Khởi tạo quy trình công việc mới
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="wf-title" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Tên quy trình *
              </label>
              <input
                id="wf-title"
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="VD: Chuẩn bị tiết chuyên đề Toán 8 tuần 12..."
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="wf-pack" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Gắn với bộ tiết dạy
              </label>
              <select
                id="wf-pack"
                value={newLinkedPackId}
                onChange={(e) => setNewLinkedPackId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="">-- Quy trình chung (không gắn riêng bài) --</option>
                {packs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || '(Chưa đặt tên)'} ({p.subject} - {p.grade})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewForm(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-medium"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Tạo quy trình
            </button>
          </div>
        </form>
      )}

      {/* Workflow selector tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {workflows.map((wf) => {
            const active = wf.id === activeWorkflow?.id;
            return (
              <button
                key={wf.id}
                type="button"
                onClick={() => setSelectedId(wf.id)}
                className={`rounded-[10px] border px-3.5 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-600 dark:bg-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {wf.title}
              </button>
            );
          })}
        </div>

        {activeWorkflow && workflows.length > 1 && (
          <button
            type="button"
            onClick={() => void onDeleteWorkflow(activeWorkflow.id)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Xóa quy trình này</span>
          </button>
        )}
      </div>

      {activeWorkflow ? (
        <div className="space-y-6">
          {/* Summary Header */}
          <div className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-950 dark:text-slate-50">
                {activeWorkflow.title}
              </h2>
              {linkedPack ? (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Liên kết bài dạy:{' '}
                  <button
                    type="button"
                    onClick={() => onNavigateApp('lesson-studio', linkedPack.id)}
                    className="font-semibold text-blue-900 dark:text-blue-400 underline underline-offset-2"
                  >
                    {linkedPack.title}
                  </button>
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Quy trình chung</p>
              )}
            </div>

            <div className="text-right font-mono-num">
              <div className="text-xl font-bold text-slate-950 dark:text-slate-50">
                Hoàn thành {doneCount}/{totalCount} ({percent}%)
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Bấm vào từng mục để đánh dấu đã xong
              </div>
            </div>
          </div>

          {/* 3 Columns: Pre-class, In-class, Post-class */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {PHASE_META.map((phase) => {
              const phaseSteps = activeWorkflow.steps.filter(
                (s) => s.phase === phase.id
              );
              return (
                <section
                  key={phase.id}
                  aria-label={phase.label}
                  className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                      <h3 className="text-sm font-bold text-slate-950 dark:text-slate-50">
                        {phase.label}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {phase.subtitle}
                      </p>
                    </div>

                    <ul className="space-y-2.5">
                      {phaseSteps.map((step) => (
                        <li
                          key={step.id}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-3 text-xs space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => void handleToggleStep(step.id)}
                              className="flex items-start gap-2 text-left flex-1"
                            >
                              {step.done ? (
                                <CheckSquare className="h-4 w-4 text-emerald-700 dark:text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
                              ) : (
                                <Square className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
                              )}
                              <span
                                className={
                                  step.done
                                    ? 'line-through text-slate-400 dark:text-slate-500'
                                    : 'text-slate-800 dark:text-slate-100 font-medium'
                                }
                              >
                                {step.label}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleRemoveStep(step.id)}
                              aria-label="Xóa bước quy trình"
                              className="text-slate-400 hover:text-red-600 p-0.5 shrink-0"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>

                          {step.targetApp && (
                            <div className="pl-6">
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigateApp(
                                    step.targetApp as AppId,
                                    activeWorkflow.linkedPackId || undefined
                                  )
                                }
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-900 dark:text-blue-400 hover:underline"
                              >
                                <span>Mở công cụ thực hiện</span>
                                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Add custom step */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex gap-1.5">
                    <input
                      type="text"
                      value={stepInputs[phase.id]}
                      onChange={(e) =>
                        setStepInputs((prev) => ({
                          ...prev,
                          [phase.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleAddStep(phase.id);
                        }
                      }}
                      placeholder="Thêm đầu việc mới..."
                      aria-label={`Thêm đầu việc cho ${phase.label}`}
                      className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddStep(phase.id)}
                      className="rounded-lg bg-slate-900 dark:bg-blue-700 px-2.5 py-1.5 text-xs font-medium text-white shrink-0"
                    >
                      Thêm
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </main>
  );
}
