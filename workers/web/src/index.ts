type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

const VIDEO = '/media/teacheros-intro.mp4';
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  [VIDEO]: 'video/mp4',
  '/media/teacheros-intro-poster.jpg': 'image/jpeg',
};

function parseRange(value: string, size: number): [start: number, end: number] | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const length = BigInt(size);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (suffix === 0n) return null;
    return [Number(suffix >= length ? 0n : length - suffix), size - 1];
  }
  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : length - 1n;
  if (start >= length || end < start) return null;
  return [Number(start), Number(end >= length ? length - 1n : end)];
}

function matchesIfRange(value: string | null, headers: Headers): boolean {
  if (value === null) return true;
  if (value.startsWith('"')) return value === headers.get('ETag');
  return value === headers.get('Last-Modified');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith('/media/')) return env.ASSETS.fetch(request);
    if (!Object.hasOwn(MEDIA_TYPES, pathname)) return new Response('Media not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete('Range');
    requestHeaders.delete('If-Range');
    // Get the canonical representation from Static Assets and slice its bytes ourselves.
    const asset = await env.ASSETS.fetch(new Request(request, { headers: requestHeaders }));
    if (asset.status === 304) return asset;
    const expectedType = MEDIA_TYPES[pathname];
    if (!asset.ok || asset.headers.get('Content-Type')?.split(';', 1)[0].trim() !== expectedType) {
      await asset.body?.cancel();
      return new Response('Media not found', { status: 404 });
    }

    const headers = new Headers(asset.headers);
    headers.set('Content-Type', expectedType);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    if (pathname === VIDEO) headers.set('Accept-Ranges', 'bytes');

    const range = pathname === VIDEO && request.method === 'GET' ? request.headers.get('Range') : null;
    if (range === null || !matchesIfRange(request.headers.get('If-Range'), headers)) {
      return new Response(asset.body, { status: 200, headers });
    }

    // The only ranged asset is the small, versioned introduction video bundled with this Worker.
    const bytes = await asset.arrayBuffer();
    headers.delete('Content-Encoding');
    const bounds = parseRange(range, bytes.byteLength);
    if (!bounds) {
      headers.set('Content-Range', 'bytes */' + bytes.byteLength);
      headers.set('Content-Length', '0');
      headers.set('Cache-Control', 'no-store');
      return new Response(null, { status: 416, headers });
    }
    const [start, end] = bounds;
    headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + bytes.byteLength);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(bytes.slice(start, end + 1), { status: 206, headers });
  },
};
