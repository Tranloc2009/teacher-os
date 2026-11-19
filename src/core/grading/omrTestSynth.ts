import type {
  OmrBubbleChoice,
  RgbaImageBuffer,
  SheetOpticalIdPayloadV1,
} from '../../types/grading';
import { computeOmrSheetLayout } from './omrLayout';
import {
  OPTICAL_CODE_GRID_SIZE,
  encodeOpticalIdMatrix,
} from './omrOpticalCode';
import { computeHomography, applyHomography } from './omrVisionEngine';

export interface SyntheticOmrSheetOptions {
  width?: number;
  questionCount: number;
  /** Bản đồ câu -> các phương án được tô (1 phương án bình thường, 2 phương án cho bài tô trùng) */
  filledChoices?: Record<number, OmrBubbleChoice[]>;
  /** Bản đồ câu -> độ đậm mực (0..1, mặc định 0.92; dùng ~0.28 cho vết tô mờ) */
  fillIntensityByQuestion?: Record<number, number>;
  /** Payload mã định danh quang học (bỏ qua nếu không in mã) */
  opticalPayload?: SheetOpticalIdPayloadV1;
  /** Cố tình làm hỏng vùng mã định danh để kiểm thử fallback */
  corruptOpticalCode?: boolean;
  /** Xoay ảnh 0 / 90 / 180 / 270 độ */
  rotateDeg?: 0 | 90 | 180 | 270;
  /** Nghiêng & méo phối cảnh nhẹ (độ nghiêng theo độ, ví dụ 4.5) */
  tiltDegrees?: number;
  /** Làm mờ ảnh (bán kính box blur >= 1 để mô phỏng chụp mất nét) */
  blurRadius?: number;
}

function setPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  lum: number
) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
  const idx = (iy * width + ix) * 4;
  data[idx] = lum;
  data[idx + 1] = lum;
  data[idx + 2] = lum;
  data[idx + 3] = 255;
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  lum: number
) {
  const startX = Math.max(0, Math.floor(x0));
  const endX = Math.min(width - 1, Math.ceil(x0 + w));
  const startY = Math.max(0, Math.floor(y0));
  const endY = Math.min(height - 1, Math.ceil(y0 + h));
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      setPixel(data, width, height, x, y, lum);
    }
  }
}

function drawCircle(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number,
  strokeWidth: number,
  strokeLum: number,
  fillLum?: number
) {
  const rOut = r + strokeWidth / 2;
  const rIn = Math.max(0, r - strokeWidth / 2);
  const minX = Math.max(0, Math.floor(cx - rOut - 1));
  const maxX = Math.min(width - 1, Math.ceil(cx + rOut + 1));
  const minY = Math.max(0, Math.floor(cy - rOut - 1));
  const maxY = Math.min(height - 1, Math.ceil(cy + rOut + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= rOut && dist >= rIn) {
        setPixel(data, width, height, x, y, strokeLum);
      } else if (fillLum !== undefined && dist < rIn) {
        setPixel(data, width, height, x, y, fillLum);
      }
    }
  }
}

function applyBoxBlur(img: RgbaImageBuffer, radius: number): RgbaImageBuffer {
  const { width, height, data } = img;
  const tmp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  const windowSize = radius * 2 + 1;

  // Horizontal pass
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = Math.max(0, Math.min(width - 1, x + k));
        sum += data[(y * width + sx) * 4];
      }
      const v = Math.round(sum / windowSize);
      const idx = (y * width + x) * 4;
      tmp[idx] = v;
      tmp[idx + 1] = v;
      tmp[idx + 2] = v;
      tmp[idx + 3] = 255;
    }
  }
  // Vertical pass
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + k));
        sum += tmp[(sy * width + x) * 4];
      }
      const v = Math.round(sum / windowSize);
      const idx = (y * width + x) * 4;
      out[idx] = v;
      out[idx + 1] = v;
      out[idx + 2] = v;
      out[idx + 3] = 255;
    }
  }
  return { width, height, data: out };
}

function rotateRgbaBuffer(
  img: RgbaImageBuffer,
  deg: 0 | 90 | 180 | 270
): RgbaImageBuffer {
  if (deg === 0) return img;
  const { width, height, data } = img;
  if (deg === 180) {
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const src = (y * width + x) * 4;
        const dst = ((height - 1 - y) * width + (width - 1 - x)) * 4;
        out[dst] = data[src];
        out[dst + 1] = data[src + 1];
        out[dst + 2] = data[src + 2];
        out[dst + 3] = 255;
      }
    }
    return { width, height, data: out };
  }
  const newW = height;
  const newH = width;
  const out = new Uint8ClampedArray(newW * newH * 4);
  if (deg === 90) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const src = (y * width + x) * 4;
        const dst = (x * newW + (height - 1 - y)) * 4;
        out[dst] = data[src];
        out[dst + 1] = data[src + 1];
        out[dst + 2] = data[src + 2];
        out[dst + 3] = 255;
      }
    }
    return { width: newW, height: newH, data: out };
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = ((width - 1 - x) * newW + y) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { width: newW, height: newH, data: out };
}

