export type AppId =
  | 'desktop'
  | 'workspace'
  | 'lesson-studio'
  | 'resource-vault'
  | 'workflow-center'
  | 'print-studio'
  | 'math-mixer'
  | 'exam-generator'
  | 'grading-studio'
  | 'teaching-journal'
  | 'settings';

export type AppLayer = 'shell' | 'core' | 'system';

export type AppImplementationStatus = 'ready' | 'phase4' | 'later';

export interface AppDefinition {
  id: AppId;
  name: string;
  shortName: string;
  description: string;
  layer: AppLayer;
  status: AppImplementationStatus;
  statusLabel: string;
  shortcutHint: string;
  pinnedInDock: boolean;
  keywords: string[];
  sharedDataScopes: string[];
}

export const APP_REGISTRY: AppDefinition[] = [
  {
    id: 'desktop',
    name: 'Màn hình chính (Desktop)',
    shortName: 'Desktop',
    description:
      'Không gian khởi đầu thống nhất: truy cập nhanh bộ tiết dạy đang soạn, các ứng dụng cốt lõi và tìm kiếm toàn hệ thống.',
    layer: 'shell',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+1',
    pinnedInDock: true,
    keywords: ['trang chu', 'desktop', 'home', 'tong quan', 'man hinh chinh'],
    sharedDataScopes: ['LessonPack', 'PrintSettings', 'AppRegistry'],
  },
  {
    id: 'lesson-studio',
    name: 'Lesson Studio',
    shortName: 'Lesson Studio',
    description:
      'Soạn bộ tiết dạy 5 bước (mục tiêu, hoạt động 5–15 phút, ngân hàng câu hỏi 3 mức, phiếu A/B/C, rubric 3 mức) và quản lý Kho bộ tiết dạy.',
    layer: 'core',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+2',
    pinnedInDock: true,
    keywords: [
      'lesson',
      'studio',
      'soan bai',
      'bo tiet day',
      'giao an',
      'cau hoi',
      'rubric',
      'kho cua toi',
    ],
    sharedDataScopes: ['LessonPack', 'ActivityTemplate', 'Allocation'],
  },
  {
    id: 'print-studio',
    name: 'Print Studio',
    shortName: 'Print Studio',
    description:
      'Trung tâm xem trước và xuất bản in A4 / Lưu PDF cho giáo án, 3 mẫu phiếu A/B/C, phiếu rubric quá trình và đáp án giáo viên.',
    layer: 'core',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+3',
    pinnedInDock: true,
    keywords: ['in', 'print', 'pdf', 'a4', 'phieu bai tap', 'xuat ban in'],
    sharedDataScopes: ['LessonPack', 'PrintSettings'],
  },
  {
    id: 'math-mixer',
    name: 'Exam Mixer Pro 6.0',
    shortName: 'Trộn đề đa môn',
    description:
      'Trộn đề kiểm tra đa môn 12 bộ môn THCS/THPT với 10 dạng câu hỏi, nhập Word (.docx), bảo toàn 100% công thức/ngữ liệu và xuất DOCX/ZIP/PDF A4.',
    layer: 'core',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+8',
    pinnedInDock: true,
    keywords: [
      'toan',
      'ly',
      'hoa',
      'sinh',
      'van',
      'anh',
      'su',
      'dia',
      'tin',
      'tron de',
      'exam mixer',
      'docx',
      'zip',
      'latex',
      'katex',
      'ma tran',
    ],
    sharedDataScopes: ['MathExamProject', 'PrintSettings'],
  },
  {
    id: 'exam-generator',
    name: 'Smart Exam Generator 2.0',
    shortName: 'Tạo đề tự động',
    description:
      'Tạo đề tự động theo ma trận, sinh biến thể đổi số Level 1 có kiểm chứng thế ngược độc lập (không AI API, 100% cục bộ) và chuyển thẳng sang Exam Mixer Pro.',
    layer: 'core',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+G',
    pinnedInDock: true,
    keywords: [
      'tao de',
      'exam generator',
      'bien the',
      'doi so',
      'ma tran',
      'ngan hang cau hoi',
      'kiem chung',
      'tu dong',
    ],
    sharedDataScopes: ['MathExamProject', 'BankQuestionRecord', 'QuestionTemplateDefinition'],
  },
  {
    id: 'grading-studio',
    name: 'Smart Grading Studio',
    shortName: 'Chấm bài OMR',
    description:
      'Tạo phiếu trả lời chuẩn A4, nhận diện ô tô OMR cục bộ, tự chấm theo đúng đáp án từng mã đề Exam Mixer Pro, duyệt thủ công và xuất Excel + ZIP minh chứng.',
    layer: 'core',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+9',
    pinnedInDock: true,
    keywords: [
      'cham bai',
      'omr',
      'grading',
      'smart grading',
      'phieu tra loi',
      'bang diem',
      'excel',
      'xlsx',
      'minh chung',
      'scan',
    ],
    sharedDataScopes: ['GradingSession', 'MathExamProject'],
  },
  {
    id: 'workspace',
    name: 'My Workspace',
    shortName: 'Workspace',
    description:
      'Không gian làm việc gom theo Môn học / Khối lớp / Chủ đề, tích hợp Document Inspector, tạo biến thể bài dạy và đóng gói bàn giao tổ chuyên môn.',
    layer: 'core',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+4',
    pinnedInDock: true,
    keywords: ['workspace', 'khong gian mon hoc', 'chu de', 'vat li', 'toan', 'inspector', 'ban giao'],
    sharedDataScopes: ['WorkspaceContext', 'LessonPack', 'ResourceItem'],
  },
  {
    id: 'resource-vault',
    name: 'Resource Vault',
    shortName: 'Resource Vault',
    description:
      'Kho học liệu cá nhân (mẫu câu hỏi, ý tưởng hoạt động, ngữ liệu, công thức) có gắn thẻ và chèn 1 chạm vào bộ tiết dạy đang soạn.',
    layer: 'core',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+5',
    pinnedInDock: true,
    keywords: ['resource', 'vault', 'tai lieu', 'hoc lieu', 'lien ket', 'ngan hang'],
    sharedDataScopes: ['ResourceItem', 'LessonPack'],
  },
  {
    id: 'workflow-center',
    name: 'Workflow Center',
    shortName: 'Workflows',
    description:
      'Quản lý và theo dõi tiến độ quy trình chuẩn bị tiết dạy (Trước – Trong – Sau giờ dạy) gắn trực tiếp với từng bộ tiết dạy.',
    layer: 'core',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+6',
    pinnedInDock: false,
    keywords: ['workflow', 'quy trinh', 'checklist', 'truoc tiet day'],
    sharedDataScopes: ['WorkflowTemplate', 'LessonPack'],
  },
  {
    id: 'teaching-journal',
    name: 'Teaching Journal',
    shortName: 'Journal',
    description:
      'Nhật ký giảng dạy ghi nhận phân bổ thời gian thực tế, điểm học sinh vướng mắc và áp dụng cải tiến trực tiếp vào bộ tiết dạy.',
    layer: 'core',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+7',
    pinnedInDock: false,
    keywords: ['journal', 'nhat ky', 'cai tien', 'rut kinh nghiem'],
    sharedDataScopes: ['JournalEntry', 'LessonPack'],
  },
  {
    id: 'settings',
    name: 'Cài đặt & Sao lưu',
    shortName: 'Cài đặt',
    description:
      'Cấu hình khổ giấy A4, lề in chuẩn mm, sao lưu/khôi phục toàn bộ dữ liệu JSON và hướng dẫn lưu trữ cục bộ.',
    layer: 'system',
    status: 'ready',
    statusLabel: 'Đang hoạt động',
    shortcutHint: 'Alt+0',
    pinnedInDock: true,
    keywords: ['cai dat', 'settings', 'sao luu', 'khoi phuc', 'json', 'le in'],
    sharedDataScopes: ['PrintSettings', 'BackupPayload'],
  },
];

export function getAppById(id: AppId): AppDefinition {
  return APP_REGISTRY.find((app) => app.id === id) ?? APP_REGISTRY[0];
}

export function getDockApps(): AppDefinition[] {
  return APP_REGISTRY.filter((app) => app.pinnedInDock);
}
