import { useEffect } from 'react';
import { FolderOpen, HelpCircle, PenLine, Plus } from 'lucide-react';
import { AutosaveState } from '../../core/workspaceTabs';
import { LessonPack, PrintSettings } from '../../types/lesson';
import { ContextualAcademyBar } from '../tutorial/ContextualAcademyBar';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { LibraryView } from '../LibraryView';
import { WizardView } from '../WizardView';

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
      {/* Lesson Studio Sub-bar (hidden on print) */}
      <div className="no-print border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="mx-auto max-w-6xl px-4 py-2.5 sm:px-6 flex flex-wrap items-center justify-between gap-3">
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
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                mode === 'editor'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Trình soạn 5 bước</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'library'}
              data-tour-id="ls-tab-library"
              onClick={() => onModeChange('library')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                mode === 'library'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Kho bộ tiết dạy ({packs.length})</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tutorial && (
              <button
                type="button"
                data-tour-id="ls-help-btn"
                onClick={() =>
                  tutorial.startTutorial('tutorial.lesson-studio', { restart: true })
                }
                aria-label="Hướng dẫn sử dụng Lesson Studio"
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                <HelpCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Hướng dẫn</span>
              </button>
            )}
            <button
              type="button"
              data-tour-id="ls-new-pack-btn"
              onClick={onCreateNew}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Bộ tiết dạy mới</span>
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 no-print">
        <ContextualAcademyBar
          tutorialId="tutorial.lesson-studio"
          label="Lesson Studio"
          description="Soạn trọn bộ giáo án 5 bước, ngân hàng câu hỏi 3 mức và Rubric đánh giá."
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
