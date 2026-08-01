const BASE = import.meta.env.VITE_API_URL ?? '';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

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
