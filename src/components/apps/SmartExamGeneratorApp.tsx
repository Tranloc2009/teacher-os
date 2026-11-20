import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react';
import type { MathExamProject } from '../../types/mathExam';
import type {
  BankQuestionRecord,
  GeneratedExamDraft,
  GeneratorBackupBundle,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import {
  deleteGeneratorBankItem,
  deleteGeneratorDraft,
  deleteGeneratorTemplate,
  initializeExamGeneratorStore,
  restoreGeneratorBackupBundle,
  saveGeneratorBankItem,
  saveGeneratorDraft,
  saveGeneratorTemplate,
} from '../../db/database';
import {
  canExportOfficialAnswerKey,
  collectUnifiedQuestionBank,
  convertDraftToMathExamProject,
} from '../../core/examGenerator/examBuilderEngine';
import { generateMixedExams } from '../../core/mathShuffleEngine';
import { PageBanner } from '../ui/DesignSystem';
import { GeneratorDashboardPanel } from '../examGenerator/GeneratorDashboardPanel';
import { ExamGeneratorWizardPanel } from '../examGenerator/ExamGeneratorWizardPanel';
import { QuestionBankManagerPanel } from '../examGenerator/QuestionBankManagerPanel';
import { TemplateBuilderPanel } from '../examGenerator/TemplateBuilderPanel';

type GeneratorTabId = 'dashboard' | 'wizard' | 'bank' | 'templates';

interface SmartExamGeneratorAppProps {
  mathExams: MathExamProject[];
  onSaveMathExam: (exam: MathExamProject, silent?: boolean) => Promise<MathExamProject>;
  onOpenExamMixerWithExam: (examId: string) => void;
  onOpenGradingStudioWithExam: (examId: string) => void;
  onNotify: (tone: 'success' | 'info' | 'error', text: string) => void;
}

const TABS: Array<{ id: GeneratorTabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'wizard', label: 'Tạo đề (5 bước)', icon: Wand2 },
  { id: 'bank', label: 'Ngân hàng câu hỏi', icon: Database },
  { id: 'templates', label: 'Mẫu đổi số (L1–L3)', icon: SlidersHorizontal },
];

