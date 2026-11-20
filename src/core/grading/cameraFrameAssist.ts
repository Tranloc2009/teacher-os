import type { RgbaImageBuffer } from '../../types/grading';

export interface CameraFrameAssistResult {
  brightnessScore: number;
  isLowLight: boolean;
  contrastScore: number;
  isLowContrast: boolean;
  sharpnessScore: number;
  isBlurry: boolean;
  isClippedEdge: boolean;
  cornersDetectedCount: number;
  paperFrameDetected: boolean;
  tiltEstimateDeg: number;
  alignmentReady: boolean;
  dHash: string;
  guidanceMessage: string;
  severity: 'ready' | 'warn' | 'error';
}

export type LiveQualityIssueKind =
  | 'none'
  | 'low-light'
  | 'blurry'
  | 'blurry-and-low-light';

export interface LiveQualityOverlayState {
  visible: boolean;
  issueKind: LiveQualityIssueKind;
  title: string;
  detail: string;
  isPaperStable: boolean;
  stableFrameCount: number;
  requiredStableFrames: number;
  contrastScore: number;
  brightnessScore: number;
  sharpnessScore: number;
  canSuggestTorch: boolean;
}

export interface PaperStabilityConfig {
  requiredStableFrames: number;
  maxMotionDHashDistance: number;
  maxBrightnessDelta: number;
}

export const DEFAULT_PAPER_STABILITY_CONFIG: PaperStabilityConfig = {
  requiredStableFrames: 3,
  maxMotionDHashDistance: 5,
  maxBrightnessDelta: 18,
};

export interface AutoCaptureConfig {
  requiredStableFrames: number;
  cooldownMs: number;
  minDHashDistance: number;
}

export const DEFAULT_AUTO_CAPTURE_CONFIG: AutoCaptureConfig = {
  requiredStableFrames: 4,
  cooldownMs: 2600,
  minDHashDistance: 8,
};

function rgbToLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Tính vân tay perceptual 64-bit Difference Hash (dHash) cho ảnh RGBA.
 * Nhẹ (<1ms), bất biến nhẹ với độ sáng và nén JPEG — dùng để phát hiện chụp trùng phiếu.
 */
