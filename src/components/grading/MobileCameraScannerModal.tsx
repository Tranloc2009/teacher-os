import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  SwitchCamera,
  X,
  XCircle,
} from 'lucide-react';
import type { BatchQueueItem } from '../../types/grading';
import {
  AutoCaptureStabilityTracker,
  PaperFrameStabilityTracker,
  analyzeCameraFrameRgba,
  type CameraFrameAssistResult,
  type LiveQualityOverlayState,
} from '../../core/grading/cameraFrameAssist';
import { summarizeBatchQueue } from '../../core/grading/batchQueueEngine';

type CameraScannerState =
  | 'pre-permission'
  | 'requesting'
  | 'ready'
  | 'permission-denied'
  | 'unavailable'
  | 'insecure-context';

type CaptureFeedbackState = 'idle' | 'processing' | 'complete' | 'failed';

interface MobileCameraScannerModalProps {
  open: boolean;
  sessionTitle: string;
  classNameLabel: string;
  selectedExamCodes: string[];
  fallbackExamCode: string;
  onChangeFallbackExamCode: (code: string) => void;
  queue: BatchQueueItem[];
  retakeTargetLabel?: string | null;
  lowStorageWarning?: string;
  onCaptureFile: (file: File, source: 'camera' | 'upload') => void;
  onRetryQueueItem: (itemId: string) => void;
  onCancelWaitingQueue: () => void;
  onReviewLatestFlagged: () => void;
  onClose: () => void;
}

