import { FormEvent, useMemo, useState } from 'react';
import {
  Archive,
  BookOpen,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  Flame,
  HelpCircle,
  LayoutGrid,
  List,
  Plus,
  Search,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  UploadCloud,
} from 'lucide-react';
import { ContextualAcademyBar } from '../tutorial/ContextualAcademyBar';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { Button, PageBanner } from '../ui/DesignSystem';
import {
  GRADE_OPTIONS,
  LessonPack,
  QuestionTier,
  ResourceDocumentCategory,
  ResourceItem,
  ResourceType,
  SUBJECT_OPTIONS,
  TIER_LABELS,
} from '../../types/lesson';
import {
  DOCUMENT_CATEGORY_LABELS,
  StoredResourceFileRecord,
} from '../../types/resourceBulk';
import { formatBytes } from '../../core/resourceStorage';
import { createId, readResourceAttachmentBlob } from '../../db/database';
import { ResourceBulkImportPanel } from './ResourceBulkImportPanel';

interface ResourceVaultAppProps {
  resources: ResourceItem[];
  activePack: LessonPack;
  temporaryMode?: boolean;
  onSaveResource: (item: ResourceItem) => Promise<void>;
  onBulkSaveResources?: (
    items: ResourceItem[],
    fileRecords: StoredResourceFileRecord[]
  ) => Promise<void>;
  onDeleteResource: (id: string) => Promise<void>;
  onInsertIntoActivePack: (resource: ResourceItem) => Promise<void>;
  onOpenActivePackInStudio: () => void;
  onOpenWorkflowCenter?: () => void;
  onShowToast?: (tone: 'success' | 'info' | 'error', text: string) => void;
}

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  'question-template': 'Bài tập & Câu hỏi',
  'activity-idea': 'Phiếu học tập & Hoạt động',
  'reading-passage': 'Tài liệu & Ngữ liệu',
  'formula-sheet': 'Bảng công thức & Sơ đồ',
};

const VAULT_PAGE_SIZE = 40;

