import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight, CircleHelp, Ellipsis, Moon, Search, Settings, Sun } from 'lucide-react';
import { getAppById, type AppId } from '../../core/appRegistry';
import type { ThemeMode } from '../../core/theme';
import type { InternalNotificationItem } from '../../core/workspaceTabs';
import { PWAInstallButton } from './PWAInstallButton';
import { useTutorial } from '../tutorial/TutorialProvider';

export type ShellViewId = AppId | 'tools';

interface ShellTopBarProps {
  activeView: ShellViewId;
  activeContextTitle?: string;
  theme: ThemeMode;
  notifications: InternalNotificationItem[];
  onSelectDesktop: () => void;
  onOpenToolsHub: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  onToggleTheme: () => void;
  onMarkNotificationsRead: () => void;
  onClearNotifications: () => void;
  onOpenTutorialLauncher?: () => void;
}

export function ShellTopBar(props: ShellTopBarProps) {
  const { emitTutorialEvent } = useTutorial();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const unread = props.notifications.filter((n) => !n.read).length;
  const title = props.activeView === 'desktop' ? 'Tổng quan' : props.activeView === 'tools' ? 'Thêm công cụ' : getAppById(props.activeView)?.name;
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent | FocusEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  const select = (action: () => void) => { setOpen(false); action(); };
  return (
    <header className="tos-topbar no-print">
      <div className="tos-topbar-left">
        <button type="button" className="tos-brand" onClick={props.onSelectDesktop} aria-label="Về tổng quan TeacherOS">
          <span className="tos-brand-mark" aria-hidden="true">T</span><span className="tos-brand-name">TeacherOS</span>
        </button>
        <div className="tos-breadcrumb">
          <ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{title}</span>
          {props.activeContextTitle && <><ChevronRight size={14} aria-hidden="true" /><span className="tos-breadcrumb-detail">{props.activeContextTitle}</span></>}
        </div>
      </div>
      <div className="tos-topbar-actions">
        <button type="button" onClick={props.onOpenCommandPalette} className="tos-search" data-tour-id="topbar-search-desktop"
          aria-label="Tìm kiếm và bảng lệnh (Ctrl+K)">
          <Search size={17} aria-hidden="true" /><span>Tìm kiếm</span><kbd>Ctrl K</kbd>
        </button>
        <div className="tos-utility" ref={menu}>
          <button ref={trigger} type="button" className="tos-icon-button" aria-label="Thêm công cụ và cài đặt"
            data-tour-id="topbar-app-launcher" aria-expanded={open} aria-controls="teacheros-utility"
            onClick={() => { if (!open) emitTutorialEvent('launcher-opened'); setOpen(!open); setShowNotifications(false); }}>
            <Ellipsis size={20} aria-hidden="true" />{unread > 0 && <span className="tos-unread" aria-label={unread + ' thông báo mới'} />}
          </button>
          {open && <div id="teacheros-utility" className="tos-utility-panel">
            <button type="button" onClick={() => select(props.onOpenToolsHub)}><Ellipsis size={17} aria-hidden="true" />Thêm công cụ</button>
            <button type="button" onClick={() => select(props.onOpenSettings)}><Settings size={17} aria-hidden="true" />Tài khoản và cài đặt</button>
            <button type="button" onClick={() => select(props.onToggleTheme)}>
              {props.theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
              {props.theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}
            </button>
            {props.onOpenTutorialLauncher && <button type="button" data-tour-id="topbar-help" onClick={() => select(props.onOpenTutorialLauncher!)}>
              <CircleHelp size={17} aria-hidden="true" /> Hướng dẫn sử dụng
            </button>}
            <button type="button" aria-expanded={showNotifications} onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications && unread) props.onMarkNotificationsRead(); }}>
              <Bell size={17} aria-hidden="true" /> Thông báo{unread > 0 ? ' (' + unread + ')' : ''}
            </button>
            {showNotifications && <div className="tos-notifications">
              {props.notifications.length === 0 ? <p>Chưa có thông báo.</p> : <>
                <ul>{props.notifications.slice(0, 12).map((n) => <li key={n.id}>{n.message}</li>)}</ul>
                <button type="button" onClick={props.onClearNotifications}>Xóa thông báo</button>
              </>}
            </div>}
            <div className="tos-install"><PWAInstallButton /></div>
          </div>}
        </div>
      </div>
    </header>
  );
}
