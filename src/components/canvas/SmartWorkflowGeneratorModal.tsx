import {
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Edit3,
  GitBranch,
  GripVertical,
  Info,
  LayoutTemplate,
  Link2,
  Mic,
  MicOff,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { AppId } from '../../core/appRegistry';
import {
  DraftNodeSource,
  SmartWorkflowDraftEdge,
  SmartWorkflowDraftNode,
  SmartWorkflowParseResult,
  WORK_CATEGORY_META,
  WorkCategory,
  appendTemplateSuggestionToDraft,
  applyDraftAutoLayout,
  classifyWorkCategory,
  detectDuplicateDraftNodes,
  getReadyTeacherOSApps,
  inferSafeTeacherOSApp,
  parseVietnameseWorkflow,
  validateDraftGraph,
} from '../../core/smartWorkflowParser';
import {
  CANVAS_NODE_CATALOG,
  CanvasLayoutMode,
  CanvasNodeRecord,
  CanvasNodeType,
} from '../../types/canvas';

interface SmartWorkflowGeneratorModalProps {
  open: boolean;
  existingBoardNodes: CanvasNodeRecord[];
  onClose: () => void;
  onConfirmInsert: (
    draft: SmartWorkflowParseResult,
    options: { skipDuplicates: boolean }
  ) => void;
}

interface QuickExampleItem {
  id: string;
  label: string;
  text: string;
}

const QUICK_EXAMPLES: QuickExampleItem[] = [
  {
    id: 'ex-math',
    label: 'Kiểm tra Toán 12 (4 mã đề)',
    text: 'Chuẩn bị kiểm tra Toán 12 gồm soạn đề, trộn 4 mã đề, kiểm tra đáp án và in đề.',
  },
  {
    id: 'ex-seq',
    label: 'Phiếu học tập → Rubric (Ngày mai)',
    text: 'Ngày mai tôi cần soạn phiếu học tập, sau đó chuẩn bị rubric.',
  },
  {
    id: 'ex-bullets',
    label: 'Danh sách chuẩn bị bài dạy',
    text: 'Chuẩn bị bài dạy:\n- Tìm học liệu\n- Thiết kế hoạt động\n- Tạo phiếu học tập\n- In tài liệu',
  },
  {
    id: 'ex-vague',
    label: 'Sinh hoạt chuyên môn (mô tả ngắn)',
    text: 'Tôi muốn tổ chức một buổi sinh hoạt chuyên môn.',
  },
];

const PLACEHOLDER_TEXT =
  'Ví dụ: Tôi cần chuẩn bị kiểm tra Toán 12 thứ Sáu, gồm soạn đề, trộn 4 mã đề, kiểm tra đáp án và in đề.';

const PREVIEW_NODE_W = 204;
const PREVIEW_NODE_H = 88;

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionConstructor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function getSourceDisplayLabel(source: DraftNodeSource): string | null {
  if (source === 'template') return 'Gợi ý bổ sung';
  if (source === 'manual') return 'Tự thêm';
  return null;
}

export function SmartWorkflowGeneratorModal({
  open,
  existingBoardNodes,
  onClose,
  onConfirmInsert,
}: SmartWorkflowGeneratorModalProps) {
  const [inputText, setInputText] = useState('');
  const [draft, setDraft] = useState<SmartWorkflowParseResult | null>(null);
  const [previewLayoutMode, setPreviewLayoutMode] =
    useState<Exclude<CanvasLayoutMode, 'free'>>('tree-tb');
  const [isEditing, setIsEditing] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [fitDiagram, setFitDiagram] = useState(true);
  const [mobileTab, setMobileTab] = useState<'input' | 'preview'>('input');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [previewContainerWidth, setPreviewContainerWidth] = useState(596);

  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const readyApps = useMemo(() => getReadyTeacherOSApps(), []);
  const speechAvailable = useMemo(
    () => Boolean(getSpeechRecognitionConstructor()),
    []
  );

  useEffect(() => {
    if (!open) return;
    const el = previewContainerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const nextW = Math.max(260, Math.floor(el.clientWidth - 18));
      if (nextW > 0) setPreviewContainerWidth(nextW);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, mobileTab, draft]);

  useEffect(() => {
    if (!open && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore cleanup stop errors
      }
      setIsListening(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore unmount stop errors
        }
      }
    };
  }, []);

  const runAnalysis = (
    textToParse: string,
    layout: Exclude<CanvasLayoutMode, 'free'> = previewLayoutMode
  ) => {
    const parsed = parseVietnameseWorkflow(textToParse, {
      existingBoardNodes,
      layoutMode: layout,
    });
    setDraft(parsed);
    setSelectedNodeId(parsed.nodes[0]?.id ?? null);
    setSkipDuplicates(true);
    setMobileTab('preview');
  };

  const handleToggleVoice = () => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const SpeechCtor = getSpeechRecognitionConstructor();
    if (!SpeechCtor) return;
    const recognition = new SpeechCtor();
    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const firstResult = event.results?.[0]?.[0]?.transcript ?? '';
      if (firstResult.trim()) {
        setInputText((prev) =>
          prev.trim() ? `${prev.trim()} ${firstResult.trim()}` : firstResult.trim()
        );
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const updateDraftNodesAndEdges = (
    nextNodes: SmartWorkflowDraftNode[],
    nextEdges: SmartWorkflowDraftEdge[],
    layout: Exclude<CanvasLayoutMode, 'free'> = previewLayoutMode
  ) => {
    if (!draft) return;
    const laidOut = applyDraftAutoLayout(nextNodes, nextEdges, layout);
    const duplicateMatches = detectDuplicateDraftNodes(laidOut, existingBoardNodes);
    const dupMap = new Map(
      duplicateMatches.map((m) => [m.draftNodeId, m.existingNodeId])
    );
    const syncedNodes = laidOut.map((n) => ({
      ...n,
      duplicateOfNodeId: dupMap.get(n.id),
    }));
    setDraft({
      ...draft,
      nodes: syncedNodes,
      edges: nextEdges,
      duplicateMatches,
    });
  };

  const handleRelayoutPreview = (
    nextLayout: Exclude<CanvasLayoutMode, 'free'>
  ) => {
    setPreviewLayoutMode(nextLayout);
    if (!draft || draft.nodes.length === 0) return;
    updateDraftNodesAndEdges(draft.nodes, draft.edges, nextLayout);
  };

  const handleUpdateDraftNode = (
    nodeId: string,
    patch: Partial<SmartWorkflowDraftNode>
  ) => {
    if (!draft) return;
    const nextNodes = draft.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const updated: SmartWorkflowDraftNode = { ...node, ...patch };
      if (patch.title !== undefined && patch.category === undefined) {
        updated.category = classifyWorkCategory(patch.title);
      }
      if (patch.suggestedAppId !== undefined) {
        const app = readyApps.find((a) => a.id === patch.suggestedAppId);
        updated.suggestedAppName = app?.name;
      }
      return updated;
    });
    updateDraftNodesAndEdges(nextNodes, draft.edges);
  };

  const handleReparentDraftNode = (
    nodeId: string,
    newParentId: string | null
  ) => {
    if (!draft) return;
    const targetNode = draft.nodes.find((n) => n.id === nodeId);
    if (!targetNode || targetNode.type === 'root' || nodeId === newParentId) {
      return;
    }

    const filteredEdges = draft.edges.filter(
      (e) => !(e.edgeType === 'parent' && e.target === nodeId)
    );
    const candidateEdges: SmartWorkflowDraftEdge[] = newParentId
      ? [
          ...filteredEdges,
          {
            id: `dedge-reparent-${Date.now()}`,
            source: newParentId,
            target: nodeId,
            edgeType: 'parent',
            sourceKind: 'manual',
          },
        ]
      : filteredEdges;

    const validation = validateDraftGraph(draft.nodes, candidateEdges);
    if (!validation.valid) return;

    const nextNodes = draft.nodes.map((n) =>
      n.id === nodeId ? { ...n, parentId: newParentId } : n
    );
    updateDraftNodesAndEdges(nextNodes, candidateEdges);
  };

  const handleAddDraftStep = () => {
    if (!draft) return;
    const root = draft.nodes.find((n) => n.type === 'root') ?? draft.nodes[0] ?? null;
    const nextId = `draft-manual-${Date.now()}`;
    const title = `Đầu việc mới ${draft.nodes.length + 1}`;
    const appInfo = inferSafeTeacherOSApp(title, {
      subject: draft.metadata.subject,
      fullInput: draft.rawInput,
    });
    const created: SmartWorkflowDraftNode = {
      id: nextId,
      type: draft.nodes.length === 0 ? 'root' : 'task',
      title,
      description: '',
      parentId: root && draft.nodes.length > 0 ? root.id : null,
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

    const nextEdges: SmartWorkflowDraftEdge[] =
      root && created.parentId
        ? [
            ...draft.edges,
            {
              id: `dedge-manual-${Date.now()}`,
              source: root.id,
              target: nextId,
              edgeType: 'parent',
              sourceKind: 'manual',
            },
          ]
        : draft.edges;

    updateDraftNodesAndEdges([...draft.nodes, created], nextEdges);
    setSelectedNodeId(nextId);
    setIsEditing(true);
  };

  const handleDeleteDraftNode = (nodeId: string) => {
    if (!draft) return;
    const removedNode = draft.nodes.find((n) => n.id === nodeId);
    if (!removedNode) return;
    const remainingNodes = draft.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) =>
        n.parentId === nodeId ? { ...n, parentId: removedNode.parentId ?? null } : n
      );
    const remainingEdges = draft.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    );
    updateDraftNodesAndEdges(remainingNodes, remainingEdges);
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(remainingNodes[0]?.id ?? null);
    }
  };

  const handleReorderNode = (sourceId: string, directionOrTargetId: 'up' | 'down' | string) => {
    if (!draft) return;
    const ordered = [...draft.nodes];
    const fromIdx = ordered.findIndex((n) => n.id === sourceId);
    if (fromIdx < 0) return;

    let toIdx = fromIdx;
    if (directionOrTargetId === 'up') {
      toIdx = Math.max(0, fromIdx - 1);
    } else if (directionOrTargetId === 'down') {
      toIdx = Math.min(ordered.length - 1, fromIdx + 1);
    } else {
      toIdx = ordered.findIndex((n) => n.id === directionOrTargetId);
      if (toIdx < 0) return;
    }
    if (fromIdx === toIdx) return;

    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    const reindexed = ordered.map((n, i) => ({ ...n, orderIndex: i }));
    updateDraftNodesAndEdges(reindexed, draft.edges);
  };

  const handleAppendTemplate = (templateId: string) => {
    const baseDraft =
      draft && !draft.isEmpty
        ? draft
        : parseVietnameseWorkflow(
            inputText.trim() || 'Quy trình công việc mới',
            { existingBoardNodes, layoutMode: previewLayoutMode }
          );
    const next = appendTemplateSuggestionToDraft(
      baseDraft,
      templateId,
      previewLayoutMode
    );
    setDraft(next);
    setSelectedNodeId(next.nodes[0]?.id ?? null);
  };

  const graphValidation = useMemo(() => {
    if (!draft) return { valid: true, errors: [] };
    return validateDraftGraph(draft.nodes, draft.edges);
  }, [draft]);

  const selectedNode = useMemo(
    () => draft?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [draft, selectedNodeId]
  );

  // Normalize draft coordinates to compact SVG/Canvas preview viewport
  const diagramGeometry = useMemo(() => {
    if (!draft || draft.nodes.length === 0) {
      return {
        width: 520,
        height: 220,
        fitScale: 1,
        items: [] as Array<{ node: SmartWorkflowDraftNode; x: number; y: number }>,
      };
    }
    const scaleX = 0.74;
    const scaleY = 0.62;
    const rawItems = draft.nodes.map((node) => ({
      node,
      x: Math.round(node.position.x * scaleX),
      y: Math.round(node.position.y * scaleY),
    }));
    const minX = Math.min(...rawItems.map((i) => i.x));
    const minY = Math.min(...rawItems.map((i) => i.y));
    const pad = 16;
    const normalized = rawItems.map((i) => ({
      node: i.node,
      x: i.x - minX + pad,
      y: i.y - minY + pad,
    }));
    const maxX = Math.max(...normalized.map((i) => i.x + PREVIEW_NODE_W)) + pad;
    const maxY = Math.max(...normalized.map((i) => i.y + PREVIEW_NODE_H)) + pad;
    const width = Math.max(480, maxX);
    const height = Math.max(210, maxY);
    const fitScale = Math.max(
      0.28,
      Math.min(1, previewContainerWidth / width, 248 / height)
    );
    return {
      width,
      height,
      fitScale,
      items: normalized,
    };
  }, [draft, previewContainerWidth]);

  const previewPosById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const item of diagramGeometry.items) {
      map.set(item.node.id, { x: item.x, y: item.y });
    }
    return map;
  }, [diagramGeometry.items]);

  if (!open) return null;

  const depEdgesCount =
    draft?.edges.filter((e) => e.edgeType === 'dependency').length ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-wf-gen-title"
      data-testid="smart-workflow-generator-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-3 sm:p-5 backdrop-blur-[2px]"
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 px-5 py-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="smart-wf-gen-title"
                className="text-base font-bold text-slate-950 dark:text-slate-50"
              >
                Tạo sơ đồ từ mô tả
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Phân tích mô tả tiếng Việt trực tiếp trên thiết bị · Cho phép xem trước và chỉnh sửa từng bước trước khi thêm
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng Tạo sơ đồ từ mô tả"
            className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Mobile Tab Switcher (< lg) */}
        <div className="flex lg:hidden items-center gap-1 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-2 shrink-0">
          <button
            type="button"
            onClick={() => setMobileTab('input')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              mobileTab === 'input'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-slate-50 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            1. Nhập mô tả
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('preview')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold font-mono-num transition-colors ${
              mobileTab === 'preview'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-slate-50 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            2. Xem trước ({draft?.nodes.length ?? 0})
          </button>
        </div>

        {/* Main Content: Input (Left) + Interactive Preview (Right) */}
        <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-12 overflow-y-auto lg:overflow-hidden">
          {/* Left Panel: Vietnamese Input, Examples, Warnings, Suggestions */}
          <div
            className={`${
              mobileTab === 'input' ? 'block' : 'hidden lg:block'
            } lg:col-span-5 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4 lg:overflow-y-auto`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="smart-wf-input"
                  className="text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  Mô tả công việc bằng tiếng Việt
                </label>
                {speechAvailable ? (
                  <button
                    type="button"
                    onClick={handleToggleVoice}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                      isListening
                        ? 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {isListening ? (
                      <>
                        <MicOff className="h-3 w-3" aria-hidden="true" />
                        <span>Dừng đọc</span>
                      </>
                    ) : (
                      <>
                        <Mic className="h-3 w-3" aria-hidden="true" />
                        <span>Nói tiếng Việt</span>
                      </>
                    )}
                  </button>
                ) : null}
              </div>

              <div className="relative">
                <textarea
                  id="smart-wf-input"
                  rows={5}
                  maxLength={2000}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={PLACEHOLDER_TEXT}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 pb-7 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 leading-relaxed"
                />
                <span className="pointer-events-none absolute right-3 bottom-2 text-[11px] font-mono-num text-slate-400">
                  {inputText.length} / 2.000
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => runAnalysis(inputText)}
                  disabled={!inputText.trim()}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap shrink-0 transition-colors"
                >
                  <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Phân tích công việc</span>
                </button>

                {inputText.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setInputText('');
                      setDraft(null);
                      setSelectedNodeId(null);
                      setIsEditing(false);
                    }}
                    className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                  >
                    Xóa nội dung
                  </button>
                )}
              </div>
            </div>

            {/* Quick-pick Examples */}
            <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Ví dụ chọn nhanh
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1.5">
                {QUICK_EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => {
                      setInputText(ex.text);
                      runAnalysis(ex.text);
                    }}
                    className="text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 px-3 py-2 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
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

            {/* Parser Warnings / Clarifications / Duplicate Notice */}
            {draft && !draft.isEmpty && draft.warnings.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                {draft.warnings.map((w) => (
                  <div
                    key={w.id}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                      w.severity === 'warning'
                        ? 'border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200'
                        : 'border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/40 text-blue-950 dark:text-blue-200'
                    }`}
                  >
                    {w.severity === 'warning' ? (
                      <AlertTriangle
                        className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <Info
                        className="h-4 w-4 shrink-0 mt-0.5 text-blue-800 dark:text-blue-400"
                        aria-hidden="true"
                      />
                    )}
                    <span>{w.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Optional Template Suggestions (strictly labeled "Gợi ý bổ sung") */}
            {draft && !draft.isEmpty && (
              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Chọn template bổ sung (tùy chọn)
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Gợi ý bổ sung
                  </span>
                </div>
                <div className="space-y-1.5">
                  {draft.templateSuggestions.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleAppendTemplate(tpl.id)}
                      className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {tpl.title}
                        </span>
                        <span className="font-mono-num text-[11px] text-blue-800 dark:text-blue-300 shrink-0">
                          Gợi ý bổ sung · {tpl.stepsCount} bước
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                        {tpl.subtitle}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel: Visual Preview Diagram + Editable Node Inspector/List */}
          <div
            className={`${
              mobileTab === 'preview' ? 'flex' : 'hidden lg:flex'
            } lg:col-span-7 flex-col min-h-0 bg-slate-50/70 dark:bg-slate-950/60 lg:overflow-y-auto`}
          >
            {!draft || draft.isEmpty ? (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <div className="max-w-sm space-y-2">
                  <GitBranch
                    className="mx-auto h-7 w-7 text-slate-400"
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Vùng xem trước sơ đồ công việc
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Nhập yêu cầu tiếng Việt hoặc chọn một ví dụ bên trái rồi nhấn{' '}
                    <strong className="text-slate-700 dark:text-slate-200">
                      Phân tích công việc
                    </strong>{' '}
                    để xem cây nhiệm vụ, quan hệ phụ thuộc và liên kết công cụ TeacherOS.
                  </p>
                </div>
              </div>
            ) : (
              <div className="pb-5 space-y-4">
                {/* Sticky Preview Summary Header & Mode Controls */}
                <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-950/95 px-4 sm:px-5 py-3 backdrop-blur-sm">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-xs font-bold text-slate-950 dark:text-slate-50 truncate">
                      {draft.metadata.mainGoal}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400 font-mono-num">
                      <span>{draft.nodes.length} node</span>
                      <span aria-hidden="true">·</span>
                      <span>{depEdgesCount} phụ thuộc</span>
                      {draft.metadata.subject && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{draft.metadata.subject}</span>
                        </>
                      )}
                      {draft.metadata.grade && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{draft.metadata.grade}</span>
                        </>
                      )}
                      {draft.metadata.dueDateLabel && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-blue-800 dark:text-blue-300 font-medium">
                            <Calendar className="h-3 w-3" aria-hidden="true" />
                            <span>{draft.metadata.dueDateLabel}</span>
                          </span>
                        </>
                      )}
                      {draft.metadata.quantities.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {draft.metadata.quantities.map((q) => q.raw).join(', ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 max-w-full">
                    <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
                      <button
                        type="button"
                        onClick={() => handleRelayoutPreview('tree-tb')}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                          previewLayoutMode === 'tree-tb'
                            ? 'bg-slate-900 dark:bg-blue-700 text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Cây dọc
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRelayoutPreview('tree-lr')}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                          previewLayoutMode === 'tree-lr'
                            ? 'bg-slate-900 dark:bg-blue-700 text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Cây ngang
                      </button>
                    </div>

                    <button
                      type="button"
                      aria-pressed={isEditing}
                      onClick={() => setIsEditing((prev) => !prev)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                        isEditing
                          ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200'
                          : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Chỉnh sửa đề xuất</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFitDiagram((prev) => !prev)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-[11px] font-medium font-mono-num text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      {fitDiagram ? 'Vừa khung' : '100%'}
                    </button>

                    <button
                      type="button"
                      onClick={handleAddDraftStep}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Thêm bước</span>
                    </button>
                  </div>
                </div>

                <div className="px-4 sm:px-5 space-y-4">
                {/* Cycle Guard Notice (if ever triggered) */}
                {!graphValidation.valid && (
                  <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 px-3 py-2 text-xs text-rose-900 dark:text-rose-200">
                    {graphValidation.errors.join(' ')}
                  </div>
                )}

                {/* Visual Tree / DAG Preview Surface */}
                <div
                  ref={previewContainerRef}
                  data-testid="smart-wf-preview-canvas"
                  className="relative overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2"
                  style={{ maxHeight: '280px' }}
                >
                  {(() => {
                    const activeScale = fitDiagram ? diagramGeometry.fitScale : 1;
                    const scaledW = Math.round(diagramGeometry.width * activeScale);
                    const scaledH = Math.round(diagramGeometry.height * activeScale);
                    return (
                      <div
                        className="relative mx-auto overflow-hidden"
                        style={{
                          width: `${scaledW}px`,
                          height: `${scaledH}px`,
                        }}
                      >
                        <div
                          className="relative origin-top-left"
                          style={{
                            width: `${diagramGeometry.width}px`,
                            height: `${diagramGeometry.height}px`,
                            transform: `scale(${activeScale})`,
                          }}
                        >
                    <svg
                      width={diagramGeometry.width}
                      height={diagramGeometry.height}
                      className="pointer-events-none absolute inset-0"
                      aria-hidden="true"
                    >
                      <defs>
                        <marker
                          id="preview-arrow-dep"
                          viewBox="0 0 10 10"
                          refX="8"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 1 L 10 5 L 0 9 z" fill="#1d4ed8" />
                        </marker>
                      </defs>
                      {draft.edges.map((edge) => {
                        const s = previewPosById.get(edge.source);
                        const t = previewPosById.get(edge.target);
                        if (!s || !t) return null;

                        const isDep = edge.edgeType === 'dependency';
                        const sx =
                          previewLayoutMode === 'tree-lr'
                            ? s.x + PREVIEW_NODE_W
                            : s.x + PREVIEW_NODE_W / 2;
                        const sy =
                          previewLayoutMode === 'tree-lr'
                            ? s.y + PREVIEW_NODE_H / 2
                            : s.y + PREVIEW_NODE_H;
                        const tx =
                          previewLayoutMode === 'tree-lr'
                            ? t.x
                            : t.x + PREVIEW_NODE_W / 2;
                        const ty =
                          previewLayoutMode === 'tree-lr'
                            ? t.y + PREVIEW_NODE_H / 2
                            : t.y;
                        const midX = (sx + tx) / 2;
                        const midY = (sy + ty) / 2;
                        const path =
                          previewLayoutMode === 'tree-lr'
                            ? `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`
                            : `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;

                        return (
                          <g key={edge.id}>
                            <path
                              d={path}
                              fill="none"
                              stroke={isDep ? '#1d4ed8' : '#94a3b8'}
                              strokeWidth={isDep ? 2 : 1.5}
                              strokeDasharray={isDep ? '5 3' : undefined}
                              markerEnd={isDep ? 'url(#preview-arrow-dep)' : undefined}
                            />
                            {isDep && edge.label && (
                              <text
                                x={midX}
                                y={midY - 4}
                                textAnchor="middle"
                                fontSize="10"
                                fill="#1d4ed8"
                                fontWeight="600"
                              >
                                {edge.label}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>

                    {diagramGeometry.items.map(({ node, x, y }) => {
                      const isSelected = node.id === selectedNodeId;
                      const catLabel = WORK_CATEGORY_META[node.category].label;
                      const sourceBadge = getSourceDisplayLabel(node.source);
                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => setSelectedNodeId(node.id)}
                          style={{
                            left: `${x}px`,
                            top: `${y}px`,
                            width: `${PREVIEW_NODE_W}px`,
                            height: `${PREVIEW_NODE_H}px`,
                          }}
                          className={`absolute flex flex-col justify-between rounded-lg border p-2.5 text-left transition-colors ${
                            isSelected
                              ? 'border-blue-700 bg-blue-50/70 dark:bg-blue-950/60 ring-2 ring-blue-600/20'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/90 hover:border-slate-400 dark:hover:border-slate-500'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                              <span className="truncate font-medium">
                                {node.type === 'root'
                                  ? 'Mục tiêu gốc'
                                  : node.type === 'milestone'
                                  ? 'Mốc hoàn thành'
                                  : node.type === 'checklist'
                                  ? 'Checklist'
                                  : catLabel}
                                {sourceBadge ? ` · ${sourceBadge}` : ''}
                              </span>
                              {node.quantityLabel && (
                                <span className="font-mono-num font-semibold text-blue-800 dark:text-blue-300 shrink-0">
                                  {node.quantityLabel}
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-2 leading-snug">
                              {node.title}
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1 truncate">
                              {node.suggestedAppName ? (
                                <>
                                  <Link2 className="h-3 w-3 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
                                  <span className="truncate text-blue-900 dark:text-blue-300 font-medium">
                                    {node.suggestedAppName}
                                  </span>
                                </>
                              ) : (
                                <span>{node.dueDateLabel || 'Chưa gắn công cụ'}</span>
                              )}
                            </span>
                            {node.duplicateOfNodeId && (
                              <span className="text-amber-700 dark:text-amber-400 font-semibold shrink-0">
                                Trùng
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Ordered Node List (Supports Drag-and-Drop & Quick Reordering) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Danh sách node đề xuất ({draft.nodes.length})
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Kéo thả hoặc nhấn nút mũi tên để sắp xếp thứ tự
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {draft.nodes.map((node, index) => {
                      const selected = node.id === selectedNodeId;
                      const sourceBadge = getSourceDisplayLabel(node.source);
                      return (
                        <div
                          key={node.id}
                          draggable
                          onDragStart={(e: DragEvent<HTMLDivElement>) => {
                            setDraggedNodeId(node.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e: DragEvent<HTMLDivElement>) => {
                            e.preventDefault();
                          }}
                          onDrop={(e: DragEvent<HTMLDivElement>) => {
                            e.preventDefault();
                            if (draggedNodeId && draggedNodeId !== node.id) {
                              handleReorderNode(draggedNodeId, node.id);
                            }
                            setDraggedNodeId(null);
                          }}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                            selected
                              ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40'
                              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <GripVertical
                              className="h-3.5 w-3.5 text-slate-400 cursor-grab shrink-0"
                              aria-hidden="true"
                            />
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(node.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                <span className="font-mono-num text-slate-400 mr-1.5">
                                  {index + 1}.
                                </span>
                                {node.title}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {WORK_CATEGORY_META[node.category].label}
                                {node.suggestedAppName ? ` · ${node.suggestedAppName}` : ''}
                                {node.quantityLabel ? ` · ${node.quantityLabel}` : ''}
                                {sourceBadge ? ` · ${sourceBadge}` : ''}
                                {node.duplicateOfNodeId ? ' · Trùng tiêu đề trên bảng' : ''}
                              </div>
                            </button>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleReorderNode(node.id, 'up')}
                              disabled={index === 0}
                              aria-label={`Đưa "${node.title}" lên`}
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                            >
                              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReorderNode(node.id, 'down')}
                              disabled={index === draft.nodes.length - 1}
                              aria-label={`Đưa "${node.title}" xuống`}
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                            >
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedNodeId(node.id);
                                setIsEditing(true);
                              }}
                              aria-label={`Sửa "${node.title}"`}
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDraftNode(node.id)}
                              aria-label={`Xóa "${node.title}"`}
                              className="rounded p-1 text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-700 dark:hover:text-rose-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Inline Node Editor (Active when "Chỉnh sửa đề xuất" is enabled) */}
                {isEditing && selectedNode && (
                  <div
                    data-testid="smart-wf-node-editor"
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        Chỉnh sửa node đang chọn
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {getSourceDisplayLabel(selectedNode.source) ?? 'Tự phân tích'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <label
                          htmlFor="draft-node-title"
                          className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          Tiêu đề công việc
                        </label>
                        <input
                          id="draft-node-title"
                          type="text"
                          value={selectedNode.title}
                          onChange={(e) =>
                            handleUpdateDraftNode(selectedNode.id, {
                              title: e.target.value,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="draft-node-type"
                          className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          Loại node
                        </label>
                        <select
                          id="draft-node-type"
                          value={selectedNode.type}
                          onChange={(e) =>
                            handleUpdateDraftNode(selectedNode.id, {
                              type: e.target.value as CanvasNodeType,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        >
                          {CANVAS_NODE_CATALOG.map((item) => (
                            <option key={item.type} value={item.type}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="draft-node-category"
                          className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          Phân loại công việc
                        </label>
                        <select
                          id="draft-node-category"
                          value={selectedNode.category}
                          onChange={(e) =>
                            handleUpdateDraftNode(selectedNode.id, {
                              category: e.target.value as WorkCategory,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        >
                          {(Object.keys(WORK_CATEGORY_META) as WorkCategory[]).map(
                            (cat) => (
                              <option key={cat} value={cat}>
                                {WORK_CATEGORY_META[cat].label}
                              </option>
                            )
                          )}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="draft-node-parent"
                          className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          Nhánh cha
                        </label>
                        <select
                          id="draft-node-parent"
                          disabled={selectedNode.type === 'root'}
                          value={selectedNode.parentId ?? ''}
                          onChange={(e) =>
                            handleReparentDraftNode(
                              selectedNode.id,
                              e.target.value ? e.target.value : null
                            )
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
                        >
                          <option value="">-- Nhánh độc lập (Không có cha) --</option>
                          {draft.nodes
                            .filter((n) => n.id !== selectedNode.id)
                            .map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.title}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="draft-node-due"
                          className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          Ngày hạn
                        </label>
                        <input
                          id="draft-node-due"
                          type="date"
                          value={selectedNode.dueDate ?? ''}
                          onChange={(e) =>
                            handleUpdateDraftNode(selectedNode.id, {
                              dueDate: e.target.value || undefined,
                              dueDateLabel: e.target.value || undefined,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono-num text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label
                          htmlFor="draft-node-app"
                          className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          Ứng dụng TeacherOS liên kết
                        </label>
                        <select
                          id="draft-node-app"
                          value={selectedNode.suggestedAppId ?? ''}
                          onChange={(e) =>
                            handleUpdateDraftNode(selectedNode.id, {
                              suggestedAppId: e.target.value
                                ? (e.target.value as AppId)
                                : undefined,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        >
                          <option value="">-- Không liên kết ứng dụng --</option>
                          {readyApps.map((app) => (
                            <option key={app.id} value={app.id}>
                              {app.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {(() => {
          const dupCount = draft?.duplicateMatches.length ?? 0;
          const totalDraftNodes = draft?.nodes.length ?? 0;
          const insertableCount =
            draft && !draft.isEmpty
              ? skipDuplicates
                ? totalDraftNodes - dupCount
                : totalDraftNodes
              : 0;
          const canCommit = Boolean(
            draft &&
              !draft.isEmpty &&
              totalDraftNodes > 0 &&
              graphValidation.valid &&
              insertableCount > 0
          );

          return (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 px-5 py-3 shrink-0">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <LayoutTemplate className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                  <span>
                    {draft && !draft.isEmpty
                      ? `Sẵn sàng thêm ${insertableCount}/${totalDraftNodes} node vào Workflow Canvas (hỗ trợ Hoàn tác Ctrl+Z).`
                      : 'Phân tích mô tả tiếng Việt để xem trước cây công việc trước khi thêm vào Canvas.'}
                  </span>
                </div>
                {dupCount > 0 && (
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      className="rounded border-amber-400 text-blue-800 focus:ring-blue-700"
                    />
                    <span className="font-mono-num">
                      Bỏ qua {dupCount} node trùng đã có
                    </span>
                  </label>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  data-testid="confirm-smart-wf-insert-btn"
                  disabled={!canCommit}
                  onClick={() => {
                    if (draft && canCommit) {
                      onConfirmInsert(draft, { skipDuplicates });
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Thêm vào Workspace</span>
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
