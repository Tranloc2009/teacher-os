import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  BUILT_IN_EXAM_FORM_PRESETS,
  EXAM_FORM_PLACEHOLDERS,
  buildPlaceholderContext,
  createCustomFormTemplate,
  deleteCustomFormTemplate,
  duplicateFormTemplate,
  estimateExamFormPagination,
  inspectFormExportWarnings,
  mergeStoredExamFormTemplates,
  renameCustomFormTemplate,
  resolveAutoOptionLayout,
  resolveExamFormPlaceholders,
  saveTemplateSafely,
  setDefaultFormTemplate,
} from './examFormEngine';
import {
  buildAnswerKeyDocxBuffer,
  buildStudentExamDocxBuffer,
  exportMixedExamZipBundle,
  runExamFormPostExportAudit,
  verifyExportedDocxBuffer,
  verifyExportedDocxRoundTrip,
  verifyExportedZipBundle,
} from './examExportEngine';
import {
  createInitialWorkflowContext,
  parseUniversalCommand,
  resolveStrictEntityById,
} from './connectedWorkflowEngine';
import { generateMixedExams } from './mathShuffleEngine';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import type { MathExamProject, MathQuestion } from '../types/mathExam';

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8b8AAAAASUVORK5CYII=';

function buildFourCodeExam(): MathExamProject {
  const ready = structuredClone(DEMO_MATH_EXAM);
  ready.confirmedOriginalAnswers = true;
  ready.questions = ready.questions.map((q) => ({
    ...q,
    answerConfirmed: true,
  }));
  ready.mixConfig = {
    ...ready.mixConfig,
    examCount: 4,
    startCodeNumber: 101,
    seed: 'phase3-qa-seed-101-104',
  };
  const mixed = generateMixedExams(ready);
  assert.equal(mixed.versions.length, 4);
  return {
    ...ready,
    generatedVersions: mixed.versions,
  };
}

test('P3-01: Saving edits on a built-in template protects original preset and saves as new custom copy', () => {
  const builtIn = structuredClone(BUILT_IN_EXAM_FORM_PRESETS[0]);
  builtIn.headerSettings.schoolName = 'TRƯỜNG THPT CHUYÊN LÊ HỒNG PHONG';
  const result = saveTemplateSafely(
    BUILT_IN_EXAM_FORM_PRESETS,
    builtIn,
    'Mẫu Giữa Kỳ LHP'
  );
  assert.equal(result.createdCopy, true);
  assert.equal(result.savedTemplate.isBuiltIn, false);
  assert.equal(result.savedTemplate.name, 'Mẫu Giữa Kỳ LHP');
  // Original built-in remains untouched
  const origInList = result.templates.find((t) => t.id === BUILT_IN_EXAM_FORM_PRESETS[0].id);
  assert.ok(origInList);
  assert.equal(origInList.headerSettings.schoolName, BUILT_IN_EXAM_FORM_PRESETS[0].headerSettings.schoolName);
});

test('P3-02: Reloading legacy stored templates via mergeStoredExamFormTemplates backfills Phase 3 defaults safely', () => {
  const legacyCustom = structuredClone(BUILT_IN_EXAM_FORM_PRESETS[0]);
  legacyCustom.id = 'form-custom-legacy-01';
  legacyCustom.name = 'Mẫu Cũ Trước Phase 3';
  legacyCustom.isBuiltIn = false;
  delete legacyCustom.headerSettings.schoolLogoDataUrl;
  delete legacyCustom.bodySettings.shortAnswerBoxStyle;
  delete legacyCustom.answerLayout.answerTableStyle;

  const merged = mergeStoredExamFormTemplates([legacyCustom]);
  const loaded = merged.find((t) => t.id === 'form-custom-legacy-01');
  assert.ok(loaded);
  assert.equal(loaded.isBuiltIn, false);
  assert.equal(loaded.bodySettings.shortAnswerBoxStyle, 'dotted-line');
  assert.equal(loaded.answerLayout.answerTableStyle, 'multi-column');
  assert.ok(merged.length >= 11);
});

