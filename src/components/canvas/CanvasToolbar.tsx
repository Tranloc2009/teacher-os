import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Crosshair,
  GitBranch,
  Grid,
  HelpCircle,
  LayoutTemplate,
  Map as MapIcon,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import {
  CanvasBoard,
  CanvasLayoutMode,
  CanvasMode,
  CanvasNodeRecord,
  CanvasViewSettings,
} from '../../types/canvas';
import { CANVAS_LAYOUT_OPTIONS } from '../../core/canvasLayout';

interface CanvasToolbarProps {
  mode: CanvasMode;
  boards: CanvasBoard[];
  activeBoard: CanvasBoard;
  breadcrumbNodes: CanvasNodeRecord[];
  focusRootNode: CanvasNodeRecord | null;
  layoutMode: CanvasLayoutMode;
  searchQuery: string;
  viewSettings: CanvasViewSettings;
  classicViewLabel: string;
  mobileLibraryOpen: boolean;
  mobileInspectorOpen: boolean;
  desktopInspectorOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onToggleMobileLibrary: () => void;
  onToggleMobileInspector: () => void;
  onToggleDesktopInspector: () => void;
  onSelectBoard: (boardId: string) => void;
  onOpenNewBoardForm: () => void;
  onSelectBreadcrumbNode: (nodeId: string) => void;
  onExitFocusSubtree: () => void;
  onSelectLayoutMode: (layoutMode: CanvasLayoutMode) => void;
  onTriggerAutoLayout: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenSmartBuilder: () => void;
  onOpenNaturalLanguageGenerator?: () => void;
  onChangeSearchQuery: (q: string) => void;
  onToggleSnapToGrid: () => void;
  onToggleMiniMap: () => void;
  onSwitchToClassicView: () => void;
  onStartHelp?: () => void;
}

