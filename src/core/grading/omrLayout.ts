import {
  OMR_CHOICES,
  type OmrBubbleGeometry,
  type OmrSheetLayoutSpec,
  type SheetOpticalIdPayloadV1,
} from '../../types/grading';
import {
  OPTICAL_CODE_GRID_SIZE,
  encodeOpticalIdMatrix,
} from './omrOpticalCode';

export const A4_ASPECT_RATIO = 297 / 210; // ~1.4142857

/**
 * Tạo đặc tả hình học chuẩn A4 của phiếu trả lời trắc nghiệm TeacherOS.
 * Cả trình tạo phiếu in A4, bộ kiểm thử tổng hợp ảnh, OMR CV Engine và bộ vẽ ảnh minh chứng
 * đều dùng CHUNG 1 nguồn sự thật này để đảm bảo tọa độ khớp tuyệt đối.
 */
export function computeOmrSheetLayout(rawQuestionCount: number): OmrSheetLayoutSpec {
  const questionCount = Math.max(1, Math.min(60, Math.round(rawQuestionCount || 20)));

  // Chia cột khoa học, đảm bảo khoảng cách ô tô rộng rãi, chống lem mực khi học sinh tô
  const columns = questionCount <= 20 ? 2 : 3;
  const rowsPerColumn = Math.ceil(questionCount / columns);

  // 4 dấu định vị góc (fiducial markers) đặt cách mép giấy an toàn ~12mm (khó bị cắt khi in/scan)
  const marginX = 0.062;
  const marginY = 0.044;
  const markerSizeNormX = 0.036;
  const markerSizeNormY = markerSizeNormX / A4_ASPECT_RATIO;

  const fiducials = {
    topLeft: { x: marginX, y: marginY },
    topRight: { x: 1 - marginX, y: marginY },
    bottomRight: { x: 1 - marginX, y: 1 - marginY },
    bottomLeft: { x: marginX, y: 1 - marginY },
    // Điểm đánh dấu bất đối xứng nằm ngay cạnh góc trên-trái để nhận diện chính xác góc xoay 0/90/180/270°
    orientationDot: { x: marginX + 0.056, y: marginY },
    markerSizeNormX,
    markerSizeNormY,
  };

  // Vùng mã định danh quang học (QR/2D Code) góc trên-phải, hoàn toàn tách biệt vùng chữ viết & ô tô
  const codeWidth = 0.145;
  const codeHeight = codeWidth / A4_ASPECT_RATIO;
  const opticalCodeBox = {
    x: 0.775,
    y: 0.082,
    width: codeWidth,
    height: codeHeight,
  };

  // Vùng lưới ô trả lời A/B/C/D: từ y = 0.255 đến y = 0.915
  const gridLeft = 0.095;
  const gridRight = 0.905;
  const gridTop = 0.275;
  const gridBottom = 0.905;

  const colGap = columns === 2 ? 0.075 : 0.048;
  const colWidth = (gridRight - gridLeft - colGap * (columns - 1)) / columns;

  const maxRowSpacing = (gridBottom - gridTop) / Math.max(rowsPerColumn, 10);
  const rowStep = Math.min(0.052, maxRowSpacing);

  // Bán kính ô tô chuẩn (vừa đủ lớn để tô bút chì/bi, không dính nhau)
  const radiusNormX = columns === 2 ? 0.0145 : 0.0115;
  const radiusNormY = radiusNormX / A4_ASPECT_RATIO;

  const bubbles: OmrBubbleGeometry[] = [];

  for (let q = 1; q <= questionCount; q += 1) {
    const colIdx = Math.floor((q - 1) / rowsPerColumn);
    const rowIdx = (q - 1) % rowsPerColumn;
    const colStartX = gridLeft + colIdx * (colWidth + colGap);
    // Chừa 26% đầu cột cho số thứ tự câu, 74% còn lại chia đều cho 4 ô A, B, C, D
    const choicesStartX = colStartX + colWidth * 0.28;
    const choicesSpanX = colWidth * 0.68;
    const choiceStepX = choicesSpanX / 3;

    const cy = gridTop + rowIdx * rowStep + rowStep * 0.5;

    for (let cIdx = 0; cIdx < OMR_CHOICES.length; cIdx += 1) {
      const cx = choicesStartX + cIdx * choiceStepX;
      bubbles.push({
        questionNumber: q,
        choice: OMR_CHOICES[cIdx],
        cx,
        cy,
        radiusNormX,
        radiusNormY,
      });
    }
  }

  return {
    schemaVersion: '1.0',
    paper: 'A4',
    aspectRatioHeightOverWidth: A4_ASPECT_RATIO,
    questionCount,
    columns,
    rowsPerColumn,
    fiducials,
    opticalCodeBox,
    bubbles,
  };
}

