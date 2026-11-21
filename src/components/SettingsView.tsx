import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  GraduationCap,
  HardDrive,
  History,
  Keyboard,
  Palette,
  Play,
  Printer,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import { LocalSnapshotSummary } from '../db/database';
import { APP_REGISTRY } from '../core/appRegistry';
import {
  TUTORIAL_REGISTRY,
  getActiveTutorialSteps,
} from '../core/tutorialRegistry';
import {
  AccentColor,
  ThemeMode,
  UIDensity,
  UIPreferences,
} from '../core/theme';
import {
  BackupPayload,
  LessonPack,
  MarginPreset,
  PrintSettings,
} from '../types/lesson';
import { validateBackupPayload } from '../utils/backup';
import {
  BrowserStorageEstimate,
  estimateBrowserStorage,
  exportJsonBackupFile,
} from '../utils/storageResilience';
import { ConfirmDialog } from './ConfirmDialog';
import { OnlineCloudPanel } from './cloud/OnlineCloudPanel';
import { useOptionalTutorial } from './tutorial/TutorialProvider';

interface SettingsBackupExtras {
  resources?: BackupPayload['resources'];
  workflows?: BackupPayload['workflows'];
  journals?: BackupPayload['journals'];
  mathExams?: BackupPayload['mathExams'];
  canvasBoards?: BackupPayload['canvasBoards'];
  canvasNodes?: BackupPayload['canvasNodes'];
  canvasEdges?: BackupPayload['canvasEdges'];
  canvasViewSettings?: BackupPayload['canvasViewSettings'];
}

interface SettingsViewProps {
  settings: PrintSettings;
  packs: LessonPack[];
  uiPrefs: UIPreferences;
  snapshotSummary: LocalSnapshotSummary;
  backupExtras?: SettingsBackupExtras;
  onUpdateUIPrefs: (next: Partial<UIPreferences>) => void;
  onSaveSettings: (next: PrintSettings) => Promise<void>;
  onRestoreBackup: (payload: BackupPayload) => Promise<void>;
  onCreateSnapshot: () => Promise<void>;
  onRollbackSnapshot: () => Promise<void>;
}

