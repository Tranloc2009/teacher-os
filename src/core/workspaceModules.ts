import {
  ActivityItem,
  JournalEntry,
  LessonPack,
  PrintSettings,
  QuestionItem,
  ResourceItem,
  WorkflowRun,
} from '../types/lesson';
import {
  allocateThreeWorksheets,
  calculateActivityMinutes,
  generateNextQuestionCode,
  normalizeWorksheetVariants,
} from '../utils/allocation';

export const DEFAULT_RESOURCES: ResourceItem[] = [
  {
    id: 'res-math-q1',
    title: 'Bài toán chuyển động đều quy về phương trình bậc nhất',
    type: 'question-template',
    subject: 'Toán học',
    grade: 'Lớp 8',
    tier: 'applied',
    tags: ['phương trình bậc nhất', 'toán thực tế', 'chuyển động'],
    content:
      'Một ô tô đi từ A đến B với vận tốc 50 km/h, sau đó quay về A với vận tốc 40 km/h. Tổng thời gian cả đi và về là 4 giờ 30 phút. Tính quãng đường AB.',
    answerOrNote:
      'Gọi quãng đường AB là x (km, x > 0). Phương trình: x/50 + x/40 = 9/2 => 9x/200 = 9/2 => x = 100 (km).',
    points: 2.5,
    updatedAt: '2026-11-15T08:00:00.000Z',
  },
  {
    id: 'res-math-act1',
    title: 'Hoạt động Khởi động: Truy tìm ẩn số trong hóa đơn điện nước',
    type: 'activity-idea',
    subject: 'Toán học',
    grade: 'Lớp 8',
    tags: ['khởi động', 'nhóm đôi', 'toán thực tế'],
    content:
      'Giáo viên chiếu phiếu tính tiền điện sinh hoạt bậc 1 và bậc 2 bị che khuất số kWh tiêu thụ. Học sinh thảo luận cặp đôi trong 7 phút để lập biểu thức đại số biểu diễn tổng số tiền.',
    answerOrNote:
      'Mục đích giúp học sinh thấy nhu cầu thực tế của việc đặt ẩn x và lập phương trình bậc nhất một ẩn.',
    suggestedMinutes: 10,
    updatedAt: '2026-11-15T08:30:00.000Z',
  },
  {
    id: 'res-lit-q1',
    title: 'Câu hỏi mở rộng phân tích giá trị nhân đạo và liên hệ bản thân',
    type: 'question-template',
    subject: 'Ngữ văn',
    grade: 'Lớp 8',
    tier: 'extended',
    tags: ['đọc hiểu', 'nhân đạo', 'nghị luận ngắn'],
    content:
      'Từ chi tiết nghệ thuật tiêu biểu ở cuối văn bản, em hãy viết đoạn văn ngắn (7–10 câu) nêu thông điệp về sự đồng cảm giữa con người với con người trong cuộc sống hôm nay.',
    answerOrNote:
      'Đảm bảo hình thức đoạn văn 7–10 câu; chỉ rõ chi tiết nghệ thuật; nêu được bài học nhận thức và hành động chân thực.',
    points: 3,
    updatedAt: '2026-11-15T09:00:00.000Z',
  },
  {
    id: 'res-math-formula1',
    title: 'Bảng tóm tắt 4 bước giải bài toán bằng cách lập phương trình',
    type: 'formula-sheet',
    subject: 'Toán học',
    grade: 'Lớp 8',
    tags: ['sơ đồ tư duy', '4 bước giải toán', 'ôn tập'],
    content:
      'Bước 1: Chọn ẩn và đặt điều kiện thích hợp cho ẩn. Bước 2: Biểu diễn các đại lượng chưa biết theo ẩn và các đại lượng đã biết, từ đó lập phương trình. Bước 3: Giải phương trình. Bước 4: Kiểm tra điều kiện và kết luận.',
    answerOrNote:
      'Có thể chèn vào phần hướng dẫn hoạt động luyện tập hoặc phiếu hỗ trợ học sinh mức Cơ bản.',
    suggestedMinutes: 10,
    updatedAt: '2026-11-15T09:15:00.000Z',
  },
];

