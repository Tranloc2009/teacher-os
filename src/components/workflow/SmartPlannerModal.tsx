import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Calendar,
  Info,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { AppId } from '../../core/appRegistry';
import {
  type SmartWorkflowDraftEdge,
  type SmartWorkflowDraftNode,
  type SmartWorkflowParseResult,
  appendTemplateSuggestionToDraft,
  applyDraftAutoLayout,
  classifyWorkCategory,
  getReadyTeacherOSApps,
  inferSafeTeacherOSApp,
  parseVietnameseWorkflow,
} from '../../core/smartWorkflowParser';
import type { CanvasPriority } from '../../types/canvas';

interface SmartPlannerModalProps {
  open: boolean;
  onClose: () => void;
  onConfirmCreateWorkflow: (
    draft: SmartWorkflowParseResult,
    titleOverride: string
  ) => void;
}

const PLANNER_EXAMPLES = [
  {
    id: 'ex-exam',
    label: 'Đề kiểm tra Toán 12 (4 mã đề)',
    text: 'Chuẩn bị kiểm tra Toán 12 thứ Sáu gồm soạn đề, trộn 4 mã đề, kiểm tra đáp án và in đề.',
  },
  {
    id: 'ex-lesson',
    label: 'Chuẩn bị bài dạy 45 phút',
    text: 'Chuẩn bị bài dạy Toán 8:\n- Tìm học liệu và ví dụ minh họa\n- Soạn phiếu học tập A/B/C\n- Kiểm tra bản in A4\n- Ghi nhật ký sau giờ dạy',
  },
  {
    id: 'ex-rubric',
    label: 'Phiếu học tập → Rubric',
    text: 'Ngày mai tôi cần soạn phiếu học tập, sau đó chuẩn bị rubric đánh giá và in tài liệu.',
  },
  {
    id: 'ex-vague',
    label: 'Mô tả ngắn (kiểm tra cơ chế trung thực)',
    text: 'Tôi muốn tổ chức sinh hoạt chuyên môn.',
  },
];