function warpPerspectiveTilt(
  img: RgbaImageBuffer,
  tiltDegrees: number
): RgbaImageBuffer {
  const { width, height, data } = img;
  const rad = (tiltDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const scale = 0.91;

  // Biến đổi 4 góc trang với độ xoay + co nhẹ mép trên (giả lập chụp nghiêng phối cảnh)
  const transformCorner = (nx: number, ny: number, perspectiveInsetX: number) => {
    const dx = (nx - 0.5) * scale + perspectiveInsetX;
    const dy = (ny - 0.5) * scale;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return { x: rx + 0.5, y: ry + 0.5 };
  };

  const dstCorners: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number }
  ] = [
    transformCorner(0, 0, 0.025),
    transformCorner(1, 0, -0.025),
    transformCorner(1, 1, 0),
    transformCorner(0, 1, 0),
  ];

  // Nghịch đảo: từ tọa độ ảnh đích -> ảnh nguồn
  const invH = computeHomography(dstCorners, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
  if (!invH) return img;

  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pt = applyHomography(invH, x / width, y / height);
      const sx = pt.x * width;
      const sy = pt.y * height;
      const dstIdx = (y * width + x) * 4;
      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) {
        // Nền mặt bàn sáng trung tính xung quanh tờ giấy
        out[dstIdx] = 228;
        out[dstIdx + 1] = 228;
        out[dstIdx + 2] = 228;
        out[dstIdx + 3] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const v00 = data[(y0 * width + x0) * 4];
      const v10 = data[(y0 * width + x0 + 1) * 4];
      const v01 = data[((y0 + 1) * width + x0) * 4];
      const v11 = data[((y0 + 1) * width + x0 + 1) * 4];
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      const lum = Math.round(top + (bot - top) * fy);
      out[dstIdx] = lum;
      out[dstIdx + 1] = lum;
      out[dstIdx + 2] = lum;
      out[dstIdx + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/**
 * Tạo ảnh pixel chuẩn A4 thực tế của phiếu OMR TeacherOS phục vụ kiểm thử tự động CV OMR
 * (không cần DOM/Canvas, chạy trực tiếp trong node:test và trình duyệt).
 */
export function synthesizeOmrSheetImage(
  options: SyntheticOmrSheetOptions
): RgbaImageBuffer {
  const layout = computeOmrSheetLayout(options.questionCount);
  const width = options.width ?? 840;
  const height = Math.round(width * layout.aspectRatioHeightOverWidth);
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  const { fiducials, opticalCodeBox } = layout;
  const mw = fiducials.markerSizeNormX * width;
  const mh = fiducials.markerSizeNormY * height;

  const drawFiducial = (cxNorm: number, cyNorm: number) => {
    const cx = cxNorm * width;
    const cy = cyNorm * height;
    fillRect(data, width, height, cx - mw / 2, cy - mh / 2, mw, mh, 18);
    fillRect(
      data,
      width,
      height,
      cx - mw * 0.28,
      cy - mh * 0.28,
      mw * 0.56,
      mh * 0.56,
      255
    );
    fillRect(
      data,
      width,
      height,
      cx - mw * 0.14,
      cy - mh * 0.14,
      mw * 0.28,
      mh * 0.28,
      18
    );
  };

  drawFiducial(fiducials.topLeft.x, fiducials.topLeft.y);
  drawFiducial(fiducials.topRight.x, fiducials.topRight.y);
  drawFiducial(fiducials.bottomRight.x, fiducials.bottomRight.y);
  drawFiducial(fiducials.bottomLeft.x, fiducials.bottomLeft.y);

  // Asymmetric top-left orientation dot
  drawCircle(
    data,
    width,
    height,
    fiducials.orientationDot.x * width,
    fiducials.orientationDot.y * height,
    mw * 0.36,
    1,
    18,
    18
  );

  // Optical 2D Code
  if (options.opticalPayload) {
    const matrix = encodeOpticalIdMatrix(options.opticalPayload);
    const bx = opticalCodeBox.x * width;
    const by = opticalCodeBox.y * height;
    const bw = opticalCodeBox.width * width;
    const bh = opticalCodeBox.height * height;
    const cellW = bw / OPTICAL_CODE_GRID_SIZE;
    const cellH = bh / OPTICAL_CODE_GRID_SIZE;

    for (let r = 0; r < OPTICAL_CODE_GRID_SIZE; r += 1) {
      for (let c = 0; c < OPTICAL_CODE_GRID_SIZE; c += 1) {
        let isDark = matrix[r][c];
        if (options.corruptOpticalCode && r >= 4 && r <= 12 && c >= 4 && c <= 12) {
          isDark = !isDark;
        }
        if (isDark) {
          fillRect(
            data,
            width,
            height,
            bx + c * cellW,
            by + r * cellH,
            cellW,
            cellH,
            18
          );
        }
      }
    }
  }

  // Bubbles
  for (const b of layout.bubbles) {
    const cx = b.cx * width;
    const cy = b.cy * height;
    const r = b.radiusNormX * width;
    const filledSet = options.filledChoices?.[b.questionNumber] ?? [];
    const isFilled = filledSet.includes(b.choice);
    const intensity = options.fillIntensityByQuestion?.[b.questionNumber] ?? 0.92;
    const fillLum = isFilled
      ? Math.round(255 * (1 - Math.max(0, Math.min(1, intensity))))
      : undefined;

    drawCircle(data, width, height, cx, cy, r, Math.max(1.5, width * 0.002), 30, fillLum);
  }

  let img: RgbaImageBuffer = { width, height, data };

  if (options.tiltDegrees && Math.abs(options.tiltDegrees) > 0.01) {
    img = warpPerspectiveTilt(img, options.tiltDegrees);
  }
  if (options.rotateDeg) {
    img = rotateRgbaBuffer(img, options.rotateDeg);
  }
  if (options.blurRadius && options.blurRadius >= 1) {
    // Chạy 2 lượt box blur để xấp xỉ Gaussian blur mượt
    img = applyBoxBlur(img, options.blurRadius);
    img = applyBoxBlur(img, options.blurRadius);
  }

  return img;
}