export const PHASE_A_VAULT_EXAM_RESOURCES: ResourceItem[] = [
  {
    id: 'res-math12-gk1-hamso',
    title: 'Đề ôn tập Giữa HK1 Toán 12 — Hàm số & Đạo hàm (Nguồn Resource Vault)',
    type: 'question-template',
    subject: 'Toán học',
    grade: 'Lớp 12',
    tier: 'applied',
    documentCategory: 'de-thi',
    chapterTopic: 'Hàm số và Đồ thị',
    tags: ['Toán 12', 'Hàm số', 'Đạo hàm', 'Giữa HK1', 'Cực trị', 'Tiệm cận'],
    content: `PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn.

Câu 1: Cho hàm số $y = x^3 - 3x + 2$. Hàm số đã cho nghịch biến trên khoảng nào dưới đây?
A. $(-\\infty; -1)$
*B. $(-1; 1)$
C. $(1; +\\infty)$
D. $(-\\infty; +\\infty)$

Câu 2: Đường tiệm cận đứng của đồ thị hàm số $y = \\frac{2x - 1}{x + 3}$ là đường thẳng nào sau đây?
A. $x = 2$
B. $y = 2$
*C. $x = -3$
D. $y = -3$

Câu 3: Giá trị cực đại của hàm số $y = -x^3 + 3x^2 - 1$ bằng bao nhiêu?
A. $-1$
B. $1$
*C. $3$
D. $2$

Câu 4: Đạo hàm của hàm số $f(x) = x^4 - 2x^2 + 5$ là:
*A. $f'(x) = 4x^3 - 4x$
B. $f'(x) = 4x^3 - 2x$
C. $f'(x) = x^3 - 4x$
D. $f'(x) = 4x^3 + 4x$

PHẦN II. Câu trắc nghiệm đúng sai.

Câu 5: Cho hàm số $f(x) = x^3 - 3x^2 + 4$. Xét tính đúng sai của các mệnh đề sau:
a) Đạo hàm của hàm số là $f'(x) = 3x^2 - 6x$. [Đúng]
b) Phương trình $f'(x) = 0$ có đúng hai nghiệm là $x = 0$ và $x = 2$. [Đúng]
c) Hàm số đồng biến trên khoảng $(0; 2)$. [Sai]
d) Giá trị cực tiểu của hàm số bằng $0$. [Đúng]

Câu 6: Cho hàm số phân thức $y = \\frac{x + 2}{x - 1}$ có đồ thị $(C)$. Xét các khẳng định sau:
a) Tập xác định của hàm số là $D = \\mathbb{R} \\setminus \\{1\\}$. [Đúng]
b) Đồ thị $(C)$ có tiệm cận ngang $y = 1$. [Đúng]
c) Hàm số đồng biến trên từng khoảng xác định. [Sai]
d) Giao điểm của $(C)$ với trục tung là $A(0; -2)$. [Đúng]

PHẦN III. Câu trắc nghiệm trả lời ngắn.

Câu 7: Tìm giá trị lớn nhất của hàm số $y = x^3 - 3x + 5$ trên đoạn $[0; 2]$.
Đáp án: 7

Câu 8: Tính hệ số góc tiếp tuyến của đồ thị hàm số $y = x^3 - 2x + 1$ tại điểm có hoành độ $x_0 = 2$.
Đáp án: 10`,
    answerOrNote:
      'Bộ câu hỏi Toán 12 Chương 1 (Hàm số & Đạo hàm) gồm 4 câu Trắc nghiệm, 2 câu Đúng/Sai và 2 câu Trả lời ngắn kèm đáp án gốc.',
    points: 10,
    updatedAt: '2026-11-18T08:00:00.000Z',
    sourceFile: {
      fileName: 'De_OnTap_GKI_Toan12_HamSo_DaoHam.txt',
      relativePath: 'Toán 12/Giữa HK1/De_OnTap_GKI_Toan12_HamSo_DaoHam.txt',
      extension: 'txt',
      mimeType: 'text/plain',
      sizeBytes: 1840,
      sha256: 'vault-seed-toan12-gki-hamso-v1',
      storageKind: 'metadata-only',
      fileRecordId: 'seed-file-math12-gk1',
      hasOmml: false,
      formulaCount: 16,
    },
  },
  {
    id: 'res-math12-daoham-chuyende',
    title: 'Chuyên đề Đạo hàm & Ứng dụng khảo sát hàm số Toán 12',
    type: 'question-template',
    subject: 'Toán học',
    grade: 'Lớp 12',
    tier: 'extended',
    documentCategory: 'bai-tap',
    chapterTopic: 'Đạo hàm',
    tags: ['Toán 12', 'Đạo hàm', 'Hàm số', 'Vận dụng'],
    content: `PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn.

Câu 1: Cho hàm số $y = \\frac{3x + 2}{x - 2}$. Đường tiệm cận ngang của đồ thị hàm số là:
A. $y = 2$
*B. $y = 3$
C. $x = 2$
D. $y = -1$

Câu 2: Số điểm cực trị của hàm số $y = x^4 - 4x^2 + 1$ là:
A. $1$
B. $2$
*C. $3$
D. $0$

PHẦN II. Câu trắc nghiệm đúng sai.

Câu 3: Cho hàm số $g(x) = -x^3 + 3x + 2$. Xét tính đúng sai của các khẳng định sau:
a) $g'(x) = -3x^2 + 3$. [Đúng]
b) Hàm số đồng biến trên khoảng $(-1; 1)$. [Đúng]
c) Đồ thị hàm số đi qua điểm $M(1; 4)$. [Đúng]
d) Hàm số không có điểm cực tiểu. [Sai]

PHẦN III. Câu trắc nghiệm trả lời ngắn.

Câu 4: Tính giá trị $f'(1)$ với $f(x) = 2x^3 - 5x^2 + 4x - 1$.
Đáp án: 0

Câu 5: Tổng hoành độ các điểm cực trị của hàm số $y = x^3 - 6x^2 + 9x - 2$ bằng bao nhiêu?
Đáp án: 4`,
    answerOrNote:
      'Chuyên đề luyện tập Toán 12 (Đạo hàm & Khảo sát hàm số) phục vụ trích xuất tự động từ Resource Vault.',
    points: 10,
    updatedAt: '2026-11-18T09:00:00.000Z',
    sourceFile: {
      fileName: 'ChuyenDe_DaoHam_KhaoSat_Toan12.txt',
      relativePath: 'Toán 12/Đạo hàm/ChuyenDe_DaoHam_KhaoSat_Toan12.txt',
      extension: 'txt',
      mimeType: 'text/plain',
      sizeBytes: 1280,
      sha256: 'vault-seed-toan12-daoham-v1',
      storageKind: 'metadata-only',
      fileRecordId: 'seed-file-math12-daoham',
      hasOmml: false,
      formulaCount: 10,
    },
  },
];

