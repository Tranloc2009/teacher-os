import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Copy,
  Eye,
  History,
  X,
} from 'lucide-react';
import type {
  DuplicateGroup,
  DuplicateResolutionAction,
  DuplicateResolutionEntry,
  GradedSheetRecord,
} from '../../types/grading';
import { getSheetStatusLabelVi } from '../../core/grading/gradingExporter';

interface DuplicateResolutionModalProps {
  open: boolean;
  groups: DuplicateGroup[];
  sheets: GradedSheetRecord[];
  history: DuplicateResolutionEntry[];
  onResolveGroup: (
    group: DuplicateGroup,
    action: DuplicateResolutionAction
  ) => void;
  onInspectSheet: (sheetId: string) => void;
  onRetakeForGroup: (group: DuplicateGroup) => void;
  onClose: () => void;
}

function getActionLabelVi(action: DuplicateResolutionAction): string {
  switch (action) {
    case 'keep-new':
      return 'Giữ bản mới (lưu ẩn bản cũ)';
    case 'keep-old':
      return 'Giữ bản cũ (lưu ẩn bản mới)';
    case 'keep-both':
      return 'Giữ cả hai để đối chiếu';
    case 'mark-retake':
      return 'Đánh dấu chụp lại';
  }
}

export function DuplicateResolutionModal({
  open,
  groups,
  sheets,
  history,
  onResolveGroup,
  onInspectSheet,
  onRetakeForGroup,
  onClose,
}: DuplicateResolutionModalProps) {
  if (!open) return null;

  const sheetMap = new Map(sheets.map((s) => [s.id, s]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Xử lý phiếu chụp trùng"
      data-testid="duplicate-resolution-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/65 backdrop-blur-xs p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-3xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <Copy className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-950 dark:text-white truncate">
                Phát hiện phiếu trùng ({groups.length} nhóm)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Hệ thống tuyệt đối không tự xóa bài. Giáo viên chọn bản cần giữ; lịch sử thay thế luôn được lưu lại.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ xử lý phiếu trùng"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {groups.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-6 text-center space-y-2">
              <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                Không còn nhóm phiếu trùng nào cần xử lý
              </div>
              <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                Tất cả bài làm đang hoạt động trong phiên đều duy nhất.
              </p>
            </div>
          ) : (
            groups.map((group) => {
              const groupSheets = group.sheetIds
                .map((id) => sheetMap.get(id))
                .filter((s): s is GradedSheetRecord => Boolean(s))
                .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

              return (
                <section
                  key={group.id}
                  className="rounded-2xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/35 dark:bg-amber-950/15 p-4 space-y-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-amber-900 dark:text-amber-200">
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{group.reasonLabel}</span>
                      {group.studentId && (
                        <span className="font-mono-num whitespace-nowrap">· HS {group.studentId}</span>
                      )}
                      {group.hammingDistance !== undefined && (
                        <span className="font-mono-num text-[11px] font-normal whitespace-nowrap">
                          (Sai khác ảnh: {group.hammingDistance}/64 bit)
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono-num text-slate-500 whitespace-nowrap">
                      {groupSheets.length} phiếu
                    </span>
                  </div>

                  {/* Side-by-side (or stacked on mobile) sheet comparison */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {groupSheets.map((sh, idx) => {
                      const isOldest = idx === 0;
                      const isNewest = idx === groupSheets.length - 1;
                      return (
                        <div
                          key={sh.id}
                          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 flex gap-3 items-start"
                        >
                          {sh.thumbnailDataUrl ? (
                            <img
                              src={sh.thumbnailDataUrl}
                              alt={`Thu nhỏ ${sh.fileName}`}
                              className="h-24 w-17 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                            />
                          ) : (
                            <div className="h-24 w-17 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] text-slate-400 shrink-0">
                              A4
                            </div>
                          )}
                          <div className="min-w-0 flex-1 space-y-1 text-xs">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-bold text-slate-900 dark:text-slate-100">
                                {isNewest
                                  ? 'Bản mới nhất'
                                  : isOldest
                                  ? 'Bản cũ hơn'
                                  : `Bản #${idx + 1}`}
                              </span>
                              <span className="font-mono-num font-bold text-indigo-700 dark:text-indigo-400">
                                {sh.finalScore} / {sh.maxScore}đ
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate font-mono-num">
                              {sh.fileName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Mã đề: <strong className="font-mono-num">{sh.examCode || '—'}</strong> · Đúng{' '}
                              <span className="font-mono-num">{sh.correctCount}</span> · Nét{' '}
                              <span className="font-mono-num">{sh.alignment.sharpnessScore}</span>
                            </div>
                            <div className="text-[10.5px] text-slate-500 font-mono-num">
                              {new Date(sh.uploadedAt).toLocaleTimeString('vi-VN')} ·{' '}
                              {getSheetStatusLabelVi(sh.status)}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                onInspectSheet(sh.id);
                                onClose();
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline pt-0.5"
                            >
                              <Eye className="h-3 w-3" aria-hidden="true" />
                              <span>Xem chi tiết bài này</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Teacher Action Buttons (Touch-friendly >=44px) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onResolveGroup(group, 'keep-new')}
                      className="min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-xs font-semibold text-white transition-colors"
                    >
                      Giữ bản mới
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolveGroup(group, 'keep-old')}
                      className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors"
                    >
                      Giữ bản cũ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onResolveGroup(group, 'keep-both');
                        if (groupSheets[0]) {
                          onInspectSheet(groupSheets[0].id);
                          onClose();
                        }
                      }}
                      className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                    >
                      Xem cả hai
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onResolveGroup(group, 'mark-retake');
                        onRetakeForGroup(group);
                      }}
                      className="min-h-[44px] inline-flex items-center justify-center gap-1 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 transition-colors"
                    >
                      <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Đánh dấu chụp lại</span>
                    </button>
                  </div>
                </section>
              );
            })
          )}

          {/* Resolution History Log */}
          {history.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                <History className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                <span>Lịch sử xử lý phiếu trùng ({history.length})</span>
              </div>
              <ul className="divide-y divide-slate-200/70 dark:divide-slate-800 text-[11.5px]">
                {history
                  .slice()
                  .reverse()
                  .slice(0, 8)
                  .map((entry) => (
                    <li
                      key={entry.id}
                      className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-300"
                    >
                      <span>
                        <strong className="font-mono-num">
                          {entry.studentId || 'Phiếu trùng'}
                        </strong>
                        : {getActionLabelVi(entry.action)}
                      </span>
                      <span className="font-mono-num text-[10.5px] text-slate-400">
                        {new Date(entry.timestamp).toLocaleTimeString('vi-VN')}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
