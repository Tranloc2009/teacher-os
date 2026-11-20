import JSZip from 'jszip';
import { MathVisualAsset } from '../types/mathExam';
import { createMathVisualAsset } from './mathIntegrity';
import {
  convertWmfToSvg,
  decodeOleFormulaPayload,
} from './oleAndWmfDecoder';

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

export interface DocxUnresolvedOleDetail {
  location: string;
  progId?: string;
  oleTarget?: string;
  wmfPreviewTarget?: string;
  reason: string;
}

export interface DocxParagraphSegment {
  text: string;
  ommlFragments: ExtractedOmmlFragment[];
  assetIds: string[];
  tableText?: string;
  tableRows?: string[][];
  paragraphLocation?: string;
  hasBoldCorrectCue?: boolean;
  /** Nhãn phương án A/B/C/D thực sự được gạch chân (w:u khác none) trong đoạn này */
  underlinedOptionLabels?: Array<'A' | 'B' | 'C' | 'D'>;
  /** Nhãn ý a)/b)/c)/d) thực sự được gạch chân (w:u khác none) trong đoạn này */
  underlinedStatementLabels?: Array<'a' | 'b' | 'c' | 'd'>;
  /** Đoạn chứa ảnh neo (wp:anchor) — thường dùng cho hình vẽ đứng sát trước tiêu đề câu */
  hasAnchoredImage?: boolean;
  hasLegacyOleEquation?: boolean;
  oleDecodedLatexCount?: number;
  oleWmfPreviewAssetIds?: string[];
  unresolvedOleCount?: number;
}

export interface DocxExtractionResult {
  plainTextWithMarkers: string;
  paragraphs: DocxParagraphSegment[];
  ommlFragments: ExtractedOmmlFragment[];
  assets: MathVisualAsset[];
  warnings: string[];
  hasLegacyOleEquation: boolean;
  hasVbaMacro?: boolean;
  legacyOleCount?: number;
  legacyOleDecodedLatexCount?: number;
  legacyOleWmfPreviewCount?: number;
  unresolvedOleCount?: number;
  unresolvedOleDetails?: DocxUnresolvedOleDetail[];
  legacyOleProgIds?: string[];
  unsupportedMediaCount?: number;
  convertedWmfMediaCount?: number;
  tableCount?: number;
  supportedImageCount?: number;
  sourceFileHash?: string;
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

interface MediaDescriptor {
  normalizedTarget: string;
  fileName: string;
  ext: string;
  supported: boolean;
  dataUrl?: string;
  rawBytes?: Uint8Array;
  convertedFromWmf?: boolean;
  wmfFailureReason?: string;
}

interface DocxNumberingLevelDef {
  start: number;
  numFmt: string;
  lvlText: string;
}

interface DocxNumberingRegistry {
  abstractLevels: Map<string, Map<number, DocxNumberingLevelDef>>;
  numToAbstract: Map<string, string>;
  numStartOverrides: Map<string, Map<number, number>>;
  counters: Map<string, Map<number, number>>;
}

function toRomanNumeral(num: number): string {
  const table: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let n = Math.max(1, Math.min(3999, Math.floor(num)));
  let out = '';
  for (const [val, sym] of table) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}

function formatNumberingValue(val: number, numFmt: string): string {
  const safeVal = Math.max(1, val);
  switch (numFmt) {
    case 'upperLetter':
      return String.fromCharCode(65 + ((safeVal - 1) % 26));
    case 'lowerLetter':
      return String.fromCharCode(97 + ((safeVal - 1) % 26));
    case 'upperRoman':
      return toRomanNumeral(safeVal);
    case 'lowerRoman':
      return toRomanNumeral(safeVal).toLowerCase();
    case 'bullet':
    case 'none':
      return '';
    case 'decimal':
    default:
      return String(safeVal);
  }
}

function parseDocxNumberingXml(xml: string): DocxNumberingRegistry {
  const registry: DocxNumberingRegistry = {
    abstractLevels: new Map(),
    numToAbstract: new Map(),
    numStartOverrides: new Map(),
    counters: new Map(),
  };

  const tree = parseXmlTree(xml);
  const abstractNodes = findAllDescendants(tree, 'w:abstractNum');
  for (const absNode of abstractNodes) {
    const absId = absNode.attrs?.['w:abstractNumId'];
    if (!absId) continue;
    const lvlMap = new Map<number, DocxNumberingLevelDef>();
    const lvls = findChildren(absNode, 'w:lvl');
    for (const lvl of lvls) {
      const ilvl = Number.parseInt(lvl.attrs?.['w:ilvl'] ?? '0', 10);
      const startVal = Number.parseInt(
        findFirstDescendant(lvl, 'w:start')?.attrs?.['w:val'] ?? '1',
        10
      );
      const numFmt = findFirstDescendant(lvl, 'w:numFmt')?.attrs?.['w:val'] ?? 'decimal';
      const lvlText = findFirstDescendant(lvl, 'w:lvlText')?.attrs?.['w:val'] ?? `%${ilvl + 1}.`;
      lvlMap.set(Number.isFinite(ilvl) ? ilvl : 0, {
        start: Number.isFinite(startVal) ? startVal : 1,
        numFmt,
        lvlText,
      });
    }
    registry.abstractLevels.set(absId, lvlMap);
  }

  const numNodes = findAllDescendants(tree, 'w:num');
  for (const numNode of numNodes) {
    const numId = numNode.attrs?.['w:numId'];
    const absId = findFirstDescendant(numNode, 'w:abstractNumId')?.attrs?.['w:val'];
    if (!numId || !absId) continue;
    registry.numToAbstract.set(numId, absId);

    const overrides = findChildren(numNode, 'w:lvlOverride');
    if (overrides.length > 0) {
      const ovMap = new Map<number, number>();
      for (const ov of overrides) {
        const ilvl = Number.parseInt(ov.attrs?.['w:ilvl'] ?? '0', 10);
        const startOv = Number.parseInt(
          findFirstDescendant(ov, 'w:startOverride')?.attrs?.['w:val'] ?? '',
          10
        );
        if (Number.isFinite(ilvl) && Number.isFinite(startOv)) {
          ovMap.set(ilvl, startOv);
        }
      }
      if (ovMap.size > 0) {
        registry.numStartOverrides.set(numId, ovMap);
      }
    }
  }

  return registry;
}

function resolveParagraphAutoNumberPrefix(
  pNode: XmlNode,
  rawText: string,
  hasNonEmptyContent: boolean,
  numbering: DocxNumberingRegistry
): string {
  const trimmed = rawText.trim();
  if (!trimmed && !hasNonEmptyContent) return '';

  const pPr = findChildren(pNode, 'w:pPr')[0];
  const numPr = findChildren(pPr, 'w:numPr')[0];
  if (!numPr) return '';

  const numId = findFirstDescendant(numPr, 'w:numId')?.attrs?.['w:val'];
  if (!numId || numId === '0') return '';

  const ilvlRaw = Number.parseInt(findFirstDescendant(numPr, 'w:ilvl')?.attrs?.['w:val'] ?? '0', 10);
  const ilvl = Number.isFinite(ilvlRaw) && ilvlRaw >= 0 ? ilvlRaw : 0;

  const absId = numbering.numToAbstract.get(numId);
  const lvlDef = absId ? numbering.abstractLevels.get(absId)?.get(ilvl) : undefined;
  const numFmt = lvlDef?.numFmt ?? (ilvl === 0 ? 'decimal' : 'upperLetter');
  if (numFmt === 'bullet' || numFmt === 'none') return '';

  const startVal =
    numbering.numStartOverrides.get(numId)?.get(ilvl) ?? lvlDef?.start ?? 1;

  let counterMap = numbering.counters.get(numId);
  if (!counterMap) {
    counterMap = new Map<number, number>();
    numbering.counters.set(numId, counterMap);
  }

  const nextVal = counterMap.has(ilvl) ? counterMap.get(ilvl)! + 1 : startVal;
  counterMap.set(ilvl, nextVal);

  // Reset deeper levels whenever a shallower numbering level advances
  for (const existingLvl of Array.from(counterMap.keys())) {
    if (existingLvl > ilvl) {
      counterMap.delete(existingLvl);
    }
  }

  // Never duplicate prefix if paragraph already carries an explicit marker
  if (
    /^(?:Câu|Cau|Question|Bài|Bai|Phần|Phan)\s*\d+/i.test(trimmed) ||
    /^[A-Da-d][\.\)]\s*/.test(trimmed)
  ) {
    return '';
  }