const PRESETS: Record<Exclude<MarginPreset, 'custom'>, { label: string; mm: number }> = {
  narrow: { label: 'Hẹp (10 mm)', mm: 10 },
  standard: { label: 'Tiêu chuẩn (15 mm)', mm: 15 },
  wide: { label: 'Rộng (20 mm)', mm: 20 },
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SettingsView({
  settings,
  packs,
  uiPrefs,
  snapshotSummary,
  backupExtras,
  onUpdateUIPrefs,
  onSaveSettings,
  onRestoreBackup,
  onCreateSnapshot,
  onRollbackSnapshot,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<PrintSettings>(settings);
  const [marginError, setMarginError] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [pendingRestore, setPendingRestore] = useState<BackupPayload | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [storageEstimate, setStorageEstimate] =
    useState<BrowserStorageEstimate | null>(null);
  const [academyResetDone, setAcademyResetDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tutorial = useOptionalTutorial();

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    void estimateBrowserStorage().then(setStorageEstimate);
  }, [packs.length, snapshotSummary.createdAt]);

  const applyPreset = (preset: MarginPreset) => {
    if (preset === 'custom') {
      setDraft((prev) => ({ ...prev, marginPreset: 'custom' }));
      return;
    }
    const mm = PRESETS[preset].mm;
    setMarginError('');
    setDraft((prev) => ({
      ...prev,
      marginPreset: preset,
      marginsMm: { top: mm, right: mm, bottom: mm, left: mm },
    }));
  };

  const updateMargin = (side: keyof PrintSettings['marginsMm'], raw: string) => {
    const val = Number(raw);
    setDraft((prev) => ({
      ...prev,
      marginPreset: 'custom',
      marginsMm: {
        ...prev.marginsMm,
        [side]: Number.isFinite(val) ? val : 0,
      },
    }));
  };

  const handleSave = async () => {
    const { top, right, bottom, left } = draft.marginsMm;
    const values = [top, right, bottom, left];
    if (values.some((v) => !Number.isFinite(v) || v < 5 || v > 40)) {
      setMarginError('Các lề in phải nằm trong khoảng từ 5 mm đến 40 mm để không bị cắt chữ khi in A4.');
      return;
    }
    setMarginError('');
    await onSaveSettings(draft);
  };

  const handleExportJson = () => {
    exportJsonBackupFile(packs, draft, 'teacheros-4-backup', backupExtras);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Allow re-selecting the same file later
    e.target.value = '';
    if (!file) return;

    setImportErrors([]);
    try {
      const text = await file.text();
      const result = validateBackupPayload(text);
      if (!result.valid || !result.payload) {
        setImportErrors(result.errors);
        return;
      }
      setPendingRestore(result.payload);
    } catch {
      setImportErrors(['Không thể đọc tệp đã chọn. Vui lòng thử lại với tệp .json hợp lệ.']);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore) return;
    const payload = pendingRestore;
    setPendingRestore(null);
    await onRestoreBackup(payload);
  };

  const handleConfirmRollback = async () => {
    setConfirmRollback(false);
    await onRollbackSnapshot();
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
          Settings Center — Giao diện, In A4, Cloud &amp; An toàn dữ liệu
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Tùy biến không gian làm việc TeacherOS, quản lý kết nối Supabase Free tùy chọn, cấu hình lề in A4 mặc định và sao lưu/khôi phục dữ liệu cục bộ.
        </p>
      </div>

      {/* Section 0A: Nền tảng Trực tuyến & Bảo mật (Phase 4A — Free Tier Only) */}
      <OnlineCloudPanel />

      {/* Section 0: Giao diện & Không gian làm việc TeacherOS 4.0 */}
      <section
        aria-labelledby="appearance-settings-heading"
        className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <Palette className="h-5 w-5 text-blue-900 dark:text-blue-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <h2 id="appearance-settings-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Giao diện &amp; Bố cục Shell (TeacherOS 4.0)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Điều chỉnh chế độ Sáng/Tối, mật độ hiển thị bảng biểu và trạng thái thanh điều hướng.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {/* Theme */}
          <div>
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Chế độ màu
            </span>
            <div className="mt-2 flex gap-2">
              {(
                [
                  { id: 'light', label: 'Sáng (Light)' },
                  { id: 'dark', label: 'Tối (Dark)' },
                ] as Array<{ id: ThemeMode; label: string }>
              ).map((item) => {
                const active = uiPrefs.theme === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onUpdateUIPrefs({ theme: item.id })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap ${
                      active
                        ? 'border-blue-800 bg-blue-900 dark:bg-blue-700 text-white'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Density */}
          <div>
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Mật độ không gian
            </span>
            <div className="mt-2 flex gap-2">
              {(
                [
                  { id: 'comfortable', label: 'Thoáng' },
                  { id: 'compact', label: 'Gọn' },
                ] as Array<{ id: UIDensity; label: string }>
              ).map((item) => {
                const active = uiPrefs.density === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onUpdateUIPrefs({ density: item.id })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap ${
                      active
                        ? 'border-blue-800 bg-blue-900 dark:bg-blue-700 text-white'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Accent */}
          <div>
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Tông màu nhấn
            </span>
            <div className="mt-2 flex gap-2">
              {(
                [
                  { id: 'blue', label: 'Xanh lam' },
                  { id: 'indigo', label: 'Chàm' },
                  { id: 'teal', label: 'Xanh ngọc' },
                ] as Array<{ id: AccentColor; label: string }>
              ).map((item) => {
                const active = uiPrefs.accent === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onUpdateUIPrefs({ accent: item.id })}
                    className={`flex-1 rounded-lg border px-2.5 py-2 text-xs font-medium whitespace-nowrap ${
                      active
                        ? 'border-blue-800 bg-blue-900 dark:bg-blue-700 text-white'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 dark:border-slate-800 pt-4">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={!uiPrefs.sidebarCollapsed}
              onChange={(e) =>
                onUpdateUIPrefs({ sidebarCollapsed: !e.target.checked })
              }
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-900"
            />
            <span>Mở rộng thanh điều hướng bên trái (Sidebar) trên màn hình lớn</span>
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={uiPrefs.showDock}
              onChange={(e) => onUpdateUIPrefs({ showDock: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-900"
            />
            <span>Hiển thị thanh Dock ứng dụng dưới đáy màn hình</span>
          </label>
        </div>
      </section>

      {/* Section 1: Khổ giấy & Lề in A4 */}
      <section
        aria-labelledby="print-settings-heading"
        className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-start gap-3">
            <Printer className="h-5 w-5 text-blue-900 dark:text-blue-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="print-settings-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Khổ giấy &amp; Lề in
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Cấu hình này được áp dụng trực tiếp cho xem trước và lệnh In / Lưu PDF của trình duyệt.
              </p>
            </div>
          </div>
          <span className="self-start font-mono-num text-xs font-semibold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 rounded whitespace-nowrap shrink-0">
            A4 (210 × 297 mm)
          </span>
        </div>

        {/* Margin Presets */}
        <div>
          <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Mức lề in nhanh
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(PRESETS) as Array<Exclude<MarginPreset, 'custom'>>).map((key) => {
              const active = draft.marginPreset === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className={`rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'border-blue-800 dark:border-blue-600 bg-blue-900 dark:bg-blue-700 text-white'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {PRESETS[key].label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => applyPreset('custom')}
              className={`rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                draft.marginPreset === 'custom'
                  ? 'border-blue-800 dark:border-blue-600 bg-blue-900 dark:bg-blue-700 text-white'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              Tùy chỉnh từng cạnh
            </button>
          </div>
        </div>

        {/* Custom Margin Inputs */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              { key: 'top', label: 'Lề trên (mm)' },
              { key: 'right', label: 'Lề phải (mm)' },
              { key: 'bottom', label: 'Lề dưới (mm)' },
              { key: 'left', label: 'Lề trái (mm)' },
            ] as const
          ).map((item) => (
            <div key={item.key}>
              <label
                htmlFor={`margin-${item.key}`}
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                {item.label}
              </label>
              <input
                id={`margin-${item.key}`}
                type="number"
                min={5}
                max={40}
                value={draft.marginsMm[item.key]}
                onChange={(e) => updateMargin(item.key, e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
              />
            </div>
          ))}
        </div>

        {marginError && (
          <p className="text-xs font-medium text-red-700 dark:text-red-400" role="alert">
            {marginError}
          </p>
        )}

        {/* Header metadata & Teacher answer key option */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-slate-100 dark:border-slate-800 pt-4">
          <div>
            <label htmlFor="school-header" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Tiêu đề trường / tổ chuyên môn (tùy chọn khi in)
            </label>
            <input
              id="school-header"
              type="text"
              value={draft.schoolHeader}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, schoolHeader: e.target.value }))
              }
              placeholder="Ví dụ: TRƯỜNG THCS NGUYỄN DU — TỔ TOÁN - TIN"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="teacher-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Tên giáo viên soạn (tùy chọn)
            </label>
            <input
              id="teacher-name"
              type="text"
              value={draft.teacherName}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, teacherName: e.target.value }))
              }
              placeholder="Ví dụ: Cô Nguyễn Minh Anh"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.includeTeacherAnswerKey}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                includeTeacherAnswerKey: e.target.checked,
              }))
            }
            className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-900 focus:ring-blue-700"
          />
          <span>Bao gồm trang Hướng dẫn &amp; Đáp án giáo viên khi in &ldquo;Trọn bộ tài liệu&rdquo;</span>
        </label>

        <div className="flex justify-end border-t border-slate-100 dark:border-slate-800 pt-4">
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-900 dark:bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 dark:hover:bg-blue-600 whitespace-nowrap"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            <span>Lưu cài đặt in</span>
          </button>
        </div>
      </section>

      {/* Section 2: Sao lưu & Khôi phục JSON */}
      <section
        aria-labelledby="backup-heading"
        className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5"
      >
        <div>
          <h2 id="backup-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Sao lưu &amp; Khôi phục dữ liệu (JSON)
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
            Xuất toàn bộ <span className="font-mono-num font-medium">{packs.length}</span> bộ tiết dạy, tài nguyên Resource Vault (bao gồm metadata &amp; mã SHA-256 tệp đính kèm) và cấu hình in ra tệp JSON. Khi khôi phục, hệ thống kiểm tra cấu trúc (schema) chặt chẽ, tự dọn bản ghi tệp không còn liên kết và luôn hỏi xác nhận trước khi thay dữ liệu hiện tại. Các tệp đính kèm nhị phân lớn lưu trong OPFS/IndexedDB vẫn được giữ nguyên bản trên thiết bị.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>Tải bản sao lưu JSON</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            className="sr-only"
            aria-label="Chọn tệp sao lưu JSON để khôi phục"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:hover:bg-blue-600 whitespace-nowrap"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Khôi phục từ tệp JSON</span>
          </button>
        </div>

        {importErrors.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 p-4 text-xs text-red-900 dark:text-red-200 space-y-1.5"
          >
            <p className="font-semibold">
              Tệp sao lưu không hợp lệ — chưa có dữ liệu nào bị thay đổi:
            </p>
            <ul className="list-disc pl-5 space-y-0.5">
              {importErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Section 2B: Điểm khôi phục cục bộ (Snapshot & Rollback) */}
      <section
        aria-labelledby="snapshot-heading"
        className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <History className="h-5 w-5 text-blue-900 dark:text-blue-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <h2 id="snapshot-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Điểm khôi phục cục bộ (Migration Snapshot &amp; Rollback)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              TeacherOS 4.0 tự động tạo một bản chụp dữ liệu an toàn trong IndexedDB trước khi nâng cấp. Bạn cũng có thể cập nhật điểm khôi phục thủ công hoặc quay lui (Rollback) về bản chụp này bất kỳ lúc nào.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3.5 text-xs space-y-1">
          {snapshotSummary.exists ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {snapshotSummary.label}
                </span>
                <span className="font-mono-num text-slate-600 dark:text-slate-300">
                  {snapshotSummary.packCount} bộ tiết dạy
                </span>
              </div>
              <p className="text-slate-500 dark:text-slate-400 font-mono-num">
                Thời điểm lưu:{' '}
                {snapshotSummary.createdAt
                  ? new Date(snapshotSummary.createdAt).toLocaleString('vi-VN')
                  : 'Vừa khởi tạo'}
              </p>
            </>
          ) : (
            <p className="text-slate-600 dark:text-slate-300">
              Chưa có bản chụp cục bộ. Bấm &ldquo;Tạo điểm khôi phục mới&rdquo; để lưu trạng thái hiện tại.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void onCreateSnapshot()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tạo điểm khôi phục mới</span>
          </button>

          {snapshotSummary.exists && (
            <button
              type="button"
              onClick={() => setConfirmRollback(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 px-3.5 py-2 text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60 whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Khôi phục về bản chụp này (Rollback)</span>
            </button>
          )}
        </div>
      </section>

      {/* Section 3: Dung lượng bộ nhớ trình duyệt & Cơ chế ngoại tuyến */}
      <section
        aria-labelledby="privacy-heading"
        className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <HardDrive className="h-5 w-5 text-slate-700 dark:text-slate-300 shrink-0" aria-hidden="true" />
            <h2 id="privacy-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Bộ nhớ IndexedDB cục bộ &amp; Hoạt động ngoại tuyến
            </h2>
          </div>

          {storageEstimate?.supported && (
            <span className="font-mono-num text-xs text-slate-600 dark:text-slate-300">
              Đã dùng {formatBytes(storageEstimate.usageBytes)} /{' '}
              {formatBytes(storageEstimate.quotaBytes)} ({storageEstimate.usagePercent}%)
            </span>
          )}
        </div>

        <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          <li>
            Mọi bộ tiết dạy, câu hỏi, rubric, đề Toán, sơ đồ Canvas và cài đặt in được lưu trực tiếp trong cơ sở dữ liệu{' '}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">IndexedDB (TeacherOS2DB v6) &amp; OPFS</strong> trên trình duyệt của thiết bị này, không mất dữ liệu khi tải lại trang.
          </li>
          <li>
            Mặc định ứng dụng hoạt động hoàn toàn cục bộ (Local-First), không tự động tải dữ liệu lên máy chủ ngoài và không sử dụng AI API. Kết nối Supabase Free / Cloudflare Workers Free là tùy chọn chủ động và tách biệt hoàn toàn với dữ liệu IndexedDB trên máy.
          </li>
          <li>
            Sau khi đã tải trang web ở lần mở đầu tiên và lưu dữ liệu trên máy, giáo viên có thể tiếp tục soạn bài và in PDF ngay cả khi mất kết nối Internet.
          </li>
        </ul>
      </section>

      {/* Section 4: Trung tâm Trợ giúp & Hướng dẫn tương tác (TeacherOS Academy) */}
      {tutorial && (() => {
        const availableTutorials = TUTORIAL_REGISTRY.map((def) => ({
          def,
          steps: getActiveTutorialSteps(def, APP_REGISTRY),
          progress: tutorial.persistence.tutorials[def.tutorialId],
          appMeta: APP_REGISTRY.find((a) => a.id === def.applicationId),
        }));
        const completedCount = availableTutorials.filter(
          (item) => item.progress?.completed
        ).length;
        const progressPercent =
          availableTutorials.length > 0
            ? Math.round((completedCount / availableTutorials.length) * 100)
            : 0;

        return (
          <section
            aria-labelledby="academy-help-heading"
            data-testid="settings-academy-center"
            className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <GraduationCap
                  className="h-5 w-5 text-blue-900 dark:text-blue-400 mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <div>
                  <h2
                    id="academy-help-heading"
                    className="text-base font-semibold text-slate-900 dark:text-slate-100"
                  >
                    TeacherOS Academy — Trung tâm Trợ giúp &amp; Hướng dẫn sử dụng
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    Chọn bất kỳ bài hướng dẫn nào để thực hành từng bước trực tiếp trên giao diện thật của từng công cụ.
                  </p>
                </div>
              </div>

              <span className="font-mono-num text-xs font-semibold text-blue-900 dark:text-blue-300 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-1 rounded whitespace-nowrap shrink-0">
                {completedCount}/{availableTutorials.length} hoàn thành ({progressPercent}%)
              </span>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full bg-blue-900 dark:bg-blue-600 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Tutorial Modules Grid */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {availableTutorials.map(({ def, steps, progress, appMeta }) => {
                const isPaused =
                  tutorial.persistence.pausedTutorialId === def.tutorialId &&
                  progress &&
                  !progress.completed &&
                  progress.currentStepIndex > 0;
                const isCompleted = Boolean(progress?.completed);

                return (
                  <div
                    key={def.tutorialId}
                    data-testid={`settings-tutorial-card-${def.tutorialId}`}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-blue-900 dark:text-blue-300">
                          {appMeta?.name ?? def.applicationId}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-medium whitespace-nowrap ${
                            isCompleted
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : isPaused
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {isCompleted ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Đã hoàn thành</span>
                            </>
                          ) : isPaused ? (
                            <>
                              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                              <span className="font-mono-num">
                                Bước {(progress?.currentStepIndex ?? 0) + 1}/{steps.length}
                              </span>
                            </>
                          ) : (
                            <span className="font-mono-num">
                              {steps.length} bước · ~{def.estimatedMinutes}p
                            </span>
                          )}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                        {def.title}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {def.subtitle}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() =>
                          tutorial.startTutorial(def.tutorialId, {
                            restart: !isPaused,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-900 dark:bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 dark:hover:bg-blue-600 whitespace-nowrap"
                      >
                        {isCompleted ? (
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>
                          {isPaused
                            ? `Tiếp tục (Bước ${(progress?.currentStepIndex ?? 0) + 1})`
                            : isCompleted
                            ? 'Xem lại'
                            : 'Bắt đầu'}
                        </span>
                      </button>

                      {isPaused && (
                        <button
                          type="button"
                          onClick={() =>
                            tutorial.startTutorial(def.tutorialId, { restart: true })
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" />
                          <span>Từ đầu</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Welcome Preferences & Reset */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-4 space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={tutorial.persistence.autoShowEnabled}
                  onChange={(e) => {
                    setAcademyResetDone(false);
                    tutorial.toggleAutoShowWelcome(e.target.checked);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-900 focus:ring-blue-700"
                />
                <span>
                  Tự động hiển thị cửa sổ chào mừng khi truy cập lần đầu trên trình duyệt mới
                </span>
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {academyResetDone
                    ? 'Đã đặt lại toàn bộ tiến độ hướng dẫn về trạng thái ban đầu.'
                    : 'Đặt lại tiến độ nếu muốn trải nghiệm lại toàn bộ hướng dẫn như lần đầu.'}
                </span>
                <button
                  type="button"
                  data-testid="settings-reset-tutorials-btn"
                  onClick={() => {
                    tutorial.resetAllTutorials();
                    setAcademyResetDone(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Đặt lại tiến độ hướng dẫn</span>
                </button>
              </div>
            </div>

            {/* Quick Keyboard Shortcuts Guide */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <Keyboard className="h-4 w-4 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                <span>Phím tắt thao tác nhanh trên máy tính</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
                <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-300">Tìm kiếm nhanh</span>
                  <kbd className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                    Ctrl / Cmd + K
                  </kbd>
                </div>
                <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-300">Chuyển ứng dụng</span>
                  <kbd className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                    Alt + 1..8, 0
                  </kbd>
                </div>
                <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-300">Tạm dừng hướng dẫn</span>
                  <kbd className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                    Esc
                  </kbd>
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      <ConfirmDialog
        open={Boolean(pendingRestore)}
        title="Xác nhận khôi phục dữ liệu từ bản sao lưu"
        description={
          pendingRestore
            ? `Tệp sao lưu hợp lệ (xuất lúc ${new Date(pendingRestore.exportedAt).toLocaleString('vi-VN')}) chứa ${pendingRestore.lessonPacks.length} bộ tiết dạy. Thao tác này sẽ thay thế toàn bộ ${packs.length} bộ tiết dạy hiện có trên máy bằng dữ liệu trong bản sao lưu.`
            : ''
        }
        confirmLabel="Thay thế & Khôi phục"
        cancelLabel="Hủy bỏ"
        variant="primary"
        onConfirm={handleConfirmRestore}
        onCancel={() => setPendingRestore(null)}
      />

      <ConfirmDialog
        open={confirmRollback}
        title="Xác nhận quay lui về điểm khôi phục cục bộ (Rollback)"
        description={`Hệ thống sẽ khôi phục toàn bộ dữ liệu về "${snapshotSummary.label}" (${snapshotSummary.packCount} bộ tiết dạy). Hãy tải bản sao lưu JSON trước nếu bạn muốn giữ lại các thay đổi vừa thực hiện.`}
        confirmLabel="Thực hiện Rollback"
        cancelLabel="Hủy"
        variant="primary"
        onConfirm={handleConfirmRollback}
        onCancel={() => setConfirmRollback(false)}
      />
    </main>
  );
}
