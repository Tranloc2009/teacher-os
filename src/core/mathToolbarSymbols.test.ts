import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import {
  ALL_MATH_SYMBOLS,
  EXTENDED_MATH_SYMBOLS,
  PRIMARY_MATH_SYMBOLS,
  createFieldHistory,
  getMathSymbolById,
  insertMathSymbolAtCursor,
  isOffsetInsideLatexDelimiters,
  pushFieldHistory,
  redoFieldHistory,
  undoFieldHistory,
} from './mathToolbarSymbols';
import {
  computeLockStats,
  evaluatePreMixIntegrity,
  parseMathContent,
} from './mathIntegrity';
import { generateMixedExams } from './mathShuffleEngine';
import { buildStudentExamDocxBuffer, verifyExportedDocxBuffer } from './examExportEngine';
import { extractDocxDocument } from './ooxmlParser';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import { MathExamProject } from '../types/mathExam';

test('All 10 primary math toolbar symbols match exact LaTeX specs and render cleanly in KaTeX', () => {
  assert.equal(PRIMARY_MATH_SYMBOLS.length, 10);

  const expectedSpecs: Array<[string, string]> = [
    ['fraction', '\\frac{a}{b}'],
    ['sqrt', '\\sqrt{x}'],
    ['superscript', 'x^{2}'],
    ['subscript', 'x_{i}'],
    ['limit', '\\lim_{x\\to a} f(x)'],
    ['integral', '\\int_a^b f(x)\\,dx'],
    ['vector', '\\vec{AB}'],
    ['log', '\\log_a x'],
    ['cases', '\\begin{cases}x+y=3\\\\x-y=1\\end{cases}'],
    ['real-set', '\\mathbb{R}'],
  ];

  expectedSpecs.forEach(([id, expectedLatex], idx) => {
    const sym = PRIMARY_MATH_SYMBOLS[idx];
    assert.equal(sym.id, id);
    assert.equal(sym.latex, expectedLatex);
    assert.equal(sym.previewLatex, expectedLatex);
  });

  // Every primary and extended symbol must render with throwOnError: true
  assert.ok(EXTENDED_MATH_SYMBOLS.length > 0);
  for (const sym of ALL_MATH_SYMBOLS) {
    const html = katex.renderToString(sym.previewLatex, {
      displayMode: false,
      throwOnError: true,
      strict: false,
    });
    assert.ok(html.includes('katex'), `Expected KaTeX output for ${sym.id}`);
  }
});

test('insertMathSymbolAtCursor preserves surrounding text, inserts LaTeX only, and places cursor on editable placeholder', () => {
  const frac = getMathSymbolById('fraction')!;
  const res1 = insertMathSymbolAtCursor('Tìm giá trị  trên khoảng đã cho.', 12, 12, frac);
  assert.equal(res1.nextValue, 'Tìm giá trị $\\frac{a}{b}$ trên khoảng đã cho.');
  assert.equal(res1.nextValue.slice(res1.selectionStart, res1.selectionEnd), 'a');
  assert.equal(res1.wrappedInDelimiters, true);
  assert.ok(!res1.nextValue.includes('Phân số'));

  const sqrt = getMathSymbolById('sqrt')!;
  const resSqrt = insertMathSymbolAtCursor('Biểu thức ', 10, 10, sqrt);
  assert.equal(resSqrt.nextValue, 'Biểu thức $\\sqrt{x}$');
  assert.equal(resSqrt.nextValue.slice(resSqrt.selectionStart, resSqrt.selectionEnd), 'x');

  const sup = getMathSymbolById('superscript')!;
  const resSup = insertMathSymbolAtCursor('', 0, 0, sup);
  assert.equal(resSup.nextValue, '$x^{2}$');
  assert.equal(resSup.nextValue.slice(resSup.selectionStart, resSup.selectionEnd), '2');

  const sub = getMathSymbolById('subscript')!;
  const resSub = insertMathSymbolAtCursor('', 0, 0, sub);
  assert.equal(resSub.nextValue, '$x_{i}$');
  assert.equal(resSub.nextValue.slice(resSub.selectionStart, resSub.selectionEnd), 'i');

  const vec = getMathSymbolById('vector')!;
  const resVec = insertMathSymbolAtCursor('Tính ', 5, 5, vec);
  assert.equal(resVec.nextValue, 'Tính $\\vec{AB}$');
  assert.equal(resVec.nextValue.slice(resVec.selectionStart, resVec.selectionEnd), 'AB');

  const cases = getMathSymbolById('cases')!;
  const resCases = insertMathSymbolAtCursor('Giải ', 5, 5, cases);
  assert.equal(resCases.nextValue, 'Giải $\\begin{cases}x+y=3\\\\x-y=1\\end{cases}$');
  assert.equal(resCases.nextValue.slice(resCases.selectionStart, resCases.selectionEnd), 'x+y=3');

  const realSet = getMathSymbolById('real-set')!;
  const resReal = insertMathSymbolAtCursor('Trên ', 5, 5, realSet);
  assert.equal(resReal.nextValue, 'Trên $\\mathbb{R}$');
  assert.equal(resReal.selectionStart, resReal.nextValue.length);
  assert.equal(resReal.selectionEnd, resReal.nextValue.length);
});

