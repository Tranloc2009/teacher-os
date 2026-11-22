import { ArrowDownRight, ArrowRight, FilePlus2, FileText, FolderOpen, Layers2, ScanLine } from 'lucide-react';
import type { AppId } from '../../core/appRegistry';
import type { LessonPack, ResourceItem } from '../../types/lesson';
import type { MathExamProject } from '../../types/mathExam';
import type { GeneratedExamDraft } from '../../types/examGenerator';
import type { ConnectedWorkspaceWorkflowSummary, DashboardNextStepSuggestion } from '../../types/connectedWorkflow';
import { HeroShowcaseVideo } from './HeroShowcaseVideo';
import { EmptyState, PageHeader, SectionHeader } from './WorkspaceUI';
import { useState } from 'react';

interface DesktopHomeProps {
  isActive?: boolean;
  packs: LessonPack[];
  mathExams: MathExamProject[];
  resources: ResourceItem[];
  examDrafts?: GeneratedExamDraft[];
  hasActiveUnsavedDraft: boolean;
  nextStepSuggestions?: DashboardNextStepSuggestion[];
  workflows: ConnectedWorkspaceWorkflowSummary[];
  onStartExam: () => void;
  onOpenApp: (appId: AppId) => void;
  onExecuteNextStep: (suggestion: DashboardNextStepSuggestion) => void;
  onResumeWorkflow: (workflow: ConnectedWorkspaceWorkflowSummary) => void;
  onOpenPackInStudio: (pack: LessonPack) => void;
  onOpenExam: (exam: MathExamProject) => void;
  onOpenDraft: (draft: GeneratedExamDraft) => void;
  onOpenResource: (resource: ResourceItem) => void;
}