test('P3-03: Duplicate, rename custom template, and protect built-in presets from rename/delete', () => {
  const dup = duplicateFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[1]);
  let list = [dup, ...BUILT_IN_EXAM_FORM_PRESETS];

  const renameBuiltIn = renameCustomFormTemplate(list, BUILT_IN_EXAM_FORM_PRESETS[1].id, 'Hack Name');
  assert.equal(renameBuiltIn.renamed, false);

  const renameCustom = renameCustomFormTemplate(list, dup.id, 'Mẫu 15 Phút Tổ Toán');
  assert.equal(renameCustom.renamed, true);
  list = renameCustom.templates;
  assert.equal(list.find((t) => t.id === dup.id)?.name, 'Mẫu 15 Phút Tổ Toán');

  const delBuiltIn = deleteCustomFormTemplate(list, BUILT_IN_EXAM_FORM_PRESETS[0].id);
  assert.equal(delBuiltIn.deleted, false);
});

test('P3-04: Deleting default custom template cleanly restores default flag on remaining templates', () => {
  const custom = createCustomFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[0], 'Mẫu Tạm');
  let list = setDefaultFormTemplate([custom, ...BUILT_IN_EXAM_FORM_PRESETS], custom.id);
  assert.equal(list.find((t) => t.id === custom.id)?.isDefault, true);

  const del = deleteCustomFormTemplate(list, custom.id);
  assert.equal(del.deleted, true);
  assert.equal(del.templates.some((t) => t.id === custom.id), false);
  assert.equal(del.templates.some((t) => t.isDefault), true);
});

test('P3-05: Safe Placeholder Engine resolves all 9 tokens in header/footer without touching unknown tokens or questions', () => {
  const exam = buildFourCodeExam();
  const v101 = exam.generatedVersions[0];
  const tpl = createCustomFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[0], 'Mẫu Placeholder');
  tpl.headerSettings.schoolName = 'TRƯỜNG THPT NGUYỄN TRÃI';
  tpl.headerSettings.departmentName = 'SỞ GD&ĐT TP.HCM';
  tpl.headerSettings.subjectGroupName = 'TỔ TOÁN';
  tpl.headerSettings.schoolYear = '2025 - 2026';

  const ctx = buildPlaceholderContext(exam, v101, tpl);
  assert.equal(EXAM_FORM_PLACEHOLDERS.length, 9);
  const resolved = resolveExamFormPlaceholders(
    '{{departmentName}} | {{schoolName}} | {{subjectGroupName}} | {{subject}} {{grade}} | {{duration}} | {{schoolYear}} | Mã {{examCode}} | {{unknownToken}}',
    ctx
  );
  assert.ok(resolved.includes('SỞ GD&ĐT TP.HCM'));
  assert.ok(resolved.includes('TRƯỜNG THPT NGUYỄN TRÃI'));
  assert.ok(resolved.includes('TỔ TOÁN'));
  assert.ok(resolved.includes(`Mã ${v101.code}`));
  assert.ok(resolved.includes('{{unknownToken}}'), 'Unknown tokens must remain untouched');
});

test('P3-06: Auto MCQ Option Layout solver chooses 4-col, 2-col, or 1-col safely based on option length and visuals', () => {
  const tpl = structuredClone(BUILT_IN_EXAM_FORM_PRESETS[2]);
  tpl.bodySettings.optionLayout = 'auto';
  tpl.pageSettings.columns = 1;

  const makeMcq = (texts: string[], withVisual = false): MathQuestion => ({
    ...structuredClone(DEMO_MATH_EXAM.questions[0]),
    type: 'mcq',
    options: texts.map((t, i) => ({
      id: `o-${i}`,
      originalLabel: (['A', 'B', 'C', 'D'] as const)[i],
      content: {
        rawSource: t,
        blocks: [{ id: `blk-${i}`, kind: 'text', content: t }],
      },
      isCorrect: i === 0,
      visualAsset: withVisual && i === 0
        ? {
            id: 'va-opt',
            kind: 'image',
            label: 'opt-img',
            sourceData: TINY_PNG_DATA_URL,
            altText: 'img',
            required: false,
            checksum: 'chk-opt',
          }
        : undefined,
    })),
  });

  assert.equal(resolveAutoOptionLayout(makeMcq(['1', '2', '3', '4']), tpl), '4-col');
  assert.equal(
    resolveAutoOptionLayout(
      makeMcq([
        'Hàm số đồng biến trên (0; +∞)',
        'Hàm số nghịch biến trên (0; +∞)',
        'Hàm số đạt cực đại tại x = 1',
        'Hàm số không có cực trị',
      ]),
      tpl
    ),
    '2-col'
  );
  assert.equal(
    resolveAutoOptionLayout(
      makeMcq([
        'Phương trình có đúng ba nghiệm phân biệt thuộc khoảng từ âm vô cùng đến dương vô cùng khi tham số m lớn hơn 5.',
        'B',
        'C',
        'D',
      ]),
      tpl
    ),
    '1-col'
  );
  assert.equal(resolveAutoOptionLayout(makeMcq(['1', '2', '3', '4'], true), tpl), '1-col');
});

