import type { AppId } from '../core/appRegistry';
import type { CanvasColorKey, CanvasNodeType, CanvasPriority } from '../types/canvas';

export type WorkflowTemplateIconKey =
  | 'lesson'
  | 'exam'
  | 'resource'
  | 'plan'
  | 'weekly';

export interface WorkflowTemplateStepSpec {
  title: string;
  description: string;
  type: Extract<CanvasNodeType, 'task' | 'checklist' | 'milestone'>;
  priority: CanvasPriority;
  color: CanvasColorKey;
  suggestedAppId?: AppId;
  checklist?: string[];
  /** Index of prerequisite step(s) within this template's steps array */
  dependsOnIndices?: number[];
}

export interface WorkflowStudioTemplate {
  id: string;
  icon: WorkflowTemplateIconKey;
  category: string;
  title: string;
  description: string;
  steps: WorkflowTemplateStepSpec[];
}

export const WORKFLOW_STUDIO_TEMPLATES: WorkflowStudioTemplate[] = [
  {
    id: 'tpl-studio-lesson-prep',
    icon: 'lesson',
    category: 'Giảng dạy',
    title: 'Chuẩn bị bài giảng',
    description:
      'Quy trình chuẩn từ xác định mục tiêu, chọn học liệu, hoàn thiện phiếu phân hóa A/B/C, duyệt bản in A4 đến ghi nhật ký sau tiết.',
    steps: [
      {
        title: 'Xác định mục tiêu bài dạy và phân bổ thời lượng',
        description:
          'Chốt yêu cầu cần đạt và phân bổ khung thời gian 5–15 phút cho từng hoạt động học tập.',
        type: 'task',
        priority: 'high',
        color: 'blue',
        suggestedAppId: 'lesson-studio',
      },
      {
        title: 'Chọn học liệu, ví dụ minh họa và bài tập từ kho',
        description:
          'Rà soát câu hỏi Cơ bản – Vận dụng – Mở rộng và ngữ liệu hỗ trợ phù hợp với đối tượng lớp.',
        type: 'task',
        priority: 'medium',
        color: 'teal',
        suggestedAppId: 'resource-vault',
        dependsOnIndices: [0],
      },
      {
        title: 'Kiểm tra bộ Phiếu A/B/C và tiêu chí Rubric',
        description:
          'Đảm bảo đủ câu hỏi ở từng mức độ và đáp án giáo viên rõ ràng.',
        type: 'checklist',
        priority: 'high',
        color: 'indigo',
        suggestedAppId: 'lesson-studio',
        checklist: [
          'Đủ câu hỏi mức Cơ bản cho Phiếu A',
          'Đủ câu hỏi Vận dụng và Mở rộng cho Phiếu B/C',
          'Rà soát Rubric đánh giá quá trình 3 mức',
        ],
        dependsOnIndices: [1],
      },
      {
        title: 'Xem trước bản in A4 và xuất PDF phát lớp',
        description:
          'Kiểm tra lề giấy, ngắt trang sạch sẽ và số lượng bản in cần chuẩn bị.',
        type: 'task',
        priority: 'high',
        color: 'blue',
        suggestedAppId: 'print-studio',
        dependsOnIndices: [2],
      },
      {
        title: 'Ghi nhật ký tiết dạy và điểm cần điều chỉnh',
        description:
          'Ghi nhanh nhịp độ lớp học, câu hỏi học sinh hay nhầm và lưu ý cho lớp dạy tiếp theo.',
        type: 'milestone',
        priority: 'medium',
        color: 'emerald',
        suggestedAppId: 'teaching-journal',
        dependsOnIndices: [3],
      },
    ],
  },
  {
    id: 'tpl-studio-exam-creation',
    icon: 'exam',
    category: 'Khảo thí',
    title: 'Tạo đề kiểm tra',
    description:
      'Quy trình soạn, kiểm định công thức, trộn nhiều mã đề an toàn, đối soát đáp án và chuẩn bị bản in A4.',
    steps: [
      {
        title: 'Lập ma trận đề và chuẩn bị nguồn câu hỏi gốc',
        description:
          'Xác định cấu trúc trắc nghiệm / Đúng–Sai / trả lời ngắn và tỉ lệ mức độ nhận thức.',
        type: 'task',
        priority: 'high',
        color: 'indigo',
        suggestedAppId: 'resource-vault',
      },
      {
        title: 'Nhập đề gốc và kiểm định công thức, hình ảnh',
        description:
          'Đưa tệp DOCX/PDF/văn bản vào Exam Mixer Pro và kiểm tra cảnh báo toàn vẹn công thức.',
        type: 'checklist',
        priority: 'high',
        color: 'blue',
        suggestedAppId: 'math-mixer',
        checklist: [
          'Kiểm tra toàn bộ công thức hiển thị rõ, không lỗi ký hiệu',
          'Khóa vị trí các câu hỏi/phương án cố định nếu cần',
          'Xác nhận đáp án đúng cho từng câu hỏi',
        ],
        dependsOnIndices: [0],
      },
      {
        title: 'Trộn hàng loạt mã đề và kiểm tra bảng ánh xạ đáp án',
        description:
          'Sinh đủ số mã đề theo phòng thi và đối chiếu bảng ánh xạ câu hỏi giữa các mã.',
        type: 'task',
        priority: 'high',
        color: 'indigo',
        suggestedAppId: 'math-mixer',
        dependsOnIndices: [1],
      },
      {
        title: 'Xuất tệp đề thi, phiếu đáp án và kiểm tra bản in A4',
        description:
          'Xuất bộ DOCX/PDF/ZIP và đọc soát trang đầu, mã đề, tiêu đề trường/lớp trước khi nhân bản.',
        type: 'task',
        priority: 'high',
        color: 'teal',
        suggestedAppId: 'math-mixer',
        dependsOnIndices: [2],
      },
      {
        title: 'Lưu trữ bộ đề gốc và đáp án vào kho tài liệu',
        description:
          'Phân loại đề theo môn, khối và học kỳ trong Resource Vault để tái sử dụng về sau.',
        type: 'milestone',
        priority: 'low',
        color: 'emerald',
        suggestedAppId: 'resource-vault',
        dependsOnIndices: [3],
      },
    ],
  },
  {
    id: 'tpl-studio-resource-mgmt',
    icon: 'resource',
    category: 'Học liệu',
    title: 'Quản lý tài liệu',
    description:
      'Sắp xếp kho tài liệu giảng dạy, nhập nhiều tệp, lọc trùng lặp và gắn liên kết phục vụ bài dạy.',
    steps: [
      {
        title: 'Gom tài liệu cần lưu theo môn, lớp và chương',
        description:
          'Tập hợp giáo án, phiếu bài tập, đề thi và bài giảng từ máy tính cá nhân.',
        type: 'task',
        priority: 'medium',
        color: 'teal',
        suggestedAppId: 'resource-vault',
      },
      {
        title: 'Nhập tệp vào Resource Vault và xử lý tệp trùng lặp',
        description:
          'Sử dụng tính năng nhập hàng loạt, kiểm tra trùng lặp SHA-256 và quyết định giữ hoặc bỏ qua.',
        type: 'checklist',
        priority: 'high',
        color: 'blue',
        suggestedAppId: 'resource-vault',
        checklist: [
          'Kéo thả thư mục hoặc nhiều tệp cần lưu',
          'Rà soát các tệp bị báo trùng nội dung',
          'Xác nhận lưu danh sách tài liệu sạch',
        ],
        dependsOnIndices: [0],
      },
      {
        title: 'Kiểm tra và chỉnh lại phân loại môn học, lớp, chủ đề',
        description:
          'Chỉnh các mục có độ tin cậy phân loại thấp và bổ sung thẻ tìm kiếm ngắn gọn.',
        type: 'task',
        priority: 'medium',
        color: 'indigo',
        suggestedAppId: 'resource-vault',
        dependsOnIndices: [1],
      },
      {
        title: 'Gắn học liệu trọng tâm vào bộ tiết dạy sắp tới',
        description:
          'Kiểm tra khả năng mở nhanh và chèn vào bài dạy trong Lesson Studio.',
        type: 'milestone',
        priority: 'low',
        color: 'emerald',
        suggestedAppId: 'lesson-studio',
        dependsOnIndices: [2],
      },
    ],
  },
  {
    id: 'tpl-studio-teaching-plan',
    icon: 'plan',
    category: 'Kế hoạch',
    title: 'Kế hoạch giảng dạy',
    description:
      'Lập kế hoạch theo chương hoặc cụm tiết: phân phối tiết, chuẩn bị học liệu trọng tâm và mốc kiểm tra.',
    steps: [
      {
        title: 'Rà soát phân phối chương trình và số tiết của chủ đề',
        description:
          'Đối chiếu số tiết lý thuyết, luyện tập và ôn tập theo kế hoạch tổ chuyên môn.',
        type: 'task',
        priority: 'high',
        color: 'blue',
        suggestedAppId: 'lesson-studio',
      },
      {
        title: 'Chia cụm bài dạy và tạo khung các bộ tiết dạy',
        description:
          'Tạo danh sách các tiết cần soạn kèm mục tiêu trọng tâm cho từng tiết.',
        type: 'task',
        priority: 'high',
        color: 'indigo',
        suggestedAppId: 'lesson-studio',
        dependsOnIndices: [0],
      },
      {
        title: 'Chuẩn bị học liệu và phiếu bài tập trọng tâm cho cả chương',
        description:
          'Tổng hợp câu hỏi luyện tập, hình ảnh minh họa và bảng tóm tắt kiến thức.',
        type: 'task',
        priority: 'medium',
        color: 'teal',
        suggestedAppId: 'resource-vault',
        dependsOnIndices: [1],
      },
      {
        title: 'Chốt lịch kiểm tra thường xuyên và kiểm tra định kỳ',
        description:
          'Đặt hạn dự kiến cho khâu ra đề, trộn đề và chấm trả bài.',
        type: 'checklist',
        priority: 'medium',
        color: 'amber',
        suggestedAppId: 'math-mixer',
        checklist: [
          'Xác định tuần kiểm tra cho từng lớp phụ trách',
          'Phân bổ nội dung kiến thức cần đánh giá',
        ],
        dependsOnIndices: [1],
      },
      {
        title: 'Tổng kết và điều chỉnh tiến độ cuối chương',
        description:
          'Đọc lại nhật ký các lớp dạy để rút kinh nghiệm cho chương kế tiếp.',
        type: 'milestone',
        priority: 'medium',
        color: 'emerald',
        suggestedAppId: 'teaching-journal',
        dependsOnIndices: [2, 3],
      },
    ],
  },
  {
    id: 'tpl-studio-weekly-tasks',
    icon: 'weekly',
    category: 'Hằng tuần',
    title: 'Công việc tuần',
    description:
      'Danh sách công việc gọn gàng cho một tuần giảng dạy: chuẩn bị tiết, in ấn, chấm bài và tổng kết.',
    steps: [
      {
        title: 'Rà soát thời khóa biểu và các tiết dạy trọng tâm trong tuần',
        description:
          'Liệt kê lớp phụ trách, bài cần dạy mới và bài cần luyện tập củng cố.',
        type: 'task',
        priority: 'high',
        color: 'blue',
        suggestedAppId: 'lesson-studio',
      },
      {
        title: 'Hoàn thiện phiếu học tập và kiểm tra hồ sơ in A4',
        description:
          'Chốt các phiếu bài tập cần phát trước ít nhất 1 ngày để chủ động in ấn.',
        type: 'checklist',
        priority: 'high',
        color: 'indigo',
        suggestedAppId: 'print-studio',
        checklist: [
          'Kiểm tra phiếu học tập các lớp dạy đầu tuần',
          'Kiểm tra phiếu và tài liệu các lớp cuối tuần',
        ],
        dependsOnIndices: [0],
      },
      {
        title: 'Rà soát đề kiểm tra, chấm bài và phản hồi học sinh',
        description:
          'Tổng hợp lỗi sai phổ biến của học sinh để chữa trực tiếp trên lớp.',
        type: 'task',
        priority: 'medium',
        color: 'amber',
        suggestedAppId: 'math-mixer',
      },
      {
        title: 'Ghi chú họp tổ chuyên môn và cập nhật kho học liệu',
        description:
          'Lưu tài liệu dùng chung và thống nhất nội dung chuyên môn với đồng nghiệp.',
        type: 'task',
        priority: 'low',
        color: 'teal',
        suggestedAppId: 'resource-vault',
      },
      {
        title: 'Tổng kết tuần trong Teaching Journal',
        description:
          'Đánh dấu công việc đã hoàn thành và ghi nhận 2–3 điểm ưu tiên cho tuần sau.',
        type: 'milestone',
        priority: 'medium',
        color: 'emerald',
        suggestedAppId: 'teaching-journal',
        dependsOnIndices: [1],
      },
    ],
  },
];

export function getWorkflowStudioTemplateById(
  id: string
): WorkflowStudioTemplate | undefined {
  return WORKFLOW_STUDIO_TEMPLATES.find((t) => t.id === id);
}
