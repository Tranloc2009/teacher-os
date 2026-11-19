import { useEffect } from 'react';
import { BookOpen, FolderOpen, HelpCircle, PenLine, Plus } from 'lucide-react';
import { AutosaveState } from '../../core/workspaceTabs';
import { LessonPack, PrintSettings } from '../../types/lesson';
import { ContextualAcademyBar } from '../tutorial/ContextualAcademyBar';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { LibraryView } from '../LibraryView';
import { WizardView } from '../WizardView';
import { Button, PageBanner } from '../ui/DesignSystem';

export type LessonStudioMode = 'editor' | 'library';

interface LessonStudioAppProps {
  mode: LessonStudioMode;
  onModeChange: (mode: LessonStudioMode) => void;
  activePack: LessonPack;
  packs: LessonPack[];
  settings: PrintSettings;
  temporaryMode: boolean;
  onSavePack: (pack: LessonPack, silent?: boolean) => Promise<LessonPack>;
  onCreateNew: () => void;
  onEditPack: (pack: LessonPack) => void;
  onDuplicatePack: (pack: LessonPack) => void;
  onDeletePack: (pack: LessonPack) => void;
  onClearAllDemos: () => void;
  onRestoreDemos: () => void;
  onOpenSettings: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onAutosaveStateChange?: (state: AutosaveState) => void;
  onOpenPackContextMenu?: (pack: LessonPack, x: number, y: number) => void;
}

export function LessonStudioApp({
  mode,
  onModeChange,
  activePack,
  packs,
  settings,
  temporaryMode,
  onSavePack,
  onCreateNew,
  onEditPack,
  onDuplicatePack,
  onDeletePack,
  onClearAllDemos,
  onRestoreDemos,
  onOpenSettings,
  onDirtyChange,
  onAutosaveStateChange,
  onOpenPackContextMenu,
}: LessonStudioAppProps) {
  const tutorial = useOptionalTutorial();

  useEffect(() => {
    if (
      tutorial?.activeTutorial?.tutorialId === 'tutorial.lesson-studio' &&
      mode !== 'editor'
    ) {
      onModeChange('editor');
    }
  }, [tutorial?.activeTutorial?.tutorialId, mode, onModeChange]);

  return (
    <div className="print:p-0 print:m-0">
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 space-y-5 no-print">
        <ContextualAcademyBar
          tutorialId="tutorial.lesson-studio"
          label="Lesson Studio"
          description="Soạn trọn bộ giáo án 5 bước, ngân hàng câu hỏi 3 mức và Rubric đánh giá."
        />

        <PageBanner
          title="Lesson Studio"
          subtitle="Soạn bài dạy rõ ràng, nhanh và dễ in"
          icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="Chế độ Lesson Studio"
                data-tour-id="ls-mode-tabs"
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'editor'}
                  onClick={() => onModeChange('editor')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    mode === 'editor'
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                  }`}
                >
                  <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Soạn bài dạy</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'library'}
                  data-tour-id="ls-tab-library"
                  onClick={() => onModeChange('library')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    mode === 'library'
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                  }`}
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Kho bộ tiết dạy ({packs.length})</span>
                </button>
              </div>

              {tutorial && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-tour-id="ls-help-btn"
                  onClick={() =>
                    tutorial.startTutorial('tutorial.lesson-studio', { restart: true })
                  }
                  aria-label="Hướng dẫn sử dụng Lesson Studio"
                >
                  <HelpCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <span>Hướng dẫn</span>
                </Button>
              )}

              <Button
                variant="secondary"
                size="sm"
                data-tour-id="ls-new-pack-btn"
                onClick={onCreateNew}
              >
                <Plus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Bộ tiết dạy mới</span>
              </Button>
            </div>
          }
        />
      </div>

      {/* Keep WizardView mounted while switching between Editor and Library sub-tabs */}
      <div className={mode === 'editor' ? 'block' : 'hidden print:hidden'}>
        <WizardView
          initialPack={activePack}
          settings={settings}
          temporaryMode={temporaryMode}
          onSavePack={onSavePack}
          onOpenSettings={onOpenSettings}
          onBackToLibrary={() => onModeChange('library')}
          onDirtyChange={onDirtyChange}
          onAutosaveStateChange={onAutosaveStateChange}
        />
      </div>

      <div className={mode === 'library' ? 'block print:hidden' : 'hidden print:hidden'}>
        <LibraryView
          packs={packs}
          onCreateNew={onCreateNew}
          onEditPack={(p) => {
            onEditPack(p);
            onModeChange('editor');
          }}
          onDuplicatePack={onDuplicatePack}
          onDeletePack={onDeletePack}
          onClearAllDemos={onClearAllDemos}
          onRestoreDemos={onRestoreDemos}
          onOpenPackContextMenu={onOpenPackContextMenu}
        />
      </div>
    </div>
  );
}