export function MobileCameraScannerModal({
  open,
  sessionTitle,
  classNameLabel,
  selectedExamCodes,
  fallbackExamCode,
  onChangeFallbackExamCode,
  queue,
  retakeTargetLabel,
  lowStorageWarning,
  onCaptureFile,
  onRetryQueueItem,
  onCancelWaitingQueue,
  onReviewLatestFlagged,
  onClose,
}: MobileCameraScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const autoTrackerRef = useRef<AutoCaptureStabilityTracker>(
    new AutoCaptureStabilityTracker()
  );
  const paperStabilityRef = useRef<PaperFrameStabilityTracker>(
    new PaperFrameStabilityTracker()
  );

  const [cameraState, setCameraState] = useState<CameraScannerState>('pre-permission');
  const [cameraErrorDetail, setCameraErrorDetail] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(false);
  const [frameAssist, setFrameAssist] = useState<CameraFrameAssistResult | null>(null);
  const [qualityOverlay, setQualityOverlay] = useState<LiveQualityOverlayState | null>(null);
  const [stableStreak, setStableStreak] = useState(0);
  const [captureFeedback, setCaptureFeedback] = useState<CaptureFeedbackState>('idle');
  const [shutterFlash, setShutterFlash] = useState(false);
  const [capturedInModalCount, setCapturedInModalCount] = useState(0);

  const queueSummary = useMemo(() => summarizeBatchQueue(queue), [queue]);

  const stopCameraStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore cleanup errors
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchSupported(false);
    setTorchEnabled(false);
  }, []);

  useEffect(() => {
    autoTrackerRef.current.setEnabled(autoCaptureEnabled);
  }, [autoCaptureEnabled]);

  // Reset cleanly when modal closes or unmounts
  useEffect(() => {
    if (!open) {
      stopCameraStream();
      setCameraState('pre-permission');
      setFrameAssist(null);
      setQualityOverlay(null);
      setStableStreak(0);
      setAutoCaptureEnabled(false);
      autoTrackerRef.current.reset();
      paperStabilityRef.current.reset();
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCameraStream();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      stopCameraStream();
    };
  }, [open, onClose, stopCameraStream]);

  const startCamera = useCallback(
    async (requestedFacing: 'environment' | 'user') => {
      stopCameraStream();
      paperStabilityRef.current.reset();
      setQualityOverlay(null);
      setCameraErrorDetail('');

      if (typeof window === 'undefined') {
        setCameraState('unavailable');
        return;
      }

      // Check secure context (HTTPS or localhost)
      if (!window.isSecureContext) {
        setCameraState('insecure-context');
        setCameraErrorDetail(
          'Trình duyệt yêu cầu kết nối HTTPS an toàn để mở camera trực tiếp. Bạn vẫn có thể dùng nút "Chụp bằng Camera máy / Chọn ảnh" bên dưới.'
        );
        return;
      }

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        setCameraState('unavailable');
        setCameraErrorDetail(
          'Trình duyệt này không hỗ trợ API camera trực tiếp (getUserMedia). Hãy chọn ảnh từ thư viện hoặc camera hệ thống.'
        );
        return;
      }

      setCameraState('requesting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: requestedFacing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        streamRef.current = stream;

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
          const caps = videoTrack.getCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
          };
          setTorchSupported(Boolean(caps?.torch));
        } else {
          setTorchSupported(false);
        }

        // Check if multiple cameras exist for front/rear switching
        if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter((d) => d.kind === 'videoinput');
            setHasMultipleCameras(videoInputs.length > 1);
          } catch {
            setHasMultipleCameras(false);
          }
        }

        setCameraState('ready');
        // Attach stream on next tick after video mounts
        window.requestAnimationFrame(() => {
          const video = videoRef.current;
          if (video && streamRef.current) {
            video.srcObject = streamRef.current;
            void video.play().catch(() => {
              // autoplay may require another tap on rare WebKit builds
            });
          }
        });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCameraState('permission-denied');
          setCameraErrorDetail(
            'Bạn đã từ chối quyền truy cập camera. Hãy cấp quyền Camera trong thanh địa chỉ trình duyệt rồi thử lại, hoặc dùng nút chụp/chọn ảnh từ máy.'
          );
        } else if (
          name === 'NotFoundError' ||
          name === 'DevicesNotFoundError' ||
          name === 'OverconstrainedError'
        ) {
          setCameraState('unavailable');
          setCameraErrorDetail(
            'Không tìm thấy camera khả dụng trên thiết bị này. Bạn có thể chọn ảnh phiếu từ thư viện hoặc dùng nút chụp ảnh hệ thống.'
          );
        } else {
          setCameraState('unavailable');
          setCameraErrorDetail(
            err instanceof Error
              ? err.message
              : 'Không thể khởi động camera. Vui lòng dùng chế độ chọn ảnh dự phòng.'
          );
        }
      }
    },
    [stopCameraStream]
  );

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchEnabled;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchEnabled(next);
    } catch {
      setTorchSupported(false);
      setTorchEnabled(false);
    }
  };

  const handleSwitchCamera = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    void startCamera(nextFacing);
  };

  const captureCurrentVideoFrame = useCallback(
    async (triggeredByAuto = false) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        setCaptureFeedback('failed');
        return;
      }

      setCaptureFeedback('processing');
      setShutterFlash(true);
      window.setTimeout(() => setShutterFlash(false), 180);

      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(30);
        }

        const capCanvas =
          captureCanvasRef.current ?? document.createElement('canvas');
        captureCanvasRef.current = capCanvas;
        capCanvas.width = video.videoWidth;
        capCanvas.height = video.videoHeight;
        const ctx = capCanvas.getContext('2d');
        if (!ctx) throw new Error('Không thể khởi tạo Canvas chụp ảnh.');
        ctx.drawImage(video, 0, 0, capCanvas.width, capCanvas.height);

        const blob = await new Promise<Blob>((resolve, reject) => {
          capCanvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Không xuất được khung hình JPEG.'))),
            'image/jpeg',
            0.92
          );
        });

        const stamp = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .slice(0, 19);
        const prefix = triggeredByAuto ? 'OMR_Auto' : 'OMR_Cam';
        const file = new File([blob], `${prefix}_${stamp}.jpg`, {
          type: 'image/jpeg',
        });

        if (!triggeredByAuto && frameAssist?.dHash) {
          autoTrackerRef.current.markManualCapture(frameAssist.dHash, Date.now());
        }

        onCaptureFile(file, 'camera');
        setCapturedInModalCount((c) => c + 1);
        setCaptureFeedback('complete');
        window.setTimeout(() => {
          setCaptureFeedback((curr) => (curr === 'complete' ? 'idle' : curr));
        }, 900);
      } catch {
        setCaptureFeedback('failed');
      }
    },
    [frameAssist?.dHash, onCaptureFile]
  );

  // Lightweight periodic live frame analyzer (~3.5 fps) when camera is active
  useEffect(() => {
    if (!open || cameraState !== 'ready') return;
    let cancelled = false;

    const timer = window.setInterval(() => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      const sampleW = 210;
      const sampleH = Math.max(
        140,
        Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * sampleW)
      );

      const canvas =
        analysisCanvasRef.current ?? document.createElement('canvas');
      analysisCanvasRef.current = canvas;
      if (canvas.width !== sampleW || canvas.height !== sampleH) {
        canvas.width = sampleW;
        canvas.height = sampleH;
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, sampleW, sampleH);
      const imageData = ctx.getImageData(0, 0, sampleW, sampleH);
      const result = analyzeCameraFrameRgba({
        width: sampleW,
        height: sampleH,
        data: imageData.data,
      });
      setFrameAssist(result);
      setQualityOverlay(paperStabilityRef.current.update(result));

      if (autoTrackerRef.current.isEnabled()) {
        const evalRes = autoTrackerRef.current.evaluate(result, Date.now());
        setStableStreak(autoTrackerRef.current.getStableProgress().streak);
        if (evalRes.shouldTriggerCapture) {
          void captureCurrentVideoFrame(true);
        }
      } else {
        setStableStreak(0);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, cameraState, captureCurrentVideoFrame]);

  if (!open) return null;

  const handleFallbackFiles = (fileList: FileList | null, source: 'camera' | 'upload') => {
    if (!fileList || fileList.length === 0) return;
    Array.from(fileList).forEach((f) => {
      onCaptureFile(f, source);
      setCapturedInModalCount((c) => c + 1);
    });
    setCaptureFeedback('complete');
    window.setTimeout(() => setCaptureFeedback('idle'), 1100);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Camera quét phiếu OMR toàn màn hình"
      data-testid="mobile-camera-scanner-modal"
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none"
    >
      {/* Hidden native fallbacks (System Camera capture + Gallery multi-select) */}
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFallbackFiles(e.target.files, 'camera');
          e.target.value = '';
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/bmp"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFallbackFiles(e.target.files, 'upload');
          e.target.value = '';
        }}
      />

      {/* Top HUD Bar */}
      <header className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 bg-slate-950/90 border-b border-slate-800/80 z-20">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold truncate">{sessionTitle}</span>
            <span className="shrink-0 rounded-md bg-indigo-500/20 border border-indigo-400/30 px-1.5 py-0.5 text-[11px] font-mono-num text-indigo-200">
              Lớp {classNameLabel}
            </span>
          </div>
          {retakeTargetLabel ? (
            <div className="text-[11px] text-amber-300 font-medium truncate">
              Đang chụp lại: {retakeTargetLabel}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 truncate">
              Xử lý 100% trên thiết bị · Không tải ảnh lên Internet
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            data-testid="camera-captured-counter"
            className="rounded-lg bg-slate-800 border border-slate-700 px-2.5 py-1.5 text-xs font-mono-num font-bold text-emerald-300"
          >
            {capturedInModalCount} phiếu
          </span>
          <button
            type="button"
            onClick={() => {
              stopCameraStream();
              onClose();
            }}
            aria-label="Đóng camera quét phiếu"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Low Storage Warning Strip */}
      {lowStorageWarning && (
        <div className="bg-amber-600/90 px-4 py-1.5 text-[11px] font-medium text-white flex items-center gap-2 z-20">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{lowStorageWarning}</span>
        </div>
      )}

      {/* Center Live Camera Viewport OR Pre-Permission / Fallback State */}
      <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
        {cameraState === 'ready' ? (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
            />

            {/* Shutter Flash Feedback */}
            {shutterFlash && (
              <div className="pointer-events-none absolute inset-0 bg-white/60 transition-opacity" />
            )}

            {/* A4 Alignment Guide Frame + 4 Corner Fiducial Brackets */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-5 sm:p-8">
              <div
                className={`relative w-full max-w-[360px] aspect-[210/297] max-h-[76%] rounded-xl border-2 transition-colors ${
                  frameAssist?.alignmentReady
                    ? 'border-emerald-400 shadow-[0_0_0_9999px_rgba(2,6,23,0.48)]'
                    : frameAssist?.severity === 'error'
                    ? 'border-red-400/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.58)]'
                    : 'border-white/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.55)]'
                }`}
              >
                {/* 4 Corner Guides matching A4 OMR fiducial markers */}
                <span className="absolute -top-1 -left-1 h-7 w-7 border-t-4 border-l-4 border-indigo-400 rounded-tl-md" />
                <span className="absolute -top-1 -right-1 h-7 w-7 border-t-4 border-r-4 border-indigo-400 rounded-tr-md" />
                <span className="absolute -bottom-1 -left-1 h-7 w-7 border-b-4 border-l-4 border-indigo-400 rounded-bl-md" />
                <span className="absolute -bottom-1 -right-1 h-7 w-7 border-b-4 border-r-4 border-indigo-400 rounded-br-md" />

                {/* Top Live Guidance Pill */}
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-[92vw] max-w-[356px] flex justify-center">
                  <div
                    className={`rounded-xl px-3 py-1.5 text-[11.5px] font-semibold backdrop-blur-md border truncate max-w-full ${
                      frameAssist?.alignmentReady
                        ? 'bg-emerald-950/85 border-emerald-400/60 text-emerald-200'
                        : frameAssist?.severity === 'error'
                        ? 'bg-red-950/85 border-red-400/60 text-red-200'
                        : 'bg-slate-950/85 border-slate-700 text-slate-100'
                    }`}
                  >
                    {qualityOverlay?.visible
                      ? 'Khung giấy ổn định · Cần cải thiện ánh sáng/độ nét'
                      : frameAssist?.guidanceMessage ??
                        'Căn 4 ô định vị màu đen của phiếu A4 vào 4 góc khung'}
                  </div>
                </div>

                {/* Live Center Overlay: 'Ảnh mờ/Thiếu sáng' when paper frame stabilizes with low canvas contrast/light */}
                {qualityOverlay?.visible && (
                  <div
                    role="status"
                    aria-live="polite"
                    data-testid="live-quality-warning-overlay"
                    data-issue-kind={qualityOverlay.issueKind}
                    className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 z-10 flex justify-center"
                  >
                    <div
                      className={`w-full max-w-[292px] rounded-2xl border px-3.5 py-3 text-center backdrop-blur-md shadow-xl space-y-2 ${
                        qualityOverlay.issueKind === 'blurry-and-low-light' ||
                        qualityOverlay.issueKind === 'low-light'
                          ? 'border-red-400/80 bg-slate-950/90 text-red-50'
                          : 'border-amber-400/80 bg-slate-950/90 text-amber-50'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <AlertTriangle
                          className={`h-4 w-4 shrink-0 ${
                            qualityOverlay.issueKind === 'blurry-and-low-light' ||
                            qualityOverlay.issueKind === 'low-light'
                              ? 'text-red-400'
                              : 'text-amber-400'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="text-sm font-bold tracking-tight">
                          {qualityOverlay.title}
                        </span>
                      </div>

                      <p className="text-[11.5px] leading-snug text-slate-200">
                        {qualityOverlay.detail}
                      </p>

                      <div className="grid grid-cols-3 gap-1 text-[10px] font-mono-num text-slate-300 border-t border-white/10 pt-1.5 whitespace-nowrap">
                        <span>T.phản {qualityOverlay.contrastScore}%</span>
                        <span>Sáng {qualityOverlay.brightnessScore}</span>
                        <span>Nét {qualityOverlay.sharpnessScore}</span>
                      </div>

                      {torchSupported &&
                        !torchEnabled &&
                        qualityOverlay.canSuggestTorch && (
                          <div className="pt-0.5">
                            <button
                              type="button"
                              onClick={() => void toggleTorch()}
                              className="pointer-events-auto inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 px-3 py-1.5 text-xs font-bold text-slate-950 transition-colors"
                            >
                              <Flashlight className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Bật đèn Flash ngay</span>
                            </button>
                          </div>
                        )}
                    </div>
                  </div>
                )}

                {/* Live Diagnostic Chips inside Bottom of Guide Frame */}
                {frameAssist && (
                  <div className="absolute bottom-2 inset-x-2 flex flex-wrap items-center justify-center gap-1.5 text-[10.5px] font-mono-num">
                    <span
                      className={`rounded-md px-1.5 py-0.5 ${
                        frameAssist.isLowLight
                          ? 'bg-red-600/90 text-white'
                          : 'bg-slate-950/75 text-slate-200'
                      }`}
                    >
                      Sáng: {frameAssist.brightnessScore}
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 ${
                        frameAssist.isLowContrast
                          ? 'bg-amber-600/90 text-white'
                          : 'bg-slate-950/75 text-slate-200'
                      }`}
                    >
                      Tương phản: {frameAssist.contrastScore}%
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 ${
                        frameAssist.isBlurry
                          ? 'bg-amber-600/90 text-white'
                          : 'bg-slate-950/75 text-slate-200'
                      }`}
                    >
                      Nét: {frameAssist.sharpnessScore}
                    </span>
                    <span className="rounded-md bg-slate-950/75 px-1.5 py-0.5 text-slate-200">
                      Góc: {frameAssist.cornersDetectedCount}/4
                    </span>
                    {autoCaptureEnabled && (
                      <span className="rounded-md bg-indigo-600/90 px-1.5 py-0.5 text-white">
                        Ổn định: {stableStreak}/4
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Capture Feedback Toast Overlay */}
            {captureFeedback !== 'idle' && (
              <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-20">
                <div
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold shadow-lg ${
                    captureFeedback === 'complete'
                      ? 'bg-emerald-600 text-white'
                      : captureFeedback === 'failed'
                      ? 'bg-red-600 text-white'
                      : 'bg-indigo-600 text-white'
                  }`}
                >
                  {captureFeedback === 'processing' && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  )}
                  {captureFeedback === 'complete' && (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {captureFeedback === 'failed' && (
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>
                    {captureFeedback === 'processing'
                      ? 'Đang lưu ảnh vào hàng đợi...'
                      : captureFeedback === 'complete'
                      ? 'Đã chụp! Đang chấm ngầm — mời chụp phiếu tiếp theo'
                      : 'Chụp thất bại, vui lòng thử lại'}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Pre-Permission / Requesting / Denied / Unavailable / Insecure-Context Card */
          <div className="max-w-md w-full mx-4 rounded-2xl border border-slate-800 bg-slate-900/95 p-6 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-300">
              {cameraState === 'requesting' ? (
                <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
              ) : cameraState === 'pre-permission' ? (
                <Camera className="h-7 w-7" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-7 w-7 text-amber-400" aria-hidden="true" />
              )}
            </div>

            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-white">
                {cameraState === 'pre-permission'
                  ? 'Quét phiếu trắc nghiệm bằng Camera'
                  : cameraState === 'requesting'
                  ? 'Đang xin quyền truy cập Camera...'
                  : cameraState === 'permission-denied'
                  ? 'Chưa được cấp quyền Camera'
                  : cameraState === 'insecure-context'
                  ? 'Cần HTTPS để bật Camera trực tiếp'
                  : 'Không tìm thấy Camera trực tiếp'}
              </h2>
              <p className="text-xs leading-relaxed text-slate-300">
                {cameraState === 'pre-permission'
                  ? 'Camera chỉ chạy cục bộ ngay trên điện thoại/máy tính của bạn để chụp và chấm OMR tức thì. Ưu tiên camera sau; ảnh bài làm không bao giờ gửi lên Internet.'
                  : cameraErrorDetail ||
                    'Vui lòng xác nhận cho phép truy cập Camera trong hộp thoại trình duyệt.'}
              </p>
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              {(cameraState === 'pre-permission' ||
                cameraState === 'permission-denied' ||
                cameraState === 'unavailable') && (
                <button
                  type="button"
                  onClick={() => void startCamera(facingMode)}
                  className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-3 text-sm font-bold text-white transition-colors"
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {cameraState === 'pre-permission'
                      ? 'Bật Camera quét liên tục'
                      : 'Thử bật lại Camera'}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-100 transition-colors"
              >
                <Camera className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                <span>Chụp bằng ứng dụng Camera điện thoại (Dự phòng)</span>
              </button>

              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition-colors"
              >
                <ImagePlus className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                <span>Chọn nhiều ảnh phiếu từ Thư viện ảnh</span>
              </button>
            </div>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-400 pt-1">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Local-First · Dùng chung OMR Engine chuẩn với bản máy tính</span>
            </div>
          </div>
        )}
      </div>

      {/* Live Batch Queue Strip (Non-blocking — shows waiting / processing / graded / review / failed) */}
      {queue.length > 0 && (
        <div
          data-testid="camera-batch-queue-strip"
          className="bg-slate-900/95 border-t border-slate-800 px-3 sm:px-5 py-2 space-y-2 z-20"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono-num">
              <span className="font-bold text-slate-200">
                Hàng đợi ({queueSummary.total})
              </span>
              {queueSummary.inFlight > 0 && (
                <span className="inline-flex items-center gap-1 text-indigo-300">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Đang xử lý: {queueSummary.inFlight}
                </span>
              )}
              <span className="text-emerald-400">
                Đã chấm: {queueSummary.graded}
              </span>
              {queueSummary.reviewRequired > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    stopCameraStream();
                    onReviewLatestFlagged();
                  }}
                  className="font-semibold text-amber-300 underline underline-offset-2"
                >
                  Cần duyệt: {queueSummary.reviewRequired}
                </button>
              )}
              {queueSummary.failed > 0 && (
                <span className="text-red-400">Lỗi: {queueSummary.failed}</span>
              )}
            </div>

            {queueSummary.waiting > 0 && (
              <button
                type="button"
                onClick={onCancelWaitingQueue}
                className="text-red-400 hover:text-red-300 font-semibold"
              >
                Hủy phiếu chờ
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            {queue
              .slice(-8)
              .reverse()
              .map((item) => (
                <div
                  key={item.id}
                  className={`shrink-0 flex items-center gap-2 rounded-lg border px-2 py-1 text-[11px] ${
                    item.status === 'graded'
                      ? 'border-emerald-800/80 bg-emerald-950/50 text-emerald-200'
                      : item.status === 'review-required'
                      ? 'border-amber-700/80 bg-amber-950/50 text-amber-200'
                      : item.status === 'failed'
                      ? 'border-red-700/80 bg-red-950/50 text-red-200'
                      : 'border-slate-700 bg-slate-800/80 text-slate-200'
                  }`}
                >
                  {item.thumbnailDataUrl ? (
                    <img
                      src={item.thumbnailDataUrl}
                      alt=""
                      className="h-7 w-5 rounded object-cover border border-white/15 shrink-0"
                    />
                  ) : (
                    <span className="flex h-7 w-5 items-center justify-center rounded bg-slate-700 text-[9px] shrink-0">
                      {item.status === 'processing' ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      ) : (
                        'A4'
                      )}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="font-mono-num font-semibold truncate max-w-[96px]">
                      {item.studentId || item.fileName.slice(0, 12)}
                    </div>
                    <div className="text-[10px] opacity-85 font-mono-num">
                      {item.status === 'waiting'
                        ? 'Đang chờ...'
                        : item.status === 'processing'
                        ? 'Đang chấm...'
                        : item.status === 'failed'
                        ? 'Lỗi đọc'
                        : `${item.finalScore ?? '—'}đ`}
                    </div>
                  </div>
                  {item.status === 'failed' && (
                    <button
                      type="button"
                      aria-label={`Thử chấm lại ${item.fileName}`}
                      onClick={() => onRetryQueueItem(item.id)}
                      className="rounded p-1 bg-red-800/70 hover:bg-red-700 text-white"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Bottom Thumb-Friendly Control Deck */}
      <footer className="bg-slate-950 border-t border-slate-800 px-3 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2.5 z-20">
        {/* Compact Secondary Controls Row: Fallback Exam Code + Auto Capture + Flash + Switch Camera */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <label htmlFor="camera-fallback-code" className="text-[11px] text-slate-400">
              Mã dự phòng:
            </label>
            <select
              id="camera-fallback-code"
              value={fallbackExamCode}
              onChange={(e) => onChangeFallbackExamCode(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono-num text-slate-100"
            >
              <option value="">Tự đọc QR</option>
              {selectedExamCodes.map((c) => (
                <option key={c} value={c}>
                  Mã {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Auto Capture Toggle (OFF by default) */}
            <button
              type="button"
              disabled={cameraState !== 'ready'}
              onClick={() => setAutoCaptureEnabled((v) => !v)}
              aria-pressed={autoCaptureEnabled}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                autoCaptureEnabled
                  ? 'border-indigo-400 bg-indigo-600 text-white'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tự chụp: {autoCaptureEnabled ? 'Bật' : 'Tắt'}</span>
            </button>

            {/* Torch/Flash button ONLY shown when device & browser report torch support */}
            {cameraState === 'ready' && torchSupported && (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                aria-label={torchEnabled ? 'Tắt đèn Flash' : 'Bật đèn Flash'}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                  torchEnabled
                    ? 'border-amber-400 bg-amber-500 text-slate-950'
                    : 'border-slate-700 bg-slate-900 text-slate-200'
                }`}
              >
                {torchEnabled ? (
                  <Flashlight className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <FlashlightOff className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>Flash</span>
              </button>
            )}

            {/* Front / Rear Camera Switcher ONLY shown when >=2 cameras detected */}
            {cameraState === 'ready' && hasMultipleCameras && (
              <button
                type="button"
                onClick={handleSwitchCamera}
                aria-label="Đổi camera trước hoặc sau"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200"
              >
                <SwitchCamera className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{facingMode === 'environment' ? 'Sau' : 'Trước'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Shutter Row */}
        <div className="flex items-center justify-between gap-3 max-w-md mx-auto">
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200"
          >
            <ImagePlus className="h-4 w-4 text-indigo-400" aria-hidden="true" />
            <span>Thư viện</span>
          </button>

          {/* Primary Large Thumb Shutter Button */}
          <button
            type="button"
            disabled={cameraState !== 'ready' || captureFeedback === 'processing'}
            onClick={() => void captureCurrentVideoFrame(false)}
            aria-label="Chụp phiếu bài làm"
            className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full border-4 border-white bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition-transform disabled:opacity-35 disabled:cursor-not-allowed shadow-lg"
          >
            <span className="h-12 w-12 rounded-full bg-white/95" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (queueSummary.reviewRequired > 0) {
                stopCameraStream();
                onReviewLatestFlagged();
              } else {
                stopCameraStream();
                onClose();
              }
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white"
          >
            <RefreshCw className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            <span>
              {queueSummary.reviewRequired > 0
                ? `Duyệt (${queueSummary.reviewRequired})`
                : 'Hoàn tất'}
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}