  const formatted = formatNumberingValue(nextVal, numFmt);
  if (!formatted) return '';

  if (numFmt === 'upperLetter') {
    return `${formatted}. `;
  }
  if (numFmt === 'lowerLetter') {
    return `${formatted}) `;
  }
  if (numFmt === 'decimal') {
    const rawLvlText = lvlDef?.lvlText ?? '';
    if (/(?:Câu|Cau|Question|Bài|Bai)/i.test(rawLvlText)) {
      const expanded = rawLvlText.replace(/%\d+/g, formatted).trim();
      return /[:.)]$/.test(expanded) ? `${expanded} ` : `${expanded}: `;
    }
    if (ilvl === 0) {
      return `Câu ${formatted}: `;
    }
  }
  if (numFmt === 'upperRoman' && ilvl === 0) {
    return `Phần ${formatted}. `;
  }
  return `${formatted}. `;
}

interface DocxExtractionContext {
  relsById: Map<string, string>;
  mediaByTarget: Map<string, MediaDescriptor>;
  embeddingsByTarget: Map<string, Uint8Array>;
  resolvedAssetByTarget: Map<string, MathVisualAsset>;
  assets: MathVisualAsset[];
  imageCounter: { count: number };
  ommlCounter: { count: number };
  oleSvgCounter: { count: number };
  oleCounter: {
    count: number;
    decodedLatexCount: number;
    wmfPreviewCount: number;
    unresolvedCount: number;
    unresolvedDetails: DocxUnresolvedOleDetail[];
    progIds: Set<string>;
    wmfPreviewRefs: Set<string>;
  };
  convertedWmfMediaCount: { count: number };
  unsupportedMediaRefs: Set<string>;
  numbering: DocxNumberingRegistry;
  warnings: string[];
}