export interface PrintableOmrSheetOptions {
  examTitle: string;
  subject: string;
  grade: string;
  examCode: string;
  className?: string;
  studentId?: string;
  studentName?: string;
  sessionId: string;
  sheetId?: string;
  questionCount: number;
  includeOpticalCode?: boolean;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Render phiếu trả lời trắc nghiệm chuẩn A4 TeacherOS dưới dạng SVG vector sắc nét
 * (tỉ lệ chính xác 210×297 mm -> viewBox 1000 × 1414.29).
 */
export function buildPrintableOmrSheetSvg(options: PrintableOmrSheetOptions): string {
  const layout = computeOmrSheetLayout(options.questionCount);
  const W = 1000;
  const H = Math.round(W * layout.aspectRatioHeightOverWidth);

  const { fiducials, opticalCodeBox } = layout;
  const mw = fiducials.markerSizeNormX * W;
  const mh = fiducials.markerSizeNormY * H;

  const drawFiducial = (cxNorm: number, cyNorm: number) => {
    const cx = cxNorm * W;
    const cy = cyNorm * H;
    return `
      <rect x="${(cx - mw / 2).toFixed(2)}" y="${(cy - mh / 2).toFixed(2)}" width="${mw.toFixed(2)}" height="${mh.toFixed(2)}" fill="#0F172A" />
      <rect x="${(cx - mw * 0.28).toFixed(2)}" y="${(cy - mh * 0.28).toFixed(2)}" width="${(mw * 0.56).toFixed(2)}" height="${(mh * 0.56).toFixed(2)}" fill="#FFFFFF" />
      <rect x="${(cx - mw * 0.14).toFixed(2)}" y="${(cy - mh * 0.14).toFixed(2)}" width="${(mw * 0.28).toFixed(2)}" height="${(mh * 0.28).toFixed(2)}" fill="#0F172A" />
    `;
  };

  // Orientation marker (solid circle next to top-left fiducial)
  const odx = fiducials.orientationDot.x * W;
  const ody = fiducials.orientationDot.y * H;
  const odr = mw * 0.36;

  // Optical 2D Code SVG
  let opticalCodeSvg = '';
  if (options.includeOpticalCode !== false) {
    const payload: SheetOpticalIdPayloadV1 = {
      v: 1,
      sid: options.sessionId,
      ec: options.examCode,
      st: options.studentId,
      sh: options.sheetId,
      p: 1,
    };
    const matrix = encodeOpticalIdMatrix(payload);
    const bx = opticalCodeBox.x * W;
    const by = opticalCodeBox.y * H;
    const bw = opticalCodeBox.width * W;
    const bh = opticalCodeBox.height * H;
    const cellW = bw / OPTICAL_CODE_GRID_SIZE;
    const cellH = bh / OPTICAL_CODE_GRID_SIZE;

    const rects: string[] = [];
    rects.push(
      `<rect x="${(bx - 6).toFixed(1)}" y="${(by - 6).toFixed(1)}" width="${(bw + 12).toFixed(1)}" height="${(bh + 12).toFixed(1)}" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1" />`
    );
    for (let r = 0; r < OPTICAL_CODE_GRID_SIZE; r += 1) {
      for (let c = 0; c < OPTICAL_CODE_GRID_SIZE; c += 1) {
        if (!matrix[r][c]) continue;
        rects.push(
          `<rect x="${(bx + c * cellW).toFixed(2)}" y="${(by + r * cellH).toFixed(2)}" width="${(cellW + 0.25).toFixed(2)}" height="${(cellH + 0.25).toFixed(2)}" fill="#0F172A" />`
        );
      }
    }
    rects.push(
      `<text x="${(bx + bw / 2).toFixed(1)}" y="${(by + bh + 16).toFixed(1)}" text-anchor="middle" font-size="10.5" font-family="ui-monospace, monospace" fill="#475569">ID ${escapeXml(options.examCode)}${options.studentId ? ` · ${escapeXml(options.studentId)}` : ''}</text>`
    );
    opticalCodeSvg = rects.join('\n');
  }

  // Column headers (Câu | A B C D)
  const colHeadersSvg: string[] = [];
  const rowsPerColumn = layout.rowsPerColumn;
  for (let col = 0; col < layout.columns; col += 1) {
    const firstQ = col * rowsPerColumn + 1;
    if (firstQ > layout.questionCount) break;
    const qBubbles = layout.bubbles.filter((b) => b.questionNumber === firstQ);
    if (qBubbles.length !== 4) continue;
    const headerY = qBubbles[0].cy * H - Math.max(26, qBubbles[0].radiusNormY * H * 2.1);
    const numX = qBubbles[0].cx * W - qBubbles[0].radiusNormX * W * 3.1;
    colHeadersSvg.push(
      `<text x="${numX.toFixed(1)}" y="${headerY.toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">Câu</text>`
    );
    for (const b of qBubbles) {
      colHeadersSvg.push(
        `<text x="${(b.cx * W).toFixed(1)}" y="${headerY.toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#0F172A">${b.choice}</text>`
      );
    }
  }

  // Question rows & A/B/C/D bubbles
  const bubbleElements: string[] = [];
  for (let q = 1; q <= layout.questionCount; q += 1) {
    const rowBubbles = layout.bubbles.filter((b) => b.questionNumber === q);
    if (rowBubbles.length === 0) continue;
    const first = rowBubbles[0];
    const cy = first.cy * H;
    const r = first.radiusNormX * W;
    const numX = first.cx * W - r * 3.1;

    // Zebra tint subtle horizontal guide for readability (very light so it never confuses OMR)
    if (q % 5 === 0) {
      const last = rowBubbles[rowBubbles.length - 1];
      bubbleElements.push(
        `<line x1="${(numX - 18).toFixed(1)}" y1="${(cy + r + 8).toFixed(1)}" x2="${(last.cx * W + r + 10).toFixed(1)}" y2="${(cy + r + 8).toFixed(1)}" stroke="#E2E8F0" stroke-width="1" />`
      );
    }

    bubbleElements.push(
      `<text x="${numX.toFixed(1)}" y="${(cy + 4.5).toFixed(1)}" text-anchor="middle" font-size="13.5" font-weight="600" font-family="ui-monospace, monospace" fill="#1E293B">${String(q).padStart(2, '0')}</text>`
    );

    for (const b of rowBubbles) {
      const cx = b.cx * W;
      bubbleElements.push(
        `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="#FFFFFF" stroke="#1E293B" stroke-width="1.8" />`
      );
      bubbleElements.push(
        `<text x="${cx.toFixed(2)}" y="${(cy + 4).toFixed(2)}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#94A3B8">${b.choice}</text>`
      );
    }
  }

  const rawTitle = options.examTitle || 'Bài kiểm tra trắc nghiệm';
  const titleText = escapeXml(
    rawTitle.length > 68 ? `${rawTitle.slice(0, 65)}...` : rawTitle
  );
  const titleFontSize = rawTitle.length > 50 ? 16.5 : rawTitle.length > 36 ? 19 : 22;
  const subtitleText = escapeXml(
    [options.subject, options.grade, options.className ? `Lớp ${options.className}` : '']
      .filter(Boolean)
      .join(' · ')
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" style="background:#FFFFFF">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF" />

  <!-- 4 Corner Fiducial Alignment Markers -->
  ${drawFiducial(fiducials.topLeft.x, fiducials.topLeft.y)}
  ${drawFiducial(fiducials.topRight.x, fiducials.topRight.y)}
  ${drawFiducial(fiducials.bottomRight.x, fiducials.bottomRight.y)}
  ${drawFiducial(fiducials.bottomLeft.x, fiducials.bottomLeft.y)}
  <!-- Asymmetric Top-Left Orientation Dot -->
  <circle cx="${odx.toFixed(2)}" cy="${ody.toFixed(2)}" r="${odr.toFixed(2)}" fill="#0F172A" />

  <!-- Header Block -->
  <g font-family="'Be Vietnam Pro', 'Inter', system-ui, sans-serif">
    <text x="95" y="106" font-size="11.5" font-weight="700" letter-spacing="1.2" fill="#4F46E5">PHIẾU TRẢ LỜI TRẮC NGHIỆM CHUẨN TEACHEROS · OMR 1.0</text>
    <text x="95" y="136" font-size="${titleFontSize}" font-weight="700" fill="#0F172A">${titleText}</text>
    <text x="95" y="159" font-size="13" fill="#475569">${subtitleText}</text>

    <!-- Student & Exam Code Metadata Box -->
    <rect x="95" y="176" width="650" height="86" rx="8" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.2" />
    <text x="112" y="201" font-size="12.5" font-weight="600" fill="#334155">Họ và tên:</text>
    <text x="190" y="201" font-size="13.5" font-weight="700" fill="#0F172A">${escapeXml(options.studentName || '................................................................')}</text>

    <text x="112" y="227" font-size="12.5" font-weight="600" fill="#334155">Mã học sinh:</text>
    <text x="200" y="227" font-size="13.5" font-weight="700" font-family="ui-monospace, monospace" fill="#0F172A">${escapeXml(options.studentId || '....................')}</text>

    <text x="410" y="227" font-size="12.5" font-weight="600" fill="#334155">Lớp:</text>
    <text x="448" y="227" font-size="13.5" font-weight="700" fill="#0F172A">${escapeXml(options.className || '............')}</text>

    <text x="580" y="227" font-size="12.5" font-weight="600" fill="#334155">Mã đề:</text>
    <rect x="630" y="209" width="98" height="26" rx="5" fill="#EEF2FF" stroke="#6366F1" stroke-width="1.2" />
    <text x="679" y="227" text-anchor="middle" font-size="14" font-weight="800" font-family="ui-monospace, monospace" fill="#312E81">${escapeXml(options.examCode)}</text>

    <text x="112" y="250" font-size="10.5" fill="#475569">Hướng dẫn: Tô kín, đậm 1 ô tròn duy nhất (A/B/C/D). Không gấp, rách hoặc che 4 dấu định vị góc.</text>
  </g>

  <!-- Optical Identification Code (2D Matrix) -->
  ${opticalCodeSvg}

  <!-- Answer Grid Frame -->
  <rect x="82" y="328" width="836" height="${(H - 420).toFixed(0)}" rx="10" fill="none" stroke="#CBD5E1" stroke-width="1.2" />

  <!-- Column Headers -->
  <g font-family="'Be Vietnam Pro', 'Inter', system-ui, sans-serif">
    ${colHeadersSvg.join('\n')}
  </g>

  <!-- Bubble Grid -->
  <g font-family="'Be Vietnam Pro', 'Inter', system-ui, sans-serif">
    ${bubbleElements.join('\n')}
  </g>

  <!-- Footer -->
  <text x="500" y="${H - 40}" text-anchor="middle" font-size="11" font-family="'Be Vietnam Pro', system-ui, sans-serif" fill="#64748B">
    TeacherOS Smart Grading Studio · Phiếu chuẩn A4 (${layout.questionCount} câu) · Giữ phẳng giấy và đủ ánh sáng khi chụp ảnh
  </text>
</svg>`;
}
