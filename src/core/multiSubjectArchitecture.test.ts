import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBJECT_PROFILES,
  UNIVERSAL_QUESTION_POLICIES,
  buildUniversalLockState,
  captureQuestionOriginalSnapshot,
  createImmutableContentPayload,
  getQuestionTypeMixPolicy,
  getSubjectProfile,
  getUniversalQuestionType,
  listSubjectProfiles,
  mergeSubjectProfileOverrides,
  resolveSubjectId,
  suggestSubjectProfileFromText,
} from './subjectProfileRegistry';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import { generateMixedExams } from './mathShuffleEngine';
import { evaluatePreMixIntegrity } from './mathIntegrity';
import { normalizeMathExamProject } from '../db/database';
import {
  createBackupPayload,
  DEFAULT_PRINT_SETTINGS,
  validateBackupPayload,
} from '../utils/backup';
import {
  ExamSubjectId,
  MathExamProject,
  MathQuestion,
  UNIVERSAL_QUESTION_TYPE_LABELS,
  UniversalQuestionType,
} from '../types/mathExam';

test('Stage 2.1: Subject Profile Registry defines all 12 THCS/THPT subjects with complete rules', () => {
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
  assert.deepEqual(
    profiles.map((p) => p.id),
    expectedIds
  );

  for (const profile of profiles) {
    assert.ok(profile.name.trim().length > 0);
    assert.ok(profile.commonQuestionTypes.length >= 3);
    assert.ok(profile.defaultSections.length >= 2);
    assert.ok(profile.protectedSymbolPatterns.length >= 1);
    assert.ok(profile.warningRules.length >= 1);
  }

  assert.equal(SUBJECT_PROFILES.toan.protectionLevel, 'strict-math');
  assert.equal(SUBJECT_PROFILES['hoa-hoc'].protectionLevel, 'scientific-formula');
  assert.equal(SUBJECT_PROFILES['ngu-van'].presentationRules.preserveLineBreaksInPoetryOrCode, true);
  assert.equal(SUBJECT_PROFILES['tin-hoc'].presentationRules.preserveLineBreaksInPoetryOrCode, true);
  assert.equal(SUBJECT_PROFILES['tieng-anh'].presentationRules.preserveIpaPhonetics, true);
  assert.equal(SUBJECT_PROFILES['tieng-anh'].answerConstraints.detectEnglishDependentOptions, true);
});

test('Stage 2.2: resolveSubjectId handles Vietnamese diacritics, variants and unknown fallback', () => {
  assert.equal(resolveSubjectId('Toán học'), 'toan');
  assert.equal(resolveSubjectId('toan'), 'toan');
  assert.equal(resolveSubjectId('Vật lí'), 'vat-ly');
  assert.equal(resolveSubjectId('Vật lý'), 'vat-ly');
  assert.equal(resolveSubjectId('Hóa học'), 'hoa-hoc');
  assert.equal(resolveSubjectId('Sinh học'), 'sinh-hoc');
  assert.equal(resolveSubjectId('Ngữ văn'), 'ngu-van');
  assert.equal(resolveSubjectId('Tiếng Anh'), 'tieng-anh');
  assert.equal(resolveSubjectId('Lịch sử'), 'lich-su');
  assert.equal(resolveSubjectId('Địa lí'), 'dia-ly');
  assert.equal(resolveSubjectId('GDKT&PL'), 'gdkt-pl');
  assert.equal(resolveSubjectId('GDCD'), 'gdkt-pl');
  assert.equal(resolveSubjectId('Tin học'), 'tin-hoc');
  assert.equal(resolveSubjectId('Công nghệ'), 'cong-nghe');
  assert.equal(resolveSubjectId('Môn tự chọn đặc biệt'), 'khac');
});

