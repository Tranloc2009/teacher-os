import JSZip from 'jszip';
import { MathVisualAsset } from '../types/mathExam';
import { computeContentHash } from './mathIntegrity';

export interface XmlNode {
  type: 'element' | 'text';
  tag?: string;
  attrs?: Record<string, string>;
  children?: XmlNode[];
  text?: string;
  rawXml?: string;
}

export interface ExtractedOmmlFragment {
  id: string;
  latex: string;
  rawXmlFragment: string;
  complexFallback: boolean;
}

export interface DocxParagraphSegment {
  text: string;
  ommlFragments: ExtractedOmmlFragment[];
  assetIds: string[];
  tableText?: string;
  hasBoldCorrectCue?: boolean;
  hasLegacyOleEquation?: boolean;
}

export interface DocxExtractionResult {
  plainTextWithMarkers: string;
  paragraphs: DocxParagraphSegment[];
  ommlFragments: ExtractedOmmlFragment[];
  assets: MathVisualAsset[];
  warnings: string[];
  hasLegacyOleEquation: boolean;
  hasVbaMacro?: boolean;
}

export const DOCX_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const DOCX_MAX_ZIP_ENTRIES = 2500;
export const DOCX_MAX_XML_BYTES = 35 * 1024 * 1024;

/**
 * Làm sạch SVG trước khi render hoặc đóng gói: loại bỏ script, event handler on*, foreignObject script và javascript: URI.
 */
export function sanitizeSvgMarkup(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<script[\s\S]*?\/>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"');
}

function assertSafeXmlPayload(xml: string, partName: string): void {
  if (xml.length > DOCX_MAX_XML_BYTES) {
    throw new Error(`Tệp XML "${partName}" vượt quá giới hạn an toàn (${Math.round(DOCX_MAX_XML_BYTES / (1024 * 1024))} MB).`);
  }
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new Error(`Tệp "${partName}" chứa khai báo <!DOCTYPE>/<!ENTITY> không được phép vì lý do bảo mật XXE.`);
  }
}

export function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&amp;/g, '&');
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrString)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/**
 * Bộ phân tích XML thuần TypeScript chạy đồng nhất trên cả trình duyệt và Node.js.
 * Bảo toàn rawXml của các thẻ <m:oMath> / <m:oMathPara> phục vụ kiểm chứng bất biến.
 */
export function parseXmlTree(xml: string): XmlNode {
  const root: XmlNode = { type: 'element', tag: 'ROOT', attrs: {}, children: [] };
  const stack: Array<{ node: XmlNode; startIdx: number }> = [{ node: root, startIdx: -1 }];

  const tokenRe =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(xml)) !== null) {
    if (match.index > lastIdx) {
      const textChunk = xml.slice(lastIdx, match.index);
      if (textChunk) {
        const parent = stack[stack.length - 1].node;
        parent.children?.push({ type: 'text', text: decodeXmlEntities(textChunk) });
      }
    }
    lastIdx = tokenRe.lastIndex;

    if (match[1] !== undefined) {
      // CDATA
      const parent = stack[stack.length - 1].node;
      parent.children?.push({ type: 'text', text: match[1] });
      continue;
    }

    if (match[2]) {
      // Closing tag
      const closeTag = match[2];
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].node.tag === closeTag) {
          const popped = stack[i];
          if (closeTag === 'm:oMath' || closeTag === 'm:oMathPara') {
            popped.node.rawXml = xml.slice(popped.startIdx, lastIdx);
          }
          stack.length = i;
          break;
        }
      }
      continue;
    }

    if (match[3]) {
      const tag = match[3];
      const attrStr = match[4] ?? '';
      const selfClosing = match[5] === '/';
      const el: XmlNode = {
        type: 'element',
        tag,
        attrs: attrStr ? parseAttributes(attrStr) : {},
        children: [],
      };
      if (selfClosing && (tag === 'm:oMath' || tag === 'm:oMathPara')) {
        el.rawXml = match[0];
      }
      const parent = stack[stack.length - 1].node;
      parent.children?.push(el);
      if (!selfClosing) {
        stack.push({ node: el, startIdx: match.index });
      }
    }
  }

  if (lastIdx < xml.length) {
    const tail = xml.slice(lastIdx);
    if (tail) {
      stack[stack.length - 1].node.children?.push({
        type: 'text',
        text: decodeXmlEntities(tail),
      });
    }
  }

  return root;
}

