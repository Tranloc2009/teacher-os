import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import {
  LocalSnapshotSummary,
  bulkDeleteCanvasNodes,
  bulkSaveCanvasBundle,
  bulkSaveCanvasNodes,
  bulkSaveResourcesWithFiles,
  clearDemoPacks,
  createEmptyLessonPack,
  createId,
  createManualSnapshot,
  deleteCanvasBoard,
  deleteCanvasEdge,
  deleteCanvasNode,
  deleteJournal,
  deleteLessonPack,
  deleteMathExam,
  deleteResource,
  deleteWorkflow,
  duplicateLessonPack,
  duplicateMathExam,
  getSnapshotSummary,
  initializeDatabase,
  listCanvasBoards,
  listCanvasEdges,
  listCanvasNodes,
  listCanvasViewSettings,
  listGradingSessions,
  listJournals,
  listLessonPacks,
  listMathExams,
  listResources,
  listWorkflows,
  loadConnectedWorkflowContext,
  loadExamFormTemplates,
  normalizeLegacyLessonPack,
  replaceAllFromBackup,
  replaceBoardCanvasState,
  restoreDemoPacks,
  rollbackToSnapshot,
  saveCanvasBoard,
  saveCanvasEdge,
  saveCanvasNode,
  saveCanvasViewSettings,
  saveConnectedWorkflowContext,
  saveExamFormTemplates,
  saveJournal,
  saveLessonPack,
  saveMathExam,
  savePrintSettings,
  saveResource,
  saveWorkflow,
} from './db/database';
import { DEMO_LESSON_PACKS } from './data/demoPacks';
import { DEMO_MATH_EXAM } from './data/demoMathExams';
import {
  DEFAULT_CANVAS_BOARDS,
  DEFAULT_CANVAS_EDGES,
  DEFAULT_CANVAS_NODES,
  DEFAULT_CANVAS_VIEW_SETTINGS,
} from './data/demoCanvas';
import type {
  CanvasBoard,
  CanvasEdgeRecord,
  CanvasEntityRef,
  CanvasNodeRecord,
  CanvasViewSettings,
} from './types/canvas';
import type { MathExamProject, MathExamStep } from './types/mathExam';
import type { ExamFormTemplate } from './types/examForm';
import { BUILT_IN_EXAM_FORM_PRESETS } from './core/examFormEngine';
import type { GradingSession } from './types/grading';
import type { GeneratedExamDraft } from './types/examGenerator';
import type {
  ConnectedWorkflowContext,
  ConnectedWorkflowStageId,
  DashboardNextStepSuggestion,
  ParsedUniversalCommand,
  WorkflowStageEvaluation,
} from './types/connectedWorkflow';
import {
  computeDashboardNextSteps,
  createInitialWorkflowContext,
  evaluateConnectedWorkflowProgress,
  patchWorkflowContext,
} from './core/connectedWorkflowEngine';
import {
  DEFAULT_JOURNALS,
  DEFAULT_RESOURCES,
  DEFAULT_WORKFLOWS,
  applyJournalAdjustmentToPack,
  createLessonVariant,
  insertResourceIntoPack,
} from './core/workspaceModules';
import {
  BackupPayload,
  JournalEntry,
  LessonPack,
  PrintSettings,
  ResourceItem,
  WorkflowRun,
} from './types/lesson';
import type { StoredResourceFileRecord } from './types/resourceBulk';
import { DEFAULT_PRINT_SETTINGS } from './utils/backup';
import {
  StorageFailureInfo,
  classifyStorageError,
  exportJsonBackupFile,
  exportSinglePackJson,
} from './utils/storageResilience';
import { AppId } from './core/appRegistry';
import { PaletteActionId } from './core/localSearch';
import {
  UIPreferences,
  applyUIPreferencesToDocument,
  readUIPreferences,
} from './core/theme';
import {
  AutosaveState,
  INITIAL_WORKSPACE_TABS,
  InternalNotificationItem,
  WorkspaceTab,
  appendNotificationLog,
  syncTabsWithPacks,
  upsertAppTab,
  upsertLessonPackTab,
} from './core/workspaceTabs';
import { ShellTopBar, ShellViewId } from './components/shell/ShellTopBar';
import {
  MobileBottomNav,
  ShellNavId,
  ShellSidebar,
} from './components/shell/ShellSidebar';
import { ToolsHubView } from './components/shell/ToolsHubView';
import { AppDock } from './components/shell/AppDock';
import { AppLauncher } from './components/shell/AppLauncher';
import { CommandPalette } from './components/shell/CommandPalette';
import { ConnectedWorkflowBar } from './components/shell/ConnectedWorkflowBar';
import { ContextMenu, PackContextMenuState } from './components/shell/ContextMenu';
import { SkeletonLoader } from './components/shell/SkeletonLoader';
import { DesktopHome } from './components/shell/DesktopHome';
import { CreditFooter } from './components/shell/CreditFooter';
import { OfflineIndicator } from './components/shell/OfflineIndicator';
import {
  LessonStudioApp,
  LessonStudioMode,
} from './components/apps/LessonStudioApp';
import { PrintStudioApp } from './components/apps/PrintStudioApp';
import { MyWorkspaceApp } from './components/apps/MyWorkspaceApp';
import { ResourceVaultApp } from './components/apps/ResourceVaultApp';
import { WorkflowCenterApp } from './components/apps/WorkflowCenterApp';
import { TeachingJournalApp } from './components/apps/TeachingJournalApp';
import { MathExamMixerApp } from './components/apps/MathExamMixerApp';
import {
  GeneratorTabId,
  SmartExamGeneratorApp,
} from './components/apps/SmartExamGeneratorApp';
import {
  GradingTabId,
  SmartGradingStudioApp,
} from './components/apps/SmartGradingStudioApp';
import { SettingsView } from './components/SettingsView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast, ToastMessage, ToastTone } from './components/Toast';
import {
  TutorialProvider,
  useTutorial,
} from './components/tutorial/TutorialProvider';
import { TutorialOverlay } from './components/tutorial/TutorialOverlay';

const ALT_SHORTCUT_TO_APP: Record<string, AppId> = {
  '1': 'desktop',
  '2': 'lesson-studio',
  '3': 'print-studio',
  '4': 'workspace',
  '5': 'resource-vault',
  '6': 'workflow-center',
  '7': 'teaching-journal',
  '8': 'math-mixer',
  '9': 'grading-studio',
  '0': 'settings',
};

function TutorialShellBindings({
  launcherOpen,
  paletteOpen,
}: {
  launcherOpen: boolean;
  paletteOpen: boolean;
}) {
  const { emitTutorialEvent } = useTutorial();

  useEffect(() => {
    if (launcherOpen) {
      emitTutorialEvent('launcher-opened');
    }
  }, [launcherOpen, emitTutorialEvent]);

  useEffect(() => {
    if (paletteOpen) {
      emitTutorialEvent('palette-opened');
    }
  }, [paletteOpen, emitTutorialEvent]);

  return null;
}

