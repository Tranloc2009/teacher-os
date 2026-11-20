import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  buildQuestionOrderDiagnostics,
  generateMixedExams,
} from './mathShuffleEngine';
import {
  createImmutableContentPayload,
  buildUniversalLockState,
  getSubjectProfile,
} from './subjectProfileRegistry';
import {
  commitUniversalImportSessionToProject,
  runUniversalImportSession,
} from './universalImportAdapter';
import {
  buildStudentExamDocxBuffer,
  verifyExportedDocxBuffer,
} from './examExportEngine';
import { evaluatePreMixIntegrity } from './mathIntegrity';
import { createEmptyMathExamProject } from '../data/demoMathExams';
import { MathExamProject, MathQuestion } from '../types/mathExam';

let seq = 0;
const nextId = (prefix: string) => `${prefix}-rc-${++seq}`;

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function ommlFrac(num: string, den: string): string {
  return `<m:oMath><m:f><m:num><m:r><m:t>${num}</m:t></m:r></m:num><m:den><m:r><m:t>${den}</m:t></m:r></m:den></m:f></m:oMath>`;
}

function makeSimple10QuestionExam(): MathExamProject {
  const base = createEmptyMathExamProject(nextId);
  const now = new Date().toISOString();
  const labels = ['A', 'B', 'C', 'D'] as const;

  const questions: MathQuestion[] = Array.from({ length: 10 }, (_, idx) => {
    const num = idx + 1;
    const qId = `Q${String(num).padStart(2, '0')}`;
    const correctIdx = idx % 4;
    const options = labels.map((lbl, oIdx) => ({
      id: `${qId}-opt-${lbl}`,
      originalLabel: lbl,
      isCorrect: oIdx === correctIdx,
      content: createImmutableContentPayload(
        `Phương án ${lbl} của câu ${qId} (giá trị ${num * 10 + oIdx})`,
        `${qId}-o${oIdx}`
      ),
    }));
    return {
      id: qId,
      code: qId,
      sectionTitle: 'PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn',
      type: 'mcq',
      universalType: 'mcq',
      subjectId: 'toan',
      topic: 'Đại số',
      cognitiveLevel: 'nhan-biet',
      difficultyScore: 1,
      points: 1,
      stem: createImmutableContentPayload(
        `[TAG-${qId}] Tính giá trị biểu thức $P_{${num}} = ${num}x + 1$ tại $x = 2$.`,
        `${qId}-stem`
      ),
      options,
      correctOptionId: options[correctIdx].id,
      solutionGuide: createImmutableContentPayload('', `${qId}-sol`),
      visualAssets: [],
      hasVisualAsset: false,
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      answerConfirmed: true,
      createdAt: now,
      updatedAt: now,
    };
  });

  return {
    ...base,
    title: 'Đề kiểm tra 10 câu độc lập',
    confirmedOriginalAnswers: true,
    questions,
    questionGroups: [],
    mixConfig: {
      ...base.mixConfig,
      level: 2,
      shuffleQuestions: true,
      shuffleMcqOptions: false,
      keepDependentGroups: true,
      shufflePerSectionOnly: true,
      keepVdcPositions: false,
      examCount: 4,
      startCodeNumber: 101,
      customCodeNames: ['101', '102', '103', '104'],
      seed: 'root-cause-10q-2025',
      lockedQuestionIds: [],
    },
  };
}

/**
 * Tạo file Word .docx thực tế có:
 * - Bảng khung tiêu đề 2 cột đầu trang (SỞ GIÁO DỤC VÀ ĐÀO TẠO | ĐỀ KIỂM TRA... | MÃ ĐỀ...)
 * - 3 phần chuẩn Toán 12: 12 MCQ + 4 Đúng/Sai + 6 Trả lời ngắn = 22 câu
 * - Công thức OMML, hình PNG nhúng, bảng biến thiên thật bên trong Câu 1
 * - Bảng đáp án cuối đề
 */
