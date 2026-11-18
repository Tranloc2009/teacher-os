import { FormEvent, useMemo, useState } from 'react';
import {
  Archive,
  ArrowUpRight,
  HelpCircle,
  Plus,
  Search,
  Tag,
  Trash2,
} from 'lucide-react';
import { ContextualAcademyBar } from '../tutorial/ContextualAcademyBar';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { Button, PageBanner } from '../ui/DesignSystem';
import {
  GRADE_OPTIONS,
  LessonPack,
  QuestionTier,
  ResourceItem,
  ResourceType,
  SUBJECT_OPTIONS,
  TIER_LABELS,
} from '../../types/lesson';
import { createId } from '../../db/database';

interface ResourceVaultAppProps {
  resources: ResourceItem[];
  activePack: LessonPack;
  onSaveResource: (item: ResourceItem) => Promise<void>;
  onDeleteResource: (id: string) => Promise<void>;
  onInsertIntoActivePack: (resource: ResourceItem) => Promise<void>;
  onOpenActivePackInStudio: () => void;
}

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  'question-template': 'Mẫu câu hỏi phân hóa',
  'activity-idea': 'Ý tưởng hoạt động 5–15p',
  'reading-passage': 'Ngữ liệu / Tình huống',
  'formula-sheet': 'Bảng công thức / Sơ đồ',
};