function resolveImageAssetByRelId(
  rId: string,
  ctx: DocxExtractionContext,
  locationHint: string
): { kind: 'asset'; asset: MathVisualAsset } | { kind: 'unsupported'; target: string } | null {
  const target = ctx.relsById.get(rId);
  if (!target) return null;
  const media = ctx.mediaByTarget.get(target);
  if (!media) return null;

  if (!media.supported || !media.dataUrl) {
    return { kind: 'unsupported', target };
  }

  let existing = ctx.resolvedAssetByTarget.get(target);
  if (!existing) {
    ctx.imageCounter.count += 1;
    const ord = ctx.imageCounter.count;
    existing = createMathVisualAsset({
      id: `docx-img-${ord}`,
      kind: 'image',
      label: media.fileName,
      sourceData: media.dataUrl,
      altText: `Hình trích xuất từ DOCX (${media.fileName})`,
      required: true,
      sourcePartPath: media.normalizedTarget,
      sourceRelationshipId: rId,
      sourceOrdinal: ord,
      sourceLocation: locationHint,
    });
    ctx.resolvedAssetByTarget.set(target, existing);
    ctx.assets.push(existing);
  }

  return { kind: 'asset', asset: existing };
}

function collectBodyBlockElements(container: XmlNode): XmlNode[] {
  const blocks: XmlNode[] = [];
  for (const child of container.children ?? []) {
    if (child.type !== 'element') continue;
    if (child.tag === 'w:p' || child.tag === 'w:tbl') {
      blocks.push(child);
    } else if (child.tag === 'w:sdt') {
      const sdtContent = findChildren(child, 'w:sdtContent')[0];
      if (sdtContent) {
        blocks.push(...collectBodyBlockElements(sdtContent));
      }
    }
  }
  return blocks;
}

function computeBinaryContentHash(bytes: Uint8Array): string {
  // Deterministic 64-bit dual-FNV hex digest (sync, works identically in browser & Node)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b1;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= b ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function resolveOleElement(
  oleContainerNode: XmlNode,
  ctx: DocxExtractionContext,
  paragraphLocation: string
): {
  replacementText: string;
  assetId?: string;
  decodedLatex: boolean;
  wmfPreviewUsed: boolean;
  unresolved: boolean;
} {
  ctx.oleCounter.count += 1;
  const oleObjNodes =
    oleContainerNode.tag === 'o:OLEObject'
      ? [oleContainerNode]
      : findAllDescendants(oleContainerNode, 'o:OLEObject');

  let progId: string | undefined;
  let oleTarget: string | undefined;
  let oleBytes: Uint8Array | undefined;

  for (const ole of oleObjNodes) {
    const p = ole.attrs?.ProgID || ole.attrs?.['o:ProgID'] || ole.attrs?.progId;
    if (p) {
      progId = p;
      ctx.oleCounter.progIds.add(p);
    }
    const rId = ole.attrs?.['r:id'] || ole.attrs?.['o:relid'];
    if (rId) {
      const target = ctx.relsById.get(rId);
      if (target) {
        oleTarget = target;
        const bin = ctx.embeddingsByTarget.get(target);
        if (bin) oleBytes = bin;
      }
    }
  }

  let wmfPreviewTarget: string | undefined;
  let wmfPreviewBytes: Uint8Array | undefined;
  let supportedRasterPreviewAsset: MathVisualAsset | undefined;

  const vmlPreviews = findAllDescendants(oleContainerNode, 'v:imagedata');
  for (const preview of vmlPreviews) {
    const rId =
      preview.attrs?.['r:id'] ||
      preview.attrs?.['r:embed'] ||
      preview.attrs?.['o:relid'];
    if (!rId) continue;
    const target = ctx.relsById.get(rId);
    if (!target) continue;
    const media = ctx.mediaByTarget.get(target);
    if (!media) continue;
    if (media.ext.toLowerCase() === 'wmf' && media.rawBytes) {
      wmfPreviewTarget = target;
      wmfPreviewBytes = media.rawBytes;
      ctx.oleCounter.wmfPreviewRefs.add(target);
    } else if (media.supported && media.dataUrl && !media.convertedFromWmf) {
      const resolved = resolveImageAssetByRelId(rId, ctx, paragraphLocation);
      if (resolved?.kind === 'asset') {
        supportedRasterPreviewAsset = resolved.asset;
      }
    } else if (!media.supported) {
      wmfPreviewTarget = target;
      ctx.oleCounter.wmfPreviewRefs.add(target);
    }
  }

  const decoded = decodeOleFormulaPayload({
    oleBytes,
    wmfPreviewBytes,
    progId,
  });

  if (decoded.mode === 'ole-mtef-latex' && decoded.latex) {
    ctx.oleCounter.decodedLatexCount += 1;
    return {
      replacementText: `$${decoded.latex}$`,
      decodedLatex: true,
      wmfPreviewUsed: false,
      unresolved: false,
    };
  }

  if (decoded.mode === 'ole-wmf-svg-preview' && decoded.svgDataUrl) {
    ctx.oleCounter.wmfPreviewCount += 1;
    ctx.oleSvgCounter.count += 1;
    const svgId = `docx-ole-svg-${ctx.oleSvgCounter.count}`;
    const asset = createMathVisualAsset({
      id: svgId,
      kind: 'geometry-svg',
      label: `Công thức OLE (WMF→SVG #${ctx.oleSvgCounter.count})`,
      sourceData: decoded.svgDataUrl,
      altText: `Công thức toán trích từ WMF preview (${progId ?? 'OLE'})`,
      required: true,
      sourcePartPath: wmfPreviewTarget ?? oleTarget ?? 'word/embeddings',
      sourceOrdinal: ctx.oleSvgCounter.count,
      sourceLocation: paragraphLocation,
    });
    ctx.assets.push(asset);
    return {
      replacementText: ` [[ASSET:${svgId}]] `,
      assetId: svgId,
      decodedLatex: false,
      wmfPreviewUsed: true,
      unresolved: false,
    };
  }

  if (supportedRasterPreviewAsset) {
    ctx.oleCounter.wmfPreviewCount += 1;
    return {
      replacementText: ` [[ASSET:${supportedRasterPreviewAsset.id}]] `,
      assetId: supportedRasterPreviewAsset.id,
      decodedLatex: false,
      wmfPreviewUsed: true,
      unresolved: false,
    };
  }

  ctx.oleCounter.unresolvedCount += 1;
  if (wmfPreviewTarget) {
    ctx.unsupportedMediaRefs.add(wmfPreviewTarget);
  }
  ctx.oleCounter.unresolvedDetails.push({
    location: paragraphLocation,
    progId,
    oleTarget,
    wmfPreviewTarget,
    reason:
      decoded.reason ??
      'Không giải mã được MTEF và không có ảnh xem trước WMF/PNG hợp lệ.',
  });
  return {
    replacementText: ' [CÔNG_THỨC_OLE_LEGACY] ',
    decodedLatex: false,
    wmfPreviewUsed: false,
    unresolved: true,
  };
}

