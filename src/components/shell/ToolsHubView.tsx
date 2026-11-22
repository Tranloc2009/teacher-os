import { ArrowRight, BookOpen, BookOpenCheck, FolderOpen, GitBranch, Layers2, LayoutGrid, Printer } from 'lucide-react';
import type { AppId } from '../../core/appRegistry';
import { PageHeader, SectionHeader } from './WorkspaceUI';

const groups = [
  { title: 'Đề kiểm tra', tools: [
    { id: 'math-mixer', title: 'Trộn mã đề', description: 'Nhập đề, kiểm tra đáp án và trộn mã.', icon: Layers2 },
    { id: 'print-studio', title: 'In và thiết kế mẫu đề', description: 'Căn trang A4, xem trước và xuất bản in.', icon: Printer },
  ] },
  { title: 'Giảng dạy và tổ chức', tools: [
    { id: 'lesson-studio', title: 'Soạn bài', description: 'Mở bài dạy đã lưu hoặc bắt đầu bài mới.', icon: BookOpen },
    { id: 'workspace', title: 'Không gian làm việc', description: 'Sắp xếp tài liệu và ý tưởng trên bảng.', icon: LayoutGrid },
    { id: 'workflow-center', title: 'Quy trình công việc', description: 'Theo dõi các bước chuẩn bị, giảng dạy và đánh giá.', icon: GitBranch },
    { id: 'teaching-journal', title: 'Nhật ký giảng dạy', description: 'Ghi lại điều đã làm và điều cần cải thiện.', icon: BookOpenCheck },
    { id: 'resource-vault', title: 'Kho tài liệu', description: 'Tìm tài liệu hoặc nhập tệp từ máy.', icon: FolderOpen },
  ] },
] as const;

export function ToolsHubView({ onOpenApp }: { onOpenApp: (id: AppId) => void }) {
  return <main className="tos-page tos-module tos-tools">
    <PageHeader title="Thêm công cụ" />
    {groups.map((group) => <section key={group.title}>
      <SectionHeader title={group.title} />
      <ul className="tos-worklist">{group.tools.map(({ id, title, description, icon: Icon }) => <li key={id}>
        <button type="button" className="tos-workrow" data-tour-id={'desktop-app-' + id} onClick={() => onOpenApp(id)}>
          <Icon size={18} aria-hidden="true" />
          <span className="tos-row-copy"><strong>{title}</strong><small>{description}</small></span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </li>)}</ul>
    </section>)}
  </main>;
}
