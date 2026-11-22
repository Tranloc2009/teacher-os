import {
  ArrowRight,
  BookOpenCheck,
  Briefcase,
  Calculator,
  GitBranch,
  Printer,
  ScanLine,
  Settings,
  Wand2,
} from 'lucide-react';
import { AppId } from '../../core/appRegistry';
import { PageBanner } from '../ui/DesignSystem';

interface ToolsHubViewProps {
  workflowCount: number;
  mathExamCount: number;
  packCount: number;
  journalCount: number;
  onOpenApp: (appId: AppId) => void;
}

interface ToolCardItem {
  id: AppId;
  title: string;
  description: string;
  metricLabel: string;
  ctaLabel: string;
  icon: typeof GitBranch;
  tourId: string;
}

export function ToolsHubView({
  workflowCount,
  mathExamCount,
  packCount,
  journalCount,
  onOpenApp,
}: ToolsHubViewProps) {
  const tools: ToolCardItem[] = [
    {
      id: 'workflow-center',
      title: 'Workflow Center',
      description:
        'Lập kế hoạch và sơ đồ quy trình công việc, phân tích mô tả tiếng Việt thành cây nhiệm vụ và theo dõi checklist.',
      metricLabel: `${workflowCount} quy trình đang lưu`,
      ctaLabel: 'Mở Workflow Center',
      icon: GitBranch,
      tourId: 'desktop-app-workflow-center',
    },
    {
      id: 'exam-generator',
      title: 'Smart Exam Generator 2.0',
      description:
        'Tạo đề kiểm tra tự động 5 bước theo ma trận, sinh biến thể đổi số Level 1 có kiểm chứng thế ngược độc lập (không AI API) và chuyển sang Exam Mixer Pro.',
      metricLabel: 'Biến thể kiểm chứng cục bộ',
      ctaLabel: 'Mở Smart Exam Generator',
      icon: Wand2,
      tourId: 'desktop-app-exam-generator',
    },
    {
      id: 'math-mixer',
      title: 'Exam Mixer Pro 6.0',
      description:
        'Nhập đề Word (.docx) hoặc văn bản đa môn (12 môn học, 10 dạng câu hỏi), khóa ngữ liệu 5 lớp và xuất trọn bộ DOCX/ZIP/PDF A4.',
      metricLabel: `${mathExamCount} đề kiểm tra đa môn`,
      ctaLabel: 'Mở Exam Mixer Pro 6.0',
      icon: Calculator,
      tourId: 'desktop-app-math-mixer',
    },
    {
      id: 'grading-studio',
      title: 'Smart Grading Studio',
      description:
        'Tạo phiếu trả lời A4 chuẩn OMR, nhận diện ô tô cục bộ theo đáp án từng mã đề Exam Mixer Pro, duyệt thủ công và xuất Excel + ZIP minh chứng.',
      metricLabel: 'Chấm OMR 100% cục bộ',
      ctaLabel: 'Mở Smart Grading Studio',
      icon: ScanLine,
      tourId: 'desktop-app-grading-studio',
    },
    {
      id: 'print-studio',
      title: 'Print Studio',
      description:
        'Xem trước khổ giấy A4, căn lề chuẩn và in hoặc xuất PDF giáo án, 3 mẫu phiếu A/B/C và đáp án giáo viên.',
      metricLabel: `${packCount} bộ tiết dạy sẵn sàng in`,
      ctaLabel: 'Mở Print Studio',
      icon: Printer,
      tourId: 'desktop-app-print-studio',
    },
    {
      id: 'teaching-journal',
      title: 'Teaching Journal',
      description:
        'Ghi nhận nhật ký sau tiết dạy, đánh giá nhịp độ thời gian, vướng mắc học sinh và áp dụng cải tiến vào bài dạy.',
      metricLabel: `${journalCount} nhật ký giảng dạy`,
      ctaLabel: 'Mở Teaching Journal',
      icon: BookOpenCheck,
      tourId: 'desktop-app-teaching-journal',
    },
    {
      id: 'settings',
      title: 'Cài đặt & Sao lưu',
      description:
        'Tùy chỉnh khổ giấy A4, giao diện Sáng/Tối, tạo Snapshot khôi phục nhanh và xuất/nhập bản sao lưu JSON toàn hệ thống.',
      metricLabel: 'IndexedDB cục bộ & JSON',
      ctaLabel: 'Mở Cài đặt',
      icon: Settings,
      tourId: 'desktop-app-settings',
    },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <PageBanner
        title="Công cụ chuyên sâu"
        subtitle="Tập trung các công cụ lập quy trình, trộn đề Toán, xuất bản in A4, nhật ký giảng dạy và quản trị dữ liệu."
        icon={<Briefcase className="h-5 w-5" aria-hidden="true" />}
      />

      <section aria-label="Danh sách công cụ chuyên sâu">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => {
            const IconComponent = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                data-tour-id={tool.tourId}
                onClick={() => onOpenApp(tool.id)}
                className="group flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                      <IconComponent className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-mono-num text-slate-500 dark:text-slate-400">
                      {tool.metricLabel}
                    </span>
                  </div>

                  <h2 className="mt-4 text-base font-semibold text-slate-950 dark:text-slate-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {tool.title}
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {tool.description}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-blue-600 dark:text-blue-400">
                  <span>{tool.ctaLabel}</span>
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