async function buildRealVietnameseHeaderDocx(options?: {
  includeLegacyOle?: boolean;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  const relEntries: string[] = [
    `<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/graph1.png"/>`,
  ];
  zip.file('word/media/graph1.png', TINY_PNG_BASE64, { base64: true });

  if (options?.includeLegacyOle) {
    relEntries.push(
      `<Relationship Id="rIdWmf1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/eq1.wmf"/>`,
      `<Relationship Id="rIdOle1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/ole1.bin"/>`
    );
    zip.file('word/media/eq1.wmf', Uint8Array.from([0xd7, 0xcd, 0xc6, 0x9a, 1]));
    zip.file('word/embeddings/ole1.bin', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 1]));
  }

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relEntries.join('\n  ')}
</Relationships>`;

  const body: string[] = [];

  // Bảng khung tiêu đề đề thi Việt Nam chuẩn (trước đây gây bẫy gom toàn bộ đề thành 1 QuestionGroup!)
  body.push(`
    <w:tbl>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:t>SỞ GIÁO DỤC VÀ ĐÀO TẠO HÀ NỘI</w:t></w:r></w:p>
          <w:p><w:r><w:t>TRƯỜNG THPT CHU VĂN AN</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:p><w:r><w:t>ĐỀ KIỂM TRA GIỮA HỌC KÌ I — NĂM HỌC 2024 - 2025</w:t></w:r></w:p>
          <w:p><w:r><w:t>MÔN: TOÁN 12 · THỜI GIAN LÀM BÀI: 90 PHÚT</w:t></w:r></w:p>
          <w:p><w:r><w:t>MÃ ĐỀ: 101 · HỌ VÀ TÊN: ........................</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  `);

  // PHẦN I: 12 MCQ
  body.push(`<w:p><w:r><w:t>PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn.</w:t></w:r></w:p>`);
  for (let i = 1; i <= 12; i++) {
    const imgMarkup =
      i === 1 ? `<w:r><w:drawing><a:blip r:embed="rIdImg1"/></w:drawing></w:r>` : '';
    const oleMarkup =
      options?.includeLegacyOle && i === 2
        ? `<w:r><w:object><v:shape id="_x0000_i1025"><v:imagedata r:id="rIdWmf1"/></v:shape><o:OLEObject Type="Embed" ProgID="Equation.DSMT4" r:id="rIdOle1"/></w:object></w:r>`
        : '';
    body.push(
      `<w:p><w:r><w:t>Câu ${i}: [P1_Q${String(i).padStart(2, '0')}] Cho hàm số có biểu thức </w:t></w:r>${ommlFrac(String(i), 'x+1')}${imgMarkup}${oleMarkup}</w:p>`
    );
    if (i === 1) {
      body.push(`
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>-∞</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>0</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>+∞</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:r><w:t>f'(x)</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>+</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>0</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>-</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
      `);
    }
    body.push(
      `<w:p><w:r><w:t>A. ${i}   B. ${i + 1}   C. ${i + 2}   D. ${i + 3}</w:t></w:r></w:p>`
    );
  }

  // PHẦN II: 4 Đúng/Sai
  body.push(`<w:p><w:r><w:t>PHẦN II. Câu trắc nghiệm đúng sai.</w:t></w:r></w:p>`);
  for (let i = 1; i <= 4; i++) {
    body.push(
      `<w:p><w:r><w:t>Câu ${i}: [P2_Q${String(i).padStart(2, '0')}] Xét hàm số $g_${i}(x) = x^3 - ${i}x$:</w:t></w:r></w:p>`
    );
    body.push(`<w:p><w:r><w:t>a) Hàm số xác định trên $\\mathbb{R}$.</w:t></w:r></w:p>`);
    body.push(`<w:p><w:r><w:t>b) $g_${i}'(0) = -${i}$.</w:t></w:r></w:p>`);
    body.push(`<w:p><w:r><w:t>c) Đồ thị qua gốc tọa độ $O(0;0)$.</w:t></w:r></w:p>`);
    body.push(`<w:p><w:r><w:t>d) Giá trị tại $x=1$ bằng $100$.</w:t></w:r></w:p>`);
  }

  // PHẦN III: 6 Trả lời ngắn
  body.push(`<w:p><w:r><w:t>PHẦN III. Câu trắc nghiệm trả lời ngắn.</w:t></w:r></w:p>`);
  for (let i = 1; i <= 6; i++) {
    body.push(
      `<w:p><w:r><w:t>Câu ${i}: [P3_Q${String(i).padStart(2, '0')}] Tính giá trị $S_${i} = ${i * 5} + ${i}$.</w:t></w:r></w:p>`
    );
  }

  // BẢNG ĐÁP ÁN
  body.push(`<w:p><w:r><w:t>BẢNG ĐÁP ÁN</w:t></w:r></w:p>`);
  body.push(`<w:p><w:r><w:t>PHẦN I</w:t></w:r></w:p>`);
  body.push(
    `<w:p><w:r><w:t>1A 2B 3C 4D 5A 6B 7C 8D 9A 10B 11C 12D</w:t></w:r></w:p>`
  );
  body.push(`<w:p><w:r><w:t>PHẦN II</w:t></w:r></w:p>`);
  for (let i = 1; i <= 4; i++) {
    body.push(`<w:p><w:r><w:t>Câu ${i}: Đ Đ Đ S</w:t></w:r></w:p>`);
  }
  body.push(`<w:p><w:r><w:t>PHẦN III</w:t></w:r></w:p>`);
  for (let i = 1; i <= 6; i++) {
    body.push(`<w:p><w:r><w:t>Câu ${i}: ${i * 6}</w:t></w:r></w:p>`);
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:o="urn:schemas-microsoft-com:office:office">
  <w:body>
    ${body.join('\n    ')}
  </w:body>
</w:document>`;

  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', relsXml);
  return zip.generateAsync({ type: 'uint8array' });
}

test('1. 10-question independent exam: shuffleQuestions=true, shuffleOptions=false changes order across 101/102 and exports identical order to DOCX', async () => {
  const exam = makeSimple10QuestionExam();
  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0, `Errors: ${res.errors.join(' | ')}`);
  assert.equal(res.versions.length, 4);

  const origOrder = exam.questions.map((q) => q.id);
  const v101 = res.versions.find((v) => v.code === '101')!;
  const v102 = res.versions.find((v) => v.code === '102')!;
  const order101 = v101.questions.map((q) => q.id);
  const order102 = v102.questions.map((q) => q.id);

  // Ghi log dữ liệu thực tế cho báo cáo kiểm chứng
  console.log('ORIGINAL ORDER:', JSON.stringify(origOrder));
  console.log('SHUFFLED ORDER 101:', JSON.stringify(order101));
  console.log('SHUFFLED ORDER 102:', JSON.stringify(order102));

  assert.notEqual(order101[0], origOrder[0], 'Câu 1 mã 101 phải khác câu 1 đề gốc');
  assert.notDeepEqual(order101, origOrder, 'Thứ tự mã 101 phải khác đề gốc');
  assert.notDeepEqual(order102, origOrder, 'Thứ tự mã 102 phải khác đề gốc');
  assert.notDeepEqual(order101, order102, 'Mã 101 và mã 102 phải khác thứ tự câu');
  assert.equal(new Set(order101).size, 10, 'Không được trùng câu');
  assert.equal(new Set(order102).size, 10, 'Không được trùng câu');

  // Kiểm tra đáp án đi theo câu gốc (vì shuffleOptions = false nên nhãn A/B/C/D của từng câu giữ nguyên đúng đáp án gốc của chính câu đó)
  for (let i = 0; i < 10; i++) {
    const movedQ = v101.questions[i];
    const origQ = exam.questions.find((q) => q.id === movedQ.id)!;
    assert.equal(movedQ.correctOptionId, origQ.correctOptionId);
    assert.deepEqual(
      movedQ.options?.map((o) => o.id),
      origQ.options?.map((o) => o.id),
      'Khi tắt Đảo phương án thì thứ tự A/B/C/D bên trong từng câu không bị đảo'
    );
  }

  // Kiểm tra Export Student DOCX giữ đúng thứ tự câu đã đảo của Mã 101 và Mã 102
  const examWithVersions: MathExamProject = {
    ...exam,
    generatedVersions: res.versions,
  };
  const docx101 = await buildStudentExamDocxBuffer(examWithVersions, v101);
  const docx102 = await buildStudentExamDocxBuffer(examWithVersions, v102);
  const verify101 = await verifyExportedDocxBuffer(docx101, v101, examWithVersions);
  const verify102 = await verifyExportedDocxBuffer(docx102, v102, examWithVersions);
  assert.equal(verify101.passed, true, `DOCX 101 verify failed: ${verify101.issues.join('; ')}`);
  assert.equal(verify102.passed, true, `DOCX 102 verify failed: ${verify102.issues.join('; ')}`);

  const zip101 = await JSZip.loadAsync(docx101);
  const xml101 = await zip101.file('word/document.xml')!.async('string');
  const markers101 = Array.from(xml101.matchAll(/\[TAG-(Q\d{2})\]/g)).map((m) => m[1]);
  assert.deepEqual(
    markers101,
    order101,
    'Thứ tự câu trong file DOCX Mã 101 phải khớp 100% với version.questions'
  );

  const zip102 = await JSZip.loadAsync(docx102);
  const xml102 = await zip102.file('word/document.xml')!.async('string');
  const markers102 = Array.from(xml102.matchAll(/\[TAG-(Q\d{2})\]/g)).map((m) => m[1]);
  assert.deepEqual(
    markers102,
    order102,
    'Thứ tự câu trong file DOCX Mã 102 phải khớp 100% với version.questions'
  );
});

test('2. Real Vietnamese DOCX with 2-column Header Banner Table + 3 sections (12 + 4 + 6 = 22) does NOT trap questions in 1 group and shuffles within each section', async () => {
  const docxBytes = await buildRealVietnameseHeaderDocx({ includeLegacyOle: false });
  const session = await runUniversalImportSession(
    {
      fileName: 'De_KTGKI_Toan12_HeaderTable.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBytes,
    },
    nextId,
    { subjectId: 'toan', renderPreviews: false }
  );

  assert.equal(session.questions.length, 22, 'Phải tách đủ 22 câu (12 + 4 + 6)');
  assert.equal(
    session.questionGroups.length,
    0,
    'Bảng khung tiêu đề SỞ GD&ĐT đầu file tuyệt đối KHÔNG được biến thành QuestionGroup gom toàn bộ câu hỏi'
  );
  assert.equal(
    session.questions.every((q) => !q.groupId),
    true,
    'Không câu nào được gắn nhầm vào groupId của bảng tiêu đề'
  );

  const base = createEmptyMathExamProject(nextId);
  const project: MathExamProject = {
    ...commitUniversalImportSessionToProject(base, session, {
      applySuggestedSubject: true,
      replaceExisting: true,
    }),
    confirmedOriginalAnswers: true,
    mixConfig: {
      ...base.mixConfig,
      level: 2,
      shuffleQuestions: true,
      shuffleMcqOptions: true,
      keepDependentGroups: true,
      shufflePerSectionOnly: true,
      keepVdcPositions: false,
      examCount: 4,
      startCodeNumber: 101,
      customCodeNames: ['101', '102', '103', '104'],
      seed: 'real-docx-22q-2025',
      lockedQuestionIds: [],
    },
  };

  const preMix = evaluatePreMixIntegrity(project);
  assert.notEqual(preMix.status, 'BLOCKED', `Pre-mix bị BLOCKED: ${JSON.stringify(preMix.issues)}`);

  const res = generateMixedExams(project);
  assert.equal(res.errors.length, 0, `Mix errors: ${res.errors.join('; ')}`);
  assert.equal(res.versions.length, 4);

  const origIds = project.questions.map((q) => q.id);
  const v101 = res.versions[0];
  const v102 = res.versions[1];
  const ids101 = v101.questions.map((q) => q.id);
  const ids102 = v102.questions.map((q) => q.id);

  // Kiểm tra từng phần đều đảo bên trong đúng ranh giới 0..11, 12..15, 16..21
  const p1Orig = origIds.slice(0, 12);
  const p2Orig = origIds.slice(12, 16);
  const p3Orig = origIds.slice(16, 22);

  assert.deepEqual([...ids101.slice(0, 12)].sort(), [...p1Orig].sort(), 'Phần I không được lẫn câu sang phần khác');
  assert.deepEqual([...ids101.slice(12, 16)].sort(), [...p2Orig].sort(), 'Phần II không được lẫn câu sang phần khác');
  assert.deepEqual([...ids101.slice(16, 22)].sort(), [...p3Orig].sort(), 'Phần III không được lẫn câu sang phần khác');

  assert.notDeepEqual(ids101.slice(0, 12), p1Orig, 'Phần I (12 câu MCQ) phải đảo thứ tự câu');
  assert.notDeepEqual(ids101.slice(12, 16), p2Orig, 'Phần II (4 câu Đ/S) phải đảo thứ tự câu');
  assert.notDeepEqual(ids101.slice(16, 22), p3Orig, 'Phần III (6 câu TLN) phải đảo thứ tự câu');
  assert.notDeepEqual(ids101, ids102, 'Mã 101 và 102 phải khác thứ tự câu');

  // Câu 1 gốc có PNG + Bảng biến thiên phải mang theo nguyên vẹn cả 2 tài nguyên tới vị trí mới
  const movedOrigQ1 = v101.questions.find((q) => q.id === origIds[0])!;
  const movedAssets = movedOrigQ1.visualAssets ?? [];
  assert.ok(
    movedAssets.some((a) => a.kind === 'image') &&
      movedAssets.some((a) => a.kind === 'data-table'),
    'Hình ảnh và bảng biến thiên của Câu 1 gốc phải di chuyển theo đúng câu hỏi đó'
  );

  // Export DOCX kiểm chứng khớp thứ tự
  const projectWithVersions: MathExamProject = {
    ...project,
    generatedVersions: res.versions,
  };
  const docx101 = await buildStudentExamDocxBuffer(projectWithVersions, v101);
  const verify101 = await verifyExportedDocxBuffer(docx101, v101, projectWithVersions);
  assert.equal(verify101.passed, true, `DOCX 22-question verify failed: ${verify101.issues.join('; ')}`);
});

test('3. Unsafe legacy OLE/WMF DOCX surfaces transparent WARNING and tampered asset triggers BLOCKED gate (no bypass)', async () => {
  const docxBytes = await buildRealVietnameseHeaderDocx({ includeLegacyOle: true });
  const session = await runUniversalImportSession(
    {
      fileName: 'De_Legacy_OLE.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBytes,
    },
    nextId,
    { subjectId: 'toan', renderPreviews: false }
  );

  const base = createEmptyMathExamProject(nextId);
  const project: MathExamProject = {
    ...commitUniversalImportSessionToProject(base, session, {
      applySuggestedSubject: true,
      replaceExisting: true,
    }),
    confirmedOriginalAnswers: true,
  };

  const preMix = evaluatePreMixIntegrity(project);
  assert.equal(preMix.status, 'BLOCKED', 'Legacy OLE/WMF chưa giải mã bắt buộc phải bị BLOCKED theo chuẩn P0');
  assert.ok(
    preMix.issues.some((i) => i.id.startsWith('q-legacy-eq-') && i.tier === 'BLOCKED'),
    'Phải phát hiện lỗi BLOCKED q-legacy-eq-* cho MathType OLE cũ chưa giải mã'
  );

  // Tampered checksum tài nguyên bắt buộc phải BLOCKED và chặn trộn
  const tamperedProject = structuredClone(project);
  const firstAssets = tamperedProject.questions[0].visualAssets ?? [];
  assert.ok(firstAssets.length > 0);
  firstAssets[0].checksum = 'tampered-bad-checksum';
  const tamperedReport = evaluatePreMixIntegrity(tamperedProject);
  assert.equal(tamperedReport.status, 'BLOCKED', 'Tài nguyên sai checksum phải bị BLOCKED');
  const blockedRes = generateMixedExams(tamperedProject);
  assert.ok(blockedRes.errors.length > 0, 'Không được âm thầm bỏ qua lỗi BLOCKED khi trộn');
});

test('4. Sticky unlock regression: unlocking previously locked questions clears universalLock.positionLock and restores question shuffling', () => {
  const profile = getSubjectProfile('toan');
  const exam = makeSimple10QuestionExam();

  // Bước 1: Khóa toàn bộ 10 câu (cả lockQuestionPosition và universalLock.positionLock) với Đảo phương án BẬT
  // Tái hiện chính xác tình huống "chỉ đảo đáp án, không đảo thứ tự câu hỏi"
  const allLockedExam: MathExamProject = {
    ...exam,
    mixConfig: {
      ...exam.mixConfig,
      shuffleQuestions: true,
      shuffleMcqOptions: true,
    },
    questions: exam.questions.map((q) => {
      const lockedQ: MathQuestion = { ...q, lockQuestionPosition: true };
      return {
        ...lockedQ,
        universalLock: buildUniversalLockState(lockedQ, profile),
      };
    }),
  };

  const lockedRes = generateMixedExams(allLockedExam);
  assert.equal(lockedRes.versions.length, 4);
  const lockedProject: MathExamProject = {
    ...allLockedExam,
    generatedVersions: lockedRes.versions,
  };
  const lockedDiag = buildQuestionOrderDiagnostics(lockedProject);
  assert.equal(lockedDiag.allVersionsUnchanged, true);
  assert.ok(
    lockedDiag.nonShuffleReasons.some((r) => /khóa vị trí/i.test(r)),
    `Diagnostics phải báo rõ lý do câu bị khóa: ${JSON.stringify(lockedDiag.nonShuffleReasons)}`
  );

  // Bước 2: Mở khóa tất cả (chỉ set lockQuestionPosition = false rồi chạy qua buildUniversalLockState giống database.ts normalize)
  const unlockedExam: MathExamProject = {
    ...allLockedExam,
    questions: allLockedExam.questions.map((q) => {
      const unlockedQ: MathQuestion = { ...q, lockQuestionPosition: false };
      return {
        ...unlockedQ,
        universalLock: buildUniversalLockState(unlockedQ, profile),
      };
    }),
  };

  assert.equal(
    unlockedExam.questions.every((q) => q.universalLock?.positionLock === false),
    true,
    'buildUniversalLockState không được giữ dính positionLock=true sau khi giáo viên đã mở khóa'
  );

  const unlockedRes = generateMixedExams(unlockedExam);
  const unlockedProject: MathExamProject = {
    ...unlockedExam,
    generatedVersions: unlockedRes.versions,
  };
  const unlockedDiag = buildQuestionOrderDiagnostics(unlockedProject);
  assert.equal(unlockedDiag.allVersionsUnchanged, false);
  assert.ok(
    unlockedDiag.rows[1].changedPositionsCount >= 2,
    'Sau khi mở khóa, thứ tự câu hỏi phải thực sự thay đổi'
  );
});

test('5. Question Order Diagnostics accurately explains shuffleQuestions=false and single giant group', () => {
  const exam = makeSimple10QuestionExam();
  const offExam: MathExamProject = {
    ...exam,
    mixConfig: { ...exam.mixConfig, level: 1, shuffleQuestions: false, shuffleMcqOptions: true },
  };
  const offRes = generateMixedExams(offExam);
  const offDiag = buildQuestionOrderDiagnostics({ ...offExam, generatedVersions: offRes.versions });
  assert.equal(offDiag.shuffleQuestionsEnabled, false);
  assert.equal(offDiag.allVersionsUnchanged, true);
  assert.ok(
    offDiag.nonShuffleReasons.some((r) => /shuffleQuestions = false/i.test(r)),
    'Phải nêu rõ lý do chưa bật đảo thứ tự câu hỏi'
  );
});
