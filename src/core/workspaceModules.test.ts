import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_LESSON_PACKS } from '../data/demoPacks';
import { DEFAULT_PRINT_SETTINGS } from '../utils/backup';
import {
  DEFAULT_JOURNALS,
  DEFAULT_RESOURCES,
  applyJournalAdjustmentToPack,
  createHandoverKitPayload,
  createLessonVariant,
  insertResourceIntoPack,
  inspectLessonPack,
} from './workspaceModules';

test('inspectLessonPack evaluates demo pack completeness accurately', () => {
  const demoPack = DEMO_LESSON_PACKS[0];
  const report = inspectLessonPack(demoPack, DEFAULT_RESOURCES, DEFAULT_JOURNALS);
  assert.equal(report.packId, demoPack.id);
  assert.equal(report.totalChecks, 4);
  assert.equal(report.passedChecks, 4);
  assert.equal(report.readinessPercent, 100);
  assert.equal(report.hasWorksheetShortfall, false);
  assert.ok(report.linkedResourcesCount >= 1);
  assert.equal(report.linkedJournalsCount, 1);
});

test('createLessonVariant toggles duration 45 <-> 90 and clamps activity minutes to 5..15', () => {
  const demoPack = DEMO_LESSON_PACKS[0];
  let seq = 0;
  const variant90 = createLessonVariant(
    demoPack,
    'toggle-duration',
    (prefix = 'id') => `${prefix}-${++seq}`
  );
  assert.equal(variant90.duration, 90);
  assert.equal(variant90.isDemo, false);
  assert.equal(variant90.status, 'draft');
  assert.ok(variant90.title.includes('Biến thể 90 phút'));
  for (const act of variant90.activities) {
    assert.ok(act.durationMinutes >= 5 && act.durationMinutes <= 15);
  }
});

test('insertResourceIntoPack inserts question-template with auto-generated code or activity-idea', () => {
  const demoPack = DEMO_LESSON_PACKS[0];
  const questionRes = DEFAULT_RESOURCES[0]; // applied question
  const { updatedPack: packWithQ, summary: qSummary } = insertResourceIntoPack(
    demoPack,
    questionRes,
    (p = 'id') => `${p}-new`
  );
  assert.equal(packWithQ.questions.length, demoPack.questions.length + 1);
  const addedQ = packWithQ.questions[packWithQ.questions.length - 1];
  assert.ok(addedQ.code.startsWith('VD-'));
  assert.ok(qSummary.includes(addedQ.code));

  const actRes = DEFAULT_RESOURCES[1]; // activity-idea
  const { updatedPack: packWithAct } = insertResourceIntoPack(
    demoPack,
    actRes,
    (p = 'id') => `${p}-act`
  );
  assert.equal(packWithAct.activities.length, demoPack.activities.length + 1);
});

test('applyJournalAdjustmentToPack appends reflection note to first activity teacherNote idempotently', () => {
  const demoPack = DEMO_LESSON_PACKS[0];
  const journal = DEFAULT_JOURNALS[0];
  const updatedOnce = applyJournalAdjustmentToPack(demoPack, journal);
  assert.ok(
    updatedOnce.activities[0].teacherNote.includes(journal.nextAdjustment)
  );
  const updatedTwice = applyJournalAdjustmentToPack(updatedOnce, journal);
  assert.equal(
    updatedTwice.activities[0].teacherNote,
    updatedOnce.activities[0].teacherNote
  );
});

test('createHandoverKitPayload packages lesson pack, print settings, resources, and journals', () => {
  const demoPack = DEMO_LESSON_PACKS[0];
  const kit = createHandoverKitPayload(
    demoPack,
    DEFAULT_PRINT_SETTINGS,
    DEFAULT_RESOURCES,
    DEFAULT_JOURNALS
  );
  assert.equal(kit.app, 'TeacherOS-HandoverKit');
  assert.equal(kit.lessonPack.id, demoPack.id);
  assert.ok(kit.linkedResources.length >= 1);
  assert.equal(kit.teachingJournals.length, 1);
});
