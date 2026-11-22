import JSZip from 'jszip';
import {
  ExamExportSettings,
  ExportIntegrityResult,
  MathContentPayload,
  MathExamProject,
  MathIntegrityIssue,
  MathQuestion,
  MathVisualAsset,
  MixedExamVersion,
  QuestionGroup,
} from '../types/mathExam';
import {
  MCQ_LABELS,
  TF_LABELS,
  checkDraftExportGate,
  checkExamExportGate,
  computeContentHash,
  computeQuestionVerificationContentHash,
  formatVerifiedSectionHeading,
  getOptionLetterLabel,
  getStatementLetterLabel,
  sanitizeSvgSource,
} from './mathIntegrity';
import { extractDocxDocument } from './ooxmlParser';
import { importUniversalExamFile } from './universalImportEngine';
import { getSubjectProfile, getUniversalQuestionType, resolveSubjectId } from './subjectProfileRegistry';
import { convertSvgToPngDataUrl } from './examGenerator/dynamicSvgGraphEngine';
import { verifyDynamicGraphBinding } from './examGenerator/level3GraphTemplates';
import type {
  ExamBodyAlignment,
  ExamEssayLineStyle,
  ExamFormPostExportAuditReport,
  ExamFormTemplate,
  ExamOptionLayout,
  ExamPageNumberFormat,
  ExamShortAnswerBoxStyle,
} from '../types/examForm';
import {
  buildPlaceholderContext,
  buildStudentInfoLine,
  resolveAutoOptionLayout,
  resolveExamFormPlaceholders,
} from './examFormEngine';

export const DEFAULT_EXAM_EXPORT_SETTINGS: ExamExportSettings = {
  departmentName: 'SỞ GIÁO DỤC VÀ ĐÀO TẠO',
  schoolName: 'TRƯỜNG THPT / THCS',
  examTitleOverride: '',
  headerNote: 'Không sử dụng tài liệu khi làm bài.',
  footerNote: 'Thí sinh không viết vào phần đề thi trừ khi giáo viên cho phép.',
  paperMarginMm: 15,
  fontFamily: 'Times New Roman',
  includeAnswerKey: true,
  includeAnswerMatrix: true,
  includeMappingTable: true,
  includeIntegritySummary: true,
  separateAnswerKeySection: true,
};

export function resolveExportSettings(exam: MathExamProject): ExamExportSettings {
  return {
    ...DEFAULT_EXAM_EXPORT_SETTINGS,
    ...(exam.exportSettings ?? {}),
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SUBSCRIPT_TO_ASCII: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '₊': '+',
  '₋': '-',
  '₌': '=',
  '₍': '(',
  '₎': ')',
};

const SUPERSCRIPT_TO_ASCII: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁺': '+',
  '⁻': '-',
  '⁼': '=',
  '⁽': '(',
  '⁾': ')',
};

function renderStyledRunsXml(
  text: string,
  options?: { bold?: boolean; italic?: boolean; sizeHalfPt?: number; fontFamily?: string; color?: string }
): string {
  const font = escapeXml(options?.fontFamily ?? 'Times New Roman');
  const sz = options?.sizeHalfPt ?? 24; // 12pt
  const baseProps = [
    `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`,
    `<w:sz w:val="${sz}"/>`,
    `<w:szCs w:val="${sz}"/>`,
    options?.bold ? '<w:b/>' : '',
    options?.italic ? '<w:i/>' : '',
    options?.color ? `<w:color w:val="${escapeXml(options.color)}"/>` : '',
  ]
    .filter(Boolean)
    .join('');

  const lines = text.split('\n');
  const runs: string[] = [];

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) {
      runs.push(`<w:r><w:rPr>${baseProps}</w:rPr><w:br/></w:r>`);
    }
    let idx = 0;
    while (idx < line.length) {
      const ch = line[idx];
      if (SUBSCRIPT_TO_ASCII[ch]) {
        let chunk = '';
        while (idx < line.length && SUBSCRIPT_TO_ASCII[line[idx]]) {
          chunk += SUBSCRIPT_TO_ASCII[line[idx]];
          idx += 1;
        }
        runs.push(
          `<w:r><w:rPr>${baseProps}<w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">${escapeXml(
            chunk
          )}</w:t></w:r>`
        );
        continue;
      }
      if (SUPERSCRIPT_TO_ASCII[ch]) {
        let chunk = '';
        while (idx < line.length && SUPERSCRIPT_TO_ASCII[line[idx]]) {
          chunk += SUPERSCRIPT_TO_ASCII[line[idx]];
          idx += 1;
        }
        runs.push(
          `<w:r><w:rPr>${baseProps}<w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">${escapeXml(
            chunk
          )}</w:t></w:r>`
        );
        continue;
      }
      let plain = '';
      while (
        idx < line.length &&
        !SUBSCRIPT_TO_ASCII[line[idx]] &&
        !SUPERSCRIPT_TO_ASCII[line[idx]]
      ) {
        plain += line[idx];
        idx += 1;
      }
      if (plain) {
        runs.push(
          `<w:r><w:rPr>${baseProps}</w:rPr><w:t xml:space="preserve">${escapeXml(plain)}</w:t></w:r>`
        );
      }
    }
  });

  if (runs.length === 0) {
    return `<w:r><w:rPr>${baseProps}</w:rPr><w:t xml:space="preserve"></w:t></w:r>`;
  }
  return runs.join('');
}

function makeParagraphXml(
  runsXml: string,
  opts?: {
    align?: 'left' | 'center' | 'right' | 'both';
    spacingBefore?: number;
    spacingAfter?: number;
    lineTwips?: number;
    indentLeft?: number;
    keepNext?: boolean;
    tabStopsTwips?: number[];
  }
): string {
  const pPr: string[] = [];
  if (opts?.align) pPr.push(`<w:jc w:val="${opts.align}"/>`);
  const lineAttr =
    opts?.lineTwips && opts.lineTwips > 0
      ? ` w:line="${Math.round(opts.lineTwips)}" w:lineRule="auto"`
      : '';
  if (opts?.spacingBefore !== undefined || opts?.spacingAfter !== undefined || lineAttr) {
    pPr.push(
      `<w:spacing w:before="${opts?.spacingBefore ?? 0}" w:after="${opts?.spacingAfter ?? 80}"${lineAttr}/>`
    );
  } else {
    pPr.push('<w:spacing w:before="0" w:after="80"/>');
  }
  if (opts?.indentLeft) {
    pPr.push(`<w:ind w:left="${opts.indentLeft}"/>`);
  }
  if (opts?.tabStopsTwips && opts.tabStopsTwips.length > 0) {
    const tabs = opts.tabStopsTwips
      .map((pos) => `<w:tab w:val="left" w:pos="${Math.round(pos)}"/>`)
      .join('');
    pPr.push(`<w:tabs>${tabs}</w:tabs>`);
  }
  if (opts?.keepNext) {
    pPr.push('<w:keepNext/>');
  }
  return `<w:p>${pPr.length > 0 ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${runsXml}</w:p>`;
}

