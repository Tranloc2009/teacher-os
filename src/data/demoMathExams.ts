import {
  CognitiveLevel,
  MATH_SECTION_TITLES,
  MathExamProject,
  MathQuestion,
  MathQuestionType,
  MathVisualAsset,
  McqOption,
  QuestionGroup,
  TrueFalseStatement,
} from '../types/mathExam';
import {
  MCQ_LABELS,
  TF_LABELS,
  createMathVisualAsset,
  detectDependentOptions,
  parseMathContent,
} from '../core/mathIntegrity';

export const PRESET_VARIATION_TABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 150" width="460" height="150" role="img" aria-label="Bảng biến thiên hàm phân thức bậc nhất trên bậc nhất">
  <rect x="4" y="4" width="452" height="142" fill="#ffffff" stroke="#334155" stroke-width="1.5"/>
  <line x1="4" y1="36" x2="456" y2="36" stroke="#334155" stroke-width="1.2"/>
  <line x1="4" y1="72" x2="456" y2="72" stroke="#334155" stroke-width="1.2"/>
  <line x1="74" y1="4" x2="74" y2="146" stroke="#334155" stroke-width="1.2"/>
  <line x1="262" y1="36" x2="262" y2="146" stroke="#0f172a" stroke-width="1.4"/>
  <line x1="267" y1="36" x2="267" y2="146" stroke="#0f172a" stroke-width="1.4"/>
  <text x="39" y="25" font-family="serif" font-size="14" font-style="italic" text-anchor="middle" fill="#0f172a">x</text>
  <text x="96" y="25" font-family="serif" font-size="13" text-anchor="middle" fill="#0f172a">-∞</text>
  <text x="170" y="25" font-family="serif" font-size="13" text-anchor="middle" fill="#0f172a">0</text>
  <text x="265" y="25" font-family="serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#0f172a">1</text>
  <text x="355" y="25" font-family="serif" font-size="13" text-anchor="middle" fill="#0f172a">2</text>
  <text x="432" y="25" font-family="serif" font-size="13" text-anchor="middle" fill="#0f172a">+∞</text>
  <text x="39" y="59" font-family="serif" font-size="14" font-style="italic" text-anchor="middle" fill="#0f172a">f'(x)</text>
  <text x="130" y="59" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#0f172a">+</text>
  <text x="170" y="59" font-family="serif" font-size="13" text-anchor="middle" fill="#0f172a">0</text>
  <text x="215" y="59" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#0f172a">-</text>
  <text x="310" y="59" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#0f172a">-</text>
  <text x="355" y="59" font-family="serif" font-size="13" text-anchor="middle" fill="#0f172a">0</text>
  <text x="398" y="59" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#0f172a">+</text>
  <text x="39" y="113" font-family="serif" font-size="14" font-style="italic" text-anchor="middle" fill="#0f172a">f(x)</text>
  <text x="98" y="135" font-family="serif" font-size="12" text-anchor="middle" fill="#0f172a">-∞</text>
  <text x="170" y="92" font-family="serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#0f172a">-2</text>
  <text x="242" y="135" font-family="serif" font-size="12" text-anchor="middle" fill="#0f172a">-∞</text>
  <text x="288" y="92" font-family="serif" font-size="12" text-anchor="middle" fill="#0f172a">+∞</text>
  <text x="355" y="135" font-family="serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#0f172a">2</text>
  <text x="432" y="92" font-family="serif" font-size="12" text-anchor="middle" fill="#0f172a">+∞</text>
  <line x1="112" y1="128" x2="155" y2="92" stroke="#1e293b" stroke-width="1.3"/>
  <line x1="185" y1="92" x2="226" y2="128" stroke="#1e293b" stroke-width="1.3"/>
  <line x1="302" y1="92" x2="342" y2="128" stroke="#1e293b" stroke-width="1.3"/>
  <line x1="368" y1="128" x2="416" y2="92" stroke="#1e293b" stroke-width="1.3"/>
