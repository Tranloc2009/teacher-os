import {
  DEFAULT_OMR_THRESHOLDS,
  OMR_CHOICES,
  type BubbleOptionScore,
  type BubbleRecognitionStatus,
  type NormalizedPoint,
  type OmrAlignmentDiagnostics,
  type OmrBubbleChoice,
  type OmrSheetLayoutSpec,
  type OmrThresholdsConfig,
  type RgbaImageBuffer,
} from '../../types/grading';
import { computeOmrSheetLayout } from './omrLayout';
import {
  OPTICAL_CODE_GRID_SIZE,
  decodeOpticalIdMatrix,
} from './omrOpticalCode';

export interface OmrQuestionRecognition {
  questionNumber: number;
  recognizedChoice: OmrBubbleChoice | null;
  recognizedStatus: BubbleRecognitionStatus;
  confidence: number;
  optionMetrics: BubbleOptionScore[];
  needsReview: boolean;
  reviewReasons: string[];
}

export interface OmrRecognitionResult {
  alignment: OmrAlignmentDiagnostics;
  questions: OmrQuestionRecognition[];
  /** Ảnh đã xoay đúng chiều (0/90/180/270°) để hiển thị khớp với overlay */
  rotatedWidth: number;
  rotatedHeight: number;
}

interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

function rgbaToGray(img: RgbaImageBuffer): GrayImage {
  const { width, height, data } = img;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    // Rec. 709 luminance
    gray[i] = Math.round(
      0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]
    );
  }
  return { width, height, data: gray };
}

export function rotateGrayImage(
  img: GrayImage,
  rotationDeg: 0 | 90 | 180 | 270
): GrayImage {
  if (rotationDeg === 0) return img;
  const { width, height, data } = img;
  if (rotationDeg === 180) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[(height - 1 - y) * width + (width - 1 - x)] = data[y * width + x];
      }
    }
    return { width, height, data: out };
  }
  const newW = height;
  const newH = width;
  const out = new Uint8Array(newW * newH);
  if (rotationDeg === 90) {
    // Clockwise 90°: (x, y) -> (height - 1 - y, x)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[x * newW + (height - 1 - y)] = data[y * width + x];
      }
    }
    return { width: newW, height: newH, data: out };
  }
  // Clockwise 270° (CCW 90°): (x, y) -> (y, width - 1 - x)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[(width - 1 - x) * newW + y] = data[y * width + x];
    }
  }
  return { width: newW, height: newH, data: out };
}

/**
 * Đo độ sắc nét bằng phương sai Laplacian trên mẫu lưới 2px trong vùng thân phiếu.
 * Giá trị thấp phản ánh ảnh mờ / mất nét (blur).
 */
