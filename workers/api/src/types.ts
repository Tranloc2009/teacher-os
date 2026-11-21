export type AppRole = 'admin' | 'teacher' | 'student';

export interface WorkerEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  MUTATION_RATE_LIMIT_MAX?: string;
  MUTATION_RATE_LIMIT_WINDOW_SEC?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: AppRole[];
  primaryRole: AppRole;
  verifiedVia: 'jwks' | 'auth-api';
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: string[];
  };
}

export type RateLimitScope = 'isolate-best-effort' | 'global-db-backed';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  scope: RateLimitScope;
}

export interface ExecutionContextLike {
  waitUntil?(promise: Promise<unknown>): void;
}

export interface WorkerDependencies {
  fetchImpl?: typeof fetch;
  now?: () => number;
}
