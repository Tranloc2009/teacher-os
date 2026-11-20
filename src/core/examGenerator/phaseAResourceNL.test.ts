import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import type { ResourceItem } from '../../types/lesson';
import { PHASE_A_VAULT_EXAM_RESOURCES } from '../workspaceModules';
import {
  DEMO_GENERATOR_BANK,
  DEMO_GENERATOR_TEMPLATES,
  PHASE2_DEMO_BANK,
  PHASE2_DEMO_TEMPLATES,
  PHASE3_DEMO_BANK,
  PHASE3_DEMO_TEMPLATES,
} from '../../data/demoExamGeneratorData';
import {
  detectResourceIndexStatus,
  extractQuestionsFromResourceItem,
  reconcileResourceBankIndex,
} from './resourceQuestionIndexer';
import {
  findEquivalentReplacements,
  normalizeVietnameseText,
  searchUnifiedQuestionPool,
} from './smartQuestionRetrieval';
import {
  buildExamFromNaturalLanguageCommand,
  parseVietnameseExamCommand,
} from './naturalLanguageExamParser';
import { verifyDynamicGraphBinding } from './level3GraphTemplates';

const ALL_TEMPLATES = [
  ...DEMO_GENERATOR_TEMPLATES,
  ...PHASE2_DEMO_TEMPLATES,
  ...PHASE3_DEMO_TEMPLATES,
];

const ALL_DEMO_BANK = [
  ...DEMO_GENERATOR_BANK,
  ...PHASE2_DEMO_BANK,
  ...PHASE3_DEMO_BANK,
];

// ============================================================
// RESOURCE VAULT QUESTION INTELLIGENCE (Tests 1–6)
// ============================================================

test('Phase A — 01. Extract multi-type questions from Resource Vault exam document & preserve formulas without mutating source', async () => {
  const sourceRes = structuredClone(PHASE_A_VAULT_EXAM_RESOURCES[0]);
  const snapshotBefore = JSON.stringify(sourceRes);

  const outcome = await extractQuestionsFromResourceItem(sourceRes);

  // Original resource is strictly immutable
  assert.equal(JSON.stringify(sourceRes), snapshotBefore);

  // Extracted all 8 questions (4 MCQ + 2 True/False + 2 Short-Answer)
  assert.equal(outcome.items.length, 8);
  assert.equal(outcome.items.filter((i) => i.type === 'mcq').length, 4);
  assert.equal(outcome.items.filter((i) => i.type === 'true-false').length, 2);
  assert.equal(outcome.items.filter((i) => i.type === 'short-answer').length, 2);

  // Preserves LaTeX math formulas & provenance without fabricating PDF page numbers
  const first = outcome.items[0];
  assert.equal(first.sourceKind, 'resource-vault');
  assert.ok(first.sourceProvenance);
  assert.equal(first.sourceProvenance.resourceId, sourceRes.id);
  assert.equal(first.sourceProvenance.fileName, sourceRes.sourceFile?.fileName);
  assert.equal(first.sourceProvenance.folderPath, 'Toán 12/Giữa HK1');
  assert.equal(first.sourceProvenance.sourcePage, undefined); // Never fabricate page numbers for non-PDF!
  assert.equal(first.sourceProvenance.hasMathFormula, true);
  assert.ok(first.question.stem.rawSource.includes('$y = x^3 - 3x + 2$'));
  assert.equal(first.sourceProvenance.answerStatus, 'confirmed');
});

