import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from './client';

export type CloudUserRole = 'admin' | 'teacher' | 'student';

export interface CloudAuthUserState {
  id: string;
  email: string;
  fullName: string;
  roles: CloudUserRole[];
  primaryRole: CloudUserRole;
  rolesVerifiedFromDb: boolean;
}

export interface CloudAuthActionResult {
  ok: boolean;
  user?: CloudAuthUserState | null;
  message: string;
  requiresEmailConfirmation?: boolean;
}

const VALID_ROLES = new Set<CloudUserRole>(['admin', 'teacher', 'student']);

function resolvePrimaryRole(roles: CloudUserRole[]): CloudUserRole {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('teacher')) return 'teacher';
  return 'student';
}

/**
 * Hydrates user identity and authoritative roles strictly from public.user_roles
 * via RLS. NEVER reads role from user_metadata.
 */
async function hydrateSessionUser(
  session: Session | null
): Promise<CloudAuthUserState | null> {
  if (!session?.user) return null;

  const client = getSupabaseClient();
  if (!client) return null;

  let roles: CloudUserRole[] = ['student'];
  let rolesVerifiedFromDb = false;
  let fullName = '';

  try {
    const [{ data: roleRows, error: roleError }, { data: profileRow }] =
      await Promise.all([
        client
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id),
        client
          .from('profiles')
          .select('full_name')
          .eq('id', session.user.id)
          .maybeSingle(),
      ]);

    if (!roleError && Array.isArray(roleRows)) {
      const parsed = roleRows
        .map((row) => (row as { role?: unknown }).role)
        .filter(
          (role): role is CloudUserRole =>
            typeof role === 'string' && VALID_ROLES.has(role as CloudUserRole)
        );
      if (parsed.length > 0) {
        roles = Array.from(new Set(parsed));
      }
      rolesVerifiedFromDb = true;
    }

    if (profileRow && typeof (profileRow as { full_name?: unknown }).full_name === 'string') {
      fullName = (profileRow as { full_name: string }).full_name;
    }
  } catch {
    // Keep least-privileged default ('student') if RLS tables are not migrated yet
  }

  return {
    id: session.user.id,
    email: session.user.email ?? '',
    fullName,
    roles,
    primaryRole: resolvePrimaryRole(roles),
    rolesVerifiedFromDb,
  };
}

export async function getCurrentCloudUser(): Promise<CloudAuthUserState | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.auth.getSession();
  if (error || !data.session) return null;
  return hydrateSessionUser(data.session);
}

export async function signInWithEmailPassword(
  email: string,
  password: string
): Promise<CloudAuthActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      message:
        'Chưa cấu hình Supabase Free (VITE_SUPABASE_URL & VITE_SUPABASE_PUBLISHABLE_KEY).',
    };
  }

  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    return {
      ok: false,
      message: 'Vui lòng nhập đầy đủ email và mật khẩu.',
    };
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error) {
    return {
      ok: false,
      message: error.message || 'Đăng nhập thất bại. Vui lòng kiểm tra thông tin.',
    };
  }

  const user = await hydrateSessionUser(data.session);
  return {
    ok: true,
    user,
    message: 'Đăng nhập Supabase Auth thành công.',
  };
}

/**
 * Public self-signup creates a standard student account ONLY.
 * Database trigger on auth.users strictly assigns 'student' role in public.user_roles.
 */
export async function signUpStudentAccount(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<CloudAuthActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      message:
        'Chưa cấu hình Supabase Free (VITE_SUPABASE_URL & VITE_SUPABASE_PUBLISHABLE_KEY).',
    };
  }

  const email = input.email.trim();
  const fullName = input.fullName.trim();
  if (!email || input.password.length < 8) {
    return {
      ok: false,
      message: 'Vui lòng nhập email hợp lệ và mật khẩu từ 8 ký tự trở lên.',
    };
  }

  const { data, error } = await client.auth.signUp({
    email,
    password: input.password,
    options: {
      data: {
        // Only display name is passed; NEVER pass or trust role in user_metadata
        full_name: fullName,
      },
    },
  });

  if (error) {
    return {
      ok: false,
      message: error.message || 'Không thể đăng ký tài khoản học sinh.',
    };
  }

  if (!data.session) {
    return {
      ok: true,
      user: null,
      requiresEmailConfirmation: true,
      message:
        'Đăng ký thành công. Vui lòng kiểm tra hộp thư để xác nhận email trước khi đăng nhập.',
    };
  }

  const user = await hydrateSessionUser(data.session);
  return {
    ok: true,
    user,
    message: 'Tạo tài khoản học sinh và đăng nhập thành công.',
  };
}

export async function signOutCloudUser(): Promise<CloudAuthActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: true, user: null, message: 'Đã đăng xuất.' };
  }

  const { error } = await client.auth.signOut();
  if (error) {
    return {
      ok: false,
      message: error.message || 'Không thể đăng xuất lúc này.',
    };
  }

  return {
    ok: true,
    user: null,
    message: 'Đã đăng xuất khỏi phiên Supabase Auth.',
  };
}

export function subscribeCloudAuthState(
  onChange: (user: CloudAuthUserState | null) => void
): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    void hydrateSessionUser(session).then(onChange);
  });

  return () => {
    data.subscription.unsubscribe();
  };
}
