const BASE = import.meta.env.VITE_API_URL ?? '';

/**
 * The access token lives in memory only — never localStorage, which any
 * XSS payload can read. It is lost on page refresh and recovered from the
 * httpOnly refresh cookie by calling /auth/refresh on app start.
 */
let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  // Collapse concurrent refreshes: several 401s at once must not each
  // rotate the refresh token, which would trip reuse detection.
  if (!refreshing) {
    refreshing = fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        accessToken = data.accessToken ?? null;
        return accessToken;
      })
      .catch(() => null)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const call = (token: string | null) =>
    fetch(`${BASE}/api${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

  let res = await call(accessToken);

  if (res.status === 401 && accessToken !== null) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await call(fresh);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/* ------------------------------ auth ------------------------------ */

export interface SessionUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  employeeId: string | null;
  mustChangePassword: boolean;
}

export async function login(email: string, password: string) {
  const data = await api<{ accessToken: string; user: SessionUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(data.accessToken);
  return data.user;
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  setAccessToken(null);
}

/** Called once on app start to recover a session from the refresh cookie. */
export async function restoreSession(): Promise<SessionUser | null> {
  const token = await refreshAccessToken();
  if (!token) return null;
  try {
    return await api<SessionUser>('/auth/me');
  } catch {
    return null;
  }
}

export const changePassword = (currentPassword: string, newPassword: string) =>
  api<{ ok: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

/* ---------------------------- employees --------------------------- */

export interface FileCompleteness {
  totals: Record<string, number>;
  held: Record<string, number>;
  applicable: number;
}

export interface Employee {
  id: string;
  staffId: string;
  firstName: string;
  lastName: string;
  status: string;
  employmentType: string;
  department: { id: string; name: string } | null;
  jobTitle: { id: string; name: string } | null;
  gradeLevel: { id: string; code: string } | null;
  currentGross: string | null;
  fileCompleteness: FileCompleteness;
}

export const listEmployees = (search = '') =>
  api<Employee[]>(`/employees${search ? `?search=${encodeURIComponent(search)}` : ''}`);
