import { CSSProperties, useMemo, useState } from 'react';
import { Eye, EyeOff, Printer, ShieldAlert } from 'lucide-react';
import {
  ExamExportSettings,
  MathExamProject,
  MixedExamVersion,
  QuestionGroup,
} from '../../types/mathExam';
import {
  MCQ_LABELS,
  TF_LABELS,
  getOptionLetterLabel,
  getStatementLetterLabel,
} from '../../core/mathIntegrity';
import { resolveExportSettings } from '../../core/examExportEngine';
import { getSubjectProfile, getUniversalQuestionType, resolveSubjectId } from '../../core/subjectProfileRegistry';
import {
  MathContentRenderer,
  MathVisualAssetRenderer,
} from './MathContentRenderer';

export type PrintPreviewMode = 'student-single' | 'student-all' | 'answer-matrix' | 'integrity';

interface MathExamPrintPreviewProps {
  exam: MathExamProject;
  selectedCode: string;
  canExport: boolean;
  onSelectCode?: (code: string) => void;
  onChangeExportSettings: (next: ExamExportSettings) => void;
  onTriggerPrint: () => void;
}

function StudentExamA4Sheet({
  exam,
  version,
  settings,
  subjectName,
  marginStyle,
}: {
  exam: MathExamProject;
  version: MixedExamVersion;
  settings: ExamExportSettings;
  subjectName: string;
  marginStyle: CSSProperties;
}) {
  const examTitle = settings.examTitleOverride.trim() || exam.title;
  const groupMap = useMemo(
    () => new Map<string, QuestionGroup>((exam.questionGroups ?? []).map((g) => [g.id, g])),
    [exam.questionGroups]
  );

  const renderedGroups = new Set<string>();
  let currentSection = '';

  return (
    <article
      className="a4-sheet rounded-lg p-6 sm:p-10 text-slate-900 text-[13px] leading-relaxed"
      style={marginStyle}
    >
      {/* Header Table */}
      <div className="grid grid-cols-12 gap-4 border-b-2 border-slate-800 pb-3 mb-4">
        <div className="col-span-5 text-center space-y-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide">
            {settings.departmentName}
          </div>
          <div className="text-xs font-bold uppercase">{settings.schoolName}</div>
          <div className="mx-auto w-24 border-b border-slate-700 pt-1" />
          <div className="text-[11px] italic text-slate-600 pt-1">
            Đề chính thức · {version.questions.length} câu
          </div>
        </div>
        <div className="col-span-7 text-center space-y-1">
          <div className="text-sm font-bold uppercase">{examTitle}</div>
          <div className="text-xs font-medium">
            Môn: {subjectName} · {exam.grade} · Thời gian làm bài: {exam.durationMinutes} phút
          </div>
          <div className="inline-block border-2 border-slate-900 px-3 py-0.5 text-xs font-bold font-mono-num">
            MÃ ĐỀ: {version.code}
          </div>
        </div>
      </div>

      {/* Candidate Info */}
      <div className="grid grid-cols-12 gap-3 text-xs border border-slate-300 rounded px-3 py-2 mb-4">
        <div className="col-span-7">Họ và tên thí sinh: ........................................................</div>
        <div className="col-span-5">Số báo danh: ............................ Lớp: ...........</div>
      </div>

      {settings.headerNote.trim() && (
        <p className="text-[11px] italic text-slate-600 mb-3">{settings.headerNote}</p>
      )}

      {/* Questions Stream */}
      <div className="space-y-3">
        {version.questions.map((q, idx) => {
          const showSection = q.sectionTitle && q.sectionTitle !== currentSection;
          if (showSection) currentSection = q.sectionTitle;

          let groupToRender: QuestionGroup | null = null;
          if (q.groupId && !renderedGroups.has(q.groupId) && groupMap.has(q.groupId)) {
            renderedGroups.add(q.groupId);
            groupToRender = groupMap.get(q.groupId)!;
          }

          const uType = getUniversalQuestionType(q);

          return (
            <div key={`${version.code}-${q.id}`} className="space-y-2">
              {showSection && (
                <h3 className="pt-2 text-xs font-bold uppercase tracking-wide text-slate-900 border-b border-slate-200 pb-1">
                  {q.sectionTitle}
                </h3>
              )}

              {groupToRender && (
                <div className="avoid-break rounded border border-slate-300 bg-slate-50/70 p-3 space-y-2 text-xs">
                  <div className="font-semibold text-slate-900">{groupToRender.title}</div>
                  {groupToRender.sharedContext.rawSource.trim() && (
                    <div className="text-slate-800 whitespace-pre-wrap">
                      <MathContentRenderer payload={groupToRender.sharedContext} />
                    </div>
                  )}
                  {groupToRender.sharedAssets.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {groupToRender.sharedAssets.map((a) => (
                        <MathVisualAssetRenderer key={a.id} asset={a} compact />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="avoid-break space-y-1.5">
                <div className="text-slate-950">
                  <span className="font-bold mr-1.5">Câu {idx + 1}:</span>
                  <MathContentRenderer payload={q.stem} />
                </div>

                {q.visualAssets && q.visualAssets.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-4 pt-1">
                    {q.visualAssets.map((a) => (
                      <MathVisualAssetRenderer key={a.id} asset={a} compact />
                    ))}
                  </div>
                )}

                {uType === 'multi-select' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pl-4">
                    {(q.multiSelectOptions ?? q.options ?? []).map((opt, oIdx) => (
                      <div key={opt.id}>
                        <span className="font-bold mr-1">{getOptionLetterLabel(oIdx)}.</span>
                        <MathContentRenderer payload={opt.content} />
                      </div>
                    ))}
                  </div>
                )}

                {uType !== 'multi-select' && q.type === 'mcq' && q.options && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pl-4">
                    {q.options.map((opt, oIdx) => (
                      <div key={opt.id}>
                        <span className="font-bold mr-1">{MCQ_LABELS[oIdx] ?? getOptionLetterLabel(oIdx)}.</span>
                        <MathContentRenderer payload={opt.content} />
                      </div>
                    ))}
                  </div>
                )}

                {q.type === 'true-false' && q.statements && (
                  <div className="space-y-1 pl-4">
                    {q.statements.map((st, sIdx) => (
                      <div key={st.id}>
                        <span className="font-bold mr-1">{TF_LABELS[sIdx] ?? getStatementLetterLabel(sIdx)})</span>
                        <MathContentRenderer payload={st.content} />
                      </div>
                    ))}
                  </div>
                )}

                {uType === 'fill-blank' && q.fillBlank?.wordBank && q.fillBlank.wordBank.length > 0 && (
                  <div className="pl-4 text-xs text-slate-700">
                    <span className="font-semibold italic mr-1.5">Từ gợi ý:</span>
                    {q.fillBlank.wordBank.map((w, bIdx) => (
                      <span key={w.id} className="mr-3">
                        <span className="font-semibold">{getOptionLetterLabel(bIdx)}.</span>{' '}
                        <MathContentRenderer payload={w.content} />
                      </span>
                    ))}
                  </div>
                )}

                {uType === 'matching' && q.matching && (
                  <div className="pl-4 pt-1">
                    <table className="w-full text-xs border border-slate-300">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="border border-slate-300 px-2 py-1 text-left w-1/2">Cột A</th>
                          <th className="border border-slate-300 px-2 py-1 text-left w-1/2">Cột B</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(
                          {
                            length: Math.max(
                              q.matching.leftItems.length,
                              q.matching.rightItems.length
                            ),
                          },
                          (_, rowIdx) => {
                            const left = q.matching!.leftItems[rowIdx];
                            const right = q.matching!.rightItems[rowIdx];
                            return (
                              <tr key={rowIdx}>
                                <td className="border border-slate-300 px-2 py-1">
                                  {left ? (
                                    <>
                                      <span className="font-bold mr-1">
                                        {left.originalLabel || rowIdx + 1}.
                                      </span>
                                      <MathContentRenderer payload={left.content} />
                                    </>
                                  ) : null}
                                </td>
                                <td className="border border-slate-300 px-2 py-1">
                                  {right ? (
                                    <>
                                      <span className="font-bold mr-1">
                                        {getStatementLetterLabel(rowIdx)}.
                                      </span>
                                      <MathContentRenderer payload={right.content} />
                                    </>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          }
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {uType === 'ordering' && q.ordering && (
                  <div className="space-y-1 pl-4">
                    {q.ordering.items.map((it, oIdx) => {
                      const usesNum = q.ordering!.items.every((x) => /^\d+$/.test(x.originalLabel.trim()));
                      return (
                        <div key={it.id}>
                          <span className="font-bold mr-1">
                            {usesNum ? `${oIdx + 1}.` : `${getStatementLetterLabel(oIdx)}.`}
                          </span>
                          <MathContentRenderer payload={it.content} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {q.type === 'essay' && q.essayParts && q.essayParts.length > 0 && (
                  <div className="space-y-1 pl-4">
                    {q.essayParts.map((part) => (
                      <div key={part.id}>
                        <span className="font-bold mr-1">
                          {part.label} ({part.points} điểm)
                        </span>
                        <MathContentRenderer payload={part.content} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 pt-3 border-t border-slate-300 text-center space-y-1">
        <div className="text-xs font-bold">——— HẾT ———</div>
        {settings.footerNote.trim() && (
          <div className="text-[11px] italic text-slate-600">{settings.footerNote}</div>
        )}
      </div>
    </article>
  );
}

export function MathExamPrintPreview({
  exam,
  selectedCode,
  canExport,
  onSelectCode,
  onChangeExportSettings,
  onTriggerPrint,
}: MathExamPrintPreviewProps) {
  const [previewMode, setPreviewMode] = useState<PrintPreviewMode>('student-single');
  const [viewingOriginal, setViewingOriginal] = useState(false);
  const [showTeacherVerifyTable, setShowTeacherVerifyTable] = useState(false);
  const settings = resolveExportSettings(exam);
  const subjectProfile = getSubjectProfile(resolveSubjectId(exam.subjectId || exam.subject));

  const targetVersion =
    exam.generatedVersions.find((v) => v.code === selectedCode) ?? exam.generatedVersions[0] ?? null;

  const originalPreviewVersion = useMemo<MixedExamVersion>(() => {
    return {
      code: 'ĐỀ GỐC',
      seedUsed: 'original',
      generatedAt: exam.updatedAt,
      questions: exam.questions,
      permutationMap: exam.questions.map((q, idx) => ({
        newOrderNumber: idx + 1,
        originalOrderNumber: idx + 1,
        questionId: q.id,
        originalCode: q.code,
        sectionTitle: q.sectionTitle,
        type: q.type,
        cognitiveLevel: q.cognitiveLevel,
        topic: q.topic,
        groupId: q.groupId,
        exactAnswerSummary: '',
        lockedPositionApplied: Boolean(q.lockQuestionPosition),
        lockedOptionShuffleApplied: Boolean(q.lockOptionShuffle),
      })),
      answerKeyRows: exam.questions.map((q, idx) => {
        let ans = '—';
        if (q.type === 'mcq' && q.options) {
          const cIdx = q.options.findIndex((o) => o.id === q.correctOptionId);
          ans = cIdx >= 0 ? getOptionLetterLabel(cIdx) : '?';
        } else if (q.type === 'true-false' && q.statements) {
          ans = q.statements
            .map((st, sIdx) => `${getStatementLetterLabel(sIdx)}-${st.isTrue ? 'Đ' : 'S'}`)
            .join(' ');
        } else if (q.type === 'short-answer' && q.shortAnswer) {
          ans = q.shortAnswer.answerValue;
        } else if (q.type === 'essay') {
          ans = `Tự luận (${q.points}đ)`;
        }
        return {
          number: idx + 1,
          questionId: q.id,
          originalCode: q.code,
          type: q.type,
          cognitiveLevel: q.cognitiveLevel,
          answer: ans,
        };
      }),
      integrityPassed: true,
      integrityWarnings: [],
    };
  }, [exam.questions, exam.updatedAt]);

  const activeSingleSheetVersion = viewingOriginal ? originalPreviewVersion : targetVersion;
  const movedQuestionsCount = useMemo(() => {
    if (!targetVersion || viewingOriginal) return 0;
    return targetVersion.permutationMap.filter(
      (m) => m.newOrderNumber !== m.originalOrderNumber
    ).length;
  }, [targetVersion, viewingOriginal]);

  const marginStyle: CSSProperties = {
    fontFamily:
      settings.fontFamily === 'Times New Roman'
        ? '"Times New Roman", Times, serif'
        : 'var(--font-sans)',
    padding: `${settings.paperMarginMm}mm`,
    ['--print-margin-top' as string]: `${settings.paperMarginMm}mm`,
    ['--print-margin-right' as string]: `${settings.paperMarginMm}mm`,
    ['--print-margin-bottom' as string]: `${settings.paperMarginMm}mm`,
    ['--print-margin-left' as string]: `${settings.paperMarginMm}mm`,
  };

  if (exam.generatedVersions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Configuration & Preview Controls (hidden when printing) */}
      <div className="no-print rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
              Cấu hình bản in A4 / PDF &amp; Tiêu đề trường lớp
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Phiếu đề học sinh tuyệt đối tách riêng khỏi bảng đáp án giáo viên. Nhấn In / Lưu PDF để xuất chuẩn khổ giấy A4.
            </p>
          </div>
          <button
            type="button"
            disabled={!canExport}
            onClick={onTriggerPrint}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            <span>In / Lưu PDF (A4)</span>
          </button>
        </div>

        {!canExport && (
          <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50/70 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Đang bị CHẶN xuất bản vì còn lỗi toàn vẹn [BLOCKED].</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Sở / Phòng GD&amp;ĐT
            </label>
            <input
              type="text"
              value={settings.departmentName}
              onChange={(e) =>
                onChangeExportSettings({ ...settings, departmentName: e.target.value })
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Tên trường
            </label>
            <input
              type="text"
              value={settings.schoolName}
              onChange={(e) =>
                onChangeExportSettings({ ...settings, schoolName: e.target.value })
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Lề trang A4 (mm)
            </label>
            <select
              aria-label="Lề trang A4"
              value={settings.paperMarginMm}
              onChange={(e) =>
                onChangeExportSettings({
                  ...settings,
                  paperMarginMm: Number(e.target.value) as 10 | 15 | 20,
                })
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
            >
              <option value={10}>Hẹp (10 mm)</option>
              <option value={15}>Chuẩn (15 mm)</option>
              <option value={20}>Rộng (20 mm)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Phông chữ tài liệu
            </label>
            <select
              aria-label="Phông chữ tài liệu"
              value={settings.fontFamily}
              onChange={(e) =>
                onChangeExportSettings({
                  ...settings,
                  fontFamily: e.target.value as 'Be Vietnam Pro' | 'Times New Roman',
                })
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
            >
              <option value="Be Vietnam Pro">Be Vietnam Pro (Hiện đại)</option>
              <option value="Times New Roman">Times New Roman (Chuẩn văn bản)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Ghi chú đầu đề (Header)
            </label>
            <input
              type="text"
              value={settings.headerNote}
              onChange={(e) =>
                onChangeExportSettings({ ...settings, headerNote: e.target.value })
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Chân trang (Footer)
            </label>
            <input
              type="text"
              value={settings.footerNote}
              onChange={(e) =>
                onChangeExportSettings({ ...settings, footerNote: e.target.value })
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                [
                  'student-single',
                  viewingOriginal
                    ? 'Xem đề gốc (A4)'
                    : `Đề học sinh (Mã ${targetVersion?.code ?? ''})`,
                ],
                ['student-all', `Tất cả đề học sinh (${exam.generatedVersions.length} mã)`],
                ['answer-matrix', 'Bảng đáp án & Ánh xạ'],
                ['integrity', 'Báo cáo toàn vẹn'],
              ] as Array<[PrintPreviewMode, string]>
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setPreviewMode(m)}
                className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  previewMode === m
                    ? 'border-slate-900 dark:border-slate-100 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {previewMode === 'student-single' && (
            <button
              type="button"
              onClick={() => setShowTeacherVerifyTable((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                showTeacherVerifyTable
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {showTeacherVerifyTable ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Bảng đối chiếu giáo viên (không in)</span>
            </button>
          )}
        </div>

        {/* Code Switcher Bar: Đề gốc vs Mã 101, 102, ... */}
        {previewMode === 'student-single' && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1">
                Chuyển xem nhanh:
              </span>
              <button
                type="button"
                onClick={() => setViewingOriginal(true)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  viewingOriginal
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                Đề gốc
              </button>
              {exam.generatedVersions.slice(0, 10).map((ver) => {
                const isSelected = !viewingOriginal && targetVersion?.code === ver.code;
                return (
                  <button
                    key={ver.code}
                    type="button"
                    onClick={() => {
                      setViewingOriginal(false);
                      onSelectCode?.(ver.code);
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-mono-num font-semibold transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    Mã {ver.code}
                  </button>
                );
              })}
              {exam.generatedVersions.length > 10 && (
                <select
                  aria-label="Chọn mã đề xem trước bản in"
                  value={viewingOriginal ? '__ORIGINAL__' : targetVersion?.code ?? ''}
                  onChange={(e) => {
                    if (e.target.value === '__ORIGINAL__') {
                      setViewingOriginal(true);
                    } else {
                      setViewingOriginal(false);
                      onSelectCode?.(e.target.value);
                    }
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono-num font-semibold"
                >
                  <option value="__ORIGINAL__">Đề gốc</option>
                  {exam.generatedVersions.map((ver) => (
                    <option key={ver.code} value={ver.code}>
                      Mã {ver.code}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {!viewingOriginal && targetVersion && (
              <span className="text-[11px] font-mono-num font-medium text-blue-700 dark:text-blue-300">
                {movedQuestionsCount}/{targetVersion.questions.length} câu đổi vị trí so với đề gốc
              </span>
            )}
          </div>
        )}
      </div>

      {/* Optional Teacher-Only Verification Table (strictly no-print, never exported into student files) */}
      {previewMode === 'student-single' && showTeacherVerifyTable && activeSingleSheetVersion && (
        <div
          data-testid="teacher-verification-table"
          className="no-print rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-blue-950 dark:text-blue-100">
              Bảng đối chiếu thứ tự câu dành riêng cho giáo viên — {viewingOriginal ? 'Đề gốc' : `Mã đề ${activeSingleSheetVersion.code}`}
            </h4>
            <span className="text-[11px] text-blue-700 dark:text-blue-300">
              Chỉ hiển thị trên màn hình (tự động ẩn khi in PDF &amp; không đưa vào DOCX học sinh)
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-blue-200/80 dark:border-blue-800/80 bg-white dark:bg-slate-900">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Câu hiển thị</th>
                  <th className="px-3 py-1.5 text-left font-semibold">ID câu gốc</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Vị trí gốc</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Đổi vị trí</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Đáp án mới</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono-num">
                {activeSingleSheetVersion.permutationMap.map((m, idx) => {
                  const moved = m.newOrderNumber !== m.originalOrderNumber;
                  return (
                    <tr key={m.questionId}>
                      <td className="px-3 py-1.5 font-semibold text-slate-900 dark:text-slate-100">
                        Câu {m.newOrderNumber}
                      </td>
                      <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">
                        {m.originalCode} <span className="text-[10px] text-slate-400">({m.questionId})</span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600 dark:text-slate-400">
                        Câu {m.originalOrderNumber}
                      </td>
                      <td className="px-3 py-1.5">
                        {moved ? (
                          <span className="font-sans text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            Đã đổi ({m.originalOrderNumber} → {m.newOrderNumber})
                          </span>
                        ) : m.lockedPositionApplied ? (
                          <span className="font-sans text-[11px] text-amber-700 dark:text-amber-400">
                            Khóa vị trí
                          </span>
                        ) : (
                          <span className="font-sans text-[11px] text-slate-500">Giữ nguyên</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-bold text-blue-700 dark:text-blue-300">
                        {activeSingleSheetVersion.answerKeyRows[idx]?.answer ?? m.exactAnswerSummary}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Printable A4 Sheets */}
      <div className="print-container space-y-6">
        {previewMode === 'student-single' && activeSingleSheetVersion && (
          <StudentExamA4Sheet
            exam={exam}
            version={activeSingleSheetVersion}
            settings={settings}
            subjectName={subjectProfile.name}
            marginStyle={marginStyle}
          />
        )}

        {previewMode === 'student-all' &&
          exam.generatedVersions.slice(0, 24).map((ver) => (
            <StudentExamA4Sheet
              key={ver.code}
              exam={exam}
              version={ver}
              settings={settings}
              subjectName={subjectProfile.name}
              marginStyle={marginStyle}
            />
          ))}

        {previewMode === 'student-all' && exam.generatedVersions.length > 24 && (
          <p className="no-print text-center text-xs text-amber-700 dark:text-amber-300">
            Xem trước in A4 hiển thị tối đa 24 mã đầu để đảm bảo mượt trình duyệt. Để lấy trọn bộ {exam.generatedVersions.length} mã đề, hãy dùng nút "Xuất trọn bộ .ZIP".
          </p>
        )}

        {previewMode === 'answer-matrix' && (
          <article
            className="a4-sheet rounded-lg p-6 sm:p-10 text-slate-900 text-xs space-y-5"
            style={marginStyle}
          >
            <div className="text-center border-b-2 border-slate-800 pb-3 space-y-1">
              <div className="text-sm font-bold uppercase">
                ĐÁP ÁN TỔNG HỢP &amp; BẢNG ÁNH XẠ — {settings.examTitleOverride.trim() || exam.title}
              </div>
              <div className="text-[11px] text-slate-600">
                Môn: {subjectProfile.name} · {exam.grade} · {exam.generatedVersions.length} mã đề · Seed: {exam.mixConfig.seed}
              </div>
            </div>

            <div>
              <h4 className="font-bold uppercase text-xs mb-2">
                I. Ma trận đáp án nhanh các mã đề
              </h4>
              <table className="w-full border border-slate-300 text-[11px]">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="border border-slate-300 px-2 py-1 text-left w-16">Câu</th>
                    {exam.generatedVersions.slice(0, 10).map((ver) => (
                      <th key={ver.code} className="border border-slate-300 px-2 py-1 font-mono-num">
                        Mã {ver.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(
                    {
                      length: Math.max(
                        0,
                        ...exam.generatedVersions.slice(0, 10).map((v) => v.answerKeyRows.length)
                      ),
                    },
                    (_, rIdx) => (
                      <tr key={rIdx}>
                        <td className="border border-slate-300 px-2 py-1 font-semibold">
                          Câu {rIdx + 1}
                        </td>
                        {exam.generatedVersions.slice(0, 10).map((ver) => (
                          <td
                            key={ver.code}
                            className="border border-slate-300 px-2 py-1 font-mono-num text-center font-semibold"
                          >
                            {ver.answerKeyRows[rIdx]?.answer ?? '—'}
                          </td>
                        ))}
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            {targetVersion && (
              <div>
                <h4 className="font-bold uppercase text-xs mb-2">
                  II. Bảng ánh xạ hoán vị chi tiết (Mã đề {targetVersion.code})
                </h4>
                <table className="w-full border border-slate-300 text-[11px]">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="border border-slate-300 px-2 py-1 text-left">Câu mới</th>
                      <th className="border border-slate-300 px-2 py-1 text-left">Câu gốc</th>
                      <th className="border border-slate-300 px-2 py-1 text-left">Đáp án</th>
                      <th className="border border-slate-300 px-2 py-1 text-left">Ánh xạ hoán vị</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetVersion.permutationMap.map((m, idx) => (
                      <tr key={m.questionId}>
                        <td className="border border-slate-300 px-2 py-1 font-mono-num">
                          Câu {m.newOrderNumber}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 font-mono-num">
                          Câu {m.originalOrderNumber} ({m.originalCode})
                        </td>
                        <td className="border border-slate-300 px-2 py-1 font-mono-num font-bold">
                          {targetVersion.answerKeyRows[idx]?.answer ?? m.exactAnswerSummary}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 font-mono-num">
                          {m.optionPermutation
                            ? m.optionPermutation.map((o) => `${o.newLabel}←${o.originalLabel}`).join(' ')
                            : m.statementPermutation
                            ? m.statementPermutation.map((s) => `${s.newLabel}←${s.originalLabel}`).join(' ')
                            : 'Giữ nguyên'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        )}

        {previewMode === 'integrity' && (
          <article
            className="a4-sheet rounded-lg p-6 sm:p-10 text-slate-900 text-xs space-y-4"
            style={marginStyle}
          >
            <div className="text-center border-b-2 border-slate-800 pb-3 space-y-1">
              <div className="text-sm font-bold uppercase">
                BIÊN BẢN KIỂM CHỨNG TOÀN VẸN KHẢO THÍ — EXAM MIXER PRO 6.0
              </div>
              <div className="text-[11px] text-slate-600">
                Đề: {exam.title} · Môn: {subjectProfile.name} · {exam.generatedVersions.length} mã đề
              </div>
            </div>
            <table className="w-full border border-slate-300 text-[11px]">
              <thead className="bg-slate-100">
                <tr>
                  <th className="border border-slate-300 px-2 py-1 text-left">Mã đề</th>
                  <th className="border border-slate-300 px-2 py-1 text-left">Số câu</th>
                  <th className="border border-slate-300 px-2 py-1 text-left">Trạng thái</th>
                  <th className="border border-slate-300 px-2 py-1 text-left">Ghi chú bảo vệ</th>
                </tr>
              </thead>
              <tbody>
                {exam.generatedVersions.map((v) => (
                  <tr key={v.code}>
                    <td className="border border-slate-300 px-2 py-1 font-mono-num font-bold">
                      Mã {v.code}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 font-mono-num">
                      {v.questions.length}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 font-mono-num font-semibold">
                      {v.integrityStatus ?? (v.integrityPassed ? 'PASS' : 'BLOCKED')}
                    </td>
                    <td className="border border-slate-300 px-2 py-1">
                      {v.integrityWarnings.length > 0
                        ? v.integrityWarnings.join('; ')
                        : 'Toàn vẹn 100% hash nội dung, tài nguyên và quy tắc khóa.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        )}
      </div>
    </div>
  );
}
