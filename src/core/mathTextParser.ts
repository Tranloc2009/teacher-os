import {
  MATH_SECTION_TITLES,
  MathQuestion,
  McqOption,
  McqOptionLabel,
} from '../types/mathExam';
import {
  MCQ_LABELS,
  detectDependentOptions,
  parseMathContent,
} from './mathIntegrity';

export interface ParsedPasteExamResult {
  questions: MathQuestion[];
  warnings: string[];
  hasSuspiciousOmmlArtifacts: boolean;
}

/**
 * Phát hiện dấu hiệu công thức Word OMML / MathType bị mất định dạng khi copy-paste trực tiếp từ DOCX.
 */
export function detectClipboardMathArtifacts(rawText: string): string[] {
  const warnings: string[] = [];
  if (!rawText) return warnings;

  if (/[\uFFFD]/.test(rawText) || /[\uE000-\uF8FF]/.test(rawText)) {
    warnings.push(
      'Phát hiện ký tự lỗi font/glyph (thường gặp khi dán trực tiếp Equation/MathType từ Word). Hãy chuyển công thức sang LaTeX ($...$) hoặc kiểm tra lại từng biểu thức.'
    );
  }
  if (/<m:oMath|xmlns:m=|w:object/i.test(rawText)) {
    warnings.push(
      'Phát hiện thẻ XML Word OMML. Hệ thống không tự chuyển đổi OMML để tránh làm sai công thức; vui lòng xuất sang LaTeX trước khi dán.'
    );
  }
  return warnings;
}

/**
 * Phân tích khối văn bản đề Toán có cấu trúc "Câu X:" + A. / B. / C. / D. + "Đáp án: ..."
 * Bảo toàn nguyên vẹn toàn bộ chuỗi LaTeX ($...$, $$...$$).
 */
export function parseLatexExamText(
  rawText: string,
  createIdFn: (prefix: string) => string
): ParsedPasteExamResult {
  const warnings = detectClipboardMathArtifacts(rawText);
  const hasSuspiciousOmmlArtifacts = warnings.length > 0;
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { questions: [], warnings, hasSuspiciousOmmlArtifacts };
  }

  // Tách theo "Câu <số>." hoặc "Câu <số>:" ở đầu dòng
  const chunks = trimmed
    .split(/\n(?=\s*Câu\s+\d+\s*[.:])/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const questions: MathQuestion[] = [];
  const now = new Date().toISOString();

  chunks.forEach((chunk, idx) => {
    const headerStripped = chunk.replace(/^Câu\s+\d+\s*[.:]\s*/i, '').trim();

    // Tách dòng Đáp án ở cuối nếu có: "Đáp án: A" hoặc "Đáp án đúng: B"
    let declaredCorrect: McqOptionLabel | null = null;
    const answerMatch = headerStripped.match(
      /(?:^|\n)\s*(?:Đáp án(?:\s+đúng)?|ĐA)\s*[:.]\s*([ABCD])\b/i
    );
    const bodyWithoutAns = answerMatch
      ? headerStripped.slice(0, answerMatch.index).trim()
      : headerStripped;
    if (answerMatch) {
      declaredCorrect = answerMatch[1].toUpperCase() as McqOptionLabel;
    }

    // Tìm 4 phương án A. B. C. D.
    const optRegex = /(?:^|\n|\s)([ABCD])\.\s+/g;
    const optMatches: Array<{ label: McqOptionLabel; index: number; contentStart: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = optRegex.exec(bodyWithoutAns)) !== null) {
      const lbl = match[1].toUpperCase() as McqOptionLabel;
      const contentStart = match.index + match[0].length;
      optMatches.push({ label: lbl, index: match.index, contentStart });
    }

    const qId = createIdFn('mq');
    const code = `IMP-${String(idx + 1).padStart(2, '0')}`;

    // Nếu tìm thấy đủ A, B, C, D theo thứ tự
    const hasFourOpts =
      optMatches.length >= 4 &&
      optMatches.slice(-4).map((m) => m.label).join('') === 'ABCD';

    if (hasFourOpts) {
      const lastFour = optMatches.slice(-4);
      const stemText = bodyWithoutAns.slice(0, lastFour[0].index).trim();
      const optionTexts = lastFour.map((m, oIdx) => {
        const endIdx = oIdx < 3 ? lastFour[oIdx + 1].index : bodyWithoutAns.length;
        return bodyWithoutAns.slice(m.contentStart, endIdx).trim();
      });

      const correctIndex = declaredCorrect ? MCQ_LABELS.indexOf(declaredCorrect) : 0;
      const resolvedCorrectIdx = correctIndex >= 0 ? correctIndex : 0;

      const options: McqOption[] = optionTexts.map((txt, oIdx) => ({
        id: `${qId}-opt-${oIdx + 1}`,
        originalLabel: MCQ_LABELS[oIdx],
        content: parseMathContent(txt, `${qId}-o${oIdx + 1}`),
        isCorrect: oIdx === resolvedCorrectIdx,
      }));

      const depFlags = detectDependentOptions(options);
      if (!declaredCorrect) {
        warnings.push(
          `Câu nhập #${idx + 1} (${code}) chưa ghi "Đáp án: A/B/C/D" — tạm gán A và yêu cầu giáo viên xác nhận ở Bước 2.`
        );
      }

      questions.push({
        id: qId,
        code,
        sectionTitle: MATH_SECTION_TITLES.mcq,
        type: 'mcq',
        topic: 'Hàm số & Đạo hàm',
        cognitiveLevel: 'thong-hieu',
        difficultyScore: 2,
        points: 0.25,
        stem: parseMathContent(stemText, `${qId}-stem`),
        options,
        correctOptionId: options[resolvedCorrectIdx].id,
        solutionGuide: parseMathContent('', `${qId}-sol`),
        lockQuestionPosition: false,
        lockOptionShuffle: depFlags.length > 0,
        allowStatementShuffle: false,
        dependencyFlags: depFlags,
        hasVisualAsset: false,
        answerConfirmed: Boolean(declaredCorrect),
        createdAt: now,
        updatedAt: now,
      });
    } else {
      warnings.push(
        `Câu nhập #${idx + 1} (${code}) không khớp đủ 4 phương án A./B./C./D. — đã nhập dưới dạng câu Trả lời ngắn để giáo viên rà soát.`
      );
      questions.push({
        id: qId,
        code,
        sectionTitle: MATH_SECTION_TITLES['short-answer'],
        type: 'short-answer',
        topic: 'Khác',
        cognitiveLevel: 'thong-hieu',
        difficultyScore: 2,
        points: 0.5,
        stem: parseMathContent(bodyWithoutAns, `${qId}-stem`),
        shortAnswer: {
          answerValue: '',
          acceptedFormats: [],
          unit: '',
          domainCondition: '',
        },
        solutionGuide: parseMathContent('', `${qId}-sol`),
        lockQuestionPosition: false,
        lockOptionShuffle: true,
        allowStatementShuffle: false,
        dependencyFlags: [],
        hasVisualAsset: false,
        answerConfirmed: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  return {
    questions,
    warnings,
    hasSuspiciousOmmlArtifacts,
  };
}