test('Stage 2.3: suggestSubjectProfileFromText advises accurately and always requires teacher confirmation', () => {
  const mathSuggest = suggestSubjectProfileFromText(
    'Môn: Toán học 12. Tính tích phân $\\int_0^1 \\frac{x^2}{\\sqrt{x+1}}\\,dx$.'
  );
  assert.equal(mathSuggest.suggestedId, 'toan');
  assert.equal(mathSuggest.confidence, 'high');
  assert.equal(mathSuggest.requiresTeacherConfirmation, true);

  const chemSuggest = suggestSubjectProfileFromText(
    'Cho 0,2 mol H₂SO₄ tác dụng vừa đủ với FeCl₃ theo phương trình 2H₂ + O₂ → 2H₂O.'
  );
  assert.equal(chemSuggest.suggestedId, 'hoa-hoc');
  assert.equal(chemSuggest.requiresTeacherConfirmation, true);

  const physSuggest = suggestSubjectProfileFromText(
    'Mạch RLC nối tiếp có R = 100 Ω, dao động điều hòa với gia tốc 10 m/s², tần số góc ω.'
  );
  assert.equal(physSuggest.suggestedId, 'vat-ly');

  const engSuggest = suggestSubjectProfileFromText(
    'Mark the letter A, B, C, or D on your answer sheet. Read the following passage carefully. /ˈkʌltʃə(r)/'
  );
  assert.equal(engSuggest.suggestedId, 'tieng-anh');

  const litSuggest = suggestSubjectProfileFromText(
    'Phần I. Đọc hiểu văn bản. Xác định phương thức biểu đạt và biện pháp tu từ trong khổ thơ trên. Phần II. Nghị luận văn học.'
  );
  assert.equal(litSuggest.suggestedId, 'ngu-van');

  const bioSuggest = suggestSubjectProfileFromText(
    'Một đoạn mạch DNA có chiều 5′–3′ tổng hợp mRNA qua các bộ ba codon và kiểu gen AaBb × Aabb.'
  );
  assert.equal(bioSuggest.suggestedId, 'sinh-hoc');

  const csSuggest = suggestSubjectProfileFromText(
    'Cho đoạn mã Python:\ndef solve(n):\n    for i in range(n):\n        print(i)\nViết câu lệnh SELECT * FROM Students.'
  );
  assert.equal(csSuggest.suggestedId, 'tin-hoc');
});

test('Stage 2.4: mergeSubjectProfileOverrides allows per-exam customization without mutating registry', () => {
  const baseEng = getSubjectProfile('tieng-anh');
  const customized = mergeSubjectProfileOverrides(baseEng, {
    shufflePerSectionOnly: false,
    detectEnglishDependentOptions: true,
    lockInternalGroupOrder: false,
  });

  assert.equal(customized.defaultMixPolicy.shufflePerSectionOnly, false);
  assert.equal(customized.groupRules.lockInternalGroupOrder, false);
  // Registry gốc không bị biến đổi
  assert.equal(SUBJECT_PROFILES['tieng-anh'].defaultMixPolicy.shufflePerSectionOnly, true);
  assert.equal(SUBJECT_PROFILES['tieng-anh'].groupRules.lockInternalGroupOrder, true);
});

test('Stage 2.5: All 10 UniversalQuestionTypes have explicit mix policies and stable-ID structures', () => {
  const allTypes = Object.keys(UNIVERSAL_QUESTION_TYPE_LABELS) as UniversalQuestionType[];
  assert.equal(allTypes.length, 10);

  for (const t of allTypes) {
    const policy = getQuestionTypeMixPolicy(t);
    assert.equal(policy.type, t);
    assert.ok(policy.policySummary.length > 10);
  }

  assert.equal(UNIVERSAL_QUESTION_POLICIES['fill-blank'].defaultLockOptionShuffle, true);
  assert.equal(UNIVERSAL_QUESTION_POLICIES['fill-blank'].answerMappingMode, 'blank-slot-id');
  assert.equal(UNIVERSAL_QUESTION_POLICIES.matching.answerMappingMode, 'pair-id-map');
  assert.equal(UNIVERSAL_QUESTION_POLICIES.ordering.answerMappingMode, 'rank-id-sequence');
  assert.equal(
    UNIVERSAL_QUESTION_POLICIES['reading-comprehension'].requiresGroupContext,
    true
  );
});