function findChildren(node: XmlNode | undefined, tag: string): XmlNode[] {
  if (!node?.children) return [];
  return node.children.filter((c) => c.type === 'element' && c.tag === tag);
}

function findFirstDescendant(node: XmlNode | undefined, tag: string): XmlNode | undefined {
  if (!node?.children) return undefined;
  for (const child of node.children) {
    if (child.type === 'element') {
      if (child.tag === tag) return child;
      const deep = findFirstDescendant(child, tag);
      if (deep) return deep;
    }
  }
  return undefined;
}

function findAllDescendants(node: XmlNode | undefined, tag: string, out: XmlNode[] = []): XmlNode[] {
  if (!node?.children) return out;
  for (const child of node.children) {
    if (child.type === 'element') {
      if (child.tag === tag) out.push(child);
      findAllDescendants(child, tag, out);
    }
  }
  return out;
}

function collectNodeText(node: XmlNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (!node.children) return '';
  return node.children.map((c) => collectNodeText(c)).join('');
}

const UNICODE_SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  o: 'ₒ',
  x: 'ₓ',
  h: 'ₕ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  p: 'ₚ',
  s: 'ₛ',
  t: 'ₜ',
  i: 'ᵢ',
  r: 'ᵣ',
  u: 'ᵤ',
  v: 'ᵥ',
};

const UNICODE_SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
};

function toUnicodeSubOrSup(text: string, mode: 'subscript' | 'superscript'): { text: string; fullyMapped: boolean } {
  const map = mode === 'subscript' ? UNICODE_SUBSCRIPT_MAP : UNICODE_SUPERSCRIPT_MAP;
  let out = '';
  let fullyMapped = true;
  for (const ch of text) {
    if (ch === ' ') {
      out += ' ';
      continue;
    }
    const mapped = map[ch];
    if (mapped) {
      out += mapped;
    } else {
      fullyMapped = false;
      out += ch;
    }
  }
  return { text: out, fullyMapped };
}

const OMML_LATEX_SYMBOL_REPLACEMENTS: Array<[string, string]> = [
  ['≤', '\\le '],
  ['≥', '\\ge '],
  ['≠', '\\ne '],
  ['≈', '\\approx '],
  ['±', '\\pm '],
  ['×', '\\times '],
  ['÷', '\\div '],
  ['∞', '\\infty '],
  ['→', '\\to '],
  ['⇒', '\\Rightarrow '],
  ['⇔', '\\Leftrightarrow '],
  ['∈', '\\in '],
  ['∉', '\\notin '],
  ['⊂', '\\subset '],
  ['∪', '\\cup '],
  ['∩', '\\cap '],
  ['∅', '\\emptyset '],
  ['∀', '\\forall '],
  ['∃', '\\exists '],
  ['α', '\\alpha '],
  ['β', '\\beta '],
  ['γ', '\\gamma '],
  ['Δ', '\\Delta '],
  ['δ', '\\delta '],
  ['θ', '\\theta '],
  ['λ', '\\lambda '],
  ['μ', '\\mu '],
  ['π', '\\pi '],
  ['σ', '\\sigma '],
  ['φ', '\\varphi '],
  ['ω', '\\omega '],
  ['Ω', '\\Omega '],
];

function escapeOmmlTextToLatex(raw: string): string {
  let out = raw;
  for (const [sym, tex] of OMML_LATEX_SYMBOL_REPLACEMENTS) {
    if (out.includes(sym)) {
      out = out.split(sym).join(tex);
    }
  }
  return out;
}

function convertOmmlChildren(nodes: XmlNode[] | undefined, state: { complex: boolean }): string {
  if (!nodes || nodes.length === 0) return '';
  return nodes.map((n) => convertOmmlNodeInner(n, state)).join('');
}