export function computeLaplacianSharpness(gray: GrayImage): number {
  const { width, height, data } = gray;
  if (width < 40 || height < 40) return 0;

  const xStart = Math.floor(width * 0.08);
  const xEnd = Math.floor(width * 0.92);
  const yStart = Math.floor(height * 0.08);
  const yEnd = Math.floor(height * 0.92);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 360));

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = yStart + step; y < yEnd - step; y += step) {
    for (let x = xStart + step; x < xEnd - step; x += step) {
      const c = data[y * width + x];
      const lap =
        4 * c -
        data[(y - step) * width + x] -
        data[(y + step) * width + x] -
        data[y * width + (x - step)] -
        data[y * width + (x + step)];
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  // Chuẩn hóa bằng căn bậc hai (độ lệch chuẩn Laplacian) để trực quan, ổn định theo thang 0..100+
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

function sampleGrayBilinear(gray: GrayImage, x: number, y: number): number {
  const { width, height, data } = gray;
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return 255;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const dx = x - x0;
  const dy = y - y0;
  const idx = y0 * width + x0;
  const v00 = data[idx];
  const v10 = data[idx + 1];
  const v01 = data[idx + width];
  const v11 = data[idx + width + 1];
  const top = v00 + (v10 - v00) * dx;
  const bot = v01 + (v11 - v01) * dx;
  return top + (bot - top) * dy;
}

/**
 * Tìm tâm 1 dấu định vị góc (fiducial marker hình vuông đen có lõi trắng)
 * trong cửa sổ tìm kiếm góc (chiếm ~24% chiều rộng × 18% chiều cao).
 */
function findCornerFiducial(
  gray: GrayImage,
  corner: 'tl' | 'tr' | 'br' | 'bl',
  layout: OmrSheetLayoutSpec
): { point: NormalizedPoint; confidence: number } | null {
  const { width, height, data } = gray;
  const searchW = Math.floor(width * 0.24);
  const searchH = Math.floor(height * 0.18);

  const x0 = corner === 'tl' || corner === 'bl' ? 0 : width - searchW;
  const y0 = corner === 'tl' || corner === 'tr' ? 0 : height - searchH;
  const x1 = Math.min(width, x0 + searchW);
  const y1 = Math.min(height, y0 + searchH);

  // Tính ngưỡng thích nghi cục bộ của vùng góc
  let minLum = 255;
  let maxLum = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const v = data[y * width + x];
      if (v < minLum) minLum = v;
      if (v > maxLum) maxLum = v;
    }
  }
  const dynamicRange = maxLum - minLum;
  if (dynamicRange < 45) return null;
  const darkThresh = minLum + dynamicRange * 0.42;

  const expectedSize = Math.max(
    8,
    Math.round(layout.fiducials.markerSizeNormX * width)
  );
  const half = Math.max(4, Math.floor(expectedSize / 2));

  // Tìm các cụm pixel đen bằng BFS connected components trong cửa sổ góc
  const cw = x1 - x0;
  const ch = y1 - y0;
  const visited = new Uint8Array(cw * ch);

  let bestScore = -1;
  let bestCx = 0;
  let bestCy = 0;

  const targetNorm =
    corner === 'tl'
      ? layout.fiducials.topLeft
      : corner === 'tr'
      ? layout.fiducials.topRight
      : corner === 'br'
      ? layout.fiducials.bottomRight
      : layout.fiducials.bottomLeft;
  const targetPxX = targetNorm.x * width;
  const targetPxY = targetNorm.y * height;

  const queueX = new Int32Array(cw * ch);
  const queueY = new Int32Array(cw * ch);

  for (let ly = 2; ly < ch - 2; ly += 2) {
    for (let lx = 2; lx < cw - 2; lx += 2) {
      const idx = ly * cw + lx;
      if (visited[idx]) continue;
      if (data[(y0 + ly) * width + (x0 + lx)] >= darkThresh) continue;

      // Flood fill
      let head = 0;
      let tail = 0;
      queueX[tail] = lx;
      queueY[tail] = ly;
      tail += 1;
      visited[idx] = 1;

      let minX = lx;
      let maxX = lx;
      let minY = ly;
      let maxY = ly;
      let sumX = 0;
      let sumY = 0;
      let area = 0;

      while (head < tail) {
        const cx = queueX[head];
        const cy = queueY[head];
        head += 1;

        area += 1;
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (let k = 0; k < 4; k += 1) {
          const nx = neighbors[k][0];
          const ny = neighbors[k][1];
          if (nx < 0 || nx >= cw || ny < 0 || ny >= ch) continue;
          const nIdx = ny * cw + nx;
          if (visited[nIdx]) continue;
          if (data[(y0 + ny) * width + (x0 + nx)] < darkThresh) {
            visited[nIdx] = 1;
            queueX[tail] = nx;
            queueY[tail] = ny;
            tail += 1;
          }
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw < expectedSize * 0.45 || bw > expectedSize * 2.2) continue;
      if (bh < expectedSize * 0.45 || bh > expectedSize * 2.2) continue;

      const aspect = Math.min(bw, bh) / Math.max(bw, bh);
      if (aspect < 0.65) continue;

      const bboxArea = bw * bh;
      const density = area / bboxArea;
      // Fiducial hình vuông rỗng lõi trắng có mật độ đen khoảng 0.42–0.92
      if (density < 0.35 || density > 0.98) continue;

      // Chấm điểm ưu tiên cụm vuông gần kích thước chuẩn và gần góc
      const centerX = x0 + sumX / area;
      const centerY = y0 + sumY / area;

      // Kiểm tra lõi trắng đặc trưng (bulls-eye) quanh tâm để phân biệt với chấm tròn định hướng
      const ringRadius = Math.max(2, Math.round(half * 0.42));
      const ringSamples = [
        sampleGrayBilinear(gray, centerX + ringRadius, centerY),
        sampleGrayBilinear(gray, centerX - ringRadius, centerY),
        sampleGrayBilinear(gray, centerX, centerY + ringRadius),
        sampleGrayBilinear(gray, centerX, centerY - ringRadius),
      ];
      const ringLightMean =
        ringSamples.reduce((a, b) => a + b, 0) / ringSamples.length;
      const bullsEyeBonus = ringLightMean > darkThresh ? 0.35 : 0;

      const sizeScore =
        1 -
        Math.min(
          1,
          Math.abs((bw + bh) / 2 - expectedSize) / Math.max(1, expectedSize)
        );
      const distNorm =
        Math.hypot(centerX - targetPxX, centerY - targetPxY) /
        Math.hypot(searchW, searchH);
      const posScore = Math.max(0, 1 - distNorm * 1.1);

      const totalScore =
        aspect * 0.35 + sizeScore * 0.3 + posScore * 0.35 + bullsEyeBonus;
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestCx = centerX;
        bestCy = centerY;
      }
    }
  }

  if (bestScore < 0.48) return null;
  return {
    point: { x: bestCx / width, y: bestCy / height },
    confidence: Math.min(1, bestScore),
  };
}

