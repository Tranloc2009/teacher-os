import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import { auditUnknownExamZipBundle, exportMixedExamZipBundle } from './examExportEngine';
import { evaluatePreMixIntegrity } from './mathIntegrity';
import { generateMixedExams } from './mathShuffleEngine';
import { convertWmfToSvg, extractOle2Stream, decodeMathTypeMtef } from './oleAndWmfDecoder';
import { importUniversalExamFile, mergeImportedExamIntoProject } from './universalImportEngine';

const fixtureDir = process.env.TEACHEROS_DOCX_FIXTURES;
const fixtures = [
  { sha: '41576526aa627c8421b016d1ecf798f222ff34619ed37852b75550b9ad58106c', counts: [12, 4, 6, 0], ole: 354,
    mcq: 'BBCABDDBCAAB', tf: ['TFFT', 'TFTF', 'FFTF', 'FTFT'], short: ['4', '5', '-4.3', '1.3', '64', '5517'] },
  { sha: 'e3f4a4f43434414f7580cf2ec1554f5fdda485fa61c933372fdae1432daa8385', counts: [12, 4, 6, 0], ole: 337,
    mcq: 'CDBABDABDDBC', tf: ['FTTT', 'FFTT', 'TFFT', 'TFFT'], short: ['-7', '15', '60', '120', '0', '11'] },
  { sha: 'b5501d2d1986c4699586e21f152907b9967faab0702826bb5b8bd2d64e66a9a4', counts: [12, 4, 6, 0], ole: 326,
    mcq: 'CACAADCCACDD', tf: ['TTFT', 'FTTF', 'TFTF', 'FTTT'], short: ['1', '9', '60', '10000', '7.3', '12888'] },
  { sha: '5281fd795d027a2307f2be0b737517f927c26d44373063704d50b725881518d6', counts: [10, 2, 2, 0], ole: 78 },
  { sha: '08260c4938c7f522d577301eee8a3bf8a7d586fd69dfe0b0ecf8f680235c8d1b', counts: [12, 2, 4, 3], ole: 82 },
  { sha: '20c1c57c391d9725fa34e0f3783091c50fa0a2af84f6330592e341a798edbdf1', counts: [10, 2, 2, 0], ole: 75 },
];

test('Worksheet MathType records preserve a minus sign, decimal comma and superscript', () => {
  const wrapped = [
    5, 1, 0, 7, 4, 68, 83, 77, 84, 55, 0, 1,
    19, 87, 105, 110, 0, // ENCODING_DEF, no option byte
    17, 5, 84, 105, 109, 101, 115, 0, // FONT_DEF, no option byte
    18, 0, 1, 0x21, 0x2f, 0, 0, // EQN_PREFS with a size and empty spaces/styles
    10, 1, 0, // FULL, LINE
  ];
  const negative = Uint8Array.from([
    ...wrapped, 2, 4, 134, 0x12, 0x22, 45,
    2, 0, 136, 52, 0, 2, 0, 130, 44, 0, 2, 0, 136, 51, 0, 0, 0,
  ]);
  assert.equal(decodeMathTypeMtef(negative).latex, '-4,3');
  assert.equal(decodeMathTypeMtef(negative.slice(0, -1)).ok, false);
  const exponent = Uint8Array.from([
    ...wrapped, 2, 0, 131, 120, 0, 3, 0, 28, 0, 0,
    11, 1, 1, 1, 0, 2, 0, 136, 50, 0, 0, 0, 0, 0,
  ]);
  const decoded = decodeMathTypeMtef(exponent);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.latex, 'x^{2}');
});