interface EmbeddedMediaEntry {
  relId: string;
  target: string; // relative to word/, e.g. media/img-1.png
  ext: string;
  mime: string;
  bytes: Uint8Array;
  docPrId: number;
  name: string;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseDataUrlAsset(
  asset: MathVisualAsset,
  mediaList: EmbeddedMediaEntry[],
  nextIdOffset: number
): EmbeddedMediaEntry | null {
  const src = asset.sourceData.trim();
  if (!src) return null;

  if (src.startsWith('<svg') || src.toLowerCase().includes('<svg')) {
    const cleanSvg = sanitizeSvgSource(src);
    const bytes = new TextEncoder().encode(cleanSvg);
    const idx = mediaList.length + 1;
    const entry: EmbeddedMediaEntry = {
      relId: `rIdImg${idx}`,
      target: `media/img-${idx}.svg`,
      ext: 'svg',
      mime: 'image/svg+xml',
      bytes,
      docPrId: nextIdOffset + idx,
      name: asset.label || `figure-${idx}.svg`,
    };
    mediaList.push(entry);
    return entry;
  }

  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(src);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const base64 = m[2].replace(/\s+/g, '');
  let ext = 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpeg';
  else if (mime.includes('gif')) ext = 'gif';
  else if (mime.includes('webp')) ext = 'webp';
  else if (mime.includes('svg')) ext = 'svg';

  const bytes = decodeBase64ToBytes(base64);
  const idx = mediaList.length + 1;
  const entry: EmbeddedMediaEntry = {
    relId: `rIdImg${idx}`,
    target: `media/img-${idx}.${ext}`,
    ext,
    mime,
    bytes,
    docPrId: nextIdOffset + idx,
    name: asset.label || `image-${idx}.${ext}`,
  };
  mediaList.push(entry);
  return entry;
}

function makeDrawingRunXml(media: EmbeddedMediaEntry, cx: number, cy: number): string {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${media.docPrId}" name="${escapeXml(
    media.name
  )}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${media.docPrId}" name="${escapeXml(
    media.name
  )}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${media.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function getSvgPreview(source: string): string | undefined {
  const text = source.trim();
  if (text.startsWith('<svg')) return sanitizeSvgSource(text);
  const encoded = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/.exec(text)?.[1];
  if (!encoded) return undefined;
  const svg = new TextDecoder().decode(decodeBase64ToBytes(encoded)).trim();
  return svg.startsWith('<svg') ? sanitizeSvgSource(svg) : undefined;
}

function getPreviewSize(svg: string): { width: number; height: number } {
  const width = Number(/<svg\b[^>]*\bwidth="([\d.]+)"/i.exec(svg)?.[1]);
  const height = Number(/<svg\b[^>]*\bheight="([\d.]+)"/i.exec(svg)?.[1]);
  return width > 0 && height > 0 ? { width, height } : { width: 60, height: 24 };
}

function makeWordTableXml(rows: string[][], fontFamily: string, headerRow = false): string {
  if (rows.length === 0) return '';
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const cellWidth = Math.floor(9000 / colCount);
  const trs = rows
    .map((row, rIdx) => {
      const cells = Array.from({ length: colCount }, (_, cIdx) => {
        const text = row[cIdx] ?? '';
        const isHdr = headerRow && rIdx === 0;
        return `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/>${
          isHdr ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : ''
        }</w:tcPr>${makeParagraphXml(
          renderStyledRunsXml(text, { bold: isHdr, sizeHalfPt: 22, fontFamily }),
          { spacingBefore: 20, spacingAfter: 20 }
        )}</w:tc>`;
      }).join('');
      return `<w:tr>${cells}</w:tr>`;
    })
    .join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders></w:tblPr>${trs}</w:tbl>`;
}

function appendVisualAssetToBody(
  bodyChunks: string[],
  asset: MathVisualAsset,
  mediaList: EmbeddedMediaEntry[],
  fontFamily: string
): void {
  if (asset.kind === 'data-table') {
    const tableRows = asset.sourceData
      .split('\n')
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .filter((cells) => cells.some(Boolean));
    if (tableRows.length > 0) {
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(asset.label, { italic: true, sizeHalfPt: 20, fontFamily, color: '475569' }),
          { spacingBefore: 40, spacingAfter: 20 }
        )
      );
      bodyChunks.push(makeWordTableXml(tableRows, fontFamily, true));
      return;
    }
  }

  const media = parseDataUrlAsset(asset, mediaList, 100);
  if (media) {
    bodyChunks.push(makeParagraphXml(makeDrawingRunXml(media, 4114800, 2377440), {
      align: 'center', spacingBefore: 40, spacingAfter: 80,
    }));
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml(asset.label, { italic: true, sizeHalfPt: 20, fontFamily, color: '475569' }),
        { align: 'center', spacingBefore: 0, spacingAfter: 60 }
      )
    );
  } else if (asset.sourceData.trim()) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml(`[Hình/Bảng: ${asset.label}]`, {
          italic: true,
          sizeHalfPt: 20,
          fontFamily,
          color: '475569',
        }),
        { spacingBefore: 20, spacingAfter: 40 }
      )
    );
  }
}

function formatContentPayloadForText(payload: MathContentPayload): string {
  return payload.rawSource ?? '';
}

function renderStudentQuestionXml(
  q: MathQuestion,
  qNumber: number,
  bodyChunks: string[],
  mediaList: EmbeddedMediaEntry[],
  fontFamily: string,
  formOptions?: {
    numberPrefix?: string;
    showPoints?: boolean;
    optionLabelStyle?: 'dot' | 'paren';
    optionLayout?: ExamOptionLayout;
    formTemplate?: ExamFormTemplate;
    sizeHalfPt?: number;
    questionSpacingBefore?: number;
    paragraphSpacingAfter?: number;
    lineTwips?: number;
    bodyAlignment?: ExamBodyAlignment;
    shortAnswerBoxStyle?: ExamShortAnswerBoxStyle;
    shortAnswerBlankLines?: number;
    essayAnswerLines?: number;
    essayLineStyle?: ExamEssayLineStyle;
  }
): void {
  const uType = getUniversalQuestionType(q);
  const prefix = formOptions?.numberPrefix?.trim() || 'Câu';
  const sz = formOptions?.sizeHalfPt ?? 24;
  const optPunct = formOptions?.optionLabelStyle === 'paren' ? ')' : '.';
  const bodyAlign = formOptions?.bodyAlignment === 'justify' ? 'both' : undefined;
  const lineTwips = formOptions?.lineTwips;
  const paraAfter = formOptions?.paragraphSpacingAfter ?? 40;
  const pointsSuffix =
    formOptions?.showPoints && typeof q.points === 'number' && q.points > 0
      ? ` (${q.points} điểm)`
      : '';

  const optionAssets = [...(q.options ?? []), ...(q.multiSelectOptions ?? [])]
    .flatMap((option) => option.visualAsset ? [option.visualAsset] : []);
  const assets = new Map([...(q.visualAssets ?? []), ...optionAssets].map((asset) => [asset.id, asset]));
  const usedInline = new Set<string>();
  const renderContent = (payload: MathContentPayload): string => {
    if (!payload.blocks.some((block) => block.inlineFormulaAssetId)) {
      return renderStyledRunsXml(formatContentPayloadForText(payload), { fontFamily, sizeHalfPt: sz });
    }
    return payload.blocks.map((block) => {
      if (!block.inlineFormulaAssetId) {
        const text = block.kind === 'latex'
          ? (block.displayMode ? '$$' : '$') + block.content + (block.displayMode ? '$$' : '$')
          : block.content;
        return renderStyledRunsXml(text, { fontFamily, sizeHalfPt: sz });
      }
      const asset = assets.get(block.inlineFormulaAssetId);
      if (!asset) throw new Error(`Câu ${qNumber} thiếu hình công thức ${block.inlineFormulaAssetId}.`);
      const media = parseDataUrlAsset(asset, mediaList, 100);
      if (!media) throw new Error(`Câu ${qNumber} thiếu hình công thức ${block.inlineFormulaAssetId}.`);
      usedInline.add(asset.id);
      const { width, height } = getPreviewSize(getSvgPreview(block.content) ?? '');
      const scale = Math.min(1, 450 / width, 62 / height) * 9525;
      return makeDrawingRunXml(media, Math.round(width * scale), Math.round(height * scale));
    }).join('');
  };

  // Stem line — TUYỆT ĐỐI không in đáp án hay giải thích vào đề học sinh
  const pointsRuns = pointsSuffix
    ? renderStyledRunsXml(`${pointsSuffix.trim()} `, {
        italic: true,
        fontFamily,
        sizeHalfPt: Math.max(20, sz - 2),
        color: '475569',
      })
    : '';
  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml(`${prefix} ${qNumber}: `, {
        bold: true,
        fontFamily,
        sizeHalfPt: sz,
      }) +
        pointsRuns +
        renderContent(q.stem),
      {
        align: bodyAlign,
        spacingBefore: formOptions?.questionSpacingBefore ?? 100,
        spacingAfter: paraAfter,
        lineTwips,
      }
    )
  );

  const inlineIds = new Set(
    [q.stem, ...(q.options ?? []).map((opt) => opt.content),
      ...(q.multiSelectOptions ?? []).map((opt) => opt.content),
      ...(q.statements ?? []).map((stmt) => stmt.content)]
      .flatMap((payload) => payload.blocks.flatMap((block) => block.inlineFormulaAssetId ? [block.inlineFormulaAssetId] : []))
  );
  for (const asset of q.visualAssets ?? []) {
    if (!inlineIds.has(asset.id)) appendVisualAssetToBody(bodyChunks, asset, mediaList, fontFamily);
  }

  if (uType === 'multi-select') {
    const opts = q.multiSelectOptions ?? q.options ?? [];
    opts.forEach((opt, oIdx) => {
      const lbl = getOptionLetterLabel(oIdx);
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`${lbl}${optPunct} `, { bold: true, fontFamily, sizeHalfPt: sz }) +
            renderContent(opt.content),
          { indentLeft: 360, spacingBefore: 20, spacingAfter: 20, lineTwips }
        )
      );
      if (opt.visualAsset && !usedInline.has(opt.visualAsset.id)) {
        appendVisualAssetToBody(bodyChunks, opt.visualAsset, mediaList, fontFamily);
      }
    });
  } else if (q.type === 'mcq' && q.options) {
    const hasOptionVisual = q.options.some((o) => Boolean(o.visualAsset));
    const resolvedGrid: '1-col' | '2-col' | '4-col' = hasOptionVisual
      ? '1-col'
      : formOptions?.formTemplate
        ? resolveAutoOptionLayout(q, formOptions.formTemplate)
        : formOptions?.optionLayout === '4-col'
          ? '4-col'
          : formOptions?.optionLayout === '2-col'
            ? '2-col'
            : '1-col';

    if (resolvedGrid === '4-col' && q.options.length === 4) {
      const rowRuns = q.options
        .map((opt, oIdx) => {
          const lbl = MCQ_LABELS[oIdx] ?? getOptionLetterLabel(oIdx);
          const sep = oIdx > 0 ? '<w:r><w:tab/></w:r>' : '';
          return (
            sep +
            renderStyledRunsXml(`${lbl}${optPunct} `, { bold: true, fontFamily, sizeHalfPt: sz }) +
            renderContent(opt.content)
          );
        })
        .join('');
      bodyChunks.push(
        makeParagraphXml(rowRuns, {
          indentLeft: 360,
          spacingBefore: 20,
          spacingAfter: 20,
          lineTwips,
          tabStopsTwips: [2520, 4680, 6840],
        })
      );
    } else if (resolvedGrid === '2-col' && q.options.length >= 2) {
      for (let rowStart = 0; rowStart < q.options.length; rowStart += 2) {
        const pair = q.options.slice(rowStart, rowStart + 2);
        const rowRuns = pair
          .map((opt, localIdx) => {
            const oIdx = rowStart + localIdx;
            const lbl = MCQ_LABELS[oIdx] ?? getOptionLetterLabel(oIdx);
            const sep = localIdx > 0 ? '<w:r><w:tab/></w:r>' : '';
            return (
              sep +
              renderStyledRunsXml(`${lbl}${optPunct} `, { bold: true, fontFamily, sizeHalfPt: sz }) +
              renderContent(opt.content)
            );
          })
          .join('');
        bodyChunks.push(
          makeParagraphXml(rowRuns, {
            indentLeft: 360,
            spacingBefore: 20,
            spacingAfter: 20,
            lineTwips,
            tabStopsTwips: [4680],
          })
        );
      }
    } else {
      q.options.forEach((opt, oIdx) => {
        const lbl = MCQ_LABELS[oIdx] ?? getOptionLetterLabel(oIdx);
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(`${lbl}${optPunct} `, { bold: true, fontFamily, sizeHalfPt: sz }) +
              renderContent(opt.content),
            { indentLeft: 360, spacingBefore: 20, spacingAfter: 20, lineTwips }
          )
        );
        if (opt.visualAsset && !usedInline.has(opt.visualAsset.id)) {
          appendVisualAssetToBody(bodyChunks, opt.visualAsset, mediaList, fontFamily);
        }
      });
    }
  } else if (q.type === 'true-false' && q.statements) {
    q.statements.forEach((st, sIdx) => {
      const lbl = TF_LABELS[sIdx] ?? getStatementLetterLabel(sIdx);
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`${lbl}) `, { bold: true, fontFamily, sizeHalfPt: sz }) +
            renderContent(st.content),
          { indentLeft: 360, spacingBefore: 20, spacingAfter: 20, lineTwips }
        )
      );
    });
  } else if (q.type === 'short-answer') {
    const boxStyle = formOptions?.shortAnswerBoxStyle ?? 'none';
    const blankLines = Math.max(0, Math.min(4, formOptions?.shortAnswerBlankLines ?? 0));
    if (boxStyle === 'box') {
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml('Đáp số: [ .............................. ]', {
            italic: true,
            fontFamily,
            sizeHalfPt: Math.max(20, sz - 2),
            color: '475569',
          }),
          { indentLeft: 360, spacingBefore: 30, spacingAfter: 40, lineTwips }
        )
      );
    } else if (boxStyle === 'dotted-line' && blankLines > 0) {
      for (let i = 0; i < blankLines; i++) {
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(
              i === 0
                ? 'Trả lời: ........................................................................'
                : '....................................................................................',
              {
                fontFamily,
                sizeHalfPt: Math.max(20, sz - 2),
                color: '64748B',
              }
            ),
            { indentLeft: 360, spacingBefore: 20, spacingAfter: 30, lineTwips }
          )
        );
      }
    }
  } else if (uType === 'fill-blank' && q.fillBlank?.wordBank && q.fillBlank.wordBank.length > 0) {
    const bankLine = q.fillBlank.wordBank
      .map((w, idx) => `${getOptionLetterLabel(idx)}. ${formatContentPayloadForText(w.content)}`)
      .join('    ');
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml('Ngân hàng từ gợi ý: ', { italic: true, fontFamily, sizeHalfPt: sz }) +
          renderStyledRunsXml(bankLine, { fontFamily, sizeHalfPt: sz }),
        { indentLeft: 360, spacingBefore: 20, spacingAfter: 40, lineTwips }
      )
    );
  } else if (uType === 'matching' && q.matching) {
    const left = q.matching.leftItems;
    const right = q.matching.rightItems;
    const maxLen = Math.max(left.length, right.length);
    const tblRows: string[][] = [['Cột A', 'Cột B']];
    for (let i = 0; i < maxLen; i++) {
      const lText = left[i] ? `${left[i].originalLabel || i + 1}. ${formatContentPayloadForText(left[i].content)}` : '';
      const rText = right[i]
        ? `${getStatementLetterLabel(i)}. ${formatContentPayloadForText(right[i].content)}`
        : '';
      tblRows.push([lText, rText]);
    }
    bodyChunks.push(makeWordTableXml(tblRows, fontFamily, true));
  } else if (uType === 'ordering' && q.ordering) {
    const usesNumeric = q.ordering.items.every((it) => /^\d+$/.test(it.originalLabel.trim()));
    q.ordering.items.forEach((item, idx) => {
      const lbl = usesNumeric ? `${idx + 1}.` : `${getStatementLetterLabel(idx)}.`;
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`${lbl} `, { bold: true, fontFamily, sizeHalfPt: sz }) +
            renderStyledRunsXml(formatContentPayloadForText(item.content), { fontFamily, sizeHalfPt: sz }),
          { indentLeft: 360, spacingBefore: 20, spacingAfter: 20, lineTwips }
        )
      );
    });
  } else if (q.type === 'essay') {
    if (q.essayParts && q.essayParts.length > 0) {
      q.essayParts.forEach((part) => {
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(`${part.label} (${part.points} điểm) `, { bold: true, fontFamily, sizeHalfPt: sz }) +
              renderStyledRunsXml(formatContentPayloadForText(part.content), { fontFamily, sizeHalfPt: sz }),
            { indentLeft: 360, spacingBefore: 20, spacingAfter: 20, lineTwips }
          )
        );
      });
    }
    const essayLines = Math.max(0, Math.min(12, formOptions?.essayAnswerLines ?? 0));
    const lineStyle = formOptions?.essayLineStyle ?? 'dotted';
    if (essayLines > 0 && lineStyle !== 'blank') {
      const lineStr =
        lineStyle === 'lined'
          ? '__________________________________________________________________________'
          : '................................................................................................';
      for (let i = 0; i < essayLines; i++) {
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(lineStr, {
              fontFamily,
              sizeHalfPt: Math.max(20, sz - 2),
              color: '94A3B8',
            }),
            { indentLeft: 360, spacingBefore: 30, spacingAfter: 30 }
          )
        );
      }
    }
  }
}

async function packageOoxmlDocxBuffer(params: {
  bodyXml: string;
  mediaList: EmbeddedMediaEntry[];
  marginMm: 10 | 15 | 20;
  marginsMm?: { top: number; right: number; bottom: number; left: number };
  orientation?: 'portrait' | 'landscape';
  fontFamily: string;
  fontSizePt?: number;
  columns?: 1 | 2;
  showPageNumbers?: boolean;
  pageNumberFormat?: ExamPageNumberFormat;
  footerLabelText?: string;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  const topTwips = Math.round((params.marginsMm?.top ?? params.marginMm) * 56.7);
  const rightTwips = Math.round((params.marginsMm?.right ?? params.marginMm) * 56.7);
  const bottomTwips = Math.round((params.marginsMm?.bottom ?? params.marginMm) * 56.7);
  const leftTwips = Math.round((params.marginsMm?.left ?? params.marginMm) * 56.7);
  const isLandscape = params.orientation === 'landscape';
  const pgSzXml = isLandscape
    ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/>';
  const colsXml = params.columns === 2 ? '<w:cols w:num="2" w:space="420"/>' : '';
  const defaultHalfPt = Math.round((params.fontSizePt ?? 12) * 2);
  const includeFooterPart = Boolean(params.showPageNumbers || params.footerLabelText?.trim());

  const mediaExts = Array.from(new Set(params.mediaList.map((m) => m.ext)));
  const extMimeMap: Record<string, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${mediaExts
    .map((ext) => `<Default Extension="${ext}" ContentType="${extMimeMap[ext] ?? 'application/octet-stream'}"/>`)
    .join('\n  ')}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  ${includeFooterPart ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  ${includeFooterPart ? '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : ''}
  ${params.mediaList
    .map(
      (m) =>
        `<Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.target}"/>`
    )
    .join('\n  ')}