test('Stage 2.6: Immutable content blocks, OOXML fragment preservation, and 5-layer Universal Lock', () => {
  const oxmlSample = '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>';
  const chemPayload = createImmutableContentPayload('2H₂ + O₂ → 2H₂O', 'chem-1', {
    defaultBlockKind: 'chemical',
    rawXmlFragments: [oxmlSample],
  });
  assert.equal(chemPayload.blocks[0].kind, 'chemical');
  assert.equal(chemPayload.blocks[0].rawXmlFragment, oxmlSample);
  assert.ok(chemPayload.blocks[0].checksum);

  const codeText = 'def calc(x):\n    return x * 2';
  const codePayload = createImmutableContentPayload(codeText, 'code-1', {
    defaultBlockKind: 'code',
    preserveExactWhitespace: true,
  });
  assert.equal(codePayload.blocks[0].content, codeText);
  assert.equal(codePayload.blocks[0].preserveExactWhitespace, true);

  const fillBlankQ: MathQuestion = {
    id: 'eng-cloze-01',
    code: 'ENG-CLOZE-01',
    sectionTitle: 'Section II. Cloze Test',
    type: 'short-answer',
    universalType: 'fill-blank',
    subjectId: 'tieng-anh',
    topic: 'Cloze Test',
    cognitiveLevel: 'thong-hieu',
    difficultyScore: 2,
    points: 1,
    stem: createImmutableContentPayload('She has lived in Hanoi {{1}} 2018 and works {{2}} a teacher.'),
    fillBlank: {
      slots: [
        { id: 'slot-1', slotNumber: 1, placeholderToken: '{{1}}', acceptedAnswers: ['since'], lockOrder: true },
        { id: 'slot-2', slotNumber: 2, placeholderToken: '{{2}}', acceptedAnswers: ['as'], lockOrder: true },
      ],
      allowShuffleWordBank: true,
    },
    solutionGuide: createImmutableContentPayload('1. since | 2. as'),
    lockQuestionPosition: false,
    lockOptionShuffle: true,
    allowStatementShuffle: false,
    dependencyFlags: [],
    hasVisualAsset: false,
    answerConfirmed: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(getUniversalQuestionType(fillBlankQ), 'fill-blank');
  const uLock = buildUniversalLockState(fillBlankQ, getSubjectProfile('tieng-anh'));
  assert.equal(uLock.contentLocked, true);
  assert.equal(uLock.optionShuffleLock, true);

  const snap = captureQuestionOriginalSnapshot({
    ...fillBlankQ,
    stem: chemPayload,
  });
  assert.deepEqual(snap.rawXmlFragments, [oxmlSample]);
  assert.ok(snap.rawContentChecksum.length > 0);
});

test('Stage 2.7: Backward compatibility — existing Math Exam & IndexedDB v4 normalization stay 100% intact', () => {
  // 1. Giả lập đề Toán legacy không có subjectId, schemaVersion, universalType, universalLock
  const legacyExamRaw = structuredClone(DEMO_MATH_EXAM) as unknown as Record<string, unknown>;
  delete legacyExamRaw.subjectId;
  delete legacyExamRaw.schemaVersion;

  const normalized = normalizeMathExamProject(legacyExamRaw as unknown as MathExamProject);
  assert.equal(normalized.subject, 'Toán học');
  assert.equal(normalized.subjectId, 'toan');
  assert.equal(normalized.schemaVersion, '5.0');
  assert.equal(normalized.questions.length, DEMO_MATH_EXAM.questions.length);

  for (let i = 0; i < DEMO_MATH_EXAM.questions.length; i++) {
    const origQ = DEMO_MATH_EXAM.questions[i];
    const normQ = normalized.questions[i];
    // Nội dung gốc tuyệt đối không đổi
    assert.equal(normQ.stem.rawSource, origQ.stem.rawSource);
    assert.equal(normQ.type, origQ.type);
    assert.equal(normQ.universalType, origQ.type);
    assert.equal(normQ.subjectId, 'toan');
    assert.equal(normQ.universalLock?.contentLocked, true);
    assert.equal(normQ.universalLock?.positionLock, origQ.lockQuestionPosition);
  }

  // 2. Engine trộn đề & kiểm tra toàn vẹn vẫn hoạt động trơn tru trên đề sau chuẩn hóa
  const preCheck = evaluatePreMixIntegrity(normalized);
  assert.equal(preCheck.canExport, true);

  const mixed = generateMixedExams(normalized);
  assert.equal(mixed.errors.length, 0);
  assert.equal(mixed.versions.length, normalized.mixConfig.examCount);
  assert.ok(mixed.versions.every((v) => v.integrityPassed));

  // 3. Dự án đa môn mới (ví dụ Hóa học) cũng chuẩn hóa & sao lưu khứ hồi trọn vẹn
  const chemExam: MathExamProject = {
    ...structuredClone(DEMO_MATH_EXAM),
    id: 'chem-exam-stage2-test',
    title: 'Đề kiểm tra Hóa học 12',
    subject: 'Hóa học',
    subjectId: 'hoa-hoc',
    schemaVersion: '6.0',
  };
  const normChem = normalizeMathExamProject(chemExam);
  assert.equal(normChem.subject, 'Hóa học');
  assert.equal(normChem.subjectId, 'hoa-hoc');
  assert.equal(normChem.schemaVersion, '6.0');
  assert.equal(normChem.questions[0].subjectId, 'hoa-hoc');

  const backup = createBackupPayload([], DEFAULT_PRINT_SETTINGS, {
    mathExams: [normalized, normChem],
  });
  const validated = validateBackupPayload(JSON.stringify(backup));
  assert.equal(validated.valid, true);
  assert.equal(validated.payload?.mathExams?.length, 2);
  assert.equal(validated.payload?.mathExams?.[1].subjectId, 'hoa-hoc');
});
