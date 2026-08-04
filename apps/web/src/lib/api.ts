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
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string>,
  ) {
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
    throw new ApiError(
      body.message ?? `Request failed (${res.status})`,
      res.status,
      body.fieldErrors,
    );
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
  hasPhoto?: boolean;
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

export interface EmployeeDocument {
  id: string;
  documentTypeId: string;
  onFile: boolean;
  remarks: string | null;
  checkedAt: string | null;
  documentType: { id: string; code: string; name: string; category: string; sortOrder: number };
}

export interface EmployeeDetail extends Employee {
  middleName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  nationality: string | null;
  stateOfOrigin: string | null;
  localGovernmentArea: string | null;
  residentialAddress: string | null;
  phoneNumber: string | null;
  personalEmail: string | null;
  dateOfEmployment: string | null;
  dateOfAssumption: string | null;
  placeOfAssumption: string | null;
  supervisorId: string | null;
  supervisor: { id: string; firstName: string; lastName: string; staffId: string } | null;
  departmentId: string | null;
  jobTitleId: string | null;
  gradeLevelId: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  pensionFundAdministrator: string | null;
  rsaPin: string | null;
  taxIdentificationNumber: string | null;
  nhfNumber: string | null;
  nhfEnrolled: boolean;
  annualRentPaid: string | null;
  payrollRemarks: string | null;
  nextOfKinName: string | null;
  nextOfKinRelationship: string | null;
  nextOfKinPhone: string | null;
  nextOfKinAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
  emergencyContactAddress: string | null;
  documents: EmployeeDocument[];
}

export interface FormOptions {
  departments: { id: string; code: string; name: string }[];
  jobTitles: { id: string; name: string }[];
  gradeLevels: { id: string; code: string; name: string; rank: number }[];
  supervisors: { id: string; firstName: string; lastName: string; staffId: string }[];
  banks: { id: string; name: string }[];
  structures: { id: string; code: string; name: string }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export const getEmployee = (id: string) => api<EmployeeDetail>(`/employees/${id}`);
export const getFormOptions = () => api<FormOptions>('/employees/options');
export const getHistory = (id: string) => api<AuditEntry[]>(`/employees/${id}/history`);

export const createEmployee = (data: Record<string, unknown>) =>
  api<{ id: string }>('/employees', { method: 'POST', body: JSON.stringify(data) });

export const updateEmployee = (id: string, data: Record<string, unknown>) =>
  api<{ id: string }>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
/* --------------------------- photographs -------------------------- */

/**
 * Photos sit behind the auth guard, so they cannot be used as a plain
 * <img src>. Fetched as a blob and turned into an object URL instead.
 * Callers must revoke the URL when the component unmounts.
 */
export async function fetchPhoto(employeeId: string): Promise<string | null> {
  const send = (token: string | null) =>
    fetch(`${BASE}/api/employees/${employeeId}/photo`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  let res = await send(getAccessToken());
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
  }
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

export async function uploadPhoto(employeeId: string, file: File) {
  const form = new FormData();
  form.append('file', file);

  const send = (token: string | null) =>
    fetch(`${BASE}/api/employees/${employeeId}/photo`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });

  let res = await send(getAccessToken());
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? 'Upload failed.', res.status);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export const removePhoto = (employeeId: string) =>
  api<{ ok: boolean }>(`/employees/${employeeId}/photo`, { method: 'DELETE' });

/* ------------------------- document types ------------------------- */

export interface DocumentType {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string | null;
  required: boolean;
  allowMultiple: boolean;
  isActive: boolean;
  sortOrder: number;
  _count?: { documents: number };
}

export interface StoredFile {
  id: string;
  originalName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedAt: string;
  remarks: string | null;
}

export interface FileSection {
  type: DocumentType;
  files: StoredFile[];
}

export const listDocumentTypes = (includeInactive = false) =>
  api<DocumentType[]>(`/document-types${includeInactive ? '?includeInactive=true' : ''}`);

export const createDocumentType = (data: Record<string, unknown>) =>
  api<DocumentType>('/document-types', { method: 'POST', body: JSON.stringify(data) });

export const updateDocumentType = (id: string, data: Record<string, unknown>) =>
  api<DocumentType>(`/document-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteDocumentType = (id: string) =>
  api<{ ok: boolean }>(`/document-types/${id}`, { method: 'DELETE' });

/* --------------------------- employee file ------------------------ */

export const getEmployeeFile = (employeeId: string) =>
  api<FileSection[]>(`/employees/${employeeId}/file`);

/**
 * Uploads use FormData, so Content-Type must be left unset — the browser
 * has to add its own multipart boundary. That means this cannot go through
 * api(), which always sets application/json.
 */
export async function uploadDocument(
  employeeId: string,
  documentTypeId: string,
  file: File,
  remarks?: string,
): Promise<{ id: string; originalName: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('documentTypeId', documentTypeId);
  if (remarks) form.append('remarks', remarks);

  const send = (token: string | null) =>
    fetch(`${BASE}/api/employees/${employeeId}/file`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });

  let res = await send(getAccessToken());
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Upload failed (${res.status})`, res.status, body.fieldErrors);
  }
  return res.json();
}