</Relationships>`;

  const safeFont = escapeXml(params.fontFamily);
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="${safeFont}" w:hAnsi="${safeFont}" w:cs="${safeFont}"/>
        <w:sz w:val="${defaultHalfPt}"/>
        <w:szCs w:val="${defaultHalfPt}"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`;

  const footerRefXml = includeFooterPart
    ? '<w:footerReference w:type="default" r:id="rIdFooter1"/>'
    : '';

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    ${params.bodyXml}
    <w:sectPr>
      ${footerRefXml}
      ${pgSzXml}
      <w:pgMar w:top="${topTwips}" w:right="${rightTwips}" w:bottom="${bottomTwips}" w:left="${leftTwips}" w:header="708" w:footer="708" w:gutter="0"/>
      ${colsXml}
    </w:sectPr>
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);
  zip.file('word/styles.xml', stylesXml);
  zip.file('word/document.xml', documentXml);

  if (includeFooterPart) {
    const labelRuns = params.footerLabelText?.trim()
      ? renderStyledRunsXml(`${params.footerLabelText.trim()}   `, {
          italic: true,
          sizeHalfPt: 18,
          fontFamily: params.fontFamily,
          color: '64748B',
        })
      : '';
    const pageRuns = params.showPageNumbers
      ? renderStyledRunsXml('Trang ', {
          sizeHalfPt: 18,
          fontFamily: params.fontFamily,
          color: '475569',
        }) +
        `<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>` +
        (params.pageNumberFormat !== 'page-only'
          ? renderStyledRunsXml(' / ', {
              sizeHalfPt: 18,
              fontFamily: params.fontFamily,
              color: '475569',
            }) + `<w:fldSimple w:instr="NUMPAGES"><w:r><w:t>1</w:t></w:r></w:fldSimple>`
          : '')
      : '';

    const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${makeParagraphXml(labelRuns + pageRuns, { align: 'right', spacingBefore: 0, spacingAfter: 0 })}
</w:ftr>`;
    zip.file('word/footer1.xml', footerXml);
  }

  for (const media of params.mediaList) {
    zip.file(`word/${media.target}`, media.bytes);
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * Tạo file Word (.docx) đề thi dành riêng cho HỌC SINH cho một mã đề cụ thể.
 * Đảm bảo 0% rò rỉ đáp án hoặc lời giải.
 */
async function renderStudentExamDocxInternal(params: {
  exam: MathExamProject;
  version: MixedExamVersion;
  formTemplate?: ExamFormTemplate;
  draftBannerText?: string;
  includeSolutionsFromSource?: boolean;
}): Promise<Uint8Array> {
  const { exam, version, formTemplate, draftBannerText, includeSolutionsFromSource } = params;

  for (const q of version.questions) {
    const graphBinding = verifyDynamicGraphBinding({ question: q });
    if (!graphBinding.valid) {
      throw new Error(
        graphBinding.reason ?? 'BLOCK EXPORT — STALE GRAPH DATA'
      );
    }
  }

  const settings = resolveExportSettings(exam);
  const subjectProfile = getSubjectProfile(resolveSubjectId(exam.subjectId || exam.subject));
  const placeholderCtx = formTemplate
    ? buildPlaceholderContext(exam, version, formTemplate)
    : {
        departmentName: settings.departmentName,
        schoolName: settings.schoolName,
        subjectGroupName: '',
        examTitle: settings.examTitleOverride.trim() || exam.title,
        subject: subjectProfile.name,
        grade: exam.grade,
        duration: `${exam.durationMinutes} phút`,
        schoolYear: exam.schoolYear,
        examCode: version.code,
      };
  const resolveHdr = (s: string) => resolveExamFormPlaceholders(s, placeholderCtx);

  const examTitle = resolveHdr(
    formTemplate?.headerSettings.examTitle.trim() ||
      settings.examTitleOverride.trim() ||
      exam.title
  );
  const departmentName = resolveHdr(
    formTemplate?.headerSettings.departmentName.trim() || settings.departmentName
  );
  const schoolName = resolveHdr(
    formTemplate?.headerSettings.schoolName.trim() || settings.schoolName
  );
  const subjectGroupName = resolveHdr(formTemplate?.headerSettings.subjectGroupName.trim() || '');
  const schoolYear = resolveHdr(formTemplate?.headerSettings.schoolYear.trim() || exam.schoolYear);
  const subjectDisplay = resolveHdr(
    formTemplate?.headerSettings.subjectOverride.trim() || subjectProfile.name
  );
  const gradeDisplay = resolveHdr(formTemplate?.headerSettings.gradeOverride.trim() || exam.grade);
  const durationDisplay =
    formTemplate?.headerSettings.durationOverrideMinutes ?? exam.durationMinutes;
  const showExamCode = formTemplate ? formTemplate.headerSettings.showExamCode : true;
  const showQuestionCountSubtitle = formTemplate
    ? formTemplate.headerSettings.showQuestionCountSubtitle
    : true;
  const headerNoteText = resolveHdr(
    formTemplate ? formTemplate.headerSettings.headerNote : settings.headerNote
  );
  const fontFamily = formTemplate?.pageSettings.fontFamily || settings.fontFamily;
  const fontSizePt = formTemplate?.pageSettings.fontSizePt ?? 12;
  const sizeHalfPt = Math.round(fontSizePt * 2);
  const lineTwips = formTemplate
    ? Math.round((formTemplate.pageSettings.lineHeight || 1.4) * 240)
    : undefined;
  const paragraphSpacingAfter = formTemplate?.pageSettings.paragraphSpacingPt
    ? Math.round(formTemplate.pageSettings.paragraphSpacingPt * 20)
    : 40;
  const questionSpacingBefore = formTemplate
    ? Math.max(60, Math.round(formTemplate.pageSettings.questionSpacingPx * 9))
    : 100;
  const bodyChunks: string[] = [];
  const mediaList: EmbeddedMediaEntry[] = [];

  // In browser environments, rasterize dynamic SVG graphs/variation tables to crisp PNG
  // for universal Microsoft Word compatibility (in Node tests, clean SVG fallback is preserved).
  const preparedQuestions: MathQuestion[] = await Promise.all(
    version.questions.map(async (origQ) => {
      if (typeof window === 'undefined') return origQ;
      const rasterizeAsset = async (asset: MathVisualAsset): Promise<MathVisualAsset> => {
        const svg = getSvgPreview(asset.sourceData);
        if (!svg) return asset;
        const isBbt = asset.kind === 'variation-table';
        const formulaSize = asset.id.startsWith('docx-ole-svg-') ? getPreviewSize(svg) : undefined;
        const png = await convertSvgToPngDataUrl(
          svg,
          formulaSize ? formulaSize.width * 2 : isBbt ? 520 : 480,
          formulaSize ? formulaSize.height * 2 : isBbt ? 180 : 310
        );
        if (!png && asset.id.startsWith('docx-ole-svg-')) {
          throw new Error(`Không thể chuyển hình công thức ${asset.label} khi xuất Word.`);
        }
        return png ? { ...asset, sourceData: png } : asset;
      };
      const nextVisualAssets = origQ.visualAssets
        ? await Promise.all(origQ.visualAssets.map(rasterizeAsset))
        : origQ.visualAssets;
      const nextOptions = origQ.options
        ? await Promise.all(
            origQ.options.map(async (opt) =>
              opt.visualAsset
                ? { ...opt, visualAsset: await rasterizeAsset(opt.visualAsset) }
                : opt
            )
          )
        : origQ.options;
      const nextMultiSelectOptions = origQ.multiSelectOptions
        ? await Promise.all(origQ.multiSelectOptions.map(async (opt) => opt.visualAsset
            ? { ...opt, visualAsset: await rasterizeAsset(opt.visualAsset) }
            : opt))
        : origQ.multiSelectOptions;
      return {
        ...origQ,
        visualAssets: nextVisualAssets,
        options: nextOptions,
        multiSelectOptions: nextMultiSelectOptions,
      };
    })
  );

  // Optional School Logo embedded cleanly in word/media/ (never affects question media)
  let logoDrawingParagraph = '';
  const logoDataUrl = formTemplate?.headerSettings.schoolLogoDataUrl?.trim();
  if (logoDataUrl) {
    const logoAsset: MathVisualAsset = {
      id: 'school-brand-logo',
      kind: 'image',
      label: 'school-logo',
      sourceData: logoDataUrl,
      altText: schoolName,
      required: false,
      checksum: computeContentHash(logoDataUrl),
    };
    const logoMedia = parseDataUrlAsset(logoAsset, mediaList, 50);
    if (logoMedia) {
      const logoPx = Math.max(28, Math.min(96, formTemplate?.headerSettings.schoolLogoWidthPx ?? 52));
      const logoEmu = Math.round(logoPx * 9525);
      logoDrawingParagraph = makeParagraphXml(makeDrawingRunXml(logoMedia, logoEmu, logoEmu), {
        align: 'center',
        spacingBefore: 0,
        spacingAfter: 30,
      });
    }
  }

  // Banner Header Table (2 cột: Đơn vị + Thông tin đề & Mã đề)
  const leftLines = [
    departmentName,
    schoolName,
    subjectGroupName || null,
    showQuestionCountSubtitle ? `(Đề thi gồm ${version.questions.length} câu hỏi)` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const rightLines = [
    examTitle.toUpperCase(),
    `Năm học: ${schoolYear} · Môn: ${subjectDisplay} · ${gradeDisplay}`,
    `Thời gian làm bài: ${durationDisplay} phút`,
    showExamCode ? `MÃ ĐỀ: ${version.code}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  if (logoDrawingParagraph) {
    const leftCell = `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${logoDrawingParagraph}${makeParagraphXml(
      renderStyledRunsXml(leftLines, { sizeHalfPt: 22, fontFamily }),
      { align: 'center', spacingBefore: 20, spacingAfter: 20 }
    )}</w:tc>`;
    const rightCell = `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${makeParagraphXml(
      renderStyledRunsXml(rightLines, { bold: true, sizeHalfPt: 22, fontFamily }),
      { align: 'center', spacingBefore: 20, spacingAfter: 20 }
    )}</w:tc>`;
    bodyChunks.push(
      `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders></w:tblPr><w:tr>${leftCell}${rightCell}</w:tr></w:tbl>`
    );
  } else {
    const headerTableRows = [[leftLines, rightLines]];
    bodyChunks.push(makeWordTableXml(headerTableRows, fontFamily, false));
  }

  if (draftBannerText) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml(draftBannerText, {
          bold: true,
          sizeHalfPt: 22,
          fontFamily,
          color: 'B45309',
        }),
        { align: 'center', spacingBefore: 80, spacingAfter: 80 }
      )
    );
  }

  const studentInfoLine = formTemplate
    ? buildStudentInfoLine(formTemplate)
    : 'Họ và tên thí sinh: ........................................................   Số báo danh: ........................';

  if (studentInfoLine) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml(studentInfoLine, {
          fontFamily,
          sizeHalfPt: Math.max(20, sizeHalfPt - 2),
        }),
        { spacingBefore: 100, spacingAfter: 60 }
      )
    );
  }
  if (headerNoteText.trim()) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml(headerNoteText, {
          italic: true,
          sizeHalfPt: Math.max(18, sizeHalfPt - 4),
          fontFamily,
          color: '475569',
        }),
        { spacingBefore: 0, spacingAfter: 80 }
      )
    );
  }

  const groupMap = new Map<string, QuestionGroup>(
    (exam.questionGroups ?? []).map((g) => [g.id, g])
  );
  const renderedGroups = new Set<string>();
  let currentSection = '';
  const showSectionTitles = formTemplate ? formTemplate.bodySettings.showSectionTitles : true;

  preparedQuestions.forEach((q, idx) => {
    if (showSectionTitles && q.sectionTitle && q.sectionTitle !== currentSection) {
      currentSection = q.sectionTitle;
      let endIdx = idx;
      while (
        endIdx + 1 < preparedQuestions.length &&
        preparedQuestions[endIdx + 1].sectionTitle === currentSection
      ) {
        endIdx += 1;
      }
      const verifiedHeading = formatVerifiedSectionHeading(
        currentSection,
        idx + 1,
        endIdx + 1,
        endIdx - idx + 1
      );
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(verifiedHeading, { bold: true, sizeHalfPt, fontFamily }),
          { spacingBefore: 140, spacingAfter: 40, keepNext: true }
        )
      );
      if (
        formTemplate?.bodySettings.showSectionInstructions &&
        formTemplate.bodySettings.sectionInstructionsOverride.trim()
      ) {
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(formTemplate.bodySettings.sectionInstructionsOverride.trim(), {
              italic: true,
              sizeHalfPt: Math.max(18, sizeHalfPt - 2),
              fontFamily,
              color: '475569',
            }),
            { spacingBefore: 0, spacingAfter: 60, keepNext: true }
          )
        );
      }
    }

    if (q.groupId && !renderedGroups.has(q.groupId) && groupMap.has(q.groupId)) {
      renderedGroups.add(q.groupId);
      const grp = groupMap.get(q.groupId)!;
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`[Ngữ liệu nhóm] ${grp.title}`, {
            bold: true,
            italic: true,
            sizeHalfPt: Math.max(20, sizeHalfPt - 2),
            fontFamily,
            color: '1E3A8A',
          }),
          { spacingBefore: 100, spacingAfter: 30 }
        )
      );
      if (grp.sharedContext.rawSource.trim()) {
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(grp.sharedContext.rawSource, {
              fontFamily,
              sizeHalfPt: Math.max(20, sizeHalfPt - 2),
            }),
            { indentLeft: 180, spacingBefore: 20, spacingAfter: 60 }
          )
        );
      }
      for (const sAsset of grp.sharedAssets) {
        appendVisualAssetToBody(bodyChunks, sAsset, mediaList, fontFamily);
      }
    }

    renderStudentQuestionXml(
      q,
      idx + 1,
      bodyChunks,
      mediaList,
      fontFamily,
      formTemplate
        ? {
            numberPrefix: formTemplate.bodySettings.questionNumberPrefix,
            showPoints: formTemplate.bodySettings.showPointsPerQuestion,
            optionLabelStyle: formTemplate.bodySettings.optionLabelStyle,
            optionLayout: formTemplate.bodySettings.optionLayout,
            formTemplate,
            sizeHalfPt,
            questionSpacingBefore,
            paragraphSpacingAfter,
            lineTwips,
            bodyAlignment: formTemplate.pageSettings.bodyAlignment,
            shortAnswerBoxStyle: formTemplate.bodySettings.shortAnswerBoxStyle,
            shortAnswerBlankLines: formTemplate.bodySettings.shortAnswerBlankLines,
            essayAnswerLines: formTemplate.bodySettings.essayAnswerLines,
            essayLineStyle: formTemplate.bodySettings.essayLineStyle,
          }
        : undefined
    );
  });

  const showEndMarker = formTemplate ? formTemplate.footerSettings.showEndMarker : true;
  const endMarkerText = resolveHdr(
    formTemplate?.footerSettings.endMarkerText.trim() || '——— HẾT ———'
  );
  if (showEndMarker) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml(endMarkerText, { bold: true, fontFamily, sizeHalfPt }),
        { align: 'center', spacingBefore: 160, spacingAfter: 40 }
      )
    );
  }

  const footerNoteText = resolveHdr(
    formTemplate ? formTemplate.footerSettings.footerNote : settings.footerNote
  );
  const footerSummary = [
    footerNoteText.trim() || null,
    formTemplate?.footerSettings.showCodeInFooter && showExamCode
      ? `Mã đề ${version.code}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (footerSummary) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml(footerSummary, {
          italic: true,
          sizeHalfPt: Math.max(18, sizeHalfPt - 4),
          fontFamily,
          color: '64748B',
        }),
        { align: 'center', spacingBefore: 0, spacingAfter: 40 }
      )
    );
  }

  if (includeSolutionsFromSource) {
    const questionsWithSourceSol = preparedQuestions
      .map((q, idx) => ({ q, orderNum: idx + 1 }))
      .filter(
        ({ q }) =>
          Boolean(q.solutionGuide?.rawSource?.trim()) ||
          Boolean(q.essayParts?.some((p) => p.solutionOutline?.rawSource?.trim()))
      );
    if (questionsWithSourceSol.length > 0) {
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml('PHẦN LỜI GIẢI CHI TIẾT (TRÍCH TỪ TÀI LIỆU GỐC)', {
            bold: true,
            sizeHalfPt: 24,
            fontFamily,
            color: '1E3A8A',
          }),
          { spacingBefore: 160, spacingAfter: 80 }
        )
      );
      for (const { q, orderNum } of questionsWithSourceSol) {
        const solText = q.solutionGuide?.rawSource?.trim()
          ? q.solutionGuide.rawSource.trim()
          : (q.essayParts ?? [])
              .filter((p) => p.solutionOutline?.rawSource?.trim())
              .map((p) => `${p.label} (${p.points}đ): ${p.solutionOutline.rawSource.trim()}`)
              .join(' | ');
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(`Lời giải Câu ${orderNum} (${q.code}): `, {
              bold: true,
              fontFamily,
              sizeHalfPt,
            }) + renderStyledRunsXml(solText, { fontFamily, sizeHalfPt }),
            { spacingBefore: 40, spacingAfter: 60 }
          )
        );
      }
    }
  }

  return packageOoxmlDocxBuffer({
    bodyXml: bodyChunks.join('\n'),
    mediaList,
    marginMm: settings.paperMarginMm,
    marginsMm: formTemplate
      ? {
          top: formTemplate.pageSettings.marginTopMm,
          right: formTemplate.pageSettings.marginRightMm,
          bottom: formTemplate.pageSettings.marginBottomMm,
          left: formTemplate.pageSettings.marginLeftMm,
        }
      : undefined,
    orientation: formTemplate?.pageSettings.orientation ?? 'portrait',
    fontFamily,
    fontSizePt,
    columns: formTemplate?.pageSettings.columns ?? 1,
    showPageNumbers: formTemplate?.pageSettings.showPageNumbers ?? true,
    pageNumberFormat: formTemplate?.pageSettings.pageNumberFormat ?? 'page-of-total',
    footerLabelText:
      formTemplate?.footerSettings.showCodeInFooter && showExamCode
        ? `Mã đề ${version.code}`
        : undefined,
  });
}

/**
 * Tạo file Word (.docx) đề thi dành riêng cho HỌC SINH cho một mã đề cụ thể.
 * Đảm bảo 0% rò rỉ đáp án hoặc lời giải. Bắt buộc đi qua `checkExamExportGate`.
 */
export async function buildStudentExamDocxBuffer(
  exam: MathExamProject,
  version: MixedExamVersion,
  formTemplate?: ExamFormTemplate
): Promise<Uint8Array> {
  const gate = checkExamExportGate(exam);
  if (!gate.canExport) {
    throw new Error(`Xuất DOCX bị CHẶN (BLOCKED): ${gate.blockingReasons.join(' ')}`);
  }
  return renderStudentExamDocxInternal({ exam, version, formTemplate });
}

/**
 * Xuất BẢN NHÁP ĐỀ HỌC SINH KHÔNG KÈM ĐÁP ÁN (.docx):
 * - Đi qua `checkDraftExportGate(exam)`: CHẶN nếu còn lỗi công thức, phương án thiếu (OPTION_PARSE_INCOMPLETE),
 *   hoặc tài nguyên UNRENDERABLE.
 * - Chỉ cho phép khi đề sạch về cấu trúc/nội dung và chỉ thiếu hoặc chưa xác nhận khóa đáp án.
 * - Tuyệt đối KHÔNG ghi đáp án hay lời giải vào file xuất ra.
 */
export async function buildDraftStudentExamDocxBuffer(
  exam: MathExamProject,
  version?: MixedExamVersion,
  formTemplate?: ExamFormTemplate
): Promise<Uint8Array> {
  const draftGate = checkDraftExportGate(exam);
  if (!draftGate.canExportDraft) {
    throw new Error(
      `BLOCK OFFICIAL EXPORT — DOCUMENT INTEGRITY FAILED: ${draftGate.blockingStructuralReasons.join(' ')}`
    );
  }
  const effectiveVersion: MixedExamVersion = version ?? {
    code: 'NHAP',
    seedUsed: exam.mixConfig.seed || 'draft',
    generatedAt: new Date().toISOString(),
    questions: exam.questions,
    permutationMap: [],
    answerKeyRows: [],
    integrityPassed: false,
    integrityWarnings: [draftGate.warningMessage],
  };
  return renderStudentExamDocxInternal({
    exam,
    version: effectiveVersion,
    formTemplate,
    draftBannerText:
      'BẢN NHÁP HỌC SINH — CHƯA XÁC NHẬN KHÓA CHẤM · KHÔNG DÙNG CHẤM CHÍNH THỨC',
    includeSolutionsFromSource: false,
  });
}

/**
 * Xuất ĐỀ KÈM LỜI GIẢI CHI TIẾT (.docx) cho giáo viên — CHỈ xuất lời giải thực sự có trong tài liệu gốc,
 * tuyệt đối không tự bịa lời giải nếu đề nguồn không có.
 */
export async function buildExamWithSolutionsDocxBuffer(
  exam: MathExamProject,
  version: MixedExamVersion,
  formTemplate?: ExamFormTemplate
): Promise<Uint8Array> {
  const gate = checkExamExportGate(exam);
  if (!gate.canExport) {
    throw new Error(`Xuất Đề kèm lời giải bị CHẶN (BLOCKED): ${gate.blockingReasons.join(' ')}`);
  }
  const hasAnySolution = version.questions.some(
    (q) =>
      Boolean(q.solutionGuide?.rawSource?.trim()) ||
      Boolean(q.essayParts?.some((p) => p.solutionOutline?.rawSource?.trim()))
  );
  if (!hasAnySolution) {
    throw new Error(
      'Tài liệu gốc không có lời giải chi tiết cho bất kỳ câu hỏi nào — hệ thống không tự sinh lời giải.'
    );
  }
  return renderStudentExamDocxInternal({
    exam,
    version,
    formTemplate,
    includeSolutionsFromSource: true,
  });
}

/**
 * Tạo file Word (.docx) ĐÁP ÁN RIÊNG CHO TỪNG MÃ ĐỀ (VD: `dap-an/Dap_an_101.docx`)
 * gồm Bảng đáp án mã đề và Bảng ánh xạ hoán vị so với đề gốc.
 */
export async function buildPerCodeAnswerKeyDocxBuffer(
  exam: MathExamProject,
  version: MixedExamVersion,
  formTemplate?: ExamFormTemplate
): Promise<Uint8Array> {
  const gate = checkExamExportGate(exam);
  if (!gate.canExport) {
    throw new Error(`Xuất Đáp án Mã đề ${version.code} bị CHẶN (BLOCKED): ${gate.blockingReasons.join(' ')}`);
  }

  const settings = resolveExportSettings(exam);
  const subjectProfile = getSubjectProfile(resolveSubjectId(exam.subjectId || exam.subject));
  const examTitle =
    formTemplate?.headerSettings.examTitle.trim() ||
    settings.examTitleOverride.trim() ||
    exam.title;
  const fontFamily = formTemplate?.pageSettings.fontFamily || settings.fontFamily;
  const bodyChunks: string[] = [];

  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml(`ĐÁP ÁN MÃ ĐỀ ${version.code} — ${examTitle.toUpperCase()}`, {
        bold: true,
        sizeHalfPt: 28,
        fontFamily,
      }),
      { align: 'center', spacingBefore: 40, spacingAfter: 40 }
    )
  );
  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml(
        `Môn: ${subjectProfile.name} · ${exam.grade} · Mã đề: ${version.code} · Tổng số câu: ${version.questions.length}`,
        { italic: true, sizeHalfPt: 22, fontFamily, color: '475569' }
      ),
      { align: 'center', spacingBefore: 0, spacingAfter: 120 }
    )
  );

  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml(`I. BẢNG ĐÁP ÁN MÃ ĐỀ ${version.code}`, {
        bold: true,
        sizeHalfPt: 24,
        fontFamily,
      }),
      { spacingBefore: 60, spacingAfter: 60 }
    )
  );
  const ansRows: string[][] = [['Câu mới', 'Phần', 'Dạng câu', 'Đáp án']];
  version.answerKeyRows.forEach((row) => {
    ansRows.push([
      `Câu ${row.number}`,
      row.sectionTitle || 'Đề thi',
      row.universalType ?? row.type,
      row.answer,
    ]);
  });
  bodyChunks.push(makeWordTableXml(ansRows, fontFamily, true));

  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml(`II. BẢNG ÁNH XẠ HOÁN VỊ MÃ ĐỀ ${version.code}`, {
        bold: true,
        sizeHalfPt: 24,
        fontFamily,
      }),
      { spacingBefore: 120, spacingAfter: 60 }
    )
  );
  const mapRows: string[][] = [['Câu mới', 'Câu gốc (ID)', 'Đáp án', 'Ánh xạ hoán vị']];
  version.permutationMap.forEach((m, idx) => {
    const optMap = m.optionPermutation
      ? m.optionPermutation.map((o) => `${o.newLabel}←${o.originalLabel}`).join(' ')
      : m.statementPermutation
      ? m.statementPermutation.map((s) => `${s.newLabel}←${s.originalLabel}`).join(' ')
      : m.matchingRightPermutation
      ? m.matchingRightPermutation.map((r) => `${r.newLabel}←${r.originalLabel}`).join(' ')
      : m.orderingPermutation
      ? m.orderingPermutation.map((o) => `${o.newLabel}←${o.originalLabel}`).join(' ')
      : 'Giữ nguyên';
    mapRows.push([
      `Câu ${m.newOrderNumber}`,
      `Câu ${m.originalOrderNumber} (${m.originalCode})`,
      version.answerKeyRows[idx]?.answer ?? m.exactAnswerSummary,
      optMap,
    ]);
  });
  bodyChunks.push(makeWordTableXml(mapRows, fontFamily, true));

  return packageOoxmlDocxBuffer({
    bodyXml: bodyChunks.join('\n'),
    mediaList: [],
    marginMm: settings.paperMarginMm,
    orientation: formTemplate?.pageSettings.orientation ?? 'portrait',
    fontFamily,
    fontSizePt: formTemplate?.pageSettings.fontSizePt ?? 12,
  });
}

/**
 * Tạo file Word (.docx) ĐÁP ÁN TỔNG HỢP & BẢNG ÁNH XẠ HOÁN VỊ cho GIÁO VIÊN.
 */
export async function buildAnswerKeyDocxBuffer(
  exam: MathExamProject,
  formTemplate?: ExamFormTemplate
): Promise<Uint8Array> {
  const gate = checkExamExportGate(exam);
  if (!gate.canExport) {
    throw new Error(`Xuất Đáp án DOCX bị CHẶN (BLOCKED): ${gate.blockingReasons.join(' ')}`);
  }

  const settings = resolveExportSettings(exam);
  const subjectProfile = getSubjectProfile(resolveSubjectId(exam.subjectId || exam.subject));
  const placeholderCtx = formTemplate
    ? buildPlaceholderContext(exam, exam.generatedVersions[0] ?? null, formTemplate)
    : null;
  const rawExamTitle =
    formTemplate?.headerSettings.examTitle.trim() ||
    settings.examTitleOverride.trim() ||
    exam.title;
  const examTitle = placeholderCtx
    ? resolveExamFormPlaceholders(rawExamTitle, placeholderCtx)
    : rawExamTitle;
  const fontFamily = formTemplate?.pageSettings.fontFamily || settings.fontFamily;
  const includeMatrix = formTemplate
    ? formTemplate.answerLayout.includePerCodeAnswerTable
    : settings.includeAnswerMatrix;
  const includeDetailMap = formTemplate
    ? formTemplate.answerLayout.includeSeparateAnswerKey ||
      formTemplate.answerLayout.includeMappingAuditTable
    : settings.includeAnswerKey || settings.includeMappingTable;
  const includeSolutions = formTemplate
    ? formTemplate.answerLayout.includeDetailedSolutions
    : false;
  const answerTableStyle = formTemplate?.answerLayout.answerTableStyle ?? 'multi-column';
  const answerColumns = formTemplate?.answerLayout.answerColumns ?? 4;
  const bodyChunks: string[] = [];

  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml(`ĐÁP ÁN & BẢNG ÁNH XẠ HOÁN VỊ — ${examTitle.toUpperCase()}`, {
        bold: true,
        sizeHalfPt: 28,
        fontFamily,
      }),
      { align: 'center', spacingBefore: 40, spacingAfter: 40 }
    )
  );
  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml(
        `Môn: ${subjectProfile.name} · ${exam.grade} · Số lượng mã đề: ${exam.generatedVersions.length} · Seed: ${exam.mixConfig.seed}`,
        { italic: true, sizeHalfPt: 22, fontFamily, color: '475569' }
      ),
      { align: 'center', spacingBefore: 0, spacingAfter: 120 }
    )
  );

  // 1. Bảng đáp án tổng hợp tất cả mã đề (luôn giữ chuẩn tương thích, kết hợp bố cục kiểu giáo viên chọn)
  if (includeMatrix) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml('I. BẢNG ĐÁP ÁN TỔNG HỢP CÁC MÃ ĐỀ', { bold: true, sizeHalfPt: 24, fontFamily }),
        { spacingBefore: 80, spacingAfter: 60 }
      )
    );
    const maxQuestions = Math.max(0, ...exam.generatedVersions.map((v) => v.answerKeyRows.length));
    const chunkSize = 6;
    for (let start = 0; start < exam.generatedVersions.length; start += chunkSize) {
      const slice = exam.generatedVersions.slice(start, start + chunkSize);
      const rows: string[][] = [['Câu', ...slice.map((v) => `Mã ${v.code}`)]];
      for (let qIdx = 0; qIdx < maxQuestions; qIdx++) {
        rows.push([
          `Câu ${qIdx + 1}`,
          ...slice.map((v) => v.answerKeyRows[qIdx]?.answer ?? '—'),
        ]);
      }
      bodyChunks.push(makeWordTableXml(rows, fontFamily, true));
      bodyChunks.push(makeParagraphXml(renderStyledRunsXml('', { fontFamily }), { spacingAfter: 60 }));
    }

    // Chế độ trình bày bổ sung theo mẫu bảng đáp án đã thiết kế (horizontal / multi-column / by-section / per-code)
    if (formTemplate && answerTableStyle === 'horizontal') {
      exam.generatedVersions.forEach((ver) => {
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(`Bảng đáp án hàng ngang — Mã ${ver.code}`, {
              bold: true,
              sizeHalfPt: 22,
              fontFamily,
              color: '1E3A8A',
            }),
            { spacingBefore: 80, spacingAfter: 40 }
          )
        );
        const stripSize = 8;
        for (let s = 0; s < ver.answerKeyRows.length; s += stripSize) {
          const strip = ver.answerKeyRows.slice(s, s + stripSize);
          const tbl: string[][] = [
            ['Câu', ...strip.map((r) => `${r.number}`)],
            ['Đáp án', ...strip.map((r) => r.answer)],
          ];
          bodyChunks.push(makeWordTableXml(tbl, fontFamily, true));
          bodyChunks.push(makeParagraphXml(renderStyledRunsXml('', { fontFamily }), { spacingAfter: 30 }));
        }
      });
    } else if (formTemplate && answerTableStyle === 'multi-column') {
      exam.generatedVersions.forEach((ver) => {
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(`Bảng đáp án ${answerColumns} cột — Mã ${ver.code}`, {
              bold: true,
              sizeHalfPt: 22,
              fontFamily,
              color: '1E3A8A',
            }),
            { spacingBefore: 80, spacingAfter: 40 }
          )
        );
        const total = ver.answerKeyRows.length;
        const perCol = Math.max(1, Math.ceil(total / answerColumns));
        const hdr: string[] = [];
        for (let c = 0; c < answerColumns; c++) hdr.push('Câu', 'Đáp án');
        const rows: string[][] = [hdr];
        for (let r = 0; r < perCol; r++) {
          const rowCells: string[] = [];
          for (let c = 0; c < answerColumns; c++) {
            const entry = ver.answerKeyRows[c * perCol + r];
            rowCells.push(entry ? `Câu ${entry.number}` : '', entry ? entry.answer : '');
          }
          rows.push(rowCells);
        }
        bodyChunks.push(makeWordTableXml(rows, fontFamily, true));
      });
    } else if (formTemplate && answerTableStyle === 'by-section') {
      exam.generatedVersions.forEach((ver) => {
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(`Đáp án phân theo từng phần — Mã ${ver.code}`, {
              bold: true,
              sizeHalfPt: 22,
              fontFamily,
              color: '1E3A8A',
            }),
            { spacingBefore: 80, spacingAfter: 40 }
          )
        );
        const bySec = new Map<string, typeof ver.answerKeyRows>();
        ver.answerKeyRows.forEach((r) => {
          const sec = r.sectionTitle || 'Phần chung';
          const arr = bySec.get(sec) ?? [];
          arr.push(r);
          bySec.set(sec, arr);
        });
        for (const [secTitle, secRows] of bySec.entries()) {
          bodyChunks.push(
            makeParagraphXml(
              renderStyledRunsXml(secTitle, { bold: true, italic: true, sizeHalfPt: 20, fontFamily }),
              { spacingBefore: 40, spacingAfter: 20 }
            )
          );
          const tbl: string[][] = [['Câu', 'Dạng câu', 'Đáp án']];
          secRows.forEach((r) => tbl.push([`Câu ${r.number}`, r.universalType ?? r.type, r.answer]));
          bodyChunks.push(makeWordTableXml(tbl, fontFamily, true));
        }
      });
    }
  }

  // 2. Chi tiết ánh xạ từng mã đề
  if (includeDetailMap) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml('II. CHI TIẾT ĐÁP ÁN & ÁNH XẠ HOÁN VỊ TỪNG MÃ ĐỀ', {
          bold: true,
          sizeHalfPt: 24,
          fontFamily,
        }),
        { spacingBefore: 100, spacingAfter: 60 }
      )
    );

    exam.generatedVersions.forEach((ver) => {
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`Mã đề ${ver.code} (Trạng thái: ${ver.integrityStatus ?? 'PASS'})`, {
            bold: true,
            sizeHalfPt: 22,
            fontFamily,
            color: '1E3A8A',
          }),
          { spacingBefore: 100, spacingAfter: 40 }
        )
      );
      const rows: string[][] = [['Câu mới', 'Câu gốc (ID)', 'Dạng câu', 'Đáp án', 'Ánh xạ hoán vị']];
      ver.permutationMap.forEach((m, idx) => {
        const optMap = m.optionPermutation
          ? m.optionPermutation.map((o) => `${o.newLabel}←${o.originalLabel}`).join(' ')
          : m.statementPermutation
          ? m.statementPermutation.map((s) => `${s.newLabel}←${s.originalLabel}`).join(' ')
          : m.matchingRightPermutation
          ? m.matchingRightPermutation.map((r) => `${r.newLabel}←${r.originalLabel}`).join(' ')
          : m.orderingPermutation
          ? m.orderingPermutation.map((o) => `${o.newLabel}←${o.originalLabel}`).join(' ')
          : 'Giữ nguyên';
        rows.push([
          `Câu ${m.newOrderNumber}`,
          `Câu ${m.originalOrderNumber} (${m.originalCode})`,
          m.universalType ?? m.type,
          ver.answerKeyRows[idx]?.answer ?? m.exactAnswerSummary,
          optMap,
        ]);
      });
      bodyChunks.push(makeWordTableXml(rows, fontFamily, true));
    });
  }

  // 3. Lời giải & hướng dẫn chấm chi tiết (nếu mẫu yêu cầu)
  if (includeSolutions) {
    const withSolution = exam.questions.filter(
      (q) =>
        Boolean(q.solutionGuide?.rawSource?.trim()) ||
        (q.essayParts && q.essayParts.length > 0)
    );
    if (withSolution.length > 0) {
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml('III. LỜI GIẢI & HƯỚNG DẪN CHẤM CHI TIẾT (ĐỀ GỐC)', {
            bold: true,
            sizeHalfPt: 24,
            fontFamily,
          }),
          { spacingBefore: 120, spacingAfter: 60 }
        )
      );
      withSolution.forEach((q, idx) => {
        const solText = q.solutionGuide?.rawSource?.trim()
          ? q.solutionGuide.rawSource
          : (q.essayParts ?? []).map((p) => `${p.label} (${p.points}đ): ${p.content.rawSource}`).join(' | ');
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(`Câu gốc ${q.code || idx + 1}: `, {
              bold: true,
              fontFamily,
            }) + renderStyledRunsXml(solText, { fontFamily }),
            { spacingBefore: 40, spacingAfter: 40 }
          )
        );
      });
    }
  }

  return packageOoxmlDocxBuffer({
    bodyXml: bodyChunks.join('\n'),
    mediaList: [],
    marginMm: settings.paperMarginMm,
    marginsMm: formTemplate
      ? {
          top: formTemplate.pageSettings.marginTopMm,
          right: formTemplate.pageSettings.marginRightMm,
          bottom: formTemplate.pageSettings.marginBottomMm,
          left: formTemplate.pageSettings.marginLeftMm,
        }
      : undefined,
    orientation: formTemplate?.pageSettings.orientation ?? 'portrait',
    fontFamily,
    fontSizePt: formTemplate?.pageSettings.fontSizePt ?? 12,
  });
}

/**
 * Tạo bảng đáp án CSV (UTF-8 BOM) tương thích mở trực tiếp trên Excel/Google Sheets.
 * Bắt buộc đi qua cổng kiểm chứng chung `checkExamExportGate`.
 */
export function buildConsolidatedAnswerCsv(exam: MathExamProject): string {
  const gate = checkExamExportGate(exam);
  if (!gate.canExport) {
    throw new Error(`Xuất CSV bị CHẶN (BLOCKED): ${gate.blockingReasons.join(' ')}`);
  }

  const versions = exam.generatedVersions;
  const maxQ = Math.max(0, ...versions.map((v) => v.answerKeyRows.length));
  const csvEscape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;

  const header = ['Câu', ...versions.map((v) => `Mã ${v.code}`)].map(csvEscape).join(',');
  const lines = [header];

  for (let i = 0; i < maxQ; i++) {
    const row = [
      `Câu ${i + 1}`,
      ...versions.map((v) => v.answerKeyRows[i]?.answer ?? ''),
    ];
    lines.push(row.map(csvEscape).join(','));
  }

  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * Đóng gói dữ liệu JSON đáp án & ánh xạ hoán vị đi qua cùng cổng kiểm chứng chung `checkExamExportGate`.
 */
export function buildMixedExamJsonExportPayload(exam: MathExamProject): Record<string, unknown> {
  const gate = checkExamExportGate(exam);
  if (!gate.canExport) {
    throw new Error(`Xuất JSON bị CHẶN (BLOCKED): ${gate.blockingReasons.join(' ')}`);
  }

  return {
    exportedAt: new Date().toISOString(),
    examId: exam.id,
    examTitle: exam.title,
    subject: exam.subject,
    grade: exam.grade,
    durationMinutes: exam.durationMinutes,
    seed: exam.mixConfig.seed,
    integrityReport: gate.report,
    versions: exam.generatedVersions.map((v) => ({
      code: v.code,
      seedUsed: v.seedUsed,
      integrityPassed: v.integrityPassed,
      integrityStatus: v.integrityStatus ?? 'PASS',
      answerKeyRows: v.answerKeyRows,
      permutationMap: v.permutationMap,
    })),
  };
}

/**
 * Báo cáo truy vết nguồn-đến-đầu-ra (Source-to-Output Traceability) cho QA & hậu kiểm:
 * Ánh xạ Source: <file> / <section> / Câu <origNum> -> Output: Mã <code> / <section> / Câu <newNum>
 * kèm sourceQuestionId, originalContentHash, mediaIds, answerId, permutationData, exportedQuestionId.
 * Tuyệt đối KHÔNG ghi vào đề học sinh.
 */
export function buildSourceToOutputTraceabilityReport(exam: MathExamProject): {
  generatedAt: string;
  examId: string;
  examTitle: string;
  sourceFileName: string;
  sourceFileHash: string | null;
  totalSourceQuestions: number;
  codes: Array<{
    code: string;
    seedUsed: string;
    entries: Array<{
      sourceQuestionId: string;
      exportedQuestionId: string;
      sourceLabel: string;
      outputLabel: string;
      originalCode: string;
      originalContentHash: string | null;
      mediaIds: string[];
      answerId: string;
      answerInCode: string;
      answerProvenanceStatus: string | null;
      permutationData: {
        originalOrderNumber: number;
        newOrderNumber: number;
        optionPermutation: unknown;
        statementPermutation: unknown;
      };
    }>;
  }>;
} {
  const sourceFileName =
    exam.sourceRecord?.fileName ??
    exam.sourceDocumentPreview?.fileName ??
    'manual-entry';
  const sourceFileHash =
    exam.sourceRecord?.contentHash ??
    exam.sourceDocumentPreview?.sourceFileHash ??
    null;
  const origById = new Map(exam.questions.map((q) => [q.id, q]));

  return {
    generatedAt: new Date().toISOString(),
    examId: exam.id,
    examTitle: exam.title,
    sourceFileName,
    sourceFileHash,
    totalSourceQuestions: exam.questions.length,
    codes: exam.generatedVersions.map((ver) => ({
      code: ver.code,
      seedUsed: ver.seedUsed,
      entries: ver.permutationMap.map((m, idx) => {
        const origQ = origById.get(m.questionId);
        const mixedQ = ver.questions[idx];
        const origSecNum =
          origQ?.sourceTrace?.originalQuestionNumberInSection ?? m.originalOrderNumber;
        const outSecNum = m.sectionQuestionNumber ?? m.newOrderNumber;
        const mediaIds = [
          ...(mixedQ?.visualAssets ?? []).map((a) => a.id),
          ...(mixedQ?.options ?? [])
            .map((o) => o.visualAsset?.id)
            .filter((id): id is string => Boolean(id)),
        ];
        return {
          sourceQuestionId: m.questionId,
          exportedQuestionId: `${ver.code}-Q${m.newOrderNumber}`,
          sourceLabel: `Source: ${sourceFileName} / ${origQ?.sectionTitle || m.sectionTitle} / Câu ${origSecNum}`,
          outputLabel: `Output: Mã ${ver.code} / ${m.sectionTitle} / Câu ${outSecNum} (Tổng #${m.newOrderNumber})`,
          originalCode: m.originalCode,
          originalContentHash: origQ ? computeQuestionVerificationContentHash(origQ) : null,
          mediaIds,
          answerId: origQ?.correctOptionId ?? m.exactAnswerSummary,
          answerInCode: ver.answerKeyRows[idx]?.answer ?? m.exactAnswerSummary,
          answerProvenanceStatus: origQ?.answerProvenance?.status ?? null,
          permutationData: {
            originalOrderNumber: m.originalOrderNumber,
            newOrderNumber: m.newOrderNumber,
            optionPermutation: m.optionPermutation ?? null,
            statementPermutation: m.statementPermutation ?? null,
          },
        };
      }),
    })),
  };
}

