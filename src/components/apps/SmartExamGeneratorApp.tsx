import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Database,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { ResourceItem } from '../../types/lesson';
import type { MathExamProject } from '../../types/mathExam';
import type {
  BankQuestionRecord,
  GeneratedExamDraft,
  GeneratorBackupBundle,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import type { ResourceQuestionIndexSummary } from '../../types/resourceIntelligence';
import {
  bulkSaveGeneratorBankItems,
  deleteGeneratorBankItem,
  deleteGeneratorDraft,
  deleteGeneratorTemplate,
  initializeExamGeneratorStore,
  readResourceAttachmentBlob,
  restoreGeneratorBackupBundle,
  saveGeneratorBankItem,
  saveGeneratorDraft,
  saveGeneratorTemplate,
} from '../../db/database';
import {
  canExportOfficialAnswerKey,
  collectUnifiedQuestionBank,
  convertDraftToMathExamProject,
  verifyDraftDynamicGraphBindings,
} from '../../core/examGenerator/examBuilderEngine';
import {
  extractQuestionsFromResourceItem,
  reconcileResourceBankIndex,
} from '../../core/examGenerator/resourceQuestionIndexer';
import { generateMixedExams } from '../../core/mathShuffleEngine';
import { PageBanner } from '../ui/DesignSystem';
import { GeneratorDashboardPanel } from '../examGenerator/GeneratorDashboardPanel';
import { ExamGeneratorWizardPanel } from '../examGenerator/ExamGeneratorWizardPanel';
import { NaturalLanguageExamPanel } from '../examGenerator/NaturalLanguageExamPanel';
import { QuestionBankManagerPanel } from '../examGenerator/QuestionBankManagerPanel';
import { TemplateBuilderPanel } from '../examGenerator/TemplateBuilderPanel';

import { findExistingExamForDraft } from '../../core/connectedWorkflowEngine';

export type GeneratorTabId = 'dashboard' | 'natural-language' | 'wizard' | 'bank' | 'templates';

interface SmartExamGeneratorAppProps {
  homeTarget?: { draft?: GeneratedExamDraft } | null;
  mathExams: MathExamProject[];
  resources?: ResourceItem[];
  preferredResourceId?: string | null;
  preferredTab?: GeneratorTabId | null;
  preferredPrompt?: string | null;
  preferredTopicFilter?: string | null;
  preferredAction?: 'create' | 'index-to-bank' | null;
  onClearPreferredResource?: () => void;
  onSyncWorkflowDraft?: (draft: GeneratedExamDraft) => void;
  onDraftsChanged?: (drafts: GeneratedExamDraft[]) => void;
  onOpenResourceVault?: () => void;
  onSaveMathExam: (exam: MathExamProject, silent?: boolean) => Promise<MathExamProject>;
  onOpenExamMixerWithExam: (examId: string) => void;
  onOpenGradingStudioWithExam: (examId: string) => void;
  onNotify: (tone: 'success' | 'info' | 'error', text: string) => void;
}

const TABS: Array<{ id: GeneratorTabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'natural-language', label: 'Tạo đề từ yêu cầu', icon: Sparkles },
  { id: 'wizard', label: 'Tạo đề (5 bước)', icon: Wand2 },
  { id: 'bank', label: 'Ngân hàng câu hỏi', icon: Database },
  { id: 'templates', label: 'Mẫu câu hỏi', icon: SlidersHorizontal },
];