test('P3-07: A4 Pagination & Overflow Estimator computes pages, breaks, usable area, and narrow-margin risk', () => {
  const exam = buildFourCodeExam();
  const tpl = structuredClone(BUILT_IN_EXAM_FORM_PRESETS[0]);
  const normalEst = estimateExamFormPagination(exam.generatedVersions[0].questions, tpl);
  assert.ok(normalEst.estimatedPages >= 1);
  assert.ok(normalEst.usableWidthMm > 150);
  assert.equal(normalEst.hasOverflowRisk, false);

  tpl.pageSettings.marginLeftMm = 8;
  tpl.pageSettings.fontSizePt = 11;
  tpl.pageSettings.lineHeight = 1.15;
  const denseEst = estimateExamFormPagination(exam.generatedVersions[0].questions, tpl);
  assert.equal(denseEst.hasOverflowRisk, true);
  assert.equal(denseEst.densityLevel, 'dense');
});

test('P3-08 & P3-09 & P3-10: School Logo, Word Footer PAGE/NUMPAGES, and Tab-Stop 2-col/4-col MCQ layout export cleanly and round-trip losslessly', async () => {
  const exam = buildFourCodeExam();
  const v101 = exam.generatedVersions[0];
  const tpl = createCustomFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[0], 'Mẫu Logo + 4 Cột + Footer');
  tpl.headerSettings.schoolLogoDataUrl = TINY_PNG_DATA_URL;
  tpl.headerSettings.schoolLogoWidthPx = 48;
  tpl.headerSettings.headerNote = 'Thí sinh kiểm tra đúng mã {{examCode}} của {{schoolName}}.';
  tpl.bodySettings.optionLayout = '4-col';
  tpl.pageSettings.showPageNumbers = true;
  tpl.pageSettings.pageNumberFormat = 'page-of-total';
  tpl.pageSettings.bodyAlignment = 'justify';
  tpl.pageSettings.lineHeight = 1.5;

  const buf = await buildStudentExamDocxBuffer(exam, v101, tpl);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml')!.async('string');
  const footerEntry = zip.file('word/footer1.xml');

  assert.ok(docXml.includes('school-logo'), 'School logo drawing must be embedded');
  assert.ok(docXml.includes(`mã ${v101.code}`), 'Placeholder {{examCode}} must be resolved in headerNote');
  assert.ok(docXml.includes('<w:tab/>'), 'Multi-column MCQ options must use native Word tab stops');
  assert.ok(docXml.includes('w:jc w:val="both"'), 'Justify alignment must map to w:jc both');
  assert.ok(docXml.includes('w:line="360"'), 'Line height 1.5 must map to 360 twips');
  assert.ok(footerEntry, 'word/footer1.xml must exist when showPageNumbers is true');
  const footerXml = await footerEntry.async('string');
  assert.ok(footerXml.includes('PAGE') && footerXml.includes('NUMPAGES'));

  // Verify round-trip parsing stays 100% lossless!
  const bufVerify = await verifyExportedDocxBuffer(buf, v101, exam);
  assert.equal(bufVerify.passed, true, `verifyExportedDocxBuffer failed: ${bufVerify.issues.map((i) => i.message).join('; ')}`);
  const rtVerify = await verifyExportedDocxRoundTrip(buf, v101, exam);
  assert.equal(rtVerify.passed, true, `verifyExportedDocxRoundTrip failed: ${rtVerify.issues.map((i) => i.message).join('; ')}`);
});

test('P3-11: Short-answer box/dotted-line and Essay answer lines render cleanly in student DOCX', async () => {
  const exam = buildFourCodeExam();
  const v101 = exam.generatedVersions[0];
  const tpl = createCustomFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[8], 'Mẫu Tự luận + TLN');
  tpl.bodySettings.shortAnswerBoxStyle = 'box';
  tpl.bodySettings.essayAnswerLines = 3;
  tpl.bodySettings.essayLineStyle = 'lined';

  const buf = await buildStudentExamDocxBuffer(exam, v101, tpl);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');

  const hasShortAnswer = v101.questions.some((q) => q.type === 'short-answer');
  const hasEssay = v101.questions.some((q) => q.type === 'essay');
  if (hasShortAnswer) {
    assert.ok(xml.includes('Đáp số:'));
  }
  if (hasEssay) {
    assert.ok(xml.includes('________'));
  }
});