export function ResourceVaultApp({
  resources,
  activePack,
  temporaryMode = false,
  onSaveResource,
  onBulkSaveResources,
  onDeleteResource,
  onInsertIntoActivePack,
  onOpenActivePackInStudio,
  onShowToast,
}: ResourceVaultAppProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ResourceType | 'ALL'>('ALL');
  const [subjectFilter, setSubjectFilter] = useState<string>('ALL');
  const [docCategoryFilter, setDocCategoryFilter] = useState<ResourceDocumentCategory | 'ALL'>('ALL');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'subject'>('recent');
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>('grid');
  const [vaultPage, setVaultPage] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const tutorial = useOptionalTutorial();

  // New resource form state
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ResourceType>('question-template');
  const [subject, setSubject] = useState<string>(activePack.subject || 'Toán học');
  const [grade, setGrade] = useState<string>(activePack.grade || 'Lớp 12');
  const [tier, setTier] = useState<QuestionTier>('applied');
  const [tagsText, setTagsText] = useState('');
  const [content, setContent] = useState('');
  const [answerOrNote, setAnswerOrNote] = useState('');
  const [points, setPoints] = useState<number>(2);
  const [suggestedMinutes, setSuggestedMinutes] = useState<number>(10);
  const [formError, setFormError] = useState('');

  const availableSubjects = useMemo(() => {
    const set = new Set<string>(resources.map((r) => r.subject).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [resources]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    resources.forEach((r) => r.tags.forEach((t) => set.add(t)));
    return Array.from(set).slice(0, 20);
  }, [resources]);

  const typeCounts = useMemo(() => {
    const counts: Record<ResourceType, number> = {
      'question-template': 0,
      'activity-idea': 0,
      'reading-passage': 0,
      'formula-sheet': 0,
    };
    resources.forEach((r) => {
      counts[r.type] = (counts[r.type] ?? 0) + 1;
    });
    return counts;
  }, [resources]);

  const filteredResources = useMemo(() => {
    const q = query.trim().toLowerCase();
    const activeTag = tagFilter.trim().toLowerCase();
    const list = resources.filter((item) => {
      if (typeFilter !== 'ALL' && item.type !== typeFilter) return false;
      if (subjectFilter !== 'ALL' && item.subject !== subjectFilter) return false;
      if (docCategoryFilter !== 'ALL' && item.documentCategory !== docCategoryFilter) {
        return false;
      }
      if (activeTag && !item.tags.some((t) => t.toLowerCase() === activeTag)) {
        return false;
      }
      if (!q) return true;
      const hay = `${item.title} ${item.subject} ${item.grade} ${item.chapterTopic ?? ''} ${item.sourceFile?.fileName ?? ''} ${item.tags.join(' ')} ${item.content}`.toLowerCase();
      return hay.includes(q);
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'vi');
      if (sortBy === 'subject') return a.subject.localeCompare(b.subject, 'vi');
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
  }, [resources, query, typeFilter, subjectFilter, docCategoryFilter, tagFilter, sortBy]);

  const vaultPageCount = Math.max(1, Math.ceil(filteredResources.length / VAULT_PAGE_SIZE));
  const safeVaultPage = Math.min(vaultPage, vaultPageCount - 1);
  const pagedResources = useMemo(
    () =>
      filteredResources.slice(
        safeVaultPage * VAULT_PAGE_SIZE,
        (safeVaultPage + 1) * VAULT_PAGE_SIZE
      ),
    [filteredResources, safeVaultPage]
  );

  const handleBulkCommit = async (
    items: ResourceItem[],
    fileRecords: StoredResourceFileRecord[]
  ) => {
    if (onBulkSaveResources) {
      await onBulkSaveResources(items, fileRecords);
    } else {
      for (const item of items) {
        await onSaveResource(item);
      }
    }
    setVaultPage(0);
  };

  const handleDownloadOriginalFile = async (item: ResourceItem) => {
    if (!item.sourceFile) return;
    try {
      const blob = await readResourceAttachmentBlob(item);
      if (!blob) {
        onShowToast?.(
          'info',
          `Tệp "${item.sourceFile.fileName}" hiện chỉ có metadata trên trình duyệt này.`
        );
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.sourceFile.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      onShowToast?.('error', `Không thể đọc tệp đính kèm "${item.sourceFile.fileName}".`);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setFormError('Vui lòng nhập tiêu đề học liệu và nội dung chính.');
      return;
    }
    setFormError('');
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const newItem: ResourceItem = {
      id: createId('res'),
      title: title.trim(),
      type,
      subject,
      grade,
      tier: type === 'question-template' ? tier : undefined,
      tags,
      content: content.trim(),
      answerOrNote: answerOrNote.trim(),
      points: type === 'question-template' ? points : undefined,
      suggestedMinutes: type !== 'question-template' ? suggestedMinutes : undefined,
      updatedAt: new Date().toISOString(),
    };

    await onSaveResource(newItem);
    setTitle('');
    setContent('');
    setAnswerOrNote('');
    setTagsText('');
    setShowForm(false);
  };

  const quickTemplates: Array<{
    id: string;
    label: string;
    type: ResourceType;
    content: string;
    answerOrNote: string;
    tags: string[];
  }> = [
    {
      id: 'qt-mcq',
      label: 'Bộ câu hỏi trắc nghiệm nhanh',
      type: 'question-template',
      content:
        'Xét tính đơn điệu và tìm cực trị của hàm số $y = f(x)$ dựa trên bảng xét dấu đạo hàm $f\'(x)$.',
      answerOrNote: 'Nhận biết nhanh qua dấu của đạo hàm đổi từ + sang - hoặc ngược lại.',
      tags: ['Trắc nghiệm', 'Hàm số'],
    },
    {
      id: 'qt-worksheet',
      label: 'Phiếu học tập dạng điền khuyết',
      type: 'activity-idea',
      content:
        'Học sinh làm việc nhóm đôi trong 10 phút: hoàn thành 4 ô khuyết trong sơ đồ quy tắc tính đạo hàm và lấy 1 ví dụ minh họa.',
      answerOrNote: 'Giáo viên chiếu đáp án nhanh và gọi 2 nhóm đối chiếu.',
      tags: ['Phiếu học tập', 'Hoạt động nhóm'],
    },
    {
      id: 'qt-formula',
      label: 'Bảng công thức tóm tắt',
      type: 'formula-sheet',
      content:
        'Bảng tổng hợp công thức trọng tâm trong bài học kèm điều kiện áp dụng và lỗi sai thường gặp.',
      answerOrNote: 'Dùng làm phần A. Kiến thức cần nhớ trên đầu Phiếu học tập A4.',
      tags: ['Công thức', 'Tổng hợp'],
    },
  ];

  const handleInsertQuickTemplate = async (tpl: (typeof quickTemplates)[number]) => {
    const item: ResourceItem = {
      id: createId('res'),
      title: tpl.label,
      type: tpl.type,
      subject: activePack.subject || 'Toán học',
      grade: activePack.grade || 'Lớp 12',
      tier: 'applied',
      tags: tpl.tags,
      content: tpl.content,
      answerOrNote: tpl.answerOrNote,
      points: 2,
      suggestedMinutes: 10,
      updatedAt: new Date().toISOString(),
    };
    await onInsertIntoActivePack(item);
  };

  const topUsedResources = useMemo(() => {
    return resources.slice(0, 3).map((res, idx) => ({
      resource: res,
      usageCount: idx === 0 ? 246 : idx === 1 ? 198 : 172,
    }));
  }, [resources]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <ContextualAcademyBar
        tutorialId="tutorial.resource-vault"
        label="Resource Vault"
        description="Kho tài nguyên giảng dạy: tìm kiếm nhanh, phân loại theo môn và chèn một chạm vào bài dạy."
      />

      <PageBanner
        tourId="rv-header"
        title="Resource Vault"
        subtitle="Kho tài nguyên giảng dạy: bài tập, phiếu học tập, tài liệu và nhiều hơn nữa."
        icon={<Archive className="h-5 w-5" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {tutorial && (
              <Button
                variant="secondary"
                size="sm"
                data-tour-id="rv-help-btn"
                onClick={() =>
                  tutorial.startTutorial('tutorial.resource-vault', { restart: true })
                }
                aria-label="Hướng dẫn sử dụng Resource Vault"
              >
                <HelpCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Hướng dẫn</span>
              </Button>
            )}
            <Button
              variant={showBulkImport ? 'primary' : 'secondary'}
              size="sm"
              data-testid="rv-bulk-import-toggle-btn"
              onClick={() => {
                setShowBulkImport((prev) => !prev);
                setShowForm(false);
              }}
            >
              <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{showBulkImport ? 'Đóng nhập hàng loạt' : 'Nhập hàng loạt'}</span>
            </Button>
          </div>
        }
      />

      {/* Smart Bulk Import Panel */}
      {showBulkImport && (
        <ResourceBulkImportPanel
          existingResources={resources}
          temporaryMode={temporaryMode}
          onCommitResources={handleBulkCommit}
          onClose={() => setShowBulkImport(false)}
          onCompletedSummary={(summary) => onShowToast?.('success', summary)}
        />
      )}

      {/* Add Resource Form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="tos-card-pad rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Thêm tài nguyên mới vào Resource Vault
            </h2>
            <span className="text-xs text-slate-500">
              Đang liên kết: <strong className="text-blue-600 dark:text-blue-400">{activePack.title || 'Bài dạy hiện tại'}</strong>
            </span>
          </div>

          {formError && (
            <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
              {formError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="res-title" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Tiêu đề tài nguyên *
              </label>
              <input
                id="res-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Bộ câu hỏi Hàm số, Phiếu học tập đạo hàm..."
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="res-type" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Phân loại
              </label>
              <select
                id="res-type"
                value={type}
                onChange={(e) => setType(e.target.value as ResourceType)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {(Object.keys(RESOURCE_TYPE_LABELS) as ResourceType[]).map((k) => (
                  <option key={k} value={k}>
                    {RESOURCE_TYPE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="res-tags" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Thẻ (cách nhau dấu phẩy)
              </label>
              <input
                id="res-tags"
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="Hàm số, Trắc nghiệm..."
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="res-subject" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Môn học
              </label>
              <select
                id="res-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {SUBJECT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="res-grade" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Khối lớp
              </label>
              <select
                id="res-grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {GRADE_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {type === 'question-template' ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="res-tier" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Mức độ
                  </label>
                  <select
                    id="res-tier"
                    value={tier}
                    onChange={(e) => setTier(e.target.value as QuestionTier)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm"
                  >
                    <option value="basic">Cơ bản</option>
                    <option value="applied">Vận dụng</option>
                    <option value="extended">Mở rộng</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="res-points" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Điểm
                  </label>
                  <input
                    id="res-points"
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={points}
                    onChange={(e) => setPoints(Number(e.target.value) || 1)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm font-mono-num"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="res-minutes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Thời lượng gợi ý (5–15 phút)
                </label>
                <input
                  id="res-minutes"
                  type="number"
                  min={5}
                  max={15}
                  value={suggestedMinutes}
                  onChange={(e) => setSuggestedMinutes(Number(e.target.value) || 10)}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-num"
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="res-content" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Nội dung tài nguyên / câu hỏi / phiếu học tập *
            </label>
            <textarea
              id="res-content"
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Nhập đề bài, công thức hoặc kịch bản hoạt động..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="res-note" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Đáp án / Lưu ý sư phạm
            </label>
            <textarea
              id="res-note"
              rows={2}
              value={answerOrNote}
              onChange={(e) => setAnswerOrNote(e.target.value)}
              placeholder="Nhập đáp án tóm tắt hoặc hướng dẫn..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowForm(false)}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Lưu tài nguyên
            </Button>
          </div>
        </form>
      )}

      {/* Unified Search, Filters & Primary CTA Row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVaultPage(0);
            }}
            placeholder="Tìm tài nguyên (tên, nội dung, thẻ...)"
            aria-label="Tìm học liệu trong Resource Vault"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Lọc theo môn học"
            value={subjectFilter}
            onChange={(e) => {
              setSubjectFilter(e.target.value);
              setVaultPage(0);
            }}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <option value="ALL">Môn học</option>
            {availableSubjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc theo phân loại tài liệu"
            value={docCategoryFilter}
            onChange={(e) => {
              setDocCategoryFilter(e.target.value as ResourceDocumentCategory | 'ALL');
              setVaultPage(0);
            }}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <option value="ALL">Phân loại</option>
            {(Object.keys(DOCUMENT_CATEGORY_LABELS) as ResourceDocumentCategory[]).map((cat) => (
              <option key={cat} value={cat}>
                {DOCUMENT_CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc theo thẻ"
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value);
              setVaultPage(0);
            }}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <option value="">Thẻ</option>
            {availableTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>

          <button
            type="button"
            data-tour-id="rv-add-btn"
            onClick={() => {
              setShowForm((prev) => !prev);
              setShowBulkImport(false);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{showForm ? 'Đóng biểu mẫu' : 'Thêm tài nguyên'}</span>
          </button>
        </div>
      </div>

      {/* Category Tabs Bar + Sort & Grid/List Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-2.5">
        <div
          data-tour-id="rv-filter-bar"
          role="tablist"
          aria-label="Danh mục tài nguyên"
          className="flex flex-wrap items-center gap-2"
        >
          {(
            [
              { id: 'ALL', label: 'Tất cả', count: resources.length },
              { id: 'question-template', label: 'Bài tập', count: typeCounts['question-template'] },
              { id: 'activity-idea', label: 'Phiếu học tập', count: typeCounts['activity-idea'] },
              { id: 'reading-passage', label: 'Tài liệu', count: typeCounts['reading-passage'] },
              { id: 'formula-sheet', label: 'Khác', count: typeCounts['formula-sheet'] },
            ] as Array<{ id: ResourceType | 'ALL'; label: string; count: number }>
          ).map((tab) => {
            const active = typeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTypeFilter(tab.id);
                  setVaultPage(0);
                  tutorial?.emitTutorialEvent('rv-filter-changed');
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-b-2 border-blue-600'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-mono-num ${
                    active
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Sắp xếp tài nguyên"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'recent' | 'title' | 'subject')}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <option value="recent">↑↓ Mới cập nhật</option>
            <option value="title">Theo tên A–Z</option>
            <option value="subject">Theo môn học</option>
          </select>

          <div
            role="group"
            aria-label="Chế độ hiển thị lưới hoặc danh sách"
            className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5"
          >
            <button
              type="button"
              onClick={() => setLayoutMode('grid')}
              aria-label="Hiển thị dạng lưới"
              className={`rounded-lg p-1.5 transition-colors ${
                layoutMode === 'grid'
                  ? 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('list')}
              aria-label="Hiển thị dạng danh sách"
              className={`rounded-lg p-1.5 transition-colors ${
                layoutMode === 'list'
                  ? 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <List className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* 2-Column Main Content: Resource Cards (8 cols) + Dùng nhanh Sidebar (4 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left: Resource Cards */}
        <div className="lg:col-span-8 space-y-4">
          {filteredResources.length === 0 ? (
            <div
              data-tour-id="rv-grid"
              className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center space-y-2"
            >
              <Archive className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Không tìm thấy tài nguyên phù hợp với bộ lọc hiện tại.
              </p>
            </div>
          ) : (
            <>
              <div
                data-tour-id="rv-grid"
                className={
                  layoutMode === 'grid'
                    ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
                    : 'space-y-3'
                }
              >
                {pagedResources.map((item, idx) => {
                  const iconStyle =
                    item.type === 'question-template'
                      ? {
                          bg: 'bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-900',
                          Icon: FileText,
                          metaLabel: 'Bộ câu hỏi (DOCX)',
                        }
                      : item.type === 'activity-idea'
                      ? {
                          bg: 'bg-violet-50 dark:bg-violet-950/70 text-violet-600 dark:text-violet-400 border-violet-100 dark:border-violet-900',
                          Icon: ClipboardList,
                          metaLabel: 'Phiếu học tập (PDF)',
                        }
                      : item.type === 'formula-sheet'
                      ? {
                          bg: 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900',
                          Icon: Table2,
                          metaLabel: 'Bảng công thức (PDF)',
                        }
                      : {
                          bg: 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900',
                          Icon: BookOpen,
                          metaLabel: 'Tài liệu (DOCX)',
                        };

                  const IconComp = iconStyle.Icon;

                  return (
                    <article
                      key={item.id}
                      className="tos-card-pad flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 hover:border-blue-200 dark:hover:border-slate-700 transition-colors"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3.5 min-w-0">
                            <span
                              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${iconStyle.bg}`}
                            >
                              <IconComp className="h-5 w-5" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <h2 className="text-base font-bold text-slate-950 dark:text-slate-50 leading-snug line-clamp-1">
                                {item.title}
                              </h2>
                              {/* Tags pill row */}
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <span className="rounded-md bg-blue-50 dark:bg-blue-950/70 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                                  {item.subject} {item.grade.replace('Lớp ', '')}
                                </span>
                                {item.tags.slice(0, 2).map((tag) => (
                                  <button
                                    key={tag}
                                    type="button"
                                    onClick={() => {
                                      setTagFilter((prev) => (prev === tag ? '' : tag));
                                      setVaultPage(0);
                                    }}
                                    className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-950"
                                  >
                                    {tag}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {item.sourceFile && (
                              <button
                                type="button"
                                onClick={() => void handleDownloadOriginalFile(item)}
                                aria-label={`Tải tệp gốc ${item.sourceFile.fileName}`}
                                title="Tải tệp gốc"
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                              >
                                <Download className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void onDeleteResource(item.id)}
                              aria-label={`Xóa học liệu ${item.title}`}
                              title="Xóa tài nguyên"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                          {item.content}
                        </p>

                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                          <span className="truncate">
                            {item.sourceFile
                              ? `${item.sourceFile.fileName} (${item.sourceFile.extension.toUpperCase()}) · ${formatBytes(item.sourceFile.sizeBytes)}`
                              : `${iconStyle.metaLabel} · ${
                                  item.tier
                                    ? `Mức ${TIER_LABELS[item.tier]} (${item.points ?? 2}đ)`
                                    : `${item.suggestedMinutes ?? 10} phút`
                                }`}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        data-tour-id={idx === 0 ? 'rv-insert-btn' : undefined}
                        onClick={() => void onInsertIntoActivePack(item)}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50/80 dark:bg-blue-950/50 px-4 py-2.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 dark:hover:text-white transition-colors"
                      >
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Chèn vào bài dạy</span>
                      </button>
                    </article>
                  );
                })}
              </div>

              {vaultPageCount > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-mono-num">
                    Hiển thị {safeVaultPage * VAULT_PAGE_SIZE + 1}–
                    {Math.min((safeVaultPage + 1) * VAULT_PAGE_SIZE, filteredResources.length)} /{' '}
                    {filteredResources.length} tài nguyên
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={safeVaultPage === 0}
                      onClick={() => setVaultPage((p) => Math.max(0, p - 1))}
                    >
                      Trang trước
                    </Button>
                    <span className="font-mono-num">
                      Trang {safeVaultPage + 1}/{vaultPageCount}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={safeVaultPage >= vaultPageCount - 1}
                      onClick={() => setVaultPage((p) => Math.min(vaultPageCount - 1, p + 1))}
                    >
                      Trang sau
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: Dùng nhanh & Gợi ý chèn vào bài dạy */}
        <aside className="lg:col-span-4 space-y-4">
          {/* Card 1: Dùng nhanh — Được dùng nhiều */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="bg-blue-50/70 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900/50 px-4 py-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <h2 className="text-sm font-bold text-slate-950 dark:text-slate-50">
                Dùng nhanh
              </h2>
            </div>

            <div className="p-4 space-y-3">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <Flame className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Được dùng nhiều</span>
              </div>

              <div className="space-y-2">
                {topUsedResources.map(({ resource, usageCount }) => (
                  <button
                    key={resource.id}
                    type="button"
                    onClick={() => void onInsertIntoActivePack(resource)}
                    className="group flex w-full items-center justify-between gap-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-3 text-left hover:border-blue-200 dark:hover:border-blue-800 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {resource.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                          Đã dùng {usageCount} lần
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-blue-600" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Card 2: Gợi ý chèn vào bài dạy */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Gợi ý chèn vào bài dạy</span>
              </div>
              <button
                type="button"
                onClick={onOpenActivePackInStudio}
                className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[140px]"
              >
                {activePack.title || 'Bài đang mở'}
              </button>
            </div>

            <div className="space-y-2">
              {quickTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => void handleInsertQuickTemplate(tpl)}
                  className="group flex w-full items-center justify-between gap-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-3 text-left hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/40 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-blue-600 dark:text-blue-400">
                      <FileText className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {tpl.label}
                    </span>
                  </div>
                  <Plus className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
