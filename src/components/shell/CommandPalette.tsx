import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Command,
  FileQuestion,
  Search,
  X,
  Zap,
} from 'lucide-react';
import { AppId } from '../../core/appRegistry';
import {
  LocalSearchResult,
  PaletteActionId,
  SearchScopeFilter,
  searchWorkspaceLocally,
} from '../../core/localSearch';
import { JournalEntry, LessonPack, ResourceItem } from '../../types/lesson';
import { AppIcon } from './appIcons';

interface CommandPaletteProps {
  open: boolean;
  packs: LessonPack[];
  resources?: ResourceItem[];
  journals?: JournalEntry[];
  onClose: () => void;
  onSelectApp: (appId: AppId) => void;
  onSelectPack: (pack: LessonPack) => void;
  onRunAction: (actionId: PaletteActionId) => void;
}

const SCOPE_TABS: Array<{ id: SearchScopeFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'lesson-pack', label: 'Bộ tiết dạy' },
  { id: 'question', label: 'Câu hỏi (CB/VD/MR)' },
  { id: 'resource-journal', label: 'Học liệu & Nhật ký' },
  { id: 'app', label: 'Ứng dụng' },
  { id: 'action', label: 'Lệnh nhanh' },
];

export function CommandPalette({
  open,
  packs,
  resources = [],
  journals = [],
  onClose,
  onSelectApp,
  onSelectPack,
  onRunAction,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScopeFilter>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(
    () =>
      searchWorkspaceLocally(query, packs, undefined, {
        scope,
        resources,
        journals,
      }),
    [query, packs, scope, resources, journals]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, scope, open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setScope('all');
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 15);
    return () => window.clearTimeout(timer);
  }, [open]);

  const executeResult = (item: LocalSearchResult) => {
    if (
      (item.kind === 'app' ||
        item.kind === 'resource' ||
        item.kind === 'journal') &&
      item.appId
    ) {
      onSelectApp(item.appId);
      onClose();
      return;
    }
    if (item.kind === 'action' && item.actionId) {
      onRunAction(item.actionId);
      onClose();
      return;
    }
    if (
      (item.kind === 'lesson-pack' || item.kind === 'question') &&
      item.packId
    ) {
      const target = packs.find((p) => p.id === item.packId);
      if (target) {
        onSelectPack(target);
      }
      onClose();
    }
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          results.length === 0 ? 0 : (prev + 1) % results.length
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          results.length === 0 ? 0 : (prev - 1 + results.length) % results.length
        );
      } else if (e.key === 'Enter') {
        const chosen = results[selectedIndex];
        if (chosen) {
          e.preventDefault();
          executeResult(chosen);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, results, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-start justify-center bg-slate-950/55 p-4 sm:pt-16"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cmd-palette-label"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          <label id="cmd-palette-label" htmlFor="cmd-palette-input" className="sr-only">
            Bảng lệnh và tìm kiếm toàn hệ thống Universal Search 2.0
          </label>
          <input
            ref={inputRef}
            id="cmd-palette-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm bộ tiết dạy, mã câu hỏi (CB-01, VD-02), học liệu, nhật ký hoặc lệnh..."
            className="w-full bg-transparent text-sm text-slate-950 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng lệnh"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scope Filter Bar */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 px-3 py-1.5">
          {SCOPE_TABS.map((tab) => {
            const active = scope === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setScope(tab.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-blue-900 dark:bg-blue-700 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          role="listbox"
          aria-label="Kết quả tìm kiếm cục bộ"
          className="max-h-[58vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80"
        >
          {results.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              Không có kết quả cục bộ phù hợp trong phạm vi đang chọn.
            </div>
          ) : (
            results.map((item, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => executeResult(item)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                    active
                      ? 'bg-blue-50 dark:bg-blue-950/60'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                      {item.appId ? (
                        <AppIcon appId={item.appId} className="h-3.5 w-3.5" />
                      ) : item.kind === 'lesson-pack' ? (
                        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : item.kind === 'question' ? (
                        <FileQuestion className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-950 dark:text-slate-100 truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {item.badgeText}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Command className="h-3 w-3" aria-hidden="true" />
            <span>Universal Search 2.0 · ↑↓ chọn · Enter mở · Esc đóng</span>
          </span>
          <span className="font-mono-num">{results.length} kết quả</span>
        </div>
      </div>
    </div>
  );
}
