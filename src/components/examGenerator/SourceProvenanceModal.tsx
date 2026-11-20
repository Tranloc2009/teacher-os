import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  Hash,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { ResourceItem } from '../../types/lesson';
import type { QuestionSourceProvenance } from '../../types/resourceIntelligence';
import { readResourceAttachmentBlob } from '../../db/database';
import { formatBytes } from '../../core/resourceStorage';

interface SourceProvenanceModalProps {
  provenance: QuestionSourceProvenance;
  resource?: ResourceItem;
  onClose: () => void;
  onNotify?: (tone: 'success' | 'info' | 'error', text: string) => void;
}

export function SourceProvenanceModal({
  provenance,
  resource,
  onClose,
  onNotify,
}: SourceProvenanceModalProps) {
  const handleDownloadSourceFile = async () => {
    if (!resource?.sourceFile) return;
    try {
      const blob = await readResourceAttachmentBlob(resource);
      if (!blob) {
        onNotify?.(
          'info',
          `Tài liệu "${provenance.fileName}" hiện lưu dưới dạng nội dung văn bản trong Resource Vault (chưa có tệp nhị phân đính kèm).`
        );
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resource.sourceFile.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      onNotify?.('error', `Không thể mở tệp gốc "${provenance.fileName}".`);
    }
  };

  const fullText = resource?.content?.trim() ?? '';
  const excerpt = provenance.sourceExcerpt?.trim() ?? '';
  const matchIdx =
    fullText && excerpt
      ? fullText.toLowerCase().indexOf(excerpt.slice(0, 48).toLowerCase())
      : -1;

  const contextSnippet = (() => {
    if (!fullText) return excerpt || 'Không có đoạn trích văn bản khả dụng cho tệp nhị phân này.';
    if (matchIdx < 0) return fullText.slice(0, 1400);
    const rawStart = Math.max(0, matchIdx - 180);
    let start = rawStart;
    if (rawStart > 0) {
      const nextNewline = fullText.indexOf('\n', rawStart);
      if (nextNewline > 0 && nextNewline <= matchIdx) {
        start = nextNewline + 1;
      } else {
        const nextSpace = fullText.indexOf(' ', rawStart);
        if (nextSpace > 0 && nextSpace < matchIdx) {
          start = nextSpace + 1;
        }
      }
    }
    const rawEnd = Math.min(fullText.length, matchIdx + 950);
    let end = rawEnd;
    if (rawEnd < fullText.length) {
      const prevNewline = fullText.lastIndexOf('\n', rawEnd);
      if (prevNewline > matchIdx + 120) {
        end = prevNewline;
      }
    }
    return `${start > 0 ? '...\n' : ''}${fullText.slice(start, end).trim()}${
      end < fullText.length ? '\n...' : ''
    }`;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Xem câu hỏi trong tài liệu gốc Resource Vault"
    >
      <div className="w-full max-w-2xl max-h-[88vh] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#4F46E5] dark:text-indigo-400">
              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Truy xuất nguồn gốc tài liệu (Resource Vault)</span>
            </div>
            <h3 className="text-sm sm:text-base font-bold text-[#172033] dark:text-slate-100 truncate">
              {provenance.resourceTitle}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                {provenance.folderPath || 'Thư mục mặc định'}
              </span>
              <span>Tệp: {provenance.fileName}</span>
              {provenance.sourcePage ? (
                <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                  Trang PDF: {provenance.sourcePage}
                </span>
              ) : (
                <span>Vị trí: {provenance.sourceSection || 'Không có số trang gốc'}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Đóng cửa sổ xem nguồn"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4 text-xs">
          {/* Provenance Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">Định danh & Toàn vẹn</div>
              <div className="font-mono-num text-[11px] text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>Content Hash: {provenance.contentHash.slice(0, 14)}</span>
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                Resource ID: <span className="font-mono-num">{provenance.resourceId}</span>
              </div>
              {resource?.sourceFile?.sizeBytes ? (
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  Kích thước tệp gốc: {formatBytes(resource.sourceFile.sizeBytes)}
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">Trạng thái đáp án & kiểm chứng</div>
              <div className="flex items-center gap-1.5 font-semibold">
                {provenance.answerStatus === 'confirmed' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Có đáp án từ tài liệu nguồn
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                    <span className="text-amber-700 dark:text-amber-400">
                      {provenance.answerStatus === 'missing'
                        ? 'Tài liệu gốc không có đáp án — hệ thống KHÔNG tự đoán'
                        : 'Đáp án chưa được giáo viên xác nhận'}
                    </span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                Kiểm chứng: <span className="font-semibold">{provenance.verificationStatus}</span>
                {provenance.visualAssetCount > 0
                  ? ` · ${provenance.visualAssetCount} hình/bảng đi kèm`
                  : ''}
              </div>
              {provenance.ommlWarning && (
                <div className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Có công thức OMML/MathType — bảo toàn nguyên bản, khóa đổi số tự động.</span>
                </div>
              )}
            </div>
          </div>

          {/* Original Document Excerpt */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-800 dark:text-slate-200">
                Nội dung đoạn tài liệu gốc (chỉ đọc — tuyệt đối không thay đổi tệp gốc)
              </span>
              {provenance.sourcePage && (
                <span className="rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                  Trang {provenance.sourcePage}
                </span>
              )}
            </div>
            <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 text-xs leading-relaxed text-slate-800 dark:text-slate-200 max-h-72 overflow-y-auto font-sans">
              {contextSnippet}
            </pre>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 px-5 py-3 bg-slate-50/70 dark:bg-slate-950/40">
          <div>
            {resource?.sourceFile && resource.sourceFile.storageKind !== 'metadata-only' && (
              <button
                type="button"
                onClick={() => void handleDownloadSourceFile()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tải tệp gốc ({resource.sourceFile.extension.toUpperCase()})</span>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#635BFF] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#5248f0]"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
