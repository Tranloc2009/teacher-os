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
  checkExamExportGate,
  computeContentHash,
  getOptionLetterLabel,
  getStatementLetterLabel,
  sanitizeSvgSource,
} from './mathIntegrity';
import { extractDocxDocument } from './ooxmlParser';
import { getSubjectProfile, getUniversalQuestionType, resolveSubjectId } from './subjectProfileRegistry';

export const DEFAULT_EXAM_EXPORT_SETTINGS: ExamExportSettings = {
  departmentName: 'SỞ GIÁO DỤC VÀ ĐÀO TẠO',
  schoolName: 'TRƯỜNG THPT / THCS',
  examTitleOverride: '',
  headerNote: 'Không sử dụng tài liệu khi làm bài.',
  footerNote: 'Thí sinh không viết vào phần đề thi trừ khi giáo viên cho phép.',
  paperMarginMm: 15,
  fontFamily: 'Be Vietnam Pro',
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
    indentLeft?: number;
    keepNext?: boolean;
  }
): string {
  const pPr: string[] = [];
  if (opts?.align) pPr.push(`<w:jc w:val="${opts.align}"/>`);
  if (opts?.spacingBefore !== undefined || opts?.spacingAfter !== undefined) {
    pPr.push(
      `<w:spacing w:before="${opts.spacingBefore ?? 0}" w:after="${opts.spacingAfter ?? 80}"/>`
    );
  } else {
    pPr.push('<w:spacing w:before="0" w:after="80"/>');
  }
  if (opts?.indentLeft) {
    pPr.push(`<w:ind w:left="${opts.indentLeft}"/>`);
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

function makeDrawingParagraphXml(media: EmbeddedMediaEntry): string {
  // 4.5 inches x 2.6 inches in EMU (914400 EMU = 1 inch)
  const cx = 4114800;
  const cy = 2377440;
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="80"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${media.docPrId}" name="${escapeXml(
    media.name
  )}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${media.docPrId}" name="${escapeXml(
    media.name
  )}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${media.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
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
    bodyChunks.push(makeDrawingParagraphXml(media));
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
  fontFamily: string
): void {
  const uType = getUniversalQuestionType(q);
  const stemText = formatContentPayloadForText(q.stem);

  // Stem line — TUYỆT ĐỐI không in đáp án hay giải thích vào đề học sinh
  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml(`Câu ${qNumber}: `, { bold: true, fontFamily }) +
        renderStyledRunsXml(stemText, { fontFamily }),
      { spacingBefore: 100, spacingAfter: 40 }
    )
  );

  // Embedded Question visual assets (images / tables / SVG graphs)
  for (const asset of q.visualAssets ?? []) {
    appendVisualAssetToBody(bodyChunks, asset, mediaList, fontFamily);
  }

  if (uType === 'multi-select') {
    const opts = q.multiSelectOptions ?? q.options ?? [];
    opts.forEach((opt, oIdx) => {
      const lbl = getOptionLetterLabel(oIdx);
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`${lbl}. `, { bold: true, fontFamily }) +
            renderStyledRunsXml(formatContentPayloadForText(opt.content), { fontFamily }),
          { indentLeft: 360, spacingBefore: 20, spacingAfter: 20 }
        )
      );
    });
  } else if (q.type === 'mcq' && q.options) {
    q.options.forEach((opt, oIdx) => {
      const lbl = MCQ_LABELS[oIdx] ?? getOptionLetterLabel(oIdx);
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`${lbl}. `, { bold: true, fontFamily }) +
            renderStyledRunsXml(formatContentPayloadForText(opt.content), { fontFamily }),
          { indentLeft: 360, spacingBefore: 20, spacingAfter: 20 }
        )
      );
    });
  } else if (q.type === 'true-false' && q.statements) {
    q.statements.forEach((st, sIdx) => {
      const lbl = TF_LABELS[sIdx] ?? getStatementLetterLabel(sIdx);
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`${lbl}) `, { bold: true, fontFamily }) +
            renderStyledRunsXml(formatContentPayloadForText(st.content), { fontFamily }),
          { indentLeft: 360, spacingBefore: 20, spacingAfter: 20 }
        )
      );
    });
  } else if (uType === 'fill-blank' && q.fillBlank?.wordBank && q.fillBlank.wordBank.length > 0) {
    const bankLine = q.fillBlank.wordBank
      .map((w, idx) => `${getOptionLetterLabel(idx)}. ${formatContentPayloadForText(w.content)}`)
      .join('    ');
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml('Ngân hàng từ gợi ý: ', { italic: true, fontFamily }) +
          renderStyledRunsXml(bankLine, { fontFamily }),
        { indentLeft: 360, spacingBefore: 20, spacingAfter: 40 }
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
          renderStyledRunsXml(`${lbl} `, { bold: true, fontFamily }) +
            renderStyledRunsXml(formatContentPayloadForText(item.content), { fontFamily }),
          { indentLeft: 360, spacingBefore: 20, spacingAfter: 20 }
        )
      );
    });
  } else if (q.type === 'essay' && q.essayParts && q.essayParts.length > 0) {
    q.essayParts.forEach((part) => {
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`${part.label} (${part.points} điểm) `, { bold: true, fontFamily }) +
            renderStyledRunsXml(formatContentPayloadForText(part.content), { fontFamily }),
          { indentLeft: 360, spacingBefore: 20, spacingAfter: 20 }
        )
      );
    });
  }
}