function isRunUnderlined(rPr?: XmlNode): boolean {
  if (!rPr) return false;
  const uNode = findFirstDescendant(rPr, 'w:u');
  if (!uNode) return false;
  const val = (uNode.attrs?.['w:val'] ?? 'single').toLowerCase();
  return val !== 'none' && val !== 'false' && val !== '0';
}

function extractParagraphContent(
  pNode: XmlNode,
  ctx: DocxExtractionContext,
  paragraphLocation: string
): DocxParagraphSegment {
  let text = '';
  const ommlFragments: ExtractedOmmlFragment[] = [];
  const assetIds: string[] = [];
  const oleWmfPreviewAssetIds: string[] = [];
  const runTokens: Array<{ text: string; underlined: boolean }> = [];
  let hasBoldCorrectCue = false;
  let hasLegacyOleEquation = false;
  let hasAnchoredImage = false;
  let oleDecodedLatexCount = 0;
  let unresolvedOleCount = 0;

  const attachRelId = (rId: string): boolean => {
    const resolved = resolveImageAssetByRelId(rId, ctx, paragraphLocation);
    if (!resolved) return false;
    if (resolved.kind === 'asset') {
      if (!assetIds.includes(resolved.asset.id)) {
        assetIds.push(resolved.asset.id);
      }
      text += ` [[ASSET:${resolved.asset.id}]] `;
      return true;
    } else {
      ctx.unsupportedMediaRefs.add(resolved.target);
      return false;
    }
  };

  const walkParagraphNode = (node: XmlNode) => {
    if (node.type === 'text') return;
    const tag = node.tag ?? '';

    // Handle mc:AlternateContent cleanly: prefer mc:Choice, only walk mc:Fallback if Choice yielded no content/media
    if (tag === 'mc:AlternateContent') {
      const choice = findChildren(node, 'mc:Choice')[0];
      const fallback = findChildren(node, 'mc:Fallback')[0];
      const beforeTextLen = text.length;
      const beforeAssets = assetIds.length;
      const beforeOmml = ommlFragments.length;
      if (choice) {
        for (const ch of choice.children ?? []) {
          walkParagraphNode(ch);
        }
      }
      const choiceYieldedSomething =
        text.length > beforeTextLen ||
        assetIds.length > beforeAssets ||
        ommlFragments.length > beforeOmml;
      if (!choiceYieldedSomething && fallback) {
        for (const fb of fallback.children ?? []) {
          walkParagraphNode(fb);
        }
      }
      return;
    }

    if (tag === 'm:oMathPara' || tag === 'm:oMath') {
      ctx.ommlCounter.count += 1;
      const frag = convertOmmlNodeToLatex(node, `omml-${ctx.ommlCounter.count}`);
      ommlFragments.push(frag);
      text += frag.latex || '[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]';
      if (frag.complexFallback) {
        ctx.warnings.push(
          `Công thức OMML #${ctx.ommlCounter.count} tại ${paragraphLocation} có cấu trúc phức tạp — cần giáo viên rà soát lại phần hiển thị.`
        );
      }
      return;
    }

    if (tag === 'w:object' || tag === 'o:OLEObject') {
      const res = resolveOleElement(node, ctx, paragraphLocation);
      if (res.decodedLatex) oleDecodedLatexCount += 1;
      if (res.wmfPreviewUsed && res.assetId) {
        if (!assetIds.includes(res.assetId)) assetIds.push(res.assetId);
        oleWmfPreviewAssetIds.push(res.assetId);
      }
      if (res.unresolved) {
        hasLegacyOleEquation = true;
        unresolvedOleCount += 1;
      }
      text += res.replacementText;
      return;
    }

    if (tag === 'w:drawing') {
      if (findFirstDescendant(node, 'wp:anchor')) {
        hasAnchoredImage = true;
      }
      const blips = findAllDescendants(node, 'a:blip');
      for (const blip of blips) {
        const rId = blip.attrs?.['r:embed'] || blip.attrs?.['r:link'];
        if (rId) attachRelId(rId);
      }
      return;
    }

    if (tag === 'w:pict') {
      const vmlImages = findAllDescendants(node, 'v:imagedata');
      for (const vImg of vmlImages) {
        const rId =
          vImg.attrs?.['r:id'] ||
          vImg.attrs?.['r:embed'] ||
          vImg.attrs?.['r:pict'] ||
          vImg.attrs?.['o:relid'];
        if (rId) attachRelId(rId);
      }
      return;
    }

    if (tag === 'w:r') {
      const rPr = findChildren(node, 'w:rPr')[0];
      const isBold = Boolean(findFirstDescendant(rPr, 'w:b'));
      const hasUnderline = isRunUnderlined(rPr);
      const colorVal = findFirstDescendant(rPr, 'w:color')?.attrs?.['w:val']?.toLowerCase();
      const hasRedOrBlueHighlight =
        Boolean(colorVal && colorVal !== '000000' && colorVal !== 'auto') ||
        Boolean(findFirstDescendant(rPr, 'w:highlight'));

      const vertAlign = findFirstDescendant(rPr, 'w:vertAlign')?.attrs?.['w:val'];

      // Walk direct children of <w:r> in document order so text, OLE, drawings, and AlternateContent stay strictly ordered!
      for (const child of node.children ?? []) {
        if (child.type !== 'element') continue;
        const cTag = child.tag ?? '';
        if (cTag === 'w:rPr') continue;
        if (
          cTag === 'mc:AlternateContent' ||
          cTag === 'w:object' ||
          cTag === 'o:OLEObject' ||
          cTag === 'w:drawing' ||
          cTag === 'w:pict' ||
          cTag === 'm:oMath' ||
          cTag === 'm:oMathPara'
        ) {
          walkParagraphNode(child);
          continue;
        }

        let runChunk = '';
        if (cTag === 'w:t' || cTag === 'w:delText') {
          runChunk = collectNodeText(child);
        } else if (cTag === 'w:tab') {
          runChunk = '\t';
        } else if (cTag === 'w:br' || cTag === 'w:cr') {
          runChunk = '\n';
        }

        if (runChunk) {
          runTokens.push({ text: runChunk, underlined: hasUnderline });
          if (
            (isBold || hasUnderline || hasRedOrBlueHighlight) &&
            /^\s*[A-Da-d]\./.test(runChunk.trim())
          ) {
            hasBoldCorrectCue = true;
          }
          if (vertAlign === 'subscript') {
            const sub = toUnicodeSubOrSup(runChunk, 'subscript');
            text += sub.fullyMapped ? sub.text : `_{${runChunk}}`;
          } else if (vertAlign === 'superscript') {
            const sup = toUnicodeSubOrSup(runChunk, 'superscript');
            text += sup.fullyMapped ? sup.text : `^{${runChunk}}`;
          } else {
            text += runChunk;
          }
        }
      }
      return;
    }

    for (const child of node.children ?? []) {
      walkParagraphNode(child);
    }
  };

  walkParagraphNode(pNode);

  // Detect exact underlined option labels (A/B/C/D) and statement labels (a/b/c/d) across adjacent runs
  // (Handles both `<u>A.</u>` and `<u>A</u>.` where punctuation is in the following non-underlined run!)
  const underlinedOptionLabels: Array<'A' | 'B' | 'C' | 'D'> = [];
  const underlinedStatementLabels: Array<'a' | 'b' | 'c' | 'd'> = [];
  for (let i = 0; i < runTokens.length; i++) {
    const tok = runTokens[i];
    if (!tok.underlined) continue;
    const prevTail = i > 0 ? runTokens[i - 1].text : '';
    const nextHead = i + 1 < runTokens.length ? runTokens[i + 1].text : '';
    const trimmedTok = tok.text.trim();

    // Case 1: Run itself contains `A.` or `B.` or multiple option headers underlined
    const optMatches = Array.from(
      tok.text.matchAll(/(?:^|[\s\t])([ABCD])\s*\./g)
    );
    for (const m of optMatches) {
      const lbl = m[1] as 'A' | 'B' | 'C' | 'D';
      if (!underlinedOptionLabels.includes(lbl)) underlinedOptionLabels.push(lbl);
    }
    // Case 2: Only single letter `A`/`B`/`C`/`D` is underlined, followed by `.` or `)` in next run
    if (
      /^[ABCD]$/.test(trimmedTok) &&
      (prevTail === '' || /[\s\t\n]$/.test(prevTail)) &&
      /^\s*[.)]/.test(nextHead)
    ) {
      const lbl = trimmedTok as 'A' | 'B' | 'C' | 'D';
      if (!underlinedOptionLabels.includes(lbl)) underlinedOptionLabels.push(lbl);
    }

    // Statement labels `a)` / `b)` / `c)` / `d)`
    const stmtMatches = Array.from(
      tok.text.matchAll(/(?:^|[\s\t])([abcd])\s*\)/g)
    );
    for (const m of stmtMatches) {
      const lbl = m[1] as 'a' | 'b' | 'c' | 'd';
      if (!underlinedStatementLabels.includes(lbl)) {
        underlinedStatementLabels.push(lbl);
      }
    }
    if (
      /^[abcd]$/.test(trimmedTok) &&
      (prevTail === '' || /[\s\t\n]$/.test(prevTail)) &&
      /^\s*\)/.test(nextHead)
    ) {
      const lbl = trimmedTok as 'a' | 'b' | 'c' | 'd';
      if (!underlinedStatementLabels.includes(lbl)) {
        underlinedStatementLabels.push(lbl);
      }
    }
  }

  const hasNonEmptyContent =
    text.trim().length > 0 || assetIds.length > 0 || ommlFragments.length > 0;
  const autoPrefix = resolveParagraphAutoNumberPrefix(
    pNode,
    text,
    hasNonEmptyContent,
    ctx.numbering
  );
  if (autoPrefix) {
    text = `${autoPrefix}${text.trimStart()}`;
  }

  return {
    text,
    ommlFragments,
    assetIds,
    paragraphLocation,
    hasBoldCorrectCue,
    underlinedOptionLabels:
      underlinedOptionLabels.length > 0 ? underlinedOptionLabels : undefined,
    underlinedStatementLabels:
      underlinedStatementLabels.length > 0 ? underlinedStatementLabels : undefined,
    hasAnchoredImage: hasAnchoredImage || undefined,
    hasLegacyOleEquation,
    oleDecodedLatexCount: oleDecodedLatexCount > 0 ? oleDecodedLatexCount : undefined,
    oleWmfPreviewAssetIds:
      oleWmfPreviewAssetIds.length > 0 ? oleWmfPreviewAssetIds : undefined,
    unresolvedOleCount: unresolvedOleCount > 0 ? unresolvedOleCount : undefined,
  };
}

