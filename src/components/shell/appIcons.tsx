import {
  Archive,
  BookOpen,
  FolderKanban,
  GitBranch,
  LayoutGrid,
  NotebookPen,
  Printer,
  ScanLine,
  Settings,
  Sigma,
  Wand2,
} from 'lucide-react';
import { AppId } from '../../core/appRegistry';

export function AppIcon({
  appId,
  className = 'h-4 w-4',
}: {
  appId: AppId;
  className?: string;
}) {
  switch (appId) {
    case 'desktop':
      return <LayoutGrid className={className} aria-hidden="true" />;
    case 'workspace':
      return <FolderKanban className={className} aria-hidden="true" />;
    case 'lesson-studio':
      return <BookOpen className={className} aria-hidden="true" />;
    case 'resource-vault':
      return <Archive className={className} aria-hidden="true" />;
    case 'workflow-center':
      return <GitBranch className={className} aria-hidden="true" />;
    case 'print-studio':
      return <Printer className={className} aria-hidden="true" />;
    case 'math-mixer':
      return <Sigma className={className} aria-hidden="true" />;
    case 'exam-generator':
      return <Wand2 className={className} aria-hidden="true" />;
    case 'grading-studio':
      return <ScanLine className={className} aria-hidden="true" />;
    case 'teaching-journal':
      return <NotebookPen className={className} aria-hidden="true" />;
    case 'settings':
      return <Settings className={className} aria-hidden="true" />;
  }
}
