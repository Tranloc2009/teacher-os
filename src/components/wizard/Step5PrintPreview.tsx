import { useState } from 'react';
import { CheckCircle2, Printer, Settings2 } from 'lucide-react';
import {
  LessonPack,
  PrintSettings,
  QuestionTier,
  RUBRIC_LEVEL_HEADERS,
  TIER_LABELS,
  WorksheetVariantId,
} from '../../types/lesson';
import {
  allocateThreeWorksheets,
  calculateActivityMinutes,
  normalizeWorksheetVariants,
  validateFullLessonPack,
} from '../../utils/allocation';

type PreviewDocTab = 'all' | 'lesson' | 'worksheet' | 'rubric' | 'teacherKey';

interface Step5PrintPreviewProps {
  pack: LessonPack;
  settings: PrintSettings;
  onMarkCompleted: () => void;
  onOpenSettings: () => void;
}

const DOC_TABS: Array<{ id: PreviewDocTab; label: string }> = [
  { id: 'all', label: 'Trọn bộ tài liệu' },
  { id: 'lesson', label: 'Giáo án hoạt động' },
  { id: 'worksheet', label: '3 mẫu phiếu A4' },
  { id: 'rubric', label: 'Phiếu Rubric quá trình' },
  { id: 'teacherKey', label: 'Đáp án giáo viên' },
];