const EXAM_HEADER_STRONG_RE =
  /(?:SỞ\s+GIÁO\s+DỤC|PHÒNG\s+GIÁO\s+DỤC|BỘ\s+GIÁO\s+DỤC|UBND|TRƯỜNG\s+(?:THPT|THCS|TIỂU\s+HỌC|ĐẠI\s+HỌC)|ĐỀ\s+(?:KIỂM\s+TRA|THI)|KỲ\s+THI)/i;
const EXAM_HEADER_META_RE =
  /(?:MÃ\s+ĐỀ|THỜI\s+GIAN\s+LÀM\s+BÀI|HỌ\s+VÀ\s+TÊN|SỐ\s+BÁO\s+DANH|NĂM\s+HỌC|HỌC\s+K[ÌỲ]|MÔN\s*[:.]|ĐIỂM|LỜI\s+PHÊ|CHỮ\s+K[ÝÍ]|ĐỀ\s+CHÍNH\s+THỨC|TRANG\s+\d+\/\d+)/i;
const VARIATION_OR_QUESTION_RE =
  /(?:^\s*(?:Câu|Question|Bài)\s+\d+\s*[.:)\-–]|f'\s*\(|y'\s*\||-\s*∞|\+\s*∞|-\\infty|\+\\infty)/im;