export function CanvasToolbar({
  mode,
  boards,
  activeBoard,
  breadcrumbNodes,
  focusRootNode,
  layoutMode,
  searchQuery,
  viewSettings,
  classicViewLabel,
  mobileLibraryOpen,
  mobileInspectorOpen,
  desktopInspectorOpen,
  canUndo,
  canRedo,
  onToggleMobileLibrary,
  onToggleMobileInspector,
  onToggleDesktopInspector,
  onSelectBoard,
  onOpenNewBoardForm,
  onSelectBreadcrumbNode,
  onExitFocusSubtree,
  onSelectLayoutMode,
  onTriggerAutoLayout,
  onUndo,
  onRedo,
  onOpenSmartBuilder,
  onOpenNaturalLanguageGenerator,
  onChangeSearchQuery,
  onToggleSnapToGrid,
  onToggleMiniMap,
  onSwitchToClassicView,
  onStartHelp,
}: CanvasToolbarProps) {
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!displayMenuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (
        displayMenuRef.current &&
        !displayMenuRef.current.contains(e.target as Node)
      ) {
        setDisplayMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDisplayMenuOpen(false);
    };
    window.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onEsc);
    };
  }, [displayMenuOpen]);

  const showSecondaryStrip = breadcrumbNodes.length > 0 || Boolean(focusRootNode);

  return (
    <header
      data-tour-id={`${mode}-canvas-toolbar`}
      className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 sm:px-4 py-2 shrink-0"
    >
      {/* Single Clean Primary Row */}
      <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 min-w-0">
        {/* Left: Board switcher + Primary Action */}
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5 min-w-0 max-w-full">
          <div className="inline-flex items-center rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 overflow-hidden min-w-0">
            <select
              aria-label="Chọn bảng Canvas"
              value={activeBoard.id}
              onChange={(e) => onSelectBoard(e.target.value)}
              className="min-w-0 max-w-[140px] lg:max-w-[155px] 2xl:max-w-[195px] truncate bg-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onOpenNewBoardForm}
              title="Tạo bảng Canvas mới"
              aria-label="Tạo bảng Canvas mới"
              className="border-l border-slate-200 dark:border-slate-700 px-2 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {mode === 'workflow' && onOpenNaturalLanguageGenerator ? (
            <>
              <button
                type="button"
                data-testid="open-smart-wf-generator-btn"
                onClick={onOpenNaturalLanguageGenerator}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-2.5 xl:px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
              >
                <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tạo sơ đồ từ mô tả</span>
              </button>

              <button
                type="button"
                data-tour-id={`${mode}-canvas-smart-builder`}
                onClick={onOpenSmartBuilder}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <GitBranch className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Mẫu quy trình</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              data-tour-id={`${mode}-canvas-smart-builder`}
              onClick={onOpenSmartBuilder}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Dựng cây bài dạy</span>
            </button>
          )}
        </div>

        {/* Right: Quiet grouped utilities */}
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5 min-w-0 max-w-full lg:shrink-0">
          {/* Undo / Redo */}
          <div className="inline-flex items-center rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 overflow-hidden shrink-0">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Hoàn tác (Ctrl+Z)"
              aria-label="Hoàn tác"
              className="px-2 py-1.5 text-slate-600 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Làm lại (Ctrl+Y)"
              aria-label="Làm lại"
              className="border-l border-slate-200 dark:border-slate-700 px-2 py-1.5 text-slate-600 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Search Node */}
          <div className="relative w-28 sm:w-32 2xl:w-40">
            <Search
              className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onChangeSearchQuery(e.target.value)}
              placeholder="Tìm node..."
              aria-label="Tìm node trên Canvas"
              className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 pl-8 pr-6 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onChangeSearchQuery('')}
                aria-label="Xóa từ khóa tìm node"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Compact Auto Layout Group */}
          <div
            data-tour-id={`${mode}-canvas-layout-group`}
            className="inline-flex items-center rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 overflow-hidden shrink-0"
          >
            <select
              aria-label="Chọn kiểu tự động dàn trang"
              value={layoutMode}
              onChange={(e) => onSelectLayoutMode(e.target.value as CanvasLayoutMode)}
              className="bg-transparent px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-100 focus:outline-none"
            >
              {CANVAS_LAYOUT_OPTIONS.map((opt) => (
                <option key={opt.mode} value={opt.mode}>
                  {opt.shortLabel}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onTriggerAutoLayout}
              title="Tự động sắp xếp lại vị trí các node (giữ nguyên node đã khóa)"
              className="border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 inline-flex items-center gap-1 whitespace-nowrap transition-colors"
            >
              <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden xl:inline">Dàn trang</span>
            </button>
          </div>

          {/* Display Options Popover (Snap to Grid & MiniMap) */}
          <div ref={displayMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setDisplayMenuOpen((prev) => !prev)}
              aria-expanded={displayMenuOpen}
              aria-haspopup="menu"
              aria-label="Tùy chọn hiển thị Canvas"
              title="Tùy chọn hiển thị Canvas"
              className={`inline-flex items-center gap-1.5 rounded-[10px] border px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                displayMenuOpen
                  ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-200'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden 2xl:inline">Hiển thị</span>
            </button>

            {displayMenuOpen && (
              <div
                role="menu"
                aria-label="Tùy chọn hiển thị Canvas"
                className="absolute right-0 mt-1.5 w-52 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-lg z-40 text-xs"
              >
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={viewSettings.snapToGrid}
                  onClick={onToggleSnapToGrid}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="inline-flex items-center gap-2">
                    <Grid className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span>Bám lưới (Snap)</span>
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      viewSettings.snapToGrid
                        ? 'bg-blue-600 dark:bg-blue-400'
                        : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={viewSettings.showMiniMap}
                  onClick={onToggleMiniMap}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="inline-flex items-center gap-2">
                    <MapIcon className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span>Bản đồ thu nhỏ</span>
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      viewSettings.showMiniMap
                        ? 'bg-blue-600 dark:bg-blue-400'
                        : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  />
                </button>
              </div>
            )}
          </div>

          {/* Mobile Drawer Toggles (< lg) */}
          <button
            type="button"
            data-tour-id={`${mode}-canvas-mobile-library`}
            onClick={onToggleMobileLibrary}
            aria-pressed={mobileLibraryOpen}
            className={`lg:hidden inline-flex items-center gap-1 rounded-[10px] border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              mobileLibraryOpen
                ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-200'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            <PanelLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Thư viện</span>
          </button>

          <button
            type="button"
            data-tour-id={`${mode}-canvas-mobile-inspector`}
            onClick={onToggleMobileInspector}
            aria-pressed={mobileInspectorOpen}
            className={`lg:hidden inline-flex items-center gap-1 rounded-[10px] border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              mobileInspectorOpen
                ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-200'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Chi tiết</span>
          </button>

          {/* Desktop Overview Toggle */}
          <button
            type="button"
            onClick={onToggleDesktopInspector}
            aria-pressed={desktopInspectorOpen}
            aria-label="Bật/tắt bảng Tổng quan & Chi tiết"
            title="Bật/tắt bảng Tổng quan & Chi tiết"
            className={`hidden lg:inline-flex items-center gap-1 rounded-[10px] border px-2 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              desktopInspectorOpen
                ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-200'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden 2xl:inline">Tổng quan</span>
          </button>

          {/* Classic View Switch */}
          <button
            type="button"
            data-tour-id={`${mode}-canvas-classic-switch`}
            onClick={onSwitchToClassicView}
            className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            {classicViewLabel}
          </button>

          {onStartHelp && (
            <button
              type="button"
              data-tour-id={`${mode}-canvas-help`}
              onClick={onStartHelp}
              aria-label={
                mode === 'workflow'
                  ? 'Hướng dẫn sử dụng Workflow Center'
                  : 'Hướng dẫn sử dụng My Workspace'
              }
              title="Hướng dẫn tương tác TeacherOS Academy"
              className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-300 shrink-0 transition-colors"
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Contextual Breadcrumb & Focus Subtree Strip (only shown when navigating a branch or focusing) */}
      {showSecondaryStrip && (
        <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <nav
            aria-label="Breadcrumb sơ đồ Canvas"
            className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 overflow-x-auto min-w-0"
          >
            <span className="font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0">
              {activeBoard.title}
            </span>
            {breadcrumbNodes.map((crumb) => (
              <div key={crumb.id} className="inline-flex items-center gap-1 shrink-0">
                <ChevronRight className="h-3 w-3 text-slate-400" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => onSelectBreadcrumbNode(crumb.id)}
                  className="rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium max-w-[180px] truncate"
                >
                  {crumb.title}
                </button>
              </div>
            ))}
          </nav>

          {focusRootNode && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-0.5 text-[11px] text-indigo-800 dark:text-indigo-200 shrink-0">
              <Crosshair className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="font-medium max-w-[180px] truncate">
                Đang tập trung: {focusRootNode.title}
              </span>
              <button
                type="button"
                onClick={onExitFocusSubtree}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                <span>Thoát</span>
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
