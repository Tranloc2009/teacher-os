import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-offline-indicator"
      className="no-print fixed bottom-20 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border border-amber-400/50 bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Đang ngoại tuyến — Dữ liệu &amp; chấm OMR cục bộ vẫn hoạt động</span>
    </div>
  );
}