function TopBarWithTutorial(
  props: Omit<Parameters<typeof ShellTopBar>[0], 'onOpenTutorialLauncher'>
) {
  const { openLauncher } = useTutorial();
  return <ShellTopBar {...props} onOpenTutorialLauncher={openLauncher} />;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loadErrorInfo, setLoadErrorInfo] = useState<StorageFailureInfo | null>(null);
  const [temporaryMode, setTemporaryMode] = useState(false);
  const [storageBannerError, setStorageBannerError] = useState<StorageFailureInfo | null>(null);

  // Layer 1: TeacherOS 4.1 Shell state
  const [activeApp, setActiveApp] = useState<AppId>('desktop');
  const [activeView, setActiveView] = useState<ShellViewId>('desktop');
  const [openedApps, setOpenedApps] = useState<AppId[]>(['desktop', 'lesson-studio']);
  const [, setTabs] = useState<WorkspaceTab[]>(INITIAL_WORKSPACE_TABS);
  const [, setActiveTabId] = useState<string>(INITIAL_WORKSPACE_TABS[0].id);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [uiPrefs, setUiPrefs] = useState<UIPreferences>(() => readUIPreferences());
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('saved');
  const [notifications, setNotifications] = useState<InternalNotificationItem[]>([]);
  const [contextMenu, setContextMenu] = useState<PackContextMenuState | null>(null);

  // Layer 2: App-level state (preserved across app switches)
  const [lessonStudioMode, setLessonStudioMode] = useState<LessonStudioMode>('editor');
  const [lessonStudioHasDraftChanges, setLessonStudioHasDraftChanges] = useState(false);
  const [printPackId, setPrintPackId] = useState<string>('');
  const [printPreferredExamId, setPrintPreferredExamId] = useState<string | null>(null);
  const [printPreferredFormLabel, setPrintPreferredFormLabel] = useState<string | null>(null);
  const [examMixerPreferredExamId, setExamMixerPreferredExamId] = useState<string | null>(null);
  const [examMixerPreferredStep, setExamMixerPreferredStep] = useState<MathExamStep | null>(null);
  const [examGeneratorPreferredResourceId, setExamGeneratorPreferredResourceId] = useState<string | null>(null);
  const [examGeneratorPreferredTab, setExamGeneratorPreferredTab] = useState<GeneratorTabId | null>(null);
  const [examGeneratorPreferredPrompt, setExamGeneratorPreferredPrompt] = useState<string | null>(null);
  const [examGeneratorPreferredTopic, setExamGeneratorPreferredTopic] = useState<string | null>(null);
  const [gradingPreferredExamId, setGradingPreferredExamId] = useState<string | null>(null);
  const [gradingPreferredClassName, setGradingPreferredClassName] = useState<string | null>(null);
  const [gradingPreferredTab, setGradingPreferredTab] = useState<GradingTabId | null>(null);

  // Connected Workflow Shared Context (persisted across reload in IndexedDB meta)
  const [workflowContext, setWorkflowContext] = useState<ConnectedWorkflowContext>(() =>
    createInitialWorkflowContext()
  );
  const [gradingSessions, setGradingSessions] = useState<GradingSession[]>([]);
  const [examFormTemplates, setExamFormTemplates] = useState<ExamFormTemplate[]>(() =>
    structuredClone(BUILT_IN_EXAM_FORM_PRESETS)
  );

  // Layer 3: Shared Core data state (IndexedDB v8)
  const [packs, setPacks] = useState<LessonPack[]>([]);
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [mathExams, setMathExams] = useState<MathExamProject[]>([]);
  const [canvasBoards, setCanvasBoards] = useState<CanvasBoard[]>([]);
  const [canvasNodes, setCanvasNodes] = useState<CanvasNodeRecord[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdgeRecord[]>([]);
  const [canvasViewSettings, setCanvasViewSettings] = useState<CanvasViewSettings[]>([]);
  const [snapshotSummary, setSnapshotSummary] = useState<LocalSnapshotSummary>({
    exists: false,
    label: '',
    createdAt: '',
    packCount: 0,
  });
  const [activePack, setActivePack] = useState<LessonPack>(() =>
    createEmptyLessonPack()
  );
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LessonPack | null>(null);
  const [confirmClearDemos, setConfirmClearDemos] = useState(false);

  const showToast = useCallback((tone: ToastTone, text: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToast({ id, tone, text });
    setNotifications((prev) => appendNotificationLog(prev, tone, text));
  }, []);

  useEffect(() => {
    applyUIPreferencesToDocument(uiPrefs);
  }, [uiPrefs]);

  const updateUIPrefs = useCallback((patch: Partial<UIPreferences>) => {
    setUiPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleTheme = useCallback(() => {
    setUiPrefs((prev) => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'light' : 'dark',
    }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setUiPrefs((prev) => ({
      ...prev,
      sidebarCollapsed: !prev.sidebarCollapsed,
    }));
  }, []);

  const updateWorkflowContext = useCallback(
    (
      patch: Partial<Omit<ConnectedWorkflowContext, 'workflowId' | 'createdAt' | 'history'>>,
      historyItem?: {
        stage: ConnectedWorkflowStageId;
        appId: AppId;
        summary: string;
      }
    ) => {
      setWorkflowContext((prev) => {
        const next = patchWorkflowContext(prev, patch, historyItem);
        void saveConnectedWorkflowContext(next);
        return next;
      });
    },
    []
  );

  const openApp = useCallback((appId: AppId) => {
    setActiveApp(appId);
    setActiveView(appId);
    setOpenedApps((prev) => (prev.includes(appId) ? prev : [...prev, appId]));
    setTabs((prevTabs) => {
      const res = upsertAppTab(prevTabs, appId);
      setActiveTabId(res.activeTabId);
      return res.tabs;
    });
    setWorkflowContext((prev) => {
      if (prev.lastActiveApp === appId) return prev;
      const next = patchWorkflowContext(prev, { lastActiveApp: appId });
      void saveConnectedWorkflowContext(next);
      return next;
    });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  const openToolsHub = useCallback(() => {
    setActiveView('tools');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  const handleSelectNav = useCallback(
    (navId: ShellNavId) => {
      if (navId === 'tools') {
        openToolsHub();
        return;
      }
      openApp(navId);
    },
    [openApp, openToolsHub]
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Global Shell shortcuts: Ctrl+K (Universal Search), Ctrl+B (Sidebar), Alt+1..7/0
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setLauncherOpen(false);
        setPaletteOpen((prev) => !prev);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const mapped = ALT_SHORTCUT_TO_APP[e.key];
        if (mapped) {
          e.preventDefault();
          setLauncherOpen(false);
          setPaletteOpen(false);
          openApp(mapped);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openApp, toggleSidebar]);

  // Sync print margin CSS custom properties for @media print
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--print-margin-top', `${settings.marginsMm.top}mm`);
    root.style.setProperty('--print-margin-right', `${settings.marginsMm.right}mm`);
    root.style.setProperty('--print-margin-bottom', `${settings.marginsMm.bottom}mm`);
    root.style.setProperty('--print-margin-left', `${settings.marginsMm.left}mm`);
  }, [settings.marginsMm]);

  // Cảnh báo nếu người dùng đóng/làm mới tab khi đang ở chế độ tạm thời hoặc có lỗi ghi IndexedDB
  useEffect(() => {
    if (!temporaryMode && !storageBannerError) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [temporaryMode, storageBannerError]);

  const loadDatabase = useCallback(async () => {
    setLoading(true);
    setLoadErrorInfo(null);
    try {
      const result = await initializeDatabase();
      const [snap, savedWfCtx, loadedSessions, loadedForms] = await Promise.all([
        getSnapshotSummary(),
        loadConnectedWorkflowContext(),
        listGradingSessions().catch(() => [] as GradingSession[]),
        loadExamFormTemplates(),
      ]);
      setPacks(result.packs);
      setSettings(result.settings);
      setResources(result.resources);
      setWorkflows(result.workflows);
      setJournals(result.journals);
      setMathExams(result.mathExams);
      setCanvasBoards(result.canvasBoards);
      setCanvasNodes(result.canvasNodes);
      setCanvasEdges(result.canvasEdges);
      setCanvasViewSettings(result.canvasViewSettings);
      setSnapshotSummary(snap);
      setWorkflowContext(savedWfCtx);
      setGradingSessions(loadedSessions);
      setExamFormTemplates(loadedForms);
      setTemporaryMode(false);
      setStorageBannerError(null);
      if (result.packs.length > 0) {
        setActivePack(result.packs[0]);
        setPrintPackId((prev) => prev || result.packs[0].id);
      }
    } catch (err) {
      setLoadErrorInfo(classifyStorageError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDatabase();
  }, [loadDatabase]);

  // Keep workspace tabs synchronized with pack titles / deletions
  useEffect(() => {
    setTabs((prev) => syncTabsWithPacks(prev, packs, activePack));
  }, [packs, activePack]);

  const enterTemporaryMode = () => {
    const demoCopy = structuredClone(DEMO_LESSON_PACKS);
    setPacks(demoCopy);
    setSettings({ ...DEFAULT_PRINT_SETTINGS, updatedAt: new Date().toISOString() });
    setResources(structuredClone(DEFAULT_RESOURCES));
    setWorkflows(structuredClone(DEFAULT_WORKFLOWS));
    setJournals(structuredClone(DEFAULT_JOURNALS));
    setMathExams([structuredClone(DEMO_MATH_EXAM)]);
    setCanvasBoards(structuredClone(DEFAULT_CANVAS_BOARDS));
    setCanvasNodes(structuredClone(DEFAULT_CANVAS_NODES));
    setCanvasEdges(structuredClone(DEFAULT_CANVAS_EDGES));
    setCanvasViewSettings(structuredClone(DEFAULT_CANVAS_VIEW_SETTINGS));
    setActivePack(demoCopy[0] ?? createEmptyLessonPack());
    setPrintPackId(demoCopy[0]?.id ?? '');
    setTemporaryMode(true);
    setLoadErrorInfo(null);
    showToast(
      'info',
      'Đang chạy ở chế độ tạm thời. Hãy tải sao lưu JSON trước khi đóng trình duyệt.'
    );
  };

  const refreshPacks = useCallback(async () => {
    const updated = await listLessonPacks();
    setPacks(updated);
    return updated;
  }, []);

  const handleCreateNew = useCallback(() => {
    const fresh = createEmptyLessonPack();
    setActivePack(fresh);
    setLessonStudioMode('editor');
    setActiveApp('lesson-studio');
    setActiveView('lesson-studio');
    setOpenedApps((prev) => (prev.includes('lesson-studio') ? prev : [...prev, 'lesson-studio']));
    setTabs((prevTabs) => {
      const res = upsertLessonPackTab(prevTabs, fresh);
      setActiveTabId(res.activeTabId);
      return res.tabs;
    });
  }, []);

  const handleEditPack = useCallback((pack: LessonPack) => {
    const cloned = structuredClone(pack);
    setActivePack(cloned);
    setLessonStudioMode('editor');
    setActiveApp('lesson-studio');
    setActiveView('lesson-studio');
    setOpenedApps((prev) => (prev.includes('lesson-studio') ? prev : [...prev, 'lesson-studio']));
    setTabs((prevTabs) => {
      const res = upsertLessonPackTab(prevTabs, cloned);
      setActiveTabId(res.activeTabId);
      return res.tabs;
    });
  }, []);

  const handleOpenPackInPrint = useCallback(
    (pack: LessonPack) => {
      setPrintPackId(pack.id);
      openApp('print-studio');
    },
    [openApp]
  );

  const upsertSessionPack = useCallback((item: LessonPack) => {
    setPacks((prev) => {
      const exists = prev.some((p) => p.id === item.id);
      const next = exists
        ? prev.map((p) => (p.id === item.id ? item : p))
        : [item, ...prev];
      return [...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  const handleSavePack = useCallback(
    async (packToSave: LessonPack, silent = false): Promise<LessonPack> => {
      if (temporaryMode) {
        const localSaved: LessonPack = {
          ...normalizeLegacyLessonPack(packToSave),
          updatedAt: new Date().toISOString(),
        };
        upsertSessionPack(localSaved);
        if (!silent) {
          showToast(
            'info',
            'Đã lưu tạm trong phiên hiện tại. Hãy tải bản sao lưu JSON để giữ bài lâu dài.'
          );
        }
        return localSaved;
      }

      try {
        const saved = await saveLessonPack(packToSave);
        await refreshPacks();
        setStorageBannerError(null);
        if (!silent) {
          showToast(
            'success',
            saved.status === 'completed'
              ? 'Đã lưu và đánh dấu hoàn thành bộ tiết dạy.'
              : 'Đã lưu bộ tiết dạy vào máy.'
          );
        }
        return saved;
      } catch (err) {
        const info = classifyStorageError(err);
        setStorageBannerError(info);
        upsertSessionPack({
          ...normalizeLegacyLessonPack(packToSave),
          updatedAt: new Date().toISOString(),
        });
        showToast('error', info.message);
        throw err;
      }
    },
    [refreshPacks, showToast, temporaryMode, upsertSessionPack]
  );

  const handleMarkPackCompleted = useCallback(
    async (packToComplete: LessonPack) => {
      try {
        await handleSavePack(
          {
            ...packToComplete,
            status: 'completed',
            lastStep: 5,
          },
          false
        );
      } catch {
        // Error banner & toast handled by handleSavePack
      }
    },
    [handleSavePack]
  );

  const handleDuplicatePack = async (pack: LessonPack) => {
    if (temporaryMode) {
      const now = new Date().toISOString();
      const cleanTitle = pack.title.replace(/^\[DEMO\]\s*/i, '');
      const copy: LessonPack = {
        ...structuredClone(normalizeLegacyLessonPack(pack)),
        id: createId('pack'),
        title: `${cleanTitle} (Bản sao)`,
        isDemo: false,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      };
      upsertSessionPack(copy);
      showToast('success', `Đã nhân bản "${copy.title}" trong phiên tạm thời.`);
      return;
    }

    try {
      const copy = await duplicateLessonPack(pack);
      await refreshPacks();
      setStorageBannerError(null);
      showToast('success', `Đã nhân bản "${copy.title}".`);
    } catch (err) {
      const info = classifyStorageError(err);
      setStorageBannerError(info);
      showToast('error', `Không thể nhân bản: ${info.message}`);
    }
  };

  const handleCreateLessonVariant = async (
    pack: LessonPack,
    mode: 'toggle-duration' | 'parallel-class'
  ) => {
    const variant = createLessonVariant(pack, mode, createId);
    const saved = await handleSavePack(variant, true);
    handleEditPack(saved);
    showToast('success', `Đã tạo "${saved.title}" và mở trong Lesson Studio.`);
  };

  const handleSaveResource = async (item: ResourceItem) => {
    if (temporaryMode) {
      setResources((prev) => [item, ...prev.filter((r) => r.id !== item.id)]);
      showToast('success', `Đã lưu học liệu "${item.title}" trong phiên tạm thời.`);
      return;
    }
    try {
      await saveResource(item);
      setResources(await listResources());
      showToast('success', `Đã lưu học liệu "${item.title}" vào Resource Vault.`);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleDeleteCanvasBoard = async (boardId: string) => {
    setCanvasBoards((prev) => prev.filter((b) => b.id !== boardId));
    setCanvasNodes((prev) => prev.filter((n) => n.boardId !== boardId));
    setCanvasEdges((prev) => prev.filter((e) => e.boardId !== boardId));
    setCanvasViewSettings((prev) => prev.filter((v) => v.boardId !== boardId));
    if (temporaryMode) return;
    try {
      await deleteCanvasBoard(boardId);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleBulkSaveResources = async (
    items: ResourceItem[],
    fileRecords: StoredResourceFileRecord[]
  ) => {
    if (items.length === 0) return;
    if (temporaryMode) {
      const idSet = new Set(items.map((i) => i.id));
      setResources((prev) =>
        [...items, ...prev.filter((r) => !idSet.has(r.id))].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        )
      );
      showToast('success', `Đã nhập ${items.length} tài liệu vào phiên tạm thời.`);
      return;
    }
    try {
      await bulkSaveResourcesWithFiles(items, fileRecords);
      setResources(await listResources());
      showToast('success', `Đã nhập ${items.length} tài liệu vào Resource Vault.`);
    } catch (err) {
      const info = classifyStorageError(err);
      setStorageBannerError(info);
      showToast('error', info.message);
      throw err;
    }
  };

  const handleDeleteResource = async (id: string) => {
    if (temporaryMode) {
      setResources((prev) => prev.filter((r) => r.id !== id));
      showToast('success', 'Đã xóa học liệu khỏi phiên tạm thời.');
      return;
    }
    try {
      await deleteResource(id);
      setResources(await listResources());
      showToast('success', 'Đã xóa học liệu khỏi Resource Vault.');
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleInsertResourceIntoActivePack = async (item: ResourceItem) => {
    const { updatedPack, summary } = insertResourceIntoPack(activePack, item, createId);
    const saved = await handleSavePack(updatedPack, true);
    setActivePack(saved);
    showToast('success', summary);
  };

  const handleSaveWorkflow = async (run: WorkflowRun) => {
    if (temporaryMode) {
      setWorkflows((prev) => [run, ...prev.filter((w) => w.id !== run.id)]);
      return;
    }
    try {
      await saveWorkflow(run);
      setWorkflows(await listWorkflows());
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    if (temporaryMode) {
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      showToast('success', 'Đã xóa quy trình.');
      return;
    }
    try {
      await deleteWorkflow(id);
      setWorkflows(await listWorkflows());
      showToast('success', 'Đã xóa quy trình.');
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleSaveJournal = async (entry: JournalEntry) => {
    if (temporaryMode) {
      setJournals((prev) => [entry, ...prev.filter((j) => j.id !== entry.id)]);
      showToast('success', `Đã lưu nhật ký lớp ${entry.classLabel}.`);
      return;
    }
    try {
      await saveJournal(entry);
      setJournals(await listJournals());
      showToast('success', `Đã lưu nhật ký lớp ${entry.classLabel} vào Teaching Journal.`);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleDeleteJournal = async (id: string) => {
    if (temporaryMode) {
      setJournals((prev) => prev.filter((j) => j.id !== id));
      showToast('success', 'Đã xóa bản ghi nhật ký.');
      return;
    }
    try {
      await deleteJournal(id);
      setJournals(await listJournals());
      showToast('success', 'Đã xóa bản ghi nhật ký.');
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleApplyJournalAdjustment = async (entry: JournalEntry) => {
    const targetPack = packs.find((p) => p.id === entry.packId) ?? activePack;
    const updatedPack = applyJournalAdjustmentToPack(targetPack, entry);
    const saved = await handleSavePack(updatedPack, true);
    if (activePack.id === saved.id) {
      setActivePack(saved);
    }
    showToast(
      'success',
      `Đã gắn ghi chú cải tiến từ nhật ký lớp ${entry.classLabel} vào bài "${saved.title || 'bộ tiết dạy'}".`
    );
  };

  const mathSaveSeqRef = useRef<Record<string, number>>({});

  const handleSaveMathExam = async (
    exam: MathExamProject,
    silent = false
  ): Promise<MathExamProject> => {
    const optimisticExam: MathExamProject = {
      ...exam,
      updatedAt: new Date().toISOString(),
    };
    const nextSeq = (mathSaveSeqRef.current[exam.id] ?? 0) + 1;
    mathSaveSeqRef.current[exam.id] = nextSeq;

    setMathExams((prev) =>
      [optimisticExam, ...prev.filter((m) => m.id !== optimisticExam.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      )
    );

    // Sync Connected Workflow Context when an exam is saved or mixed
    updateWorkflowContext(
      {
        generatedExamId: optimisticExam.id,
        generatedExamTitle: optimisticExam.title,
        examVersionIds: optimisticExam.generatedVersions.map(
          (v) => `${optimisticExam.id}:${v.code}`
        ),
        examVersionCodes: optimisticExam.generatedVersions.map((v) => v.code),
      },
      optimisticExam.generatedVersions.length > 0
        ? {
            stage: 'mix',
            appId: 'math-mixer',
            summary: `Đã tạo ${optimisticExam.generatedVersions.length} mã đề cho "${optimisticExam.title}"`,
          }
        : undefined
    );

    if (temporaryMode) {
      return optimisticExam;
    }
    try {
      const saved = await saveMathExam(optimisticExam);
      if (mathSaveSeqRef.current[exam.id] === nextSeq) {
        const latestList = await listMathExams();
        if (mathSaveSeqRef.current[exam.id] === nextSeq) {
          setMathExams(latestList);
        }
      }
      setStorageBannerError(null);
      if (!silent) {
        showToast('success', `Đã lưu đề Toán "${saved.title}".`);
      }
      return saved;
    } catch (err) {
      const info = classifyStorageError(err);
      setStorageBannerError(info);
      showToast('error', info.message);
      throw err;
    }
  };

  const handleDeleteMathExam = async (id: string) => {
    if (temporaryMode) {
      setMathExams((prev) => prev.filter((m) => m.id !== id));
      showToast('success', 'Đã xóa đề Toán khỏi phiên tạm thời.');
      return;
    }
    try {
      await deleteMathExam(id);
      setMathExams(await listMathExams());
      showToast('success', 'Đã xóa đề Toán.');
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleDuplicateMathExam = async (exam: MathExamProject) => {
    if (temporaryMode) {
      const now = new Date().toISOString();
      const copy: MathExamProject = {
        ...structuredClone(exam),
        id: createId('mexam'),
        title: `${exam.title.replace(/^\[DEMO\]\s*/i, '')} (Bản sao)`,
        isDemo: false,
        status: 'draft',
        generatedVersions: [],
        createdAt: now,
        updatedAt: now,
      };
      setMathExams((prev) => [copy, ...prev]);
      showToast('success', `Đã nhân bản "${copy.title}".`);
      return;
    }
    try {
      const copy = await duplicateMathExam(exam);
      setMathExams(await listMathExams());
      showToast('success', `Đã nhân bản "${copy.title}".`);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  // --- Visual Workspace Canvas Handlers ---
  const handleSaveCanvasBoard = async (board: CanvasBoard) => {
    if (temporaryMode) {
      const updated = { ...board, updatedAt: new Date().toISOString() };
      setCanvasBoards((prev) => [updated, ...prev.filter((b) => b.id !== updated.id)]);
      return;
    }
    try {
      const saved = await saveCanvasBoard(board);
      setCanvasBoards((prev) => [saved, ...prev.filter((b) => b.id !== saved.id)]);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleSaveCanvasNode = async (node: CanvasNodeRecord) => {
    const optimistic = { ...node, updatedAt: new Date().toISOString() };
    setCanvasNodes((prev) => [...prev.filter((n) => n.id !== optimistic.id), optimistic]);
    if (temporaryMode) return;
    try {
      await saveCanvasNode(optimistic);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleBulkSaveCanvasNodes = async (updatedNodes: CanvasNodeRecord[]) => {
    if (updatedNodes.length === 0) return;
    const now = new Date().toISOString();
    const map = new Map(updatedNodes.map((n) => [n.id, { ...n, updatedAt: now }]));
    setCanvasNodes((prev) => prev.map((n) => map.get(n.id) ?? n));
    if (temporaryMode) return;
    try {
      await bulkSaveCanvasNodes(updatedNodes);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleDeleteCanvasNode = async (nodeId: string) => {
    setCanvasNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setCanvasEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (temporaryMode) return;
    try {
      await deleteCanvasNode(nodeId);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleSaveCanvasEdge = async (edge: CanvasEdgeRecord) => {
    setCanvasEdges((prev) => [...prev.filter((e) => e.id !== edge.id), edge]);
    if (temporaryMode) return;
    try {
      await saveCanvasEdge(edge);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleDeleteCanvasEdge = async (edgeId: string) => {
    setCanvasEdges((prev) => prev.filter((e) => e.id !== edgeId));
    if (temporaryMode) return;
    try {
      await deleteCanvasEdge(edgeId);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleSaveCanvasViewSettings = async (view: CanvasViewSettings) => {
    setCanvasViewSettings((prev) => [
      ...prev.filter((v) => v.boardId !== view.boardId),
      view,
    ]);
    if (temporaryMode) return;
    try {
      await saveCanvasViewSettings(view);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleBulkSaveCanvasBundle = async (
    nodesToSave: CanvasNodeRecord[],
    edgesToSave: CanvasEdgeRecord[],
    removedEdgeIds: string[] = []
  ) => {
    const now = new Date().toISOString();
    if (nodesToSave.length > 0) {
      const nodeMap = new Map(
        nodesToSave.map((n) => [n.id, { ...n, updatedAt: now }])
      );
      setCanvasNodes((prev) => {
        const merged = prev.map((n) => nodeMap.get(n.id) ?? n);
        const existingIds = new Set(prev.map((n) => n.id));
        const inserted = nodesToSave
          .filter((n) => !existingIds.has(n.id))
          .map((n) => ({ ...n, updatedAt: now }));
        return [...merged, ...inserted];
      });
    }
    if (edgesToSave.length > 0 || removedEdgeIds.length > 0) {
      const removedSet = new Set(removedEdgeIds);
      const edgeMap = new Map(edgesToSave.map((e) => [e.id, e]));
      setCanvasEdges((prev) => {
        const filtered =
          removedSet.size > 0 ? prev.filter((e) => !removedSet.has(e.id)) : prev;
        const merged = filtered.map((e) => edgeMap.get(e.id) ?? e);
        const existingIds = new Set(filtered.map((e) => e.id));
        const inserted = edgesToSave.filter((e) => !existingIds.has(e.id));
        return [...merged, ...inserted];
      });
    }
    if (temporaryMode) return;
    try {
      await bulkSaveCanvasBundle(nodesToSave, edgesToSave, removedEdgeIds);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleBulkDeleteCanvasNodes = async (nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    const idSet = new Set(nodeIds);
    setCanvasNodes((prev) => prev.filter((n) => !idSet.has(n.id)));
    setCanvasEdges((prev) =>
      prev.filter((e) => !idSet.has(e.source) && !idSet.has(e.target))
    );
    if (temporaryMode) return;
    try {
      await bulkDeleteCanvasNodes(nodeIds);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleReplaceBoardCanvasState = async (
    boardId: string,
    nextNodes: CanvasNodeRecord[],
    nextEdges: CanvasEdgeRecord[]
  ) => {
    const now = new Date().toISOString();
    const stampedNodes = nextNodes.map((n) => ({ ...n, boardId, updatedAt: now }));
    const stampedEdges = nextEdges.map((e) => ({ ...e, boardId }));
    setCanvasNodes((prev) => [
      ...prev.filter((n) => n.boardId !== boardId),
      ...stampedNodes,
    ]);
    setCanvasEdges((prev) => [
      ...prev.filter((e) => e.boardId !== boardId),
      ...stampedEdges,
    ]);
    if (temporaryMode) return;
    try {
      await replaceBoardCanvasState(boardId, stampedNodes, stampedEdges);
    } catch (err) {
      showToast('error', classifyStorageError(err).message);
    }
  };

  const handleOpenCanvasEntity = useCallback(
    (ref: CanvasEntityRef) => {
      if (ref.kind === 'LessonPack') {
        const found = packs.find((p) => p.id === ref.entityId);
        if (found) {
          handleEditPack(found);
          return;
        }
        showToast('error', 'Không tìm thấy Bộ tiết dạy liên kết trong kho.');
        return;
      }
      if (ref.kind === 'ResourceItem') {
        openApp('resource-vault');
        return;
      }
      if (ref.kind === 'JournalEntry') {
        openApp('teaching-journal');
        return;
      }
      if (ref.kind === 'WorkflowRun') {
        openApp('workflow-center');
        return;
      }
      if (ref.kind === 'MathExamProject') {
        openApp('math-mixer');
      }
    },
    [handleEditPack, openApp, packs, showToast]
  );

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    if (temporaryMode) {
      const remaining = packs.filter((p) => p.id !== target.id);
      setPacks(remaining);
      if (activePack.id === target.id) {
        setActivePack(remaining[0] ?? createEmptyLessonPack());
      }
      if (printPackId === target.id) {
        setPrintPackId(remaining[0]?.id ?? '');
      }
      showToast('success', `Đã xóa "${target.title || 'bộ tiết dạy'}" khỏi phiên tạm thời.`);
      return;
    }

    try {
      await deleteLessonPack(target.id);
      const updated = await refreshPacks();
      setStorageBannerError(null);
      if (activePack.id === target.id) {
        setActivePack(updated[0] ?? createEmptyLessonPack());
      }
      if (printPackId === target.id) {
        setPrintPackId(updated[0]?.id ?? '');
      }
      showToast('success', `Đã xóa "${target.title || 'bộ tiết dạy'}".`);
    } catch (err) {
      const info = classifyStorageError(err);
      setStorageBannerError(info);
      showToast('error', `Không thể xóa bộ tiết dạy: ${info.message}`);
    }
  };

  const handleConfirmClearDemos = async () => {
    setConfirmClearDemos(false);

    if (temporaryMode) {
      const count = packs.filter((p) => p.isDemo).length;
      const remaining = packs.filter((p) => !p.isDemo);
      setPacks(remaining);
      if (packs.find((p) => p.id === activePack.id)?.isDemo) {
        setActivePack(remaining[0] ?? createEmptyLessonPack());
      }
      showToast('success', `Đã xóa ${count} bộ dữ liệu DEMO.`);
      return;
    }

    try {
      const count = await clearDemoPacks();
      const updated = await refreshPacks();
      setStorageBannerError(null);
      if (packs.find((p) => p.id === activePack.id)?.isDemo) {
        setActivePack(updated[0] ?? createEmptyLessonPack());
      }
      showToast('success', `Đã xóa ${count} bộ dữ liệu DEMO.`);
    } catch (err) {
      const info = classifyStorageError(err);
      setStorageBannerError(info);
      showToast('error', `Không thể xóa dữ liệu DEMO: ${info.message}`);
    }
  };

  const handleRestoreDemos = async () => {
    if (temporaryMode) {
      const map = new Map(packs.map((p) => [p.id, p]));
      for (const demo of DEMO_LESSON_PACKS) {
        map.set(demo.id, structuredClone(demo));
      }
      setPacks(Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      showToast('success', 'Đã nạp lại các bộ mẫu DEMO.');
      return;
    }

    try {
      await restoreDemoPacks();
      await refreshPacks();
      setStorageBannerError(null);
      showToast('success', 'Đã nạp lại các bộ mẫu DEMO.');
    } catch (err) {
      const info = classifyStorageError(err);
      setStorageBannerError(info);
      showToast('error', `Không thể nạp lại bộ mẫu DEMO: ${info.message}`);
    }
  };

  const handleSaveSettings = async (next: PrintSettings) => {
    if (temporaryMode) {
      const saved: PrintSettings = {
        ...next,
        id: 'default',
        paperSize: 'A4',
        updatedAt: new Date().toISOString(),
      };
      setSettings(saved);
      showToast('info', 'Đã áp dụng cài đặt in A4 trong phiên tạm thời.');
      return;
    }

    try {
      const saved = await savePrintSettings(next);
      setSettings(saved);
      setStorageBannerError(null);
      showToast('success', 'Đã lưu cài đặt in A4.');
    } catch (err) {
      const info = classifyStorageError(err);
      setStorageBannerError(info);
      setSettings(next);
      showToast('error', `Không thể lưu cài đặt vào IndexedDB: ${info.message}`);
    }
  };

  const handleRestoreBackup = async (payload: BackupPayload) => {
    if (temporaryMode) {
      const normalized = payload.lessonPacks.map(normalizeLegacyLessonPack);
      setPacks(normalized);
      setSettings(payload.settings);
      if (Array.isArray(payload.resources)) setResources(payload.resources);
      if (Array.isArray(payload.workflows)) setWorkflows(payload.workflows);
      if (Array.isArray(payload.journals)) setJournals(payload.journals);
      if (Array.isArray(payload.mathExams)) setMathExams(payload.mathExams);
      if (Array.isArray(payload.canvasBoards)) setCanvasBoards(payload.canvasBoards);
      if (Array.isArray(payload.canvasNodes)) setCanvasNodes(payload.canvasNodes);
      if (Array.isArray(payload.canvasEdges)) setCanvasEdges(payload.canvasEdges);
      if (Array.isArray(payload.canvasViewSettings)) {
        setCanvasViewSettings(payload.canvasViewSettings);
      }
      setActivePack(normalized[0] ?? createEmptyLessonPack());
      setPrintPackId(normalized[0]?.id ?? '');
      showToast(
        'success',
        `Đã khôi phục ${normalized.length} bộ tiết dạy vào phiên tạm thời.`
      );
      return;
    }

    try {
      await replaceAllFromBackup(payload.lessonPacks, payload.settings, {
        resources: payload.resources,
        workflows: payload.workflows,
        journals: payload.journals,
        mathExams: payload.mathExams,
        canvasBoards: payload.canvasBoards,
        canvasNodes: payload.canvasNodes,
        canvasEdges: payload.canvasEdges,
        canvasViewSettings: payload.canvasViewSettings,
      });
      const [
        updatedPacks,
        updatedRes,
        updatedWf,
        updatedJrn,
        updatedMath,
        updatedBoards,
        updatedNodes,
        updatedEdges,
        updatedViews,
      ] = await Promise.all([
        refreshPacks(),
        listResources(),
        listWorkflows(),
        listJournals(),
        listMathExams(),
        listCanvasBoards(),
        listCanvasNodes(),
        listCanvasEdges(),
        listCanvasViewSettings(),
      ]);
      setSettings(payload.settings);
      setResources(updatedRes);
      setWorkflows(updatedWf);
      setJournals(updatedJrn);
      setMathExams(updatedMath);
      setCanvasBoards(updatedBoards);
      setCanvasNodes(updatedNodes);
      setCanvasEdges(updatedEdges);
      setCanvasViewSettings(updatedViews);
      setStorageBannerError(null);
      setActivePack(updatedPacks[0] ?? createEmptyLessonPack());
      setPrintPackId(updatedPacks[0]?.id ?? '');
      showToast(
        'success',
        `Đã khôi phục thành công ${payload.lessonPacks.length} bộ tiết dạy từ bản sao lưu.`
      );
    } catch (err) {
      const info = classifyStorageError(err);
      setStorageBannerError(info);
      showToast('error', `Khôi phục dữ liệu thất bại: ${info.message}`);
    }
  };

  const handleCreateSnapshot = async () => {
    if (temporaryMode) {
      showToast('info', 'Đang chạy ở chế độ tạm thời. Hãy dùng chức năng Tải bản sao lưu JSON.');
      return;
    }
    try {
      const snap = await createManualSnapshot();
      setSnapshotSummary(snap);
      showToast('success', 'Đã tạo điểm khôi phục cục bộ (Snapshot) thành công.');
    } catch (err) {
      const info = classifyStorageError(err);
      showToast('error', `Không thể tạo điểm khôi phục: ${info.message}`);
    }
  };

  const handleRollbackSnapshot = async () => {
    if (temporaryMode) {
      showToast('info', 'Không thể Rollback khi đang ở chế độ tạm thời.');
      return;
    }
    try {
      const restored = await rollbackToSnapshot();
      const snap = await getSnapshotSummary();
      setPacks(restored.packs);
      setSettings(restored.settings);
      setResources(restored.resources);
      setWorkflows(restored.workflows);
      setJournals(restored.journals);
      setMathExams(restored.mathExams);
      setCanvasBoards(restored.canvasBoards);
      setCanvasNodes(restored.canvasNodes);
      setCanvasEdges(restored.canvasEdges);
      setCanvasViewSettings(restored.canvasViewSettings);
      setSnapshotSummary(snap);
      setActivePack(restored.packs[0] ?? createEmptyLessonPack());
      setPrintPackId(restored.packs[0]?.id ?? '');
      showToast(
        'success',
        `Đã khôi phục thành công ${restored.packs.length} bộ tiết dạy từ "${restored.label}".`
      );
    } catch (err) {
      const info = classifyStorageError(err);
      showToast('error', `Rollback thất bại: ${info.message}`);
    }
  };

  const handleExportSinglePack = (pack: LessonPack) => {
    exportSinglePackJson(pack, settings);
    showToast('success', `Đã xuất tệp JSON cho "${pack.title || 'bộ tiết dạy'}".`);
  };

  const handleRunPaletteAction = (actionId: PaletteActionId) => {
    if (actionId === 'create-lesson-pack') {
      handleCreateNew();
      return;
    }
    if (actionId === 'open-library') {
      setLessonStudioMode('library');
      openApp('lesson-studio');
      return;
    }
    if (actionId === 'toggle-theme') {
      toggleTheme();
      return;
    }
    if (actionId === 'export-json-backup') {
      exportJsonBackupFile(packs, settings, 'teacheros-4-backup', {
        resources,
        workflows,
        journals,
        mathExams,
        canvasBoards,
        canvasNodes,
        canvasEdges,
        canvasViewSettings,
      });
      showToast('success', 'Đã tải bản sao lưu JSON toàn hệ thống.');
    }
  };

  const handleCleanupShellOverlays = useCallback(() => {
    setLauncherOpen(false);
    setPaletteOpen(false);
  }, []);

  // Computed Connected Workflow 8-stage progress & real-data Dashboard next steps
  const workflowStages = useMemo(
    () =>
      evaluateConnectedWorkflowProgress(workflowContext, {
        resources,
        mathExams,
        gradingSessions,
      }),
    [workflowContext, resources, mathExams, gradingSessions]
  );

  const dashboardNextSteps = useMemo(
    () =>
      computeDashboardNextSteps(workflowContext, {
        resources,
        mathExams,
        gradingSessions,
      }),
    [workflowContext, resources, mathExams, gradingSessions]
  );

  const handleSyncWorkflowDraft = useCallback(
    (draft: GeneratedExamDraft) => {
      const confirmedCount = draft.items.filter(
        (it) => it.teacherConfirmed && it.question.answerConfirmed
      ).length;
      const blockedCount = draft.items.filter((it) => it.status === 'BLOCKED').length;
      updateWorkflowContext(
        {
          examDraftId: draft.id,
          examDraftTitle: draft.title,
          questionSelectionIds: draft.items.map((it) => it.id),
          examDraftQuestionCount: draft.items.length,
          examDraftConfirmedCount: confirmedCount,
          examDraftBlockedCount: blockedCount,
        },
        {
          stage: confirmedCount === draft.items.length && blockedCount === 0 ? 'review' : 'generate',
          appId: 'exam-generator',
          summary: `Đề nháp "${draft.title}" (${draft.items.length} câu, đã duyệt ${confirmedCount})`,
        }
      );
    },
    [updateWorkflowContext]
  );

  const handleSyncWorkflowExam = useCallback(
    (exam: MathExamProject) => {
      updateWorkflowContext({
        generatedExamId: exam.id,
        generatedExamTitle: exam.title,
        examVersionIds: exam.generatedVersions.map((v) => `${exam.id}:${v.code}`),
        examVersionCodes: exam.generatedVersions.map((v) => v.code),
      });
    },
    [updateWorkflowContext]
  );

  const handleSyncGradingSessions = useCallback(
    (sessionsList: GradingSession[]) => {
      setGradingSessions(sessionsList);
      const linked =
        (workflowContext.generatedExamId
          ? sessionsList.find((s) => s.examId === workflowContext.generatedExamId)
          : undefined) ?? sessionsList[0];
      if (!linked) return;
      const activeSheets = linked.sheets.filter((s) => !s.archivedByDuplicateResolution);
      const pendingReview = activeSheets.filter(
        (s) =>
          !s.confirmedByTeacher &&
          (s.status === 'review-required' || s.status === 'error' || s.uncertainCount > 0)
      ).length;
      const finalized =
        linked.gradebookEntries?.filter((g) => g.officialScore !== null).length ??
        (pendingReview === 0 ? activeSheets.length : 0);
      updateWorkflowContext({
        gradingSessionId: linked.id,
        gradingSessionTitle: linked.title,
        studentClassId: linked.className,
        gradedSheetCount: activeSheets.length,
        pendingGradingReviewCount: pendingReview,
        finalizedGradebookCount: finalized,
      });
    },
    [updateWorkflowContext, workflowContext.generatedExamId]
  );

  const handleOpenPrintStudioWithExam = useCallback(
    (examId: string, formLabel?: string) => {
      const target = mathExams.find((e) => e.id === examId);
      setPrintPreferredExamId(examId);
      setPrintPreferredFormLabel(formLabel ?? null);
      if (target) {
        updateWorkflowContext(
          {
            generatedExamId: target.id,
            generatedExamTitle: target.title,
            examVersionIds: target.generatedVersions.map((v) => `${target.id}:${v.code}`),
            examVersionCodes: target.generatedVersions.map((v) => v.code),
            examFormLabel: formLabel ?? workflowContext.examFormLabel,
          },
          {
            stage: 'print',
            appId: 'print-studio',
            summary: `Mở Print Studio cho "${target.title}"`,
          }
        );
      }
      openApp('print-studio');
    },
    [mathExams, openApp, updateWorkflowContext, workflowContext.examFormLabel]
  );

  const handleNavigateWorkflowStage = useCallback(
    (stage: WorkflowStageEvaluation) => {
      const activeExamId = workflowContext.generatedExamId ?? mathExams[0]?.id ?? null;
      if (stage.id === 'source') {
        openApp('resource-vault');
        return;
      }
      if (stage.id === 'select' || stage.id === 'generate') {
        setExamGeneratorPreferredTab('natural-language');
        openApp('exam-generator');
        return;
      }
      if (stage.id === 'review') {
        if (activeExamId) {
          setExamMixerPreferredExamId(activeExamId);
          setExamMixerPreferredStep(2);
          openApp('math-mixer');
        } else {
          setExamGeneratorPreferredTab('wizard');
          openApp('exam-generator');
        }
        return;
      }
      if (stage.id === 'mix') {
        if (activeExamId) {
          setExamMixerPreferredExamId(activeExamId);
          setExamMixerPreferredStep(3);
        }
        openApp('math-mixer');
        return;
      }
      if (stage.id === 'print') {
        if (activeExamId) {
          handleOpenPrintStudioWithExam(activeExamId);
        } else {
          openApp('print-studio');
        }
        return;
      }
      if (stage.id === 'grade' || stage.id === 'summary') {
        if (activeExamId) {
          setGradingPreferredExamId(activeExamId);
        }
        setGradingPreferredTab(stage.id === 'summary' ? 'gradebook' : 'sheet-gen');
        openApp('grading-studio');
      }
    },
    [handleOpenPrintStudioWithExam, mathExams, openApp, workflowContext.generatedExamId]
  );

  const handleExecuteNextStep = useCallback(
    (suggestion: DashboardNextStepSuggestion, useSecondary = false) => {
      const targetApp =
        useSecondary && suggestion.secondaryTargetApp
          ? suggestion.secondaryTargetApp
          : suggestion.targetApp;

      if (targetApp === 'print-studio' && suggestion.examId) {
        handleOpenPrintStudioWithExam(suggestion.examId);
        return;
      }
      if (targetApp === 'math-mixer' && suggestion.examId) {
        setExamMixerPreferredExamId(suggestion.examId);
        setExamMixerPreferredStep(2);
        openApp('math-mixer');
        return;
      }
      if (targetApp === 'grading-studio' && suggestion.examId) {
        setGradingPreferredExamId(suggestion.examId);
        setGradingPreferredTab(
          suggestion.id.startsWith('next-grade-') ? 'review' : 'sheet-gen'
        );
        openApp('grading-studio');
        return;
      }
      if (targetApp === 'exam-generator' && suggestion.resourceId) {
        const res = resources.find((r) => r.id === suggestion.resourceId);
        setExamGeneratorPreferredResourceId(suggestion.resourceId);
        setExamGeneratorPreferredTab('natural-language');
        if (res) {
          updateWorkflowContext(
            { resourceId: res.id, resourceTitle: res.title },
            { stage: 'source', appId: 'resource-vault', summary: `Chọn nguồn "${res.title}"` }
          );
        }
        openApp('exam-generator');
        return;
      }
      openApp(targetApp);
    },
    [handleOpenPrintStudioWithExam, openApp, resources, updateWorkflowContext]
  );

  const handleExecuteUniversalCommand = useCallback(
    (cmd: ParsedUniversalCommand) => {
      if (cmd.intent === 'nl-generate-exam') {
        if (cmd.payload.resourceId) {
          const res = resources.find((r) => r.id === cmd.payload.resourceId);
          setExamGeneratorPreferredResourceId(cmd.payload.resourceId);
          if (res) {
            updateWorkflowContext({ resourceId: res.id, resourceTitle: res.title });
          }
        }
        setExamGeneratorPreferredPrompt(cmd.payload.promptText ?? cmd.payload.rawCommand);
        setExamGeneratorPreferredTab('natural-language');
        openApp('exam-generator');
        showToast('info', 'Đã chuyển câu lệnh vào Natural Language Exam Builder để bạn xác nhận.');
        return;
      }
      if (cmd.intent === 'open-bank-topic') {
        setExamGeneratorPreferredTopic(cmd.payload.topicQuery ?? '');
        setExamGeneratorPreferredTab('bank');
        openApp('exam-generator');
        return;
      }
      if (cmd.intent === 'mix-current-exam') {
        if (cmd.payload.examId) {
          setExamMixerPreferredExamId(cmd.payload.examId);
        }
        setExamMixerPreferredStep(3);
        openApp('math-mixer');
        showToast(
          'info',
          `Đã mở Exam Mixer Pro${cmd.payload.versionCount ? ` (gợi ý ${cmd.payload.versionCount} mã đề)` : ''}.`
        );
        return;
      }
      if (
        cmd.intent === 'create-omr-sheet' ||
        cmd.intent === 'open-latest-grading' ||
        cmd.intent === 'open-azota-bridge'
      ) {
        if (cmd.payload.examId) {
          setGradingPreferredExamId(cmd.payload.examId);
        }
        if (cmd.payload.className) {
          setGradingPreferredClassName(cmd.payload.className);
          updateWorkflowContext({ studentClassId: cmd.payload.className });
        }
        setGradingPreferredTab(
          cmd.payload.gradingTab ??
            (cmd.intent === 'open-azota-bridge' ? 'azota' : 'sheet-gen')
        );
        openApp('grading-studio');
        return;
      }
      if (cmd.intent === 'print-exam-form') {
        const examId = cmd.payload.examId ?? workflowContext.generatedExamId ?? mathExams[0]?.id;
        if (examId) {
          handleOpenPrintStudioWithExam(examId, cmd.payload.formLabel);
        } else {
          openApp('print-studio');
        }
        return;
      }
      openApp(cmd.targetApp);
    },
    [
      handleOpenPrintStudioWithExam,
      mathExams,
      openApp,
      resources,
      showToast,
      updateWorkflowContext,
      workflowContext.generatedExamId,
    ]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-950">
        <SkeletonLoader label="Đang khởi động TeacherOS 4.1 và kiểm tra bản chụp an toàn..." />
      </div>
    );
  }

  if (loadErrorInfo) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div
          role="alert"
          className="max-w-lg w-full rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="space-y-1.5">
              <h1 className="text-base font-semibold text-red-900 dark:text-red-200">
                {loadErrorInfo.title}
              </h1>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {loadErrorInfo.message}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {loadErrorInfo.guidance}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => void loadDatabase()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-900 dark:bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 dark:hover:bg-blue-600"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Thử kết nối lại</span>
            </button>
            <button
              type="button"
              onClick={enterTemporaryMode}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <span>Tiếp tục chế độ tạm thời (chỉ lưu trong phiên)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeBannerInfo = temporaryMode
    ? {
        title: 'Đang chạy ở chế độ tạm thời (IndexedDB không khả dụng)',
        message:
          'Các thay đổi chỉ được giữ trong tab trình duyệt hiện tại và sẽ mất khi đóng hoặc tải lại trang.',
      }
    : storageBannerError
    ? {
        title: storageBannerError.title,
        message: `${storageBannerError.message} ${storageBannerError.guidance}`,
      }
    : null;

  const printSelectedPack =
    packs.find((p) => p.id === printPackId) ??
    (activePack.id === printPackId ? activePack : packs[0] ?? activePack);

  const printSelectedExam = printPreferredExamId
    ? mathExams.find((e) => e.id === printPreferredExamId)
    : undefined;

  const activeContextTitle =
    activeApp === 'lesson-studio'
      ? lessonStudioMode === 'library'
        ? 'Kho bài dạy'
        : activePack.title.trim() || 'Bộ tiết dạy mới'
      : activeApp === 'print-studio'
      ? printSelectedExam?.title.trim() || printSelectedPack?.title.trim() || 'Xem trước A4'
      : undefined;

  const draftCount = packs.filter((p) => p.status === 'draft').length;

  return (
    <TutorialProvider
      appReady={!loading && !loadErrorInfo}
      activeApp={activeApp}
      onNavigateApp={openApp}
      onCleanupShellOverlays={handleCleanupShellOverlays}
    >
      <TutorialShellBindings
        launcherOpen={launcherOpen}
        paletteOpen={paletteOpen}
      />
      <div className="min-h-screen aurora-app-canvas text-[#172033] dark:text-slate-100 flex flex-col pb-14 lg:pb-0">
        <TopBarWithTutorial
          activeView={activeView}
          activeContextTitle={activeContextTitle}
          theme={uiPrefs.theme}
          notifications={notifications}
          onToggleSidebar={toggleSidebar}
          onSelectDesktop={() => openApp('desktop')}
          onOpenToolsHub={openToolsHub}
          onOpenSettings={() => openApp('settings')}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onToggleTheme={toggleTheme}
          onMarkNotificationsRead={() =>
            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
          }
          onClearNotifications={() => setNotifications([])}
        />

      {activeBannerInfo && (
        <div
          role="alert"
          className="no-print border-b border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-4 py-3 sm:px-6"
        >
          <div className="mx-auto max-w-7xl flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{activeBannerInfo.title}</p>
                <p className="mt-0.5 text-amber-900 dark:text-amber-200">{activeBannerInfo.message}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  exportJsonBackupFile(packs, settings, 'teacheros-4-backup', {
                    resources,
                    workflows,
                    journals,
                    mathExams,
                    canvasBoards,
                    canvasNodes,
                    canvasEdges,
                    canvasViewSettings,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-amber-950 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tải sao lưu JSON ngay</span>
              </button>
              {temporaryMode && (
                <button
                  type="button"
                  onClick={() => void loadDatabase()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Thử IndexedDB lại</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace Canvas: Aurora Soft Glass Sidebar + Keep-Alive Application Viewport */}
      <div className="flex-1 flex min-w-0">
        <ShellSidebar
          activeView={activeView}
          collapsed={uiPrefs.sidebarCollapsed}
          lessonStudioHasDraftChanges={lessonStudioHasDraftChanges}
          onToggleCollapse={toggleSidebar}
          onSelectNav={handleSelectNav}
          onOpenApp={openApp}
        />

        <div className="flex-1 min-w-0">
          <ConnectedWorkflowBar
            activeApp={activeApp}
            context={workflowContext}
            stages={workflowStages}
            onNavigateStage={handleNavigateWorkflowStage}
            onResetWorkflow={() => {
              const fresh = createInitialWorkflowContext();
              setWorkflowContext(fresh);
              void saveConnectedWorkflowContext(fresh);
              showToast('info', 'Đã tạo phiên quy trình kiểm tra mới (dữ liệu đã lưu vẫn được giữ nguyên).');
            }}
          />

          <div className={activeView === 'desktop' ? 'block' : 'hidden print:hidden'}>
            <ErrorBoundary moduleName="Desktop Home" packs={packs} settings={settings}>
              <DesktopHome
                packs={packs}
                mathExams={mathExams}
                resources={resources}
                workflows={workflows}
                canvasBoards={canvasBoards}
                canvasNodes={canvasNodes}
                hasActiveUnsavedDraft={lessonStudioHasDraftChanges}
                nextStepSuggestions={dashboardNextSteps}
                onCreateNewPack={handleCreateNew}
                onOpenApp={openApp}
                onExecuteNextStep={handleExecuteNextStep}
                onOpenToolsHub={openToolsHub}
                onOpenLibrary={() => {
                  setLessonStudioMode('library');
                  openApp('lesson-studio');
                }}
                onOpenPackInStudio={handleEditPack}
                onOpenCommandPalette={() => setPaletteOpen(true)}
                onOpenPackContextMenu={(pack, x, y) => setContextMenu({ pack, x, y })}
              />
            </ErrorBoundary>
          </div>

          {activeView === 'tools' && (
            <div className="block print:hidden">
              <ErrorBoundary moduleName="Tools Hub" packs={packs} settings={settings}>
                <ToolsHubView
                  workflowCount={workflows.length}
                  mathExamCount={mathExams.length}
                  packCount={packs.length}
                  journalCount={journals.length}
                  onOpenApp={openApp}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('lesson-studio') && (
            <div className={activeView === 'lesson-studio' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="Lesson Studio" packs={packs} settings={settings}>
                <LessonStudioApp
                  mode={lessonStudioMode}
                  onModeChange={setLessonStudioMode}
                  activePack={activePack}
                  packs={packs}
                  settings={settings}
                  temporaryMode={temporaryMode}
                  onSavePack={handleSavePack}
                  onCreateNew={handleCreateNew}
                  onEditPack={handleEditPack}
                  onDuplicatePack={handleDuplicatePack}
                  onDeletePack={(p) => setDeleteTarget(p)}
                  onClearAllDemos={() => setConfirmClearDemos(true)}
                  onRestoreDemos={handleRestoreDemos}
                  onOpenSettings={() => openApp('settings')}
                  onDirtyChange={setLessonStudioHasDraftChanges}
                  onAutosaveStateChange={setAutosaveState}
                  onOpenPackContextMenu={(pack, x, y) => setContextMenu({ pack, x, y })}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('print-studio') && (
            <div className={activeView === 'print-studio' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="Print Studio 2.0" packs={packs} settings={settings}>
                <PrintStudioApp
                  packs={packs}
                  selectedPack={printSelectedPack}
                  settings={settings}
                  mathExams={mathExams}
                  examFormTemplates={examFormTemplates}
                  preferredExamId={printPreferredExamId}
                  preferredFormId={workflowContext.examFormId ?? null}
                  preferredFormLabel={printPreferredFormLabel ?? workflowContext.examFormLabel ?? null}
                  onSelectPackId={setPrintPackId}
                  onMarkCompleted={handleMarkPackCompleted}
                  onOpenSettings={() => openApp('settings')}
                  onOpenInLessonStudio={handleEditPack}
                  onQuickUpdateSettings={handleSaveSettings}
                  onSaveMathExam={handleSaveMathExam}
                  onSaveExamFormTemplates={(nextTemplates) => {
                    setExamFormTemplates(nextTemplates);
                    void saveExamFormTemplates(nextTemplates);
                  }}
                  onExamFormApplied={(examId, tpl) => {
                    const target = mathExams.find((e) => e.id === examId);
                    updateWorkflowContext(
                      {
                        generatedExamId: examId,
                        generatedExamTitle: target?.title ?? workflowContext.generatedExamTitle,
                        examFormId: tpl.id,
                        examFormLabel: tpl.name,
                      },
                      {
                        stage: 'print',
                        appId: 'print-studio',
                        summary: `Áp dụng mẫu "${tpl.name}" cho "${target?.title ?? examId}"`,
                      }
                    );
                  }}
                  onOpenExamMixer={(examId) => {
                    setExamMixerPreferredExamId(examId);
                    setExamMixerPreferredStep(5);
                    openApp('math-mixer');
                  }}
                  onOpenGradingStudio={(examId) => {
                    setGradingPreferredExamId(examId);
                    setGradingPreferredTab('sheet-gen');
                    openApp('grading-studio');
                  }}
                  onOpenAzotaBridge={(examId) => {
                    setGradingPreferredExamId(examId);
                    setGradingPreferredTab('azota');
                    openApp('grading-studio');
                  }}
                  onExamPrinted={(examId, formLabel, formId) => {
                    const target = mathExams.find((e) => e.id === examId);
                    updateWorkflowContext(
                      {
                        generatedExamId: examId,
                        generatedExamTitle: target?.title ?? workflowContext.generatedExamTitle,
                        examFormId: formId ?? workflowContext.examFormId,
                        examFormLabel: formLabel ?? workflowContext.examFormLabel,
                        printedAt: new Date().toISOString(),
                      },
                      {
                        stage: 'print',
                        appId: 'print-studio',
                        summary: `Đã xuất/in đề "${target?.title ?? examId}"`,
                      }
                    );
                  }}
                  onNotify={(type, msg) => showToast(type === 'warning' ? 'info' : type, msg)}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('workspace') && (
            <div className={activeView === 'workspace' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="My Workspace" packs={packs} settings={settings}>
                <MyWorkspaceApp
                  packs={packs}
                  activePack={activePack}
                  settings={settings}
                  resources={resources}
                  journals={journals}
                  workflows={workflows}
                  mathExams={mathExams}
                  theme={uiPrefs.theme}
                  canvasBoards={canvasBoards}
                  canvasNodes={canvasNodes}
                  canvasEdges={canvasEdges}
                  canvasViewSettings={canvasViewSettings}
                  onSaveCanvasBoard={handleSaveCanvasBoard}
                  onSaveCanvasNode={handleSaveCanvasNode}
                  onBulkSaveCanvasNodes={handleBulkSaveCanvasNodes}
                  onBulkSaveCanvasBundle={handleBulkSaveCanvasBundle}
                  onDeleteCanvasNode={handleDeleteCanvasNode}
                  onBulkDeleteCanvasNodes={handleBulkDeleteCanvasNodes}
                  onSaveCanvasEdge={handleSaveCanvasEdge}
                  onDeleteCanvasEdge={handleDeleteCanvasEdge}
                  onReplaceBoardCanvasState={handleReplaceBoardCanvasState}
                  onSaveCanvasViewSettings={handleSaveCanvasViewSettings}
                  onOpenCanvasEntity={handleOpenCanvasEntity}
                  onOpenInStudio={handleEditPack}
                  onOpenInPrint={handleOpenPackInPrint}
                  onCreateVariant={handleCreateLessonVariant}
                  onOpenResourceVault={() => openApp('resource-vault')}
                  onOpenTeachingJournal={() => openApp('teaching-journal')}
                  onShowToast={showToast}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('resource-vault') && (
            <div className={activeView === 'resource-vault' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="Resource Vault" packs={packs} settings={settings}>
                <ResourceVaultApp
                  resources={resources}
                  activePack={activePack}
                  temporaryMode={temporaryMode}
                  onSaveResource={handleSaveResource}
                  onBulkSaveResources={handleBulkSaveResources}
                  onDeleteResource={handleDeleteResource}
                  onInsertIntoActivePack={handleInsertResourceIntoActivePack}
                  onOpenActivePackInStudio={() => openApp('lesson-studio')}
                  onOpenWorkflowCenter={() => openApp('workflow-center')}
                  onCreateExamFromResource={(resourceId) => {
                    const res = resources.find((r) => r.id === resourceId);
                    setExamGeneratorPreferredResourceId(resourceId);
                    setExamGeneratorPreferredTab('natural-language');
                    if (res) {
                      updateWorkflowContext(
                        {
                          resourceId: res.id,
                          resourceTitle: res.title,
                        },
                        {
                          stage: 'source',
                          appId: 'resource-vault',
                          summary: `Chọn tài liệu "${res.title}" từ Resource Vault`,
                        }
                      );
                    }
                    openApp('exam-generator');
                  }}
                  onShowToast={showToast}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('workflow-center') && (
            <div className={activeView === 'workflow-center' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="Workflow Center 2.0" packs={packs} settings={settings}>
                <WorkflowCenterApp
                  workflows={workflows}
                  packs={packs}
                  resources={resources}
                  journals={journals}
                  mathExams={mathExams}
                  theme={uiPrefs.theme}
                  canvasBoards={canvasBoards}
                  canvasNodes={canvasNodes}
                  canvasEdges={canvasEdges}
                  canvasViewSettings={canvasViewSettings}
                  onSaveCanvasBoard={handleSaveCanvasBoard}
                  onDeleteCanvasBoard={handleDeleteCanvasBoard}
                  onSaveCanvasNode={handleSaveCanvasNode}
                  onBulkSaveCanvasNodes={handleBulkSaveCanvasNodes}
                  onBulkSaveCanvasBundle={handleBulkSaveCanvasBundle}
                  onDeleteCanvasNode={handleDeleteCanvasNode}
                  onBulkDeleteCanvasNodes={handleBulkDeleteCanvasNodes}
                  onSaveCanvasEdge={handleSaveCanvasEdge}
                  onDeleteCanvasEdge={handleDeleteCanvasEdge}
                  onReplaceBoardCanvasState={handleReplaceBoardCanvasState}
                  onSaveCanvasViewSettings={handleSaveCanvasViewSettings}
                  onOpenCanvasEntity={handleOpenCanvasEntity}
                  onShowToast={showToast}
                  onSaveWorkflow={handleSaveWorkflow}
                  onDeleteWorkflow={handleDeleteWorkflow}
                  onNavigateApp={(appId, linkedPackId) => {
                    if (linkedPackId) {
                      const found = packs.find((p) => p.id === linkedPackId);
                      if (found) {
                        if (appId === 'lesson-studio') {
                          handleEditPack(found);
                          return;
                        }
                        if (appId === 'print-studio') {
                          handleOpenPackInPrint(found);
                          return;
                        }
                      }
                    }
                    openApp(appId);
                  }}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('teaching-journal') && (
            <div className={activeView === 'teaching-journal' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="Teaching Journal" packs={packs} settings={settings}>
                <TeachingJournalApp
                  journals={journals}
                  packs={packs}
                  activePack={activePack}
                  onSaveJournal={handleSaveJournal}
                  onDeleteJournal={handleDeleteJournal}
                  onApplyAdjustmentToPack={handleApplyJournalAdjustment}
                  onOpenPackInStudio={handleEditPack}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('exam-generator') && (
            <div className={activeView === 'exam-generator' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="Smart Exam Generator 2.0" packs={packs} settings={settings}>
                <SmartExamGeneratorApp
                  mathExams={mathExams}
                  resources={resources}
                  preferredResourceId={examGeneratorPreferredResourceId}
                  preferredTab={examGeneratorPreferredTab}
                  preferredPrompt={examGeneratorPreferredPrompt}
                  preferredTopicFilter={examGeneratorPreferredTopic}
                  onClearPreferredResource={() => {
                    setExamGeneratorPreferredResourceId(null);
                    setExamGeneratorPreferredPrompt(null);
                    setExamGeneratorPreferredTopic(null);
                  }}
                  onSyncWorkflowDraft={handleSyncWorkflowDraft}
                  onSaveMathExam={handleSaveMathExam}
                  onOpenExamMixerWithExam={(examId) => {
                    setExamMixerPreferredExamId(examId);
                    setExamMixerPreferredStep(2);
                    openApp('math-mixer');
                  }}
                  onOpenGradingStudioWithExam={(examId) => {
                    setGradingPreferredExamId(examId);
                    setGradingPreferredTab('sheet-gen');
                    openApp('grading-studio');
                  }}
                  onNotify={showToast}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('math-mixer') && (
            <div className={activeView === 'math-mixer' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="Math Exam Mixer Pro" packs={packs} settings={settings}>
                <MathExamMixerApp
                  mathExams={mathExams}
                  preferredExamId={examMixerPreferredExamId}
                  preferredStep={examMixerPreferredStep}
                  onSaveMathExam={handleSaveMathExam}
                  onDeleteMathExam={handleDeleteMathExam}
                  onDuplicateMathExam={handleDuplicateMathExam}
                  onShowToast={showToast}
                  onOpenPrintStudio={(examId) => handleOpenPrintStudioWithExam(examId)}
                  onOpenGradingStudio={(examId) => {
                    setGradingPreferredExamId(examId);
                    setGradingPreferredTab('sheet-gen');
                    openApp('grading-studio');
                  }}
                  onWorkflowExamSynced={handleSyncWorkflowExam}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('grading-studio') && (
            <div className={activeView === 'grading-studio' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="Smart Grading Studio" packs={packs} settings={settings}>
                <SmartGradingStudioApp
                  mathExams={mathExams}
                  preferredExamId={gradingPreferredExamId}
                  preferredClassName={gradingPreferredClassName}
                  preferredTab={gradingPreferredTab}
                  onOpenExamMixer={() => openApp('math-mixer')}
                  onSaveMathExam={handleSaveMathExam}
                  onSessionsChanged={handleSyncGradingSessions}
                  onNotify={showToast}
                />
              </ErrorBoundary>
            </div>
          )}

          {openedApps.includes('settings') && (
            <div className={activeView === 'settings' ? 'block' : 'hidden print:hidden'}>
              <ErrorBoundary moduleName="Settings Center" packs={packs} settings={settings}>
                <SettingsView
                  settings={settings}
                  packs={packs}
                  uiPrefs={uiPrefs}
                  snapshotSummary={snapshotSummary}
                  backupExtras={{
                    resources,
                    workflows,
                    journals,
                    mathExams,
                    canvasBoards,
                    canvasNodes,
                    canvasEdges,
                    canvasViewSettings,
                  }}
                  onUpdateUIPrefs={updateUIPrefs}
                  onSaveSettings={handleSaveSettings}
                  onRestoreBackup={handleRestoreBackup}
                  onCreateSnapshot={handleCreateSnapshot}
                  onRollbackSnapshot={handleRollbackSnapshot}
                />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </div>

      <CreditFooter />

      <MobileBottomNav activeView={activeView} onSelectNav={handleSelectNav} />

      {uiPrefs.showDock && (
        <AppDock
          activeApp={activeApp}
          openedApps={openedApps}
          lessonStudioHasDraftChanges={lessonStudioHasDraftChanges}
          onSwitchApp={openApp}
          onOpenLauncher={() => setLauncherOpen(true)}
        />
      )}

      <AppLauncher
        open={launcherOpen}
        activeApp={activeApp}
        onClose={() => setLauncherOpen(false)}
        onLaunchApp={openApp}
      />

      <CommandPalette
        open={paletteOpen}
        packs={packs}
        resources={resources}
        journals={journals}
        mathExams={mathExams}
        gradingSessions={gradingSessions}
        workflowContext={workflowContext}
        onClose={() => setPaletteOpen(false)}
        onSelectApp={openApp}
        onSelectPack={handleEditPack}
        onSelectExam={(examId) => {
          setExamMixerPreferredExamId(examId);
          setExamMixerPreferredStep(2);
          openApp('math-mixer');
        }}
        onRunAction={handleRunPaletteAction}
        onExecuteUniversalCommand={handleExecuteUniversalCommand}
      />

      <ContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpenInStudio={handleEditPack}
        onOpenInPrint={handleOpenPackInPrint}
        onDuplicate={(p) => void handleDuplicatePack(p)}
        onExportSingleJson={handleExportSinglePack}
        onDelete={(p) => setDeleteTarget(p)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Xác nhận xóa bộ tiết dạy"
        description={
          deleteTarget
            ? `Bạn có chắc chắn muốn xóa "${deleteTarget.title || 'bộ tiết dạy chưa đặt tên'}"? Hành động này không thể hoàn tác trừ khi bạn đã xuất bản sao lưu JSON.`
            : ''
        }
        confirmLabel="Xóa bộ tiết dạy"
        cancelLabel="Hủy"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={confirmClearDemos}
        title="Xóa toàn bộ dữ liệu DEMO"
        description="Hệ thống sẽ xóa tất cả các bộ tiết dạy mẫu đang gắn nhãn DEMO. Các bộ tiết dạy do bạn tự tạo hoặc nhân bản sẽ được giữ nguyên."
        confirmLabel="Xóa toàn bộ DEMO"
        cancelLabel="Hủy"
        variant="danger"
        onConfirm={handleConfirmClearDemos}
        onCancel={() => setConfirmClearDemos(false)}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <OfflineIndicator />
      <TutorialOverlay />
    </div>
    </TutorialProvider>
  );
}