const CELL_NEWLINE_MARKER_RE =
  /^\s*(?:(?:Câu|Question|Bài)\s+\d+\s*[.:)\-–]|PHẦN\s+[IVX\d]+|[A-D]\s*[.)]|[a-d]\s*[.)])/i;
const QUESTION_BOUNDARY_RE = /^\s*(?:\*{1,2}|\[)?(?:Câu|Question|Bài)\s+\d{1,3}(?:\]|\*{1,2})?\s*[.:)\-–]/im;

/**
 * Nhận diện bảng khung tiêu đề đề thi (Sở GD&ĐT / Trường / Đề kiểm tra / Mã đề / Họ và tên)
 * xuất hiện ở đầu tài liệu Word trước Câu 1, tránh đánh nhầm thành bảng dữ liệu câu hỏi hoặc nhóm ngữ liệu.
 */
export function isExamHeaderBannerTable(tableBody: string): boolean {
  const trimmed = tableBody.trim();
  if (!trimmed || trimmed.length > 1500) return false;
  if (VARIATION_OR_QUESTION_RE.test(trimmed)) return false;
  const hasStrong = EXAM_HEADER_STRONG_RE.test(trimmed);
  const metaMatches = trimmed.match(new RegExp(EXAM_HEADER_META_RE.source, 'gi')) ?? [];
  return (hasStrong && metaMatches.length >= 1) || metaMatches.length >= 2;
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
  const rawUint8 =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const byteLen = rawUint8.byteLength;
  if (byteLen > DOCX_MAX_FILE_BYTES) {
    throw new Error('File .docx vượt quá giới hạn 50 MB.');
  }
  const sourceFileHash = computeBinaryContentHash(rawUint8);

  const zip = await JSZip.loadAsync(rawUint8);
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
  const mediaByTarget = new Map<string, MediaDescriptor>();
  const embeddingsByTarget = new Map<string, Uint8Array>();
  const convertedWmfMediaCount = { count: 0 };

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

      if (/\/embeddings\//i.test(normalizedTarget) && !embeddingsByTarget.has(normalizedTarget)) {
        const embEntry = zip.file(normalizedTarget);
        if (embEntry) {
          const embBytes = await embEntry.async('uint8array');
          embeddingsByTarget.set(normalizedTarget, embBytes);
        }
      }

      if (/\/media\//i.test(normalizedTarget) && !mediaByTarget.has(normalizedTarget)) {
        const mediaEntry = zip.file(normalizedTarget);
        const ext = (normalizedTarget.split('.').pop() ?? '').toLowerCase();
        const mimeInfo = getMimeFromExt(ext);
        const fileName = normalizedTarget.split('/').pop() ?? `image.${ext}`;
        if (mediaEntry && mimeInfo.supported) {
          let base64 = await mediaEntry.async('base64');
          if (ext === 'svg') {
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
          mediaByTarget.set(normalizedTarget, {
            normalizedTarget,
            fileName,
            ext,
            supported: true,
            dataUrl,
          });
        } else if (mediaEntry && ext === 'wmf') {
          const rawBytes = await mediaEntry.async('uint8array');
          const wmfConv = convertWmfToSvg(rawBytes);
          if (wmfConv.ok && wmfConv.svgDataUrl) {
            convertedWmfMediaCount.count += 1;
            mediaByTarget.set(normalizedTarget, {
              normalizedTarget,
              fileName,
              ext,
              supported: true,
              dataUrl: wmfConv.svgDataUrl,
              rawBytes,
              convertedFromWmf: true,
            });
          } else {
            mediaByTarget.set(normalizedTarget, {
              normalizedTarget,
              fileName,
              ext,
              supported: false,
              rawBytes,
              wmfFailureReason: wmfConv.reason,
            });
          }
        } else if (mediaEntry && !mimeInfo.supported) {
          const rawBytes = await mediaEntry.async('uint8array');
          mediaByTarget.set(normalizedTarget, {
            normalizedTarget,
            fileName,
            ext,
            supported: false,
            rawBytes,
          });
        }
      }
    }
  }

  let numbering: DocxNumberingRegistry = {
    abstractLevels: new Map(),
    numToAbstract: new Map(),
    numStartOverrides: new Map(),
    counters: new Map(),
  };
  const numberingFile = zip.file('word/numbering.xml');
  if (numberingFile) {
    const numberingXml = await numberingFile.async('string');
    assertSafeXmlPayload(numberingXml, 'word/numbering.xml');
    numbering = parseDocxNumberingXml(numberingXml);
  }

  const docXml = await documentFile.async('string');
  assertSafeXmlPayload(docXml, 'word/document.xml');
  const docTree = parseXmlTree(docXml);
  const body = findFirstDescendant(docTree, 'w:body');
  if (!body) {
    throw new Error('File .docx không có phần thân nội dung (w:body).');
  }

  const ctx: DocxExtractionContext = {
    relsById,
    mediaByTarget,
    embeddingsByTarget,
    resolvedAssetByTarget: new Map(),
    assets: [],
    imageCounter: { count: 0 },
    ommlCounter: { count: 0 },
    oleSvgCounter: { count: 0 },
    oleCounter: {
      count: 0,
      decodedLatexCount: 0,
      wmfPreviewCount: 0,
      unresolvedCount: 0,
      unresolvedDetails: [],
      progIds: new Set<string>(),
      wmfPreviewRefs: new Set<string>(),
    },
    convertedWmfMediaCount,
    unsupportedMediaRefs: new Set<string>(),
    numbering,
    warnings,
  };

  const paragraphs: DocxParagraphSegment[] = [];
  const allOmml: ExtractedOmmlFragment[] = [];
  let hasUnresolvedLegacyOle = false;
  let tableOrdinal = 0;
  let paragraphOrdinal = 0;
  let hasSeenQuestion = false;

  const bodyBlocks = collectBodyBlockElements(body);

  for (const child of bodyBlocks) {
    if (child.tag === 'w:p') {
      paragraphOrdinal += 1;
      const seg = extractParagraphContent(
        child,
        ctx,
        `word/document.xml#w:p[${paragraphOrdinal}]`
      );
      if (seg.hasLegacyOleEquation) hasUnresolvedLegacyOle = true;
      allOmml.push(...seg.ommlFragments);
      if (seg.text.trim() || seg.assetIds.length > 0) {
        if (QUESTION_BOUNDARY_RE.test(seg.text)) {
          hasSeenQuestion = true;
        }
        paragraphs.push(seg);
      }
    } else if (child.tag === 'w:tbl') {
      const nextTableOrdinal = tableOrdinal + 1;
      const rows = findChildren(child, 'w:tr');
      const rowTexts: string[] = [];
      const tableRows: string[][] = [];
      const rowAssetIds: string[] = [];
      for (const tr of rows) {
        const cells = findChildren(tr, 'w:tc');
        const cellTexts: string[] = [];
        for (const tc of cells) {
          const cellPs = findChildren(tc, 'w:p');
          const cellSegs = cellPs.map((cp, cpIdx) =>
            extractParagraphContent(
              cp,
              ctx,
              `word/document.xml#w:tbl[${nextTableOrdinal}]/w:p[${cpIdx + 1}]`
            )
          );
          for (const cs of cellSegs) {
            if (cs.hasLegacyOleEquation) hasUnresolvedLegacyOle = true;
            allOmml.push(...cs.ommlFragments);
            rowAssetIds.push(...cs.assetIds);
          }
          const nonEmptyCellTexts = cellSegs
            .map((s) => s.text.trim())
            .filter(Boolean);
          const preserveCellLineBreaks =
            nonEmptyCellTexts.length > 1 &&
            nonEmptyCellTexts.some((t) => CELL_NEWLINE_MARKER_RE.test(t));
          cellTexts.push(nonEmptyCellTexts.join(preserveCellLineBreaks ? '\n' : ' '));
        }
        tableRows.push(cellTexts);
        rowTexts.push(cellTexts.join(' | '));
      }
      const tableBody = rowTexts.filter(Boolean).join('\n');
      if (tableBody) {
        const isHeaderBanner = !hasSeenQuestion && isExamHeaderBannerTable(tableBody);
        if (QUESTION_BOUNDARY_RE.test(tableBody)) {
          hasSeenQuestion = true;
        }
        if (isHeaderBanner) {
          paragraphs.push({
            text: tableBody,
            ommlFragments: [],
            assetIds: [...rowAssetIds],
            tableText: tableBody,
            tableRows,
            paragraphLocation: `word/document.xml#w:tbl[banner]`,
          });
        } else {
          tableOrdinal = nextTableOrdinal;
          const tblAssetId = `docx-tbl-${tableOrdinal}`;
          const tableAsset = createMathVisualAsset({
            id: tblAssetId,
            kind: 'data-table',
            label: `Bảng dữ liệu DOCX #${tableOrdinal}`,
            sourceData: tableBody,
            altText: 'Bảng dữ liệu trích xuất từ file Word',
            required: true,
            sourcePartPath: 'word/document.xml',
            sourceOrdinal: tableOrdinal,
            sourceLocation: `w:body/w:tbl[${tableOrdinal}]`,
          });
          ctx.assets.push(tableAsset);
          paragraphs.push({
            text: `${tableBody}\n[[ASSET:${tblAssetId}]]`,
            ommlFragments: [],
            assetIds: [tblAssetId, ...rowAssetIds],
            tableText: tableBody,
            tableRows,
            paragraphLocation: `word/document.xml#w:tbl[${tableOrdinal}]`,
          });
        }
      }
    }
  }

  if (ctx.oleCounter.unresolvedCount > 0) {
    const progIds = Array.from(ctx.oleCounter.progIds);
    const progIdNote = progIds.length > 0 ? ` (${progIds.join(', ')})` : '';
    warnings.push(
      `CHẶN XUẤT: Có ${ctx.oleCounter.unresolvedCount}/${ctx.oleCounter.count} công thức OLE${progIdNote} chưa giải mã được sang LaTeX hoặc WMF→SVG hợp lệ. Không thể xuất đề chứa placeholder.`
    );
  } else if (ctx.oleCounter.wmfPreviewCount > 0) {
    warnings.push(
      `Đã dựng ảnh vector SVG từ WMF preview cho ${ctx.oleCounter.wmfPreviewCount} công thức OLE (hiển thị được, nhưng chưa có LaTeX máy đọc được — cần kiểm tra trước khi chấm tự động biểu thức).`
    );
  }

  if (ctx.unsupportedMediaRefs.size > 0) {
    const sampleTargets = Array.from(ctx.unsupportedMediaRefs)
      .slice(0, 3)
      .map((t) => t.split('/').pop() ?? t)
      .join(', ');
    const moreSuffix =
      ctx.unsupportedMediaRefs.size > 3
        ? `, +${ctx.unsupportedMediaRefs.size - 3} tệp khác`
        : '';
    warnings.push(
      `Phát hiện ${ctx.unsupportedMediaRefs.size} tệp hình ảnh/vector WMF/EMF không đọc được (${sampleTargets}${moreSuffix}) trong .docx — hãy kiểm tra hoặc thay bằng PNG/SVG/LaTeX.`
    );
  }

  return {
    plainTextWithMarkers: paragraphs.map((p) => p.text).join('\n'),
    paragraphs,
    ommlFragments: allOmml,
    assets: ctx.assets,
    warnings: Array.from(new Set(warnings)),
    hasLegacyOleEquation: hasUnresolvedLegacyOle || ctx.oleCounter.unresolvedCount > 0,
    hasVbaMacro,
    legacyOleCount: ctx.oleCounter.count,
    legacyOleDecodedLatexCount: ctx.oleCounter.decodedLatexCount,
    legacyOleWmfPreviewCount: ctx.oleCounter.wmfPreviewCount,
    unresolvedOleCount: ctx.oleCounter.unresolvedCount,
    unresolvedOleDetails: ctx.oleCounter.unresolvedDetails,
    legacyOleProgIds: Array.from(ctx.oleCounter.progIds),
    unsupportedMediaCount: ctx.unsupportedMediaRefs.size,
    convertedWmfMediaCount: ctx.convertedWmfMediaCount.count,
    tableCount: tableOrdinal,
    supportedImageCount: ctx.imageCounter.count,
    sourceFileHash,
  };
}
