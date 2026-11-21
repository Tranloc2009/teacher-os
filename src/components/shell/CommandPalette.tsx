import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Command,
  FileQuestion,
  Layers,
  Search,
  ShieldCheck,
  Wand2,
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
import {
  SUPPORTED_UNIVERSAL_COMMANDS,
  parseUniversalCommand,
} from '../../core/connectedWorkflowEngine';
import type {
  ConnectedWorkflowContext,
  ParsedUniversalCommand,
} from '../../types/connectedWorkflow';
import type { GradingSession } from '../../types/grading';
import { JournalEntry, LessonPack, ResourceItem } from '../../types/lesson';
import type { MathExamProject } from '../../types/mathExam';
import { AppIcon } from './appIcons';

interface CommandPaletteProps {
  open: boolean;
  packs: LessonPack[];
  resources?: ResourceItem[];
  journals?: JournalEntry[];
  mathExams?: MathExamProject[];
  gradingSessions?: GradingSession[];
  workflowContext?: ConnectedWorkflowContext;
  onClose: () => void;
  onSelectApp: (appId: AppId) => void;
  onSelectPack: (pack: LessonPack) => void;
  onSelectExam?: (examId: string) => void;
  onRunAction: (actionId: PaletteActionId) => void;
  onExecuteUniversalCommand?: (cmd: ParsedUniversalCommand) => void;
}

const SCOPE_TABS: Array<{ id: SearchScopeFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'lesson-pack', label: 'Bộ tiết dạy' },
  { id: 'question', label: 'Câu hỏi (CB/VD/MR)' },
  { id: 'resource-journal', label: 'Học liệu & Nhật ký' },
  { id: 'app', label: 'Ứng dụng' },
  { id: 'action', label: 'Lệnh nhanh' },
];

const QUICK_WORKFLOW_EXAMPLES = [
  'Mở Resource Vault',
  'Tạo đề Toán 12 từ tài liệu đang chọn',
  'Mở đề kiểm tra gần nhất',
  'Trộn đề hiện tại thành 4 mã',
  'Mở bảng đáp án mã 101',
  'Tạo phiếu trả lời cho lớp 12A2',
  'Mở danh sách bài cần duyệt',
  'Xuất bảng điểm đã xác nhận',
];

