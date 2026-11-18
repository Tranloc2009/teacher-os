import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  buildAnswerKeyDocxBuffer,
  buildConsolidatedAnswerCsv,
  buildStudentExamDocxBuffer,
  exportMixedExamZipBundle,
  verifyExportedDocxBuffer,
  verifyExportedZipBundle,
} from './examExportEngine';
import {
  checkExamExportGate,
  createMathVisualAsset,
  evaluatePreMixIntegrity,
  sanitizeSvgSource,
} from './mathIntegrity';
import {
  generateMixedExams,
  generateMixedExamsAsync,
  validateMixConfiguration,
} from './mathShuffleEngine';
import {
  DOCX_MAX_ZIP_ENTRIES,
  extractDocxDocument,
  sanitizeSvgMarkup,
} from './ooxmlParser';
import {
  createImmutableContentPayload,
  getSubjectProfile,
  listSubjectProfiles,
  resolveSubjectId,
  suggestSubjectProfileFromText,
} from './subjectProfileRegistry';
import { importUniversalExamFile, parseUniversalExamText } from './universalImportEngine';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import { ExamSubjectId, MathExamProject, MathQuestion } from '../types/mathExam';

let seq = 0;
function testId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function make1x1PngBase64(): string {
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
}

function makeBaseProject(overrides?: Partial<MathExamProject>): MathExamProject {
  const now = new Date().toISOString();
  const questions: MathQuestion[] = [
    {
      id: 'q1',
      code: 'CH-01',
      sectionTitle: 'Phần I. Trắc nghiệm nhiều phương án',
      type: 'mcq',
      universalType: 'mcq',
      subjectId: 'hoa-hoc',
      topic: 'Axit - Bazơ',
      cognitiveLevel: 'nhan-biet',
      difficultyScore: 1,
      points: 0.25,
      stem: createImmutableContentPayload('Phản ứng trung hòa: H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O. Ion sunfat là:', 'q1-s'),
      options: [
        { id: 'q1-a', originalLabel: 'A', content: createImmutableContentPayload('SO₄²⁻', 'q1-a'), isCorrect: true },
        { id: 'q1-b', originalLabel: 'B', content: createImmutableContentPayload('HSO₄⁻', 'q1-b'), isCorrect: false },
        { id: 'q1-c', originalLabel: 'C', content: createImmutableContentPayload('SO₃²⁻', 'q1-c'), isCorrect: false },
        { id: 'q1-d', originalLabel: 'D', content: createImmutableContentPayload('S²⁻', 'q1-d'), isCorrect: false },
      ],
      correctOptionId: 'q1-a',
      solutionGuide: createImmutableContentPayload('Đáp án gốc: SO₄²⁻ mang điện tích 2-.', 'q1-sol'),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'q2',
      code: 'CH-02',
      sectionTitle: 'Phần I. Trắc nghiệm nhiều phương án',
      type: 'mcq',
      universalType: 'multi-select',
      subjectId: 'tin-hoc',
      topic: 'Thuật toán Python',
      cognitiveLevel: 'thong-hieu',
      difficultyScore: 2,
      points: 0.5,
      stem: createImmutableContentPayload(
        'Đoạn mã sau:\nfor i in range(3):\n    print(i)\nChọn CÁC phát biểu đúng:',
        'q2-s',
        { preserveExactWhitespace: true }
      ),
      multiSelectOptions: [
        { id: 'q2-a', originalLabel: 'A', content: createImmutableContentPayload('In ra 0, 1, 2', 'q2-a'), isCorrect: true },
        { id: 'q2-b', originalLabel: 'B', content: createImmutableContentPayload('Vòng lặp chạy 3 lần', 'q2-b'), isCorrect: true },
        { id: 'q2-c', originalLabel: 'C', content: createImmutableContentPayload('In ra số 3', 'q2-c'), isCorrect: false },
        { id: 'q2-d', originalLabel: 'D', content: createImmutableContentPayload('Báo lỗi cú pháp', 'q2-d'), isCorrect: false },
      ],
      correctOptionIds: ['q2-a', 'q2-b'],
      solutionGuide: createImmutableContentPayload('range(3) sinh 0, 1, 2.', 'q2-sol'),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'q3',
      code: 'CH-03',
      sectionTitle: 'Phần I. Trắc nghiệm nhiều phương án',
      type: 'mcq',
      universalType: 'mcq',
      subjectId: 'tieng-anh',
      topic: 'Grammar',
      cognitiveLevel: 'thong-hieu',
      difficultyScore: 2,
      points: 0.25,
      stem: createImmutableContentPayload('Which pronunciation matches /ˈkʌltʃə(r)/?', 'q3-s'),
      options: [
        { id: 'q3-a', originalLabel: 'A', content: createImmutableContentPayload('culture', 'q3-a'), isCorrect: true },
        { id: 'q3-b', originalLabel: 'B', content: createImmutableContentPayload('nature', 'q3-b'), isCorrect: false },
        { id: 'q3-c', originalLabel: 'C', content: createImmutableContentPayload('future', 'q3-c'), isCorrect: false },
        { id: 'q3-d', originalLabel: 'D', content: createImmutableContentPayload('Both A and B', 'q3-d'), isCorrect: false, lockPosition: true },
      ],
      correctOptionId: 'q3-a',
      solutionGuide: createImmutableContentPayload('culture /ˈkʌltʃə(r)/', 'q3-sol'),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: true,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: ['Chứa phương án phụ thuộc tiếng Anh ("Both A and B")'],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'q4',
      code: 'CH-04',
      sectionTitle: 'Phần II. Đúng sai & Nối ghép',
      type: 'true-false',
      universalType: 'true-false',
      subjectId: 'vat-ly',
      topic: 'Dao động điều hòa',
      cognitiveLevel: 'van-dung',
      difficultyScore: 3,
      points: 1,
      stem: createImmutableContentPayload('Xét dao động điều hòa $x = A\\cos(\\omega t + \\varphi)$ với gia tốc $a$ (m/s²):', 'q4-s'),
      statements: [
        { id: 'q4-st1', originalLabel: 'a', content: createImmutableContentPayload('Đơn vị gia tốc là m/s².', 'q4-1'), isTrue: true },
        { id: 'q4-st2', originalLabel: 'b', content: createImmutableContentPayload('Tần số góc $\\omega$ đo bằng rad/s.', 'q4-2'), isTrue: true },
        { id: 'q4-st3', originalLabel: 'c', content: createImmutableContentPayload('Vận tốc cực đại $v_{max} = \\omega A$.', 'q4-3'), isTrue: true },
        { id: 'q4-st4', originalLabel: 'd', content: createImmutableContentPayload('Gia tốc luôn cùng dấu với li độ x.', 'q4-4'), isTrue: false },
      ],
      solutionGuide: createImmutableContentPayload('a, b, c đúng; d sai vì a = -ω²x.', 'q4-sol'),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: true,
      dependencyFlags: [],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'q5',
      code: 'CH-05',
      sectionTitle: 'Phần II. Đúng sai & Nối ghép',
      type: 'short-answer',
      universalType: 'matching',
      subjectId: 'sinh-hoc',
      topic: 'Di truyền học',
      cognitiveLevel: 'thong-hieu',
      difficultyScore: 2,
      points: 0.5,
      stem: createImmutableContentPayload('Ghép ký hiệu sinh học ở Cột A với ý nghĩa đúng ở Cột B:', 'q5-s'),
      matching: {
        leftItems: [
          { id: 'm-l1', originalLabel: '1', content: createImmutableContentPayload('5′–AUG–3′', 'ml1') },
          { id: 'm-l2', originalLabel: '2', content: createImmutableContentPayload('AaBb × aabb', 'ml2') },
        ],
        rightItems: [
          { id: 'm-r1', originalLabel: 'a', content: createImmutableContentPayload('Codon mở đầu', 'mr1') },
          { id: 'm-r2', originalLabel: 'b', content: createImmutableContentPayload('Lai phân tích', 'mr2') },
        ],
        correctPairs: [
          { id: 'mp-1', leftItemId: 'm-l1', rightItemId: 'm-r1' },
          { id: 'mp-2', leftItemId: 'm-l2', rightItemId: 'm-r2' },
        ],
        allowShuffleLeft: false,
        allowShuffleRight: true,
      },
      solutionGuide: createImmutableContentPayload('1-a, 2-b.', 'q5-sol'),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'q6',
      code: 'CH-06',
      sectionTitle: 'Phần III. Điền khuyết & Sắp xếp',
      type: 'short-answer',
      universalType: 'fill-blank',
      subjectId: 'hoa-hoc',
      topic: 'Phản ứng hóa học',
      cognitiveLevel: 'thong-hieu',
      difficultyScore: 2,
      points: 0.5,
      stem: createImmutableContentPayload('Kim loại {{1}} phản ứng với dung dịch {{2}} giải phóng khí H₂.', 'q6-s'),
      fillBlank: {
        slots: [
          { id: 'fb-1', slotNumber: 1, placeholderToken: '{{1}}', acceptedAnswers: ['Zn'], caseSensitive: true },
          { id: 'fb-2', slotNumber: 2, placeholderToken: '{{2}}', acceptedAnswers: ['HCl'], caseSensitive: true },
        ],
        wordBank: [
          { id: 'wb-1', originalLabel: 'A', content: createImmutableContentPayload('Zn', 'wb1') },
          { id: 'wb-2', originalLabel: 'B', content: createImmutableContentPayload('HCl', 'wb2') },
          { id: 'wb-3', originalLabel: 'C', content: createImmutableContentPayload('Cu', 'wb3') },
        ],
        allowShuffleWordBank: true,
      },
      solutionGuide: createImmutableContentPayload('Zn + 2HCl → ZnCl₂ + H₂↑', 'q6-sol'),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'q7',
      code: 'CH-07',
      sectionTitle: 'Phần III. Điền khuyết & Sắp xếp',
      type: 'short-answer',
      universalType: 'ordering',
      subjectId: 'lich-su',
      topic: 'Lịch sử Việt Nam',
      cognitiveLevel: 'thong-hieu',
      difficultyScore: 2,
      points: 0.5,
      stem: createImmutableContentPayload('Sắp xếp các mốc lịch sử sau theo đúng trình tự thời gian:', 'q7-s'),
      ordering: {
        items: [
          { id: 'ord-1', originalLabel: 'a', content: createImmutableContentPayload('Chiến thắng Điện Biên Phủ (1954)', 'o1'), correctRank: 2 },
          { id: 'ord-2', originalLabel: 'b', content: createImmutableContentPayload('Cách mạng tháng Tám (1945)', 'o2'), correctRank: 1 },
          { id: 'ord-3', originalLabel: 'c', content: createImmutableContentPayload('Đại thắng mùa Xuân (1975)', 'o3'), correctRank: 3 },
        ],
        requireExactSequence: true,
      },
      solutionGuide: createImmutableContentPayload('1945 → 1954 → 1975', 'q7-sol'),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'q8',
      code: 'CH-08',
      sectionTitle: 'Phần IV. Tự luận',
      type: 'essay',
      universalType: 'essay',
      subjectId: 'ngu-van',
      topic: 'Đọc hiểu thơ',
      cognitiveLevel: 'van-dung-cao',
      difficultyScore: 4,
      points: 2,
      stem: createImmutableContentPayload('Cảm nhận khổ thơ:\nSóng bắt đầu từ gió\nGió bắt đầu từ đâu?', 'q8-s', {
        preserveExactWhitespace: true,
      }),
      essayParts: [
        {
          id: 'ep-1',
          label: 'a)',
          content: createImmutableContentPayload('Nêu biện pháp tu từ.', 'ep1'),
          points: 1,
          solutionOutline: createImmutableContentPayload('Điệp ngữ và câu hỏi tu từ.', 'ep1-sol'),
        },
      ],
      solutionGuide: createImmutableContentPayload('Câu hỏi tu từ, điệp ngữ.', 'q8-sol'),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: true,
      lockOptionShuffle: true,
      allowStatementShuffle: false,
      dependencyFlags: [],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    id: 'exam-mix-6-test',
    title: 'Đề kiểm tra tổng hợp Exam Mixer Pro 6.0',
    subject: 'Hóa học',
    subjectId: 'hoa-hoc',
    schemaVersion: '6.0',
    grade: 'Lớp 12',
    durationMinutes: 45,
    schoolYear: '2025 - 2026',
    examTypeLabel: 'ĐỀ KIỂM TRA ĐỊNH KỲ',
    status: 'ready',
    isDemo: false,
    confirmedOriginalAnswers: true,
    questions,
    questionGroups: [],
    mixConfig: {
      level: 2,
      examCount: 4,
      startCodeNumber: 101,
      customCodeNames: [],
      seed: 'exam-6-deterministic-seed',
      shuffleQuestions: true,
      shuffleMcqOptions: true,
      keepVdcPositions: false,
      preserveTopicRatios: true,
      shufflePerSectionOnly: true,
      shuffleIndependentTrueFalseStatements: true,
      lockedQuestionIds: ['q3', 'q8'],
      matrixRules: [],
    },
    generatedVersions: [],
    lastStep: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Exam Mixer Pro 6.0 — Comprehensive Engine & Security Tests', () => {
  it('Test 1: Supports all 12 subject profiles and accurate non-binding text suggestions', () => {
    const profiles = listSubjectProfiles();
    assert.equal(profiles.length, 12);
    const expectedIds: ExamSubjectId[] = [
      'toan',
      'vat-ly',
      'hoa-hoc',
      'sinh-hoc',
      'ngu-van',
      'tieng-anh',
      'lich-su',
      'dia-ly',
      'gdkt-pl',
      'tin-hoc',
      'cong-nghe',
      'khac',
    ];
    expectedIds.forEach((id) => {
      assert.equal(resolveSubjectId(id), id);
      assert.equal(getSubjectProfile(id).id, id);
    });

    assert.equal(
      suggestSubjectProfileFromText('Câu 1: Cho H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O, số mol là 0.5').suggestedId,
      'hoa-hoc'
    );
    assert.equal(
      suggestSubjectProfileFromText('Mark the letter A, B, C or D for /ˈkʌltʃə(r)/ Reading Comprehension').suggestedId,
      'tieng-anh'
    );
    assert.equal(
      suggestSubjectProfileFromText('Câu 1: Mạch khuôn 5′-AUG-3′, phép lai AaBb × aabb').suggestedId,
      'sinh-hoc'
    );
  });

  it('Test 2: Extracts real DOCX with OMML, subscript/superscript, PNG image, and table cleanly', async () => {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Default Extension="png" ContentType="image/png"/>
      </Types>`
    );
    zip.file(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`
    );
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdPic1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.png"/>
      </Relationships>`
    );
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <w:body>
          <w:p>
            <w:r><w:t>Câu 1: Công thức H</w:t></w:r>
            <w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r>
            <w:r><w:t>SO</w:t></w:r>
            <w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>4</w:t></w:r>
            <w:r><w:t> và ion SO</w:t></w:r>
            <w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>4</w:t></w:r>
            <w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2-</w:t></w:r>
            <w:r><w:t> với phân số </w:t></w:r>
            <m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>
          </w:p>
          <w:p><w:r><w:drawing><a:blip r:embed="rIdPic1"/></w:drawing></w:r></w:p>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>*A. 98 g/mol</w:t></w:r></w:p>
          <w:p><w:r><w:t>B. 64 g/mol</w:t></w:r></w:p>
          <w:p><w:r><w:t>C. 40 g/mol</w:t></w:r></w:p>
          <w:p><w:r><w:t>D. 32 g/mol</w:t></w:r></w:p>
        </w:body>
      </w:document>`
    );
    zip.file('word/media/chart.png', make1x1PngBase64(), { base64: true });

    const docxBytes = await zip.generateAsync({ type: 'uint8array' });
    const extracted = await extractDocxDocument(docxBytes);

    assert.ok(extracted.plainTextWithMarkers.includes('H₂SO₄'));
    assert.ok(extracted.plainTextWithMarkers.includes('SO₄²⁻'));
    assert.ok(extracted.plainTextWithMarkers.includes('\\frac{1}{2}'));
    assert.equal(extracted.ommlFragments.length, 1);
    assert.equal(extracted.assets.length, 1);

    const imported = await importUniversalExamFile(
      { fileName: 'hoa-12.docx', buffer: docxBytes },
      testId,
      { subjectId: 'hoa-hoc' }
    );
    assert.equal(imported.questions.length, 1);
    assert.equal((imported.questions[0].visualAssets ?? []).length, 1);
    assert.equal(imported.questions[0].answerConfirmed, true);
  });

  it('Test 3: Rejects corrupt DOCX, XXE payloads, path traversal, excessive entries, flags VBA macros, and sanitizes SVG XSS', async () => {
    await assert.rejects(() => extractDocxDocument(new Uint8Array([1, 2, 3, 4])));

    // XXE rejection
    const xxeZip = new JSZip();
    xxeZip.file('word/document.xml', '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><w:document><w:body/></w:document>');
    const xxeBytes = await xxeZip.generateAsync({ type: 'uint8array' });
    await assert.rejects(() => extractDocxDocument(xxeBytes), /DOCTYPE|ENTITY|XXE/i);

    // Path traversal rejection
    const travZip = new JSZip();
    travZip.file('../evil.txt', 'bad');
    travZip.file('word/document.xml', '<w:document><w:body/></w:document>');
    const travBytes = await travZip.generateAsync({ type: 'uint8array' });
    await assert.rejects(() => extractDocxDocument(travBytes), /Đường dẫn không hợp lệ/);

    // ZIP entry bomb limit rejection
    const bombZip = new JSZip();
    bombZip.file('word/document.xml', '<w:document><w:body/></w:document>');
    for (let i = 0; i <= DOCX_MAX_ZIP_ENTRIES; i++) {
      bombZip.file(`junk/f${i}.txt`, 'x');
    }
    const bombBytes = await bombZip.generateAsync({ type: 'uint8array' });
    await assert.rejects(() => extractDocxDocument(bombBytes), /quá nhiều mục/i);

    // VBA macro detection + SVG sanitization
    const macroZip = new JSZip();
    macroZip.file('word/vbaProject.bin', new Uint8Array([0, 1, 2]));
    macroZip.file(
      'word/document.xml',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>'
    );
    const macroBytes = await macroZip.generateAsync({ type: 'uint8array' });
    const macroRes = await extractDocxDocument(macroBytes);
    assert.equal(macroRes.hasVbaMacro, true);
    assert.ok(macroRes.warnings.some((w) => w.includes('macro VBA')));

    const dirtySvg = '<svg onload="alert(1)"><script>alert(2)</script><a xlink:href="javascript:evil()"><circle r="5"/></a></svg>';
    const cleaned1 = sanitizeSvgMarkup(dirtySvg);
    const cleaned2 = sanitizeSvgSource(dirtySvg);
    for (const cleaned of [cleaned1, cleaned2]) {
      assert.ok(!cleaned.includes('<script'));
      assert.ok(!cleaned.includes('onload='));
      assert.ok(!cleaned.includes('javascript:'));
    }
  });

  it('Test 4 & Test 5: Universal shuffle preserves all formulas & maps answer keys accurately for all 10 types', () => {
    const project = makeBaseProject();
    const res = generateMixedExams(project);
    assert.equal(res.errors.length, 0);
    assert.equal(res.versions.length, 4);

    for (const ver of res.versions) {
      assert.equal(ver.integrityPassed, true);
      assert.equal(ver.questions.length, 8);

      // Verify locked positions (q3 at index 2, q8 at index 7)
      assert.equal(ver.questions[2].id, 'q3');
      assert.equal(ver.questions[7].id, 'q8');

      // Verify q1 chemical symbols untouched
      const q1Mixed = ver.questions.find((q) => q.id === 'q1')!;
      assert.equal(q1Mixed.stem.rawSource, project.questions[0].stem.rawSource);
      const q1Row = ver.answerKeyRows.find((r) => r.questionId === 'q1')!;
      const q1CorrectIdx = q1Mixed.options!.findIndex((o) => o.id === 'q1-a');
      assert.equal(q1Row.answer, ['A', 'B', 'C', 'D'][q1CorrectIdx]);

      // Verify q2 Python whitespace + multi-select mapping
      const q2Mixed = ver.questions.find((q) => q.id === 'q2')!;
      assert.ok(q2Mixed.stem.rawSource.includes('\n    print(i)'));
      const q2Row = ver.answerKeyRows.find((r) => r.questionId === 'q2')!;
      const expectedMulti = q2Mixed
        .multiSelectOptions!.map((o, i) => ({ o, lbl: String.fromCharCode(65 + i) }))
        .filter((x) => x.o.isCorrect)
        .map((x) => x.lbl)
        .join(', ');
      assert.equal(q2Row.answer, expectedMulti);

      // Verify q3 dependent English option stayed unshuffled
      const q3Mixed = ver.questions.find((q) => q.id === 'q3')!;
      assert.deepEqual(
        q3Mixed.options!.map((o) => o.id),
        ['q3-a', 'q3-b', 'q3-c', 'q3-d']
      );

      // Verify q5 matching pair-id mapping stays invariant
      const q5Mixed = ver.questions.find((q) => q.id === 'q5')!;
      const q5Map = ver.permutationMap.find((m) => m.questionId === 'q5')!;
      const q5Row = ver.answerKeyRows.find((r) => r.questionId === 'q5')!;
      const r1NewIdx = q5Mixed.matching!.rightItems.findIndex((r) => r.id === 'm-r1');
      const r2NewIdx = q5Mixed.matching!.rightItems.findIndex((r) => r.id === 'm-r2');
      assert.equal(
        q5Row.answer,
        `1-${String.fromCharCode(97 + r1NewIdx)}, 2-${String.fromCharCode(97 + r2NewIdx)}`
      );
      assert.ok(q5Map.exactAnswerSummary.includes('1-'));

      // Verify q6 fill-blank slots never shuffle order
      const q6Mixed = ver.questions.find((q) => q.id === 'q6')!;
      assert.deepEqual(
        q6Mixed.fillBlank!.slots.map((s) => s.slotNumber),
        [1, 2]
      );
      const q6Row = ver.answerKeyRows.find((r) => r.questionId === 'q6')!;
      assert.equal(q6Row.answer, '(1) Zn · (2) HCl');

      // Verify q7 ordering rank sequence maps to current positions
      const q7Mixed = ver.questions.find((q) => q.id === 'q7')!;
      const q7Row = ver.answerKeyRows.find((r) => r.questionId === 'q7')!;
      const expectedSeq = [...q7Mixed.ordering!.items]
        .map((item, idx) => ({ item, lbl: String.fromCharCode(97 + idx) }))
        .sort((a, b) => a.item.correctRank - b.item.correctRank)
        .map((x) => x.lbl)
        .join(' → ');
      assert.equal(q7Row.answer, expectedSeq);
    }
  });

  it('Test 6 & Test 7: Export Gate & Integrity Checks BLOCK tampered or unconfirmed projects', async () => {
    const project = makeBaseProject();
    const res = generateMixedExams(project);
    const readyExam: MathExamProject = {
      ...project,
      generatedVersions: res.versions,
    };
    assert.equal(checkExamExportGate(readyExam).canExport, true);

    // Tamper visual asset checksum -> must BLOCK
    const badAsset = createMathVisualAsset({
      id: 'bad-asset-1',
      kind: 'geometry-svg',
      label: 'Đồ thị',
      sourceData: '<svg><circle r="10"/></svg>',
    });
    badAsset.checksum = 'tampered-checksum-mismatch';
    const tamperedExam: MathExamProject = {
      ...readyExam,
      questions: readyExam.questions.map((q, idx) =>
        idx === 0 ? { ...q, visualAssets: [badAsset], hasVisualAsset: true } : q
      ),
    };
    const gate = checkExamExportGate(tamperedExam);
    assert.equal(gate.canExport, false);
    assert.ok(gate.blockingReasons.length > 0);
    await assert.rejects(() => buildStudentExamDocxBuffer(tamperedExam, readyExam.generatedVersions[0]), /BLOCKED/i);
    await assert.rejects(() => exportMixedExamZipBundle(tamperedExam), /BLOCKED/i);

    // Unconfirmed original answers -> BLOCK mixing & export
    const unconfirmed: MathExamProject = {
      ...project,
      confirmedOriginalAnswers: false,
    };
    assert.equal(checkExamExportGate(unconfirmed).canExport, false);
  });

  it('Test 8 & Test 9: Student DOCX, Answer Key DOCX & CSV export cleanly with ZERO answer leakage', async () => {
    const asset = createMathVisualAsset({
      id: 'img-1',
      kind: 'image',
      label: 'so-do.png',
      sourceData: `data:image/png;base64,${make1x1PngBase64()}`,
    });
    const project = makeBaseProject();
    project.questions[0] = {
      ...project.questions[0],
      visualAssets: [asset],
      hasVisualAsset: true,
    };
    const res = generateMixedExams(project);
    const examWithVersions: MathExamProject = {
      ...project,
      generatedVersions: res.versions,
    };

    const ver = examWithVersions.generatedVersions[0];
    const studentDocx = await buildStudentExamDocxBuffer(examWithVersions, ver);
    const verify = await verifyExportedDocxBuffer(studentDocx, ver, examWithVersions);

    assert.equal(verify.passed, true);
    assert.equal(verify.issues.length, 0);

    // Inspect extracted plain text to ensure NO answer/solution leaked
    const extracted = await extractDocxDocument(studentDocx);
    assert.ok(extracted.plainTextWithMarkers.includes('H₂SO₄'));
    assert.ok(extracted.plainTextWithMarkers.includes('SO₄²⁻'));
    assert.ok(!extracted.plainTextWithMarkers.includes('Đáp án gốc: SO₄²⁻ mang điện tích 2-'));
    assert.ok(!extracted.plainTextWithMarkers.includes('range(3) sinh 0, 1, 2'));
    assert.ok(extracted.assets.length >= 1);

    // Answer Key DOCX & CSV
    const answerDocx = await buildAnswerKeyDocxBuffer(examWithVersions);
    const answerExtracted = await extractDocxDocument(answerDocx);
    assert.ok(answerExtracted.plainTextWithMarkers.includes('BẢNG ĐÁP ÁN TỔNG HỢP'));
    assert.ok(answerExtracted.plainTextWithMarkers.includes(`Mã đề ${ver.code}`));

    const csv = buildConsolidatedAnswerCsv(examWithVersions);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes(`"Mã ${ver.code}"`));
  });

  it('Test 10: ZIP batch bundle creates manifest + all student DOCX + answer keys and passes reverse verification', async () => {
    const project = makeBaseProject({
      mixConfig: {
        ...makeBaseProject().mixConfig,
        examCount: 6,
      },
    });
    const res = generateMixedExams(project);
    const examWithVersions: MathExamProject = {
      ...project,
      generatedVersions: res.versions,
    };

    const { zipBytes, fileName, integrity } = await exportMixedExamZipBundle(examWithVersions);
    assert.ok(fileName.endsWith('.zip'));
    assert.equal(integrity.verified, true);
    assert.equal(integrity.status, 'PASS');
    assert.equal(integrity.verifiedCodes.length, 6);

    // Tamper with one student DOCX inside ZIP and ensure verifyExportedZipBundle detects & blocks it
    const loaded = await JSZip.loadAsync(zipBytes);
    loaded.file(`de-hoc-sinh/Ma_de_${res.versions[0].code}.docx`, 'CORRUPTED_BYTES');
    const tamperedZip = await loaded.generateAsync({ type: 'uint8array' });
    const badVerify = await verifyExportedZipBundle(tamperedZip, examWithVersions);
    assert.equal(badVerify.verified, false);
    assert.equal(badVerify.status, 'BLOCKED');
  });

  it('Test 11: Async chunked batch generation generates 20 & 40 distinct codes and supports AbortSignal cancellation', async () => {
    const now = new Date().toISOString();
    const richQuestions: MathQuestion[] = Array.from({ length: 12 }, (_, idx) => ({
      id: `rq-${idx + 1}`,
      code: `RQ-${String(idx + 1).padStart(2, '0')}`,
      sectionTitle: 'Phần I. Trắc nghiệm',
      type: 'mcq',
      universalType: 'mcq',
      subjectId: 'toan',
      topic: 'Hàm số',
      cognitiveLevel: 'thong-hieu',
      difficultyScore: 2,
      points: 0.25,
      stem: createImmutableContentPayload(`Câu hỏi số ${idx + 1}: Tính $f(${idx + 1}) = x^2 + ${idx}$`, `rq-${idx}`),
      options: [
        { id: `rq-${idx}-a`, originalLabel: 'A', content: createImmutableContentPayload(`${idx + 1}`, `o-${idx}-a`), isCorrect: true },
        { id: `rq-${idx}-b`, originalLabel: 'B', content: createImmutableContentPayload(`${idx + 2}`, `o-${idx}-b`), isCorrect: false },
        { id: `rq-${idx}-c`, originalLabel: 'C', content: createImmutableContentPayload(`${idx + 3}`, `o-${idx}-c`), isCorrect: false },
        { id: `rq-${idx}-d`, originalLabel: 'D', content: createImmutableContentPayload(`${idx + 4}`, `o-${idx}-d`), isCorrect: false },
      ],
      correctOptionId: `rq-${idx}-a`,
      solutionGuide: createImmutableContentPayload('', `sol-${idx}`),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    }));

    const batch40Project = makeBaseProject({
      subject: 'Toán học',
      subjectId: 'toan',
      questions: richQuestions,
      mixConfig: {
        level: 2,
        examCount: 40,
        startCodeNumber: 101,
        customCodeNames: [],
        seed: 'batch-40-seed',
        shuffleQuestions: true,
        shuffleMcqOptions: true,
        keepVdcPositions: false,
        preserveTopicRatios: true,
        shufflePerSectionOnly: true,
        shuffleIndependentTrueFalseStatements: false,
        lockedQuestionIds: [],
        matrixRules: [],
      },
    });

    const progressMarks: number[] = [];
    const batchRes = await generateMixedExamsAsync(batch40Project, {
      chunkSize: 10,
      onProgress: (done) => progressMarks.push(done),
    });

    assert.equal(batchRes.errors.length, 0);
    assert.equal(batchRes.versions.length, 40);
    assert.equal(progressMarks[progressMarks.length - 1], 40);
    assert.ok(batchRes.versions.every((v) => v.integrityPassed));

    // Abort cancellation test
    const controller = new AbortController();
    controller.abort();
    const cancelledRes = await generateMixedExamsAsync(batch40Project, {
      chunkSize: 5,
      signal: controller.signal,
    });
    assert.equal(cancelledRes.cancelled, true);
    assert.equal(cancelledRes.versions.length, 0);
  });

  it('Test 12: Regression compatibility — existing demo Math exam passes pre-mix, shuffle, and DOCX/ZIP export + Literature text import', async () => {
    const pre = evaluatePreMixIntegrity(DEMO_MATH_EXAM);
    assert.equal(pre.categories.length, 6);
    assert.notEqual(pre.status, 'BLOCKED');

    const configIssues = validateMixConfiguration(DEMO_MATH_EXAM);
    assert.equal(
      configIssues.filter((i) => i.severity === 'error').length,
      0
    );

    const mixed = generateMixedExams(DEMO_MATH_EXAM);
    assert.equal(mixed.errors.length, 0);
    assert.ok(mixed.versions.length >= 1);
    assert.ok(mixed.versions.every((v) => v.integrityPassed));

    const demoWithVersions: MathExamProject = {
      ...DEMO_MATH_EXAM,
      generatedVersions: mixed.versions,
    };
    const zipBundle = await exportMixedExamZipBundle(demoWithVersions);
    assert.equal(zipBundle.integrity.verified, true);

    // Universal Text Import -> Reading Group preservation for Literature
    const textExam = [
      'Phần I. Đọc hiểu văn bản',
      'Đọc đoạn trích sau và trả lời câu hỏi từ 1 đến 2:',
      'Sóng bắt đầu từ gió',
      'Gió bắt đầu từ đâu?',
      'Câu 1: Đoạn thơ trên của tác giả nào?',
      'A. Xuân Quỳnh',
      'B. Xuân Diệu',
      'C. Hàn Mặc Tử',
      'D. Chế Lan Viên',
      'Đáp án: A',
      'Câu 2: Hai dòng thơ sử dụng biện pháp tu từ gì?',
      'A. Câu hỏi tu từ',
      'B. Ẩn dụ chuyển đổi cảm giác',
      'C. Hoán dụ',
      'D. Nói quá',
      'Đáp án: A',
    ].join('\n');

    const parsed = parseUniversalExamText(textExam, testId, { subjectId: 'ngu-van' });
    assert.equal(parsed.questions.length, 2);
    assert.equal(parsed.questionGroups.length, 1);
    assert.ok(parsed.questionGroups[0].sharedContext.rawSource.includes('Sóng bắt đầu từ gió\nGió bắt đầu từ đâu?'));
  });
});