export const DEFAULT_WORKFLOWS: WorkflowRun[] = [
  {
    id: 'wf-standard-a4',
    title: 'Quy trình chuẩn bị tiết dạy có Phiếu phân hóa A/B/C & In A4',
    linkedPackId: 'demo-pack-toan-8',
    updatedAt: '2026-11-15T10:00:00.000Z',
    steps: [
      {
        id: 'wf-s1',
        phase: 'pre-class',
        label: 'Xác định mục tiêu cần đạt và kiểm tra tổng thời lượng hoạt động hợp lý trong tiết 45/90 phút',
        done: true,
        targetApp: 'lesson-studio',
      },
      {
        id: 'wf-s2',
        phase: 'pre-class',
        label: 'Soạn ngân hàng câu hỏi đủ 3 mức (Cơ bản, Vận dụng, Mở rộng) không bị thiếu hụt ở Phiếu A/B/C',
        done: true,
        targetApp: 'lesson-studio',
      },
      {
        id: 'wf-s3',
        phase: 'pre-class',
        label: 'Kiểm tra bản xem trước A4 và xuất PDF / in giấy cho 3 nhóm đối tượng học sinh',
        done: false,
        targetApp: 'print-studio',
      },
      {
        id: 'wf-s4',
        phase: 'in-class',
        label: 'Phát đúng mã phiếu A (củng cố), B (đại trà), C (nâng cao) và quan sát theo tiêu chí Rubric',
        done: false,
      },
      {
        id: 'wf-s5',
        phase: 'post-class',
        label: 'Ghi nhận thời lượng thực tế và câu hỏi học sinh hay nhầm vào Nhật ký giảng dạy (Teaching Journal)',
        done: false,
        targetApp: 'teaching-journal',
      },
    ],
  },
];

export const DEFAULT_JOURNALS: JournalEntry[] = [
  {
    id: 'jrn-demo-1',
    packId: 'demo-pack-toan-8',
    classLabel: '8A1',
    taughtDate: '2026-11-16',
    pacingRating: 'vua-khit',
    whatWorked:
      'Hoạt động nhóm đôi chuyển ngôn ngữ đời thường sang phương trình diễn ra sôi nổi; phiếu A giúp nhóm học sinh trung bình hoàn thành đúng giờ.',
    bottlenecks:
      'Ở câu VD-02 trên Phiếu B và C, khoảng 1/4 học sinh quên ghi điều kiện nguyên dương của ẩn x trước khi giải.',
    nextAdjustment:
      'Bổ sung dòng nhắc "Ghi rõ đơn vị và điều kiện của ẩn x" in đậm ngay dưới đề bài các câu Vận dụng ở lần dạy lớp 8A2.',
    updatedAt: '2026-11-16T11:20:00.000Z',
  },
];

