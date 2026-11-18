import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { LessonPack, PrintSettings } from '../types/lesson';
import { exportJsonBackupFile } from '../utils/storageResilience';

interface ErrorBoundaryProps {
  children: ReactNode;
  moduleName?: string;
  packs?: LessonPack[];
  settings?: PrintSettings;
  onResetModule?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Lỗi hiển thị không xác định trong module.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[TeacherOS 4.0 ErrorBoundary]', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
    this.props.onResetModule?.();
  };

  handleEmergencyExport = (): void => {
    if (this.props.packs && this.props.settings) {
      exportJsonBackupFile(
        this.props.packs,
        this.props.settings,
        'teacheros-4-khan-cap'
      );
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="mx-auto my-8 max-w-2xl rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="h-5 w-5 text-red-700 dark:text-red-400 mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
              {this.props.moduleName
                ? `Phát sinh lỗi hiển thị tại ${this.props.moduleName}`
                : 'Phát sinh lỗi hiển thị trong khu vực làm việc'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Dữ liệu bộ tiết dạy của bạn trong IndexedDB vẫn an toàn. Bạn có thể tải lại giao diện module này hoặc xuất ngay bản sao lưu JSON.
            </p>
            {this.state.errorMessage && (
              <p className="mt-1 font-mono-num text-xs text-red-700 dark:text-red-300">
                Chi tiết: {this.state.errorMessage}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-900 dark:bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800 dark:hover:bg-blue-600 whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Khôi phục giao diện module</span>
          </button>

          {this.props.packs && this.props.settings && (
            <button
              type="button"
              onClick={this.handleEmergencyExport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tải sao lưu JSON khẩn cấp</span>
            </button>
          )}
        </div>
      </div>
    );
  }
}