function convertOmmlNodeInner(node: XmlNode, state: { complex: boolean }): string {
  if (node.type === 'text') {
    return node.text ?? '';
  }
  const tag = node.tag ?? '';

  // Skip properties nodes
  if (tag.endsWith('Pr')) return '';

  switch (tag) {
    case 'm:oMathPara':
    case 'm:oMath':
    case 'm:e':
    case 'm:num':
    case 'm:den':
    case 'm:deg':
    case 'm:sub':
    case 'm:sup':
    case 'm:lim':
    case 'm:fName':
      return convertOmmlChildren(node.children, state);

    case 'm:r': {
      const mText = findChildren(node, 'm:t')
        .map((t) => collectNodeText(t))
        .join('');
      const wText = findChildren(node, 'w:t')
        .map((t) => collectNodeText(t))
        .join('');
      return escapeOmmlTextToLatex(mText || wText || collectNodeText(node));
    }

    case 'm:t':
    case 'w:t':
      return escapeOmmlTextToLatex(collectNodeText(node));

    case 'm:f': {
      const num = convertOmmlNodeInner(findChildren(node, 'm:num')[0] ?? { type: 'text', text: '' }, state);
      const den = convertOmmlNodeInner(findChildren(node, 'm:den')[0] ?? { type: 'text', text: '' }, state);
      return `\\frac{${num.trim()}}{${den.trim()}}`;
    }

    case 'm:rad': {
      const degNode = findChildren(node, 'm:deg')[0];
      const degText = degNode ? convertOmmlNodeInner(degNode, state).trim() : '';
      const base = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      return degText ? `\\sqrt[${degText}]{${base}}` : `\\sqrt{${base}}`;
    }

    case 'm:sSup': {
      const base = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      const sup = convertOmmlNodeInner(findChildren(node, 'm:sup')[0] ?? { type: 'text', text: '' }, state).trim();
      const wrappedBase = base.length > 1 && !base.startsWith('{') ? `{${base}}` : base;
      return `${wrappedBase}^{${sup}}`;
    }

    case 'm:sSub': {
      const base = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      const sub = convertOmmlNodeInner(findChildren(node, 'm:sub')[0] ?? { type: 'text', text: '' }, state).trim();
      const wrappedBase = base.length > 1 && !base.startsWith('{') ? `{${base}}` : base;
      return `${wrappedBase}_{${sub}}`;
    }

    case 'm:sSubSup': {
      const base = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      const sub = convertOmmlNodeInner(findChildren(node, 'm:sub')[0] ?? { type: 'text', text: '' }, state).trim();
      const sup = convertOmmlNodeInner(findChildren(node, 'm:sup')[0] ?? { type: 'text', text: '' }, state).trim();
      const wrappedBase = base.length > 1 && !base.startsWith('{') ? `{${base}}` : base;
      return `${wrappedBase}_{${sub}}^{${sup}}`;
    }

    case 'm:sPre': {
      const sub = convertOmmlNodeInner(findChildren(node, 'm:sub')[0] ?? { type: 'text', text: '' }, state).trim();
      const sup = convertOmmlNodeInner(findChildren(node, 'm:sup')[0] ?? { type: 'text', text: '' }, state).trim();
      const base = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      return `${sup ? `^{${sup}}` : ''}${sub ? `_{${sub}}` : ''}${base}`;
    }

    case 'm:nary': {
      const pr = findChildren(node, 'm:naryPr')[0];
      const chrVal = findChildren(pr, 'm:chr')[0]?.attrs?.['m:val'] ?? '∫';
      const opLatex =
        chrVal === '∑'
          ? '\\sum'
          : chrVal === '∏'
          ? '\\prod'
          : chrVal === '∬'
          ? '\\iint'
          : '\\int';
      const sub = convertOmmlNodeInner(findChildren(node, 'm:sub')[0] ?? { type: 'text', text: '' }, state).trim();
      const sup = convertOmmlNodeInner(findChildren(node, 'm:sup')[0] ?? { type: 'text', text: '' }, state).trim();
      const expr = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      return `${opLatex}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${expr}`;
    }

    case 'm:d': {
      const pr = findChildren(node, 'm:dPr')[0];
      const beg = findChildren(pr, 'm:begChr')[0]?.attrs?.['m:val'] ?? '(';
      const end = findChildren(pr, 'm:endChr')[0]?.attrs?.['m:val'] ?? ')';
      const sep = findChildren(pr, 'm:sepChr')[0]?.attrs?.['m:val'] ?? ', ';
      const items = findChildren(node, 'm:e').map((e) => convertOmmlNodeInner(e, state).trim());
      const leftDelim = beg === '{' ? '\\{' : beg === '' ? '.' : beg;
      const rightDelim = end === '}' ? '\\}' : end === '' ? '.' : end;
      return `\\left${leftDelim}${items.join(sep)}\\right${rightDelim}`;
    }

    case 'm:m': {
      const rows = findChildren(node, 'm:mr').map((mr) =>
        findChildren(mr, 'm:e')
          .map((e) => convertOmmlNodeInner(e, state).trim())
          .join(' & ')
      );
      return `\\begin{pmatrix} ${rows.join(' \\\\ ')} \\end{pmatrix}`;
    }

    case 'm:func': {
      const fName = convertOmmlNodeInner(findChildren(node, 'm:fName')[0] ?? { type: 'text', text: '' }, state).trim();
      const expr = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      const known = ['sin', 'cos', 'tan', 'cot', 'log', 'ln', 'lim'];
      const fnLatex = known.includes(fName.toLowerCase()) ? `\\${fName.toLowerCase()}` : fName;
      return `${fnLatex} ${expr}`;
    }

    case 'm:limLow': {
      const expr = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      const lim = convertOmmlNodeInner(findChildren(node, 'm:lim')[0] ?? { type: 'text', text: '' }, state).trim();
      const fn = expr.toLowerCase() === 'lim' ? '\\lim' : expr;
      return `${fn}_{${lim}}`;
    }

    case 'm:limUpp': {
      const expr = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      const lim = convertOmmlNodeInner(findChildren(node, 'm:lim')[0] ?? { type: 'text', text: '' }, state).trim();
      return `\\overset{${lim}}{${expr}}`;
    }

    case 'm:bar': {
      const expr = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      return `\\overline{${expr}}`;
    }

    case 'm:acc': {
      const pr = findChildren(node, 'm:accPr')[0];
      const chrVal = findChildren(pr, 'm:chr')[0]?.attrs?.['m:val'] ?? '';
      const expr = convertOmmlNodeInner(findChildren(node, 'm:e')[0] ?? { type: 'text', text: '' }, state).trim();
      if (chrVal === '\u20D7' || chrVal === '→') return `\\vec{${expr}}`;
      if (chrVal === '^' || chrVal === '\u0302') return `\\widehat{${expr}}`;
      return `\\overline{${expr}}`;
    }

    case 'm:eqArr': {
      const items = findChildren(node, 'm:e').map((e) => convertOmmlNodeInner(e, state).trim());
      return `\\begin{cases} ${items.join(' \\\\ ')} \\end{cases}`;
    }

    default: {
      if (tag.startsWith('m:')) {
        state.complex = true;
      }
      return convertOmmlChildren(node.children, state);
    }
  }
}