</svg>`;

export const PRESET_GEOMETRY_PYRAMID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 200" width="280" height="200" role="img" aria-label="Hình chóp S.ABCD có SA vuông góc với đáy">
  <polygon points="85,155 215,155 245,115 115,115" fill="none" stroke="#1e293b" stroke-width="1.5"/>
  <line x1="85" y1="155" x2="115" y2="115" stroke="#1e293b" stroke-width="1.4" stroke-dasharray="5,4"/>
  <line x1="115" y1="115" x2="245" y2="115" stroke="#1e293b" stroke-width="1.4" stroke-dasharray="5,4"/>
  <line x1="115" y1="30" x2="115" y2="115" stroke="#1e293b" stroke-width="1.5" stroke-dasharray="5,4"/>
  <line x1="115" y1="30" x2="85" y2="155" stroke="#0f172a" stroke-width="1.6"/>
  <line x1="115" y1="30" x2="215" y2="155" stroke="#0f172a" stroke-width="1.6"/>
  <line x1="115" y1="30" x2="245" y2="115" stroke="#0f172a" stroke-width="1.6"/>
  <text x="112" y="22" font-family="serif" font-size="14" font-weight="bold" fill="#0f172a">S</text>
  <text x="100" y="114" font-family="serif" font-size="13" fill="#0f172a">A</text>
  <text x="72" y="168" font-family="serif" font-size="13" fill="#0f172a">B</text>
  <text x="218" y="168" font-family="serif" font-size="13" fill="#0f172a">C</text>
  <text x="250" y="118" font-family="serif" font-size="13" fill="#0f172a">D</text>
</svg>`;

export const VISUAL_ASSET_PRESETS: Array<{
  key: string;
  kind: MathVisualAsset['kind'];
  label: string;
  sourceData: string;
  altText: string;
}> = [
  {
    key: 'variation-table',
    kind: 'variation-table',
    label: 'Bảng biến thiên hàm số f(x)',
    sourceData: PRESET_VARIATION_TABLE_SVG,
    altText: 'Bảng biến thiên hàm số bậc hai trên bậc nhất tại x=1',
  },
  {
    key: 'geometry-pyramid',
    kind: 'geometry-svg',
    label: 'Hình chóp S.ABCD (SA ⊥ đáy)',
    sourceData: PRESET_GEOMETRY_PYRAMID_SVG,
    altText: 'Hình chóp S.ABCD có SA vuông góc mặt đáy ABCD',
  },
  {
    key: 'data-table',
    kind: 'data-table',
    label: 'Bảng phân bố tần số mẫu số liệu ghép nhóm',
    sourceData: 'Nhóm: [10;20) | [20;30) | [30;40) | [40;50)\nTần số: 4 | 10 | 12 | 4',
    altText: 'Bảng số liệu ghép nhóm mẫu thống kê n=30',
  },
];

function makeMcqQuestion(params: {
  id: string;
  code: string;
  topic: string;
  cognitiveLevel: CognitiveLevel;
  stem: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  solutionGuide?: string;
  lockQuestionPosition?: boolean;
  lockOptionShuffle?: boolean;
  groupId?: string;
  visualAssets?: MathVisualAsset[];
}): MathQuestion {
  const now = '2025-10-15T08:00:00.000Z';
  const builtOptions: McqOption[] = params.options.map((text, idx) => ({
    id: `${params.id}-opt-${idx + 1}`,
    originalLabel: MCQ_LABELS[idx],
    content: parseMathContent(text, `${params.id}-o${idx + 1}`),
    isCorrect: idx === params.correctIndex,
  }));
  const depFlags = detectDependentOptions(builtOptions);

  return {
    id: params.id,
    code: params.code,
    sectionTitle: MATH_SECTION_TITLES.mcq,
    type: 'mcq',
    topic: params.topic,
    cognitiveLevel: params.cognitiveLevel,
    difficultyScore:
      params.cognitiveLevel === 'nhan-biet'
        ? 1
        : params.cognitiveLevel === 'thong-hieu'
        ? 2
        : params.cognitiveLevel === 'van-dung'
        ? 3
        : 4,
    points: 0.25,
    stem: parseMathContent(params.stem, `${params.id}-stem`),
    options: builtOptions,
    correctOptionId: builtOptions[params.correctIndex].id,
    solutionGuide: parseMathContent(params.solutionGuide ?? '', `${params.id}-sol`),
    lockQuestionPosition: Boolean(params.lockQuestionPosition),
    lockOptionShuffle: Boolean(params.lockOptionShuffle) || depFlags.length > 0,
    allowStatementShuffle: false,
    dependencyFlags: depFlags,
    visualAssets: params.visualAssets ?? [],
    hasVisualAsset: Boolean(params.visualAssets && params.visualAssets.length > 0),
    groupId: params.groupId,
    answerConfirmed: true,
    createdAt: now,
    updatedAt: now,
  };
}