test('P3-12: All 4 Teacher Answer Key styles (horizontal, multi-column, by-section, per-code) export cleanly', async () => {
  const exam = buildFourCodeExam();
  const styles = ['horizontal', 'multi-column', 'by-section', 'per-code'] as const;

  for (const style of styles) {
    const tpl = createCustomFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[0], `Mẫu Đáp Án ${style}`);
    tpl.answerLayout.answerTableStyle = style;
    tpl.answerLayout.answerColumns = 4;

    const buf = await buildAnswerKeyDocxBuffer(exam, tpl);
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    assert.ok(xml.includes('BẢNG ĐÁP ÁN TỔNG HỢP'), `Missing consolidated header for ${style}`);
    for (const v of exam.generatedVersions) {
      assert.ok(xml.includes(`Mã ${v.code}`), `Missing code ${v.code} in ${style}`);
    }
    if (style === 'horizontal') assert.ok(xml.includes('Bảng đáp án hàng ngang'));
    if (style === 'multi-column') assert.ok(xml.includes('Bảng đáp án 4 cột'));
    if (style === 'by-section') assert.ok(xml.includes('Đáp án phân theo từng phần'));
  }
});

test('P3-13 & P3-14: Multi-Code ZIP export (101–104) applies custom form template to every code + passes verifyExportedZipBundle with zero answer leaks', async () => {
  const exam = buildFourCodeExam();
  const tpl = createCustomFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[5], 'Mẫu Thi Thử 4 Mã');
  tpl.headerSettings.schoolName = 'TRƯỜNG THPT QUỐC HỌC HUẾ';
  tpl.headerSettings.headerNote = 'Mã đề {{examCode}} — {{schoolName}}';
  tpl.bodySettings.optionLayout = '2-col';

  const result = await exportMixedExamZipBundle(exam, tpl);
  assert.equal(result.integrity.verified, true);
  assert.equal(result.integrity.verifiedCodes.length, 4);

  const zip = await JSZip.loadAsync(result.zipBytes);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
    formTemplateId: string;
    formTemplateName: string;
    codes: string[];
  };
  assert.equal(manifest.formTemplateId, tpl.id);
  assert.equal(manifest.formTemplateName, 'Mẫu Thi Thử 4 Mã');
  assert.deepEqual(manifest.codes, ['101', '102', '103', '104']);

  for (const code of ['101', '102', '103', '104']) {
    const studentEntry = zip.file(`de-hoc-sinh/Ma_de_${code}.docx`);
    assert.ok(studentEntry, `Missing Ma_de_${code}.docx`);
    const sZip = await JSZip.loadAsync(await studentEntry.async('uint8array'));
    const sXml = await sZip.file('word/document.xml')!.async('string');
    assert.ok(sXml.includes('TRƯỜNG THPT QUỐC HỌC HUẾ'));
    assert.ok(sXml.includes(`Mã đề ${code} — TRƯỜNG THPT QUỐC HỌC HUẾ`));
    assert.equal(sXml.includes('BẢNG ĐÁP ÁN TỔNG HỢP'), false, `Answer leak in code ${code}`);
  }

  const reverify = await verifyExportedZipBundle(result.zipBytes, exam);
  assert.equal(reverify.verified, true);
});

test('P3-15: runExamFormPostExportAudit verifies OOXML, questions, media, zero leak, mapping, and reports honest NOT_TESTED visual render', async () => {
  const exam = buildFourCodeExam();
  const v101 = exam.generatedVersions[0];
  const tpl = createCustomFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[0], 'Mẫu Audit');
  tpl.headerSettings.schoolLogoDataUrl = TINY_PNG_DATA_URL;

  const buf = await buildStudentExamDocxBuffer(exam, v101, tpl);
  const audit = await runExamFormPostExportAudit(buf, exam, v101, tpl);

  assert.equal(audit.ooxmlValid, true);
  assert.equal(audit.questionCountMatched, true);
  assert.equal(audit.foundQuestions, v101.questions.length);
  assert.equal(audit.hasLogoMedia, true);
  assert.equal(audit.zeroAnswerLeak, true);
  assert.equal(audit.roundTripPassed, true);
  assert.equal(audit.answerMappingIntact, true);
  assert.equal(audit.visualRenderStatus, 'NOT_TESTED');
  assert.equal(audit.errors.length, 0);
});

