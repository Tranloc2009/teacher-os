export type ThemeMode = 'light' | 'dark';
export type UIDensity = 'comfortable' | 'compact';
export type AccentColor = 'blue' | 'indigo' | 'teal';

export interface UIPreferences {
  theme: ThemeMode;
  density: UIDensity;
  accent: AccentColor;
  sidebarCollapsed: boolean;
  showDock: boolean;
}

const THEME_STORAGE_KEY = 'teacheros_3_theme';
const UI_PREFS_STORAGE_KEY = 'teacheros_4_ui_prefs';

export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  theme: 'light',
  density: 'comfortable',
  accent: 'blue',
  sidebarCollapsed: false,
  showDock: false,
};

export function readSavedTheme(): ThemeMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const savedPrefs = localStorage.getItem(UI_PREFS_STORAGE_KEY);
      if (savedPrefs) {
        const parsed = JSON.parse(savedPrefs) as Partial<UIPreferences>;
        if (parsed.theme === 'dark' || parsed.theme === 'light') {
          return parsed.theme;
        }
      }
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
    }
  } catch {
    // Ignore storage block errors
  }
  return 'light';
}

export function readUIPreferences(): UIPreferences {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<UIPreferences>;
        return {
          theme:
            parsed.theme === 'dark' || parsed.theme === 'light'
              ? parsed.theme
              : readSavedTheme(),
          density:
            parsed.density === 'compact' || parsed.density === 'comfortable'
              ? parsed.density
              : 'comfortable',
          accent:
            parsed.accent === 'indigo' ||
            parsed.accent === 'teal' ||
            parsed.accent === 'blue'
              ? parsed.accent
              : 'blue',
          sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
          showDock: parsed.showDock !== undefined ? Boolean(parsed.showDock) : true,
        };
      }
    }
  } catch {
    // Fallback to default
  }
  return {
    ...DEFAULT_UI_PREFERENCES,
    theme: readSavedTheme(),
  };
}

export function applyThemeToDocument(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore storage block errors
  }
}

export function applyUIPreferencesToDocument(prefs: UIPreferences): void {
  applyThemeToDocument(prefs.theme);
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.density = prefs.density;
  root.dataset.accent = prefs.accent;
  try {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage block errors
  }
}