export function CommandPalette({
  open,
  packs,
  resources = [],
  journals = [],
  mathExams = [],
  gradingSessions = [],
  workflowContext,
  onClose,
  onSelectApp,
  onSelectPack,
  onSelectExam,
  onRunAction,
  onExecuteUniversalCommand,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScopeFilter>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingConfirmCmd, setPendingConfirmCmd] =
    useState<ParsedUniversalCommand | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const universalCommands = useMemo<ParsedUniversalCommand[]>(() => {
    if (!workflowContext || !onExecuteUniversalCommand) return [];
    if (scope !== 'all' && scope !== 'action') return [];
    return parseUniversalCommand(query, {
      ctx: workflowContext,
      resources,
      mathExams,
      gradingSessions,
    });
  }, [
    query,
    scope,
    workflowContext,
    resources,
    mathExams,
    gradingSessions,
    onExecuteUniversalCommand,
  ]);

  const matchingExams = useMemo(() => {
    if (scope !== 'all') return [];
    const q = query.trim().toLowerCase();
    if (!q) return mathExams.slice(0, 3);
    return mathExams
      .filter((e) =>
        `${e.title} ${e.subject ?? ''} ${e.grade}`.toLowerCase().includes(q)
      )
      .slice(0, 4);
  }, [mathExams, query, scope]);

  const navResults = useMemo(
    () =>
      searchWorkspaceLocally(query, packs, undefined, {
        scope,
        resources,
        journals,
      }),
    [query, packs, scope, resources, journals]
  );

  type CombinedItem =
    | { rowType: 'universal'; cmd: ParsedUniversalCommand }
    | { rowType: 'exam'; exam: MathExamProject }
    | { rowType: 'nav'; item: LocalSearchResult };

  const combinedRows = useMemo<CombinedItem[]>(() => {
    const rows: CombinedItem[] = [];
    for (const cmd of universalCommands) {
      rows.push({ rowType: 'universal', cmd });
    }
    for (const exam of matchingExams) {
      rows.push({ rowType: 'exam', exam });
    }
    for (const item of navResults) {
      rows.push({ rowType: 'nav', item });
    }
    return rows;
  }, [universalCommands, matchingExams, navResults]);

  useEffect(() => {
    setSelectedIndex(0);
    setPendingConfirmCmd(null);
  }, [query, scope, open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setScope('all');
      setPendingConfirmCmd(null);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 15);
    return () => window.clearTimeout(timer);
  }, [open]);

  const executeNavResult = (item: LocalSearchResult) => {
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

  const triggerUniversalCommand = (cmd: ParsedUniversalCommand) => {
    if (!onExecuteUniversalCommand) return;
    if (cmd.requiresConfirmation) {
      setPendingConfirmCmd(cmd);
      return;
    }
    onExecuteUniversalCommand(cmd);
    onClose();
  };

  const confirmAndRunPending = () => {
    if (!pendingConfirmCmd || !onExecuteUniversalCommand) return;
    onExecuteUniversalCommand(pendingConfirmCmd);
    setPendingConfirmCmd(null);
    onClose();
  };

  const executeCombinedRow = (row: CombinedItem) => {
    if (row.rowType === 'universal') {
      triggerUniversalCommand(row.cmd);
      return;
    }
    if (row.rowType === 'exam') {
      if (onSelectExam) {
        onSelectExam(row.exam.id);
      } else {
        onSelectApp('math-mixer');
      }
      onClose();
      return;
    }
    executeNavResult(row.item);
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (pendingConfirmCmd) {
          setPendingConfirmCmd(null);
        } else {
          onClose();
        }
      } else if (e.key === 'ArrowDown' && !pendingConfirmCmd) {
        e.preventDefault();
        setSelectedIndex((prev) =>
          combinedRows.length === 0 ? 0 : (prev + 1) % combinedRows.length
        );
      } else if (e.key === 'ArrowUp' && !pendingConfirmCmd) {
        e.preventDefault();
        setSelectedIndex((prev) =>
          combinedRows.length === 0
            ? 0
            : (prev - 1 + combinedRows.length) % combinedRows.length
        );
      } else if (e.key === 'Enter') {
        if (pendingConfirmCmd) {
          e.preventDefault();
          confirmAndRunPending();
          return;
        }
        const chosen = combinedRows[selectedIndex];
        if (chosen) {
          e.preventDefault();
          executeCombinedRow(chosen);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, combinedRows, selectedIndex, pendingConfirmCmd, onClose]);

  if (!open) return null;

  const workflowCount = universalCommands.filter((c) => c.category === 'workflow').length;
  const navOffset = universalCommands.length;

  return (
    <div
      className="no-print fixed inset-0 z-[75] flex items-start justify-center bg-slate-950/55 p-4 sm:pt-14"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cmd-palette-label"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 text-[#635BFF] shrink-0" aria-hidden="true" />
          <label id="cmd-palette-label" htmlFor="cmd-palette-input" className="sr-only">
            Thanh lệnh chung TeacherOS Universal Command Bar
          </label>
          <input
            ref={inputRef}
            id="cmd-palette-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Nhập lệnh tiếng Việt (vd: "Tạo đề Toán 12...", "Trộn đề này thành 4 mã") hoặc tìm tài liệu...'
            className="w-full bg-transparent text-sm text-slate-950 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng thanh lệnh"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Clickable Vietnamese Workflow Command Examples */}
        {!pendingConfirmCmd && !query.trim() && onExecuteUniversalCommand && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 bg-[#F8F9FF] dark:bg-indigo-950/25 px-3.5 py-2">
            <span className="text-[11px] font-semibold text-[#4338CA] dark:text-indigo-300 mr-1">
              Lệnh gợi ý:
            </span>
            {QUICK_WORKFLOW_EXAMPLES.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setQuery(sample)}
                className="rounded-lg border border-indigo-200/80 dark:border-indigo-800/70 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-[#635BFF] hover:text-[#4338CA]"
              >
                {sample}
              </button>
            ))}
          </div>
        )}

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
                    ? 'bg-[#635BFF] text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Inline Confirmation Gate for Workflow Commands (Section 9) */}
        {pendingConfirmCmd ? (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-[#F5F6FF] dark:bg-indigo-950/40 p-4">
              <ShieldCheck
                className="h-5 w-5 text-[#635BFF] dark:text-indigo-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#4338CA] dark:text-indigo-300">
                  Xác nhận lệnh quy trình (Local-First)
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {pendingConfirmCmd.confirmationTitle || pendingConfirmCmd.title}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {pendingConfirmCmd.confirmationDescription || pendingConfirmCmd.subtitle}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingConfirmCmd(null)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50"
              >
                Quay lại
              </button>
              <button
                type="button"
                onClick={confirmAndRunPending}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#5248f0]"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Xác nhận thực hiện</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            role="listbox"
            aria-label="Kết quả thanh lệnh chung"
            className="max-h-[56vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80"
          >
            {combinedRows.length === 0 ? (
              <div className="px-5 py-6 space-y-4">
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Không nhận diện được lệnh hoặc dữ liệu phù hợp với &ldquo;{query.trim()}&rdquo;
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Hệ thống 100% cục bộ không tự thực thi lệnh mơ hồ, lệnh xóa dữ liệu hoặc bỏ qua kiểm chứng. Chọn một lệnh tiếng Việt được hỗ trợ bên dưới:
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {SUPPORTED_UNIVERSAL_COMMANDS.slice(0, 8).map((hint) => (
                    <button
                      key={hint.example}
                      type="button"
                      onClick={() => setQuery(hint.example)}
                      className="flex flex-col items-start rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2 text-left hover:border-[#635BFF] hover:bg-[#F5F6FF] dark:hover:bg-indigo-950/40 transition-colors"
                    >
                      <span className="text-xs font-semibold text-[#4338CA] dark:text-indigo-300">
                        {hint.example}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                        {hint.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {universalCommands.length > 0 && (
                  <div className="bg-slate-50/80 dark:bg-slate-950/60 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#4338CA] dark:text-indigo-300 flex items-center justify-between">
                    <span>Lệnh quy trình (Workflow Commands)</span>
                    <span className="font-normal normal-case text-slate-500">
                      {workflowCount > 0 ? 'Có bước xác nhận trước khi thực thi' : 'Điều hướng nhanh'}
                    </span>
                  </div>
                )}

                {universalCommands.map((cmd, idx) => {
                  const active = idx === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => triggerUniversalCommand(cmd)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                        active
                          ? 'bg-[#EEF0FF]/90 dark:bg-indigo-950/60'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-indigo-200 dark:border-indigo-800 bg-[#F3F0FF] dark:bg-indigo-950 text-[#635BFF] dark:text-indigo-300">
                          <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-950 dark:text-slate-100 truncate">
                            {cmd.title}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {cmd.subtitle}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                            cmd.blockedReason
                              ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                              : 'border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-[#4338CA] dark:text-indigo-300'
                          }`}
                        >
                          {cmd.blockedReason
                            ? cmd.badgeText
                            : cmd.requiresConfirmation
                            ? 'Xác nhận'
                            : cmd.badgeText}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      </div>
                    </button>
                  );
                })}

                {(matchingExams.length > 0 || navResults.length > 0) && (
                  <div className="bg-slate-50/80 dark:bg-slate-950/60 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Điều hướng & Tìm kiếm (Navigation Commands)
                  </div>
                )}

                {matchingExams.map((exam, examIdx) => {
                  const rowIdx = navOffset + examIdx;
                  const active = rowIdx === selectedIndex;
                  return (
                    <button
                      key={`exam-${exam.id}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setSelectedIndex(rowIdx)}
                      onClick={() => executeCombinedRow({ rowType: 'exam', exam })}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                        active
                          ? 'bg-blue-50 dark:bg-blue-950/60'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300">
                          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-950 dark:text-slate-100 truncate">
                            {exam.title}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {exam.subject || 'Toán học'} · {exam.grade} · {exam.questions.length} câu ·{' '}
                            {exam.generatedVersions.length} mã đề
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-medium text-violet-700 dark:text-violet-300 whitespace-nowrap">
                          Đề kiểm tra
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      </div>
                    </button>
                  );
                })}

                {navResults.map((item, navIdx) => {
                  const rowIdx = navOffset + matchingExams.length + navIdx;
                  const active = rowIdx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setSelectedIndex(rowIdx)}
                      onClick={() => executeNavResult(item)}
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
                })}
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Command className="h-3 w-3" aria-hidden="true" />
            <span>Universal Command Bar · 100% Cục bộ · ↑↓ chọn · Enter mở · Esc đóng</span>
          </span>
          <span className="font-mono-num">{combinedRows.length} kết quả</span>
        </div>
      </div>
    </div>
  );
}
