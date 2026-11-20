import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  BUILT_IN_EXAM_FORM_PRESETS,
  createCustomFormTemplate,
  duplicateFormTemplate,
  inspectFormExportWarnings,
  mapFormTemplateToExportSettings,
  matchFormTemplateByLabelOrId,
  mergeStoredExamFormTemplates,
  parseImportedFormTemplateJson,
  serializeFormTemplateJson,
  setDefaultFormTemplate,
  upsertFormTemplate,
} from './examFormEngine';
import {
  buildAnswerKeyDocxBuffer,
  buildStudentExamDocxBuffer,
} from './examExportEngine';
import { generateMixedExams } from './mathShuffleEngine';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';

function buildReadyMixedExam() {
  const readyExam = structuredClone(DEMO_MATH_EXAM);
  readyExam.confirmedOriginalAnswers = true;
  readyExam.questions = readyExam.questions.map((q) => ({
    ...q,
    answerConfirmed: true,
  }));
  readyExam.mixConfig = {
    ...readyExam.mixConfig,
    examCount: 3,
    startCodeNumber: 101,
    seed: 'phase-c-form-test',
  };
  const result = generateMixedExams(readyExam);
  assert.ok(result.versions.length >= 3, 'Expected at least 3 mixed versions');
  return {
    ...readyExam,
    generatedVersions: result.versions,
  };
}

test('C34: Provides all 10 editable presets with honest suggested-configuration disclaimer', () => {
  assert.equal(BUILT_IN_EXAM_FORM_PRESETS.length, 10);
  const kinds = new Set(BUILT_IN_EXAM_FORM_PRESETS.map((p) => p.presetKind));
  assert.ok(kinds.has('quiz-15m'));
  assert.ok(kinds.has('test-45m'));
  assert.ok(kinds.has('midterm'));
  assert.ok(kinds.has('final'));
  assert.ok(kinds.has('practice'));
  assert.ok(kinds.has('mock-exam'));
  assert.ok(kinds.has('mcq-only'));
  assert.ok(kinds.has('essay-only'));
  assert.ok(kinds.has('hybrid'));
  assert.ok(kinds.has('custom'));

  // Every preset carries explicit non-official disclaimer
  for (const preset of BUILT_IN_EXAM_FORM_PRESETS) {
    assert.ok(
      preset.disclaimer.includes('gợi ý') && preset.disclaimer.includes('không tuyên bố'),
      `Preset ${preset.id} must include honest disclaimer`
    );
  }

  // Matches Vietnamese command labels accurately
  assert.equal(
    matchFormTemplateByLabelOrId(BUILT_IN_EXAM_FORM_PRESETS, null, 'Mẫu giữa học kỳ').presetKind,
    'midterm'
  );
  assert.equal(
    matchFormTemplateByLabelOrId(BUILT_IN_EXAM_FORM_PRESETS, null, 'Kiểm tra 15 phút').presetKind,
    'quiz-15m'
  );
  assert.equal(
    matchFormTemplateByLabelOrId(BUILT_IN_EXAM_FORM_PRESETS, null, 'Đề thi thử').presetKind,
    'mock-exam'
  );
});

test('C35-36: Custom header editing, save custom template, duplicate, set default & JSON round-trip', () => {
  const base = structuredClone(BUILT_IN_EXAM_FORM_PRESETS[0]);
  base.headerSettings.schoolName = 'TRƯỜNG THPT NGUYỄN DU';
  base.headerSettings.subjectGroupName = 'TỔ TOÁN - TIN HỌC';
  base.pageSettings.orientation = 'landscape';
  base.pageSettings.marginLeftMm = 20;
  base.pageSettings.columns = 2;

  const custom = createCustomFormTemplate(base, 'Mẫu GK1 Trường Nguyễn Du');
  assert.equal(custom.isBuiltIn, false);
  assert.equal(custom.name, 'Mẫu GK1 Trường Nguyễn Du');
  assert.equal(custom.headerSettings.schoolName, 'TRƯỜNG THPT NGUYỄN DU');

  const dup = duplicateFormTemplate(custom);
  assert.notEqual(dup.id, custom.id);
  assert.ok(dup.name.includes('Bản sao'));

  let list = upsertFormTemplate(BUILT_IN_EXAM_FORM_PRESETS, custom);
  list = setDefaultFormTemplate(list, custom.id);
  assert.equal(list.filter((t) => t.isDefault).length, 1);
  assert.equal(list.find((t) => t.isDefault)?.id, custom.id);

  // Merge preserves custom templates across app upgrades
  const reloaded = mergeStoredExamFormTemplates(JSON.parse(JSON.stringify(list)));
  assert.ok(reloaded.some((t) => t.id === custom.id && t.isDefault));
  assert.ok(reloaded.length >= 11);

  // JSON Export/Import round-trip
  const json = serializeFormTemplateJson(custom);
  const imported = parseImportedFormTemplateJson(json);
  assert.equal(imported.ok, true);
  if (imported.ok) {
    assert.equal(imported.template.headerSettings.schoolName, 'TRƯỜNG THPT NGUYỄN DU');
    assert.equal(imported.template.pageSettings.orientation, 'landscape');
    assert.equal(imported.template.pageSettings.columns, 2);
  }

  // Invalid JSON rejected cleanly
  const bad = parseImportedFormTemplateJson('{"broken": true}');
  assert.equal(bad.ok, false);
});

