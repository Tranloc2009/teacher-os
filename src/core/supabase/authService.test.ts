import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Session } from '@supabase/supabase-js';
import { subscribeCloudAuthState } from './authService';
import { getSupabaseClient, resetSupabaseClientCache } from './client';
import { evaluateSupabaseEnv } from './config';

test('auth subscription ignores stale hydration after sign-out and after unsubscribe', async (t) => {
  const config = evaluateSupabaseEnv({
    VITE_SUPABASE_URL: 'https://teacheros-auth-test.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teacheros_test_key',
  });
  const client = getSupabaseClient(config)!;
  let callback: (event: string, session: Session | null) => void;
  let release: (value: unknown) => void;
  const pending = new Promise((resolve) => { release = resolve; });
  let queries = 0;
  let unsubscribed = false;
  t.mock.method(client.auth, 'onAuthStateChange', ((handler: typeof callback) => {
    callback = handler;
    return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } };
  }) as typeof client.auth.onAuthStateChange);
  t.mock.method(client, 'from', (() => {
    queries++;
    // profiles adds maybeSingle after eq.
    return { select: () => ({ eq: () => Object.assign(pending, { maybeSingle: () => pending }) }) };
  }) as unknown as typeof client.from);
  const seen: unknown[] = [];
  try {
    const unsubscribe = subscribeCloudAuthState((user) => seen.push(user), client);
    callback!('SIGNED_IN', { user: { id: 'test-user', email: 'test@example.com' } } as Session);
    assert.equal(queries, 0);
    await delay(10);
    assert.equal(queries, 2);
    callback!('SIGNED_OUT', null);
    await delay(10);
    assert.deepEqual(seen, [null]);
    release!({ data: [], error: null });
    await delay(10);
    assert.deepEqual(seen, [null]);
    callback!('SIGNED_OUT', null);
    unsubscribe();
    await delay(10);
    assert.deepEqual(seen, [null]);
    assert.equal(unsubscribed, true);
  } finally {
    resetSupabaseClientCache();
  }
});
