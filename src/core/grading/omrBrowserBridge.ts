import type {
  GradedSheetRecord,
  RgbaImageBuffer,
} from '../../types/grading';
import { computeOmrSheetLayout } from './omrLayout';
import { applyHomography } from './omrVisionEngine';
import { getSheetStatusLabelVi } from './gradingExporter';

const MAX_PROCESSING_DIMENSION = 1600;
const THUMBNAIL_MAX_WIDTH = 160;

/**
 * Kiểm tra an toàn định dạng và kích thước file ảnh trước khi giải mã.
 */
export function validateUploadedImageFile(file: File): {
  valid: boolean;
  error?: string;
} {
  const allowedMime = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/bmp',
  ]);
  const extOk = /\.(jpe?g|png|webp|bmp)$/i.test(file.name);
  if (!allowedMime.has(file.type) && !extOk) {
    return {
      valid: false,
      error: `Tệp "${file.name}" không phải ảnh hỗ trợ (JPG, PNG, WEBP).`,
    };
  }
  const maxBytes = 25 * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `Tệp "${file.name}" vượt quá giới hạn 25MB (${(file.size / 1024 / 1024).toFixed(1)}MB).`,
    };
  }
  if (file.size === 0) {
    return { valid: false, error: `Tệp "${file.name}" rỗng (0 byte).` };
  }
  return { valid: true };
}

function loadImageElementFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không thể giải mã tệp ảnh này trong trình duyệt.'));
    };
    img.src = url;
  });
}

/**
 * Giải mã Blob/File ảnh sang RgbaImageBuffer đã giới hạn độ phân giải (≤1600px)
 * và tạo ảnh thumbnail nhỏ ~160px để không ngốn RAM khi xử lý 50–100 bài.
 */
export async function decodeImageBlobForOmr(blob: Blob): Promise<{
  rgba: RgbaImageBuffer;
  thumbnailDataUrl: string;
  originalWidth: number;
  originalHeight: number;
}> {
  const img = await loadImageElementFromBlob(blob);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  const scale = Math.min(
    1,
    MAX_PROCESSING_DIMENSION / Math.max(origW, origH, 1)
  );
  const procW = Math.max(1, Math.round(origW * scale));
  const procH = Math.max(1, Math.round(origH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = procW;
  canvas.height = procH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, procW, procH);
  ctx.drawImage(img, 0, 0, procW, procH);
  const imageData = ctx.getImageData(0, 0, procW, procH);

  // Tạo thumbnail nhỏ gọn
  const thumbScale = Math.min(1, THUMBNAIL_MAX_WIDTH / Math.max(procW, 1));
  const thumbW = Math.max(1, Math.round(procW * thumbScale));
  const thumbH = Math.max(1, Math.round(procH * thumbScale));
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbW;
  thumbCanvas.height = thumbH;
  const tCtx = thumbCanvas.getContext('2d');
  let thumbnailDataUrl = '';
  if (tCtx) {
    tCtx.drawImage(canvas, 0, 0, thumbW, thumbH);
    thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.72);
  }

  return {
    rgba: {
      width: procW,
      height: procH,
      data: imageData.data,
    },
    thumbnailDataUrl,
    originalWidth: origW,
    originalHeight: origH,
  };
}

/**
 * Vẽ ảnh minh chứng riêng biệt (annotated.png) từ ảnh gốc + kết quả chấm.
 * TUYỆT ĐỐI không ghi đè hay chỉnh sửa ảnh gốc (original.jpg).
 */
