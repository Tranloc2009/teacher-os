import { useEffect } from 'react';
import { Copy, Download, Edit3, Printer, Trash2 } from 'lucide-react';
import { LessonPack } from '../../types/lesson';

export interface PackContextMenuState {
  pack: LessonPack;
  x: number;
  y: number;
}

interface ContextMenuProps {
  menu: PackContextMenuState | null;
  onClose: () => void;
  onOpenInStudio: (pack: LessonPack) => void;
  onOpenInPrint: (pack: LessonPack) => void;
  onDuplicate: (pack: LessonPack) => void;
  onExportSingleJson: (pack: LessonPack) => void;
  onDelete: (pack: LessonPack) => void;
}

export function ContextMenu({
  menu,
  onClose,
  onOpenInStudio,
  onOpenInPrint,
  onDuplicate,
  onExportSingleJson,
  onDelete,
}: ContextMenuProps) {
  useEffect(() => {
    if (!menu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const handleScrollOrClick = () => {
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleScrollOrClick);
    window.addEventListener('scroll', handleScrollOrClick, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleScrollOrClick);
      window.removeEventListener('scroll', handleScrollOrClick, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const safeLeft = Math.max(12, Math.min(menu.x, viewportWidth - 250));
  const safeTop = Math.max(12, Math.min(menu.y, viewportHeight - 240));

  const { pack } = menu;

  return (
    <div
      role="menu"
      aria-label={`Thao tác nhanh cho ${pack.title || 'bộ tiết dạy'}`}
      style={{ left: `${safeLeft}px`, top: `${safeTop}px` }}
      onClick={(e) => e.stopPropagation()}
      className="no-print fixed z-50 w-60 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-lg text-xs text-slate-800 dark:text-slate-100"
    >
      <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 mb-1">
        <p className="font-semibold text-slate-950 dark:text-slate-50 truncate">
          {pack.title || '(Chưa đặt tên bài)'}
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
          {pack.subject} · {pack.grade} · {pack.duration}p
        </p>
      </div>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenInStudio(pack);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
      >
        <Edit3 className="h-3.5 w-3.5 text-blue-900 dark:text-blue-400 shrink-0" aria-hidden="true" />
        <span>Mở trong Lesson Studio</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenInPrint(pack);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
      >
        <Printer className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300 shrink-0" aria-hidden="true" />
        <span>Mở trong Print Studio (A4)</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onDuplicate(pack);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
      >
        <Copy className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300 shrink-0" aria-hidden="true" />
        <span>Nhân bản bộ tiết dạy</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onExportSingleJson(pack);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
      >
        <Download className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300 shrink-0" aria-hidden="true" />
        <span>Xuất nhanh gói này (.json)</span>
      </button>

      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onDelete(pack);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 whitespace-nowrap"
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Xóa bộ tiết dạy...</span>
      </button>
    </div>
  );
}