export function SmartPlannerModal({
  open,
  onClose,
  onConfirmCreateWorkflow,
}: SmartPlannerModalProps) {
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<SmartWorkflowParseResult | null>(null);
  const [titleOverride, setTitleOverride] = useState('');
  const readyApps = useMemo(() => getReadyTeacherOSApps(), []);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const stepNodes = useMemo(
    () => (draft ? draft.nodes.filter((n) => n.type !== 'root') : []),
    [draft]
  );

  if (!open) return null;

  const runAnalyze = (text: string) => {
    const parsed = parseVietnameseWorkflow(text, {
      layoutMode: 'tree-lr',
    });
    setDraft(parsed);
    setTitleOverride(parsed.metadata.mainGoal || 'Quy trình mới');
  };

  const updateNodes = (
    nextNodes: SmartWorkflowDraftNode[],
    nextEdges: SmartWorkflowDraftEdge[] = draft?.edges ?? []
  ) => {
    if (!draft) return;
    const laidOut = applyDraftAutoLayout(nextNodes, nextEdges, 'tree-lr');
    setDraft({
      ...draft,
      nodes: laidOut,
      edges: nextEdges,
    });
  };

  const handleEditStep = (
    nodeId: string,
    patch: Partial<SmartWorkflowDraftNode>
  ) => {
    if (!draft) return;
    const nextNodes = draft.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const updated = { ...node, ...patch };
      if (patch.title !== undefined) {
        updated.category = classifyWorkCategory(patch.title);
      }
      if (patch.suggestedAppId !== undefined) {
        const app = readyApps.find((a) => a.id === patch.suggestedAppId);
        updated.suggestedAppName = app?.name;
      }
      return updated;
    });
    updateNodes(nextNodes);
  };

  const handleDeleteStep = (nodeId: string) => {
    if (!draft) return;
    const remainingNodes = draft.nodes.filter((n) => n.id !== nodeId);
    const remainingEdges = draft.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    );
    updateNodes(remainingNodes, remainingEdges);
  };

  const handleMoveStep = (nodeId: string, dir: 'up' | 'down') => {
    if (!draft) return;
    const roots = draft.nodes.filter((n) => n.type === 'root');
    const steps = draft.nodes.filter((n) => n.type !== 'root');
    const idx = steps.findIndex((n) => n.id === nodeId);
    if (idx < 0) return;
    const targetIdx =
      dir === 'up' ? Math.max(0, idx - 1) : Math.min(steps.length - 1, idx + 1);
    if (idx === targetIdx) return;
    const nextSteps = [...steps];
    const [moved] = nextSteps.splice(idx, 1);
    nextSteps.splice(targetIdx, 0, moved);
    const reindexed = [
      ...roots,
      ...nextSteps.map((s, i) => ({ ...s, orderIndex: i + 1 })),
    ];
    updateNodes(reindexed);
  };

  const handleAddManualStep = () => {
    if (!draft) return;
    const root = draft.nodes.find((n) => n.type === 'root') ?? null;
    const newId = `draft-step-${Date.now().toString(36)}`;
    const title = `Bước bổ sung ${stepNodes.length + 1}`;
    const appInfo = inferSafeTeacherOSApp(title, {
      subject: draft.metadata.subject,
      fullInput: draft.rawInput,
    });
    const created: SmartWorkflowDraftNode = {
      id: newId,
      type: 'task',
      title,
      description: '',
      parentId: root?.id ?? null,
      category: 'prepare',
      priority: 'medium',
      dueDate: draft.metadata.dueDate,
      dueDateLabel: draft.metadata.dueDateLabel,
      suggestedAppId: appInfo.appId,
      suggestedAppName: appInfo.appName,
      color: 'blue',
      source: 'manual',
      position: { x: 0, y: 0 },
      orderIndex: draft.nodes.length,
    };
    const nextEdges: SmartWorkflowDraftEdge[] = root
      ? [
          ...draft.edges,
          {
            id: `dedge-${Date.now().toString(36)}`,
            source: root.id,
            target: newId,
            edgeType: 'parent',
            sourceKind: 'manual',
          },
        ]
      : draft.edges;
    updateNodes([...draft.nodes, created], nextEdges);
  };

  const handleApplySuggestion = (templateId: string) => {
    const base =
      draft && !draft.isEmpty
        ? draft
        : parseVietnameseWorkflow(prompt.trim() || 'Quy trình công việc mới', {
            layoutMode: 'tree-lr',
          });
    const next = appendTemplateSuggestionToDraft(base, templateId, 'tree-lr');
    setDraft(next);
    if (!titleOverride.trim()) {
      setTitleOverride(next.metadata.mainGoal);
    }
  };

  const canConfirm = Boolean(draft && !draft.isEmpty && draft.nodes.length > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-planner-modal-title"
      data-testid="wf-smart-planner-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-3 sm:p-5 backdrop-blur-[2px]"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[22px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 px-5 py-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#635BFF]/10 text-[#635BFF] dark:bg-[#635BFF]/20 dark:text-[#A5B4FC]">
              <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2
                id="smart-planner-modal-title"
                className="text-base font-bold text-slate-950 dark:text-slate-50"
              >
                Lập kế hoạch thông minh theo mẫu và quy tắc
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Phân tích cục bộ tiếng Việt ngay trên máy (không dùng AI ngoài) · Bạn xem trước, sửa từng bước và xác nhận trước khi tạo
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng lập kế hoạch"
            className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-12 overflow-y-auto lg:overflow-hidden">
          {/* Left: Prompt + Quick Examples */}
          <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-5 space-y-4 lg:overflow-y-auto">
            <div className="space-y-2">
              <label
                htmlFor="wf-smart-planner-prompt"
                className="block text-sm font-bold text-slate-900 dark:text-slate-100"
              >
                Bạn muốn thực hiện công việc gì?
              </label>
              <textarea
                id="wf-smart-planner-prompt"
                rows={5}
                maxLength={2000}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="VD: Chuẩn bị kiểm tra Toán 12 thứ Sáu gồm soạn đề, trộn 4 mã đề, kiểm tra đáp án và in đề."
                className="w-full rounded-[14px] border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#635BFF] focus:bg-white dark:focus:bg-slate-900 focus:outline-none leading-relaxed"
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  data-testid="wf-smart-planner-analyze-btn"
                  disabled={!prompt.trim()}
                  onClick={() => runAnalyze(prompt)}
                  className="aurora-btn-primary inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-xs font-semibold text-white disabled:opacity-45 disabled:pointer-events-none"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Phân tích và đề xuất bước</span>
                </button>
                {prompt.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setPrompt('');
                      setDraft(null);
                      setTitleOverride('');
                    }}
                    className="rounded-[10px] border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Xóa
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Chọn nhanh ví dụ tiếng Việt
              </div>
              <div className="space-y-1.5">
                {PLANNER_EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => {
                      setPrompt(ex.text);
                      runAnalyze(ex.text);
                    }}
                    className="w-full rounded-[11px] border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2 text-left hover:border-[#635BFF]/50 transition-colors"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {ex.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                      {ex.text}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Honest Warnings / Fallback Notice */}
            {draft && draft.warnings.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                {draft.warnings.map((w) => (
                  <div
                    key={w.id}
                    className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-relaxed ${
                      w.severity === 'warning'
                        ? 'border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200'
                        : 'border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/40 text-blue-950 dark:text-blue-200'
                    }`}
                  >
                    {w.severity === 'warning' ? (
                      <AlertTriangle
                        className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <Info
                        className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400"
                        aria-hidden="true"
                      />
                    )}
                    <span>{w.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Optional template fallback suggestions */}
            {draft && draft.templateSuggestions.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-3">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Bổ sung bước từ mẫu gợi ý (tùy chọn)
                </div>
                {draft.templateSuggestions.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleApplySuggestion(tpl.id)}
                    className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-left text-xs hover:border-[#635BFF]/50"
                  >
                    <span className="font-medium text-slate-800 dark:text-slate-100 truncate">
                      + {tpl.title}
                    </span>
                    <span className="text-[11px] font-mono text-[#5046E5] dark:text-[#A5B4FC] shrink-0 tabular-nums">
                      {tpl.stepsCount} bước
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Editable Proposed Steps */}
          <div className="lg:col-span-7 flex flex-col min-h-0 bg-slate-50/60 dark:bg-slate-950/40">
            {!draft || draft.isEmpty ? (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <div className="max-w-sm space-y-2">
                  <Sparkles
                    className="mx-auto h-7 w-7 text-slate-400"
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Đề xuất các bước sẽ hiển thị ở đây
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Nhập mô tả công việc bằng tiếng Việt bên trái rồi bấm{' '}
                    <strong className="text-slate-700 dark:text-slate-200">
                      Phân tích và đề xuất bước
                    </strong>
                    . Nếu mô tả quá ngắn, hệ thống sẽ thông báo rõ ràng thay vì tự bịa bước.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* Recognized Metadata */}
                  <div className="rounded-[14px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
                    <div className="space-y-1">
                      <label
                        htmlFor="wf-planner-title-override"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                      >
                        Tên quy trình sẽ tạo
                      </label>
                      <input
                        id="wf-planner-title-override"
                        type="text"
                        value={titleOverride}
                        onChange={(e) => setTitleOverride(e.target.value)}
                        className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-950 dark:text-slate-50 focus:border-[#635BFF] focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        Nhận diện:
                      </span>
                      <span>{stepNodes.length} bước thực hiện</span>
                      {draft.metadata.subject && (
                        <span>· {draft.metadata.subject}</span>
                      )}
                      {draft.metadata.grade && (
                        <span>· {draft.metadata.grade}</span>
                      )}
                      {draft.metadata.dueDateLabel && (
                        <span className="inline-flex items-center gap-1 text-[#5046E5] dark:text-[#A5B4FC] font-medium">
                          · <Calendar className="h-3 w-3" aria-hidden="true" />
                          {draft.metadata.dueDateLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Editable Steps List */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Các bước đề xuất (có thể sửa, thêm hoặc xóa trước khi tạo)
                      </span>
                      <button
                        type="button"
                        onClick={handleAddManualStep}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#635BFF]/50"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Thêm bước</span>
                      </button>
                    </div>

                    {stepNodes.length === 0 ? (
                      <div className="rounded-[14px] border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 text-center space-y-2">
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          Mô tả hiện tại chưa liệt kê các đầu việc cụ thể. Bạn có thể bấm{' '}
                          <strong className="text-slate-900 dark:text-slate-100">
                            Thêm bước
                          </strong>{' '}
                          hoặc chọn một mẫu gợi ý bên trái.
                        </p>
                      </div>
                    ) : (
                      <ol className="space-y-2">
                        {stepNodes.map((node, index) => (
                          <li
                            key={node.id}
                            className="rounded-[14px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-mono font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                                {index + 1}
                              </span>
                              <input
                                type="text"
                                value={node.title}
                                onChange={(e) =>
                                  handleEditStep(node.id, {
                                    title: e.target.value,
                                  })
                                }
                                aria-label={`Tên bước ${index + 1}`}
                                className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/70 px-2.5 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:border-[#635BFF] focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
                              />
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() => handleMoveStep(node.id, 'up')}
                                  aria-label="Di chuyển lên"
                                  className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 disabled:opacity-30"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === stepNodes.length - 1}
                                  onClick={() => handleMoveStep(node.id, 'down')}
                                  aria-label="Di chuyển xuống"
                                  className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 disabled:opacity-30"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStep(node.id)}
                                  aria-label="Xóa bước này"
                                  className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            </div>

                            <div className="pl-8 grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <select
                                value={node.suggestedAppId ?? ''}
                                onChange={(e) =>
                                  handleEditStep(node.id, {
                                    suggestedAppId: e.target.value
                                      ? (e.target.value as AppId)
                                      : undefined,
                                  })
                                }
                                aria-label="Công cụ TeacherOS liên kết"
                                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200"
                              >
                                <option value="">Không gắn công cụ cụ thể</option>
                                {readyApps.map((app) => (
                                  <option key={app.id} value={app.id}>
                                    Công cụ: {app.name}
                                  </option>
                                ))}
                              </select>

                              <select
                                value={node.priority}
                                onChange={(e) =>
                                  handleEditStep(node.id, {
                                    priority: e.target.value as CanvasPriority,
                                  })
                                }
                                aria-label="Mức ưu tiên"
                                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200"
                              >
                                <option value="low">Ưu tiên: Thấp</option>
                                <option value="medium">Ưu tiên: Trung bình</option>
                                <option value="high">Ưu tiên: Cao</option>
                              </select>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>

                {/* Confirm Footer */}
                <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5 shrink-0">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Bấm xác nhận để tạo quy trình mới (không ảnh hưởng quy trình cũ).
                  </span>
                  <button
                    type="button"
                    data-testid="wf-smart-planner-confirm-btn"
                    disabled={!canConfirm}
                    onClick={() => {
                      if (!draft) return;
                      onConfirmCreateWorkflow(draft, titleOverride);
                    }}
                    className="aurora-btn-primary inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-xs font-semibold text-white disabled:opacity-45 whitespace-nowrap shrink-0"
                  >
                    <span>Xác nhận tạo quy trình</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