export interface InspectorCheckItem {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
}

export interface DocumentInspectionReport {
  packId: string;
  readinessPercent: number;
  totalChecks: number;
  passedChecks: number;
  activityMinutes: number;
  rubricWeightSum: number;
  hasWorksheetShortfall: boolean;
  linkedResourcesCount: number;
  linkedJournalsCount: number;
  checks: InspectorCheckItem[];
}

export function inspectLessonPack(
  pack: LessonPack,
  resources: ResourceItem[],
  journals: JournalEntry[]
): DocumentInspectionReport {
  const cleanTitle = pack.title.trim();
  const validObjectives = pack.objectives.filter((o) => o.trim().length > 0);
  const activityMinutes = calculateActivityMinutes(pack);
  const durationMatch =
    pack.activities.length > 0 &&
    activityMinutes > 0 &&
    activityMinutes <= pack.duration;

  const variants = normalizeWorksheetVariants(pack);
  const allocations = allocateThreeWorksheets(pack.questions, variants);
  const hasWorksheetShortfall = allocations.some(
    (a) =>
      a.allocated.shortfalls.basic > 0 ||
      a.allocated.shortfalls.applied > 0 ||
      a.allocated.shortfalls.extended > 0
  );
  const totalAllocatedQuestions = allocations.reduce(
    (sum, a) => sum + a.allocated.totalQuestions,
    0
  );

  const rubricWeightSum = pack.rubric.reduce(
    (sum, c) => sum + (Number.isFinite(c.weightPercent) ? c.weightPercent : 0),
    0
  );
  const rubricValid =
    pack.rubric.length >= 3 &&
    pack.rubric.length <= 5 &&
    rubricWeightSum === 100 &&
    pack.rubric.every(
      (c) =>
        c.name.trim() &&
        c.levels.needsSupport.trim() &&
        c.levels.meets.trim() &&
        c.levels.exceeds.trim()
    );

  const checks: InspectorCheckItem[] = [
    {
      id: 'meta-objectives',
      label: 'Thông tin tiết dạy & Mục tiêu',
      detail:
        cleanTitle && validObjectives.length > 0
          ? `Đã có tên bài và ${validObjectives.length} mục tiêu cụ thể.`
          : 'Thiếu tên chủ đề hoặc chưa nhập mục tiêu cần đạt.',
      passed: Boolean(cleanTitle && validObjectives.length > 0),
    },
    {
      id: 'activity-pacing',
      label: 'Khớp thời lượng hoạt động trên lớp',
      detail: `${pack.activities.length} hoạt động · Tổng ${activityMinutes}/${pack.duration} phút.`,
      passed: durationMatch,
    },
    {
      id: 'worksheet-allocation',
      label: 'Đủ ngân hàng câu hỏi cho 3 mẫu phiếu A/B/C',
      detail: hasWorksheetShortfall
        ? 'Còn thiếu câu hỏi ở một số mức độ so với cấu hình phân bổ Phiếu A/B/C.'
        : `${pack.questions.length} câu trong ngân hàng · Đủ phân bổ cho 3 mẫu phiếu.`,
      passed:
        pack.questions.length > 0 &&
        totalAllocatedQuestions > 0 &&
        !hasWorksheetShortfall,
    },
    {
      id: 'rubric-complete',
      label: 'Rubric đánh giá quá trình (3–5 tiêu chí, tổng 100%)',
      detail: `${pack.rubric.length} tiêu chí · Tổng tỉ trọng ${rubricWeightSum}%.`,
      passed: rubricValid,
    },
  ];

  const passedChecks = checks.filter((c) => c.passed).length;
  const readinessPercent = Math.round((passedChecks / checks.length) * 100);

  const linkedResourcesCount = resources.filter(
    (r) => r.subject === pack.subject && r.grade === pack.grade
  ).length;
  const linkedJournalsCount = journals.filter(
    (j) => j.packId === pack.id
  ).length;

  return {
    packId: pack.id,
    readinessPercent,
    totalChecks: checks.length,
    passedChecks,
    activityMinutes,
    rubricWeightSum,
    hasWorksheetShortfall,
    linkedResourcesCount,
    linkedJournalsCount,
    checks,
  };
}

