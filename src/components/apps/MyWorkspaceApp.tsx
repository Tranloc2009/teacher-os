import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  CopyPlus,
  Download,
  Edit3,
  FolderKanban,
  GitBranch,
  LayoutGrid,
  Printer,
  Sparkles,
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
  const [viewMode, setViewMode] = useState<'canvas' | 'classic'>('canvas');
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
        classicViewLabel="Danh sách & Inspector"
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
        onOpenEntity={onOpenCanvasEntity}
        onShowToast={onShowToast}
      />
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
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
        {/* Left column: Subject / Grade Pack List */}
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
                        ? 'border-blue-800 dark:border-blue-500 bg-blue-50/40 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        <FolderKanban className="h-3.5 w-3.5 text-blue-900 dark:text-blue-400 shrink-0" aria-hidden="true" />
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

        {/* Right column: Document Inspector + Lesson Variants + Handover Kit */}
        <aside
          aria-label="Document Inspector và Công cụ Biến thể"
          className="lg:col-span-5"
        >
          {inspectedPack && inspectionReport ? (
            <div className="tos-card-pad sticky top-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-900 dark:text-blue-400">
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

              {/* 4 Inspection Checks */}
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

              {/* Quick Studio & Print Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenInStudio(inspectedPack)}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors"
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

              {/* Lesson Variants Generator */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <GitBranch className="h-4 w-4 text-blue-900 dark:text-blue-400" aria-hidden="true" />
                  <span>Tạo biến thể tiết dạy (Lesson Variants)</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Tự động nhân bản và co giãn thời lượng hoạt động sang khung giờ mới (giữ chuẩn 5–15 phút/hoạt động) hoặc tạo bản riêng cho lớp song song.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void onCreateVariant(inspectedPack, 'toggle-duration')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-blue-900 dark:text-blue-400" aria-hidden="true" />
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

              {/* Handover Kit Export & Cross-Module Links */}
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
                    className="text-xs font-medium text-blue-900 dark:text-blue-400 hover:underline px-2 py-1"
                  >
                    Kho học liệu ({inspectionReport.linkedResourcesCount})
                  </button>
                  <button
                    type="button"
                    onClick={onOpenTeachingJournal}
                    className="text-xs font-medium text-blue-900 dark:text-blue-400 hover:underline px-2 py-1"
                  >
                    Nhật ký ({inspectionReport.linkedJournalsCount})
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