export async function renderAnnotatedEvidencePngBlob(
  originalBlob: Blob,
  sheet: GradedSheetRecord,
  questionCount: number
): Promise<Blob> {
  const img = await loadImageElementFromBlob(originalBlob);
  const rotDeg = sheet.alignment.detectedRotationDeg;

  const scale = Math.min(
    1,
    MAX_PROCESSING_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight, 1)
  );
  const baseW = Math.max(1, Math.round(img.naturalWidth * scale));
  const baseH = Math.max(1, Math.round(img.naturalHeight * scale));
  const isRotated90 = rotDeg === 90 || rotDeg === 270;
  const canvasW = isRotated90 ? baseH : baseW;
  const canvasH = isRotated90 ? baseW : baseH;
  const bannerHeight = 76;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH + bannerHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không thể khởi tạo Canvas vẽ minh chứng.');

  // Nền trắng & dải tiêu đề kết quả chấm ở trên cùng (không đè lên ô tô)
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, canvasW, bannerHeight);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px "Be Vietnam Pro", system-ui, sans-serif';
  const studentTitle = sheet.studentName
    ? `${sheet.studentId} · ${sheet.studentName}`
    : sheet.studentId || 'Chưa gắn Mã học sinh';
  ctx.fillText(studentTitle, 20, 32);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '14px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(
    `Mã đề: ${sheet.examCode || '—'}   |   Đúng: ${sheet.correctCount}  Sai: ${sheet.wrongCount}  Trống: ${sheet.blankCount}   |   ${getSheetStatusLabelVi(sheet.status)}`,
    20,
    58
  );

  // Điểm số nổi bật góc phải banner
  const scoreBadgeText = `${sheet.finalScore} / ${sheet.maxScore}`;
  ctx.fillStyle = sheet.status === 'error' ? '#EF4444' : '#10B981';
  ctx.font = 'bold 28px ui-monospace, SFMono-Regular, monospace';
  const tw = ctx.measureText(scoreBadgeText).width;
  ctx.fillText(scoreBadgeText, Math.max(20, canvasW - tw - 22), 48);

  // Vẽ ảnh gốc (xoay đúng chiều nếu OMR phát hiện xoay) bên dưới banner
  ctx.save();
  ctx.translate(0, bannerHeight);
  if (rotDeg === 90) {
    ctx.translate(canvasW, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotDeg === 180) {
    ctx.translate(canvasW, canvasH);
    ctx.rotate(Math.PI);
  } else if (rotDeg === 270) {
    ctx.translate(0, canvasH);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(img, 0, 0, baseW, baseH);
  ctx.restore();

  // Vẽ overlay trực quan từng câu nếu đã căn chỉnh Homography
  const H = sheet.alignment.inverseHomography;
  if (sheet.alignment.aligned && H && H.length === 9) {
    const layout = computeOmrSheetLayout(questionCount);
    const qMap = new Map(sheet.questions.map((q) => [q.questionNumber, q]));

    ctx.save();
    ctx.translate(0, bannerHeight);

    for (const q of sheet.questions) {
      if (!q.autoGradable) continue;
      const rowBubbles = layout.bubbles.filter(
        (b) => b.questionNumber === q.questionNumber
      );

      for (const b of rowBubbles) {
        const pt = applyHomography(H, b.cx, b.cy);
        const px = pt.x * canvasW;
        const py = pt.y * canvasH;
        const rPx = Math.max(8, b.radiusNormX * canvasW * 1.15);

        const isChosen = q.effectiveChoice === b.choice;
        const isCorrectKey = q.correctChoice === b.choice;

        if (q.needsReview) {
          if (
            q.optionMetrics.find((m) => m.choice === b.choice && m.fillRatio >= 0.22)
          ) {
            ctx.beginPath();
            ctx.arc(px, py, rPx + 2, 0, Math.PI * 2);
            ctx.strokeStyle = '#D97706';
            ctx.lineWidth = 3.5;
            ctx.stroke();
          }
          continue;
        }

        if (isChosen && q.isCorrect) {
          ctx.beginPath();
          ctx.arc(px, py, rPx + 2, 0, Math.PI * 2);
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 4;
          ctx.stroke();
        } else if (isChosen && !q.isCorrect) {
          ctx.beginPath();
          ctx.arc(px, py, rPx + 2, 0, Math.PI * 2);
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 4;
          ctx.stroke();
        } else if (!q.isCorrect && isCorrectKey) {
          // Hiển thị đáp án đúng bằng viền xanh đứt nét khi học sinh làm sai hoặc bỏ trống
          ctx.save();
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.arc(px, py, rPx + 2, 0, Math.PI * 2);
          ctx.strokeStyle = '#059669';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Nhãn kết quả nhỏ bên phải hàng 4 ô
      const lastBubble = rowBubbles[rowBubbles.length - 1];
      if (lastBubble) {
        const pt = applyHomography(
          H,
          lastBubble.cx + lastBubble.radiusNormX * 2.1,
          lastBubble.cy
        );
        const lx = pt.x * canvasW;
        const ly = pt.y * canvasH + 5;
        ctx.font = 'bold 13px ui-monospace, monospace';
        const qRes = qMap.get(q.questionNumber);
        if (qRes?.needsReview) {
          ctx.fillStyle = '#B45309';
          ctx.fillText('?', lx, ly);
        } else if (qRes?.isCorrect) {
          ctx.fillStyle = '#047857';
          ctx.fillText('✓', lx, ly);
        } else if (qRes?.isBlank) {
          ctx.fillStyle = '#64748B';
          ctx.fillText('–', lx, ly);
        } else {
          ctx.fillStyle = '#DC2626';
          ctx.fillText(`✕ ${qRes?.correctChoice ?? ''}`, lx, ly);
        }
      }
    }

    ctx.restore();
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Không thể xuất PNG ảnh minh chứng.'));
      },
      'image/png',
      0.92
    );
  });
}

/**
 * Kết xuất SVG phiếu trả lời chuẩn A4 sang Blob PNG độ phân giải cao để tải về hoặc in thử.
 */
export async function renderSvgStringToPngBlob(
  svgMarkup: string,
  width = 1240,
  height = 1754
): Promise<Blob> {
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const img = await loadImageElementFromBlob(svgBlob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không thể khởi tạo Canvas kết xuất PNG.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Không thể xuất tệp PNG phiếu trả lời.'));
      },
      'image/png',
      0.95
    );
  });
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