function makeTrueFalseQuestion(params: {
  id: string;
  code: string;
  topic: string;
  cognitiveLevel: CognitiveLevel;
  stem: string;
  statements: Array<{ text: string; isTrue: boolean }>;
  allowStatementShuffle?: boolean;
  solutionGuide?: string;
  visualAssets?: MathVisualAsset[];
}): MathQuestion {
  const now = '2025-10-15T08:00:00.000Z';
  const builtStatements: TrueFalseStatement[] = params.statements.map((st, idx) => ({
    id: `${params.id}-st-${idx + 1}`,
    originalLabel: TF_LABELS[idx],
    content: parseMathContent(st.text, `${params.id}-s${idx + 1}`),
    isTrue: st.isTrue,
  }));

  return {
    id: params.id,
    code: params.code,
    sectionTitle: MATH_SECTION_TITLES['true-false'],
    type: 'true-false',
    topic: params.topic,
    cognitiveLevel: params.cognitiveLevel,
    difficultyScore:
      params.cognitiveLevel === 'nhan-biet'
        ? 1
        : params.cognitiveLevel === 'thong-hieu'
        ? 2
        : params.cognitiveLevel === 'van-dung'
        ? 3
        : 4,
    points: 1,
    stem: parseMathContent(params.stem, `${params.id}-stem`),
    statements: builtStatements,
    solutionGuide: parseMathContent(params.solutionGuide ?? '', `${params.id}-sol`),
    lockQuestionPosition: false,
    lockOptionShuffle: false,
    allowStatementShuffle: Boolean(params.allowStatementShuffle),
    dependencyFlags: [],
    visualAssets: params.visualAssets ?? [],
    hasVisualAsset: Boolean(params.visualAssets && params.visualAssets.length > 0),
    answerConfirmed: true,
    createdAt: now,
    updatedAt: now,
  };
}

function makeShortAnswerQuestion(params: {
  id: string;
  code: string;
  topic: string;
  cognitiveLevel: CognitiveLevel;
  stem: string;
  answerValue: string;
  unit?: string;
  domainCondition?: string;
  solutionGuide?: string;
}): MathQuestion {
  const now = '2025-10-15T08:00:00.000Z';
  return {
    id: params.id,
    code: params.code,
    sectionTitle: MATH_SECTION_TITLES['short-answer'],
    type: 'short-answer',
    topic: params.topic,
    cognitiveLevel: params.cognitiveLevel,
    difficultyScore:
      params.cognitiveLevel === 'van-dung-cao'
        ? 4
        : params.cognitiveLevel === 'van-dung'
        ? 3
        : 2,
    points: 0.5,
    stem: parseMathContent(params.stem, `${params.id}-stem`),
    shortAnswer: {
      answerValue: params.answerValue,
      acceptedFormats: [params.answerValue],
      unit: params.unit ?? '',
      domainCondition: params.domainCondition ?? '',
    },
    solutionGuide: parseMathContent(params.solutionGuide ?? '', `${params.id}-sol`),
    lockQuestionPosition: false,
    lockOptionShuffle: true,
    allowStatementShuffle: false,
    dependencyFlags: [],
    hasVisualAsset: false,
    answerConfirmed: true,
    createdAt: now,
    updatedAt: now,
  };
}

function makeEssayQuestion(params: {
  id: string;
  code: string;
  topic: string;
  cognitiveLevel: CognitiveLevel;
  stem: string;
  parts: Array<{ label: string; text: string; points: number; outline: string }>;
  solutionGuide: string;
}): MathQuestion {
  const now = '2025-10-15T08:00:00.000Z';
  const totalPoints = params.parts.reduce((s, p) => s + p.points, 0);
  return {
    id: params.id,
    code: params.code,
    sectionTitle: MATH_SECTION_TITLES.essay,
    type: 'essay',
    topic: params.topic,
    cognitiveLevel: params.cognitiveLevel,
    difficultyScore: 3,
    points: totalPoints,
    stem: parseMathContent(params.stem, `${params.id}-stem`),
    essayParts: params.parts.map((p, idx) => ({
      id: `${params.id}-part-${idx + 1}`,
      label: p.label,
      content: parseMathContent(p.text, `${params.id}-p${idx + 1}`),
      points: p.points,
      solutionOutline: parseMathContent(p.outline, `${params.id}-po${idx + 1}`),
    })),
    solutionGuide: parseMathContent(params.solutionGuide, `${params.id}-sol`),
    lockQuestionPosition: false,
    lockOptionShuffle: true,
    allowStatementShuffle: false,
    dependencyFlags: [],
    hasVisualAsset: false,
    answerConfirmed: true,
    createdAt: now,
    updatedAt: now,
  };
}