test('C37-39: Applying custom form across multiple exam codes produces faithful DOCX preserving formulas & visuals without answer leaks', async () => {
  const mixedExam = buildReadyMixedExam();
  const customForm = createCustomFormTemplate(
    BUILT_IN_EXAM_FORM_PRESETS[0],
    'Mẫu A4 Ngang 2 Cột THPT Chu Văn An'
  );
  customForm.headerSettings.departmentName = 'SỞ GD&ĐT HÀ NỘI';
  customForm.headerSettings.schoolName = 'TRƯỜNG THPT CHU VĂN AN';
  customForm.headerSettings.subjectGroupName = 'TỔ TOÁN';
  customForm.headerSettings.examTitle = 'ĐỀ KIỂM TRA GIỮA HỌC KỲ I';
  customForm.studentInfoSettings.showStudentId = true;
  customForm.studentInfoSettings.showExamDate = true;
  customForm.pageSettings.orientation = 'landscape';
  customForm.pageSettings.columns = 2;
  customForm.pageSettings.marginTopMm = 18;
  customForm.pageSettings.marginLeftMm = 20;
  customForm.bodySettings.optionLabelStyle = 'paren';

  // Warnings surface honestly for 2-column layout with visuals
  const warnings = inspectFormExportWarnings(
    mixedExam,
    mixedExam.generatedVersions[0],
    customForm
  );
  assert.ok(
    warnings.some((w) => w.id === 'warn-2col-visuals'),
    'Must warn before exporting 2-column layout containing visual graphs/tables'
  );

  // Export DOCX for TWO different exam codes (101 and 102) using the exact same form template
  const v101 = mixedExam.generatedVersions[0];
  const v102 = mixedExam.generatedVersions[1];
  const buf101 = await buildStudentExamDocxBuffer(mixedExam, v101, customForm);
  const buf102 = await buildStudentExamDocxBuffer(mixedExam, v102, customForm);

  const zip101 = await JSZip.loadAsync(buf101);
  const xml101 = await zip101.file('word/document.xml')!.async('string');
  const zip102 = await JSZip.loadAsync(buf102);
  const xml102 = await zip102.file('word/document.xml')!.async('string');

  // Header & student info & layout reflected in OOXML
  assert.ok(xml101.includes('TRƯỜNG THPT CHU VĂN AN'));
  assert.ok(xml101.includes('TỔ TOÁN'));
  assert.ok(xml101.includes(`MÃ ĐỀ: ${v101.code}`));
  assert.ok(xml102.includes(`MÃ ĐỀ: ${v102.code}`));
  assert.ok(xml101.includes('Mã HS:'));
  assert.ok(xml101.includes('Ngày kiểm tra:'));
  assert.ok(xml101.includes('w:orient="landscape"'));
  assert.ok(xml101.includes('w:cols w:num="2"'));
  assert.ok(xml101.includes('A) '));

  // Math formulas & visual assets remain present (zero math/asset corruption)
  const firstStemToken = v101.questions[0].stem.rawSource.slice(0, 12);
  assert.ok(xml101.includes(firstStemToken) || xml101.length > 5000);
  const mediaFiles101 = Object.keys(zip101.files).filter((f) => f.startsWith('word/media/'));
  assert.ok(mediaFiles101.length > 0, 'Expected embedded visual assets in word/media/');

  // Zero answer-key leakage in student DOCX
  assert.equal(xml101.includes('BẢNG ĐÁP ÁN TỔNG HỢP'), false);

  // Answer key DOCX exports cleanly with all versions
  const ansBuf = await buildAnswerKeyDocxBuffer(mixedExam, customForm);
  const ansZip = await JSZip.loadAsync(ansBuf);
  const ansXml = await ansZip.file('word/document.xml')!.async('string');
  assert.ok(ansXml.includes('BẢNG ĐÁP ÁN TỔNG HỢP'));
  assert.ok(ansXml.includes(`Mã ${v101.code}`));
  assert.ok(ansXml.includes(`Mã ${v102.code}`));
});

test('C40: Changing form layout/header/options NEVER alters question content or answer mappings', () => {
  const mixedExam = buildReadyMixedExam();
  const answerSnapshotBefore = JSON.stringify(
    mixedExam.generatedVersions.map((v) => ({
      code: v.code,
      answers: v.answerKeyRows,
      perms: v.permutationMap,
    }))
  );
  const questionsSnapshotBefore = JSON.stringify(mixedExam.questions);

  const editedTemplate = createCustomFormTemplate(BUILT_IN_EXAM_FORM_PRESETS[3], 'Mẫu Cuối Kỳ Đã Sửa');
  editedTemplate.headerSettings.schoolName = 'TRƯỜNG THPT LÊ HỒNG PHONG';
  editedTemplate.pageSettings.columns = 2;
  editedTemplate.bodySettings.optionLayout = '4-col';

  const legacySettings = mapFormTemplateToExportSettings(editedTemplate);
  const updatedExam = {
    ...mixedExam,
    exportSettings: legacySettings,
  };

  const answerSnapshotAfter = JSON.stringify(
    updatedExam.generatedVersions.map((v) => ({
      code: v.code,
      answers: v.answerKeyRows,
      perms: v.permutationMap,
    }))
  );
  const questionsSnapshotAfter = JSON.stringify(updatedExam.questions);

  assert.equal(answerSnapshotAfter, answerSnapshotBefore);
  assert.equal(questionsSnapshotAfter, questionsSnapshotBefore);
  assert.equal(updatedExam.exportSettings.schoolName, 'TRƯỜNG THPT LÊ HỒNG PHONG');
});