/**
 * Giải hệ phương trình tuyến tính 8×8 tìm ma trận biến đổi phối cảnh (Projective Homography H)
 * ánh xạ từ tọa độ chuẩn A4 (u, v) -> tọa độ ảnh thực tế (x, y).
 */
export function computeHomography(
  src: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint],
  dst: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const u = src[i].x;
    const v = src[i].y;
    const x = dst[i].x;
    const y = dst[i].y;
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }

  // Gaussian elimination with partial pivoting
  const n = 8;
  const M = A.map((row, idx) => [...row, b[idx]]);

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r += 1) {
      const val = Math.abs(M[r][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-10) return null;
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let c = col; c <= n; c += 1) {
      M[col][c] /= pivot;
    }

    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c <= n; c += 1) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return [
    M[0][n],
    M[1][n],
    M[2][n],
    M[3][n],
    M[4][n],
    M[5][n],
    M[6][n],
    M[7][n],
    1,
  ];
}

export function applyHomography(
  H: number[],
  u: number,
  v: number
): NormalizedPoint {
  const w = H[6] * u + H[7] * v + H[8];
  if (Math.abs(w) < 1e-9) return { x: u, y: v };
  return {
    x: (H[0] * u + H[1] * v + H[2]) / w,
    y: (H[3] * u + H[4] * v + H[5]) / w,
  };
}

/**
 * Đo độ tối tại điểm đánh dấu hướng (orientationDot) trên ảnh đã có Homography H.
 * Nếu đúng chiều 0°, điểm orientationDot nằm ngay cạnh góc trên-trái sẽ rất tối (<100),
 * còn 3 vị trí đối xứng kia sẽ sáng (nền giấy trắng >200).
 */
function measureOrientationScore(
  gray: GrayImage,
  H: number[],
  layout: OmrSheetLayoutSpec
): number {
  const sampleDotDarkness = (u: number, v: number): number => {
    const p = applyHomography(H, u, v);
    const px = p.x * gray.width;
    const py = p.y * gray.height;
    const r = Math.max(2, Math.round(layout.fiducials.markerSizeNormX * gray.width * 0.2));
    let sum = 0;
    let count = 0;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        sum += sampleGrayBilinear(gray, px + dx, py + dy);
        count += 1;
      }
    }
    const mean = count > 0 ? sum / count : 255;
    return (255 - mean) / 255;
  };

  const od = layout.fiducials.orientationDot;
  const expectedDark = sampleDotDarkness(od.x, od.y);
  // Vị trí đối xứng 180° (gần góc dưới-phải)
  const oppositeDark = sampleDotDarkness(1 - od.x, 1 - od.y);
  return expectedDark - oppositeDark;
}

/**
 * Đọc ma trận mã định danh quang học 18×18 từ vùng opticalCodeBox qua phép biến đổi phối cảnh H.
 */