const DEMO_THPT_QUESTIONS: MathQuestion[] = [
  makeMcqQuestion({
    id: 'mq-demo-01',
    code: 'NB-01',
    topic: 'Hàm số & Đạo hàm',
    cognitiveLevel: 'nhan-biet',
    stem: 'Tập xác định $D$ của hàm số $y = \\frac{2x - 1}{x + 1}$ là:',
    options: [
      '$D = \\mathbb{R} \\setminus \\{-1\\}$',
      '$D = \\mathbb{R} \\setminus \\{1\\}$',
      '$D = (-1; +\\infty)$',
      '$D = \\mathbb{R}$',
    ],
    correctIndex: 0,
    solutionGuide: 'Mẫu số $x + 1 \\neq 0 \\Leftrightarrow x \\neq -1$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-02',
    code: 'NB-02',
    topic: 'Mũ & Logarit',
    cognitiveLevel: 'nhan-biet',
    stem: 'Nghiệm của phương trình $\\log_2(x - 1) = 3$ là:',
    options: ['$x = 7$', '$x = 9$', '$x = 10$', '$x = 8$'],
    correctIndex: 1,
    solutionGuide: 'Điều kiện $x > 1$. Phương trình tương đương $x - 1 = 2^3 = 8 \\Leftrightarrow x = 9$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-03',
    code: 'NB-03',
    topic: 'Nguyên hàm & Tích phân',
    cognitiveLevel: 'nhan-biet',
    stem: 'Tính tích phân $I = \\int_{0}^{1} (3x^2 + 2x)\\,dx$.',
    options: ['$I = 2$', '$I = 3$', '$I = 1$', '$I = 5$'],
    correctIndex: 0,
    solutionGuide: '$I = \\left.(x^3 + x^2)\\right|_0^1 = 1 + 1 = 2$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-04',
    code: 'NB-04',
    topic: 'Hình học không gian Oxyz',
    cognitiveLevel: 'nhan-biet',
    stem: 'Trong không gian $Oxyz$, cho $\\vec{u} = (1; -2; 3)$ và $\\vec{v} = (-2; 1; 4)$. Tọa độ của vectơ $\\vec{u} + \\vec{v}$ là:',
    options: ['$(-1; -1; 7)$', '$(3; -3; -1)$', '$(-1; 1; 7)$', '$(-1; -1; 1)$'],
    correctIndex: 0,
    solutionGuide: 'Cộng từng tọa độ tương ứng: $(1-2; -2+1; 3+4) = (-1; -1; 7)$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-05',
    code: 'TH-05',
    topic: 'Hàm số & Đạo hàm',
    cognitiveLevel: 'thong-hieu',
    stem: 'Tính giới hạn $L = \\lim_{x \\to 2} \\frac{x^2 - 4}{x - 2}$.',
    options: ['$L = 0$', '$L = 2$', '$L = 4$', '$L = +\\infty$'],
    correctIndex: 2,
    solutionGuide: '$\\frac{x^2 - 4}{x - 2} = x + 2$ với $x \\neq 2$, suy ra $L = 2 + 2 = 4$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-06',
    code: 'TH-06',
    topic: 'Phương trình & Bất phương trình',
    cognitiveLevel: 'thong-hieu',
    stem: 'Hệ phương trình $\\begin{cases} 2x + y = 5 \\\\ x - y = 1 \\end{cases}$ có nghiệm $(x_0; y_0)$ là:',
    options: ['$(2; 1)$', '$(1; 2)$', '$(3; -1)$', '$(-2; 9)$'],
    correctIndex: 0,
    solutionGuide: 'Cộng hai phương trình được $3x = 6 \\Leftrightarrow x = 2$, suy ra $y = 1$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-07',
    code: 'TH-07',
    topic: 'Hình học phẳng & Lượng giác',
    cognitiveLevel: 'thong-hieu',
    stem: 'Biết $\\sin x = \\frac{3}{5}$ với $\\frac{\\pi}{2} < x < \\pi$. Giá trị của $\\cos x$ bằng:',
    options: ['$\\frac{4}{5}$', '$-\\frac{4}{5}$', '$-\\frac{3}{5}$', '$\\frac{16}{25}$'],
    correctIndex: 1,
    solutionGuide: 'Vì $\\sin^2 x + \\cos^2 x = 1$ và $x \\in (\\frac{\\pi}{2}; \\pi)$ nên $\\cos x < 0 \\Rightarrow \\cos x = -\\frac{4}{5}$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-08',
    code: 'TH-08',
    topic: 'Xác suất & Thống kê',
    cognitiveLevel: 'thong-hieu',
    stem: 'Gieo một con xúc xắc cân đối đồng chất hai lần. Xác suất để tổng số chấm bằng $7$ là:',
    options: ['$\\frac{1}{6}$', '$\\frac{1}{12}$', '$\\frac{5}{36}$', '$\\frac{7}{36}$'],
    correctIndex: 0,
    solutionGuide: 'Có 6 cặp thuận lợi trên $n(\\Omega) = 36$, xác suất $P = \\frac{6}{36} = \\frac{1}{6}$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-09',
    code: 'VD-09',
    topic: 'Hàm số & Đạo hàm',
    cognitiveLevel: 'van-dung',
    stem: 'Tìm giá trị nhỏ nhất của hàm số $f(x) = \\sqrt{x^2 - 4x + 5}$ trên $\\mathbb{R}$.',
    options: ['$1$', '$2$', '$\\sqrt{5}$', '$0$'],
    correctIndex: 0,
    solutionGuide: '$x^2 - 4x + 5 = (x - 2)^2 + 1 \\ge 1 \\Rightarrow f(x) \\ge 1$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-10',
    code: 'VD-10',
    topic: 'Hàm số & Đạo hàm',
    cognitiveLevel: 'van-dung',
    stem: 'Cho hàm số $y = x^3 - 3x^2 + 2$. Kết luận nào sau đây đúng về các điểm cực trị của hàm số?',
    options: [
      'Hàm số đạt cực đại tại $x = 0$',
      'Hàm số đạt cực tiểu tại $x = 2$',
      'Cả A và B đều đúng',
      'Hàm số không có cực trị',
    ],
    correctIndex: 2,
    lockOptionShuffle: true,
    solutionGuide: '$y\' = 3x^2 - 6x = 0 \\Leftrightarrow x = 0$ (cực đại) hoặc $x = 2$ (cực tiểu). Câu tự động khóa trộn phương án do có "Cả A và B".',
  }),
  makeMcqQuestion({
    id: 'mq-demo-11',
    code: 'VD-11',
    topic: 'Nguyên hàm & Tích phân',
    cognitiveLevel: 'van-dung',
    stem: 'Diện tích hình phẳng giới hạn bởi đồ thị $y = x^2 - 2x$ và trục hoành bằng:',
    options: ['$\\frac{4}{3}$', '$\\frac{2}{3}$', '$\\frac{8}{3}$', '$2$'],
    correctIndex: 0,
    solutionGuide: '$S = \\int_0^2 |x^2 - 2x|\\,dx = \\int_0^2 (2x - x^2)\\,dx = \\frac{4}{3}$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-12',
    code: 'VDC-12',
    topic: 'Hàm số & Đạo hàm',
    cognitiveLevel: 'van-dung-cao',
    stem: 'Có bao nhiêu giá trị nguyên của tham số $m \\in [-10; 10]$ để hàm số $y = \\frac{x + m}{x - 1}$ nghịch biến trên $(1; +\\infty)$?',
    options: ['$11$', '$10$', '$9$', '$12$'],
    correctIndex: 0,
    lockQuestionPosition: true,
    solutionGuide: '$y\' = \\frac{-1 - m}{(x - 1)^2} < 0 \\Leftrightarrow m > -1$. Với $m \\in \\mathbb{Z} \\cap [-10; 10]$ có $m \\in \\{0; 1; \\dots; 10\\}$ gồm 11 giá trị.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-13',
    code: 'TH-13',
    topic: 'Hình học không gian Oxyz',
    cognitiveLevel: 'thong-hieu',
    groupId: 'grp-demo-chop',
    stem: 'Cho hình chóp $S.ABCD$ có đáy $ABCD$ là hình vuông cạnh $a$, $SA \\perp (ABCD)$ và $SA = a\\sqrt{3}$ (như hình vẽ nhóm). Tính thể tích khối chóp $S.ABCD$.',
    options: [
      '$\\frac{a^3\\sqrt{3}}{3}$',
      '$a^3\\sqrt{3}$',
      '$\\frac{a^3\\sqrt{3}}{2}$',
      '$\\frac{a^3}{3}$',
    ],
    correctIndex: 0,
    solutionGuide: '$V = \\frac{1}{3} S_{ABCD} \\cdot SA = \\frac{1}{3} a^2 \\cdot a\\sqrt{3} = \\frac{a^3\\sqrt{3}}{3}$.',
  }),
  makeMcqQuestion({
    id: 'mq-demo-14',
    code: 'VD-14',
    topic: 'Hình học không gian Oxyz',
    cognitiveLevel: 'van-dung',
    groupId: 'grp-demo-chop',
    stem: 'Tiếp tục giả thiết hình chóp $S.ABCD$ ở nhóm trên, tính góc giữa đường thẳng $SC$ và mặt phẳng đáy $(ABCD)$ (làm tròn đến độ).',
    options: ['$51^\\circ$', '$30^\\circ$', '$45^\\circ$', '$60^\\circ$'],
    correctIndex: 0,
    solutionGuide: '$\\tan\\widehat{SCA} = \\frac{SA}{AC} = \\frac{a\\sqrt{3}}{a\\sqrt{2}} = \\sqrt{\\frac{3}{2}} \\Rightarrow \\widehat{SCA} \\approx 51^\\circ$.',
  }),
  makeTrueFalseQuestion({
    id: 'tf-demo-01',
    code: 'DS-01',
    topic: 'Hàm số & Đạo hàm',
    cognitiveLevel: 'thong-hieu',
    stem: 'Cho hàm số $f(x) = \\frac{x^2 - 2x + 2}{x - 1}$ xác định trên $\\mathbb{R} \\setminus \\{1\\}$ với bảng biến thiên đính kèm. Xét tính đúng sai của các mệnh đề sau:',
    allowStatementShuffle: true,
    visualAssets: [
      createMathVisualAsset({
        id: 'asset-demo-bbt-01',
        kind: 'variation-table',
        label: 'Bảng biến thiên hàm số f(x)',
        sourceData: PRESET_VARIATION_TABLE_SVG,
        altText: 'Bảng biến thiên hàm số f(x) có tiệm cận đứng x=1',
      }),
    ],
    statements: [
      { text: 'Đạo hàm của hàm số là $f\'(x) = \\frac{x^2 - 2x}{(x - 1)^2}$.', isTrue: true },
      { text: 'Đồ thị hàm số có tiệm cận đứng là đường thẳng $x = 1$.', isTrue: true },
      { text: 'Hàm số đồng biến trên khoảng $(0; 2)$.', isTrue: false },
      { text: 'Giá trị cực tiểu của hàm số bằng $2$.', isTrue: true },
    ],
    solutionGuide: 'Các ý a, b, d đúng; ý c sai vì hàm số không xác định tại $x = 1$.',
  }),
  makeTrueFalseQuestion({
    id: 'tf-demo-02',
    code: 'DS-02',
    topic: 'Hình học không gian Oxyz',
    cognitiveLevel: 'van-dung',
    stem: 'Trong không gian $Oxyz$, cho mặt cầu $(S): (x - 1)^2 + (y + 2)^2 + (z - 3)^2 = 16$ và điểm $A(1; 2; 3)$. Xét các khẳng định:',
    allowStatementShuffle: false,
    statements: [
      { text: 'Tâm mặt cầu $(S)$ là $I(1; -2; 3)$ và bán kính $R = 4$.', isTrue: true },
      { text: 'Từ ý a, khoảng cách $IA = 4$ nên điểm $A$ nằm trên mặt cầu $(S)$.', isTrue: true },
      { text: 'Mặt phẳng tiếp diện tại $A$ có vectơ pháp tuyến $\\vec{n} = (0; 1; 0)$.', isTrue: true },
      { text: 'Mặt phẳng $(Oxy)$ cắt $(S)$ theo đường tròn có bán kính $r = \\sqrt{7}$.', isTrue: true },
    ],
    solutionGuide: 'Ý b phụ thuộc vào ý a nên hệ thống khóa thứ tự a/b/c/d.',
  }),
  makeShortAnswerQuestion({
    id: 'sa-demo-01',
    code: 'TLN-01',
    topic: 'Tổ hợp & Dãy số',
    cognitiveLevel: 'van-dung',
    stem: 'Một hộp chứa 5 bi xanh và 4 bi đỏ. Lấy ngẫu nhiên đồng thời 3 viên bi. Tính xác suất để lấy được ít nhất 2 bi xanh (làm tròn kết quả đến hàng phần trăm).',
    answerValue: '0,60',
    domainCondition: 'Kết quả thập phân làm tròn đến 2 chữ số sau dấu phẩy',
    solutionGuide: '$P = \\frac{C_5^2 C_4^1 + C_5^3}{C_9^3} = \\frac{40 + 10}{84} = \\frac{50}{84} \\approx 0,60$.',
  }),
  makeShortAnswerQuestion({
    id: 'sa-demo-02',
    code: 'TLN-02',
    topic: 'Nguyên hàm & Tích phân',
    cognitiveLevel: 'van-dung',
    stem: 'Biết $\\int_1^e \\frac{\\ln x}{x}\\,dx = \\frac{a}{b}$ với $\\frac{a}{b}$ là phân số tối giản và $a, b \\in \\mathbb{N}^*$. Tính giá trị $a + b$.',
    answerValue: '3',
    solutionGuide: 'Đặt $t = \\ln x \\Rightarrow \\int_0^1 t\\,dt = \\frac{1}{2}$, suy ra $a = 1, b = 2 \\Rightarrow a + b = 3$.',
  }),
  makeEssayQuestion({
    id: 'es-demo-01',
    code: 'TL-01',
    topic: 'Mũ & Logarit',
    cognitiveLevel: 'van-dung',
    stem: 'Giải phương trình và bất phương trình sau trên tập số thực $\\mathbb{R}$:',
    parts: [
      {
        label: 'a)',
        text: '$4^x - 5 \\cdot 2^x + 4 = 0$',
        points: 1,
        outline: 'Đặt $t = 2^x > 0$, thu được $t^2 - 5t + 4 = 0 \\Leftrightarrow t = 1$ hoặc $t = 4 \\Rightarrow x = 0$ hoặc $x = 2$.',
      },
      {
        label: 'b)',
        text: '$\\log_{\\frac{1}{2}}(x^2 - 3x + 2) \\ge -1$',
        points: 1,
        outline: 'Điều kiện $x < 1$ hoặc $x > 2$. Giải $0 < x^2 - 3x + 2 \\le 2 \\Leftrightarrow x \\in [0; 1) \\cup (2; 3]$.',
      },
    ],
    solutionGuide: 'Thí sinh phải nêu đầy đủ điều kiện xác định trước khi biến đổi logarit.',
  }),
];

