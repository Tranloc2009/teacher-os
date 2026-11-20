import type {
  OmrThresholdsConfig,
  RgbaImageBuffer,
} from '../../types/grading';
import { computeImageDHash } from './cameraFrameAssist';
import {
  runLocalOmrVisionPipeline,
  type OmrRecognitionResult,
} from './omrVisionEngine';
import type { OmrWorkerRequest, OmrWorkerResponse } from './omrVisionWorker';

export interface OmrWorkerPipelineOutput {
  recognition: OmrRecognitionResult;
  imageDHash: string;
  executedInWorker: boolean;
}

let sharedWorker: Worker | null = null;
let workerUnavailable = false;
let requestCounter = 0;

interface PendingJob {
  resolve: (val: OmrWorkerPipelineOutput) => void;
  reject: (err: Error) => void;
}

const pendingJobs = new Map<string, PendingJob>();

function getOrCreateWorker(): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') {
    return null;
  }
  if (sharedWorker) return sharedWorker;

  try {
    const worker = new Worker(
      new URL('./omrVisionWorker.ts', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = (event: MessageEvent<OmrWorkerResponse>) => {
      const msg = event.data;
      const pending = pendingJobs.get(msg.id);
      if (!pending) return;
      pendingJobs.delete(msg.id);
      if (msg.ok && msg.recognition && msg.imageDHash !== undefined) {
        pending.resolve({
          recognition: msg.recognition,
          imageDHash: msg.imageDHash,
          executedInWorker: true,
        });
      } else {
        pending.reject(
          new Error(msg.error || 'Web Worker OMR trả về kết quả không hợp lệ.')
        );
      }
    };
    worker.onerror = () => {
      // Nếu trình duyệt chặn module worker hoặc gặp sự cố tải script, thu hồi và chuyển fallback main-thread an toàn
      workerUnavailable = true;
      sharedWorker = null;
      for (const [jobId, job] of pendingJobs.entries()) {
        pendingJobs.delete(jobId);
        job.reject(new Error('WORKER_UNAVAILABLE'));
      }
    };
    sharedWorker = worker;
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

/**
 * Thực thi OMR Vision Engine + perceptual dHash trên Web Worker để không khóa camera preview và UI trên điện thoại.
 * Nếu thiết bị hoặc trình duyệt không hỗ trợ module Web Worker, tự động fallback về main thread với cùng thuật toán 100%.
 */
export async function runOmrVisionInWorkerOrFallback(
  rgba: RgbaImageBuffer,
  questionCount: number,
  thresholds: OmrThresholdsConfig
): Promise<OmrWorkerPipelineOutput> {
  const worker = getOrCreateWorker();
  if (worker) {
    try {
      const copy = new Uint8ClampedArray(rgba.data);
      const buffer = copy.buffer;
      const id = `omr-w-${++requestCounter}`;
      const result = await new Promise<OmrWorkerPipelineOutput>(
        (resolve, reject) => {
          pendingJobs.set(id, { resolve, reject });
          const req: OmrWorkerRequest = {
            id,
            width: rgba.width,
            height: rgba.height,
            buffer,
            questionCount,
            thresholds,
          };
          worker.postMessage(req, [buffer]);
        }
      );
      return result;
    } catch {
      // Fallback sang main thread bên dưới để không làm hỏng phiên chấm của giáo viên
    }
  }

  const imageDHash = computeImageDHash(rgba);
  const recognition = runLocalOmrVisionPipeline(rgba, questionCount, thresholds);
  return {
    recognition,
    imageDHash,
    executedInWorker: false,
  };
}