function readOpticalCodeFromWarpedRegion(
  gray: GrayImage,
  H: number[],
  layout: OmrSheetLayoutSpec
): {
  status: 'decoded' | 'unreadable' | 'corrupted' | 'absent';
  payload?: ReturnType<typeof decodeOpticalIdMatrix>['payload'];
  warning?: string;
} {
  const box = layout.opticalCodeBox;
  const n = OPTICAL_CODE_GRID_SIZE;
  const cellMeans: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 255)
  );

  let minV = 255;
  let maxV = 0;

  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      // Lấy mẫu 3×3 điểm trong lòng mỗi ô (tránh vùng biên chống lem)
      let sum = 0;
      let cnt = 0;
      for (const oy of [0.35, 0.5, 0.65]) {
        for (const ox of [0.35, 0.5, 0.65]) {
          const u = box.x + ((c + ox) / n) * box.width;
          const v = box.y + ((r + oy) / n) * box.height;
          const pt = applyHomography(H, u, v);
          sum += sampleGrayBilinear(gray, pt.x * gray.width, pt.y * gray.height);
          cnt += 1;
        }
      }
      const mean = sum / cnt;
      cellMeans[r][c] = mean;
      if (mean < minV) minV = mean;
      if (mean > maxV) maxV = mean;
    }
  }

  if (maxV - minV < 38) {
    return {
      status: 'absent',
      warning: 'Không phát hiện mã định danh phiếu (QR/2D Code). Vui lòng chọn mã đề và học sinh thủ công.',
    };
  }

  // Ngưỡng Otsu nhẹ giữa min và max trên chính ma trận 18×18
  const thresh = minV + (maxV - minV) * 0.52;
  const grid: boolean[][] = cellMeans.map((row) =>
    row.map((val) => val < thresh)
  );

  const decoded = decodeOpticalIdMatrix(grid);
  if (decoded.status === 'decoded' && decoded.payload) {
    return { status: 'decoded', payload: decoded.payload };
  }
  return {
    status: decoded.status,
    warning:
      decoded.error ??
      'Không đọc được mã định danh phiếu. Vui lòng chọn mã đề và học sinh thủ công.',
  };
}

/**
 * Đo mật độ tô và độ tương phản của một ô tròn A/B/C/D sử dụng ngưỡng thích nghi cục bộ
 * (so sánh lõi trong ô với vành giấy trắng ngay xung quanh).
 */
function measureBubbleFill(
  gray: GrayImage,
  H: number[],
  cxNorm: number,
  cyNorm: number,
  rxNorm: number,
  ryNorm: number
): { fillRatio: number; contrastDelta: number; occluded: boolean } {
  // Lấy mẫu vành nền cục bộ quanh ô (từ 1.3R đến 1.75R) để miễn nhiễm bóng đổ / ánh sáng không đều
  const bgValues: number[] = [];
  for (let angleIdx = 0; angleIdx < 16; angleIdx += 1) {
    const theta = (angleIdx / 16) * Math.PI * 2;
    const u = cxNorm + Math.cos(theta) * rxNorm * 1.5;
    const v = cyNorm + Math.sin(theta) * ryNorm * 1.5;
    const pt = applyHomography(H, u, v);
    bgValues.push(sampleGrayBilinear(gray, pt.x * gray.width, pt.y * gray.height));
  }
  bgValues.sort((a, b) => a - b);
  // Lấy phân vị thứ 75% làm độ sáng nền giấy cục bộ (tránh dính chữ/đường kẻ)
  const localBg = bgValues[Math.floor(bgValues.length * 0.75)] ?? 240;

  if (localBg < 75) {
    // Vùng giấy bị tối đen / che khuất nặng
    return { fillRatio: 0, contrastDelta: 0, occluded: true };
  }

  // Lấy mẫu vùng lõi bên trong ô (bán kính <= 0.68R) để bỏ qua nét viền tròn in sẵn
  let darkPixels = 0;
  let totalPixels = 0;
  let innerSum = 0;
  // Mực đậm thực sự tối hơn nền giấy ít nhất 35% (tránh biến vết chì nhạt thành 100% darkPixels)
  const darkCutoff = localBg * 0.65;

  const steps = 7;
  for (let iy = -steps; iy <= steps; iy += 1) {
    for (let ix = -steps; ix <= steps; ix += 1) {
      const nx = ix / steps;
      const ny = iy / steps;
      const distSq = nx * nx + ny * ny;
      if (distSq > 0.68 * 0.68) continue;
      const u = cxNorm + nx * rxNorm;
      const v = cyNorm + ny * ryNorm;
      const pt = applyHomography(H, u, v);
      const lum = sampleGrayBilinear(gray, pt.x * gray.width, pt.y * gray.height);
      innerSum += lum;
      if (lum < darkCutoff) darkPixels += 1;
      totalPixels += 1;
    }
  }

  if (totalPixels === 0) {
    return { fillRatio: 0, contrastDelta: 0, occluded: true };
  }

  const innerMean = innerSum / totalPixels;
  // Đơn điệu tuyến tính: vết chì mờ 20–34% nằm đúng vùng uncertain [0.16..0.42), tô đậm >=45% nằm chắc vùng selected
  const darkPixelFraction = darkPixels / totalPixels;
  const darknessMean = Math.max(0, (localBg - innerMean) / Math.max(1, localBg));
  const fillRatio = Math.min(
    1,
    Math.max(darknessMean, darkPixelFraction * 0.5 + darknessMean * 0.5)
  );
  const contrastDelta = Math.max(0, (localBg - innerMean) / 255);

  return {
    fillRatio: Math.round(fillRatio * 1000) / 1000,
    contrastDelta: Math.round(contrastDelta * 1000) / 1000,
    occluded: false,
  };
}

