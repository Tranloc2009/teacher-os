import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Lock,
  Plus,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { ResourceItem } from '../../types/lesson';
import type { QuestionSourceProvenance } from '../../types/resourceIntelligence';
import { SourceProvenanceModal } from './SourceProvenanceModal';
import {
  COGNITIVE_LEVEL_LABELS,
  MATH_QUESTION_TYPE_LABELS,
  MATH_SECTION_TITLES,
  type CognitiveLevel,
  type ExamSubjectId,
  type MathQuestionType,
  type McqOptionLabel,
} from '../../types/mathExam';
import type {
  BankQuestionRecord,
  GeneratorQuestionStatus,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import { parseMathContent } from '../../core/mathIntegrity';
import { evaluateBankQuestionVariantSafety } from '../../core/examGenerator/verifiedVariantEngine';
import {
  MathContentRenderer,
  MathVisualAssetRenderer,
} from '../math/MathContentRenderer';

interface QuestionBankManagerPanelProps {
  unifiedBank: BankQuestionRecord[];
  templates: QuestionTemplateDefinition[];
  resources?: ResourceItem[];
  initialSearchQuery?: string | null;
  onAddBankQuestion: (item: BankQuestionRecord) => void;
  onDeleteBankQuestion: (id: string) => void;
  onCreateTemplateFromQuestion: (item: BankQuestionRecord) => void;
  onNotify?: (tone: 'success' | 'info' | 'error', text: string) => void;
}

const STATUS_STYLE: Record<
  GeneratorQuestionStatus,
  { label: string; className: string }
> = {
  VARIANT_READY: {
    label: 'VARIANT READY',
    className:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
  },
  ORIGINAL: {
    label: 'ORIGINAL',
    className:
      'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800',
  },
  REVIEW_REQUIRED: {
    label: 'REVIEW REQUIRED',
    className:
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
  },
  UNSUPPORTED: {
    label: 'UNSUPPORTED',
    className:
      'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
  BLOCKED: {
    label: 'BLOCKED',
    className:
      'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
  },
};

export function QuestionBankManagerPanel({
  unifiedBank,
  templates,
  resources = [],
  initialSearchQuery,
  onAddBankQuestion,
  onDeleteBankQuestion,
  onCreateTemplateFromQuestion,
  onNotify,
}: QuestionBankManagerPanelProps) {
  const [activeProvenance, setActiveProvenance] = useState<{
    provenance: QuestionSourceProvenance;
    resource?: ResourceItem;
  } | null>(null);
  const resourceById = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources]
  );
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery ?? '');

  useEffect(() => {
    if (typeof initialSearchQuery === 'string' && initialSearchQuery.trim()) {
      setSearchQuery(initialSearchQuery.trim());
    }
  }, [initialSearchQuery]);
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAddForm, setShowAddForm] = useState(false);

  // Add form state
  const [newSubjectId, setNewSubjectId] = useState<ExamSubjectId>('toan');
  const [newGrade, setNewGrade] = useState('Lớp 8');
  const [newTopic, setNewTopic] = useState('Phương trình và bất phương trình');
  const [newLevel, setNewLevel] = useState<CognitiveLevel>('nhan-biet');
  const [newType, setNewType] = useState<MathQuestionType>('mcq');
  const [newPoints, setNewPoints] = useState(0.5);
  const [newStem, setNewStem] = useState('');
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');
  const [optD, setOptD] = useState('');
  const [correctLabel, setCorrectLabel] = useState<McqOptionLabel>('A');
  const [shortAns, setShortAns] = useState('');
  const [newSolution, setNewSolution] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const templateById = useMemo(
    () => new Map(templates.map((t) => [t.id, t])),
    [templates]
  );

  const enriched = useMemo(() => {
    return unifiedBank.map((item) => {
      const linkedTpl = item.templateId
        ? templateById.get(item.templateId)
        : undefined;
      const safety = evaluateBankQuestionVariantSafety(item, linkedTpl);
      return { item, linkedTpl, safety };
    });
  }, [unifiedBank, templateById]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enriched.filter(({ item, safety }) => {
      if (filterSubject !== 'all' && item.subjectId !== filterSubject) return false;
      if (filterLevel !== 'all' && item.cognitiveLevel !== filterLevel) return false;
      if (filterStatus !== 'all' && safety.status !== filterStatus) return false;
      if (q) {
        const hay = `${item.code} ${item.topic} ${item.subjectName} ${item.question.stem.rawSource}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, searchQuery, filterSubject, filterLevel, filterStatus]);

  const handleSubmitNew = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!newStem.trim()) {
      setFormError('Vui lòng nhập nội dung câu hỏi.');
      return;
    }
    if (newType === 'mcq') {
      const vals = [optA.trim(), optB.trim(), optC.trim(), optD.trim()];
      if (vals.some((v) => !v)) {
        setFormError('Câu trắc nghiệm cần đủ 4 phương án A, B, C, D.');
        return;
      }
      if (new Set(vals).size < 4) {
        setFormError('4 phương án A, B, C, D không được trùng nhau.');
        return;
      }
    }
    if (newType === 'short-answer' && !shortAns.trim()) {
      setFormError('Vui lòng nhập đáp án chuẩn cho câu trả lời ngắn.');
      return;
    }

    const now = new Date().toISOString();
    const id = `bank-custom-${Date.now().toString(36)}`;
    const code = `NH-${String(unifiedBank.length + 1).padStart(2, '0')}`;
    const subjectName = newSubjectId === 'vat-ly' ? 'Vật lý' : 'Toán học';

    const labels: McqOptionLabel[] = ['A', 'B', 'C', 'D'];
    const rawOpts = [optA.trim(), optB.trim(), optC.trim(), optD.trim()];
    const options =
      newType === 'mcq'
        ? labels.map((lbl, idx) => ({
            id: `${id}-opt-${lbl.toLowerCase()}`,
            originalLabel: lbl,
            content: parseMathContent(rawOpts[idx], `${id}-o${idx}`),
            isCorrect: lbl === correctLabel,
          }))
        : undefined;

    const record: BankQuestionRecord = {
      id,
      code,
      subjectId: newSubjectId,
      subjectName,
      grade: newGrade,
      topic: newTopic.trim() || 'Chủ đề chung',
      cognitiveLevel: newLevel,
      type: newType,
      points: Number.isFinite(newPoints) && newPoints > 0 ? newPoints : 0.5,
      sourceKind: 'generator-bank',
      question: {
        id,
        code,
        sectionTitle: MATH_SECTION_TITLES[newType],
        type: newType,
        universalType: newType,
        subjectId: newSubjectId,
        topic: newTopic.trim() || 'Chủ đề chung',
        cognitiveLevel: newLevel,
        difficultyScore:
          newLevel === 'nhan-biet'
            ? 1
            : newLevel === 'thong-hieu'
            ? 2
            : newLevel === 'van-dung'
            ? 3
            : 4,
        points: Number.isFinite(newPoints) && newPoints > 0 ? newPoints : 0.5,
        stem: parseMathContent(newStem.trim(), `${id}-stem`),
        ...(options
          ? {
              options,
              correctOptionId: options.find((o) => o.isCorrect)?.id,
            }
          : {}),
        ...(newType === 'short-answer'
          ? {
              shortAnswer: {
                answerValue: shortAns.trim(),
                acceptedFormats: [shortAns.trim()],
              },
            }
          : {}),
        solutionGuide: parseMathContent(
          newSolution.trim() || 'Lời giải do giáo viên nhập.',
          `${id}-sol`
        ),
        lockQuestionPosition: false,
        lockOptionShuffle: false,
        allowStatementShuffle: false,
        dependencyFlags: [],
        hasVisualAsset: false,
        answerConfirmed: true,
        createdAt: now,
        updatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    onAddBankQuestion(record);
    setNewStem('');
    setOptA('');
    setOptB('');
    setOptC('');
    setOptD('');
    setShortAns('');
    setNewSolution('');
    setShowAddForm(false);
  };

  return (
    <div className="space-y-5">
      {/* Filter & Toolbar */}
      <div className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo mã câu, chủ đề, nội dung..."
              aria-label="Tìm kiếm câu hỏi trong ngân hàng"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 pl-9 pr-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:border-[#635BFF] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Lọc theo môn học"
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="all">Tất cả môn</option>
              <option value="toan">Toán học</option>
              <option value="vat-ly">Vật lý</option>
            </select>

            <select
              aria-label="Lọc theo mức độ nhận thức"
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="all">Mọi mức độ</option>
              <option value="nhan-biet">Nhận biết</option>
              <option value="thong-hieu">Thông hiểu</option>
              <option value="van-dung">Vận dụng</option>
              <option value="van-dung-cao">Vận dụng cao</option>
            </select>

            <select
              aria-label="Lọc theo trạng thái kiểm chứng"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="all">Mọi trạng thái</option>
              <option value="VARIANT_READY">VARIANT READY</option>
              <option value="ORIGINAL">ORIGINAL</option>
              <option value="REVIEW_REQUIRED">REVIEW REQUIRED</option>
              <option value="UNSUPPORTED">UNSUPPORTED</option>
              <option value="BLOCKED">BLOCKED</option>
            </select>

            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#5248f0] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{showAddForm ? 'Đóng biểu mẫu' : 'Thêm câu vào ngân hàng'}</span>
            </button>
          </div>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Hiển thị <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-200">{filtered.length}</span> / {unifiedBank.length} câu hỏi. Câu hỏi có hình ảnh/đồ thị tĩnh hoặc OMML nhị phân được gắn nhãn <span className="font-semibold text-rose-600 dark:text-rose-400">BLOCKED</span> để khóa đổi số tự động (chỉ dùng nguyên bản).
        </p>
      </div>

      {/* Add Question Form */}
      {showAddForm && (
        <form
          onSubmit={handleSubmitNew}
          className="rounded-2xl border border-[#635BFF]/30 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4"
        >
          <h3 className="text-sm font-bold text-[#172033] dark:text-slate-100">
            Thêm câu hỏi mới vào Ngân hàng cục bộ
          </h3>

          {formError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/50 dark:border-rose-800 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Môn học</span>
              <select
                value={newSubjectId}
                onChange={(e) => setNewSubjectId(e.target.value as ExamSubjectId)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
              >
                <option value="toan">Toán học</option>
                <option value="vat-ly">Vật lý</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Khối lớp</span>
              <input
                type="text"
                value={newGrade}
                onChange={(e) => setNewGrade(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Chủ đề</span>
              <input
                type="text"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Mức độ</span>
              <select
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value as CognitiveLevel)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
              >
                <option value="nhan-biet">Nhận biết</option>
                <option value="thong-hieu">Thông hiểu</option>
                <option value="van-dung">Vận dụng</option>
                <option value="van-dung-cao">Vận dụng cao</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Dạng câu &amp; Điểm</span>
              <div className="flex gap-1.5">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as MathQuestionType)}
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-xs"
                >
                  <option value="mcq">Trắc nghiệm</option>
                  <option value="short-answer">Trả lời ngắn</option>
                  <option value="essay">Tự luận</option>
                </select>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={newPoints}
                  onChange={(e) => setNewPoints(Number(e.target.value))}
                  aria-label="Điểm câu hỏi"
                  className="w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-xs font-mono-num"
                />
              </div>
            </label>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Nội dung câu hỏi (hỗ trợ LaTeX $...$)
            </span>
            <textarea
              rows={2}
              value={newStem}
              onChange={(e) => setNewStem(e.target.value)}
              placeholder="Ví dụ: Tìm nghiệm của phương trình $5x - 10 = 15$."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
          </label>

          {newType === 'mcq' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <label className="space-y-1 text-xs">
                <span className="font-semibold">Phương án A</span>
                <input
                  type="text"
                  value={optA}
                  onChange={(e) => setOptA(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-semibold">Phương án B</span>
                <input
                  type="text"
                  value={optB}
                  onChange={(e) => setOptB(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-semibold">Phương án C</span>
                <input
                  type="text"
                  value={optC}
                  onChange={(e) => setOptC(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-semibold">Phương án D</span>
                <input
                  type="text"
                  value={optD}
                  onChange={(e) => setOptD(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-semibold">Đáp án đúng</span>
                <select
                  value={correctLabel}
                  onChange={(e) => setCorrectLabel(e.target.value as McqOptionLabel)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold"
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
              </label>
            </div>
          )}

          {newType === 'short-answer' && (
            <label className="block space-y-1 text-xs max-w-xs">
              <span className="font-semibold">Đáp án chuẩn (trả lời ngắn)</span>
              <input
                type="text"
                value={shortAns}
                onChange={(e) => setShortAns(e.target.value)}
                placeholder="VD: 5"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
              />
            </label>
          )}

          <label className="block space-y-1 text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Hướng dẫn giải ngắn gọn
            </span>
            <input
              type="text"
              value={newSolution}
              onChange={(e) => setNewSolution(e.target.value)}
              placeholder="Ví dụ: $5x = 25 \\Rightarrow x = 5$."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs"
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[#635BFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5248f0]"
            >
              Lưu vào ngân hàng
            </button>
          </div>
        </form>
      )}

      {/* Bank List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
            Không có câu hỏi nào khớp bộ lọc hiện tại.
          </div>
        ) : (
          filtered.map(({ item, safety }) => {
            const st = STATUS_STYLE[safety.status];
            return (
              <article
                key={item.id}
                className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-4 shadow-sm space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono-num font-bold text-[#4F46E5] dark:text-indigo-400">
                      {item.code}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide ${st.className}`}
                    >
                      {safety.status === 'BLOCKED' && (
                        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                      )}
                      {safety.status === 'VARIANT_READY' && (
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      )}
                      {st.label}
                    </span>
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      {item.subjectName} · {item.grade}
                    </span>
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                      {item.topic}
                    </span>
                    <span className="rounded-md bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                      {COGNITIVE_LEVEL_LABELS[item.cognitiveLevel]} · {MATH_QUESTION_TYPE_LABELS[item.type]}
                    </span>
                    {item.question.variantMeta?.graphFingerprint && (
                      <span className="font-mono-num rounded-md bg-sky-50 dark:bg-sky-950/60 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                        Graph FP: {item.question.variantMeta.graphFingerprint}
                      </span>
                    )}
                    {item.sourceKind === 'resource-vault' && item.sourceProvenance && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
                        Resource Vault · {item.sourceProvenance.fileName}
                        {item.sourceProvenance.sourcePage
                          ? ` (Tr.${item.sourceProvenance.sourcePage})`
                          : ''}
                      </span>
                    )}
                    {item.sourceKind === 'exam-project' && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500">
                        <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                        Từ Exam Mixer (chỉ đọc gốc)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {item.sourceProvenance && (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveProvenance({
                            provenance: item.sourceProvenance!,
                            resource: resourceById.get(item.sourceProvenance!.resourceId),
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100"
                      >
                        <FileSearch className="h-3 w-3" aria-hidden="true" />
                        <span>Xem nguồn gốc</span>
                      </button>
                    )}
                    {safety.status !== 'BLOCKED' &&
                      (item.type === 'mcq' || item.type === 'short-answer') && (
                        <button
                          type="button"
                          onClick={() => onCreateTemplateFromQuestion(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-950/50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/60"
                        >
                          <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                          <span>{item.templateId ? 'Mở mẫu đổi số' : 'Tạo mẫu đổi số'}</span>
                        </button>
                      )}
                    {(item.sourceKind === 'generator-bank' ||
                      item.sourceKind === 'resource-vault') && (
                      <button
                        type="button"
                        onClick={() => onDeleteBankQuestion(item.id)}
                        aria-label={`Xóa câu hỏi ${item.code}`}
                        className="rounded-lg border border-rose-200 dark:border-rose-900 p-1 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="text-sm text-[#172033] dark:text-slate-100 leading-relaxed">
                  <MathContentRenderer payload={item.question.stem} />
                </div>

                {item.question.visualAssets && item.question.visualAssets.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {item.question.visualAssets.map((asset) => (
                      <MathVisualAssetRenderer key={asset.id} asset={asset} compact />
                    ))}
                  </div>
                )}

                {item.question.options && item.question.options.length > 0 && (
                  <div
                    className={`grid grid-cols-1 gap-2 text-xs ${
                      item.question.options.some((o) => Boolean(o.visualAsset))
                        ? 'sm:grid-cols-2'
                        : 'sm:grid-cols-2 lg:grid-cols-4'
                    }`}
                  >
                    {item.question.options.map((opt) => (
                      <div
                        key={opt.id}
                        className={`rounded-xl border px-2.5 py-1.5 space-y-2 ${
                          opt.isCorrect
                            ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/40 font-semibold text-emerald-900 dark:text-emerald-200'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div>
                          <span className="font-bold mr-1.5">{opt.originalLabel}.</span>
                          <MathContentRenderer payload={opt.content} />
                        </div>
                        {opt.visualAsset && (
                          <MathVisualAssetRenderer asset={opt.visualAsset} compact />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {safety.status === 'BLOCKED' && (
                  <p className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-950/40 rounded-lg px-2.5 py-1.5">
                    {safety.reasons.join(' ')}
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>

      {activeProvenance && (
        <SourceProvenanceModal
          provenance={activeProvenance.provenance}
          resource={activeProvenance.resource}
          onClose={() => setActiveProvenance(null)}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