export function createLessonVariant(
  source: LessonPack,
  mode: 'toggle-duration' | 'parallel-class',
  idGenerator: (prefix?: string) => string
): LessonPack {
  const now = new Date().toISOString();
  const cleanTitle = source.title.replace(/^\[DEMO\]\s*/i, '').trim() || 'Bộ tiết dạy';
  const copy = structuredClone(source);

  if (mode === 'toggle-duration') {
    const targetDuration: 45 | 90 = source.duration === 45 ? 90 : 45;
    const ratio = targetDuration / source.duration;
    const scaledActivities: ActivityItem[] = copy.activities.map((act) => {
      const scaled = Math.round((act.durationMinutes * ratio) / 5) * 5;
      const clamped = Math.max(5, Math.min(15, scaled));
      return {
        ...act,
        id: idGenerator('act'),
        durationMinutes: clamped,
      };
    });

    return {
      ...copy,
      id: idGenerator('pack'),
      title: `${cleanTitle} (Biến thể ${targetDuration} phút)`,
      duration: targetDuration,
      activities: scaledActivities,
      isDemo: false,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    ...copy,
    id: idGenerator('pack'),
    title: `${cleanTitle} (Biến thể lớp song song)`,
    isDemo: false,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

export function insertResourceIntoPack(
  pack: LessonPack,
  resource: ResourceItem,
  idGenerator: (prefix?: string) => string
): { updatedPack: LessonPack; summary: string } {
  const now = new Date().toISOString();
  if (resource.type === 'question-template') {
    const tier = resource.tier ?? 'applied';
    const nextCode = generateNextQuestionCode(pack.questions, tier);
    const newQuestion: QuestionItem = {
      id: idGenerator('q'),
      code: nextCode,
      tier,
      prompt: resource.content,
      answerGuide: resource.answerOrNote,
      points: resource.points ?? 2,
    };
    return {
      updatedPack: {
        ...pack,
        questions: [...pack.questions, newQuestion],
        updatedAt: now,
      },
      summary: `Đã chèn câu hỏi ${nextCode} ("${resource.title}") vào ngân hàng câu hỏi.`,
    };
  }

  const durationMinutes = Math.max(
    5,
    Math.min(15, resource.suggestedMinutes ?? 10)
  );
  const newActivity: ActivityItem = {
    id: idGenerator('act'),
    templateId: null,
    title: resource.title,
    durationMinutes,
    grouping: 'Cặp đôi / Nhóm nhỏ',
    instructions: resource.content,
    studentTask: 'Thảo luận và hoàn thành sản phẩm theo yêu cầu của hoạt động.',
    teacherNote: resource.answerOrNote,
  };

  return {
    updatedPack: {
      ...pack,
      activities: [...pack.activities, newActivity],
      updatedAt: now,
    },
    summary: `Đã chèn hoạt động "${resource.title}" (${durationMinutes} phút) vào tiến trình tiết dạy.`,
  };
}

export function applyJournalAdjustmentToPack(
  pack: LessonPack,
  entry: JournalEntry
): LessonPack {
  const noteText = `[Rút kinh nghiệm lớp ${entry.classLabel} ngày ${entry.taughtDate}]: ${entry.nextAdjustment.trim()}`;
  const now = new Date().toISOString();

  if (pack.activities.length > 0) {
    const updatedActivities = pack.activities.map((act, index) => {
      if (index !== 0) return act;
      const existing = act.teacherNote.trim();
      const combined = existing.includes(noteText)
        ? existing
        : existing
        ? `${existing}\n• ${noteText}`
        : `• ${noteText}`;
      return {
        ...act,
        teacherNote: combined,
      };
    });
    return {
      ...pack,
      activities: updatedActivities,
      updatedAt: now,
    };
  }

  const updatedObjectives = [...pack.objectives];
  if (!updatedObjectives.includes(noteText)) {
    updatedObjectives.push(noteText);
  }
  return {
    ...pack,
    objectives: updatedObjectives,
    updatedAt: now,
  };
}

export interface HandoverKitPayload {
  app: 'TeacherOS-HandoverKit';
  version: '4.0';
  exportedAt: string;
  lessonPack: LessonPack;
  printSettings: PrintSettings;
  linkedResources: ResourceItem[];
  teachingJournals: JournalEntry[];
}

export function createHandoverKitPayload(
  pack: LessonPack,
  settings: PrintSettings,
  resources: ResourceItem[],
  journals: JournalEntry[]
): HandoverKitPayload {
  return {
    app: 'TeacherOS-HandoverKit',
    version: '4.0',
    exportedAt: new Date().toISOString(),
    lessonPack: pack,
    printSettings: settings,
    linkedResources: resources.filter(
      (r) => r.subject === pack.subject && r.grade === pack.grade
    ),
    teachingJournals: journals.filter((j) => j.packId === pack.id),
  };
}