test('insertMathSymbolAtCursor avoids double-$ when cursor is already inside $...$ or $$...$$', () => {
  const src = 'Cho $y =  + 1$ là hàm số';
  const cursor = 9; // right after "y = " inside $...$
  assert.equal(isOffsetInsideLatexDelimiters(src, cursor), true);
  assert.equal(isOffsetInsideLatexDelimiters(src, 0), false);

  const frac = getMathSymbolById('fraction')!;
  const res = insertMathSymbolAtCursor(src, cursor, cursor, frac);
  assert.equal(res.wrappedInDelimiters, false);
  assert.equal(res.nextValue, 'Cho $y = \\frac{a}{b} + 1$ là hàm số');
  assert.equal(res.nextValue.slice(res.selectionStart, res.selectionEnd), 'a');
});

test('insertMathSymbolAtCursor replaces selected text accurately for expressions', () => {
  const frac = getMathSymbolById('fraction')!;
  const text1 = 'Tính 2x - 1 là:';
  const rFrac = insertMathSymbolAtCursor(text1, 5, 11, frac);
  assert.equal(rFrac.nextValue, 'Tính $\\frac{2x - 1}{b}$ là:');
  assert.equal(rFrac.nextValue.slice(rFrac.selectionStart, rFrac.selectionEnd), 'b');

  const sup = getMathSymbolById('superscript')!;
  const rSup = insertMathSymbolAtCursor('Đạo hàm của x + 1 bằng', 12, 17, sup);
  assert.equal(rSup.nextValue, 'Đạo hàm của $(x + 1)^{2}$ bằng');
  assert.equal(rSup.nextValue.slice(rSup.selectionStart, rSup.selectionEnd), '2');

  const sqrt = getMathSymbolById('sqrt')!;
  const rSqrt = insertMathSymbolAtCursor('Giá trị x^2 + 1 dương', 8, 15, sqrt);
  assert.equal(rSqrt.nextValue, 'Giá trị $\\sqrt{x^2 + 1}$ dương');

  // Consecutive external insertions never create an accidental $$ boundary
  const realSet = getMathSymbolById('real-set')!;
  const rAdjacent = insertMathSymbolAtCursor(
    '$\\frac{a}{b}$',
    '$\\frac{a}{b}$'.length,
    '$\\frac{a}{b}$'.length,
    realSet
  );
  assert.equal(rAdjacent.nextValue, '$\\frac{a}{b}$ $\\mathbb{R}$');
  assert.equal(rAdjacent.nextValue.includes('$$'), false);
});

test('FieldHistoryStack supports push, undo, and redo with cursor restoration', () => {
  let hist = createFieldHistory('Tìm ');
  const frac = getMathSymbolById('fraction')!;
  const inserted = insertMathSymbolAtCursor('Tìm ', 4, 4, frac);
  hist = pushFieldHistory(hist, {
    value: inserted.nextValue,
    selectionStart: inserted.selectionStart,
    selectionEnd: inserted.selectionEnd,
  });

  assert.equal(hist.past.length, 1);
  assert.equal(hist.present.value, 'Tìm $\\frac{a}{b}$');

  const u = undoFieldHistory(hist);
  assert.ok(u.applied);
  assert.equal(u.applied.value, 'Tìm ');
  assert.equal(u.nextState.future.length, 1);

  const r = redoFieldHistory(u.nextState);
  assert.ok(r.applied);
  assert.equal(r.applied.value, 'Tìm $\\frac{a}{b}$');
  assert.equal(r.applied.selectionStart, inserted.selectionStart);
});

test('Inserted symbols survive save/parse, integrity check, shuffle, and DOCX export without corruption', async () => {
  let raw = 'Xét ';
  for (const id of [
    'fraction',
    'sqrt',
    'superscript',
    'subscript',
    'limit',
    'integral',
    'vector',
    'log',
    'cases',
    'real-set',
  ]) {
    const sym = getMathSymbolById(id)!;
    const out = insertMathSymbolAtCursor(raw, raw.length, raw.length, sym);
    raw = `${out.nextValue} `;
  }
  raw = `${raw.trim()} với giá trị âm $-\\frac{5}{2}$.`;

  const parsedStem = parseMathContent(raw, 'test-stem');
  assert.equal(parsedStem.blocks.filter((b) => b.kind === 'latex').length, 11);

  const cloned: MathExamProject = {
    ...structuredClone(DEMO_MATH_EXAM),
    confirmedOriginalAnswers: true,
    questions: DEMO_MATH_EXAM.questions.map((q, idx) =>
      idx === 0 ? { ...q, stem: parsedStem } : q
    ),
  };

  // Re-evaluate pre-mix integrity -> must PASS without errors
  const preCheck = evaluatePreMixIntegrity(cloned);
  assert.notEqual(preCheck.status, 'BLOCKED');
  assert.ok(computeLockStats(cloned).totalQuestions === DEMO_MATH_EXAM.questions.length);

  // Shuffle & export DOCX -> verify exact symbols preserved inside DOCX XML
  const mixed = generateMixedExams(cloned);
  assert.equal(mixed.errors.length, 0);
  const ready: MathExamProject = { ...cloned, generatedVersions: mixed.versions };
  const docxBuf = await buildStudentExamDocxBuffer(ready, ready.generatedVersions[0]);
  const verify = await verifyExportedDocxBuffer(docxBuf, ready.generatedVersions[0], ready);
  assert.equal(verify.passed, true);
  assert.equal(verify.issues.length, 0);
  const extracted = await extractDocxDocument(docxBuf);
  const fullText = extracted.paragraphs.map((p) => p.text).join('\n');
  assert.ok(fullText.includes('\\frac{a}{b}'));
  assert.ok(fullText.includes('\\sqrt{x}'));
  assert.ok(fullText.includes('\\int_a^b f(x)\\,dx'));
  assert.ok(fullText.includes('\\begin{cases}x+y=3\\\\x-y=1\\end{cases}'));
  assert.ok(fullText.includes('-\\frac{5}{2}'));
});
