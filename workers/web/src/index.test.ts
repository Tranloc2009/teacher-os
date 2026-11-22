import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from './index.ts';

const videoPath = '/media/teacheros-intro.mp4';
const video = await readFile(new URL('../../../public' + videoPath, import.meta.url));
const html = '<!doctype html><title>TeacherOS</title>';
const env = {
  ASSETS: {
    async fetch(request: Request) {
      assert.equal(request.headers.get('Range'), null);
      if (new URL(request.url).pathname !== videoPath) {
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      }
      return new Response(request.method === 'HEAD' ? null : Uint8Array.from(video), {
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length), ETag: '"video"' },
      });
    },
  },
};
function request(path: string, headers?: HeadersInit, method = 'GET') {
  return worker.fetch(new Request('https://teacheros.test' + path, { headers, method }), env);
}

test('serves a real MP4 and serves exactly the requested bytes', async () => {
  const full = await request(videoPath);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('Content-Type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), video);
  for (const [range, start, end] of [
    ['bytes=0-1023', 0, 1023],
    ['bytes=1024-', 1024, video.length - 1],
    ['bytes=-128', video.length - 128, video.length - 1],
    ['bytes=0-999999999999999999999', 0, video.length - 1],
  ] as const) {
    const partial = await request(videoPath, { Range: range });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('Content-Range'), 'bytes ' + start + '-' + end + '/' + video.length);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), video.subarray(start, end + 1));
  }
});

test('returns 416 for invalid or unsatisfiable ranges and respects If-Range and HEAD', async () => {
  for (const invalid of ['bytes=9-3', 'bytes=-0', 'bytes=99999999999999999-', 'bytes=-']) {
    const response = await request(videoPath, { Range: invalid });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('Content-Range'), 'bytes */' + video.length);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  const changed = await request(videoPath, { Range: 'bytes=0-2', 'If-Range': '"old"' });
  assert.equal(changed.status, 200);
  assert.deepEqual(Buffer.from(await changed.arrayBuffer()), video);
  const head = await request(videoPath, { Range: 'bytes=0-2' }, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('rejects HTML fallbacks on media paths while forwarding navigation routes', async () => {
  assert.equal((await request('/media/missing.mp4')).status, 404);
  assert.equal((await request('/media/teacheros-intro-poster.jpg')).status, 404);
  const route = await request('/exam-mixer');
  assert.equal(route.status, 200);
  assert.equal(await route.text(), html);
});
