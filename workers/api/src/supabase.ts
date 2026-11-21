export function getSupabaseOrigin(rawUrl: string | undefined): string | null {
  try {
    const url = new URL(rawUrl?.trim() ?? '');
    const localHttp = url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    return url.protocol === 'https:' || localHttp ? url.origin : null;
  } catch {
    return null;
  }
}

export function serviceAuthHeaders(secretKey: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: secretKey };
  if (!secretKey.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${secretKey}`;
  }
  return headers;
}
