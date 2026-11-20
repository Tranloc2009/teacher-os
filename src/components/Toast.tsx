import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  text: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null;

  const styles: Record<ToastTone, string> = {
    success:
      'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/95 text-emerald-900 dark:text-emerald-100',
    error:
      'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/95 text-red-900 dark:text-red-100',
    info:
      'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/95 text-blue-900 dark:text-blue-100',
  };

  const Icon =
    toast.tone === 'success'
      ? CheckCircle2
      : toast.tone === 'error'
      ? AlertCircle
      : Info;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-16 left-4 right-4 sm:left-auto sm:right-4 z-50 sm:max-w-md"
    >
      <div
        className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-md ${styles[toast.tone]}`}
      >
        <Icon className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug break-words [overflow-wrap:anywhere]">{toast.text}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Đóng thông báo"
          className="ml-2 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-blue-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