test('Phase A — 02. Extract questions from real XLSX spreadsheet in Resource Vault & never guess missing answers', async () => {
  const zip = new JSZip();
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Câu hỏi</t></is></c>
      <c r="B1" t="inlineStr"><is><t>A</t></is></c>
      <c r="C1" t="inlineStr"><is><t>B</t></is></c>
      <c r="D1" t="inlineStr"><is><t>C</t></is></c>
      <c r="E1" t="inlineStr"><is><t>D</t></is></c>
      <c r="F1" t="inlineStr"><is><t>Đáp án đúng</t></is></c>
      <c r="G1" t="inlineStr"><is><t>Chủ đề</t></is></c>
      <c r="H1" t="inlineStr"><is><t>Mức độ</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Tính đạo hàm của $y = x^3 - 2x$</t></is></c>
      <c r="B2" t="inlineStr"><is><t>$3x^2 - 2$</t></is></c>
      <c r="C2" t="inlineStr"><is><t>$3x^2 + 2$</t></is></c>
      <c r="D2" t="inlineStr"><is><t>$x^2 - 2$</t></is></c>
      <c r="E2" t="inlineStr"><is><t>$3x - 2$</t></is></c>
      <c r="F2" t="inlineStr"><is><t>A</t></is></c>
      <c r="G2" t="inlineStr"><is><t>Đạo hàm</t></is></c>
      <c r="H2" t="inlineStr"><is><t>Nhận biết</t></is></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>Tìm tiệm cận ngang của đồ thị $y = \\frac{4x+1}{2x-1}$</t></is></c>
      <c r="B3" t="inlineStr"><is><t>$y = 2$</t></is></c>
      <c r="C3" t="inlineStr"><is><t>$y = 4$</t></is></c>
      <c r="D3" t="inlineStr"><is><t>$x = 1/2$</t></is></c>
      <c r="E3" t="inlineStr"><is><t>$y = -1$</t></is></c>
      <c r="F3" t="inlineStr"><is><t></t></is></c>
      <c r="G3" t="inlineStr"><is><t>Hàm số và Đồ thị</t></is></c>
      <c r="H3" t="inlineStr"><is><t>Thông hiểu</t></is></c>
    </row>
  </sheetData>
</worksheet>`
  );
  const xlsxBytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
  const bytesSnapshot = Array.from(xlsxBytes);

  const xlsResource: ResourceItem = {
    id: 'res-xlsx-toan12',
    title: 'Ngân hàng câu hỏi Toán 12 (XLSX)',
    type: 'question-template',
    subject: 'Toán học',
    grade: 'Lớp 12',
    tags: ['Toán 12', 'Đạo hàm'],
    content: '',
    answerOrNote: '',
    updatedAt: '2026-11-19T08:00:00.000Z',
    sourceFile: {
      fileName: 'NganHang_Toan12.xlsx',
      relativePath: 'Toán 12/NganHang_Toan12.xlsx',
      extension: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: xlsxBytes.byteLength,
      sha256: 'sha-xlsx-test-1',
      storageKind: 'indexeddb',
      fileRecordId: 'file-rec-xlsx-1',
    },
  };

  const outcome = await extractQuestionsFromResourceItem(xlsResource, { bytes: xlsxBytes });
  assert.deepEqual(Array.from(xlsxBytes), bytesSnapshot);
  assert.equal(outcome.items.length, 2);

  // Q1 has confirmed answer
  assert.equal(outcome.items[0].sourceProvenance?.answerStatus, 'confirmed');
  assert.equal(outcome.items[0].question.answerConfirmed, true);

  // Q2 has NO answer key -> system MUST NOT guess answer!
  assert.equal(outcome.items[1].sourceProvenance?.answerStatus, 'missing');
  assert.equal(outcome.items[1].question.answerConfirmed, false);
  assert.equal(outcome.items[1].question.correctOptionId, undefined);
  assert.equal(outcome.items[1].sourceProvenance?.verificationStatus, 'REVIEW_REQUIRED');
});

test('Phase A — 03. Reconcile Resource Vault index deduplicates safely, protects teacher-edited questions, and detects staleness', async () => {
  const res = structuredClone(PHASE_A_VAULT_EXAM_RESOURCES[0]);
  const firstExtract = await extractQuestionsFromResourceItem(res);
  const firstReconcile = reconcileResourceBankIndex([], firstExtract.items, res.id);

  assert.equal(firstReconcile.addedCount, 8);
  assert.equal(firstReconcile.skippedDuplicateCount, 0);

  // Mark one indexed question as teacher-edited
  const editedBank = structuredClone(firstReconcile.mergedBank);
  editedBank[0].sourceProvenance!.teacherEdited = true;
  editedBank[0].question.stem.rawSource = 'Bản đã được giáo viên chỉnh sửa thủ công';

  // Re-index same resource -> teacher-edited item MUST NOT be overwritten, others updated without duplicates
  const secondReconcile = reconcileResourceBankIndex(editedBank, firstExtract.items, res.id);
  assert.equal(secondReconcile.mergedBank.length, 8);
  assert.equal(secondReconcile.preservedTeacherEditedCount, 1);
  const preserved = secondReconcile.mergedBank.find((b) => b.id === editedBank[0].id);
  assert.equal(preserved?.question.stem.rawSource, 'Bản đã được giáo viên chỉnh sửa thủ công');

  // Detect staleness when resource file is updated
  const statusFresh = detectResourceIndexStatus(res, secondReconcile.mergedBank);
  assert.equal(statusFresh.status, 'up-to-date');
  assert.equal(statusFresh.indexedCount, 8);

  const updatedRes: ResourceItem = {
    ...res,
    updatedAt: '2026-11-20T12:00:00.000Z',
  };
  const statusStale = detectResourceIndexStatus(updatedRes, secondReconcile.mergedBank);
  assert.equal(statusStale.status, 'stale');
});

// ============================================================
// NATURAL LANGUAGE COMMAND PARSER (Tests 7–14)
// ============================================================

test('Phase A — 04. Parse full Vietnamese benchmark command cleanly (subject, grade, counts, difficulty, Resource Vault scope, codes, form)', () => {
  const prompt =
    'Tạo cho tôi một đề kiểm tra Toán 12 giữa học kỳ 1, thời gian 45 phút, gồm 12 câu trắc nghiệm, 4 câu đúng sai và 6 câu trả lời ngắn. Lấy câu hỏi từ thư mục Toán 12 trong Resource Vault. Ưu tiên chương Hàm số và Đạo hàm. Mức độ 30% nhận biết, 40% thông hiểu, 30% vận dụng. Những câu toán phù hợp hãy đổi số để tạo câu mới, tính lại đáp án. Tạo 4 mã đề 101, 102, 103, 104 và xuất theo mẫu đề kiểm tra của trường.';

  const parsed = parseVietnameseExamCommand(prompt, PHASE_A_VAULT_EXAM_RESOURCES);

  assert.equal(parsed.intent, 'generate-exam');
  assert.equal(parsed.subjectId, 'toan');
  assert.equal(parsed.subjectName, 'Toán học');
  assert.equal(parsed.grade, 'Lớp 12');
  assert.equal(parsed.examType, 'Giữa học kỳ I');
  assert.equal(parsed.durationMinutes, 45);
  assert.equal(parsed.requestedTotalCount, 22);
  assert.equal(parsed.typeCounts.mcq, 12);
  assert.equal(parsed.typeCounts['true-false'], 4);
  assert.equal(parsed.typeCounts['short-answer'], 6);
  assert.equal(parsed.difficultyDistribution.nhanBietPercent, 30);
  assert.equal(parsed.difficultyDistribution.thongHieuPercent, 40);
  assert.equal(parsed.difficultyDistribution.vanDungPercent, 30);
  assert.equal(parsed.resourceVaultScope.requested, true);
  assert.ok(parsed.resourceVaultScope.matchedResourceIds.length >= 2);
  assert.equal(parsed.variationMode, 'hybrid');
  assert.equal(parsed.examVersionCount, 4);
  assert.deepEqual(parsed.examVersionCodes, ['101', '102', '103', '104']);
  assert.ok(parsed.examFormLabel?.includes('đề kiểm tra của trường'));
  assert.ok(
    parsed.chaptersOrTopics.some((t) => normalizeVietnameseText(t).includes('ham so'))
  );
  assert.ok(
    parsed.chaptersOrTopics.some((t) => normalizeVietnameseText(t).includes('dao ham'))
  );
  assert.equal(parsed.conflicts.length, 0);
  assert.equal(parsed.missingFields.length, 0);
});

test('Phase A — 05. Detect contradictory commands and never silently guess missing fields', () => {
  // Contradiction: total count (10) != 8 + 5 (13), difficulty sum = 110% != 100%
  const conflicting = parseVietnameseExamCommand(
    'Tạo đề Toán 12 thời gian 45 phút gồm 10 câu: 8 câu trắc nghiệm và 5 câu trả lời ngắn. Mức độ 50% nhận biết, 60% thông hiểu.'
  );
  assert.ok(conflicting.conflicts.length >= 2);
  assert.throws(() =>
    buildExamFromNaturalLanguageCommand({
      command: conflicting,
      unifiedBank: ALL_DEMO_BANK,
      templates: ALL_TEMPLATES,
    })
  );

  // Underspecified command: MUST report missing fields instead of guessing!
  const vague = parseVietnameseExamCommand('Tạo đề kiểm tra');
  assert.equal(vague.subjectId, undefined);
  assert.equal(vague.grade, undefined);
  assert.equal(vague.durationMinutes, undefined);
  assert.equal(vague.requestedTotalCount, undefined);
  assert.ok(vague.missingFields.some((m) => m.field === 'subjectId'));
  assert.ok(vague.missingFields.some((m) => m.field === 'grade'));
  assert.ok(vague.missingFields.some((m) => m.field === 'requestedTotalCount'));
});

// ============================================================
// SMART RETRIEVAL & EXAM GENERATION (Tests 15–21)
// ============================================================

test('Phase A — 06. Smart Retrieval Engine supports accented & unaccented Vietnamese, separates content relevance from answer confidence, and provides matrix-equivalent replacements', async () => {
  const r1 = await extractQuestionsFromResourceItem(PHASE_A_VAULT_EXAM_RESOURCES[0]);
  const r2 = await extractQuestionsFromResourceItem(PHASE_A_VAULT_EXAM_RESOURCES[1]);
  const combinedPool = [...r1.items, ...r2.items, ...ALL_DEMO_BANK];

  // Unaccented query "tiem can dung ham phan thuc" must retrieve Vietnamese accented asymptote questions
  const res = searchUnifiedQuestionPool(combinedPool, ALL_TEMPLATES, {
    queryText: 'tiem can dung ham phan thuc',
    subjectId: 'toan',
    grade: 'Lớp 12',
  });

  assert.ok(res.candidates.length > 0);
  const top = res.candidates[0];
  assert.ok(top.contentRelevancePercent >= 40 && top.contentRelevancePercent <= 100);
  assert.ok(top.matchReasons.length > 0);
  assert.ok(top.answerConfidenceLabel.length > 0);

  // Equivalent matrix replacements exclude already selected IDs and match subject & question type
  const replacements = findEquivalentReplacements(
    top.record,
    combinedPool,
    ALL_TEMPLATES,
    [top.record.id],
    4
  );
  assert.ok(replacements.length > 0);
  for (const alt of replacements) {
    assert.notEqual(alt.record.id, top.record.id);
    assert.equal(alt.record.type, top.record.type);
    assert.equal(alt.record.subjectId, top.record.subjectId);
  }
});

test('Phase A — 07. Full Phase A E2E pipeline: Resource Vault -> Vietnamese NL Command -> Retrieval + Verified Variants (incl. Level 3 Graphs) -> Truthful Shortfall & No Fake Questions', async () => {
  const r1 = await extractQuestionsFromResourceItem(PHASE_A_VAULT_EXAM_RESOURCES[0]);
  const r2 = await extractQuestionsFromResourceItem(PHASE_A_VAULT_EXAM_RESOURCES[1]);
  const unifiedPool = [...r1.items, ...r2.items, ...ALL_DEMO_BANK];

  const cmd = parseVietnameseExamCommand(
    'Tạo đề kiểm tra Toán 12 giữa học kỳ 1, thời gian 45 phút, gồm 4 câu trắc nghiệm, 2 câu đúng sai và 2 câu trả lời ngắn. Lấy câu hỏi từ thư mục Toán 12 trong Resource Vault. Ưu tiên chương Hàm số và Đạo hàm. Những câu toán phù hợp hãy đổi số để tạo câu mới, tính lại đáp án.',
    PHASE_A_VAULT_EXAM_RESOURCES
  );

  const built = buildExamFromNaturalLanguageCommand({
    command: cmd,
    unifiedBank: unifiedPool,
    templates: ALL_TEMPLATES,
    seed: 'PHASE-A-E2E-SEED',
    relaxDifficultyFilter: true,
  });

  assert.equal(built.draft.items.length, 8);
  assert.equal(built.draft.items.filter((i) => i.question.type === 'mcq').length, 4);
  assert.equal(built.draft.items.filter((i) => i.question.type === 'true-false').length, 2);
  assert.equal(built.draft.items.filter((i) => i.question.type === 'short-answer').length, 2);

  // Zero duplicate question stems in assembled exam
  const stems = new Set(built.draft.items.map((i) => i.question.stem.rawSource.trim()));
  assert.equal(stems.size, built.draft.items.length);

  // Resource Vault provenance preserved on vault-sourced items
  const vaultItems = built.draft.items.filter((i) => Boolean(i.sourceProvenance));
  assert.ok(vaultItems.length >= 4);
  assert.ok(built.sourceResourceIdsUsed.length >= 1);

  // Verify dynamic graph bindings on any generated Level 3 graph variant
  for (const item of built.draft.items) {
    const check = verifyDynamicGraphBinding({
      question: item.question,
      functionAnalysis: item.functionAnalysis,
      variationTable: item.variationTable,
      graphFingerprint: item.graphFingerprint,
    });
    assert.equal(check.valid, true, check.reason);
  }

  // Now verify truthful shortfall when requesting 40 True/False questions (only 3 exist)
  const hugeCmd = parseVietnameseExamCommand(
    'Tạo đề Toán 12 thời gian 45 phút gồm 40 câu đúng sai từ Resource Vault.',
    PHASE_A_VAULT_EXAM_RESOURCES
  );
  const shortfallRes = buildExamFromNaturalLanguageCommand({
    command: hugeCmd,
    unifiedBank: unifiedPool,
    templates: ALL_TEMPLATES,
    seed: 'PHASE-A-SHORTFALL-SEED',
  });
  assert.ok(shortfallRes.draft.items.length < 40); // NEVER invents fake questions!
  assert.ok(shortfallRes.shortfallAdvice.shortfalls.length > 0);
  assert.ok(shortfallRes.shortfallAdvice.suggestedRelaxations.length > 0);
});

test('Phase A — 08. BLOCKED questions (static image / OMML) are never mutated by Verified Variant Engine in VERIFIED VARIANTS mode', () => {
  const blockedQuestion = structuredClone(ALL_DEMO_BANK[0]);
  blockedQuestion.id = 'bank-blocked-omml';
  blockedQuestion.code = 'BLK-01';
  blockedQuestion.subjectId = 'toan';
  blockedQuestion.grade = 'Lớp 12';
  blockedQuestion.topic = 'Hàm số và Đồ thị';
  blockedQuestion.hasBinaryFormulaOrOmml = true;
  blockedQuestion.hasNonUpdatableVisualAsset = true;
  blockedQuestion.templateId = undefined;

  const cmd = parseVietnameseExamCommand(
    'Tạo đề Toán 12 thời gian 45 phút gồm 2 câu trắc nghiệm chương Hàm số và Đồ thị, chỉ dùng biến thể kiểm chứng.'
  );
  assert.equal(cmd.variationMode, 'verified-variants');

  const res = buildExamFromNaturalLanguageCommand({
    command: cmd,
    unifiedBank: [blockedQuestion],
    templates: [], // No verified templates -> blocked item MUST NOT be mutated or used as variant!
    seed: 'BLOCKED-GUARD-SEED',
  });

  assert.equal(res.draft.items.length, 0);
  assert.ok(res.shortfallAdvice.totalBlockedFromVariants >= 1);
  assert.ok(res.shortfallAdvice.shortfalls.length > 0);
});
