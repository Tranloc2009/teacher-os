import {
  ExamSubjectId,
  MathBlockKind,
  MathContentBlock,
  MathContentPayload,
  MathQuestion,
  QuestionOriginalSnapshot,
  QuestionTypeMixPolicy,
  SubjectDetectionSuggestion,
  SubjectProfile,
  SubjectProfileOverride,
  UNIVERSAL_QUESTION_TYPE_LABELS,
  UniversalLockState,
  UniversalQuestionType,
} from '../types/mathExam';
import { computeContentHash, parseMathContent } from './mathIntegrity';

function stripVietnameseDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'));
}

export const UNIVERSAL_QUESTION_POLICIES: Record<
  UniversalQuestionType,
  QuestionTypeMixPolicy
> = {
  mcq: {
    type: 'mcq',
    label: UNIVERSAL_QUESTION_TYPE_LABELS.mcq,
    shortLabel: 'TN 1 đáp án',
    supportsOptionShuffle: true,
    supportsInternalItemShuffle: false,
    requiresGroupContext: false,
    defaultLockOptionShuffle: false,
    answerMappingMode: 'option-id',
    policySummary:
      'Cho phép đảo A/B/C/D theo ID ổn định; tự động khóa nếu phát hiện đáp án phụ thuộc ("Cả A và B", "All of the above") hoặc khóa từng phương án.',
  },
  'multi-select': {
    type: 'multi-select',
    label: UNIVERSAL_QUESTION_TYPE_LABELS['multi-select'],
    shortLabel: 'TN nhiều đáp án',
    supportsOptionShuffle: true,
    supportsInternalItemShuffle: false,
    requiresGroupContext: false,
    defaultLockOptionShuffle: false,
    answerMappingMode: 'multi-option-ids',
    policySummary:
      'Đảo danh sách phương án và ánh xạ tập đáp án đúng theo tập ID phương án (sort theo nhãn mới sau trộn).',
  },
  'true-false': {
    type: 'true-false',
    label: UNIVERSAL_QUESTION_TYPE_LABELS['true-false'],
    shortLabel: 'Đúng / Sai',
    supportsOptionShuffle: false,
    supportsInternalItemShuffle: true,
    requiresGroupContext: false,
    defaultLockOptionShuffle: false,
    answerMappingMode: 'statement-id-map',
    policySummary:
      'Mặc định giữ thứ tự a/b/c/d nếu có tham chiếu liên hoàn; chỉ đảo ý khi được bật độc lập và không có phụ thuộc.',
  },
  'short-answer': {
    type: 'short-answer',
    label: UNIVERSAL_QUESTION_TYPE_LABELS['short-answer'],
    shortLabel: 'Trả lời ngắn',
    supportsOptionShuffle: false,
    supportsInternalItemShuffle: false,
    requiresGroupContext: false,
    defaultLockOptionShuffle: true,
    answerMappingMode: 'exact-text',
    policySummary:
      'Không có phương án để đảo; giữ nguyên giá trị số, đơn vị đo lường và điều kiện xác định.',
  },
  'fill-blank': {
    type: 'fill-blank',
    label: UNIVERSAL_QUESTION_TYPE_LABELS['fill-blank'],
    shortLabel: 'Điền khuyết',
    supportsOptionShuffle: false,
    supportsInternalItemShuffle: true,
    requiresGroupContext: false,
    defaultLockOptionShuffle: true,
    answerMappingMode: 'blank-slot-id',
    policySummary:
      'Tuyệt đối khóa thứ tự các chỗ trống {{1}}, {{2}}... trong ngữ liệu; nếu có Word Bank kèm theo thì chỉ đảo vị trí từ trong Word Bank.',
  },
  matching: {
    type: 'matching',
    label: UNIVERSAL_QUESTION_TYPE_LABELS.matching,
    shortLabel: 'Ghép đôi',
    supportsOptionShuffle: false,
    supportsInternalItemShuffle: true,
    requiresGroupContext: false,
    defaultLockOptionShuffle: false,
    answerMappingMode: 'pair-id-map',
    policySummary:
      'Chỉ đảo thứ tự cột B (hoặc theo cấu hình cột) và luôn cập nhật bảng cặp nối theo leftItemId ↔ rightItemId.',
  },
  ordering: {
    type: 'ordering',
    label: UNIVERSAL_QUESTION_TYPE_LABELS.ordering,
    shortLabel: 'Sắp xếp thứ tự',
    supportsOptionShuffle: false,
    supportsInternalItemShuffle: true,
    requiresGroupContext: false,
    defaultLockOptionShuffle: false,
    answerMappingMode: 'rank-id-sequence',
    policySummary:
      'Xáo trộn thứ tự hiển thị các mảnh/bước (nếu bật), giữ nguyên đáp án chuỗi trình tự đúng gắn theo ID từng bước.',
  },
  'reading-comprehension': {
    type: 'reading-comprehension',
    label: UNIVERSAL_QUESTION_TYPE_LABELS['reading-comprehension'],
    shortLabel: 'Đọc hiểu',
    supportsOptionShuffle: true,
    supportsInternalItemShuffle: false,
    requiresGroupContext: true,
    defaultLockOptionShuffle: false,
    answerMappingMode: 'option-id',
    policySummary:
      'Bắt buộc giữ liền khối ngữ liệu/đoạn văn với toàn bộ câu hỏi con; không bao giờ tách câu khỏi đoạn đọc hiểu.',
  },
  essay: {
    type: 'essay',
    label: UNIVERSAL_QUESTION_TYPE_LABELS.essay,
    shortLabel: 'Tự luận',
    supportsOptionShuffle: false,
    supportsInternalItemShuffle: false,
    requiresGroupContext: false,
    defaultLockOptionShuffle: true,
    answerMappingMode: 'rubric-outline',
    policySummary:
      'Bảo toàn đầy đủ các ý nhỏ (a, b, c...), thang điểm và hướng dẫn chấm; không đảo thứ tự ý tự luận.',
  },
  'shared-context': {
    type: 'shared-context',
    label: UNIVERSAL_QUESTION_TYPE_LABELS['shared-context'],
    shortLabel: 'Chung ngữ liệu',
    supportsOptionShuffle: true,
    supportsInternalItemShuffle: false,
    requiresGroupContext: true,
    defaultLockOptionShuffle: false,
    answerMappingMode: 'option-id',
    policySummary:
      'Di chuyển cả nhóm dữ kiện/hình/thí nghiệm như một đơn vị nguyên vẹn hoặc khóa cố định vị trí nhóm.',
  },
};