const DEMO_QUESTION_GROUPS: QuestionGroup[] = [
  {
    id: 'grp-demo-chop',
    title: 'Nhóm hình chóp S.ABCD (chung dữ kiện & hình vẽ)',
    sharedContext: parseMathContent(
      'Sử dụng hình vẽ và giả thiết chung cho hai câu sau: Hình chóp $S.ABCD$ có đáy $ABCD$ là hình vuông cạnh $a$, $SA \\perp (ABCD)$ và $SA = a\\sqrt{3}$.',
      'grp-demo-chop-ctx'
    ),
    sharedAssets: [
      createMathVisualAsset({
        id: 'asset-demo-chop-svg',
        kind: 'geometry-svg',
        label: 'Hình chóp S.ABCD (SA ⊥ đáy)',
        sourceData: PRESET_GEOMETRY_PYRAMID_SVG,
        altText: 'Hình chóp S.ABCD có SA vuông góc với đáy ABCD',
      }),
    ],
    questionIds: ['mq-demo-13', 'mq-demo-14'],
    lockGroupPosition: false,
    moveAsUnit: true,
  },
];

export const DEMO_MATH_EXAM: MathExamProject = {
  id: 'math-exam-demo-thpt-2025',
  title: '[DEMO] Đề kiểm tra định kỳ Toán 12 — Cấu trúc GDPT 2018',
  subject: 'Toán học',
  grade: 'Lớp 12',
  durationMinutes: 90,
  schoolYear: '2025 - 2026',
  examTypeLabel: 'KIỂM TRA GIỮA HỌC KỲ I',
  questions: DEMO_THPT_QUESTIONS,
  questionGroups: DEMO_QUESTION_GROUPS,
  mixConfig: {
    level: 2,
    examCount: 4,
    startCodeNumber: 101,
    customCodeNames: [],
    seed: 'toan12-gk1-2025',
    shuffleQuestions: true,
    shuffleMcqOptions: true,
    keepVdcPositions: true,
    preserveTopicRatios: true,
    shufflePerSectionOnly: true,
    shuffleIndependentTrueFalseStatements: false,
    lockedQuestionIds: [],
    matrixRules: [],
  },
  confirmedOriginalAnswers: true,
  generatedVersions: [],
  lastStep: 1,
  status: 'draft',
  isDemo: true,
  createdAt: '2025-10-15T08:00:00.000Z',
  updatedAt: '2025-10-15T08:00:00.000Z',
};