export const deleteDocument = (documentId: string) =>
  api<{ ok: boolean }>(`/documents/${documentId}`, { method: 'DELETE' });

/** Downloads need the bearer token, so fetch as a blob rather than linking. */
export async function downloadDocument(documentId: string, filename: string) {
  const send = (token: string | null) =>
    fetch(`${BASE}/api/documents/${documentId}/download`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  let res = await send(getAccessToken());
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
  }
  if (!res.ok) throw new ApiError('Could not download the file.', res.status);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 400 responses carry per-field messages from Zod. */
export interface FieldErrorResponse { fieldErrors?: Record<string, string> }


/* ------------------------ org reference data ---------------------- */

export interface Department {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  _count?: { employees: number };
}

export interface JobTitle {
  id: string;
  name: string;
  isActive: boolean;
  _count?: { employees: number };
}

export interface GradeLevel {
  id: string;
  code: string;
  name: string;
  rank: number;
  defaultGross: string | null;
  isActive: boolean;
  _count?: { employees: number };
}

const q = (includeInactive: boolean) => (includeInactive ? '?includeInactive=true' : '');

export const listDepartments = (inactive = false) =>
  api<Department[]>(`/departments${q(inactive)}`);
export const createDepartment = (data: Record<string, unknown>) =>
  api<Department>('/departments', { method: 'POST', body: JSON.stringify(data) });
export const updateDepartmentApi = (id: string, data: Record<string, unknown>) =>
  api<Department>(`/departments/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteDepartment = (id: string) =>
  api<{ ok: boolean }>(`/departments/${id}`, { method: 'DELETE' });

export const listJobTitles = (inactive = false) =>
  api<JobTitle[]>(`/job-titles${q(inactive)}`);
export const createJobTitle = (data: Record<string, unknown>) =>
  api<JobTitle>('/job-titles', { method: 'POST', body: JSON.stringify(data) });
export const updateJobTitleApi = (id: string, data: Record<string, unknown>) =>
  api<JobTitle>(`/job-titles/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteJobTitle = (id: string) =>
  api<{ ok: boolean }>(`/job-titles/${id}`, { method: 'DELETE' });

export const listGradeLevels = (inactive = false) =>
  api<GradeLevel[]>(`/grade-levels${q(inactive)}`);
export const createGradeLevel = (data: Record<string, unknown>) =>
  api<GradeLevel>('/grade-levels', { method: 'POST', body: JSON.stringify(data) });
export const updateGradeLevelApi = (id: string, data: Record<string, unknown>) =>
  api<GradeLevel>(`/grade-levels/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteGradeLevel = (id: string) =>
  api<{ ok: boolean }>(`/grade-levels/${id}`, { method: 'DELETE' });

/* --------------------------- compensation ------------------------- */

export interface Compensation {
  id: string;
  totalPackage: string;
  monthlyGross: string;
  peculiarAllowance: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  structure: { id: string; code: string; name: string };
}

export const getCompensation = (employeeId: string) =>
  api<Compensation[]>(`/employees/${employeeId}/compensation`);

export const addCompensation = (employeeId: string, data: Record<string, unknown>) =>
  api<Compensation>(`/employees/${employeeId}/compensation`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
