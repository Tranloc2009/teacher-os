import { ChangeEvent, useRef } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FilePlus2,
  FileText,
  Layers,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  BankQuestionRecord,
  GeneratedExamDraft,
  GeneratorBackupBundle,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import { evaluateBankQuestionVariantSafety } from '../../core/examGenerator/verifiedVariantEngine';

interface GeneratorDashboardPanelProps {
  unifiedBank: BankQuestionRecord[];
  templates: QuestionTemplateDefinition[];
  drafts: GeneratedExamDraft[];
  onStartWizard: () => void;
  onOpenBank: () => void;
  onOpenTemplateBuilder: () => void;
  onOpenDraft: (draft: GeneratedExamDraft) => void;
  onDeleteDraft: (draftId: string) => void;
  onSendDraftToMixer: (draft: GeneratedExamDraft) => void;
  onExportBackup: () => void;
  onImportBackup: (bundle: GeneratorBackupBundle) => void;
  onNotify: (tone: 'success' | 'info' | 'error', text: string) => void;
}

export function GeneratorDashboardPanel({
  unifiedBank,
  templates,
  drafts,
  onStartWizard,
  onOpenBank,
  onOpenTemplateBuilder,
  onOpenDraft,
  onDeleteDraft,
  onSendDraftToMixer,
  onExportBackup,
  onImportBackup,
  onNotify,
}: GeneratorDashboardPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const templateById = new Map(templates.map((t) => [t.id, t]));

  const statusCounts = {
    variantReady: 0,
    original: 0,
    reviewRequired: 0,
    blockedOrUnsupported: 0,
  };

  for (const item of unifiedBank) {
    const safety = evaluateBankQuestionVariantSafety(
      item,
      item.templateId ? templateById.get(item.templateId) : undefined
    );
    if (safety.status === 'VARIANT_READY') statusCounts.variantReady += 1;
    else if (safety.status === 'ORIGINAL') statusCounts.original += 1;
    else if (safety.status === 'REVIEW_REQUIRED') statusCounts.reviewRequired += 1;
    else statusCounts.blockedOrUnsupported += 1;
  }

  const verifiedTemplatesCount = templates.filter((t) => t.verifiedTemplate).length;

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as GeneratorBackupBundle;
      if (
        !parsed ||
        parsed.version !== 'smart-exam-generator-2.0-phase1' ||
        !Array.isArray(parsed.bankQuestions) ||
        !Array.isArray(parsed.templates)
      ) {
        onNotify(
          'error',
          'Tệp JSON không đúng định dạng sao lưu Smart Exam Generator 2.0.'
        );
        return;
      }
      onImportBackup(parsed);
    } catch {
      onNotify('error', 'Không thể đọc tệp sao lưu JSON. Vui lòng kiểm tra lại tệp.');
    }
  };

  return (
    <div className="space-y-6">
      {/* 4 Core Aurora Bento Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Primary Action — Tạo đề mới */}
        <div className="rounded-2xl border border-[#635BFF]/25 bg-gradient-to-br from-[#635BFF] via-[#5850EC] to-[#4338CA] p-5 text-white shadow-md flex flex-col justify-between">
          <div className="space-y-2">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
              <FilePlus2 className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-bold tracking-tight">Tạo đề mới (Wizard 5 bước)</h2>
            <p className="text-xs text-indigo-100 leading-relaxed">
              Lấy câu từ ngân hàng hoặc sinh biến thể đổi số có kiểm chứng thế ngược độc lập, rồi chuyển thẳng sang Exam Mixer Pro.
            </p>
          </div>
          <button
            type="button"
            onClick={onStartWizard}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#4338CA] shadow-sm hover:bg-indigo-50 transition-colors focus-visible:outline-2 focus-visible:outline-white"
          >
            <span>Bắt đầu tạo đề</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Card 2: Ngân hàng câu hỏi */}
        <div className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
                <Database className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className="font-mono-num text-2xl font-bold text-[#172033] dark:text-slate-100">
                {unifiedBank.length}
              </span>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
                Ngân hàng câu hỏi
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Gộp ngân hàng cục bộ &amp; câu hỏi hiện có từ Exam Mixer Pro (chỉ đọc gốc).
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] pt-1">
              <div className="rounded-lg bg-emerald-50/80 dark:bg-emerald-950/40 px-2.5 py-1.5 text-emerald-800 dark:text-emerald-300 font-medium">
                Sẵn sàng đổi số: <span className="font-mono-num font-bold">{statusCounts.variantReady}</span>
              </div>
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-slate-700 dark:text-slate-300 font-medium">
                Câu gốc: <span className="font-mono-num font-bold">{statusCounts.original}</span>
              </div>
              <div className="rounded-lg bg-amber-50/90 dark:bg-amber-950/40 px-2.5 py-1.5 text-amber-800 dark:text-amber-300 font-medium">
                Cần duyệt: <span className="font-mono-num font-bold">{statusCounts.reviewRequired}</span>
              </div>
              <div className="rounded-lg bg-rose-50/80 dark:bg-rose-950/40 px-2.5 py-1.5 text-rose-800 dark:text-rose-300 font-medium">
                Khóa/Chặn: <span className="font-mono-num font-bold">{statusCounts.blockedOrUnsupported}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenBank}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <span>Quản lý ngân hàng</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Card 3: Mẫu đổi số (Verified Templates) */}
        <div className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400">
                <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className="font-mono-num text-2xl font-bold text-[#172033] dark:text-slate-100">
                {verifiedTemplatesCount}
              </span>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
                Mẫu đổi số kiểm chứng
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                7 nhóm mẫu Level 1 (PT bậc nhất, biểu thức, đa thức, %, tỉ lệ thức, CSC, v = s/t) — kiểm chứng thế ngược, không dùng eval.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>100% cục bộ · Seed tái lập · 4 phương án phân biệt</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenTemplateBuilder}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <span>Mở trình tạo mẫu đổi số</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Card 4: Đề đã tạo & Sao lưu cục bộ */}
        <div className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <Layers className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className="font-mono-num text-2xl font-bold text-[#172033] dark:text-slate-100">
                {drafts.length}
              </span>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
                Đề đã tạo &amp; Sao lưu
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Lưu tự động trong IndexedDB cục bộ (bảng v8 cộng thêm). Có thể sao lưu &amp; khôi phục JSON bất cứ lúc nào.
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={onExportBackup}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sao lưu JSON</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Khôi phục</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={(e) => void handleImportFile(e)}
              className="hidden"
              aria-label="Chọn tệp sao lưu JSON Smart Exam Generator"
            />
          </div>
        </div>
      </div>

      {/* Recent Generated Exams List */}
      <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3.5">
          <div>
            <h3 className="text-base font-bold text-[#172033] dark:text-slate-100">
              Danh sách đề đã tạo gần đây
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Mở lại để duyệt đáp án, sinh lại biến thể câu đơn lẻ hoặc chuyển thẳng sang Exam Mixer Pro.
            </p>
          </div>
          <button
            type="button"
            onClick={onStartWizard}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#5248f0] transition-colors"
          >
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tạo bộ đề mới</span>
          </button>
        </div>

        {drafts.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <FileText className="h-9 w-9 mx-auto text-slate-300 dark:text-slate-700" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Chưa có đề kiểm tra nào được tạo trong Smart Exam Generator.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nhấn &ldquo;Bắt đầu tạo đề&rdquo; để khởi chạy quy trình 5 bước có kiểm chứng toán học.
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-[#172033] dark:text-slate-100 truncate">
                      {draft.title}
                    </span>
                    <span className="rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                      {draft.mode === 'bank-only'
                        ? 'Ngân hàng gốc'
                        : draft.mode === 'verified-variants'
                        ? 'Biến thể kiểm chứng'
                        : 'Kết hợp Hybrid'}
                    </span>
                    {draft.allAnswersConfirmed ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Đã xác nhận đáp án
                      </span>
                    ) : (
                      <span className="rounded-md bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                        Chờ giáo viên xác nhận
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {draft.subjectName} · {draft.grade} · {draft.items.length} câu ({draft.report.variantCount} biến thể, {draft.report.originalCount} câu gốc) · {draft.totalPoints} điểm · Seed: <span className="font-mono-num">{draft.seed}</span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenDraft(draft)}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Xem &amp; Duyệt
                  </button>
                  <button
                    type="button"
                    onClick={() => onSendDraftToMixer(draft)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 px-3 py-1.5 text-xs font-semibold text-[#4F46E5] dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/70"
                  >
                    <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Chuyển Exam Mixer</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteDraft(draft.id)}
                    aria-label={`Xóa đề ${draft.title}`}
                    className="rounded-xl border border-rose-200 dark:border-rose-900/70 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