export function createEmptyMathQuestion(
  type: MathQuestionType,
  indexNumber: number,
  createIdFn: (prefix: string) => string
): MathQuestion {
  const now = new Date().toISOString();
  const id = createIdFn('mq');
  const codePrefix =
    type === 'mcq' ? 'TN' : type === 'true-false' ? 'DS' : type === 'short-answer' ? 'TLN' : 'TL';
  const code = `${codePrefix}-${String(indexNumber).padStart(2, '0')}`;

  if (type === 'mcq') {
    const options: McqOption[] = MCQ_LABELS.map((lbl, idx) => ({
      id: `${id}-opt-${idx + 1}`,
      originalLabel: lbl,
      content: parseMathContent('', `${id}-o${idx + 1}`),
      isCorrect: idx === 0,
    }));
    return {
      id,
      code,
      sectionTitle: MATH_SECTION_TITLES.mcq,
      type: 'mcq',
      topic: 'Hàm số & Đạo hàm',
      cognitiveLevel: 'thong-hieu',
      difficultyScore: 2,
      points: 0.25,
      stem: parseMathContent('', `${id}-stem`),
      options,
      correctOptionId: options[0].id,
      solutionGuide: parseMathContent('', `${id}-sol`),
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      hasVisualAsset: false,
      answerConfirmed: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (type === 'true-false') {
    const statements: TrueFalseStatement[] = TF_LABELS.map((lbl, idx) => ({
      id: `${id}-st-${idx + 1}`,
      originalLabel: lbl,
      content: parseMathContent('', `${id}-s${idx + 1}`),
      isTrue: idx < 2,
    }));
    return {
      id,
      code,
      sectionTitle: MATH_SECTION_TITLES['true-false'],
      type: 'true-false',
      topic: 'Hàm số & Đạo hàm',
      cognitiveLevel: 'thong-hieu',
      difficultyScore: 2,
      points: 1,
      stem: parseMathContent('', `${id}-stem`),
      statements,
      solutionGuide: parseMathContent('', `${id}-sol`),
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      hasVisualAsset: false,
      answerConfirmed: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (type === 'short-answer') {
    return {
      id,
      code,
      sectionTitle: MATH_SECTION_TITLES['short-answer'],
      type: 'short-answer',
      topic: 'Tổ hợp & Dãy số',
      cognitiveLevel: 'van-dung',
      difficultyScore: 3,
      points: 0.5,
      stem: parseMathContent('', `${id}-stem`),
      shortAnswer: {
        answerValue: '',
        acceptedFormats: [],
        unit: '',
        domainCondition: '',
      },
      solutionGuide: parseMathContent('', `${id}-sol`),
      lockQuestionPosition: false,
      lockOptionShuffle: true,
      allowStatementShuffle: false,
      dependencyFlags: [],
      hasVisualAsset: false,
      answerConfirmed: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id,
    code,
    sectionTitle: MATH_SECTION_TITLES.essay,
    type: 'essay',
    topic: 'Phương trình & Bất phương trình',
    cognitiveLevel: 'van-dung',
    difficultyScore: 3,
    points: 2,
    stem: parseMathContent('', `${id}-stem`),
    essayParts: [
      {
        id: `${id}-part-1`,
        label: 'a)',
        content: parseMathContent('', `${id}-p1`),
        points: 1,
        solutionOutline: parseMathContent('', `${id}-po1`),
      },
    ],
    solutionGuide: parseMathContent('', `${id}-sol`),
    lockQuestionPosition: false,
    lockOptionShuffle: true,
    allowStatementShuffle: false,
    dependencyFlags: [],
    hasVisualAsset: false,
    answerConfirmed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyMathExamProject(createIdFn: (prefix: string) => string): MathExamProject {
  const now = new Date().toISOString();
  const id = createIdFn('mexam');
  return {
    id,
    title: 'Đề kiểm tra Toán học mới',
    subject: 'Toán học',
    grade: 'Lớp 12',
    durationMinutes: 90,
    schoolYear: '2025 - 2026',
    examTypeLabel: 'ĐỀ KIỂM TRA ĐỊNH KỲ',
    questions: [createEmptyMathQuestion('mcq', 1, createIdFn)],
    mixConfig: {
      level: 2,
      examCount: 4,
      startCodeNumber: 101,
      customCodeNames: [],
      seed: `exam-${Date.now().toString(36)}`,
      shuffleQuestions: true,
      shuffleMcqOptions: true,
      keepVdcPositions: true,
      preserveTopicRatios: true,
      shufflePerSectionOnly: true,
      shuffleIndependentTrueFalseStatements: false,
      lockedQuestionIds: [],
      matrixRules: [],
    },
    confirmedOriginalAnswers: false,
    generatedVersions: [],
    lastStep: 1,
    status: 'draft',
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  };
}