export function SmartExamGeneratorApp({
  homeTarget,
  mathExams,
  resources = [],
  preferredResourceId,
  preferredTab,
  preferredPrompt,
  preferredTopicFilter,
  preferredAction,
  onClearPreferredResource,
  onSyncWorkflowDraft,
  onDraftsChanged,
  onOpenResourceVault,
  onSaveMathExam,
  onOpenExamMixerWithExam,
  onOpenGradingStudioWithExam,
  onNotify,
}: SmartExamGeneratorAppProps) {
  const [activeTab, setActiveTab] = useState<GeneratorTabId>(
    preferredTab ?? (preferredResourceId || preferredPrompt ? 'natural-language' : 'dashboard')
  );
  const [loading, setLoading] = useState(true);
  const [storedBank, setStoredBank] = useState<BankQuestionRecord[]>([]);
  const [templates, setTemplates] = useState<QuestionTemplateDefinition[]>([]);
  const [drafts, setDrafts] = useState<GeneratedExamDraft[]>([]);

  const [reviewDraft, setReviewDraft] = useState<GeneratedExamDraft | null>(null);
  const [wizardSession, setWizardSession] = useState(0);
  useEffect(() => {
    if (!homeTarget) return;
    setReviewDraft(homeTarget.draft ?? null);
    setWizardSession((previous) => previous + 1);
    setActiveTab('wizard');
  }, [homeTarget]);
  const [templateBuilderTargetId, setTemplateBuilderTargetId] = useState<string | null>(null);
  const [templateBuilderSourceQ, setTemplateBuilderSourceQ] =
    useState<BankQuestionRecord | null>(null);
  const inFlightExportDraftIdsRef = useRef<Set<string>>(new Set());
  const autoIndexedResourceRef = useRef<string | null>(null);

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

  useEffect(() => {
    onDraftsChanged?.(drafts);
  }, [drafts, onDraftsChanged]);

  const missingPreferredResource = useMemo(
    () =>
      Boolean(
        preferredResourceId &&
          !resources.some((r) => r.id === preferredResourceId)
      ),
    [preferredResourceId, resources]
  );

  useEffect(() => {
    if (preferredAction === 'index-to-bank' && preferredResourceId) {
      setActiveTab('bank');
    } else if (preferredTab) {
      setActiveTab(preferredTab);
    } else if (preferredResourceId || preferredPrompt) {
      setActiveTab('natural-language');
    } else if (preferredTopicFilter) {
      setActiveTab('bank');
    }
  }, [preferredAction, preferredTab, preferredResourceId, preferredPrompt, preferredTopicFilter]);

  const unifiedBank = useMemo(
    () => collectUnifiedQuestionBank(storedBank, mathExams),
    [storedBank, mathExams]
  );

  const handleIndexResources = useCallback(
    async (
      resourceIds: string[]
    ): Promise<{
      summaries: ResourceQuestionIndexSummary[];
      updatedUnifiedBank: BankQuestionRecord[];
    }> => {
      const summaries: ResourceQuestionIndexSummary[] = [];
      let workingBank = [...storedBank];
      const allToPersist: BankQuestionRecord[] = [];

      for (const resId of resourceIds) {
        const res = resources.find((r) => r.id === resId);
        if (!res) continue;
        let blob: Blob | null = null;
        if (res.sourceFile && res.sourceFile.storageKind !== 'metadata-only') {
          try {
            blob = await readResourceAttachmentBlob(res);
          } catch {
            blob = null;
          }
        }
        const outcome = await extractQuestionsFromResourceItem(res, { blob });
        const reconciled = reconcileResourceBankIndex(workingBank, outcome.items, res.id);
        workingBank = reconciled.mergedBank;
        allToPersist.push(...reconciled.toPersist);
        summaries.push({
          ...outcome.summary,
          addedCount: reconciled.addedCount,
          updatedCount: reconciled.updatedCount,
          skippedDuplicateCount:
            outcome.summary.skippedDuplicateCount + reconciled.skippedDuplicateCount,
          preservedTeacherEditedCount: reconciled.preservedTeacherEditedCount,
        });
      }

      if (allToPersist.length > 0) {
        await bulkSaveGeneratorBankItems(allToPersist);
      }
      setStoredBank(workingBank);
      const updatedUnifiedBank = collectUnifiedQuestionBank(workingBank, mathExams);

      const totalExtracted = summaries.reduce((acc, s) => acc + s.extractedCount, 0);
      const totalAdded = summaries.reduce((acc, s) => acc + s.addedCount, 0);
      if (totalExtracted > 0) {
        onNotify(
          'success',
          `Đã lập chỉ mục ${totalExtracted} câu hỏi từ ${summaries.length} tài liệu Resource Vault (${totalAdded} câu mới được lưu vào Ngân hàng hợp nhất).`
        );
      } else {
        onNotify(
          'info',
          `Đã quét ${summaries.length} tài liệu nhưng chưa tìm thấy câu hỏi có cấu trúc chuẩn để lập chỉ mục.`
        );
      }
      return { summaries, updatedUnifiedBank };
    },
    [resources, storedBank, mathExams, onNotify]
  );

  // Tự động lập chỉ mục tài liệu nguồn khi điều hướng từ Resource Vault ("Thêm câu vào ngân hàng")
  useEffect(() => {
    if (
      loading ||
      preferredAction !== 'index-to-bank' ||
      !preferredResourceId ||
      missingPreferredResource ||
      autoIndexedResourceRef.current === preferredResourceId
    ) {
      return;
    }
    autoIndexedResourceRef.current = preferredResourceId;
    void handleIndexResources([preferredResourceId]).finally(() => {
      onClearPreferredResource?.();
    });
  }, [
    loading,
    preferredAction,
    preferredResourceId,
    missingPreferredResource,
    handleIndexResources,
    onClearPreferredResource,
  ]);

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
    // Idempotency guard: chống bấm đúp tạo trùng 2 đề trong Exam Mixer Pro
    if (inFlightExportDraftIdsRef.current.has(draft.id)) {
      return;
    }
    const graphBindingCheck = verifyDraftDynamicGraphBindings(draft);
    if (!graphBindingCheck.valid) {
      onNotify('error', graphBindingCheck.reason ?? 'BLOCK EXPORT — STALE GRAPH DATA');
      return;
    }
    inFlightExportDraftIdsRef.current.add(draft.id);
    try {
      const existingLinked = findExistingExamForDraft(mathExams, draft);
      const deterministicExamId = existingLinked?.id ?? draft.exportedExamProjectId ?? `mexam-gen-${draft.id}`;
      const project = convertDraftToMathExamProject(draft, {
        examId: deterministicExamId,
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
        existingLinked
          ? `Đã đồng bộ lại "${savedProject.title}" (${savedProject.questions.length} câu) trong Exam Mixer Pro (không tạo bản trùng).`
          : `Đã chuyển "${savedProject.title}" (${savedProject.questions.length} câu) sang Exam Mixer Pro.`
      );
      onOpenExamMixerWithExam(savedProject.id);
    } catch {
      onNotify('error', 'Không thể chuyển đề sang Exam Mixer Pro.');
    } finally {
      inFlightExportDraftIdsRef.current.delete(draft.id);
    }
  };

  const handleMixAndSendToGrading = async (draft: GeneratedExamDraft) => {
    if (inFlightExportDraftIdsRef.current.has(draft.id)) {
      return;
    }
    const gate = canExportOfficialAnswerKey(draft);
    if (!gate.allowed) {
      onNotify('error', gate.reason ?? 'Cần xác nhận toàn bộ đáp án trước khi chấm OMR.');
      return;
    }
    inFlightExportDraftIdsRef.current.add(draft.id);
    try {
      const existingLinked = findExistingExamForDraft(mathExams, draft);
      const deterministicExamId = existingLinked?.id ?? draft.exportedExamProjectId ?? `mexam-gen-${draft.id}`;
      const project = convertDraftToMathExamProject(draft, {
        examId: deterministicExamId,
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
    } finally {
      inFlightExportDraftIdsRef.current.delete(draft.id);
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
    <main className="tos-page tos-module space-y-5">
      <PageBanner title="Tạo đề kiểm tra" subtitle="Soạn đề theo ma trận, dùng lại câu hỏi hoặc mở bản nháp đã lưu." />

      {missingPreferredResource && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/50 px-4 py-3 text-xs text-amber-950 dark:text-amber-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-bold">
                Không tìm thấy tài liệu nguồn đã chọn
              </p>
              <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                Tài liệu có thể đã bị xóa khỏi Resource Vault. Hệ thống không tự động chọn nhầm tài liệu khác — hãy chọn lại tài liệu nguồn.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onOpenResourceVault && (
              <button
                type="button"
                onClick={onOpenResourceVault}
                className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Chọn lại trong Resource Vault
              </button>
            )}
            <button
              type="button"
              onClick={() => onClearPreferredResource?.()}
              className="rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200"
            >
              Đóng cảnh báo
            </button>
          </div>
        </div>
      )}

      {/* Module Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Phân khu Smart Exam Generator 2.0"
        className="tos-stepper"
      >
        {TABS.map((t) => {
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
            >
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500">
          Đang tải câu hỏi, mẫu đề và bản nháp…
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

          {activeTab === 'natural-language' && (
            <NaturalLanguageExamPanel
              resources={resources}
              unifiedBank={unifiedBank}
              templates={templates}
              initialResourceId={preferredResourceId}
              initialPrompt={preferredPrompt}
              onIndexResources={handleIndexResources}
              onSaveDraft={async (draft) => {
                await handleUpdateDraft(draft);
                onSyncWorkflowDraft?.(draft);
              }}
              onOpenDraftInWizardStep5={(draft) => {
                setReviewDraft(draft);
                onSyncWorkflowDraft?.(draft);
                onClearPreferredResource?.();
                setActiveTab('wizard');
              }}
              onSendDraftToExamMixer={async (draft) => {
                onSyncWorkflowDraft?.(draft);
                await handleSendToExamMixer(draft);
              }}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'wizard' && (
            <ExamGeneratorWizardPanel
              key={wizardSession}
              unifiedBank={unifiedBank}
              templates={templates}
              persistedDrafts={drafts}
              initialDraftToReview={reviewDraft}
              onSaveDrafts={(list) => {
                if (list[0]) onSyncWorkflowDraft?.(list[0]);
                void handleSaveDrafts(list);
              }}
              onUpdateDraft={(d) => {
                onSyncWorkflowDraft?.(d);
                void handleUpdateDraft(d);
              }}
              onSendToExamMixer={(d) => {
                onSyncWorkflowDraft?.(d);
                void handleSendToExamMixer(d);
              }}
              onMixAndSendToGrading={(d) => {
                onSyncWorkflowDraft?.(d);
                void handleMixAndSendToGrading(d);
              }}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'bank' && (
            <QuestionBankManagerPanel
              unifiedBank={unifiedBank}
              templates={templates}
              resources={resources}
              initialSearchQuery={preferredTopicFilter}
              onAddBankQuestion={(item) => void handleAddBankQuestion(item)}
              onDeleteBankQuestion={(id) => void handleDeleteBankQuestion(id)}
              onCreateTemplateFromQuestion={(item) => {
                setTemplateBuilderTargetId(item.templateId ?? null);
                setTemplateBuilderSourceQ(item);
                setActiveTab('templates');
              }}
              onNotify={onNotify}
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