export function computeImageDHash(rgba: RgbaImageBuffer): string {
  const { width, height, data } = rgba;
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return '0000000000000000';
  }

  const gridW = 9;
  const gridH = 8;
  const cells = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy += 1) {
    const y0 = Math.floor((gy / gridH) * height);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) / gridH) * height));
    for (let gx = 0; gx < gridW; gx += 1) {
      const x0 = Math.floor((gx / gridW) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) / gridW) * width));
      let sum = 0;
      let count = 0;
      const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 4));
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const idx = (y * width + x) * 4;
          sum += rgbToLuma(data[idx], data[idx + 1], data[idx + 2]);
          count += 1;
        }
      }
      cells[gy * gridW + gx] = count > 0 ? sum / count : 0;
    }
  }

  let hex = '';
  for (let gy = 0; gy < gridH; gy += 1) {
    let byteVal = 0;
    for (let gx = 0; gx < 8; gx += 1) {
      const left = cells[gy * gridW + gx];
      const right = cells[gy * gridW + gx + 1];
      if (left > right) {
        byteVal |= 1 << (7 - gx);
      }
    }
    hex += byteVal.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Khoảng cách Hamming giữa hai chuỗi hex 64-bit dHash (0 = giống hệt, 64 = đối lập hoàn toàn).
 */
export function hammingDistanceHex64(hashA: string, hashB: string): number {
  if (!hashA || !hashB || hashA.length !== 16 || hashB.length !== 16) {
    return 64;
  }
  let dist = 0;
  for (let i = 0; i < 16; i += 2) {
    const a = parseInt(hashA.slice(i, i + 2), 16);
    const b = parseInt(hashB.slice(i, i + 2), 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return 64;
    let xor = a ^ b;
    while (xor > 0) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

/**
 * Phân tích nhanh khung hình camera trực tiếp để hỗ trợ giáo viên đặt phiếu A4 chuẩn:
 * - Thiếu sáng (brightnessScore < 72)
 * - Mờ / rung tay (Laplacian variance < 14)
 * - Giấy bị cắt sát mép khung hình
 * - Phát hiện 4 góc định vị & ước lượng độ nghiêng
 */
export function analyzeCameraFrameRgba(
  rgba: RgbaImageBuffer,
  guideRectNorm: { x: number; y: number; width: number; height: number } = {
    x: 0.08,
    y: 0.08,
    width: 0.84,
    height: 0.84,
  }
): CameraFrameAssistResult {
  const { width, height, data } = rgba;
  const dHash = computeImageDHash(rgba);

  if (width < 24 || height < 24 || data.length < width * height * 4) {
    return {
      brightnessScore: 0,
      isLowLight: true,
      contrastScore: 0,
      isLowContrast: true,
      sharpnessScore: 0,
      isBlurry: true,
      isClippedEdge: false,
      cornersDetectedCount: 0,
      paperFrameDetected: false,
      tiltEstimateDeg: 0,
      alignmentReady: false,
      dHash,
      guidanceMessage: 'Khung hình camera chưa sẵn sàng.',
      severity: 'error',
    };
  }

  // Convert to compact grayscale array for fast analysis
  const gray = new Uint8Array(width * height);
  let lumaSum = 0;
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    const g = Math.round(rgbToLuma(data[p], data[p + 1], data[p + 2]));
    gray[i] = g;
    lumaSum += g;
  }

  const gx0 = Math.max(2, Math.floor(guideRectNorm.x * width));
  const gy0 = Math.max(2, Math.floor(guideRectNorm.y * height));
  const gx1 = Math.min(width - 3, Math.floor((guideRectNorm.x + guideRectNorm.width) * width));
  const gy1 = Math.min(height - 3, Math.floor((guideRectNorm.y + guideRectNorm.height) * height));

  // Brightness & Canvas Contrast (RMS std-dev + p05..p95 dynamic range) inside guide region
  let guideLumaSum = 0;
  let guideLumaSqSum = 0;
  let guideCount = 0;
  const hist = new Uint32Array(256);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 120));
  for (let y = gy0; y < gy1; y += step) {
    const rowOff = y * width;
    for (let x = gx0; x < gx1; x += step) {
      const lum = gray[rowOff + x];
      guideLumaSum += lum;
      guideLumaSqSum += lum * lum;
      hist[lum] += 1;
      guideCount += 1;
    }
  }
  const guideMean =
    guideCount > 0 ? guideLumaSum / guideCount : lumaSum / Math.max(1, gray.length);
  const brightnessScore = Math.round(guideMean);
  const isLowLight = brightnessScore < 72;

  const guideVar =
    guideCount > 0 ? Math.max(0, guideLumaSqSum / guideCount - guideMean * guideMean) : 0;
  const rmsContrast = Math.sqrt(guideVar);

  // Robust 1st–95th percentile luma spread (p01 captures dark OMR ink/fiducials which occupy ~2–10% of an A4 page)
  let p01 = 0;
  let p95 = 0;
  if (guideCount > 0) {
    const lowTarget = Math.max(1, Math.floor(guideCount * 0.01));
    const highTarget = Math.max(1, Math.floor(guideCount * 0.95));
    let acc = 0;
    let foundLow = false;
    for (let b = 0; b < 256; b += 1) {
      acc += hist[b];
      if (!foundLow && acc >= lowTarget) {
        p01 = b;
        foundLow = true;
      }
      if (acc >= highTarget) {
        p95 = b;
        break;
      }
    }
  }
  const inkPaperSpread = Math.max(0, p95 - p01);
  // Normalize combined ink-to-paper spread (scale ~190) & RMS contrast (scale ~52) to 0..100
  const spreadNorm = Math.min(1, inkPaperSpread / 190);
  const rmsNorm = Math.min(1, rmsContrast / 52);
  const contrastScore = Math.round((spreadNorm * 0.65 + rmsNorm * 0.35) * 100);
  const isLowContrast = contrastScore < 30 || inkPaperSpread < 68;

  // Normalized Laplacian variance inside guide region for sharpness
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  const lapStep = Math.max(1, Math.floor(Math.min(width, height) / 90));
  for (let y = gy0 + 1; y < gy1 - 1; y += lapStep) {
    const rowOff = y * width;
    for (let x = gx0 + 1; x < gx1 - 1; x += lapStep) {
      const lap =
        gray[rowOff - width + x] +
        gray[rowOff + width + x] +
        gray[rowOff + x - 1] +
        gray[rowOff + x + 1] -
        4 * gray[rowOff + x];
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount += 1;
    }
  }
  const lapMean = lapCount > 0 ? lapSum / lapCount : 0;
  const lapVar =
    lapCount > 0 ? Math.max(0, lapSqSum / lapCount - lapMean * lapMean) : 0;
  const sharpnessScore = Math.round(Math.sqrt(lapVar) * 10) / 10;
  const isBlurry = sharpnessScore < 14;

  // Check border strips for clipped paper edges (bright paper extending directly to outer frame edges)
  const borderBand = Math.max(2, Math.floor(Math.min(width, height) * 0.025));
  const checkEdgeBrightRatio = (
    xStart: number,
    yStart: number,
    xEnd: number,
    yEnd: number
  ): number => {
    let bright = 0;
    let total = 0;
    for (let y = yStart; y < yEnd; y += 1) {
      const rowOff = y * width;
      for (let x = xStart; x < xEnd; x += 1) {
        if (gray[rowOff + x] > 185) bright += 1;
        total += 1;
      }
    }
    return total > 0 ? bright / total : 0;
  };

  const topBright = checkEdgeBrightRatio(0, 0, width, borderBand);
  const bottomBright = checkEdgeBrightRatio(0, height - borderBand, width, height);
  const leftBright = checkEdgeBrightRatio(0, 0, borderBand, height);
  const rightBright = checkEdgeBrightRatio(width - borderBand, 0, width, height);

  // If the outer frame edges themselves are overwhelmingly bright (>82%) while interior is also bright paper,
  // or if markers touch the extreme 2.5% border, warn that paper may be clipped.
  const clippedSides = [topBright, bottomBright, leftBright, rightBright].filter(
    (r) => r > 0.88
  ).length;
  const isClippedEdge = clippedSides >= 2 && brightnessScore > 140;

  // Detect dark corner fiducial-like clusters inside the 4 corner quadrants of the guide frame
  const quadW = Math.max(8, Math.floor((gx1 - gx0) * 0.24));
  const quadH = Math.max(8, Math.floor((gy1 - gy0) * 0.22));
  const cornerBoxes = [
    { x0: gx0, y0: gy0, x1: gx0 + quadW, y1: gy0 + quadH }, // TL
    { x0: gx1 - quadW, y0: gy0, x1: gx1, y1: gy0 + quadH }, // TR
    { x0: gx1 - quadW, y0: gy1 - quadH, x1: gx1, y1: gy1 }, // BR
    { x0: gx0, y0: gy1 - quadH, x1: gx0 + quadW, y1: gy1 }, // BL
  ];

  const darkThreshold = Math.max(40, Math.min(125, brightnessScore - 42));
  const cornerCenters: Array<{ x: number; y: number } | null> = cornerBoxes.map((box) => {
    let darkX = 0;
    let darkY = 0;
    let darkCount = 0;
    let total = 0;
    for (let y = box.y0; y < box.y1; y += 1) {
      const rowOff = y * width;
      for (let x = box.x0; x < box.x1; x += 1) {
        total += 1;
        if (gray[rowOff + x] < darkThreshold) {
          darkX += x;
          darkY += y;
          darkCount += 1;
        }
      }
    }
    const ratio = total > 0 ? darkCount / total : 0;
    // Fiducial square occupies roughly 2%..38% of the corner search quadrant
    if (ratio >= 0.015 && ratio <= 0.42 && darkCount >= 6) {
      return { x: darkX / darkCount, y: darkY / darkCount };
    }
    return null;
  });

  const cornersDetectedCount = cornerCenters.filter(Boolean).length;
  const paperFrameDetected = cornersDetectedCount >= 3 && brightnessScore >= 90;

  let tiltEstimateDeg = 0;
  if (cornerCenters[0] && cornerCenters[1]) {
    const dx = cornerCenters[1].x - cornerCenters[0].x;
    const dy = cornerCenters[1].y - cornerCenters[0].y;
    if (Math.abs(dx) > 10) {
      tiltEstimateDeg = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10;
    }
  }

  const excessiveTilt = Math.abs(tiltEstimateDeg) > 12;
  const alignmentReady =
    !isLowLight &&
    !isLowContrast &&
    !isBlurry &&
    !isClippedEdge &&
    paperFrameDetected &&
    !excessiveTilt;

  let guidanceMessage = 'Đặt trọn phiếu A4 và 4 ô định vị vào trong khung';
  let severity: 'ready' | 'warn' | 'error' = 'warn';

  if (isLowLight && (isBlurry || isLowContrast)) {
    guidanceMessage = 'Ảnh mờ & thiếu sáng — Bật đèn Flash và giữ chắc điện thoại';
    severity = 'error';
  } else if (isLowLight) {
    guidanceMessage = 'Thiếu sáng — Hãy bật đèn Flash hoặc di chuyển tới nơi đủ sáng';
    severity = 'error';
  } else if (isBlurry || isLowContrast) {
    guidanceMessage = 'Ảnh đang mờ / tương phản thấp — Giữ chắc điện thoại để lấy nét';
    severity = 'warn';
  } else if (isClippedEdge) {
    guidanceMessage = 'Giấy có thể bị cắt mép — Nâng điện thoại cao hơn một chút';
    severity = 'warn';
  } else if (excessiveTilt) {
    guidanceMessage = `Phiếu đang nghiêng (${Math.abs(tiltEstimateDeg).toFixed(0)}°) — Căn thẳng song song với khung`;
    severity = 'warn';
  } else if (!paperFrameDetected) {
    guidanceMessage = `Đã thấy ${cornersDetectedCount}/4 dấu góc — Căn đều 4 góc đen vào khung`;
    severity = 'warn';
  } else {
    guidanceMessage = 'Khung giấy rõ nét & đủ 4 góc — Sẵn sàng chụp';
    severity = 'ready';
  }

  return {
    brightnessScore,
    isLowLight,
    contrastScore,
    isLowContrast,
    sharpnessScore,
    isBlurry,
    isClippedEdge,
    cornersDetectedCount,
    paperFrameDetected,
    tiltEstimateDeg,
    alignmentReady,
    dHash,
    guidanceMessage,
    severity,
  };
}

/**
 * Bộ theo dõi độ ổn định khung giấy để chỉ bật Overlay cảnh báo 'Ảnh mờ/Thiếu sáng'
 * khi giáo viên đã giữ yên khung giấy (tránh nhấp nháy giả khi đang di chuyển điện thoại).
 */
export class PaperFrameStabilityTracker {
  private stableFrameCount = 0;
  private prevDHash: string | null = null;
  private prevBrightness: number | null = null;
  private readonly config: PaperStabilityConfig;

  constructor(config: Partial<PaperStabilityConfig> = {}) {
    this.config = { ...DEFAULT_PAPER_STABILITY_CONFIG, ...config };
  }

  reset(): void {
    this.stableFrameCount = 0;
    this.prevDHash = null;
    this.prevBrightness = null;
  }

  update(assist: CameraFrameAssistResult): LiveQualityOverlayState {
    if (this.prevDHash === null || this.prevBrightness === null) {
      this.stableFrameCount = 1;
    } else {
      const motionDist = hammingDistanceHex64(this.prevDHash, assist.dHash);
      const brightDelta = Math.abs(assist.brightnessScore - this.prevBrightness);
      const isSteady =
        motionDist <= this.config.maxMotionDHashDistance &&
        brightDelta <= this.config.maxBrightnessDelta;

      if (isSteady) {
        this.stableFrameCount = Math.min(
          this.config.requiredStableFrames + 4,
          this.stableFrameCount + 1
        );
      } else {
        this.stableFrameCount = 1;
      }
    }

    this.prevDHash = assist.dHash;
    this.prevBrightness = assist.brightnessScore;

    const isPaperStable =
      this.stableFrameCount >= this.config.requiredStableFrames;
    const hasBlurOrLowContrast = assist.isBlurry || assist.isLowContrast;
    const hasLowLight = assist.isLowLight;

    let issueKind: LiveQualityIssueKind = 'none';
    if (hasLowLight && hasBlurOrLowContrast) {
      issueKind = 'blurry-and-low-light';
    } else if (hasLowLight) {
      issueKind = 'low-light';
    } else if (hasBlurOrLowContrast) {
      issueKind = 'blurry';
    }

    const visible = isPaperStable && issueKind !== 'none';

    let title = '';
    let detail = '';
    if (issueKind === 'blurry-and-low-light') {
      title = 'Ảnh mờ / Thiếu sáng';
      detail =
        'Độ tương phản canvas và ánh sáng đang quá thấp — hãy bật đèn Flash hoặc đưa phiếu tới nơi đủ sáng rồi giữ yên 1 giây.';
    } else if (issueKind === 'low-light') {
      title = 'Thiếu sáng';
      detail =
        'Vùng giấy đang tối khiến hệ thống khó tách ô tô đen — hãy bật đèn Flash hoặc nghiêng tránh bóng che.';
    } else if (issueKind === 'blurry') {
      title = 'Ảnh mờ / Thiếu sáng';
      detail =
        'Độ tương phản hoặc độ nét trên khung giấy quá thấp — hãy giữ chắc tay, nâng nhẹ camera hoặc tăng ánh sáng để lấy nét rõ ô A/B/C/D.';
    }

    return {
      visible,
      issueKind,
      title,
      detail,
      isPaperStable,
      stableFrameCount: this.stableFrameCount,
      requiredStableFrames: this.config.requiredStableFrames,
      contrastScore: assist.contrastScore,
      brightnessScore: assist.brightnessScore,
      sharpnessScore: assist.sharpnessScore,
      canSuggestTorch: hasLowLight || assist.contrastScore < 28,
    };
  }
}

/**
 * Bộ theo dõi ổn định khung hình cho chế độ Tự động chụp (Auto Capture Assist).
 * - Mặc định TẮT (enabled = false); chỉ hoạt động khi giáo viên chủ động bật.
 * - Yêu cầu N khung hình liên tiếp đạt chuẩn + cooldown + khác vân tay ảnh so với phiếu vừa chụp.
 */
export class AutoCaptureStabilityTracker {
  private enabled = false;
  private stableStreak = 0;
  private lastCapturedAtMs = 0;
  private lastCapturedDHash: string | null = null;
  private readonly config: AutoCaptureConfig;

  constructor(config: Partial<AutoCaptureConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_CAPTURE_CONFIG, ...config };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stableStreak = 0;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getStableProgress(): { streak: number; required: number } {
    return {
      streak: this.stableStreak,
      required: this.config.requiredStableFrames,
    };
  }

  markManualCapture(dHash: string, nowMs: number): void {
    this.lastCapturedAtMs = nowMs;
    this.lastCapturedDHash = dHash;
    this.stableStreak = 0;
  }

  reset(): void {
    this.stableStreak = 0;
    this.lastCapturedAtMs = 0;
    this.lastCapturedDHash = null;
  }

  evaluate(
    assist: CameraFrameAssistResult,
    nowMs: number
  ): { shouldTriggerCapture: boolean; reason: string } {
    if (!this.enabled) {
      this.stableStreak = 0;
      return { shouldTriggerCapture: false, reason: 'auto-capture-disabled' };
    }

    if (!assist.alignmentReady) {
      this.stableStreak = 0;
      return { shouldTriggerCapture: false, reason: 'frame-not-ready' };
    }

    if (this.lastCapturedAtMs > 0 && nowMs - this.lastCapturedAtMs < this.config.cooldownMs) {
      this.stableStreak = 0;
      return { shouldTriggerCapture: false, reason: 'cooldown-active' };
    }

    if (
      this.lastCapturedDHash &&
      hammingDistanceHex64(this.lastCapturedDHash, assist.dHash) <
        this.config.minDHashDistance
    ) {
      this.stableStreak = 0;
      return { shouldTriggerCapture: false, reason: 'duplicate-frame-blocked' };
    }

    this.stableStreak += 1;
    if (this.stableStreak >= this.config.requiredStableFrames) {
      this.stableStreak = 0;
      this.lastCapturedAtMs = nowMs;
      this.lastCapturedDHash = assist.dHash;
      return { shouldTriggerCapture: true, reason: 'stable-ready' };
    }

    return { shouldTriggerCapture: false, reason: 'stabilizing' };
  }
}
