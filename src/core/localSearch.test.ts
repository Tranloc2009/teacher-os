import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_REGISTRY, getAppById, getDockApps } from './appRegistry.ts';
import {
  normalizeVietnameseSearchText,
  searchWorkspaceLocally,
} from './localSearch.ts';
import { DEFAULT_JOURNALS, DEFAULT_RESOURCES } from './workspaceModules.ts';
import type { LessonPack } from '../types/lesson.ts';

function makePack(overrides: Partial<LessonPack> = {}): LessonPack {
  const now = '2026-04-01T08:00:00.000Z';
  return {
    id: 'pack-test-1',
    title: 'Dao động điều hòa và con lắc lò xo',
    subject: 'Vật lí',
    grade: 'Lớp 12',
    duration: 45,
    objectives: ['Nêu được phương trình dao động điều hòa.'],
    activities: [
      {
        id: 'act-1',
        templateId: null,
        title: 'Khởi động quan sát con lắc',
        durationMinutes: 10,
        grouping: 'Cả lớp',
        instructions: 'Quan sát dao động.',
        studentTask: 'Ghi nhận chu kỳ.',
        teacherNote: '',
      },
    ],
    questions: [
      {
        id: 'q-1',
        code: 'CB-01',
        tier: 'basic',
        prompt: 'Viết biểu thức li độ x theo thời gian t.',
        answerGuide: 'x = A cos(wt + phi)',
        points: 2,
      },
      {
        id: 'q-2',
        code: 'VD-01',
        tier: 'applied',
        prompt: 'Tính chu kỳ dao động khi biết k và m.',
        answerGuide: 'T = 2pi sqrt(m/k)',
        points: 3,
      },
    ],
    distribution: { basic: 1, applied: 1, extended: 0 },
    rubric: [],
    status: 'draft',
    isDemo: false,
    lastStep: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('APP_REGISTRY exposes unique IDs, all 9 ready modules in TeacherOS 4.0, and pinned Dock apps', () => {
  const ids = APP_REGISTRY.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(APP_REGISTRY.length, 9);
  for (const app of APP_REGISTRY) {
    assert.equal(app.status, 'ready', `Expected ${app.id} to be ready`);
  }
  assert.equal(getAppById('workspace').status, 'ready');
  assert.equal(getAppById('resource-vault').status, 'ready');
  assert.equal(getAppById('workflow-center').status, 'ready');
  assert.equal(getAppById('teaching-journal').status, 'ready');
  assert.equal(getAppById('math-mixer').status, 'ready');
  assert.equal(getDockApps().some((a) => a.id === 'desktop'), true);
  assert.equal(getDockApps().some((a) => a.id === 'lesson-studio'), true);
  assert.equal(getDockApps().some((a) => a.id === 'math-mixer'), true);
});

test('normalizeVietnameseSearchText folds accents and đ cleanly', () => {
  assert.equal(
    normalizeVietnameseSearchText('Đạo hàm & Phương trình lượng giác'),
    'dao ham & phuong trinh luong giac'
  );
});

test('searchWorkspaceLocally finds apps, quick actions, LessonPacks, Resources, and Journals with scope filter', () => {
  const packs = [
    makePack(),
    makePack({
      id: 'pack-test-2',
      title: 'Phân tích tác phẩm Vợ nhặt',
      subject: 'Ngữ văn',
      grade: 'Lớp 12',
      isDemo: true,
    }),
  ];

  // Tìm theo tên bài không dấu
  const byNoAccent = searchWorkspaceLocally('dao dong dieu hoa', packs);
  assert.equal(byNoAccent.some((r) => r.kind === 'lesson-pack' && r.packId === 'pack-test-1'), true);
  assert.equal(byNoAccent.some((r) => r.packId === 'pack-test-2'), false);

  // Tìm theo mã câu hỏi bên trong LessonPack
  const byCode = searchWorkspaceLocally('CB-01', packs);
  assert.equal(byCode.some((r) => r.kind === 'lesson-pack' && r.packId === 'pack-test-1'), true);
  assert.equal(byCode.some((r) => r.kind === 'question' && r.packId === 'pack-test-1'), true);

  // Tìm học liệu trong Resource Vault
  const byResource = searchWorkspaceLocally('chuyen dong deu', packs, undefined, {
    resources: DEFAULT_RESOURCES,
    journals: DEFAULT_JOURNALS,
    scope: 'resource-journal',
  });
  assert.equal(byResource.length > 0, true);
  assert.equal(byResource.some((r) => r.kind === 'resource'), true);

  // Tìm nhật ký giảng dạy trong Teaching Journal
  const byJournal = searchWorkspaceLocally('dieu kien cua an', packs, undefined, {
    resources: DEFAULT_RESOURCES,
    journals: DEFAULT_JOURNALS,
    scope: 'resource-journal',
  });
  assert.equal(byJournal.length > 0, true);
  assert.equal(byJournal.some((r) => r.kind === 'journal'), true);
});