async function packageOoxmlDocxBuffer(params: {
  bodyXml: string;
  mediaList: EmbeddedMediaEntry[];
  marginMm: 10 | 15 | 20;
  fontFamily: string;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  const twipsMargin = Math.round(params.marginMm * 56.7);

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
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
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
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    ${params.bodyXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="${twipsMargin}" w:right="${twipsMargin}" w:bottom="${twipsMargin}" w:left="${twipsMargin}" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);
  zip.file('word/styles.xml', stylesXml);
  zip.file('word/document.xml', documentXml);
  for (const media of params.mediaList) {
    zip.file(`word/${media.target}`, media.bytes);
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * Tạo file Word (.docx) đề thi dành riêng cho HỌC SINH cho một mã đề cụ thể.
 * Đảm bảo 0% rò rỉ đáp án hoặc lời giải.
 */
export async function buildStudentExamDocxBuffer(
  exam: MathExamProject,
  version: MixedExamVersion
): Promise<Uint8Array> {
  const gate = checkExamExportGate(exam);
  if (!gate.canExport) {
    throw new Error(`Xuất DOCX bị CHẶN (BLOCKED): ${gate.blockingReasons.join(' ')}`);
  }

  const settings = resolveExportSettings(exam);
  const subjectProfile = getSubjectProfile(resolveSubjectId(exam.subjectId || exam.subject));
  const examTitle = settings.examTitleOverride.trim() || exam.title;
  const fontFamily = settings.fontFamily;
  const bodyChunks: string[] = [];
  const mediaList: EmbeddedMediaEntry[] = [];

  // Banner Header Table (2 cột: Đơn vị + Thông tin đề & Mã đề)
  const headerTableRows = [
    [
      `${settings.departmentName}\n${settings.schoolName}\n(Đề thi gồm ${version.questions.length} câu hỏi)`,
      `${examTitle.toUpperCase()}\nMôn: ${subjectProfile.name} · ${exam.grade} · Thời gian: ${exam.durationMinutes} phút\nMÃ ĐỀ: ${version.code}`,
    ],
  ];
  bodyChunks.push(makeWordTableXml(headerTableRows, fontFamily, false));

  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml('Họ và tên thí sinh: ........................................................   Số báo danh: ........................', {
        fontFamily,
        sizeHalfPt: 22,
      }),
      { spacingBefore: 100, spacingAfter: 60 }
    )
  );
  if (settings.headerNote.trim()) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml(settings.headerNote, { italic: true, sizeHalfPt: 20, fontFamily, color: '475569' }),
        { spacingBefore: 0, spacingAfter: 80 }
      )
    );
  }

  const groupMap = new Map<string, QuestionGroup>(
    (exam.questionGroups ?? []).map((g) => [g.id, g])
  );
  const renderedGroups = new Set<string>();
  let currentSection = '';

  version.questions.forEach((q, idx) => {
    if (q.sectionTitle && q.sectionTitle !== currentSection) {
      currentSection = q.sectionTitle;
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(currentSection, { bold: true, sizeHalfPt: 24, fontFamily }),
          { spacingBefore: 140, spacingAfter: 60, keepNext: true }
        )
      );
    }

    if (q.groupId && !renderedGroups.has(q.groupId) && groupMap.has(q.groupId)) {
      renderedGroups.add(q.groupId);
      const grp = groupMap.get(q.groupId)!;
      bodyChunks.push(
        makeParagraphXml(
          renderStyledRunsXml(`[Ngữ liệu nhóm] ${grp.title}`, {
            bold: true,
            italic: true,
            sizeHalfPt: 22,
            fontFamily,
            color: '1E3A8A',
          }),
          { spacingBefore: 100, spacingAfter: 30 }
        )
      );
      if (grp.sharedContext.rawSource.trim()) {
        bodyChunks.push(
          makeParagraphXml(
            renderStyledRunsXml(grp.sharedContext.rawSource, { fontFamily, sizeHalfPt: 22 }),
            { indentLeft: 180, spacingBefore: 20, spacingAfter: 60 }
          )
        );
      }
      for (const sAsset of grp.sharedAssets) {
        appendVisualAssetToBody(bodyChunks, sAsset, mediaList, fontFamily);
      }
    }

    renderStudentQuestionXml(q, idx + 1, bodyChunks, mediaList, fontFamily);
  });

  bodyChunks.push(
    makeParagraphXml(
      renderStyledRunsXml('——— HẾT ———', { bold: true, fontFamily }),
      { align: 'center', spacingBefore: 160, spacingAfter: 40 }
    )
  );
  if (settings.footerNote.trim()) {
    bodyChunks.push(
      makeParagraphXml(
        renderStyledRunsXml(settings.footerNote, { italic: true, sizeHalfPt: 20, fontFamily, color: '64748B' }),
        { align: 'center', spacingBefore: 0, spacingAfter: 40 }
      )
    );
  }

  return packageOoxmlDocxBuffer({
    bodyXml: bodyChunks.join('\n'),
    mediaList,
    marginMm: settings.paperMarginMm,
    fontFamily,
  });
}