/**
 * Pipeline Computer Vision OMR cục bộ đầy đủ (không AI, không backend):
 * 1. Chuyển ảnh xám + đánh giá độ sắc nét (Laplacian).
 * 2. Tự động thử góc xoay (0°/180° cho ảnh dọc, 90°/270° cho ảnh ngang) để tìm 4 dấu định vị góc
 *    và khớp điểm định hướng bất đối xứng (orientationDot).
 * 3. Tính ma trận phối cảnh Homography 3×3 nắn thẳng độ nghiêng / biến dạng góc chụp.
 * 4. Giải mã mã định danh quang học (QR/2D Code) nếu có.
 * 5. Đo mật độ mực cục bộ từng ô A/B/C/D và phân loại an toàn:
 *    selected | blank | multiple | uncertain | unreadable.
 */
export function runLocalOmrVisionPipeline(
  image: RgbaImageBuffer,
  questionCount: number,
  thresholds: OmrThresholdsConfig = DEFAULT_OMR_THRESHOLDS
): OmrRecognitionResult {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const layout = computeOmrSheetLayout(questionCount);
  const baseGray = rgbaToGray(image);

  // Chọn tập góc xoay ứng viên theo tỷ lệ cạnh ảnh (A4 luôn dọc height > width)
  const candidateRotations: Array<0 | 90 | 180 | 270> =
    baseGray.width > baseGray.height ? [90, 270, 0, 180] : [0, 180, 90, 270];

  interface AlignmentCandidate {
    rotationDeg: 0 | 90 | 180 | 270;
    gray: GrayImage;
    H: number[];
    corners: {
      topLeft: NormalizedPoint;
      topRight: NormalizedPoint;
      bottomRight: NormalizedPoint;
      bottomLeft: NormalizedPoint;
    };
    orientationScore: number;
    cornerConfidence: number;
  }

  let bestCandidate: AlignmentCandidate | null = null;

  for (const rot of candidateRotations) {
    const rotated = rotateGrayImage(baseGray, rot);
    const tl = findCornerFiducial(rotated, 'tl', layout);
    const tr = findCornerFiducial(rotated, 'tr', layout);
    const br = findCornerFiducial(rotated, 'br', layout);
    const bl = findCornerFiducial(rotated, 'bl', layout);
    if (!tl || !tr || !br || !bl) continue;

    const H = computeHomography(
      [
        layout.fiducials.topLeft,
        layout.fiducials.topRight,
        layout.fiducials.bottomRight,
        layout.fiducials.bottomLeft,
      ],
      [tl.point, tr.point, br.point, bl.point]
    );
    if (!H) continue;

    const orientationScore = measureOrientationScore(rotated, H, layout);
    const cornerConfidence =
      (tl.confidence + tr.confidence + br.confidence + bl.confidence) / 4;

    if (
      !bestCandidate ||
      orientationScore > bestCandidate.orientationScore + 0.08 ||
      (Math.abs(orientationScore - bestCandidate.orientationScore) <= 0.08 &&
        cornerConfidence > bestCandidate.cornerConfidence)
    ) {
      bestCandidate = {
        rotationDeg: rot,
        gray: rotated,
        H,
        corners: {
          topLeft: tl.point,
          topRight: tr.point,
          bottomRight: br.point,
          bottomLeft: bl.point,
        },
        orientationScore,
        cornerConfidence,
      };
    }

    // Nếu đã tìm thấy đúng chiều rõ ràng (orientationDot đậm hẳn) thì dừng sớm để tối ưu tốc độ
    if (orientationScore > 0.35 && cornerConfidence > 0.65) {
      break;
    }
  }

  const warnings: string[] = [];

  if (!bestCandidate) {
    // Fallback an toàn: không nắn được 4 góc -> báo không căn chỉnh được và đánh dấu mọi câu unreadable
    const sharpnessScore = computeLaplacianSharpness(baseGray);
    const lowSharpness = sharpnessScore < thresholds.minSharpnessScore;
    warnings.push(
      'Không tìm đủ 4 dấu định vị góc (fiducial markers). Vui lòng chụp lại rõ cả 4 góc phiếu hoặc chấm kiểm tra thủ công.'
    );
    if (lowSharpness) {
      warnings.push(
        `Ảnh bị mờ (độ sắc nét ${sharpnessScore.toFixed(1)} < ngưỡng ${thresholds.minSharpnessScore}).`
      );
    }

    const unreadableQuestions: OmrQuestionRecognition[] = [];
    for (let q = 1; q <= layout.questionCount; q += 1) {
      unreadableQuestions.push({
        questionNumber: q,
        recognizedChoice: null,
        recognizedStatus: 'unreadable',
        confidence: 0,
        optionMetrics: OMR_CHOICES.map((c) => ({
          choice: c,
          fillRatio: 0,
          contrastDelta: 0,
        })),
        needsReview: true,
        reviewReasons: ['Không căn chỉnh được 4 góc phiếu trả lời.'],
      });
    }

    const elapsed =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
      startedAt;

    return {
      alignment: {
        aligned: false,
        detectedRotationDeg: 0,
        sharpnessScore,
        lowSharpness,
        opticalCodeStatus: 'unreadable',
        warnings,
        processingTimeMs: Math.round(elapsed),
      },
      questions: unreadableQuestions,
      rotatedWidth: baseGray.width,
      rotatedHeight: baseGray.height,
    };
  }

  const { gray, H, corners, rotationDeg } = bestCandidate;
  const sharpnessScore = computeLaplacianSharpness(gray);
  const lowSharpness = sharpnessScore < thresholds.minSharpnessScore;

  if (lowSharpness) {
    warnings.push(
      `Ảnh phiếu bị mờ hoặc thiếu nét (độ sắc nét ${sharpnessScore.toFixed(1)} < ngưỡng ${thresholds.minSharpnessScore}). Cần giáo viên đối chiếu thủ công.`
    );
  }
  if (rotationDeg !== 0) {
    warnings.push(`Hệ thống đã tự động xoay chuẩn phiếu ${rotationDeg}° theo dấu định hướng.`);
  }

  const opticalResult = readOpticalCodeFromWarpedRegion(gray, H, layout);
  if (opticalResult.warning) {
    warnings.push(opticalResult.warning);
  }

  // Nhận diện từng câu hỏi 1..N
  const questions: OmrQuestionRecognition[] = [];
  for (let q = 1; q <= layout.questionCount; q += 1) {
    const rowBubbles = layout.bubbles.filter((b) => b.questionNumber === q);
    const metrics: BubbleOptionScore[] = [];
    let anyOccluded = false;

    for (const b of rowBubbles) {
      const res = measureBubbleFill(
        gray,
        H,
        b.cx,
        b.cy,
        b.radiusNormX,
        b.radiusNormY
      );
      if (res.occluded) anyOccluded = true;
      metrics.push({
        choice: b.choice,
        fillRatio: res.fillRatio,
        contrastDelta: res.contrastDelta,
      });
    }

    if (anyOccluded) {
      questions.push({
        questionNumber: q,
        recognizedChoice: null,
        recognizedStatus: 'unreadable',
        confidence: 0,
        optionMetrics: metrics,
        needsReview: true,
        reviewReasons: ['Vùng ô trả lời bị che khuất hoặc tối bất thường.'],
      });
      continue;
    }

    const sorted = [...metrics].sort((a, b) => b.fillRatio - a.fillRatio);
    const top1 = sorted[0];
    const top2 = sorted[1];
    const margin = top1.fillRatio - top2.fillRatio;

    const filledAboveThresh = metrics.filter(
      (m) => m.fillRatio >= thresholds.filledThreshold
    );
    const reviewReasons: string[] = [];
    let status: BubbleRecognitionStatus;
    let choice: OmrBubbleChoice | null = null;
    let confidence = 0;

    if (filledAboveThresh.length >= 2) {
      status = 'multiple';
      choice = null;
      confidence = Math.max(0.1, 1 - margin);
      reviewReasons.push(
        `Phát hiện tô nhiều hơn 1 ô (${filledAboveThresh.map((m) => m.choice).join(', ')}).`
      );
    } else if (
      top1.fillRatio >= thresholds.filledThreshold &&
      margin >= thresholds.minMarginToSecond &&
      top1.contrastDelta >= thresholds.minContrastDelta
    ) {
      if (lowSharpness) {
        // Ảnh mờ: không tự kết luận chắc chắn, vẫn gửi ý nhận diện nhưng bắt buộc REVIEW
        status = 'uncertain';
        choice = null;
        confidence = Math.min(0.55, top1.fillRatio);
        reviewReasons.push(
          `Ảnh mờ nên không tự chốt đáp án (ô đậm nhất là ${top1.choice}, mật độ ${Math.round(top1.fillRatio * 100)}%).`
        );
      } else {
        status = 'selected';
        choice = top1.choice;
        confidence = Math.min(
          0.99,
          Math.max(0.65, 0.5 + margin * 0.9 + top1.contrastDelta * 0.4)
        );
      }
    } else if (top1.fillRatio <= thresholds.blankMaxThreshold) {
      if (lowSharpness) {
        status = 'uncertain';
        choice = null;
        confidence = 0.4;
        reviewReasons.push('Ảnh mờ — không thể khẳng định chắc chắn ô bỏ trống.');
      } else {
        status = 'blank';
        choice = null;
        confidence = Math.min(0.96, 1 - top1.fillRatio * 2);
      }
    } else {
      // Vùng trung gian: tô quá mờ, tẩy xóa chưa sạch, hoặc 2 ô chênh lệch quá sát -> TUYỆT ĐỐI KHÔNG ĐOÁN
      status = 'uncertain';
      choice = null;
      confidence = Math.max(0.15, Math.min(0.6, margin + 0.2));
      if (top1.fillRatio >= thresholds.filledThreshold && margin < thresholds.minMarginToSecond) {
        reviewReasons.push(
          `Hai phương án ${top1.choice} (${Math.round(top1.fillRatio * 100)}%) và ${top2.choice} (${Math.round(top2.fillRatio * 100)}%) có độ đậm quá sát nhau.`
        );
      } else {
        reviewReasons.push(
          `Vết tô mờ hoặc chưa rõ ràng tại ô ${top1.choice} (mật độ ${Math.round(top1.fillRatio * 100)}%, ngưỡng rõ ≥ ${Math.round(thresholds.filledThreshold * 100)}%).`
        );
      }
    }

    questions.push({
      questionNumber: q,
      recognizedChoice: choice,
      recognizedStatus: status,
      confidence: Math.round(confidence * 100) / 100,
      optionMetrics: metrics,
      needsReview: status === 'multiple' || status === 'uncertain',
      reviewReasons,
    });
  }

  const elapsed =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
    startedAt;

  return {
    alignment: {
      aligned: true,
      detectedRotationDeg: rotationDeg,
      sharpnessScore,
      lowSharpness,
      detectedCorners: corners,
      inverseHomography: H,
      opticalCodeStatus: opticalResult.status,
      opticalCodePayload: opticalResult.payload,
      warnings,
      processingTimeMs: Math.round(elapsed),
    },
    questions,
    rotatedWidth: gray.width,
    rotatedHeight: gray.height,
  };
}