export function ResourceVaultApp({
  resources,
  activePack,
  onSaveResource,
  onDeleteResource,
  onInsertIntoActivePack,
  onOpenActivePackInStudio,
}: ResourceVaultAppProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ResourceType | 'ALL'>('ALL');
  const [showForm, setShowForm] = useState(false);
  const tutorial = useOptionalTutorial();

  // New resource form state
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ResourceType>('question-template');
  const [subject, setSubject] = useState<string>(activePack.subject || 'Toán học');
  const [grade, setGrade] = useState<string>(activePack.grade || 'Lớp 8');
  const [tier, setTier] = useState<QuestionTier>('applied');
  const [tagsText, setTagsText] = useState('');
  const [content, setContent] = useState('');
  const [answerOrNote, setAnswerOrNote] = useState('');
  const [points, setPoints] = useState<number>(2);
  const [suggestedMinutes, setSuggestedMinutes] = useState<number>(10);
  const [formError, setFormError] = useState('');

  const filteredResources = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter((item) => {
      if (typeFilter !== 'ALL' && item.type !== typeFilter) return false;
      if (!q) return true;
      const hay = `${item.title} ${item.subject} ${item.grade} ${item.tags.join(' ')} ${item.content}`.toLowerCase();
      return hay.includes(q);
    });
  }, [resources, query, typeFilter]);

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

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <ContextualAcademyBar
        tutorialId="tutorial.resource-vault"
        label="Resource Vault"
        description="Lưu trữ câu hỏi mẫu, hoạt động 5–15p và chèn trực tiếp vào bộ tiết dạy đang mở."
      />

      <PageBanner
        tourId="rv-header"
        title="Kho học liệu & Mẫu câu hỏi"
        subtitle="Lưu trữ các câu hỏi phân hóa, tình huống thực tế và hoạt động lớp học để chèn 1 chạm vào bộ tiết dạy."
        icon={<Archive className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
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
              variant="primary"
              data-tour-id="rv-add-btn"
              onClick={() => setShowForm((prev) => !prev)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>{showForm ? 'Đóng biểu mẫu' : 'Thêm học liệu mới'}</span>
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <span>Đang liên kết bài dạy:</span>
          <button
            type="button"
            onClick={onOpenActivePackInStudio}
            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline underline-offset-2"
          >
            {activePack.title || 'Bộ tiết dạy đang soạn'}
          </button>
        </div>
      </PageBanner>

      {/* Add Resource Form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="tos-card-pad rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Lưu học liệu mới vào Resource Vault
          </h2>

          {formError && (
            <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
              {formError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="res-title" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Tiêu đề học liệu *
              </label>
              <input
                id="res-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Bài toán thực tế tính lãi suất ngân hàng..."
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="res-type" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Loại học liệu
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
                Thẻ phân loại (cách nhau dấu phẩy)
              </label>
              <input
                id="res-tags"
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="toán thực tế, khởi động..."
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
                    Mức độ câu hỏi
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
                    Điểm gợi ý
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
              Nội dung câu hỏi / kịch bản hoạt động / ngữ liệu *
            </label>
            <textarea
              id="res-content"
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Nhập đề bài hoặc hướng dẫn tổ chức hoạt động..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="res-note" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Hướng dẫn chấm / Lưu ý sư phạm cho giáo viên
            </label>
            <textarea
              id="res-note"
              rows={2}
              value={answerOrNote}
              onChange={(e) => setAnswerOrNote(e.target.value)}
              placeholder="Nhập đáp án tóm tắt hoặc lưu ý khi tổ chức trên lớp..."
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
              Lưu vào Resource Vault
            </Button>
          </div>
        </form>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tiêu đề, nội dung hoặc thẻ (tag)..."
            aria-label="Tìm học liệu trong Resource Vault"
            className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div
          data-tour-id="rv-filter-bar"
          className="flex flex-wrap items-center gap-1.5"
        >
          {(
            [
              { id: 'ALL', label: `Tất cả (${resources.length})` },
              { id: 'question-template', label: 'Mẫu câu hỏi' },
              { id: 'activity-idea', label: 'Hoạt động 5–15p' },
              { id: 'formula-sheet', label: 'Công thức / Sơ đồ' },
              { id: 'reading-passage', label: 'Ngữ liệu' },
            ] as Array<{ id: ResourceType | 'ALL'; label: string }>
          ).map((tab) => {
            const active = typeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setTypeFilter(tab.id);
                  tutorial?.emitTutorialEvent('rv-filter-changed');
                }}
                className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'border-blue-600 bg-blue-600 dark:bg-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Resource Cards */}
      {filteredResources.length === 0 ? (
        <div
          data-tour-id="rv-grid"
          className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center"
        >
          <Archive className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Không tìm thấy học liệu phù hợp.
          </p>
        </div>
      ) : (
        <div data-tour-id="rv-grid" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredResources.map((item, idx) => (
            <article
              key={item.id}
              className="tos-card-pad flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <div>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {RESOURCE_TYPE_LABELS[item.type]}
                    </span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span>{item.subject}</span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span>{item.grade}</span>
                  </div>
                  {item.tier && (
                    <span className="font-mono-num text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Mức {TIER_LABELS[item.tier]} ({item.points ?? 2}đ)
                    </span>
                  )}
                  {!item.tier && item.suggestedMinutes && (
                    <span className="font-mono-num text-[11px] text-slate-600 dark:text-slate-400">
                      {item.suggestedMinutes} phút
                    </span>
                  )}
                </div>

                <h2 className="mt-2 text-base font-semibold text-slate-950 dark:text-slate-50">
                  {item.title}
                </h2>

                <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {item.content}
                </p>

                {item.answerOrNote && (
                  <p className="mt-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 text-xs text-slate-600 dark:text-slate-300">
                    <strong className="font-semibold text-slate-800 dark:text-slate-200">
                      Gợi ý / Lưu ý:{' '}
                    </strong>
                    {item.answerOrNote}
                  </p>
                )}

                {item.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Tag className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {item.tags.map((tag, tagIdx) => (
                      <span key={tag} className="inline-flex items-center gap-2">
                        {tagIdx > 0 && <span aria-hidden="true">·</span>}
                        <span>#{tag}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  data-tour-id={idx === 0 ? 'rv-insert-btn' : undefined}
                  onClick={() => void onInsertIntoActivePack(item)}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500 whitespace-nowrap"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {item.type === 'question-template'
                      ? 'Chèn vào Ngân hàng câu hỏi'
                      : 'Chèn thành Hoạt động bài dạy'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void onDeleteResource(item.id)}
                  aria-label={`Xóa học liệu ${item.title}`}
                  className="inline-flex items-center gap-1 rounded-[10px] px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-700 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Xóa</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
