import { DragEvent, useMemo, useState } from 'react';
import {
  BookOpen,
  FileText,
  GitBranch,
  Layers,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  CANVAS_NODE_CATALOG,
  CanvasEntityKind,
  CanvasMode,
  CanvasNodeType,
} from '../../types/canvas';
import {
  TeacherEntityCollections,
  normalizeVietnameseText,
} from '../../core/canvasEngine';
import { NodeTypeIcon } from './CanvasNodeCard';

export const DND_NODE_TYPE_MIME = 'application/teacheros-canvas-node';
export const DND_ENTITY_MIME = 'application/teacheros-canvas-entity';

export interface DragEntityPayload {
  kind: CanvasEntityKind;
  entityId: string;
  label: string;
  meta: string;
}

interface CanvasSidebarProps {
  mode: CanvasMode;
  collapsed: boolean;
  collections: TeacherEntityCollections;
  onToggleCollapse: () => void;
  onQuickAddNode: (type: CanvasNodeType) => void;
  onQuickAddEntity: (payload: DragEntityPayload) => void;
}

export function CanvasSidebar({
  mode,
  collapsed,
  collections,
  onToggleCollapse,
  onQuickAddNode,
  onQuickAddEntity,
}: CanvasSidebarProps) {
  const [tab, setTab] = useState<'palette' | 'documents'>('palette');
  const [docSearch, setDocSearch] = useState('');

  const groupedPalette = useMemo(() => {
    const groups: Array<{
      id: 'structure' | 'execution' | 'reference';
      label: string;
      items: typeof CANVAS_NODE_CATALOG;
    }> = [
      {
        id: 'structure',
        label: 'Cấu trúc & Ghi chú',
        items: CANVAS_NODE_CATALOG.filter((i) => i.category === 'structure'),
      },
      {
        id: 'execution',
        label: 'Quy trình & Nhiệm vụ',
        items: CANVAS_NODE_CATALOG.filter((i) => i.category === 'execution'),
      },
      {
        id: 'reference',
        label: 'Node liên kết tài liệu',
        items: CANVAS_NODE_CATALOG.filter((i) => i.category === 'reference'),
      },
    ];
    return mode === 'workflow'
      ? [groups[1], groups[0], groups[2]]
      : groups;
  }, [mode]);

  const entityItems = useMemo(() => {
    const list: Array<DragEntityPayload & { groupLabel: string }> = [
      ...collections.packs.map((p) => ({
        kind: 'LessonPack' as const,
        entityId: p.id,
        label: p.title || '(Bộ tiết dạy chưa đặt tên)',
        meta: `${p.subject} · ${p.grade} · ${p.duration}p`,
        groupLabel: 'Bộ tiết dạy',
      })),
      ...collections.resources.map((r) => ({
        kind: 'ResourceItem' as const,
        entityId: r.id,
        label: r.title,
        meta: `${r.subject} · ${r.grade}`,
        groupLabel: 'Học liệu',
      })),
      ...collections.workflows.map((w) => ({
        kind: 'WorkflowRun' as const,
        entityId: w.id,
        label: w.title,
        meta: `${w.steps.filter((s) => s.done).length}/${w.steps.length} đầu việc`,
        groupLabel: 'Quy trình',
      })),
      ...collections.journals.map((j) => ({
        kind: 'JournalEntry' as const,
        entityId: j.id,
        label: `Nhật ký lớp ${j.classLabel} (${j.taughtDate})`,
        meta: j.nextAdjustment || j.whatWorked,
        groupLabel: 'Nhật ký dạy học',
      })),
      ...collections.mathExams.map((m) => ({
        kind: 'MathExamProject' as const,
        entityId: m.id,
        label: m.title,
        meta: `${m.grade} · ${m.questions.length} câu`,
        groupLabel: 'Đề Toán',
      })),
    ];

    const q = normalizeVietnameseText(docSearch);
    if (!q) return list;
    return list.filter((item) =>
      normalizeVietnameseText(`${item.label} ${item.meta} ${item.groupLabel}`).includes(q)
    );
  }, [collections, docSearch]);

  const handleNodeDragStart = (
    e: DragEvent<HTMLDivElement>,
    type: CanvasNodeType
  ) => {
    e.dataTransfer.setData(DND_NODE_TYPE_MIME, type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleEntityDragStart = (
    e: DragEvent<HTMLDivElement>,
    payload: DragEntityPayload
  ) => {
    e.dataTransfer.setData(DND_ENTITY_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  if (collapsed) {
    return (
      <aside
        data-tour-id={`${mode}-canvas-sidebar`}
        aria-label="Thư viện Node (đang thu gọn)"
        className="flex flex-col items-center gap-2 py-3 px-1.5 border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0"
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Mở thư viện Node và Tài liệu"
          title="Mở thư viện Node & Tài liệu"
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          data-tour-id={
            mode === 'workflow' ? 'workflow-canvas-add-task' : undefined
          }
          onClick={() => onQuickAddNode(mode === 'workflow' ? 'task' : 'workspace')}
          aria-label={
            mode === 'workflow' ? 'Thêm nhanh Nhiệm vụ' : 'Thêm nhanh Nhánh con'
          }
          title={
            mode === 'workflow' ? 'Thêm nhanh Nhiệm vụ' : 'Thêm nhanh Nhánh con'
          }
          className="rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => {
            setTab('documents');
            onToggleCollapse();
          }}
          aria-label="Mở kho Tài liệu để kéo thả vào Canvas"
          title="Tài liệu TeacherOS"
          className="rounded-xl border border-slate-200 dark:border-slate-700 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Layers className="h-4 w-4" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-tour-id={`${mode}-canvas-sidebar`}
      aria-label="Thư viện Node và Tài liệu TeacherOS"
      className="w-64 xl:w-68 shrink-0 h-full border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col min-h-0"
    >
      {/* Tab Header */}
      <div className="flex items-center justify-between gap-1.5 border-b border-slate-200/80 dark:border-slate-800 px-3 py-2.5">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setTab('palette')}
            className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
              tab === 'palette'
                ? 'bg-white dark:bg-slate-900 text-slate-950 dark:text-slate-50 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Thư viện Node
          </button>
          <button
            type="button"
            onClick={() => setTab('documents')}
            className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
              tab === 'documents'
                ? 'bg-white dark:bg-slate-900 text-slate-950 dark:text-slate-50 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Tài liệu ({entityItems.length})
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Thu gọn thư viện bên trái"
          title="Thu gọn"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {tab === 'palette' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Kéo thả khối vào Canvas hoặc bấm{' '}
            <strong className="font-semibold text-slate-700 dark:text-slate-200">+</strong>{' '}
            để thêm nhanh.
          </p>

          {groupedPalette.map((group) => (
            <div key={group.id} className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-0.5">
                {group.label}
              </div>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.type}
                    draggable
                    onDragStart={(e) => handleNodeDragStart(e, item.type)}
                    data-testid={`palette-node-${item.type}`}
                    className="group flex items-start justify-between gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-2.5 py-2 cursor-grab active:cursor-grabbing hover:border-blue-400 dark:hover:border-blue-600 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <NodeTypeIcon
                        type={item.type}
                        className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-900 dark:text-slate-100 leading-snug">
                          {item.label}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                          {item.description}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      data-tour-id={
                        mode === 'workflow' && item.type === 'task'
                          ? 'workflow-canvas-add-task'
                          : undefined
                      }
                      onClick={() => onQuickAddNode(item.type)}
                      aria-label={`Thêm node ${item.label}`}
                      title={`Thêm ${item.shortLabel}`}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 text-slate-600 dark:text-slate-300 hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-300 shrink-0"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-2.5 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                placeholder="Lọc bài dạy, học liệu..."
                aria-label="Lọc tài liệu TeacherOS"
                className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-8 pr-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
            {entityItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Không tìm thấy tài liệu khớp từ khóa.
              </p>
            ) : (
              entityItems.map((item) => (
                <div
                  key={`${item.kind}-${item.entityId}`}
                  draggable
                  onDragStart={(e) =>
                    handleEntityDragStart(e, {
                      kind: item.kind,
                      entityId: item.entityId,
                      label: item.label,
                      meta: item.meta,
                    })
                  }
                  data-testid={`palette-entity-${item.kind}-${item.entityId}`}
                  className="flex items-start justify-between gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-2 cursor-grab active:cursor-grabbing hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {item.kind === 'LessonPack' ? (
                      <BookOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                    ) : item.kind === 'ResourceItem' ? (
                      <Layers className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 mt-0.5 shrink-0" />
                    ) : item.kind === 'WorkflowRun' ? (
                      <GitBranch className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {item.groupLabel}
                      </div>
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 line-clamp-2">
                        {item.label}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {item.meta}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onQuickAddEntity({
                        kind: item.kind,
                        entityId: item.entityId,
                        label: item.label,
                        meta: item.meta,
                      })
                    }
                    aria-label={`Đưa "${item.label}" vào Canvas`}
                    title="Đưa vào Canvas (chỉ liên kết tham chiếu)"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-1 text-slate-600 dark:text-slate-300 hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-300 shrink-0"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
