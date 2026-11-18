import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBackupPayload,
  DEFAULT_PRINT_SETTINGS,
  validateBackupPayload,
} from './backup';
import { DEMO_LESSON_PACKS } from '../data/demoPacks';

test('createBackupPayload và validateBackupPayload khứ hồi hợp lệ với dữ liệu tiếng Việt (F03 + F04)', () => {
  const payload = createBackupPayload(DEMO_LESSON_PACKS, DEFAULT_PRINT_SETTINGS);
  const serialized = JSON.stringify(payload);
  const result = validateBackupPayload(serialized);

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.ok(result.payload);
  assert.equal(result.payload.lessonPacks.length, DEMO_LESSON_PACKS.length);
  assert.equal(result.payload.lessonPacks[0].worksheetVariants?.length, 3);
  assert.equal(result.payload.lessonPacks[0].rubric.length, 3);
  assert.equal(result.payload.settings.paperSize, 'A4');
});

test('validateBackupPayload từ chối chuỗi JSON hỏng', () => {
  const result = validateBackupPayload('{invalid-json');
  assert.equal(result.valid, false);
  assert.equal(result.payload, null);
  assert.ok(result.errors[0].includes('JSON'));
});

test('validateBackupPayload từ chối sai schemaVersion hoặc thiếu trường app', () => {
  const badPayload = {
    app: 'OtherApp',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: DEFAULT_PRINT_SETTINGS,
    lessonPacks: [],
  };
  const result = validateBackupPayload(JSON.stringify(badPayload));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('TeacherOS')));
  assert.ok(result.errors.some((e) => e.includes('schemaVersion')));
});

test('validateBackupPayload từ chối bộ tiết có thời lượng không hợp lệ hoặc trùng id', () => {
  const cloned = structuredClone(DEMO_LESSON_PACKS);
  cloned[1].id = cloned[0].id;
  // @ts-expect-error Kiểm thử giá trị sai schema từ file ngoài
  cloned[0].duration = 60;

  const payload = createBackupPayload(cloned, DEFAULT_PRINT_SETTINGS);
  const result = validateBackupPayload(JSON.stringify(payload));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('45 hoặc 90')));
  assert.ok(result.errors.some((e) => e.includes('trùng mã định danh')));
});

test('validateBackupPayload từ chối rubric sai cấu trúc 3 mức đạt', () => {
  const cloned = structuredClone(DEMO_LESSON_PACKS);
  // @ts-expect-error Kiểm thử dữ liệu thiếu trường 3 mức đạt
  delete cloned[0].rubric[0].levels.meets;

  const payload = createBackupPayload(cloned, DEFAULT_PRINT_SETTINGS);
  const result = validateBackupPayload(JSON.stringify(payload));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('needsSupport, meets, exceeds')));
});

test('validateBackupPayload từ chối lề in ngoài khoảng cho phép (5–40mm)', () => {
  const badSettings = {
    ...DEFAULT_PRINT_SETTINGS,
    marginsMm: { top: 2, right: 15, bottom: 15, left: 60 },
  };
  const payload = createBackupPayload([], badSettings);
  const result = validateBackupPayload(JSON.stringify(payload));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('5mm đến 40mm')));
});