const dateFormat = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' });
const byUpdate = <T extends { updatedAt: string }>(items: T[]) =>
  [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
type Row = { id: string; title: string; subtitle: string; updatedAt: string; open: () => void };
function WorkList({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return <ul className="tos-worklist">{rows.map((row) => (
    <li key={row.id}>
      <button type="button" onClick={row.open} className="tos-workrow">
        <FileText size={17} aria-hidden="true" />
        <span className="tos-row-copy"><strong>{row.title}</strong><small>{row.subtitle}</small></span>
        <time dateTime={row.updatedAt}>{Number.isFinite(Date.parse(row.updatedAt)) && dateFormat.format(new Date(row.updatedAt))}</time>
        <ArrowRight size={15} aria-hidden="true" />
      </button>
    </li>
  ))}</ul>;
}

export function DesktopHome(props: DesktopHomeProps) {
  const [showVideo, setShowVideo] = useState(false);
  const examRows = byUpdate<Row>([
    ...props.examDrafts?.filter((d) => d.status !== 'exported').map((d) => ({
      id: 'draft-' + d.id, title: d.title || d.draftLabel,
      subtitle: [d.draftLabel === d.title ? '' : d.draftLabel, d.status === 'reviewed' ? 'Đã rà soát' : 'Bản nháp'].filter(Boolean).join(' · '),
      updatedAt: d.updatedAt, open: () => props.onOpenDraft(d),
    })) ?? [],
    ...props.mathExams.filter((e) => !e.isDemo && e.generatedVersions.length === 0).map((e) => ({
      id: 'exam-' + e.id, title: e.title || 'Đề chưa đặt tên', subtitle: e.confirmedOriginalAnswers ? 'Đã xác nhận đáp án' : 'Đang soạn',
      updatedAt: e.updatedAt, open: () => props.onOpenExam(e),
    })),
  ]).slice(0, 4);
  const recent = byUpdate<Row>([
    ...props.packs.filter((p) => !p.isDemo).map((p) => ({
      id: 'lesson-' + p.id, title: p.title || 'Bài dạy chưa đặt tên', subtitle: p.status === 'draft' ? 'Bài dạy đang soạn' : 'Bài dạy',
      updatedAt: p.updatedAt, open: () => props.onOpenPackInStudio(p),
    })),
    ...props.mathExams.filter((e) => !e.isDemo && e.generatedVersions.length > 0).map((e) => ({
      id: 'mixed-' + e.id, title: e.title || 'Đề chưa đặt tên', subtitle: e.generatedVersions.length + ' mã đề',
      updatedAt: e.updatedAt, open: () => props.onOpenExam(e),
    })),
  ]).slice(0, 4);
  const documents = byUpdate(props.resources).slice(0, 4).map((r) => ({
    id: r.id, title: r.title || 'Tài liệu chưa đặt tên', subtitle: [r.subject, r.grade].filter(Boolean).join(' · '),
    updatedAt: r.updatedAt, open: () => props.onOpenResource(r),
  }));
  const work = props.nextStepSuggestions?.filter((s) => !s.examId || props.mathExams.some((e) => e.id === s.examId && !e.isDemo)).slice(0, 2) ?? [];
  const workflows = props.workflows.filter(({ workflow, completedStageCount, totalStageCount }) =>
    workflow.history.length > 0 && completedStageCount < totalStageCount,
  ).slice(0, 2);
  return (
    <main className="tos-page tos-overview" id="teacheros-main" data-tour-id="desktop-hero">
      <div className="tos-welcome">
        <PageHeader title="Chào mừng trở lại" description="Bạn muốn thực hiện công việc nào hôm nay?" />
        <button type="button" className="tos-video-link" aria-expanded={showVideo} aria-controls="teacheros-video"
          onClick={() => setShowVideo(!showVideo)}>
          {showVideo ? 'Ẩn video giới thiệu' : 'Giới thiệu TeacherOS'} <ArrowDownRight size={16} aria-hidden="true" />
        </button>
      </div>
      {showVideo && <div id="teacheros-video" className="tos-intro-video"><HeroShowcaseVideo isActive={props.isActive} /></div>}
      <div className="tos-quick-actions" aria-label="Bắt đầu công việc">
        <button type="button" className="tos-action tos-action-primary" onClick={props.onStartExam}>
          <FilePlus2 size={21} aria-hidden="true" /><strong>Tạo đề kiểm tra</strong><span>Soạn đề theo từng bước</span><ArrowRight size={17} aria-hidden="true" />
        </button>
        <button type="button" className="tos-action" onClick={() => props.onOpenApp('math-mixer')}>
          <Layers2 size={21} aria-hidden="true" /><strong>Trộn mã đề</strong><span>Nhập đề và kiểm tra đáp án</span><ArrowRight size={17} aria-hidden="true" />
        </button>
        <button type="button" className="tos-action" onClick={() => props.onOpenApp('grading-studio')}>
          <ScanLine size={21} aria-hidden="true" /><strong>Chấm bài</strong><span>Đọc phiếu và rà soát kết quả</span><ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
      {(props.hasActiveUnsavedDraft || work.length > 0 || workflows.length > 0) && <section className="tos-next" aria-label="Việc cần xử lý">
        <SectionHeader title="Việc cần xử lý" />
        {props.hasActiveUnsavedDraft && <p role="status">Bài dạy đang mở có thay đổi chưa lưu.</p>}
        {work.map((s) => <button type="button" className="tos-next-row" key={s.id} onClick={() => props.onExecuteNextStep(s)}>
          <span><strong>{s.title}</strong><small>{s.description}</small></span>
          <span className="tos-next-link">{s.primaryActionLabel}<ArrowRight size={15} aria-hidden="true" /></span>
        </button>)}
        {workflows.map((summary) => <button type="button" className="tos-next-row" key={summary.workflow.workflowId}
          onClick={() => props.onResumeWorkflow(summary)}>
          <span><strong>{summary.workflow.title}</strong><small>{summary.completedStageCount}/{summary.totalStageCount} bước đã hoàn thành</small></span>
          <span className="tos-next-link">{summary.resumeLabel}<ArrowRight size={15} aria-hidden="true" /></span>
        </button>)}
      </section>}
      <div className="tos-overview-columns">
        <section>
          <SectionHeader title="Đề kiểm tra đang soạn" />
          <WorkList rows={examRows} empty="Chưa có đề đang soạn." />
          <SectionHeader title="Công việc gần đây" />
          <WorkList rows={recent} empty="Chưa có bài dạy hoặc mã đề gần đây." />
        </section>
        <section className="tos-overview-library">
          <SectionHeader title="Tài liệu cập nhật gần đây" action={
            <button type="button" className="tos-text-button" onClick={() => props.onOpenApp('resource-vault')} aria-label="Mở kho tài liệu">
              <FolderOpen size={17} aria-hidden="true" />
            </button>
          } />
          <WorkList rows={documents} empty="Chưa có tài liệu trong kho." />
        </section>
      </div>
    </main>
  );
}