export const SUBJECT_PROFILES: Record<ExamSubjectId, SubjectProfile> = {
  toan: {
    id: 'toan',
    name: 'Toán học',
    shortName: 'Toán',
    aliases: ['toan', 'toan hoc', 'math', 'mathematics', 'giai tich', 'hinh hoc', 'dai so'],
    protectionLevel: 'strict-math',
    commonQuestionTypes: ['mcq', 'true-false', 'short-answer', 'essay', 'shared-context'],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Câu trắc nghiệm nhiều phương án lựa chọn' },
      { type: 'true-false', title: 'Phần II. Câu trắc nghiệm đúng sai' },
      { type: 'short-answer', title: 'Phần III. Câu trắc nghiệm trả lời ngắn' },
      { type: 'essay', title: 'Phần IV. Tự luận' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'math-omml-latex',
        label: 'OMML / LaTeX / MathML',
        description: 'Phân số, căn thức, mũ/chỉ số dưới, tích phân, giới hạn, ma trận, vectơ.',
        example: '$\\int_0^1 \\frac{x^2}{\\sqrt{x+1}}\\,dx$',
      },
      {
        id: 'math-signs-intervals',
        label: 'Dấu âm, khoảng, tập hợp',
        description: 'Bảo toàn dấu −/+, ngoặc khoảng [a; b), tập hợp ℝ \\ {0}.',
        example: '$(-\\infty; 1) \\cup (1; +\\infty)$',
      },
      {
        id: 'math-variation-geometry',
        label: 'Bảng biến thiên & Hình học',
        description: 'Khóa nguyên vẹn SVG/ảnh bảng biến thiên, đồ thị, hình không gian.',
        example: 'Hình chóp S.ABCD / Bảng biến thiên f\'(x)',
      },
    ],
    groupRules: {
      preferPassageGrouping: false,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: false,
      description: 'Nhóm câu hỏi dùng chung đồ thị, bảng số liệu hoặc giả thiết bài toán được giữ liền khối.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: false,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman / Cambria Math + KaTeX',
    },
    warningRules: [
      'Chặn trộn/xuất nếu phát hiện ký hiệu glyph lỗi Word (PUA), thiếu $ đóng mở hoặc lỗi KaTeX.',
      'Chặn xuất nếu mất ảnh đồ thị, bảng biến thiên hoặc sai hash công thức sau trộn.',
      'Khóa tự động câu có "Cả A và B", "Tất cả đáp án trên", hoặc ý Đúng/Sai tham chiếu chéo.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'vat-ly': {
    id: 'vat-ly',
    name: 'Vật lý',
    shortName: 'Lý',
    aliases: ['vat ly', 'vat li', 'ly', 'li', 'physics'],
    protectionLevel: 'scientific-formula',
    commonQuestionTypes: ['mcq', 'true-false', 'short-answer', 'essay', 'shared-context'],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Trắc nghiệm nhiều phương án lựa chọn' },
      { type: 'true-false', title: 'Phần II. Trắc nghiệm đúng sai' },
      { type: 'short-answer', title: 'Phần III. Câu hỏi trả lời ngắn' },
      { type: 'essay', title: 'Phần IV. Tự luận Vật lý' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'phys-units',
        label: 'Đơn vị đo lường & Tiền tố SI',
        description: 'Bảo toàn m/s², Ω, μF, MeV, kW·h, Hz, độ (°C, K), T, Wb.',
        example: '$E = 220\\text{ V}, R = 100\\,\\Omega$',
      },
      {
        id: 'phys-vectors-greek',
        label: 'Vectơ, Hy Lạp & Hạt nhân',
        description: 'Bảo toàn ω, φ, λ, Δ, α, β, γ, số khối và điện tích hạt nhân.',
        example: '$x = A\\cos(\\omega t + \\varphi)$, $^{235}_{92}\\text{U}$',
      },
      {
        id: 'phys-circuits-graphs',
        label: 'Mạch điện & Đồ thị dao động/sóng',
        description: 'Khóa hình sơ đồ mạch điện, đồ thị u-t / i-t với câu hỏi liên quan.',
        example: 'Mạch RLC nối tiếp / Đồ thị sin',
      },
    ],
    groupRules: {
      preferPassageGrouping: false,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: false,
      description: 'Nhóm câu hỏi theo cùng thí nghiệm hoặc đồ thị/mạch điện di chuyển cùng nhau.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: false,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman / Cambria Math',
    },
    warningRules: [
      'Cảnh báo nếu phát hiện sai khác hoặc mất đơn vị đo lường (m/s, Ω, J, W, V, A) giữa các phương án.',
      'Giữ nguyên chỉ số trên/dưới và ký hiệu Hy Lạp (ω, λ, φ, Δ).',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'hoa-hoc': {
    id: 'hoa-hoc',
    name: 'Hóa học',
    shortName: 'Hóa',
    aliases: ['hoa hoc', 'hoa', 'chemistry'],
    protectionLevel: 'scientific-formula',
    commonQuestionTypes: ['mcq', 'true-false', 'short-answer', 'essay', 'shared-context'],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Trắc nghiệm nhiều phương án lựa chọn' },
      { type: 'true-false', title: 'Phần II. Trắc nghiệm đúng sai' },
      { type: 'short-answer', title: 'Phần III. Tính toán hóa học trả lời ngắn' },
      { type: 'essay', title: 'Phần IV. Tự luận & Phương trình hóa học' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'chem-formulas',
        label: 'Công thức phân tử & Chỉ số dưới',
        description: 'Không làm phẳng H₂SO₄ thành H2SO4; bảo toàn chỉ số nguyên trạng.',
        example: 'H₂SO₄, Fe₂(SO₄)₃, CH₃COOH',
      },
      {
        id: 'chem-ions-isotopes',
        label: 'Ion, điện tích & số oxi hóa',
        description: 'Bảo toàn SO₄²⁻, Fe³⁺, NH₄⁺, [Ag(NH₃)₂]⁺ và số khối đồng vị.',
        example: 'Fe³⁺ + 3OH⁻ → Fe(OH)₃↓',
      },
      {
        id: 'chem-reactions',
        label: 'Phương trình & Mũi tên phản ứng',
        description: 'Bảo toàn hệ số cân bằng, mũi tên thuận nghịch ⇌, ↑, ↓, điều kiện t°, xt.',
        example: '2H₂ + O₂ → 2H₂O',
      },
    ],
    groupRules: {
      preferPassageGrouping: false,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: false,
      description: 'Nhóm câu hỏi theo cùng sơ đồ chuyển hóa hoặc thí nghiệm hóa học không tách rời.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: false,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman / Cambria Math',
    },
    warningRules: [
      'Tuyệt đối không biến đổi chỉ số dưới (₂, ₃, ₄), số mũ ion (²⁺, ⁻) hoặc mũi tên phản ứng (→, ⇌).',
      'Cảnh báo nếu bảng tuần hoàn / sơ đồ thí nghiệm bị tách khỏi câu hỏi.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'sinh-hoc': {
    id: 'sinh-hoc',
    name: 'Sinh học',
    shortName: 'Sinh',
    aliases: ['sinh hoc', 'sinh', 'biology'],
    protectionLevel: 'scientific-formula',
    commonQuestionTypes: ['mcq', 'true-false', 'short-answer', 'shared-context', 'essay'],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Trắc nghiệm nhiều phương án lựa chọn' },
      { type: 'true-false', title: 'Phần II. Trắc nghiệm đúng sai' },
      { type: 'short-answer', title: 'Phần III. Bài tập di truyền / sinh thái trả lời ngắn' },
      { type: 'essay', title: 'Phần IV. Tự luận Sinh học' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'bio-dna-polarity',
        label: 'Chuỗi DNA / RNA & Chiều 5′ → 3′',
        description: 'Bảo toàn cực tính mạch khuôn 3′–5′, 5′–3′, bộ ba codon A-U-G.',
        example: '5′–AUG GCA UUC–3′',
      },
      {
        id: 'bio-genetics',
        label: 'Ký hiệu kiểu gen & phép lai',
        description: 'Bảo toàn chính xác chữ hoa/thường (AaBbDd, XᴬXᵃ, AB/ab) và phép lai P → F₁ → F₂.',
        example: 'P: AaBb × Aabb → F₁',
      },
    ],
    groupRules: {
      preferPassageGrouping: true,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: false,
      description: 'Nhóm câu hỏi theo cùng phả hệ, sơ đồ lai hoặc bảng số liệu thí nghiệm giữ nguyên khối.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: false,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman / Arial',
    },
    warningRules: [
      'Tuyệt đối không tự chuẩn hóa hoa/thường trong ký hiệu alen/kiểu gen (ví dụ AaBb ≠ aabb).',
      'Khóa chặt ảnh phả hệ, tế bào và thứ tự ý trong câu di truyền.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'ngu-van': {
    id: 'ngu-van',
    name: 'Ngữ văn',
    shortName: 'Văn',
    aliases: ['ngu van', 'van', 'van hoc', 'literature'],
    protectionLevel: 'passage-context',
    commonQuestionTypes: ['reading-comprehension', 'short-answer', 'essay', 'mcq'],
    defaultSections: [
      { type: 'reading-comprehension', title: 'Phần I. Đọc hiểu văn bản' },
      { type: 'essay', title: 'Phần II. Làm văn (Nghị luận xã hội & Nghị luận văn học)' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'lit-poetry-lines',
        label: 'Ngắt dòng thơ & Khổ thơ',
        description: 'Giữ nguyên ngắt câu, lùi dòng, dấu câu và tên tác giả/nguồn trích dẫn.',
        example: 'Sóng bắt đầu từ gió\nGió bắt đầu từ đâu?',
      },
      {
        id: 'lit-citations',
        label: 'Trích dẫn nguyên văn',
        description: 'Bảo toàn dấu ngoặc kép, dấu ba chấm [...] và chính tả ngữ liệu gốc.',
        example: '(Trích "Việt Bắc" — Tố Hữu)',
      },
    ],
    groupRules: {
      preferPassageGrouping: true,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: true,
      description: 'Phần Đọc hiểu luôn gắn liền đoạn trích văn bản và khóa thứ tự từ nhận biết đến vận dụng.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: false,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: true,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman / Georgia',
    },
    warningRules: [
      'Cảnh báo nếu giáo viên bật đảo thứ tự các câu hỏi Đọc hiểu vốn tăng dần theo cấp độ.',
      'Giữ nguyên ngắt dòng các đoạn thơ và trích nguồn tác giả.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 0,
      shuffleQuestions: false,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'tieng-anh': {
    id: 'tieng-anh',
    name: 'Tiếng Anh',
    shortName: 'Anh',
    aliases: ['tieng anh', 'anh van', 'english', 'ngoai ngu'],
    protectionLevel: 'passage-context',
    commonQuestionTypes: [
      'mcq',
      'reading-comprehension',
      'fill-blank',
      'ordering',
      'matching',
      'essay',
    ],
    defaultSections: [
      { type: 'mcq', title: 'Section I. Phonetics, Vocabulary & Grammar' },
      { type: 'fill-blank', title: 'Section II. Cloze Test / Gap Filling' },
      { type: 'reading-comprehension', title: 'Section III. Reading Comprehension' },
      { type: 'ordering', title: 'Section IV. Sentence / Dialogue Arrangement & Writing' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'eng-ipa',
        label: 'Ký hiệu phiên âm quốc tế (IPA)',
        description: 'Bảo toàn nguyên trạng ký tự IPA /θ/, /ð/, /ʃ/, /tʃ/, /ə/, /ˈ/ khi phát âm/trọng âm.',
        example: '/ˈkʌltʃə(r)/ · underline stress marks',
      },
      {
        id: 'eng-cloze-markers',
        label: 'Số thứ tự chỗ trống Cloze & Gạch chân',
        description: 'Giữ nguyên (1), (2), (3)... trong đoạn văn Cloze và định dạng gạch chân phát âm/sửa lỗi.',
        example: 'Question (1) — (5) in Cloze Passage',
      },
    ],
    groupRules: {
      preferPassageGrouping: true,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: true,
      description: 'Bài đọc hiểu (Reading), Cloze Test và Listening gắn chặt đoạn văn/audio với nhóm câu hỏi con.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: true,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: true,
      fontRecommendation: 'Times New Roman / Calibri (Unicode IPA)',
    },
    warningRules: [
      'Phát hiện & khóa phương án phụ thuộc tiếng Anh: "Both A and B", "All of the above", "None of the above".',
      'Không tách nhóm Reading Comprehension / Cloze Test khỏi đoạn văn gốc.',
      'Giữ nguyên thứ tự câu hỏi tương ứng chỗ trống (1), (2), (3) trong bài Cloze.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'lich-su': {
    id: 'lich-su',
    name: 'Lịch sử',
    shortName: 'Sử',
    aliases: ['lich su', 'su', 'history'],
    protectionLevel: 'chronology-data',
    commonQuestionTypes: ['mcq', 'true-false', 'reading-comprehension', 'ordering', 'essay'],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Trắc nghiệm nhiều phương án lựa chọn' },
      { type: 'true-false', title: 'Phần II. Trắc nghiệm đúng sai theo tư liệu' },
      { type: 'essay', title: 'Phần III. Tự luận Lịch sử' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'hist-dates-timeline',
        label: 'Mốc thời gian & Văn kiện lịch sử',
        description: 'Bảo toàn năm, ngày/tháng, số liệu niên đại và tên nhân vật/địa danh.',
        example: '19/8/1945 · Chiến dịch Điện Biên Phủ 1954',
      },
    ],
    groupRules: {
      preferPassageGrouping: true,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: true,
      description: 'Tư liệu lịch sử dùng chung và câu hỏi sắp xếp tiến trình thời gian giữ nguyên tính liên kết.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: false,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman',
    },
    warningRules: [
      'Giữ nguyên nhóm câu hỏi gắn với cùng đoạn tư liệu lịch sử.',
      'Bảo toàn chính xác mốc năm và thứ tự các sự kiện trong dạng sắp xếp trình tự.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'dia-ly': {
    id: 'dia-ly',
    name: 'Địa lý',
    shortName: 'Địa',
    aliases: ['dia ly', 'dia li', 'dia', 'geography'],
    protectionLevel: 'chronology-data',
    commonQuestionTypes: ['mcq', 'true-false', 'short-answer', 'shared-context', 'essay'],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Trắc nghiệm nhiều phương án lựa chọn' },
      { type: 'true-false', title: 'Phần II. Trắc nghiệm đúng sai' },
      { type: 'short-answer', title: 'Phần III. Tính toán số liệu Địa lý trả lời ngắn' },
      { type: 'essay', title: 'Phần IV. Biểu đồ & Nhận xét bảng số liệu' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'geo-tables-charts',
        label: 'Bảng số liệu, biểu đồ & đơn vị',
        description: 'Giữ nguyên đơn vị nghìn tấn, tỉ kWh, triệu dân, ‰, %, °C, mm và bản đồ.',
        example: 'Năng suất = Sản lượng / Diện tích (tạ/ha)',
      },
    ],
    groupRules: {
      preferPassageGrouping: true,
      lockInternalGroupOrder: false,
      preserveStanzaOrChronology: false,
      description: 'Câu hỏi dùng chung bảng số liệu, biểu đồ hoặc bản đồ Atlat di chuyển thành nhóm nguyên vẹn.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: false,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman / Arial',
    },
    warningRules: [
      'Cảnh báo nếu bảng số liệu hoặc biểu đồ thiếu chú giải / đơn vị tính.',
      'Không tách câu trả lời ngắn tính số liệu khỏi bảng số liệu nguồn.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'gdkt-pl': {
    id: 'gdkt-pl',
    name: 'Giáo dục Kinh tế & Pháp luật',
    shortName: 'GDKT&PL',
    aliases: ['gdkt', 'gdkt pl', 'gdkt&pl', 'gdcd', 'kinh te phap luat', 'giao duc cong dan'],
    protectionLevel: 'passage-context',
    commonQuestionTypes: ['mcq', 'true-false', 'reading-comprehension', 'essay'],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Trắc nghiệm nhiều phương án lựa chọn' },
      { type: 'true-false', title: 'Phần II. Trắc nghiệm đúng sai theo tình huống pháp luật' },
      { type: 'essay', title: 'Phần III. Tự luận xử lý tình huống' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'law-articles',
        label: 'Điều luật & Tình huống thực tiễn',
        description: 'Bảo toàn trích dẫn điều khoản, tình huống nhân vật A/B/C và dữ kiện pháp lý.',
        example: 'Tình huống: Ông M, bà H ký hợp đồng...',
      },
    ],
    groupRules: {
      preferPassageGrouping: true,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: false,
      description: 'Các câu hỏi chung một tình huống kinh tế / pháp luật luôn giữ liền nhóm.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: false,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman',
    },
    warningRules: [
      'Khóa chặt chùm câu hỏi cùng tình huống nhân vật (thông tin chung cho câu 1, 2, 3...).',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'tin-hoc': {
    id: 'tin-hoc',
    name: 'Tin học',
    shortName: 'Tin',
    aliases: ['tin hoc', 'tin', 'informatics', 'computer science', 'lap trinh', 'python', 'sql'],
    protectionLevel: 'code-logic',
    commonQuestionTypes: ['mcq', 'true-false', 'ordering', 'fill-blank', 'essay'],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Trắc nghiệm kiến thức chung & Thuật toán' },
      { type: 'true-false', title: 'Phần II. Trắc nghiệm đúng sai theo đoạn mã / CSDL' },
      { type: 'essay', title: 'Phần III. Viết thuật toán / Truy vấn SQL / HTML' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'cs-code-indent',
        label: 'Thụt lề mã nguồn (Python/C++/SQL/HTML)',
        description: 'Bảo toàn tuyệt đối thụt lề, toán tử <=, !=, ==, chuỗi nhị phân/hex và sơ đồ khối.',
        example: 'for i in range(n):\n    if a[i] % 2 == 0:',
      },
    ],
    groupRules: {
      preferPassageGrouping: true,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: true,
      description: 'Câu hỏi đọc hiểu cùng đoạn chương trình hoặc lược đồ CSDL di chuyển thành một khối.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: true,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: true,
      preserveIpaPhonetics: false,
      fontRecommendation: 'JetBrains Mono / Consolas (cho code) + Times New Roman',
    },
    warningRules: [
      'Không tự động cắt khoảng trắng đầu dòng hoặc đổi ngoặc kép/toán tử trong khối mã nguồn.',
      'Giữ nguyên hình sơ đồ khối thuật toán (flowchart) và bảng chân trị logic.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  'cong-nghe': {
    id: 'cong-nghe',
    name: 'Công nghệ',
    shortName: 'Công nghệ',
    aliases: ['cong nghe', 'technology', 'ky thuat', 've ky thuat'],
    protectionLevel: 'scientific-formula',
    commonQuestionTypes: ['mcq', 'true-false', 'matching', 'shared-context', 'essay'],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Trắc nghiệm nhiều phương án lựa chọn' },
      { type: 'true-false', title: 'Phần II. Trắc nghiệm đúng sai' },
      { type: 'essay', title: 'Phần III. Bản vẽ / Mạch điện / Quy trình kỹ thuật' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'tech-drawings',
        label: 'Bản vẽ kỹ thuật, mạch điện & dung sai',
        description: 'Giữ nguyên ký hiệu hình chiếu, sơ đồ mạch điện 3 pha và đơn vị kỹ thuật.',
        example: 'U_d = √3 · U_p (380V / 220V)',
      },
    ],
    groupRules: {
      preferPassageGrouping: true,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: true,
      description: 'Hình vẽ kỹ thuật và quy trình bước công nghệ luôn gắn liền nhóm câu hỏi.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: false,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman / Arial',
    },
    warningRules: [
      'Kiểm tra nguyên vẹn hình bản vẽ kỹ thuật và mạch điện trước khi trộn và xuất.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
  khac: {
    id: 'khac',
    name: 'Môn học khác',
    shortName: 'Khác',
    aliases: ['khac', 'other', 'mon hoc khac', 'tong hop'],
    protectionLevel: 'flexible',
    commonQuestionTypes: [
      'mcq',
      'multi-select',
      'true-false',
      'short-answer',
      'fill-blank',
      'matching',
      'ordering',
      'reading-comprehension',
      'essay',
    ],
    defaultSections: [
      { type: 'mcq', title: 'Phần I. Trắc nghiệm khách quan' },
      { type: 'true-false', title: 'Phần II. Câu hỏi Đúng / Sai' },
      { type: 'essay', title: 'Phần III. Tự luận' },
    ],
    protectedSymbolPatterns: [
      {
        id: 'other-general',
        label: 'Công thức, bảng biểu & hình ảnh đính kèm',
        description: 'Vẫn giữ nguyên nguyên tắc bất biến dữ liệu gốc và tài nguyên trực quan.',
        example: 'OMML / LaTeX / Hình ảnh / Bảng',
      },
    ],
    groupRules: {
      preferPassageGrouping: true,
      lockInternalGroupOrder: true,
      preserveStanzaOrChronology: false,
      description: 'Cho phép tùy chỉnh quy tắc nhóm câu hỏi linh hoạt theo đặc thù môn.',
    },
    answerConstraints: {
      detectEnglishDependentOptions: true,
      detectCrossStatementRefs: true,
      lockSequenceDependentOrdering: true,
    },
    presentationRules: {
      preserveLineBreaksInPoetryOrCode: false,
      preserveIpaPhonetics: false,
      fontRecommendation: 'Times New Roman / Arial',
    },
    warningRules: [
      'Chế độ linh hoạt: giáo viên tự kiểm tra các nhóm ngữ liệu đặc thù trước khi xuất hàng loạt.',
    ],
    defaultMixPolicy: {
      recommendedLevel: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      shufflePerSectionOnly: true,
      lockSharedPassageGroups: true,
    },
  },
};

const SUBJECT_ORDER: ExamSubjectId[] = [
  'toan',
  'vat-ly',
  'hoa-hoc',
  'sinh-hoc',
  'ngu-van',
  'tieng-anh',
  'lich-su',
  'dia-ly',
  'gdkt-pl',
  'tin-hoc',
  'cong-nghe',
  'khac',
];

export function listSubjectProfiles(): SubjectProfile[] {
  return SUBJECT_ORDER.map((id) => SUBJECT_PROFILES[id]);
}

export function resolveSubjectId(input?: string | null): ExamSubjectId {
  if (!input || !input.trim()) return 'toan';
  const rawTrimmed = input.trim();
  if ((SUBJECT_ORDER as string[]).includes(rawTrimmed)) {
    return rawTrimmed as ExamSubjectId;
  }

  const normalized = stripVietnameseDiacritics(rawTrimmed).toLowerCase().replace(/\s+/g, ' ');

  for (const id of SUBJECT_ORDER) {
    const profile = SUBJECT_PROFILES[id];
    const normName = stripVietnameseDiacritics(profile.name).toLowerCase();
    const normShort = stripVietnameseDiacritics(profile.shortName).toLowerCase();
    if (
      normalized === id ||
      normalized === normName ||
      normalized === normShort ||
      profile.aliases.some((alias) => normalized === alias)
    ) {
      return id;
    }
  }

  // Fuzzy prefix/substring fallback (specific keywords only)
  for (const id of SUBJECT_ORDER) {
    if (id === 'khac') continue;
    const profile = SUBJECT_PROFILES[id];
    if (profile.aliases.some((alias) => alias.length >= 4 && normalized.includes(alias))) {
      return id;
    }
  }

  return 'khac';
}

export function getSubjectProfile(idOrName?: string | null): SubjectProfile {
  const id = resolveSubjectId(idOrName);
  return SUBJECT_PROFILES[id];
}

export function mergeSubjectProfileOverrides(
  base: SubjectProfile,
  overrides?: SubjectProfileOverride
): SubjectProfile {
  if (!overrides) return base;
  return {
    ...base,
    groupRules: {
      ...base.groupRules,
      lockInternalGroupOrder:
        overrides.lockInternalGroupOrder ?? base.groupRules.lockInternalGroupOrder,
    },
    answerConstraints: {
      ...base.answerConstraints,
      detectEnglishDependentOptions:
        overrides.detectEnglishDependentOptions ??
        base.answerConstraints.detectEnglishDependentOptions,
    },
    presentationRules: {
      ...base.presentationRules,
      preserveLineBreaksInPoetryOrCode:
        overrides.preserveLineBreaksInPoetryOrCode ??
        base.presentationRules.preserveLineBreaksInPoetryOrCode,
    },
    defaultMixPolicy: {
      ...base.defaultMixPolicy,
      shuffleQuestions:
        overrides.shuffleQuestions ?? base.defaultMixPolicy.shuffleQuestions,
      shuffleOptions: overrides.shuffleOptions ?? base.defaultMixPolicy.shuffleOptions,
      shufflePerSectionOnly:
        overrides.shufflePerSectionOnly ?? base.defaultMixPolicy.shufflePerSectionOnly,
      lockSharedPassageGroups:
        overrides.lockSharedPassageGroups ?? base.defaultMixPolicy.lockSharedPassageGroups,
    },
  };
}

/**
 * Gợi ý hồ sơ môn học từ nội dung tài liệu/tiêu đề đề thi.
 * Chỉ mang tính gợi ý — tuyệt đối không tự ý ép hoặc đổi môn nếu giáo viên đã chọn.
 */
export function suggestSubjectProfileFromText(text: string): SubjectDetectionSuggestion {
  const source = text || '';
  const norm = stripVietnameseDiacritics(source).toLowerCase();

  const scores = new Map<ExamSubjectId, { score: number; signals: string[] }>();
  const addScore = (id: ExamSubjectId, weight: number, signal: string) => {
    const entry = scores.get(id) ?? { score: 0, signals: [] };
    entry.score += weight;
    if (!entry.signals.includes(signal)) {
      entry.signals.push(signal);
    }
    scores.set(id, entry);
  };

  // Explicit subject header detection
  const headerRules: Array<{ id: ExamSubjectId; re: RegExp; label: string }> = [
    { id: 'toan', re: /\bmon\s*:?\s*toan(\s+hoc)?\b/i, label: 'Tiêu đề ghi môn Toán' },
    { id: 'vat-ly', re: /\bmon\s*:?\s*vat\s*l[yi]\b/i, label: 'Tiêu đề ghi môn Vật lý' },
    { id: 'hoa-hoc', re: /\bmon\s*:?\s*hoa(\s+hoc)?\b/i, label: 'Tiêu đề ghi môn Hóa học' },
    { id: 'sinh-hoc', re: /\bmon\s*:?\s*sinh(\s+hoc)?\b/i, label: 'Tiêu đề ghi môn Sinh học' },
    { id: 'ngu-van', re: /\bmon\s*:?\s*ngu\s*van\b/i, label: 'Tiêu đề ghi môn Ngữ văn' },
    { id: 'tieng-anh', re: /\b(mon\s*:?\s*tieng\s*anh|english\s+test)\b/i, label: 'Tiêu đề ghi môn Tiếng Anh' },
    { id: 'lich-su', re: /\bmon\s*:?\s*lich\s*su\b/i, label: 'Tiêu đề ghi môn Lịch sử' },
    { id: 'dia-ly', re: /\bmon\s*:?\s*dia\s*l[yi]\b/i, label: 'Tiêu đề ghi môn Địa lý' },
    { id: 'gdkt-pl', re: /\b(gdkt\s*&?\s*pl|giao\s+duc\s+kinh\s+te|gdcd)\b/i, label: 'Tiêu đề ghi môn GDKT&PL/GDCD' },
    { id: 'tin-hoc', re: /\bmon\s*:?\s*tin(\s+hoc)?\b/i, label: 'Tiêu đề ghi môn Tin học' },
    { id: 'cong-nghe', re: /\bmon\s*:?\s*cong\s+nghe\b/i, label: 'Tiêu đề ghi môn Công nghệ' },
  ];
  for (const hr of headerRules) {
    if (hr.re.test(norm)) {
      addScore(hr.id, 10, hr.label);
    }
  }

  // Domain notation signals
  if (/(\\frac|\\int|\\lim|\\vec|ham so|dao ham|nguyen ham|tich phan|xyz|parabol|bat phuong trinh|bang bien thien)/.test(norm)) {
    addScore('toan', 4, 'Ký hiệu/thuật ngữ Giải tích & Hình học');
  }
  if (/(ω|λ|φ|δ|Ω|μf|m\/s²|m\/s\^2|dao dong dieu hoa|song co|dien xoay chieu|mach rlc|tu truong|hat nhan|quang hoc|gia toc|van toc)/.test(source.toLowerCase()) || /(dao dong|mach dien|tu truong|dinh luat om|cuong do dong dien)/.test(norm)) {
    addScore('vat-ly', 4, 'Đơn vị SI & thuật ngữ Vật lý');
  }
  if (/(H₂|O₂|H₂SO₄|NaOH|FeCl|CH₃|COOH|mol\b|nong do mol|oxi hoa|hoa tri|phan ung hoa hoc|este|amin|→|⇌)/.test(source) || /(mol\b|phan ung hoa hoc|oxit|axit|bazo|muoi|kim loai kiem|este)/.test(norm)) {
    addScore('hoa-hoc', 5, 'Công thức/phương trình Hóa học');
  }
  if (/(dna|arn|mrna|trna|5′|3′|5'|3'|codon|nhiem sac the|gen troi|alen|kieu gen|pha he|giam phan|nguyen phan|sinh thai)/.test(norm)) {
    addScore('sinh-hoc', 5, 'Thuật ngữ Di truyền / Sinh học');
  }
  if (/(doc hieu|nghi luan xa hoi|nghi luan van hoc|tac gia|tac pham|kho tho|bien phap tu tu|phuong thuc bieu dat)/.test(norm)) {
    addScore('ngu-van', 5, 'Cấu trúc Đọc hiểu / Làm văn Ngữ văn');
  }
  if (/(mark the letter|read the following passage|choose the word|whose underlined part|pronunciation|primary stress|cloze|choose the correct answer|\/[a-zθðʃʒŋəɪʊʌɑæˈˌ]+\/)/i.test(source)) {
    addScore('tieng-anh', 5, 'Cấu trúc đề Tiếng Anh / IPA / Reading');
  }
  if (/(chien tranh|cach mang thang tam|hiep dinh|trieu dai|khai quat lich su|nien dai|chien dich)/.test(norm)) {
    addScore('lich-su', 4, 'Sự kiện & niên đại Lịch sử');
  }
  if (/(atlat|mat do dan so|san luong|dien tich|bieu do|bang so lieu|vung kinh te|khi hau|dia hinh)/.test(norm)) {
    addScore('dia-ly', 4, 'Thuật ngữ biểu đồ / bảng số liệu Địa lý');
  }
  if (/(phap luat|hien phap|hop dong|quyen cong dan|lam phat|that nghiep|thi truong|doanh nghiep|nghia vu cong dan)/.test(norm)) {
    addScore('gdkt-pl', 4, 'Tình huống Kinh tế & Pháp luật');
  }
  if (/(python|def |select \* from|for i in range|thuật toán|thuat toan|nhi phan|csdl|html|css|c\+\+|mang mot chieu)/.test(norm)) {
    addScore('tin-hoc', 5, 'Mã nguồn / thuật toán / CSDL Tin học');
  }
  if (/(ban ve ky thuat|hinh chieu|mach dien ba pha|dong co dot trong|quy trinh cong nghe|chi tiet may)/.test(norm)) {
    addScore('cong-nghe', 4, 'Thuật ngữ bản vẽ & kỹ thuật Công nghệ');
  }

  let bestId: ExamSubjectId = 'khac';
  let bestScore = 0;
  let bestSignals: string[] = [];

  for (const [id, data] of scores.entries()) {
    if (data.score > bestScore) {
      bestId = id;
      bestScore = data.score;
      bestSignals = data.signals;
    }
  }

  if (bestScore === 0) {
    return {
      suggestedId: 'khac',
      suggestedName: SUBJECT_PROFILES.khac.name,
      confidence: 'low',
      matchedSignals: ['Chưa đủ tín hiệu đặc thù môn học từ văn bản — cần giáo viên chọn môn.'],
      requiresTeacherConfirmation: true,
    };
  }

  const confidence: SubjectDetectionSuggestion['confidence'] =
    bestScore >= 9 ? 'high' : bestScore >= 4 ? 'medium' : 'low';

  return {
    suggestedId: bestId,
    suggestedName: SUBJECT_PROFILES[bestId].name,
    confidence,
    matchedSignals: bestSignals,
    requiresTeacherConfirmation: true,
  };
}

export function getUniversalQuestionType(
  q: Pick<MathQuestion, 'type' | 'universalType'>
): UniversalQuestionType {
  return q.universalType ?? q.type;
}

export function getQuestionTypeMixPolicy(
  type: UniversalQuestionType
): QuestionTypeMixPolicy {
  return UNIVERSAL_QUESTION_POLICIES[type];
}

export function buildUniversalLockState(
  q: MathQuestion,
  profile?: SubjectProfile
): UniversalLockState {
  const existing = q.universalLock;
  const groupMode: UniversalLockState['groupLockMode'] = existing?.groupLockMode
    ? existing.groupLockMode
    : q.groupId
    ? profile?.groupRules.lockInternalGroupOrder
      ? 'lock-position'
      : 'move-as-unit'
    : 'none';

  const lockedOptionIds = Array.from(
    new Set([
      ...(existing?.lockedOptionIds ?? []),
      ...(q.options?.filter((o) => o.lockPosition).map((o) => o.id) ?? []),
      ...(q.multiSelectOptions?.filter((o) => o.lockPosition).map((o) => o.id) ?? []),
    ])
  );

  const policy = getQuestionTypeMixPolicy(getUniversalQuestionType(q));

  return {
    // Nguyên tắc bất biến: contentLocked luôn true, không bao giờ cho phép làm biến dạng công thức/ký hiệu
    contentLocked: true,
    positionLock: Boolean(q.lockQuestionPosition || existing?.positionLock),
    groupLockMode: groupMode,
    optionShuffleLock: Boolean(
      q.lockOptionShuffle || existing?.optionShuffleLock || policy.defaultLockOptionShuffle
    ),
    lockedOptionIds,
    referenceLockReasons: Array.from(
      new Set([...(existing?.referenceLockReasons ?? []), ...(q.dependencyFlags ?? [])])
    ),
  };
}

export function createImmutableContentPayload(
  rawSource: string,
  idPrefix = 'blk',
  options?: {
    defaultBlockKind?: MathBlockKind;
    rawXmlFragments?: string[];
    preserveExactWhitespace?: boolean;
  }
): MathContentPayload {
  const kind = options?.defaultBlockKind;
  if (!kind || kind === 'text' || kind === 'latex') {
    const parsed = parseMathContent(rawSource, idPrefix);
    return {
      rawSource: parsed.rawSource,
      blocks: parsed.blocks.map((block, idx) => ({
        ...block,
        checksum: computeContentHash(`${block.kind}::${block.content}`),
        ...(options?.rawXmlFragments?.[idx]
          ? { rawXmlFragment: options.rawXmlFragments[idx] }
          : {}),
        ...(options?.preserveExactWhitespace ? { preserveExactWhitespace: true } : {}),
      })),
    };
  }

  const singleBlock: MathContentBlock = {
    id: `${idPrefix}-1`,
    kind,
    content: rawSource,
    checksum: computeContentHash(`${kind}::${rawSource}`),
    ...(options?.rawXmlFragments?.[0]
      ? { rawXmlFragment: options.rawXmlFragments[0] }
      : {}),
    ...(options?.preserveExactWhitespace ? { preserveExactWhitespace: true } : {}),
  };

  return {
    rawSource,
    blocks: [singleBlock],
  };
}

export function captureQuestionOriginalSnapshot(
  q: MathQuestion
): QuestionOriginalSnapshot {
  const fragments: string[] = [];
  const collectFragments = (payload?: MathContentPayload) => {
    if (!payload) return;
    payload.blocks.forEach((b) => {
      if (b.rawXmlFragment) fragments.push(b.rawXmlFragment);
    });
  };
  collectFragments(q.stem);
  q.options?.forEach((o) => collectFragments(o.content));
  q.multiSelectOptions?.forEach((o) => collectFragments(o.content));
  q.statements?.forEach((s) => collectFragments(s.content));
  q.essayParts?.forEach((p) => {
    collectFragments(p.content);
    collectFragments(p.solutionOutline);
  });
  collectFragments(q.passageContext?.content);
  collectFragments(q.solutionGuide);

  const canonicalDigest = JSON.stringify({
    stem: q.stem.rawSource,
    options: q.options?.map((o) => `${o.id}:${o.content.rawSource}:${o.isCorrect}`) ?? [],
    multiSelect:
      q.multiSelectOptions?.map((o) => `${o.id}:${o.content.rawSource}:${o.isCorrect}`) ?? [],
    statements: q.statements?.map((s) => `${s.id}:${s.content.rawSource}:${s.isTrue}`) ?? [],
    shortAnswer: q.shortAnswer?.answerValue ?? '',
    fillBlank: q.fillBlank?.slots.map((sl) => `${sl.id}:${sl.slotNumber}:${sl.acceptedAnswers.join('|')}`) ?? [],
    matching: q.matching?.correctPairs.map((p) => `${p.leftItemId}->${p.rightItemId}`) ?? [],
    ordering: q.ordering?.items.map((it) => `${it.id}@${it.correctRank}`) ?? [],
    fragments,
  });

  return {
    rawXmlFragments: fragments,
    rawContentChecksum: computeContentHash(canonicalDigest),
    capturedAt: new Date().toISOString(),
  };
}