export function SmartExamGeneratorApp({
  mathExams,
  onSaveMathExam,
  onOpenExamMixerWithExam,
  onOpenGradingStudioWithExam,
  onNotify,
}: SmartExamGeneratorAppProps) {
  const [activeTab, setActiveTab] = useState<GeneratorTabId>('dashboard');
  const [loading, setLoading] = useState(true);
  const [storedBank, setStoredBank] = useState<BankQuestionRecord[]>([]);
  const [templates, setTemplates] = useState<QuestionTemplateDefinition[]>([]);
  const [drafts, setDrafts] = useState<GeneratedExamDraft[]>([]);

  const [reviewDraft, setReviewDraft] = useState<GeneratedExamDraft | null>(null);
  const [templateBuilderTargetId, setTemplateBuilderTargetId] = useState<string | null>(null);
  const [templateBuilderSourceQ, setTemplateBuilderSourceQ] =
    useState<BankQuestionRecord | null>(null);

  const loadStore = useCallback(async () => {
    setLoading(true);
    try {
      const data = await initializeExamGeneratorStore();
      setStoredBank(data.bank);
      setTemplates(data.templates);
      setDrafts(data.drafts);
    } catch {
      onNotify(
        'error',
        'Không thể tải dữ liệu Smart Exam Generator từ IndexedDB cục bộ.'
      );
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadStore();
  }, [loadStore]);

  const unifiedBank = useMemo(
    () => collectUnifiedQuestionBank(storedBank, mathExams),
    [storedBank, mathExams]
  );

  const handleAddBankQuestion = async (item: BankQuestionRecord) => {
    try {
      const saved = await saveGeneratorBankItem(item);
      setStoredBank((prev) => [saved, ...prev.filter((b) => b.id !== saved.id)]);
      onNotify('success', `Đã thêm câu hỏi ${saved.code} vào ngân hàng cục bộ.`);
    } catch {
      onNotify('error', 'Không thể lưu câu hỏi mới vào IndexedDB.');
    }
  };

  const handleDeleteBankQuestion = async (id: string) => {
    try {
      await deleteGeneratorBankItem(id);
      setStoredBank((prev) => prev.filter((b) => b.id !== id));
      onNotify('success', 'Đã xóa câu hỏi khỏi ngân hàng cục bộ.');
    } catch {
      onNotify('error', 'Không thể xóa câu hỏi khỏi IndexedDB.');
    }
  };

  const handleSaveTemplate = async (tpl: QuestionTemplateDefinition) => {
    try {
      const saved = await saveGeneratorTemplate(tpl);
      setTemplates((prev) => [saved, ...prev.filter((t) => t.id !== saved.id)]);
      if (saved.sourceQuestionId) {
        const bankItem = storedBank.find((b) => b.id === saved.sourceQuestionId);
        if (bankItem && bankItem.templateId !== saved.id) {
          const updatedBank = await saveGeneratorBankItem({
            ...bankItem,
            templateId: saved.id,
          });
          setStoredBank((prev) =>
            prev.map((b) => (b.id === updatedBank.id ? updatedBank : b))
          );
        }
      }
      onNotify('success', `Đã lưu mẫu tham số "${saved.title}" vào IndexedDB cục bộ.`);
    } catch {
      onNotify('error', 'Không thể lưu mẫu tham số.');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteGeneratorTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      onNotify('success', 'Đã xóa mẫu tham số.');
    } catch {
      onNotify('error', 'Không thể xóa mẫu tham số.');
    }
  };

  const handleSaveDrafts = async (newDrafts: GeneratedExamDraft[]) => {
    try {
      const savedList: GeneratedExamDraft[] = [];
      for (const d of newDrafts) {
        savedList.push(await saveGeneratorDraft(d));
      }
      setDrafts((prev) => {
        const ids = new Set(savedList.map((s) => s.id));
        return [...savedList, ...prev.filter((p) => !ids.has(p.id))].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        );
      });
    } catch {
      onNotify('error', 'Không thể lưu đề nháp vào IndexedDB.');
    }
  };

  const handleUpdateDraft = async (draft: GeneratedExamDraft) => {
    try {
      const saved = await saveGeneratorDraft(draft);
      setDrafts((prev) =>
        [saved, ...prev.filter((d) => d.id !== saved.id)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        )
      );
    } catch {
      onNotify('error', 'Không thể cập nhật đề nháp.');
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    try {
      await deleteGeneratorDraft(draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      onNotify('success', 'Đã xóa đề tạo tự động.');
    } catch {
      onNotify('error', 'Không thể xóa đề tạo tự động.');
    }
  };

  const handleSendToExamMixer = async (draft: GeneratedExamDraft) => {
    try {
      const project = convertDraftToMathExamProject(draft, {
        examId: draft.exportedExamProjectId,
        examCount: 4,
        startCodeNumber: 101,
      });
      const savedProject = await onSaveMathExam(project, true);
      await handleUpdateDraft({
        ...draft,
        status: 'exported',
        exportedExamProjectId: savedProject.id,
      });
      onNotify(
        'success',
        `Đã chuyển "${savedProject.title}" (${savedProject.questions.length} câu) sang Exam Mixer Pro.`
      );
      onOpenExamMixerWithExam(savedProject.id);
    } catch {
      onNotify('error', 'Không thể chuyển đề sang Exam Mixer Pro.');
    }
  };

  const handleMixAndSendToGrading = async (draft: GeneratedExamDraft) => {
    const gate = canExportOfficialAnswerKey(draft);
    if (!gate.allowed) {
      onNotify('error', gate.reason ?? 'Cần xác nhận toàn bộ đáp án trước khi chấm OMR.');
      return;
    }
    try {
      const project = convertDraftToMathExamProject(draft, {
        examId: draft.exportedExamProjectId,
        examCount: 4,
        startCodeNumber: 101,
      });
      const mixed = generateMixedExams(project);
      if (mixed.errors.length > 0 || mixed.versions.length === 0) {
        onNotify(
          'error',
          `Exam Mixer báo lỗi kiểm chứng: ${mixed.errors[0] ?? 'Không tạo được mã đề.'}`
        );
        return;
      }
      project.generatedVersions = mixed.versions;
      project.status = 'ready';
      const savedProject = await onSaveMathExam(project, true);
      await handleUpdateDraft({
        ...draft,
        status: 'exported',
        exportedExamProjectId: savedProject.id,
      });
      onNotify(
        'success',
        `Đã sinh ${mixed.versions.length} mã đề (101–${100 + mixed.versions.length}) với đáp án biến thể chính xác và mở Smart Grading Studio.`
      );
      onOpenGradingStudioWithExam(savedProject.id);
    } catch {
      onNotify('error', 'Không thể tạo mã đề để chuyển sang Smart Grading Studio.');
    }
  };

  const handleExportBackup = () => {
    const bundle: GeneratorBackupBundle = {
      version: 'smart-exam-generator-2.0-phase1',
      exportedAt: new Date().toISOString(),
      bankQuestions: storedBank,
      templates,
      drafts,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `teacheros-exam-generator-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify('success', 'Đã tải tệp sao lưu JSON Smart Exam Generator 2.0.');
  };

  const handleImportBackup = async (bundle: GeneratorBackupBundle) => {
    try {
      const restored = await restoreGeneratorBackupBundle(bundle);
      setStoredBank(restored.bank);
      setTemplates(restored.templates);
      setDrafts(restored.drafts);
      onNotify(
        'success',
        `Đã khôi phục ${restored.bank.length} câu hỏi, ${restored.templates.length} mẫu đổi số và ${restored.drafts.length} đề đã tạo.`
      );
    } catch {
      onNotify('error', 'Khôi phục dữ liệu Smart Exam Generator thất bại.');
    }
  };

  return (
    <main className="mx-auto max-w-[1440px] px-4 sm:px-6 py-5 space-y-5">
      <PageBanner
        title="Smart Exam Generator 3.0"
        subtitle="Tạo đề tự động, sinh biến thể đổi số & đồ thị hàm số SVG + bảng biến thiên đồng bộ kiểm chứng độc lập (100% cục bộ · Không dùng AI API · Tích hợp Exam Mixer Pro & OMR)."
        icon={<Wand2 className="h-5 w-5" aria-hidden="true" />}
        actions={
          <div className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/90 dark:bg-emerald-950/60 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Verified Generation Only · Local-First</span>
          </div>
        }
      />

      {/* Module Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Phân khu Smart Exam Generator 2.0"
        className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 dark:border-slate-800 pb-3"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (t.id === 'wizard') {
                  setReviewDraft(null);
                }
                setActiveTab(t.id);
              }}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-all ${
                active
                  ? 'bg-[#635BFF] text-white shadow-sm'
                  : 'bg-white/90 dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-[#EEF0FF] dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500">
          Đang nạp ngân hàng câu hỏi và mẫu đổi số từ IndexedDB cục bộ...
        </div>
      ) : (
        <>
          {activeTab === 'dashboard' && (
            <GeneratorDashboardPanel
              unifiedBank={unifiedBank}
              templates={templates}
              drafts={drafts}
              onStartWizard={() => {
                setReviewDraft(null);
                setActiveTab('wizard');
              }}
              onOpenBank={() => setActiveTab('bank')}
              onOpenTemplateBuilder={() => {
                setTemplateBuilderTargetId(null);
                setTemplateBuilderSourceQ(null);
                setActiveTab('templates');
              }}
              onOpenDraft={(draft) => {
                setReviewDraft(draft);
                setActiveTab('wizard');
              }}
              onDeleteDraft={(id) => void handleDeleteDraft(id)}
              onSendDraftToMixer={(d) => void handleSendToExamMixer(d)}
              onExportBackup={handleExportBackup}
              onImportBackup={(b) => void handleImportBackup(b)}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'wizard' && (
            <ExamGeneratorWizardPanel
              unifiedBank={unifiedBank}
              templates={templates}
              initialDraftToReview={reviewDraft}
              onSaveDrafts={(list) => void handleSaveDrafts(list)}
              onUpdateDraft={(d) => void handleUpdateDraft(d)}
              onSendToExamMixer={(d) => void handleSendToExamMixer(d)}
              onMixAndSendToGrading={(d) => void handleMixAndSendToGrading(d)}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'bank' && (
            <QuestionBankManagerPanel
              unifiedBank={unifiedBank}
              templates={templates}
              onAddBankQuestion={(item) => void handleAddBankQuestion(item)}
              onDeleteBankQuestion={(id) => void handleDeleteBankQuestion(id)}
              onCreateTemplateFromQuestion={(item) => {
                setTemplateBuilderTargetId(item.templateId ?? null);
                setTemplateBuilderSourceQ(item);
                setActiveTab('templates');
              }}
            />
          )}

          {activeTab === 'templates' && (
            <TemplateBuilderPanel
              templates={templates}
              unifiedBank={unifiedBank}
              initialTemplateId={templateBuilderTargetId}
              initialSourceQuestion={templateBuilderSourceQ}
              onSaveTemplate={(tpl) => void handleSaveTemplate(tpl)}
              onDeleteTemplate={(id) => void handleDeleteTemplate(id)}
              onAddVariantToBank={(item) => void handleAddBankQuestion(item)}
              onGoToWizard={() => {
                setReviewDraft(null);
                setActiveTab('wizard');
              }}
              onNotify={onNotify}
            />
          )}
        </>
      )}
    </main>
  );
}