/**
 * Kiểm chứng toàn vẹn một file .docx đã xuất bằng chính OOXML Parser cục bộ:
 * - Mở giải nén ZIP không lỗi
 * - Đủ số câu hỏi mong đợi
 * - KHÔNG rò rỉ đáp án hay hướng dẫn chấm trong đề học sinh
 * - Các tài nguyên hình ảnh/bảng đều hợp lệ
 */
export async function verifyExportedDocxBuffer(
  buffer: ArrayBuffer | Uint8Array,
  expectedVersion: MixedExamVersion,
  exam: MathExamProject
): Promise<{ passed: boolean; issues: MathIntegrityIssue[]; extractedParagraphCount: number }> {
  const issues: MathIntegrityIssue[] = [];
  let extractedParagraphCount = 0;

  try {
    const extracted = await extractDocxDocument(buffer);
    extractedParagraphCount = extracted.paragraphs.length;

    const fullText = extracted.plainTextWithMarkers;
    const normalizedFull = fullText.replace(/\[\[ASSET:[^\]]+\]\]/g, '').replace(/\s+/g, ' ');
    let orderCursor = 0;

    expectedVersion.questions.forEach((q, idx) => {
      const marker = `Câu ${idx + 1}:`;
      const markerPos = normalizedFull.indexOf(marker, orderCursor);
      if (markerPos === -1) {
        issues.push({
          id: `exp-missing-q-${expectedVersion.code}-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          questionId: q.id,
          questionNumber: idx + 1,
          code: q.code,
          message: `File DOCX Mã đề ${expectedVersion.code} bị thiếu hoặc sai vị trí đánh số "${marker}".`,
          recommendation: 'Kiểm tra lại quá trình đóng gói DOCX.',
        });
        return;
      }

      const nextMarker = `Câu ${idx + 2}:`;
      const nextMarkerPos =
        idx + 1 < expectedVersion.questions.length
          ? normalizedFull.indexOf(nextMarker, markerPos + marker.length)
          : -1;
      const questionSlice =
        nextMarkerPos !== -1
          ? normalizedFull.slice(markerPos, nextMarkerPos)
          : normalizedFull.slice(markerPos);

      orderCursor = markerPos + marker.length;

      // Xác minh nội dung stem đúng thứ tự ngay trong khối của Câu idx+1 (không chỉ xuất hiện đâu đó trong tài liệu)
      const normalizedStem = q.stem.rawSource.replace(/\s+/g, ' ').trim();
      const snippet = normalizedStem.slice(0, Math.min(36, normalizedStem.length));
      if (snippet && !questionSlice.includes(snippet)) {
        issues.push({
          id: `exp-stem-order-mismatch-${expectedVersion.code}-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          questionId: q.id,
          questionNumber: idx + 1,
          code: q.code,
          message: `File DOCX Mã đề ${expectedVersion.code} không khớp nội dung hoặc thứ tự câu tại vị trí Câu ${idx + 1} (${q.code}).`,
          recommendation: 'Chặn xuất file vì thứ tự hoặc nội dung câu hỏi trong file Word lệch với mã đề đã trộn.',
        });
      }

      // Xác minh thứ tự và nội dung phương án MCQ sau khi trộn (A/B/C/D)
      if (q.type === 'mcq' && q.options && q.options.length === 4) {
        let optCursor = 0;
        q.options.forEach((opt, oIdx) => {
          const lbl = MCQ_LABELS[oIdx] ?? getOptionLetterLabel(oIdx);
          const optText = opt.content.rawSource.replace(/\s+/g, ' ').trim();
          const labelMatchRegex = new RegExp(`(?:^|\\s)${lbl}[.)]\\s*`);
          const subSlice = questionSlice.slice(optCursor);
          const lblMatch = labelMatchRegex.exec(subSlice);
          if (!lblMatch) {
            issues.push({
              id: `exp-opt-missing-${expectedVersion.code}-${q.id}-${lbl}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'export',
              questionId: q.id,
              questionNumber: idx + 1,
              code: q.code,
              optionOrStatementLabel: lbl,
              message: `File DOCX Mã đề ${expectedVersion.code} thiếu phương án ${lbl} ở Câu ${idx + 1} (${q.code}).`,
              recommendation: 'Kiểm tra lại nội dung phương án trước khi xuất.',
            });
            return;
          }
          optCursor += lblMatch.index + lblMatch[0].length;
          const optSnippet = optText.slice(0, Math.min(24, optText.length));
          if (optSnippet && !questionSlice.slice(optCursor - 2).includes(optSnippet)) {
            issues.push({
              id: `exp-opt-order-mismatch-${expectedVersion.code}-${q.id}-${lbl}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'export',
              questionId: q.id,
              questionNumber: idx + 1,
              code: q.code,
              optionOrStatementLabel: lbl,
              message: `File DOCX Mã đề ${expectedVersion.code} sai nội dung/thứ tự phương án ${lbl} ở Câu ${idx + 1} (${q.code}).`,
              recommendation: 'Chặn xuất vì phương án hiển thị trong DOCX không khớp thứ tự hoán vị.',
            });
          }
        });
      }

      // Xác minh đủ 4 mệnh đề Đúng/Sai a)/b)/c)/d)
      if (q.type === 'true-false' && q.statements && q.statements.length === 4) {
        let stCursor = 0;
        q.statements.forEach((st, sIdx) => {
          const lbl = TF_LABELS[sIdx] ?? getStatementLetterLabel(sIdx);
          const stText = st.content.rawSource.replace(/\s+/g, ' ').trim();
          const stMatch = new RegExp(`(?:^|\\s)${lbl}\\)\\s*`).exec(questionSlice.slice(stCursor));
          if (!stMatch) {
            issues.push({
              id: `exp-st-missing-${expectedVersion.code}-${q.id}-${lbl}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'export',
              questionId: q.id,
              questionNumber: idx + 1,
              code: q.code,
              optionOrStatementLabel: `${lbl})`,
              message: `File DOCX Mã đề ${expectedVersion.code} thiếu mệnh đề ${lbl}) ở Câu ${idx + 1} (${q.code}).`,
              recommendation: 'Kiểm tra lại danh sách mệnh đề Đúng/Sai.',
            });
            return;
          }
          stCursor += stMatch.index + stMatch[0].length;
          const stSnippet = stText.slice(0, Math.min(24, stText.length));
          if (stSnippet && !questionSlice.slice(stCursor - 2).includes(stSnippet)) {
            issues.push({
              id: `exp-st-mismatch-${expectedVersion.code}-${q.id}-${lbl}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'export',
              questionId: q.id,
              questionNumber: idx + 1,
              code: q.code,
              optionOrStatementLabel: `${lbl})`,
              message: `File DOCX Mã đề ${expectedVersion.code} sai nội dung mệnh đề ${lbl}) ở Câu ${idx + 1} (${q.code}).`,
              recommendation: 'Chặn xuất vì mệnh đề Đúng/Sai trong file DOCX không khớp bản trộn.',
            });
          }
        });
      }
    });

    // Kiểm tra KHÔNG còn placeholder công thức OLE/OMML chưa giải mã trong file xuất ra
    if (
      fullText.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
      fullText.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]')
    ) {
      issues.push({
        id: `exp-unresolved-formula-${expectedVersion.code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: `File DOCX học sinh Mã đề ${expectedVersion.code} còn chứa placeholder công thức chưa giải mã ([CÔNG_THỨC_OLE_LEGACY] / [CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]).`,
        recommendation: 'Chặn phát hành và xử lý toàn bộ công thức trước khi xuất.',
      });
    }

    // Kiểm tra không rò rỉ nhãn đáp án vào đề học sinh
    if (
      /(?:Đáp án đúng:|Đáp án gốc:|Hướng dẫn chấm:|Bảng ánh xạ hoán vị|BẢNG ĐÁP ÁN TỔNG HỢP|ĐÁP ÁN & BẢNG ÁNH XẠ)/i.test(
        fullText
      )
    ) {
      issues.push({
        id: `exp-answer-leak-${expectedVersion.code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: `File DOCX học sinh Mã đề ${expectedVersion.code} bị rò rỉ đáp án hoặc hướng dẫn giải.`,
        recommendation: 'Chặn phát hành ngay để bảo mật đề thi.',
      });
    }

    // Kiểm tra bảo toàn số lượng ảnh/bảng (gồm cả đồ thị/BBT trong câu hỏi và phương án MCQ)
    const expectedAssetsCount =
      expectedVersion.questions.reduce(
        (acc, q) =>
          acc +
          (q.visualAssets?.length ?? 0) +
          (q.options ?? []).filter((o) => Boolean(o.visualAsset)).length,
        0
      ) +
      (exam.questionGroups ?? [])
        .filter((g) => expectedVersion.questions.some((q) => q.groupId === g.id))
        .reduce((acc, g) => acc + g.sharedAssets.length, 0);

    if (expectedAssetsCount > 0 && extracted.assets.length < expectedAssetsCount) {
      issues.push({
        id: `exp-assets-missing-${expectedVersion.code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: `File DOCX Mã đề ${expectedVersion.code}: chỉ khôi phục được ${extracted.assets.length}/${expectedAssetsCount} tài nguyên hình/bảng.`,
        recommendation: 'Kiểm tra lại định dạng ảnh đính kèm trước khi xuất.',
      });
    }

    // Kiểm tra bảo toàn số lượng công thức ($...$ / $$...$$ / OMML): chặn lỗi công thức biến mất dù số câu đúng!
    const countFormulaTokens = (txt: string): number => {
      if (!txt) return 0;
      const matches = txt.match(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g);
      return matches ? matches.length : 0;
    };
    const expectedLatexFormulaCount = expectedVersion.questions.reduce((sum, q) => {
      let c = countFormulaTokens(q.stem.rawSource);
      for (const o of q.options ?? []) c += countFormulaTokens(o.content.rawSource);
      for (const s of q.statements ?? []) c += countFormulaTokens(s.content.rawSource);
      return sum + c;
    }, 0);
    const extractedFormulaCount =
      countFormulaTokens(fullText) + extracted.ommlFragments.length;
    if (
      expectedLatexFormulaCount > 0 &&
      extractedFormulaCount < expectedLatexFormulaCount
    ) {
      issues.push({
        id: `exp-formula-loss-${expectedVersion.code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: `File DOCX Mã đề ${expectedVersion.code} bị mất công thức toán học sau khi xuất: chỉ đọc lại được ${extractedFormulaCount}/${expectedLatexFormulaCount} biểu thức.`,
        recommendation: 'Chặn phát hành vì công thức bị thất lạc trong quá trình đóng gói DOCX.',
      });
    }

    // Kiểm tra toàn vẹn quan hệ ảnh trong OOXML (word/_rels/document.xml.rels -> word/media/* không rỗng, không gãy)
    const rawZip = await JSZip.loadAsync(buffer);
    const rawDocXml = (await rawZip.file('word/document.xml')?.async('string')) ?? '';
    const rawRelsXml = (await rawZip.file('word/_rels/document.xml.rels')?.async('string')) ?? '';
    const relTargetById = new Map<string, string>();
    const relTagRe = /<Relationship\b([^>]*)\/?>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = relTagRe.exec(rawRelsXml)) !== null) {
      const attrs = rm[1] ?? '';
      const idMatch = /\bId="([^"]+)"/i.exec(attrs);
      const targetMatch = /\bTarget="([^"]+)"/i.exec(attrs);
      if (idMatch?.[1] && targetMatch?.[1]) {
        relTargetById.set(idMatch[1], targetMatch[1]);
      }
    }
    const embedIds = new Set<string>();
    const embedRe = /\b(?:r:embed|r:id)="([^"]+)"/g;
    let em: RegExpExecArray | null;
    while ((em = embedRe.exec(rawDocXml)) !== null) {
      embedIds.add(em[1]);
    }
    for (const rId of embedIds) {
      const target = relTargetById.get(rId);
      if (!target) {
        issues.push({
          id: `exp-broken-rel-${expectedVersion.code}-${rId}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          message: `File DOCX Mã đề ${expectedVersion.code} chứa tham chiếu quan hệ ảnh bị gãy (${rId} không có trong word/_rels/document.xml.rels).`,
          recommendation: 'Kiểm tra lại quá trình đóng gói ảnh media.',
        });
        continue;
      }
      if (/media\//i.test(target)) {
        const mediaPath = target.startsWith('/')
          ? target.slice(1)
          : target.startsWith('word/')
          ? target
          : `word/${target.replace(/^\.\//, '')}`;
        const mediaEntry = rawZip.file(mediaPath);
        if (!mediaEntry) {
          issues.push({
            id: `exp-broken-media-${expectedVersion.code}-${rId}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'export',
            message: `File DOCX Mã đề ${expectedVersion.code} tham chiếu tệp ảnh không tồn tại (${mediaPath}).`,
            recommendation: 'Chặn phát hành vì tệp ảnh trong DOCX bị thiếu.',
          });
        } else {
          const mediaBytes = await mediaEntry.async('uint8array');
          if (mediaBytes.byteLength === 0) {
            issues.push({
              id: `exp-empty-media-${expectedVersion.code}-${rId}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'export',
              message: `File DOCX Mã đề ${expectedVersion.code} chứa tệp ảnh rỗng 0 byte (${mediaPath}).`,
              recommendation: 'Chặn phát hành vì tệp ảnh bị hỏng.',
            });
          }
        }
      }
    }
  } catch (err) {
    issues.push({
      id: `exp-docx-invalid-${expectedVersion.code}`,
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'export',
      message: `File DOCX Mã đề ${expectedVersion.code} không đọc lại được sau khi tạo: ${
        err instanceof Error ? err.message : 'Lỗi không xác định'
      }`,
      recommendation: 'Không phát hành file lỗi.',
    });
  }

  return {
    passed: issues.every((i) => i.severity !== 'error'),
    issues,
    extractedParagraphCount,
  };
}

/**
 * Kiểm chứng khứ hồi (Round-Trip Verification):
 * Đọc lại file DOCX học sinh đã xuất bằng `importUniversalExamFile` và đối chiếu:
 * - Số câu hỏi khôi phục khớp 100%
 * - Không mất phương án A/B/C/D hay mệnh đề a/b/c/d
 * - Không có placeholder công thức hoặc tài nguyên UNRENDERABLE
 * - Bảo toàn công thức và toàn vẹn quan hệ ảnh OOXML.
 */
export async function verifyExportedDocxRoundTrip(
  buffer: ArrayBuffer | Uint8Array,
  expectedVersion: MixedExamVersion,
  exam: MathExamProject
): Promise<{
  passed: boolean;
  reimportedQuestionCount: number;
  expectedQuestionCount: number;
  issues: MathIntegrityIssue[];
}> {
  const baseVerify = await verifyExportedDocxBuffer(buffer, expectedVersion, exam);
  const issues: MathIntegrityIssue[] = [...baseVerify.issues];
  let reimportedQuestionCount = 0;

  try {
    let seq = 0;
    const reimported = await importUniversalExamFile(
      { fileName: `Ma_de_${expectedVersion.code}.docx`, buffer },
      (prefix) => `${prefix}-rt-${++seq}`,
      { subjectId: resolveSubjectId(exam.subjectId || exam.subject) }
    );
    reimportedQuestionCount = reimported.questions.length;

    if (reimportedQuestionCount !== expectedVersion.questions.length) {
      issues.push({
        id: `rt-qcount-${expectedVersion.code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: `Round-trip DOCX Mã ${expectedVersion.code}: đọc lại được ${reimportedQuestionCount}/${expectedVersion.questions.length} câu hỏi.`,
        recommendation: 'Kiểm tra lại định dạng xuất câu hỏi để tránh mất/nhân đôi câu.',
      });
    }

    reimported.questions.forEach((rq, idx) => {
      const expQ = expectedVersion.questions[idx];
      if (!expQ) return;
      if (rq.optionParseIncomplete) {
        issues.push({
          id: `rt-opt-incomplete-${expectedVersion.code}-${idx + 1}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          questionNumber: idx + 1,
          message: `Round-trip DOCX Mã ${expectedVersion.code} Câu ${idx + 1}: phương án đọc lại bị thiếu (OPTION_PARSE_INCOMPLETE).`,
          recommendation: 'Kiểm tra lại cấu trúc xuất phương án A/B/C/D.',
        });
      }
      if (expQ.type === 'mcq' && (rq.options?.length ?? 0) !== (expQ.options?.length ?? 0)) {
        issues.push({
          id: `rt-mcq-opt-count-${expectedVersion.code}-${idx + 1}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          questionNumber: idx + 1,
          message: `Round-trip DOCX Mã ${expectedVersion.code} Câu ${idx + 1}: số phương án đọc lại (${rq.options?.length ?? 0}) không khớp bản xuất (${expQ.options?.length ?? 0}).`,
          recommendation: 'Kiểm tra định dạng xuất MCQ.',
        });
      }
      if (expQ.type === 'true-false' && (rq.statements?.length ?? 0) !== (expQ.statements?.length ?? 0)) {
        issues.push({
          id: `rt-tf-stmt-count-${expectedVersion.code}-${idx + 1}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          questionNumber: idx + 1,
          message: `Round-trip DOCX Mã ${expectedVersion.code} Câu ${idx + 1}: số mệnh đề Đúng/Sai đọc lại (${rq.statements?.length ?? 0}) không khớp bản xuất (${expQ.statements?.length ?? 0}).`,
          recommendation: 'Kiểm tra định dạng xuất Đúng/Sai.',
        });
      }
      if (rq.unrenderableMediaRefs && rq.unrenderableMediaRefs.length > 0) {
        issues.push({
          id: `rt-unrenderable-${expectedVersion.code}-${idx + 1}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          questionNumber: idx + 1,
          message: `Round-trip DOCX Mã ${expectedVersion.code} Câu ${idx + 1}: chứa tài nguyên UNRENDERABLE (${rq.unrenderableMediaRefs.join(', ')}).`,
          recommendation: 'Kiểm tra lại đóng gói hình ảnh.',
        });
      }
    });
  } catch (err) {
    issues.push({
      id: `rt-parse-error-${expectedVersion.code}`,
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'export',
      message: `Round-trip DOCX Mã ${expectedVersion.code} lỗi đọc lại: ${err instanceof Error ? err.message : 'Lỗi không xác định'}`,
      recommendation: 'Kiểm tra lại file DOCX xuất ra.',
    });
  }

  return {
    passed: issues.every((i) => i.severity !== 'error'),
    reimportedQuestionCount,
    expectedQuestionCount: expectedVersion.questions.length,
    issues,
  };
}

/**
 * Đọc lại file Đáp án DOCX (`dap-an/Dap_an_va_Anh_xa.docx`) để xác minh:
 * - Mở giải nén sạch bằng OOXML parser
 * - Không chứa placeholder công thức chưa giải mã hoặc chuỗi lỗi 666/6666
 * - Có đủ toàn bộ mã đề và giá trị đáp án khớp với `answerKeyRows`.
 */
export async function verifyExportedAnswerKeyDocxBuffer(
  buffer: ArrayBuffer | Uint8Array,
  exam: MathExamProject
): Promise<{ passed: boolean; issues: MathIntegrityIssue[] }> {
  const issues: MathIntegrityIssue[] = [];
  try {
    const extracted = await extractDocxDocument(buffer);
    const fullText = extracted.plainTextWithMarkers;

    if (
      fullText.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
      fullText.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]')
    ) {
      issues.push({
        id: 'exp-ans-docx-placeholder',
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: 'File Đáp án DOCX còn chứa placeholder công thức chưa giải mã.',
        recommendation: 'Xử lý triệt để công thức trước khi xuất.',
      });
    }

    for (const ver of exam.generatedVersions) {
      if (!fullText.includes(`Mã ${ver.code}`) && !fullText.includes(`Mã đề ${ver.code}`)) {
        issues.push({
          id: `exp-ans-docx-missing-code-${ver.code}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          message: `File Đáp án DOCX bị thiếu mục cho Mã đề ${ver.code}.`,
          recommendation: 'Xuất lại file đáp án.',
        });
      }
      for (const row of ver.answerKeyRows) {
        if (row.type === 'true-false' && /\b6{3,}\b/.test(row.answer)) {
          issues.push({
            id: `exp-ans-docx-tf-666-${ver.code}-${row.number}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'export',
            questionId: row.questionId,
            questionNumber: row.number,
            message: `Phát hiện chuỗi lỗi 666/6666 trong đáp án Đúng/Sai Câu ${row.number} Mã ${ver.code}.`,
            recommendation: 'Chặn phát hành và sửa khóa câu Đúng/Sai.',
          });
        }
        if (row.answer && row.answer !== '?' && !fullText.includes(row.answer)) {
          issues.push({
            id: `exp-ans-docx-missing-row-${ver.code}-${row.number}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'export',
            questionId: row.questionId,
            questionNumber: row.number,
            message: `File Đáp án DOCX không tìm thấy giá trị đáp án "${row.answer}" của Câu ${row.number} Mã ${ver.code}.`,
            recommendation: 'Kiểm tra lại bảng đáp án tổng hợp.',
          });
        }
      }
    }
  } catch (err) {
    issues.push({
      id: 'exp-ans-docx-invalid',
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'export',
      message: `File Đáp án DOCX không đọc lại được sau khi tạo: ${
        err instanceof Error ? err.message : 'Lỗi không xác định'
      }`,
      recommendation: 'Không phát hành file lỗi.',
    });
  }

  return {
    passed: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}

function parseCsvRows(csvText: string): string[][] {
  const cleaned = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"' && cleaned[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      continue;
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.length > 0));
}