export function convertOmmlNodeToLatex(
  ommlNode: XmlNode,
  id: string
): ExtractedOmmlFragment {
  const state = { complex: false };
  const inner = convertOmmlNodeInner(ommlNode, state).replace(/\s+/g, ' ').trim();
  const isDisplay = ommlNode.tag === 'm:oMathPara';
  const latex = inner ? (isDisplay ? `$$${inner}$$` : `$${inner}$`) : '';
  return {
    id,
    latex,
    rawXmlFragment: ommlNode.rawXml ?? '',
    complexFallback: state.complex || !inner,
  };
}

function getMimeFromExt(ext: string): { mime: string; supported: boolean } {
  switch (ext.toLowerCase()) {
    case 'png':
      return { mime: 'image/png', supported: true };
    case 'jpg':
    case 'jpeg':
      return { mime: 'image/jpeg', supported: true };
    case 'gif':
      return { mime: 'image/gif', supported: true };
    case 'webp':
      return { mime: 'image/webp', supported: true };
    case 'svg':
      return { mime: 'image/svg+xml', supported: true };
    case 'wmf':
    case 'emf':
      return { mime: `image/x-${ext.toLowerCase()}`, supported: false };
    default:
      return { mime: 'application/octet-stream', supported: false };
  }
}

function extractParagraphContent(
  pNode: XmlNode,
  ctx: {
    relsById: Map<string, string>;
    assetsByRelTarget: Map<string, MathVisualAsset>;
    unsupportedRelIds: Set<string>;
    ommlCounter: { count: number };
    warnings: string[];
  }
): DocxParagraphSegment {
  let text = '';
  const ommlFragments: ExtractedOmmlFragment[] = [];
  const assetIds: string[] = [];
  let hasBoldCorrectCue = false;
  let hasLegacyOleEquation = false;

  const walkParagraphNode = (node: XmlNode) => {
    if (node.type === 'text') return;
    const tag = node.tag ?? '';

    if (tag === 'm:oMathPara' || tag === 'm:oMath') {
      ctx.ommlCounter.count += 1;
      const frag = convertOmmlNodeToLatex(node, `omml-${ctx.ommlCounter.count}`);
      ommlFragments.push(frag);
      text += frag.latex || '[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]';
      if (frag.complexFallback) {
        ctx.warnings.push(
          `Công thức OMML #${ctx.ommlCounter.count} có cấu trúc phức tạp — hệ thống đã giữ nguyên XML gốc nhưng cần giáo viên rà soát lại phần hiển thị.`
        );
      }
      return;
    }

    if (tag === 'w:object' || tag === 'o:OLEObject') {
      hasLegacyOleEquation = true;
      text += ' [CÔNG_THỨC_OLE_LEGACY] ';
      return;
    }

    if (tag === 'w:r') {
      const rPr = findChildren(node, 'w:rPr')[0];
      const isBold = Boolean(findFirstDescendant(rPr, 'w:b'));
      const hasUnderline = Boolean(findFirstDescendant(rPr, 'w:u'));
      const colorVal = findFirstDescendant(rPr, 'w:color')?.attrs?.['w:val']?.toLowerCase();
      const hasRedOrBlueHighlight =
        Boolean(colorVal && colorVal !== '000000' && colorVal !== 'auto') ||
        Boolean(findFirstDescendant(rPr, 'w:highlight'));

      const vertAlign = findFirstDescendant(rPr, 'w:vertAlign')?.attrs?.['w:val'];

      // Check embedded drawings inside run
      const blips = findAllDescendants(node, 'a:blip');
      for (const blip of blips) {
        const rId = blip.attrs?.['r:embed'] || blip.attrs?.['r:link'];
        if (!rId) continue;
        const target = ctx.relsById.get(rId);
        if (target && ctx.assetsByRelTarget.has(target)) {
          const asset = ctx.assetsByRelTarget.get(target)!;
          if (!assetIds.includes(asset.id)) {
            assetIds.push(asset.id);
          }
          text += ` [[ASSET:${asset.id}]] `;
        } else if (ctx.unsupportedRelIds.has(rId)) {
          ctx.warnings.push(
            `Hình ảnh/Công thức định dạng WMF/EMF (${target ?? rId}) trong .docx không thể xem trước trực tiếp trên trình duyệt — hãy chuyển sang PNG/SVG hoặc LaTeX.`
          );
        }
      }

      // Check OLE objects inside run
      if (findFirstDescendant(node, 'w:object') || findFirstDescendant(node, 'o:OLEObject')) {
        hasLegacyOleEquation = true;
      }

      let runText = '';
      for (const child of node.children ?? []) {
        if (child.type !== 'element') continue;
        if (child.tag === 'w:t') {
          runText += collectNodeText(child);
        } else if (child.tag === 'w:tab') {
          runText += ' ';
        } else if (child.tag === 'w:br') {
          runText += '\n';
        }
      }

      if (runText) {
        if ((isBold || hasUnderline || hasRedOrBlueHighlight) && /^\s*[A-Da-d]\./.test(runText.trim())) {
          hasBoldCorrectCue = true;
        }
        if (vertAlign === 'subscript') {
          const sub = toUnicodeSubOrSup(runText, 'subscript');
          text += sub.fullyMapped ? sub.text : `_{${runText}}`;
        } else if (vertAlign === 'superscript') {
          const sup = toUnicodeSubOrSup(runText, 'superscript');
          text += sup.fullyMapped ? sup.text : `^{${runText}}`;
        } else {
          text += runText;
        }
      }
      return;
    }

    for (const child of node.children ?? []) {
      walkParagraphNode(child);
    }
  };

  walkParagraphNode(pNode);

  return {
    text,
    ommlFragments,
    assetIds,
    hasBoldCorrectCue,
    hasLegacyOleEquation,
  };
}