test('Real teacher DOCX fixtures restore math and source keys without inventing missing answers', {
  skip: !fixtureDir && 'Set TEACHEROS_DOCX_FIXTURES to the directory holding the six original DOCX files and the broken ZIP',
}, async (t) => {
  const dir = fixtureDir!;
  const bySha = new Map<string, { fileName: string; buffer: Uint8Array }>();
  for (const fileName of await readdir(dir)) {
    if (!/\.(docx|zip)$/i.test(fileName)) continue;
    const buffer = await readFile(join(dir, fileName));
    bySha.set(createHash('sha256').update(buffer).digest('hex'), { fileName, buffer });
  }
  const old = bySha.get('239732d607744115b08c15761d41ee496065eed4bed70d02cee836f88a008251');
  assert.ok(old, 'Provide the original broken TeacherOS ZIP');
  assert.equal((await auditUnknownExamZipBundle(old.buffer)).passed, false);
  for (const fixture of fixtures) {
    const source = bySha.get(fixture.sha);
    assert.ok(source, 'Missing original DOCX: ' + fixture.sha);
    await t.test(source.fileName, async () => {
      let seq = 0;
      const imported = await importUniversalExamFile(source, (prefix) => prefix + '-' + ++seq);
      const mcq = imported.questions.filter((q) => q.type === 'mcq');
      assert.deepEqual(['mcq', 'true-false', 'short-answer', 'essay'].map(
        (type) => imported.questions.filter((q) => q.type === type).length
      ), fixture.counts);
      assert.equal(imported.report.legacyOleCount, fixture.ole);
      assert.equal(imported.report.unresolvedOleCount, 0);
      const exam = mergeImportedExamIntoProject(structuredClone(DEMO_MATH_EXAM), imported, { replaceExisting: true });
      exam.isDemo = false;
      if (!fixture.mcq) {
        assert.ok(evaluatePreMixIntegrity(exam).issues.some((issue) => /THIẾU KHÓA|CẦN DUYỆT/i.test(issue.message)));
        assert.equal(generateMixedExams(exam).versions.length, 0);
        return;
      }
      assert.equal(mcq.map((q) => q.options?.find((o) => o.id === q.correctOptionId)?.originalLabel).join(''), fixture.mcq);
      assert.deepEqual(imported.questions.filter((q) => q.type === 'true-false').map((q) => q.statements?.map(
        (s) => s.answerState === 'confirmed' ? (s.isTrue ? 'T' : 'F') : '?'
      ).join('')), fixture.tf);
      assert.deepEqual(imported.questions.filter((q) => q.type === 'short-answer').map((q) => q.shortAnswer?.normalizedAnswer), fixture.short);
      assert.ok(imported.questions.every((q) => q.answerProvenance?.status === 'source-matched'));

      if (fixture.ole === 354 || fixture.ole === 337) {
        const docx = await JSZip.loadAsync(source.buffer);
        if (fixture.ole === 354) {
          const ole = await docx.file('word/embeddings/oleObject302.bin')!.async('uint8array');
          const native = extractOle2Stream(ole, 'Equation Native');
          assert.ok(native);
          assert.equal(decodeMathTypeMtef(native).latex, '-4,3');
          assert.ok(mcq[7].stem.rawSource.includes('2x^{3}'), 'Real polynomial must retain its cubic term');
        } else {
          const image = await docx.file('word/media/image55.wmf')!.async('uint8array');
          const result = convertWmfToSvg(image);
          assert.match(result.svgMarkup ?? '', /<text x="1032 1864" y="424"[^>]*>21<\/text>/);
          assert.match(result.svgMarkup ?? '', /<text x="1633" y="1052"[^>]*>3<\/text>/);
          assert.equal(mcq[9].options?.[0].visualAsset?.sourcePartPath, 'word/media/image55.wmf');
        }
      }

      exam.confirmedOriginalAnswers = true;
      exam.mixConfig.examCount = 4;
      for (const seed of ['teacher-source-a', 'teacher-source-b']) {
        exam.mixConfig.seed = seed;
        const mixed = generateMixedExams(exam);
        assert.deepEqual(mixed.errors, []);
        assert.equal(mixed.versions.length, 4);
        for (const version of mixed.versions) {
          for (const q of version.questions) {
            const original = exam.questions.find((candidate) => candidate.id === q.id)!;
            for (const o of q.options ?? []) {
              const originalOption = original.options?.find((candidate) => candidate.id === o.id);
              assert.equal(o.visualAsset?.checksum, originalOption?.visualAsset?.checksum);
              assert.equal(o.isCorrect, originalOption?.isCorrect);
            }
          }
        }
        exam.generatedVersions = mixed.versions;
        const output = await exportMixedExamZipBundle(exam);
        assert.equal(output.integrity.verified, true);
      }
    });
  }
});