/**
 * Đọc lại tệp CSV đáp án tổng hợp và đối chiếu từng ô `(Câu, Mã đề)` với `answerKeyRows`.
 */
export function verifyExportedCsv(
  csvText: string,
  exam: MathExamProject
): { passed: boolean; issues: MathIntegrityIssue[] } {
  const issues: MathIntegrityIssue[] = [];
  const rows = parseCsvRows(csvText);
  const versions = exam.generatedVersions;
  const maxQ = Math.max(0, ...versions.map((v) => v.answerKeyRows.length));

  if (rows.length !== maxQ + 1) {
    issues.push({
      id: 'exp-csv-row-count',
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'export',
      message: `CSV đáp án tổng hợp có ${rows.length} dòng nhưng mong đợi ${maxQ + 1} dòng (1 tiêu đề + ${maxQ} câu).`,
      recommendation: 'Kiểm tra lại bộ xuất CSV.',
    });
    return { passed: false, issues };
  }

  const expectedHeader = ['Câu', ...versions.map((v) => `Mã ${v.code}`)];
  const actualHeader = rows[0];
  if (
    actualHeader.length !== expectedHeader.length ||
    expectedHeader.some((h, idx) => actualHeader[idx] !== h)
  ) {
    issues.push({
      id: 'exp-csv-header-mismatch',
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'export',
      message: `Tiêu đề cột CSV không khớp danh sách mã đề (${actualHeader.join(', ')}).`,
      recommendation: 'Xuất lại CSV đáp án.',
    });
  }

  for (let qIdx = 0; qIdx < maxQ; qIdx++) {
    const csvRow = rows[qIdx + 1];
    versions.forEach((ver, vIdx) => {
      const expectedAns = ver.answerKeyRows[qIdx]?.answer ?? '';
      const actualAns = csvRow[vIdx + 1] ?? '';
      if (actualAns !== expectedAns) {
        issues.push({
          id: `exp-csv-cell-mismatch-${ver.code}-${qIdx + 1}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          questionNumber: qIdx + 1,
          message: `Ô CSV Câu ${qIdx + 1} Mã ${ver.code} bị lệch: đọc "${actualAns}", mong đợi "${expectedAns}".`,
          recommendation: 'Chặn xuất vì bảng đáp án CSV bị sai lệch so với mã đề đã trộn.',
        });
      }
      if (ver.answerKeyRows[qIdx]?.type === 'true-false' && /\b6{3,}\b/.test(actualAns)) {
        issues.push({
          id: `exp-csv-tf-666-${ver.code}-${qIdx + 1}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          questionNumber: qIdx + 1,
          message: `Ô CSV Câu ${qIdx + 1} Mã ${ver.code} chứa chuỗi lỗi 666/6666 ở câu Đúng/Sai.`,
          recommendation: 'Chặn xuất và kiểm tra khóa câu Đúng/Sai.',
        });
      }
    });
  }

  return {
    passed: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}

/**
 * Đóng gói trọn bộ ZIP gồm:
 * - de-hoc-sinh/Ma_de_<CODE>.docx (cho từng mã đề)
 * - dap-an/Dap_an_va_Anh_xa.docx
 * - dap-an/Bang_dap_an_tong_hop.csv
 * - dap-an/Bang_anh_xa_hoan_vi.json
 * - kiem-chung/Bao_cao_toan_ven.json
 * - manifest.json
 * Sau đó chạy kiểm chứng ngược ZIP + từng file DOCX bên trong (Layer 7: Export Integrity).
 */
export async function exportMixedExamZipBundle(
  exam: MathExamProject,
  formTemplate?: ExamFormTemplate
): Promise<{
  zipBytes: Uint8Array;
  fileName: string;
  integrity: ExportIntegrityResult;
}> {
  const gate = checkExamExportGate(exam);
  if (!gate.canExport) {
    throw new Error(`Xuất ZIP bị CHẶN (BLOCKED): ${gate.blockingReasons.join(' ')}`);
  }

  const zip = new JSZip();
  const manifestEntries: Array<{ path: string; bytes: number; shaFnv: string }> = [];

  for (const ver of exam.generatedVersions) {
    const docxBytes = await buildStudentExamDocxBuffer(exam, ver, formTemplate);
    const entryPath = `de-hoc-sinh/Ma_de_${ver.code}.docx`;
    zip.file(entryPath, docxBytes);
    manifestEntries.push({
      path: entryPath,
      bytes: docxBytes.byteLength,
      shaFnv: computeContentHash(`${entryPath}:${docxBytes.byteLength}`),
    });

    const perCodeAnsBytes = await buildPerCodeAnswerKeyDocxBuffer(exam, ver, formTemplate);
    const perCodeAnsPath = `dap-an/Dap_an_${ver.code}.docx`;
    zip.file(perCodeAnsPath, perCodeAnsBytes);
    manifestEntries.push({
      path: perCodeAnsPath,
      bytes: perCodeAnsBytes.byteLength,
      shaFnv: computeContentHash(`${perCodeAnsPath}:${perCodeAnsBytes.byteLength}`),
    });
  }

  const answerDocx = await buildAnswerKeyDocxBuffer(exam, formTemplate);
  zip.file('dap-an/Dap_an_va_Anh_xa.docx', answerDocx);
  manifestEntries.push({
    path: 'dap-an/Dap_an_va_Anh_xa.docx',
    bytes: answerDocx.byteLength,
    shaFnv: computeContentHash(`dap-an/Dap_an_va_Anh_xa.docx:${answerDocx.byteLength}`),
  });

  const csvContent = buildConsolidatedAnswerCsv(exam);
  zip.file('dap-an/Bang_dap_an_tong_hop.csv', csvContent);

  const mappingPayload = exam.generatedVersions.map((v) => ({
    code: v.code,
    seedUsed: v.seedUsed,
    integrityStatus: v.integrityStatus ?? 'PASS',
    answerKeyRows: v.answerKeyRows,
    permutationMap: v.permutationMap,
  }));
  zip.file('dap-an/Bang_anh_xa_hoan_vi.json', JSON.stringify(mappingPayload, null, 2));

  const integrityPayload = {
    checkedAt: new Date().toISOString(),
    examId: exam.id,
    examTitle: exam.title,
    subject: exam.subject,
    subjectId: resolveSubjectId(exam.subjectId || exam.subject),
    formTemplateId: formTemplate?.id ?? null,
    formTemplateName: formTemplate?.name ?? null,
    preMixReport: exam.lastIntegrityReport ?? null,
    versions: exam.generatedVersions.map((v) => ({
      code: v.code,
      integrityPassed: v.integrityPassed,
      integrityStatus: v.integrityStatus ?? 'PASS',
      warnings: v.integrityWarnings,
    })),
  };
  zip.file('kiem-chung/Bao_cao_toan_ven.json', JSON.stringify(integrityPayload, null, 2));

  const traceabilityPayload = buildSourceToOutputTraceabilityReport(exam);
  zip.file(
    'kiem-chung/Bao_cao_truy_vet_nguon.json',
    JSON.stringify(traceabilityPayload, null, 2)
  );

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        generator: 'TeacherOS Exam Reliability Engine 1.0 + Form Designer',
        exportedAt: new Date().toISOString(),
        examTitle: exam.title,
        subject: exam.subject,
        formTemplateId: formTemplate?.id ?? null,
        formTemplateName: formTemplate?.name ?? null,
        totalCodes: exam.generatedVersions.length,
        codes: exam.generatedVersions.map((v) => v.code),
        files: manifestEntries,
      },
      null,
      2
    )
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const integrity = await verifyExportedZipBundle(zipBytes, exam);
  if (!integrity.verified) {
    throw new Error(
      `Kiểm chứng hậu xuất ZIP thất bại (BLOCKED): ${integrity.issues
        .map((i) => i.message)
        .join(' ')}`
    );
  }

  const safeSlug = exam.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'bo-ma-de';

  return {
    zipBytes,
    fileName: `${safeSlug}-${exam.generatedVersions.length}-ma-de.zip`,
    integrity,
  };
}