export function Step5PrintPreview({
  pack,
  settings,
  onMarkCompleted,
  onOpenSettings,
}: Step5PrintPreviewProps) {
  const [activeDoc, setActiveDoc] = useState<PreviewDocTab>('all');
  const [worksheetFilter, setWorksheetFilter] = useState<'ALL' | WorksheetVariantId>('ALL');

  const variants = normalizeWorksheetVariants(pack);
  const variantResults = allocateThreeWorksheets(pack.questions, variants);
  const totalActivityMinutes = calculateActivityMinutes(pack);
  const validationErrors = validateFullLessonPack(pack);
  const errorMessages = Object.values(validationErrors);

  const showLesson = activeDoc === 'all' || activeDoc === 'lesson';
  const showWorksheet = activeDoc === 'all' || activeDoc === 'worksheet';
  const showRubric = activeDoc === 'all' || activeDoc === 'rubric';
  const showTeacherKey =
    activeDoc === 'teacherKey' ||
    (activeDoc === 'all' && settings.includeTeacherAnswerKey);

  const visibleWorksheets =
    worksheetFilter === 'ALL'
      ? variantResults
      : variantResults.filter((r) => r.variant.id === worksheetFilter);

  const sheetPaddingStyle = {
    paddingTop: `${settings.marginsMm.top}mm`,
    paddingRight: `${settings.marginsMm.right}mm`,
    paddingBottom: `${settings.marginsMm.bottom}mm`,
    paddingLeft: `${settings.marginsMm.left}mm`,
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <section aria-labelledby="step5-heading" className="space-y-6 print:space-y-0">
      {/* Control Toolbar (Hidden on Print) */}
      <div className="no-print space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="step5-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-50">
              Bước 5: Xem trước từng tài liệu &amp; Xuất bản in A4
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Khổ giấy <span className="font-mono-num font-medium">A4 (210 × 297 mm)</span>
              <span aria-hidden="true" className="mx-1.5">·</span>
              Lề đang dùng:{' '}
              <span className="font-mono-num">
                {settings.marginsMm.top}/{settings.marginsMm.right}/{settings.marginsMm.bottom}/{settings.marginsMm.left} mm
              </span>
            </p>
          </div>

          <div
            data-tour-id="ps-print-actions"
            className="flex flex-wrap items-center gap-2 shrink-0"
          >
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Chỉnh lề in</span>
            </button>
            {pack.status !== 'completed' && (
              <button
                type="button"
                onClick={onMarkCompleted}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-emerald-600 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 whitespace-nowrap"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Đánh dấu Hoàn thành</span>
              </button>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500 whitespace-nowrap"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              <span>In / Lưu PDF (A4)</span>
            </button>
          </div>
        </div>

        {errorMessages.length > 0 && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 p-4 text-xs text-amber-900 dark:text-amber-200">
            <p className="font-semibold">
              Một số mục trong bộ tiết dạy cần kiểm tra lại (hệ thống giữ nguyên dữ liệu bạn đã nhập, không tự tạo câu giả):
            </p>
            <ul className="mt-1.5 list-disc pl-5 space-y-0.5">
              {errorMessages.slice(0, 6).map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Document switcher tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Chọn tài liệu xem trước"
            data-tour-id="ps-doc-tabs"
            className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-1"
          >
            {DOC_TABS.map((tab) => {
              const active = activeDoc === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveDoc(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {showWorksheet && (
            <div className="flex max-w-full flex-wrap items-center gap-1 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 text-xs">
              <span className="px-2 text-slate-500 dark:text-slate-400">In phiếu:</span>
              {(['ALL', 'A', 'B', 'C'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={worksheetFilter === opt}
                  onClick={() => setWorksheetFilter(opt)}
                  className={`rounded-md px-2.5 py-1 font-medium whitespace-nowrap ${
                    worksheetFilter === opt
                      ? 'bg-blue-600 dark:bg-blue-600 text-white'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {opt === 'ALL' ? 'Cả 3 phiếu' : `Phiếu ${opt}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Printable A4 Sheets */}
      <div className="print-container space-y-8 bg-slate-100/70 dark:bg-slate-950/60 p-2 sm:p-6 rounded-xl print:space-y-0 print:rounded-none">
        {/* 1. Giáo án & Tiến trình hoạt động */}
        {showLesson && (
          <article
            style={sheetPaddingStyle}
            className="a4-sheet rounded-sm text-slate-900"
            aria-label="Tài liệu 1: Giáo án hoạt động"
          >
            <header className="border-b-2 border-slate-900 pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-600">
                <span>{settings.schoolHeader || 'BỘ TÀI LIỆU DẠY HỌC PHỔ THÔNG'}</span>
                <span className="font-mono-num">
                  {pack.subject || 'Chưa chọn môn'} · {pack.grade || 'Chưa chọn lớp'} · {pack.duration} phút
                </span>
              </div>
              <h1 className="mt-2 text-lg font-bold text-slate-950 leading-snug">
                GIÁO ÁN TIẾN TRÌNH HOẠT ĐỘNG: {pack.title || '(Chưa đặt tên bài)'}
              </h1>
              {settings.teacherName && (
                <p className="mt-1 text-xs text-slate-700">
                  Giáo viên soạn: {settings.teacherName}
                </p>
              )}
            </header>

            <div className="mt-4 space-y-4">
              <div className="avoid-break">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
                  I. Mục tiêu tiết dạy
                </h2>
                <ul className="mt-1.5 list-disc pl-5 space-y-1 text-sm leading-relaxed text-slate-800">
                  {pack.objectives.filter((o) => o.trim()).length > 0 ? (
                    pack.objectives
                      .filter((o) => o.trim())
                      .map((obj, idx) => (
                        <li key={idx} className="whitespace-pre-wrap break-words">
                          {obj}
                        </li>
                      ))
                  ) : (
                    <li className="italic text-slate-500">Chưa nhập mục tiêu bài học.</li>
                  )}
                </ul>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
                    II. Chuỗi hoạt động lớp học
                  </h2>
                  <span className="text-xs font-mono-num text-slate-600">
                    Tổng thời gian hoạt động: {totalActivityMinutes} / {pack.duration} phút
                  </span>
                </div>

                {pack.activities.length === 0 ? (
                  <p className="mt-2 text-sm italic text-slate-500">
                    Chưa có hoạt động nào được thiết kế.
                  </p>
                ) : (
                  <div className="mt-2.5 space-y-3">
                    {pack.activities.map((act, idx) => (
                      <div
                        key={act.id}
                        className="avoid-break rounded border border-slate-300 p-3"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-1.5">
                          <h3 className="text-sm font-semibold text-slate-950">
                            Hoạt động {idx + 1}: {act.title}
                          </h3>
                          <span className="text-xs font-mono-num text-slate-700">
                            {act.durationMinutes} phút · {act.grouping}
                          </span>
                        </div>
                        {act.instructions && (
                          <div className="mt-2 text-xs leading-relaxed text-slate-800 whitespace-pre-wrap break-words">
                            <strong>Tổ chức thực hiện:</strong> {act.instructions}
                          </div>
                        )}
                        {act.studentTask && (
                          <div className="mt-1.5 text-xs leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
                            <strong>Nhiệm vụ học sinh:</strong> {act.studentTask}
                          </div>
                        )}
                        {act.teacherNote && (
                          <div className="mt-1.5 text-xs italic text-slate-600 whitespace-pre-wrap break-words">
                            <strong>Lưu ý giáo viên:</strong> {act.teacherNote}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </article>
        )}

        {/* 2. 3 mẫu phiếu bài tập A4 (Họ tên / Lớp để trống) */}
        {showWorksheet &&
          visibleWorksheets.map(({ variant, allocated }) => {
            let runningNumber = 0;
            return (
              <article
                key={variant.id}
                style={sheetPaddingStyle}
                className="a4-sheet rounded-sm text-slate-900"
                aria-label={`Phiếu bài tập ${variant.label}`}
              >
                <header className="border-b-2 border-slate-900 pb-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-700">
                    <span>
                      {settings.schoolHeader ? `${settings.schoolHeader} · ` : ''}
                      <strong>{variant.label}</strong>
                    </span>
                    <span className="font-mono-num">
                      {pack.subject} · {pack.grade} · Thời lượng: {pack.duration} phút
                    </span>
                  </div>
                  <h1 className="mt-1.5 text-lg font-bold text-slate-950">
                    {pack.title || 'Phiếu bài tập thực hành'}
                  </h1>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-800">
                    <div className="border-b border-dotted border-slate-400 pb-1">
                      Họ và tên học sinh:
                    </div>
                    <div className="border-b border-dotted border-slate-400 pb-1">
                      Lớp: ......................... Ngày: ....../....../20......
                    </div>
                  </div>
                </header>

                <div className="mt-4 space-y-5">
                  {allocated.warnings.length > 0 && (
                    <div className="no-print rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      {allocated.warnings.map((w, idx) => (
                        <p key={idx}>{w}</p>
                      ))}
                    </div>
                  )}

                  {allocated.totalQuestions === 0 ? (
                    <p className="text-sm italic text-slate-500">
                      Phiếu này chưa có câu hỏi nào được chọn.
                    </p>
                  ) : (
                    (['basic', 'applied', 'extended'] as QuestionTier[]).map((tier) => {
                      const list = allocated.sections[tier];
                      if (list.length === 0) return null;
                      return (
                        <div key={tier} className="space-y-3">
                          <h2 className="border-b border-slate-300 pb-1 text-sm font-bold text-slate-900">
                            Phần {TIER_LABELS[tier]} ({list.length} câu)
                          </h2>
                          <div className="space-y-4">
                            {list.map((q) => {
                              runningNumber += 1;
                              return (
                                <div key={q.id} className="avoid-break space-y-2">
                                  <div className="flex items-baseline justify-between gap-3">
                                    <p className="text-sm font-semibold text-slate-950">
                                      Câu {runningNumber}
                                      <span className="ml-1.5 font-mono-num text-xs font-normal text-slate-500">
                                        [{q.code || q.id}]
                                      </span>
                                      <span className="ml-2 font-normal text-xs font-mono-num text-slate-600">
                                        ({q.points} điểm)
                                      </span>
                                    </p>
                                  </div>
                                  <p className="text-sm leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
                                    {q.prompt || '(Chưa nhập nội dung câu hỏi)'}
                                  </p>
                                  <div aria-hidden="true" className="pt-1 space-y-3">
                                    <div className="border-b border-dotted border-slate-300 h-4" />
                                    <div className="border-b border-dotted border-slate-300 h-4" />
                                    <div className="border-b border-dotted border-slate-300 h-4" />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </article>
            );
          })}

        {/* 3. Bản in đánh giá quá trình (Rubric 3–5 tiêu chí × 3 mức đạt) */}
        {showRubric && (
          <article
            style={sheetPaddingStyle}
            className="a4-sheet rounded-sm text-slate-900"
            aria-label="Tài liệu 3: Bản in đánh giá quá trình (Rubric)"
          >
            <header className="border-b-2 border-slate-900 pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-700">
                <span>PHIẾU ĐÁNH GIÁ QUÁ TRÌNH (RUBRIC 3 MỨC ĐẠT)</span>
                <span className="font-mono-num">
                  {pack.subject} · {pack.grade}
                </span>
              </div>
              <h1 className="mt-1.5 text-lg font-bold text-slate-950">
                {pack.title || 'Tiêu chí đánh giá sản phẩm học tập'}
              </h1>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-800">
                <div className="border-b border-dotted border-slate-400 pb-1">
                  Họ tên / Nhóm học sinh:
                </div>
                <div className="border-b border-dotted border-slate-400 pb-1">
                  Lớp: ......................... Ngày: ....../....../20......
                </div>
              </div>
            </header>

            <div className="mt-4">
              {pack.rubric.length === 0 ? (
                <p className="text-sm italic text-slate-500">
                  Chưa có tiêu chí rubric nào.
                </p>
              ) : (
                <table className="w-full border-collapse border border-slate-400 text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-left text-slate-900">
                      <th className="border border-slate-400 p-2 font-semibold w-[22%]">
                        Tiêu chí / Tỷ trọng
                      </th>
                      {RUBRIC_LEVEL_HEADERS.map((lv) => (
                        <th key={lv.key} className="border border-slate-400 p-2 font-semibold">
                          <div>{lv.label}</div>
                          <div className="font-normal text-[11px] text-slate-600">
                            {lv.scoreHint}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pack.rubric.map((c, idx) => (
                      <tr key={c.id} className="align-top">
                        <td className="border border-slate-400 p-2 font-semibold text-slate-900">
                          <div className="break-words">
                            {idx + 1}. {c.name || '(Chưa đặt tên)'}
                          </div>
                          <div className="mt-1 font-mono-num text-[11px] font-normal text-slate-600">
                            Tỷ trọng: {c.weightPercent}%
                          </div>
                        </td>
                        {RUBRIC_LEVEL_HEADERS.map((lv) => (
                          <td
                            key={lv.key}
                            className="border border-slate-400 p-2 leading-relaxed text-slate-800 whitespace-pre-wrap break-words"
                          >
                            <div className="mb-1 text-[11px] font-medium text-slate-600">
                              [ ] Đánh dấu mức đạt
                            </div>
                            {c.levels[lv.key] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="avoid-break mt-4 space-y-2 text-xs text-slate-800">
                <p className="font-semibold">Nhận xét quá trình của giáo viên / tự đánh giá của học sinh:</p>
                <div className="border-b border-dotted border-slate-400 h-5" />
                <div className="border-b border-dotted border-slate-400 h-5" />
                <p className="pt-1 text-[11px] italic text-slate-500">
                  Lưu ý: Phiếu đánh giá quá trình dùng để phản hồi tiến bộ học tập trên lớp, không lưu trữ làm sổ điểm chính thức.
                </p>
              </div>
            </div>
          </article>
        )}

        {/* 4. Hướng dẫn & Đáp án giáo viên (theo toàn bộ ngân hàng câu hỏi kèm mã riêng) */}
        {showTeacherKey && (
          <article
            style={sheetPaddingStyle}
            className="a4-sheet rounded-sm text-slate-900"
            aria-label="Tài liệu 4: Hướng dẫn và Đáp án giáo viên"
          >
            <header className="border-b-2 border-slate-900 pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-700">
                <span>HƯỚNG DẪN CHẤM &amp; ĐÁP ÁN DÀNH CHO GIÁO VIÊN</span>
                <span className="font-mono-num">
                  {pack.subject} · {pack.grade}
                </span>
              </div>
              <h1 className="mt-1.5 text-lg font-bold text-slate-950">
                {pack.title || 'Đáp án tham khảo'}
              </h1>
            </header>

            <div className="mt-4 space-y-3">
              {pack.questions.length === 0 ? (
                <p className="text-sm italic text-slate-500">
                  Chưa có câu hỏi nào trong ngân hàng câu hỏi.
                </p>
              ) : (
                pack.questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="avoid-break border-b border-slate-200 pb-3 last:border-b-0"
                  >
                    <div className="flex items-baseline justify-between gap-2 text-xs font-semibold text-slate-900">
                      <span>
                        Câu #{idx + 1} · Mã {q.code || q.id} ({TIER_LABELS[q.tier]})
                      </span>
                      <span className="font-mono-num text-slate-600">{q.points} điểm</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap break-words">
                      {q.prompt}
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
                      <strong>Đáp án / Gợi ý chấm:</strong>{' '}
                      {q.answerGuide.trim() || 'Không có đáp án kèm theo (tùy chọn).'}
                    </p>
                  </div>
                ))
              )}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