/**
 * Tạo file Word (.docx) ĐÁP ÁN TỔNG HỢP & BẢNG ÁNH XẠ HOÁN VỊ cho GIÁO VIÊN.
 */
export async function buildAnswerKeyDocxBuffer(exam: MathExamProject): Promise<Uint8Array> {
  const gate = checkExamExportGate(exam);
  if (!gate.canExport) {
    throw new Error(`Xuất Đáp án DOCX bị CHẶN (BLOCKED): ${gate.blockingReasons.join(' ')}`);
  }

  const settings = resolveExportSettings(exam);
  const subjectProfile = getSubjectProfile(resolveSubjectId(exam.subjectId || exam.subject));
  const examTitle = settings.examTitleOverride.trim() || exam.title;
  const fontFamily = settings.fontFamily;
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

  // 1. Bảng đáp án tổng hợp tất cả mã đề (chia cụm 8 mã/bảng để vừa khổ A4)
  if (settings.includeAnswerMatrix) {
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
  }

  // 2. Chi tiết ánh xạ từng mã đề
  if (settings.includeAnswerKey || settings.includeMappingTable) {
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

  return packageOoxmlDocxBuffer({
    bodyXml: bodyChunks.join('\n'),
    mediaList: [],
    marginMm: settings.paperMarginMm,
    fontFamily,
  });
}

/**
 * Tạo bảng đáp án CSV (UTF-8 BOM) tương thích mở trực tiếp trên Excel/Google Sheets.
 */
export function buildConsolidatedAnswerCsv(exam: MathExamProject): string {
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
    const normalizedFull = fullText.replace(/\s+/g, ' ');
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
    });

    // Kiểm tra không rò rỉ nhãn đáp án vào đề học sinh
    if (/(?:Đáp án đúng:|Đáp án gốc:|Hướng dẫn chấm:|Bảng ánh xạ hoán vị)/i.test(fullText)) {
      issues.push({
        id: `exp-answer-leak-${expectedVersion.code}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'export',
        message: `File DOCX học sinh Mã đề ${expectedVersion.code} bị rò rỉ đáp án hoặc hướng dẫn giải.`,
        recommendation: 'Chặn phát hành ngay để bảo mật đề thi.',
      });
    }

    // Kiểm tra bảo toàn số lượng ảnh/bảng
    const expectedAssetsCount =
      expectedVersion.questions.reduce((acc, q) => acc + (q.visualAssets?.length ?? 0), 0) +
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
  exam: MathExamProject
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
    const docxBytes = await buildStudentExamDocxBuffer(exam, ver);
    const entryPath = `de-hoc-sinh/Ma_de_${ver.code}.docx`;
    zip.file(entryPath, docxBytes);
    manifestEntries.push({
      path: entryPath,
      bytes: docxBytes.byteLength,
      shaFnv: computeContentHash(`${entryPath}:${docxBytes.byteLength}`),
    });
  }

  const answerDocx = await buildAnswerKeyDocxBuffer(exam);
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
    preMixReport: exam.lastIntegrityReport ?? null,
    versions: exam.generatedVersions.map((v) => ({
      code: v.code,
      integrityPassed: v.integrityPassed,
      integrityStatus: v.integrityStatus ?? 'PASS',
      warnings: v.integrityWarnings,
    })),
  };
  zip.file('kiem-chung/Bao_cao_toan_ven.json', JSON.stringify(integrityPayload, null, 2));

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        generator: 'TeacherOS Exam Mixer Pro 6.0',
        exportedAt: new Date().toISOString(),
        examTitle: exam.title,
        subject: exam.subject,
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

  const hasManifest = Boolean(loaded.file('manifest.json'));
  const hasAnswerDocx = Boolean(loaded.file('dap-an/Dap_an_va_Anh_xa.docx'));
  const hasCsv = Boolean(loaded.file('dap-an/Bang_dap_an_tong_hop.csv'));
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
        label: 'Kiểm chứng ngược OOXML từng mã đề',
        passed: verifiedCodes.length === exam.generatedVersions.length && !hasError,
        detail: `${verifiedCodes.length}/${exam.generatedVersions.length} mã đề mở đọc lại hợp lệ, không rò rỉ đáp án.`,
      },
    ],
    issues,
  };
}