test('P3-16 & P3-17: Integrity Gate blocks official export on unconfirmed answers or unrenderable media', async () => {
  const unconfirmed = buildFourCodeExam();
  unconfirmed.confirmedOriginalAnswers = false;
  const tpl = BUILT_IN_EXAM_FORM_PRESETS[0];

  const warnings1 = inspectFormExportWarnings(unconfirmed, unconfirmed.generatedVersions[0], tpl);
  assert.ok(warnings1.some((w) => w.id === 'warn-unconfirmed-answers' && w.severity === 'blocking'));
  await assert.rejects(
    () => buildStudentExamDocxBuffer(unconfirmed, unconfirmed.generatedVersions[0], tpl),
    /BLOCKED/
  );

  const brokenMedia = buildFourCodeExam();
  brokenMedia.questions[0].visualAssets = [
    {
      id: 'bad-asset-1',
      kind: 'image',
      label: 'Hình lỗi',
      sourceData: '',
      altText: 'Broken',
      required: true,
      checksum: 'chk-bad',
    },
  ];
  brokenMedia.generatedVersions[0].questions[0].visualAssets = structuredClone(
    brokenMedia.questions[0].visualAssets
  );
  const warnings2 = inspectFormExportWarnings(brokenMedia, brokenMedia.generatedVersions[0], tpl);
  assert.ok(warnings2.some((w) => w.id === 'warn-unrenderable-media' && w.severity === 'blocking'));
});

test('P3-18 & P3-19 & P3-20: Applying multiple templates & switching codes never mutates exam questions/answers and updates OOXML layout accurately', async () => {
  const exam = buildFourCodeExam();
  const snapshotBefore = JSON.stringify({
    questions: exam.questions,
    versions: exam.generatedVersions,
  });

  const tpl = createCustomFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[3], 'Mẫu A4 Khổ Ngang');
  tpl.pageSettings.orientation = 'landscape';
  tpl.pageSettings.marginTopMm = 20;
  tpl.pageSettings.marginLeftMm = 22;
  tpl.pageSettings.fontFamily = 'Arial';
  tpl.pageSettings.fontSizePt = 13;

  const buf101 = await buildStudentExamDocxBuffer(exam, exam.generatedVersions[0], tpl);
  const buf104 = await buildStudentExamDocxBuffer(exam, exam.generatedVersions[3], tpl);

  const xml101 = await (await JSZip.loadAsync(buf101)).file('word/document.xml')!.async('string');
  const xml104 = await (await JSZip.loadAsync(buf104)).file('word/document.xml')!.async('string');

  assert.ok(xml101.includes('w:orient="landscape"'));
  assert.ok(xml101.includes('Arial'));
  assert.ok(xml101.includes('w:sz w:val="26"')); // 13pt = 26 half-pt
  assert.ok(xml101.includes('MÃ ĐỀ: 101'));
  assert.ok(xml104.includes('MÃ ĐỀ: 104'));

  const snapshotAfter = JSON.stringify({
    questions: exam.questions,
    versions: exam.generatedVersions,
  });
  assert.equal(snapshotAfter, snapshotBefore);
});

test('P3-21 & P3-22: Connected Workflow recognizes "Thiết kế mẫu đề" command and enforces strict entity lookup (no silent fallback)', () => {
  const exam = buildFourCodeExam();
  const ctx = createInitialWorkflowContext();
  ctx.generatedExamId = exam.id;

  const cmds = parseUniversalCommand('Thiết kế mẫu đề', {
    ctx,
    resources: [],
    mathExams: [exam],
    gradingSessions: [],
  });
  const formCmd = cmds.find((c) => c.intent === 'print-exam-form');
  assert.ok(formCmd, 'Must parse "Thiết kế mẫu đề" command');
  assert.equal(formCmd.targetApp, 'print-studio');
  assert.equal(formCmd.payload.examId, exam.id);

  // Strict lookup returns missing: true for deleted exam instead of falling back to exam[0]
  const missingLookup = resolveStrictEntityById([exam], 'deleted-exam-id-999');
  assert.equal(missingLookup.missing, true);
  assert.equal(missingLookup.entity, undefined);
});
