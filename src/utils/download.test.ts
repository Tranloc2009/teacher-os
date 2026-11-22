import assert from 'node:assert/strict';
import test from 'node:test';
import { triggerBlobDownload } from './download.ts';

test('download attaches the link and delays URL cleanup, including when click fails', (t) => {
  const events: string[] = [];
  let cleanup: (() => void) | undefined;
  let failClick = false;
  const link = {
    href: '', download: '',
    click() {
      events.push('click');
      if (failClick) throw new Error('download failed');
    },
    remove() { events.push('remove'); },
  };
  t.mock.method(URL, 'createObjectURL', () => 'blob:test');
  t.mock.method(URL, 'revokeObjectURL', (url: string) => {
    assert.equal(url, 'blob:test');
    events.push('revoke');
  });
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void, delay: number) => {
    assert.equal(delay, 1000);
    cleanup = callback;
    return 1;
  }) as typeof setTimeout);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => link,
      body: { appendChild() { events.push('append'); } },
    },
  });
  try {
    triggerBlobDownload(new Blob(['test']), 'exam.docx');
    assert.equal(link.download, 'exam.docx');
    assert.equal(link.href, 'blob:test');
    assert.deepEqual(events, ['append', 'click', 'remove']);
    cleanup!();
    assert.equal(events.at(-1), 'revoke');
    events.length = 0;
    failClick = true;
    assert.throws(() => triggerBlobDownload(new Blob(), 'exam.docx'), /download failed/);
    assert.deepEqual(events, ['append', 'click', 'remove']);
    cleanup!();
    assert.equal(events.at(-1), 'revoke');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