/**
 * Đọc lại gói ZIP sau khi đóng gói và kiểm chứng:
 * - Manifest & số lượng file DOCX khớp số mã đề
 * - Từng file DOCX bên trong mở sạch bằng OOXML parser và bảo toàn nội dung / không rò rỉ đáp án
 */
export async function verifyExportedZipBundle(
  zipBytes: Uint8Array | ArrayBuffer,
  exam: MathExamProject
): Promise<ExportIntegrityResult> {
  const issues: MathIntegrityIssue[] = [];
  const verifiedCodes: string[] = [];
  const loaded = await JSZip.loadAsync(zipBytes);
  const allPaths = Object.keys(loaded.files);

  const answerDocxEntry = loaded.file('dap-an/Dap_an_va_Anh_xa.docx');
  const csvEntry = loaded.file('dap-an/Bang_dap_an_tong_hop.csv');
  const mappingJsonEntry = loaded.file('dap-an/Bang_anh_xa_hoan_vi.json');
  const hasManifest = Boolean(loaded.file('manifest.json'));
  const hasAnswerDocx = Boolean(answerDocxEntry);
  const hasCsv = Boolean(csvEntry);
  const hasIntegrityJson = Boolean(loaded.file('kiem-chung/Bao_cao_toan_ven.json'));

  if (!hasManifest || !hasAnswerDocx || !hasCsv || !hasIntegrityJson) {
    issues.push({
      id: 'zip-missing-core-files',
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'export',
      message: 'Gói ZIP xuất ra bị thiếu file manifest, đáp án DOCX, CSV hoặc báo cáo toàn vẹn.',
      recommendation: 'Thực hiện xuất lại bộ đề.',
    });
  }

  for (const ver of exam.generatedVersions) {
    const docxEntry = loaded.file(`de-hoc-sinh/Ma_de_${ver.code}.docx`);
    if (!docxEntry) {
      issues.push({
        id: `zip-missing-code-${ver.code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: `Thiếu file đề học sinh Ma_de_${ver.code}.docx trong gói ZIP.`,
        recommendation: 'Thực hiện xuất lại bộ đề.',
      });
      continue;
    }
    const bytes = await docxEntry.async('uint8array');
    const docxVerify = await verifyExportedDocxBuffer(bytes, ver, exam);
    issues.push(...docxVerify.issues);
    if (docxVerify.passed) {
      verifiedCodes.push(ver.code);
    }

    const perCodeAnsEntry = loaded.file(`dap-an/Dap_an_${ver.code}.docx`);
    if (!perCodeAnsEntry) {
      issues.push({
        id: `zip-missing-percode-ans-${ver.code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: `Thiếu file đáp án riêng dap-an/Dap_an_${ver.code}.docx trong gói ZIP.`,
        recommendation: 'Thực hiện xuất lại bộ đề.',
      });
    } else {
      const perCodeText = (await extractDocxDocument(await perCodeAnsEntry.async('uint8array'))).plainTextWithMarkers;
      if (!perCodeText.includes(`MÃ ĐỀ ${ver.code}`) && !perCodeText.includes(`Mã đề ${ver.code}`)) {
        issues.push({
          id: `zip-invalid-percode-ans-${ver.code}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          message: `File đáp án riêng Dap_an_${ver.code}.docx không chứa đúng mã đề ${ver.code}.`,
          recommendation: 'Thực hiện xuất lại bộ đề.',
        });
      }
    }
  }

  let answerDocxPassed = false;
  if (answerDocxEntry) {
    const ansBytes = await answerDocxEntry.async('uint8array');
    const ansVerify = await verifyExportedAnswerKeyDocxBuffer(ansBytes, exam);
    answerDocxPassed = ansVerify.passed;
    issues.push(...ansVerify.issues);
  }

  let csvPassed = false;
  if (csvEntry) {
    const csvText = await csvEntry.async('string');
    const csvVerify = verifyExportedCsv(csvText, exam);
    csvPassed = csvVerify.passed;
    issues.push(...csvVerify.issues);
  }

  if (mappingJsonEntry) {
    try {
      const parsedMap = JSON.parse(await mappingJsonEntry.async('string')) as Array<{
        code: string;
        answerKeyRows?: Array<{ answer: string }>;
      }>;
      if (!Array.isArray(parsedMap) || parsedMap.length !== exam.generatedVersions.length) {
        issues.push({
          id: 'zip-mapping-json-count',
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          message: 'Tệp Bang_anh_xa_hoan_vi.json không khớp số lượng mã đề.',
          recommendation: 'Thực hiện xuất lại gói ZIP.',
        });
      }
    } catch {
      issues.push({
        id: 'zip-mapping-json-invalid',
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: 'Tệp Bang_anh_xa_hoan_vi.json không đọc lại được (JSON lỗi).',
        recommendation: 'Thực hiện xuất lại gói ZIP.',
      });
    }
  }

  const hasError = issues.some((i) => i.severity === 'error');
  const hasWarn = issues.some((i) => i.severity === 'warning');

  return {
    verified: !hasError,
    status: hasError ? 'BLOCKED' : hasWarn ? 'WARNING' : 'PASS',
    checkedAt: new Date().toISOString(),
    format: 'zip',
    fileCount: allPaths.length,
    verifiedCodes,
    checks: [
      {
        id: 'zip-manifest',
        label: 'Manifest & tệp đáp án/mapping',
        passed: hasManifest && hasAnswerDocx && hasCsv && hasIntegrityJson,
        detail: `${allPaths.length} tệp trong gói ZIP (DOCX, CSV, JSON, Manifest).`,
      },
      {
        id: 'zip-student-docx',
        label: 'Kiểm chứng ngược OOXML từng đề học sinh',
        passed: verifiedCodes.length === exam.generatedVersions.length && !hasError,
        detail: `${verifiedCodes.length}/${exam.generatedVersions.length} mã đề mở đọc lại hợp lệ, đúng thứ tự câu/phương án, không rò rỉ đáp án, không còn placeholder OLE.`,
      },
      {
        id: 'zip-answer-docx',
        label: 'Kiểm chứng ngược Đáp án DOCX giáo viên',
        passed: answerDocxPassed,
        detail: answerDocxPassed
          ? `Khớp toàn bộ ${exam.generatedVersions.length} mã đề và bảng đáp án trong Dap_an_va_Anh_xa.docx.`
          : 'Phát hiện sai lệch trong tệp đáp án DOCX.',
      },
      {
        id: 'zip-answer-csv',
        label: 'Kiểm chứng từng ô bảng đáp án CSV',
        passed: csvPassed,
        detail: csvPassed
          ? 'Từng ô (Câu × Mã đề) trong CSV khớp 100% với bảng ánh xạ hoán vị.'
          : 'Phát hiện lệch ô đáp án trong CSV.',
      },
    ],
    issues,
  };
}

/**
 * Kiểm toán độc lập một gói ZIP TeacherOS bất kỳ (không cần `MathExamProject` trong bộ nhớ).
 * Phát hiện và chặn các lỗi chí mạng như:
 * - Còn placeholder `[CÔNG_THỨC_OLE_LEGACY]` / `[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]`
 * - Phương án MCQ rỗng hoặc chỉ có dấu câu (`A. .`, `B. .`)
 * - Lệch số câu khai báo trong tiêu đề Phần so với số câu thực tế xuất ra (VD: ghi 12 câu nhưng xuất 13 câu)
 * - Trùng nội dung câu hỏi giữa 2 ID khác nhau trong cùng một mã đề
 * - Câu Phần I (trắc nghiệm 1 đáp án) bị gán nhầm `short-answer` hoặc `multi-select`
 * - Câu Phần II Đúng/Sai bị lưu thành `short-answer` hoặc mang chuỗi lỗi `666`/`6666`
 *   (ngay cả khi CSV, JSON và DOCX đáp án cùng đồng nhất giá trị sai đó!)
 * - Sai lệch chéo giữa `Bang_dap_an_tong_hop.csv`, `Bang_anh_xa_hoan_vi.json`, `Dap_an_va_Anh_xa.docx` và đề học sinh.
 */
export async function auditUnknownExamZipBundle(
  zipBytes: Uint8Array | ArrayBuffer
): Promise<{
  passed: boolean;
  codesInspected: string[];
  issues: MathIntegrityIssue[];
}> {
  const issues: MathIntegrityIssue[] = [];
  const codesInspected: string[] = [];

  let loaded: JSZip;
  try {
    loaded = await JSZip.loadAsync(zipBytes);
  } catch (err) {
    issues.push({
      id: 'audit-zip-corrupt',
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'export',
      message: `Không thể giải nén gói ZIP: ${err instanceof Error ? err.message : 'Tệp hỏng'}`,
      recommendation: 'Kiểm tra lại tệp ZIP trước khi sử dụng.',
    });
    return { passed: false, codesInspected, issues };
  }

  const allPaths = Object.keys(loaded.files);
  const studentDocxPaths = allPaths
    .filter((p) => /^de-hoc-sinh\/Ma_de_[^/]+\.docx$/i.test(p))
    .sort();
  const answerDocxEntry = loaded.file('dap-an/Dap_an_va_Anh_xa.docx');
  const csvEntry = loaded.file('dap-an/Bang_dap_an_tong_hop.csv');
  const mappingJsonEntry = loaded.file('dap-an/Bang_anh_xa_hoan_vi.json');

  if (studentDocxPaths.length === 0) {
    issues.push({
      id: 'audit-zip-no-student-docx',
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'export',
      message: 'Gói ZIP không có tệp đề học sinh nào trong thư mục de-hoc-sinh/.',
      recommendation: 'Xuất lại gói đề hoàn chỉnh.',
    });
  }

  // 1. Kiểm tra từng file đề học sinh DOCX
  const studentQuestionCountsByCode = new Map<string, number>();
  for (const path of studentDocxPaths) {
    const codeMatch = path.match(/Ma_de_([^/]+)\.docx$/i);
    const code = codeMatch ? codeMatch[1] : path;
    codesInspected.push(code);

    const entry = loaded.file(path);
    if (!entry) continue;
    try {
      const bytes = await entry.async('uint8array');
      const extracted = await extractDocxDocument(bytes);
      const text = extracted.plainTextWithMarkers;

      if (
        text.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
        text.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]')
      ) {
        const count =
          (text.match(/\[CÔNG_THỨC_OLE_LEGACY\]/g)?.length ?? 0) +
          (text.match(/\[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA\]/g)?.length ?? 0);
        issues.push({
          id: `audit-student-placeholder-${code}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          code,
          message: `Mã đề ${code} (${path}): Chứa ${count} placeholder công thức chưa giải mã ([CÔNG_THỨC_OLE_LEGACY]).`,
          recommendation: 'Chặn phát hành; giải mã công thức hoặc xuất qua ảnh WMF preview hợp lệ.',
        });
      }

      if (/(?:Đáp án đúng\s*:|Bảng đáp án tổng hợp|BẢNG ÁNH XẠ HOÁN VỊ)/i.test(text)) {
        issues.push({
          id: `audit-student-leak-${code}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          code,
          message: `Mã đề ${code} (${path}): Phát hiện dấu hiệu rò rỉ đáp án trong đề học sinh.`,
          recommendation: 'Không phát hành file này cho học sinh.',
        });
      }

      // Kiểm tra phương án MCQ chỉ có dấu câu (A. ., B. ., C. ., D. .) không kèm hình ảnh
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const emptyOptPattern = /(?:^|\s)([ABCD])\.\s*[.,;:–-]+\s*(?=(?:[ABCD]\.)|$)/;
      let totalQuestionsInCode = 0;
      const seenStems = new Map<string, number>();

      // Theo dõi số câu khai báo theo phần so với số câu thực tế trong DOCX
      let activeSectionTitle = '';
      let activeSectionDeclaredCount: number | undefined;
      let activeSectionActualCount = 0;
      const flushSectionCountAudit = () => {
        if (
          activeSectionTitle &&
          activeSectionDeclaredCount !== undefined &&
          activeSectionActualCount !== activeSectionDeclaredCount
        ) {
          issues.push({
            id: `audit-section-count-${code}-${activeSectionTitle.slice(0, 18)}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'export',
            code,
            sectionTitle: activeSectionTitle,
            message: `Mã đề ${code}: Tiêu đề "${activeSectionTitle}" khai báo ${activeSectionDeclaredCount} câu nhưng thực tế có ${activeSectionActualCount} câu.`,
            recommendation: 'Đếm lại số câu thực tế và loại bỏ câu thừa trước khi xuất.',
          });
        }
      };

      for (const ln of lines) {
        if (/^PHẦN\s+(?:I|II|III|IV|\d+)\b/i.test(ln)) {
          flushSectionCountAudit();
          activeSectionTitle = ln;
          activeSectionActualCount = 0;
          const mRange = ln.match(/từ\s+câu\s+(\d+)\s+đến\s+(?:câu\s+)?(\d+)/i);
          const mGom = ln.match(/(?:gồm|\()\s*(\d+)\s*câu\b/i);
          if (mRange) {
            const a = Number(mRange[1]);
            const b = Number(mRange[2]);
            activeSectionDeclaredCount = b >= a ? b - a + 1 : undefined;
          } else if (mGom) {
            activeSectionDeclaredCount = Number(mGom[1]);
          } else {
            activeSectionDeclaredCount = undefined;
          }
          continue;
        }

        const qMatch = ln.match(/^Câu\s+(\d{1,3})\s*[:.]\s*(.+)$/i);
        if (qMatch) {
          totalQuestionsInCode += 1;
          activeSectionActualCount += 1;
          const qNo = Number(qMatch[1]);
          const stemNorm = qMatch[2]
            .replace(/\[\[ASSET:[^\]]+\]\]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
          if (stemNorm.length >= 24) {
            const prevNo = seenStems.get(stemNorm);
            if (prevNo !== undefined) {
              issues.push({
                id: `audit-dup-stem-${code}-${prevNo}-${qNo}`,
                severity: 'error',
                tier: 'BLOCKED',
                scope: 'export',
                code,
                questionNumber: qNo,
                message: `Mã đề ${code}: Câu ${qNo} trùng nội dung với Câu ${prevNo} ("${qMatch[2].slice(0, 60)}...").`,
                recommendation: 'Loại bỏ câu bị nhân bản trước khi trộn và xuất.',
              });
            } else {
              seenStems.set(stemNorm, qNo);
            }
          }
        }

        if (!ln.includes('[[ASSET:')) {
          const emptyOpt = ln.match(emptyOptPattern);
          if (emptyOpt) {
            issues.push({
              id: `audit-empty-opt-${code}-${totalQuestionsInCode || 0}-${emptyOpt[1]}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'export',
              code,
              questionNumber: totalQuestionsInCode || undefined,
              optionOrStatementLabel: emptyOpt[1],
              message: `Mã đề ${code} (Câu ${totalQuestionsInCode || '?'}): Phương án ${emptyOpt[1]} bị mất nội dung, chỉ còn dấu câu ("${ln.slice(0, 60)}").`,
              recommendation: 'Khôi phục công thức/hình ảnh của phương án trước khi phát hành.',
            });
          }
        }
      }
      flushSectionCountAudit();
      studentQuestionCountsByCode.set(code, totalQuestionsInCode);
    } catch (err) {
      issues.push({
        id: `audit-student-docx-unreadable-${code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        code,
        message: `Mã đề ${code}: Không thể đọc file DOCX (${err instanceof Error ? err.message : 'Lỗi không xác định'}).`,
        recommendation: 'Xuất lại gói đề.',
      });
    }
  }

  // 2. Kiểm tra Bang_anh_xa_hoan_vi.json & phát hiện sai loại câu / chuỗi 666/6666 / trùng ID
  type RawMappingVersion = {
    code: string;
    answerKeyRows?: Array<{
      number: number;
      questionId?: string;
      originalCode?: string;
      type?: string;
      universalType?: string;
      sectionTitle?: string;
      answer: string;
    }>;
    permutationMap?: Array<{
      newNumber: number;
      originalQuestionId?: string;
      originalCode?: string;
      questionType?: string;
      universalType?: string;
    }>;
  };
  let mappingVersions: RawMappingVersion[] = [];
  if (mappingJsonEntry) {
    try {
      const parsed = JSON.parse(await mappingJsonEntry.async('string')) as unknown;
      if (Array.isArray(parsed)) {
        mappingVersions = parsed as RawMappingVersion[];
      }
    } catch {
      issues.push({
        id: 'audit-mapping-json-corrupt',
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: 'Tệp dap-an/Bang_anh_xa_hoan_vi.json bị lỗi cú pháp JSON.',
        recommendation: 'Xuất lại gói ZIP.',
      });
    }
  }

  for (const mv of mappingVersions) {
    const code = mv.code;
    const rows = mv.answerKeyRows ?? [];
    const seenOrigIds = new Set<string>();
    const studentCount = studentQuestionCountsByCode.get(code);
    if (studentCount !== undefined && rows.length > 0 && studentCount !== rows.length) {
      issues.push({
        id: `audit-code-count-mismatch-${code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        code,
        message: `Mã đề ${code}: Đề học sinh có ${studentCount} câu nhưng bảng đáp án JSON có ${rows.length} câu.`,
        recommendation: 'Đồng bộ lại số lượng câu giữa đề học sinh và đáp án.',
      });
    }

    rows.forEach((row) => {
      const ans = String(row.answer ?? '').trim();
      const sec = String(row.sectionTitle ?? '');
      const isPartI =
        /PHẦN\s*(?:I|1)\b|NHIỀU\s*PHƯƠNG\s*ÁN/i.test(sec) &&
        !/PHẦN\s*(?:II|III|IV)\b|ĐÚNG|TRẢ\s*LỜI\s*NGẮN/i.test(sec);
      const isPartII = /PHẦN\s*II\b|ĐÚNG\s*[-–/]\s*SAI/i.test(sec);

      if (row.questionId) {
        if (seenOrigIds.has(row.questionId)) {
          issues.push({
            id: `audit-dup-qid-${code}-${row.questionId}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'export',
            code,
            questionId: row.questionId,
            questionNumber: row.number,
            message: `Mã đề ${code}: Câu ${row.number} lặp lại questionId "${row.questionId}".`,
            recommendation: 'Loại bỏ câu hỏi bị lặp.',
          });
        }
        seenOrigIds.add(row.questionId);
      }

      // Chặn chuỗi lỗi 666/6666 ngay cả khi type đã bị lưu sai thành short-answer!
      if (/^6{3,}$/.test(ans) && (row.type === 'true-false' || isPartII || row.type === 'short-answer')) {
        issues.push({
          id: `audit-corrupt-666-${code}-${row.number}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          code,
          questionId: row.questionId,
          questionNumber: row.number,
          message: `Mã đề ${code} Câu ${row.number} (${row.originalCode ?? row.questionId ?? ''}): Đáp án chứa chuỗi lỗi legacy "${ans}" (kiểu="${row.type ?? '?'}").`,
          recommendation: 'Sửa lại đúng kiểu Đúng/Sai a/b/c/d và xác minh khóa đáp án trước khi xuất.',
        });
      }

      if (isPartI && row.type === 'short-answer') {
        issues.push({
          id: `audit-part1-short-answer-${code}-${row.number}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          code,
          questionId: row.questionId,
          questionNumber: row.number,
          message: `Mã đề ${code} Câu ${row.number} (${row.originalCode ?? ''}): Nằm trong Phần I Trắc nghiệm 1 đáp án nhưng bị lưu kiểu short-answer.`,
          recommendation: 'Chuyển đúng kiểu câu hỏi hoặc đưa về đúng Phần.',
        });
      }

      if (isPartI && row.type === 'mcq' && row.universalType === 'multi-select') {
        issues.push({
          id: `audit-part1-multiselect-${code}-${row.number}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          code,
          questionId: row.questionId,
          questionNumber: row.number,
          message: `Mã đề ${code} Câu ${row.number} (${row.originalCode ?? ''}): Nằm trong Phần I Trắc nghiệm 1 đáp án nhưng lệch type="mcq" / universalType="multi-select".`,
          recommendation: 'Đồng bộ universalType="mcq".',
        });
      }

      if (isPartII && row.type !== 'true-false') {
        issues.push({
          id: `audit-part2-wrong-type-${code}-${row.number}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          code,
          questionId: row.questionId,
          questionNumber: row.number,
          message: `Mã đề ${code} Câu ${row.number} (${row.originalCode ?? ''}): Nằm trong Phần II Đúng/Sai nhưng mang kiểu "${row.type ?? '?'}".`,
          recommendation: 'Khôi phục kiểu true-false với 4 mệnh đề a/b/c/d.',
        });
      }
    });
  }

  // 3. Đối chiếu chéo CSV với JSON & Answer DOCX (không chấp nhận chỉ cần 3 file trùng nhau là đúng)
  if (csvEntry) {
    const csvText = await csvEntry.async('string');
    const csvRows = parseCsvRows(csvText);
    if (csvRows.length >= 2) {
      const headers = csvRows[0];
      for (let r = 1; r < csvRows.length; r++) {
        for (let c = 1; c < csvRows[r].length; c++) {
          const val = (csvRows[r][c] ?? '').trim();
          if (/^6{3,}$/.test(val)) {
            issues.push({
              id: `audit-csv-666-${r}-${c}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'export',
              questionNumber: r,
              message: `CSV đáp án (${headers[c] ?? `cột ${c}`}, Câu ${r}): Chứa giá trị lỗi legacy "${val}".`,
              recommendation: 'Không phát hành bảng đáp án chứa chuỗi 666/6666.',
            });
          }
        }
      }
      if (mappingVersions.length > 0) {
        mappingVersions.forEach((mv, mIdx) => {
          const colIdx = headers.findIndex((h) => h.includes(mv.code));
          const resolvedCol = colIdx >= 1 ? colIdx : mIdx + 1;
          (mv.answerKeyRows ?? []).forEach((row, rIdx) => {
            const csvVal = (csvRows[rIdx + 1]?.[resolvedCol] ?? '').trim();
            if (csvVal !== String(row.answer ?? '').trim()) {
              issues.push({
                id: `audit-csv-json-diff-${mv.code}-${row.number}`,
                severity: 'error',
                tier: 'BLOCKED',
                scope: 'export',
                code: mv.code,
                questionNumber: row.number,
                message: `Mã đề ${mv.code} Câu ${row.number}: Lệch đáp án giữa CSV ("${csvVal}") và JSON ("${row.answer}").`,
                recommendation: 'Xuất lại toàn bộ gói đáp án từ cùng một nguồn.',
              });
            }
          });
        });
      }
    }
  }

  if (answerDocxEntry) {
    try {
      const ansBytes = await answerDocxEntry.async('uint8array');
      const ansExtracted = await extractDocxDocument(ansBytes);
      const ansText = ansExtracted.plainTextWithMarkers;
      if (ansText.includes('[CÔNG_THỨC_OLE_LEGACY]')) {
        issues.push({
          id: 'audit-answer-docx-placeholder',
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          message: 'Tệp dap-an/Dap_an_va_Anh_xa.docx chứa placeholder [CÔNG_THỨC_OLE_LEGACY].',
          recommendation: 'Xử lý triệt để công thức trước khi xuất.',
        });
      }
      if (/\b6666?\b/.test(ansText)) {
        issues.push({
          id: 'audit-answer-docx-666',
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'export',
          message: 'Tệp dap-an/Dap_an_va_Anh_xa.docx chứa chuỗi đáp án lỗi 666/6666.',
          recommendation: 'Kiểm tra và sửa lại toàn bộ câu Đúng/Sai bị hỏng khóa.',
        });
      }
    } catch {
      issues.push({
        id: 'audit-answer-docx-corrupt',
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: 'Không thể đọc tệp dap-an/Dap_an_va_Anh_xa.docx.',
        recommendation: 'Xuất lại gói đáp án.',
      });
    }
  }

  return {
    passed: issues.every((i) => i.severity !== 'error'),
    codesInspected,
    issues,
  };
}

/**
 * Kiểm định hậu xuất toàn diện cho một file DOCX đã áp dụng Exam Form Template (Phase 3):
 * - Mở lại ZIP & kiểm tra cấu trúc OOXML hợp lệ
 * - Đếm số câu, công thức OMML / MathType / ảnh nhúng
 * - Đảm bảo 0% rò rỉ đáp án học sinh & nguyên vẹn ánh xạ hoán vị
 * - Báo cáo trung thực visualRenderStatus = 'NOT_TESTED' khi chạy trong trình duyệt
 */
export async function runExamFormPostExportAudit(
  docxBytes: Uint8Array | ArrayBuffer,
  exam: MathExamProject,
  version: MixedExamVersion,
  template?: ExamFormTemplate
): Promise<ExamFormPostExportAuditReport> {
  const checkedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  let ooxmlValid = false;
  let ommlCount = 0;
  let mathTypeCount = 0;
  let embeddedMediaCount = 0;
  let hasLogoMedia = false;
  let zeroAnswerLeak = true;

  try {
    const zip = await JSZip.loadAsync(docxBytes);
    const docEntry = zip.file('word/document.xml');
    const relsEntry = zip.file('word/_rels/document.xml.rels');
    const typesEntry = zip.file('[Content_Types].xml');
    ooxmlValid = Boolean(docEntry && relsEntry && typesEntry);

    if (docEntry) {
      const xml = await docEntry.async('string');
      ommlCount = (xml.match(/<m:oMath\b/g) ?? []).length;
      mathTypeCount = (xml.match(/docx-ole-svg-/g) ?? []).length;
      if (
        xml.includes('BẢNG ĐÁP ÁN TỔNG HỢP') ||
        xml.includes('PHẦN LỜI GIẢI CHI TIẾT')
      ) {
        zeroAnswerLeak = false;
        errors.push('Phát hiện rò rỉ khối bảng đáp án hoặc lời giải trong file đề học sinh.');
      }
      if (template?.headerSettings.schoolLogoDataUrl?.trim()) {
        hasLogoMedia = xml.includes('school-logo');
      }
    }
    embeddedMediaCount = Object.keys(zip.files).filter((p) =>
      p.startsWith('word/media/')
    ).length;
  } catch (err) {
    ooxmlValid = false;
    errors.push(
      `Không thể đọc cấu trúc OOXML của file DOCX: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const bufCheck = await verifyExportedDocxBuffer(docxBytes, version, exam);
  for (const issue of bufCheck.issues) {
    if (issue.severity === 'error') errors.push(issue.message);
    else warnings.push(issue.message);
  }

  const rtCheck = await verifyExportedDocxRoundTrip(docxBytes, version, exam);
  for (const issue of rtCheck.issues) {
    if (issue.severity === 'error') errors.push(issue.message);
    else warnings.push(issue.message);
  }

  const answerMappingIntact =
    version.answerKeyRows.length === version.questions.length &&
    version.permutationMap.length === version.questions.length;
  if (!answerMappingIntact) {
    errors.push('Số lượng dòng bảng đáp án hoặc bảng ánh xạ hoán vị không khớp số câu hỏi.');
  }

  return {
    checkedAt,
    examCode: version.code,
    ooxmlValid,
    questionCountMatched: rtCheck.reimportedQuestionCount === version.questions.length,
    expectedQuestions: version.questions.length,
    foundQuestions: rtCheck.reimportedQuestionCount,
    ommlCount,
    mathTypeCount,
    embeddedMediaCount,
    hasLogoMedia,
    zeroAnswerLeak,
    roundTripPassed: rtCheck.passed,
    answerMappingIntact,
    visualRenderStatus: 'NOT_TESTED',
    visualRenderNote:
      'Trình duyệt không chạy Microsoft Word / LibreOffice để kiểm tra hiển thị thị giác; đã xác minh đầy đủ cấu trúc OOXML, số câu, hình/công thức và khóa đáp án.',
    errors,
    warnings,
  };
}