/**
 * Giải nén và trích xuất toàn bộ nội dung có cấu trúc từ file Microsoft Word (.docx):
 * - Văn bản theo đúng thứ tự đoạn & bảng
 * - Công thức Word OMML (<m:oMath>, <m:oMathPara>) kèm XML gốc bất biến
 * - Chỉ số trên/dưới (<w:vertAlign>) giữ nguyên H₂SO₄, Fe³⁺, m/s²
 * - Hình ảnh nhúng trong word/media/* thành Data URL gắn theo vị trí câu
 */
export async function extractDocxDocument(
  buffer: ArrayBuffer | Uint8Array
): Promise<DocxExtractionResult> {
  const byteLen = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.byteLength;
  if (byteLen > DOCX_MAX_FILE_BYTES) {
    throw new Error('File .docx vượt quá giới hạn 50 MB.');
  }

  const zip = await JSZip.loadAsync(buffer);
  const entryNames = Object.keys(zip.files);
  if (entryNames.length > DOCX_MAX_ZIP_ENTRIES) {
    throw new Error(`File .docx chứa quá nhiều mục (${entryNames.length} > ${DOCX_MAX_ZIP_ENTRIES}), có thể là ZIP không an toàn.`);
  }
  for (const name of entryNames) {
    if (name.includes('..') || name.startsWith('/')) {
      throw new Error(`Đường dẫn không hợp lệ bên trong gói DOCX: "${name}".`);
    }
  }

  const hasVbaMacro = entryNames.some((n) => /vbaProject\.bin$/i.test(n));
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new Error('File .docx không hợp lệ (thiếu word/document.xml).');
  }

  const warnings: string[] = [];
  if (hasVbaMacro) {
    warnings.push(
      'Cảnh báo bảo mật: File .docx có chứa macro VBA (vbaProject.bin). Hệ thống đã bỏ qua hoàn toàn macro và chỉ đọc dữ liệu văn bản/XML.'
    );
  }
  const relsById = new Map<string, string>();
  const assets: MathVisualAsset[] = [];
  const assetsByRelTarget = new Map<string, MathVisualAsset>();
  const unsupportedRelIds = new Set<string>();

  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    assertSafeXmlPayload(relsXml, 'word/_rels/document.xml.rels');
    const relsTree = parseXmlTree(relsXml);
    const relNodes = findAllDescendants(relsTree, 'Relationship');
    for (const rel of relNodes) {
      const id = rel.attrs?.Id;
      const target = rel.attrs?.Target;
      if (!id || !target) continue;
      const normalizedTarget = target.startsWith('/')
        ? target.slice(1)
        : target.startsWith('word/')
        ? target
        : `word/${target.replace(/^\.\//, '')}`;
      relsById.set(id, normalizedTarget);

      if (/\/media\//i.test(normalizedTarget)) {
        const mediaEntry = zip.file(normalizedTarget);
        const ext = normalizedTarget.split('.').pop() ?? '';
        const mimeInfo = getMimeFromExt(ext);
        if (mediaEntry && mimeInfo.supported) {
          let base64 = await mediaEntry.async('base64');
          if (ext.toLowerCase() === 'svg') {
            const rawSvg = await mediaEntry.async('string');
            const cleanSvg = sanitizeSvgMarkup(rawSvg);
            if (cleanSvg !== rawSvg) {
              warnings.push(`Đã loại bỏ thẻ script/thuộc tính sự kiện không an toàn trong hình SVG (${normalizedTarget}).`);
            }
            const bytes = new TextEncoder().encode(cleanSvg);
            let bin = '';
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            base64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
          }
          const dataUrl = `data:${mimeInfo.mime};base64,${base64}`;
          const fileName = normalizedTarget.split('/').pop() ?? `image.${ext}`;
          const assetId = `docx-img-${assets.length + 1}`;
          const asset: MathVisualAsset = {
            id: assetId,
            kind: 'image',
            label: fileName,
            sourceData: dataUrl,
            altText: `Hình trích xuất từ DOCX (${fileName})`,
            required: true,
            checksum: computeContentHash(`image::${fileName}::${dataUrl}`),
          };
          assets.push(asset);
          assetsByRelTarget.set(normalizedTarget, asset);
        } else if (mediaEntry && !mimeInfo.supported) {
          unsupportedRelIds.add(id);
        }
      }
    }
  }

  const docXml = await documentFile.async('string');
  assertSafeXmlPayload(docXml, 'word/document.xml');
  const docTree = parseXmlTree(docXml);
  const body = findFirstDescendant(docTree, 'w:body');
  if (!body) {
    throw new Error('File .docx không có phần thân nội dung (w:body).');
  }

  const paragraphs: DocxParagraphSegment[] = [];
  const allOmml: ExtractedOmmlFragment[] = [];
  const ommlCounter = { count: 0 };
  let hasLegacyOleEquation = false;

  for (const child of body.children ?? []) {
    if (child.type !== 'element') continue;
    if (child.tag === 'w:p') {
      const seg = extractParagraphContent(child, {
        relsById,
        assetsByRelTarget,
        unsupportedRelIds,
        ommlCounter,
        warnings,
      });
      if (seg.hasLegacyOleEquation) hasLegacyOleEquation = true;
      allOmml.push(...seg.ommlFragments);
      if (seg.text.trim() || seg.assetIds.length > 0) {
        paragraphs.push(seg);
      }
    } else if (child.tag === 'w:tbl') {
      const rows = findChildren(child, 'w:tr');
      const rowTexts: string[] = [];
      const rowAssetIds: string[] = [];
      for (const tr of rows) {
        const cells = findChildren(tr, 'w:tc');
        const cellTexts: string[] = [];
        for (const tc of cells) {
          const cellPs = findChildren(tc, 'w:p');
          const cellSegs = cellPs.map((cp) =>
            extractParagraphContent(cp, {
              relsById,
              assetsByRelTarget,
              unsupportedRelIds,
              ommlCounter,
              warnings,
            })
          );
          for (const cs of cellSegs) {
            if (cs.hasLegacyOleEquation) hasLegacyOleEquation = true;
            allOmml.push(...cs.ommlFragments);
            rowAssetIds.push(...cs.assetIds);
          }
          cellTexts.push(
            cellSegs
              .map((s) => s.text.trim())
              .filter(Boolean)
              .join(' ')
          );
        }
        rowTexts.push(cellTexts.join(' | '));
      }
      const tableBody = rowTexts.filter(Boolean).join('\n');
      if (tableBody) {
        const tblAssetId = `docx-tbl-${assets.length + 1}`;
        assets.push({
          id: tblAssetId,
          kind: 'data-table',
          label: `Bảng dữ liệu DOCX #${assets.length + 1}`,
          sourceData: tableBody,
          altText: 'Bảng dữ liệu trích xuất từ file Word',
          required: true,
          checksum: computeContentHash(`data-table::Bảng::${tableBody}`),
        });
        paragraphs.push({
          text: `${tableBody}\n[[ASSET:${tblAssetId}]]`,
          ommlFragments: [],
          assetIds: [tblAssetId, ...rowAssetIds],
          tableText: tableBody,
        });
      }
    }
  }

  if (hasLegacyOleEquation) {
    warnings.push(
      'Phát hiện đối tượng Equation 3.0 / MathType OLE cũ trong file .docx. Do định dạng nhị phân cũ không đọc trực tiếp được công thức, hãy chuyển sang Word Equation (OMML) hoặc LaTeX trước khi trộn.'
    );
  }

  return {
    plainTextWithMarkers: paragraphs.map((p) => p.text).join('\n'),
    paragraphs,
    ommlFragments: allOmml,
    assets,
    warnings: Array.from(new Set(warnings)),
    hasLegacyOleEquation,
    hasVbaMacro,
  };
}
