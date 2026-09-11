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

  /* ------------------------------ users ----------------------------- */

export interface SystemUser {
  id: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: { id: string; code: string; name: string }[];
  employee: { id: string; staffId: string; firstName: string; lastName: string } | null;
}

export interface UserOptions {
  roles: { id: string; code: string; name: string; permissions: string[] }[];
  employees: { id: string; staffId: string; firstName: string; lastName: string }[];
}

export const listUsers = () => api<SystemUser[]>('/users');
export const getUserOptions = () => api<UserOptions>('/users/options');

export const createUser = (data: {
  email: string; roleIds: string[]; employeeId?: string;
}) =>
  api<{ id: string; email: string; temporaryPassword: string }>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const setUserRoles = (id: string, roleIds: string[]) =>
  api<{ ok: boolean }>(`/users/${id}/roles`, {
    method: 'PATCH',
    body: JSON.stringify({ roleIds }),
  });

export const setUserActive = (id: string, isActive: boolean) =>
  api<{ ok: boolean }>(`/users/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });

export const setUserEmployee = (id: string, employeeId: string | null) =>
  api<{ ok: boolean }>(`/users/${id}/employee`, {
    method: 'PATCH',
    body: JSON.stringify({ employeeId }),
  });

export const resetUserPassword = (id: string) =>
  api<{ temporaryPassword: string }>(`/users/${id}/reset-password`, { method: 'POST' });
/* ---------------------------- attendance -------------------------- */

export type AttendanceStatus =
  | 'PRESENT' | 'REMOTE' | 'LATE' | 'HALF_DAY'
  | 'ABSENT' | 'ON_LEAVE' | 'PUBLIC_HOLIDAY' | 'WEEKEND' | 'SUSPENDED';

export interface AttendancePolicy {
  workingDays: number[];
  workStart: string;
  workEnd: string;
  lateGraceMinutes: number;
  deductionBasis: 'WORKING_DAYS' | 'FIXED_30';
  latenessPolicy: 'NONE' | 'HALF_DAY_AFTER' | 'PRORATA_MINUTES';
  latenessFreeCount: number;
  lateWarningThreshold: number;
}

export interface RegisterRow {
  employeeId: string;
  staffId: string;
  name: string;
  department: string | null;
  status: AttendanceStatus | null;
  checkIn: string | null;
  checkOut: string | null;
  minutesLate: number;
  notes: string | null;
  onApprovedLeave: string | null;
  locked: boolean;
  recorded: boolean;
}

export interface DailyRegister {
  date: string;
  isWorkingDay: boolean;
  calendarStatus: AttendanceStatus | null;
  employees: RegisterRow[];
}

export interface MonthlyRow {
  employeeId: string;
  staffId: string;
  name: string;
  monthlyGross: string;
  summary: {
    workingDays: number;
    daysPresent: number; daysRemote: number; daysLate: number;
    daysHalf: number; daysAbsent: number; daysOnLeave: number;
    daysSuspended: number; daysUnmarked: number;
    daysEarned: string; daysForfeited: string;
    totalMinutesLate: number; lateWarning: boolean;
  };
  deduction: { dailyRate: string; amount: string; adjustedGross: string };
  days: Record<string, AttendanceStatus>;
}

export interface MonthlyAttendance {
  year: number;
  month: number;
  policy: AttendancePolicy;
  days: { date: string; working: boolean; holiday: boolean }[];
  employees: MonthlyRow[];
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export const getRegister = (date: string) =>
  api<DailyRegister>(`/attendance/register?date=${date}`);

export const markAttendance = (entries: Array<{
  employeeId: string; date: string; status: AttendanceStatus;
  checkIn?: string; checkOut?: string; notes?: string;
}>) =>
  api<{ saved: number }>('/attendance/mark', {
    method: 'POST',
    body: JSON.stringify({ entries }),
  });

export const markRemainingPresent = (date: string) =>
  api<{ saved: number }>('/attendance/mark-remaining-present', {
    method: 'POST',
    body: JSON.stringify({ date }),
  });

export const getMonthlyAttendance = (year: number, month: number) =>
  api<MonthlyAttendance>(`/attendance/monthly?year=${year}&month=${month}`);

export const getAttendancePolicy = () => api<AttendancePolicy>('/attendance/policy');

export const updateAttendancePolicy = (data: Partial<AttendancePolicy>) =>
  api<AttendancePolicy>('/attendance/policy', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const listHolidays = (year?: number) =>
  api<Holiday[]>(`/attendance/holidays${year ? `?year=${year}` : ''}`);

export const addHoliday = (date: string, name: string) =>
  api<Holiday>('/attendance/holidays', {
    method: 'POST',
    body: JSON.stringify({ date, name }),
  });

export const seedHolidays = (year: number) =>
  api<{ added: string[] }>('/attendance/holidays/seed', {
    method: 'POST',
    body: JSON.stringify({ year }),
  });

export const removeHoliday = (id: string) =>
  api<{ ok: boolean }>(`/attendance/holidays/${id}`, { method: 'DELETE' });

/** Downloads the pre-filled monthly template. */
export async function downloadAttendanceTemplate(year: number, month: number) {
  const send = (token: string | null) =>
    fetch(`${BASE}/api/attendance/template?year=${year}&month=${month}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  let res = await send(getAccessToken());
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
  }
  if (!res.ok) throw new ApiError('Could not build the template.', res.status);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-${year}-${String(month).padStart(2, '0')}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Import errors arrive as a list, so the caller can show every problem at once. */
export interface ImportResult {
  imported: number;
  wouldImport: number;
  errors: string[];
}

export async function importAttendance(
  file: File, year: number, month: number, dryRun: boolean,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('year', String(year));
  form.append('month', String(month));
  form.append('dryRun', String(dryRun));

  const send = (token: string | null) =>
    fetch(`${BASE}/api/attendance/import`, {
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

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(
      body.message?.message ?? body.message ?? 'Import failed.', res.status,
    );
    (err as ApiError & { rows?: string[] }).rows =
      body.message?.errors ?? body.errors ?? [];
    throw err;
  }
  return body;
}

/* ------------------------------ payroll --------------------------- */

export type RunStatus =
  | 'DRAFT' | 'PREPARED' | 'REVIEWED' | 'APPROVED'
  | 'POSTED' | 'PAID' | 'REJECTED';

export type RunAction =
  | 'PREPARE' | 'REVIEW' | 'APPROVE' | 'REJECT' | 'POST' | 'MARK_PAID';

export interface PayrollRunSummary {
  id: string;
  reference: string;
  periodYear: number;
  periodMonth: number;
  status: RunStatus;
  totalGross: string;
  totalNet: string;
  totalPaye: string;
  totalPensionEmployee: string;
  totalPensionEmployer: string;
  approvedAt: string | null;
  createdAt: string;
  _count?: { payslips: number };
}

export interface PayslipRow {
  id: string;
  contractedGross: string;
  monthlyGross: string;
  workingDays: number;
  daysAbsent: string;
  daysForfeited: string;
  attendanceDeduction: string;
  basicSalary: string;
  housingAllowance: string;
  transportAllowance: string;
  utilityAllowance: string;
  mealAllowance: string;
  paye: string;
  pensionEmployee: string;
  pensionEmployer: string;
  nhf: string;
  loanRepayment: string;
  totalDeductions: string;
  netPay: string;
  peculiarAllowance: string;
  computationSnapshot: Record<string, unknown>;
  employee: {
    id: string; staffId: string; firstName: string; lastName: string;
    bankName: string | null; bankAccountNumber: string | null;
    department: { name: string } | null;
  };
}

export interface RunApproval {
  id: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  actorRole: string;
  remarks: string | null;
  createdAt: string;
}

export interface PayrollRunDetail extends PayrollRunSummary {
  payslips: PayslipRow[];
  approvals: RunApproval[];
  availableActions: RunAction[];
  rejectionReason: string | null;
}

export interface PaymentSchedule {
  reference: string;
  status: RunStatus;
  totalNet: string;
  missingBankDetails: string[];
  lines: {
    staffId: string; name: string;
    bankName: string | null; accountName: string | null; accountNumber: string | null;
    amount: string; peculiarAllowance: string;
  }[];
}

export const listPayrollRuns = () => api<PayrollRunSummary[]>('/payroll/runs');

export const getPayrollRun = (id: string) => api<PayrollRunDetail>(`/payroll/runs/${id}`);

export const createPayrollRun = (year: number, month: number) =>
  api<PayrollRunSummary>('/payroll/runs', {
    method: 'POST',
    body: JSON.stringify({ year, month }),
  });

export const transitionRun = (id: string, action: RunAction, remarks?: string) =>
  api<PayrollRunSummary>(`/payroll/runs/${id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ action, remarks }),
  });

export const postRunToLedger = (id: string) =>
  api<{ id: string; reference: string }>(`/payroll/runs/${id}/post`, { method: 'POST' });

export const discardRun = (id: string) =>
  api<{ ok: boolean }>(`/payroll/runs/${id}`, { method: 'DELETE' });

export const getPaymentSchedule = (id: string) =>
  api<PaymentSchedule>(`/payroll/runs/${id}/payment-schedule`);

/* ------------------------------ ledger ----------------------------- */

export interface Account {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  parentId: string | null;
  isActive: boolean;
  children?: Account[];
  _count?: { lines: number };
}

export interface JournalLine {
  id: string;
  accountId: string;
  account: Account;
  debit: string;
  credit: string;
  narration: string | null;
  sortOrder: number;
}

export interface JournalEntry {
  id: string;
  reference: string;
  date: string;
  narration: string;
  sourceType: string;
  sourceId: string | null;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  periodId: string;
  period: { year: number; month: number; isClosed: boolean };
  postedById: string | null;
  postedAt: string | null;
  createdAt: string;
  lines: JournalLine[];
  reversesId?: string | null;  // ← ADD THIS
  _count?: { lines: number };
}

export interface TrialBalanceAccount {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface TrialBalance {
  accounts: TrialBalanceAccount[];
  summary: {
    totalDebit: string;
    totalCredit: string;
    isBalanced: boolean;
  };
}

export interface FinancialStatementItem {
  code: string;
  name: string;
  amount: string;
}

export interface IncomeStatement {
  period: string;
  income: FinancialStatementItem[];
  expenses: FinancialStatementItem[];
  summary: {
    totalIncome: string;
    totalExpenses: string;
    netIncome: string;
  };
}

export interface BalanceSheet {
  asAt: string;
  assets: FinancialStatementItem[];
  liabilities: FinancialStatementItem[];
  equity: FinancialStatementItem[];
  summary: {
    totalAssets: string;
    totalLiabilities: string;
    totalEquity: string;
    totalLiabilitiesAndEquity: string;
  };
}

export interface GeneralLedgerEntry {
  date: string;
  reference: string;
  narration: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface FiscalPeriod {
  id: string;
  year: number;
  month: number;
  isClosed: boolean;
  closedAt: string | null;
}

// --- Chart of Accounts ---

export const getAccounts = (includeInactive = false) =>
  api<Account[]>(`/ledger/accounts${includeInactive ? '?includeInactive=true' : ''}`);

export const getAccountTree = (includeInactive = false) =>
  api<Account[]>(`/ledger/accounts/tree${includeInactive ? '?includeInactive=true' : ''}`);

export const getAccount = (id: string) =>
  api<Account>(`/ledger/accounts/${id}`);

export const getAccountBalance = (id: string, fromDate?: string, toDate?: string) => {
  let url = `/ledger/accounts/${id}/balance`;
  const params = new URLSearchParams();
  if (fromDate) params.append('fromDate', fromDate);
  if (toDate) params.append('toDate', toDate);
  if (params.toString()) url += `?${params.toString()}`;
  return api<{ debit: string; credit: string; balance: string }>(url);
};

// --- Journal Entries ---

export const getJournalEntries = (filters?: {
  fromDate?: string;
  toDate?: string;
  status?: string;
  sourceType?: string;
}) => {
  const params = new URLSearchParams();
  if (filters?.fromDate) params.append('fromDate', filters.fromDate);
  if (filters?.toDate) params.append('toDate', filters.toDate);
  if (filters?.status) params.append('status', filters.status);
  if (filters?.sourceType) params.append('sourceType', filters.sourceType);
  const query = params.toString();
  return api<JournalEntry[]>(`/ledger/journal-entries${query ? `?${query}` : ''}`);
};

export const getJournalEntry = (id: string) =>
  api<JournalEntry>(`/ledger/journal-entries/${id}`);

export const reverseJournalEntry = (id: string) =>
  api<JournalEntry>(`/ledger/journal-entries/${id}/reverse`, { method: 'POST' });

// --- Reports ---

export const getTrialBalance = (asAt?: string, periodId?: string) => {
  const params = new URLSearchParams();
  if (asAt) params.append('asAt', asAt);
  if (periodId) params.append('periodId', periodId);
  const query = params.toString();
  return api<TrialBalance>(`/ledger/trial-balance${query ? `?${query}` : ''}`);
};

export const getIncomeStatement = (fromDate?: string, toDate?: string, periodId?: string) => {
  const params = new URLSearchParams();
  if (fromDate) params.append('fromDate', fromDate);
  if (toDate) params.append('toDate', toDate);
  if (periodId) params.append('periodId', periodId);
  const query = params.toString();
  return api<IncomeStatement>(`/ledger/income-statement${query ? `?${query}` : ''}`);
};

export const getBalanceSheet = (asAt?: string, periodId?: string) => {
  const params = new URLSearchParams();
  if (asAt) params.append('asAt', asAt);
  if (periodId) params.append('periodId', periodId);
  const query = params.toString();
  return api<BalanceSheet>(`/ledger/balance-sheet${query ? `?${query}` : ''}`);
};

export const getGeneralLedger = (accountId?: string, fromDate?: string, toDate?: string) => {
  const params = new URLSearchParams();
  if (accountId) params.append('accountId', accountId);
  if (fromDate) params.append('fromDate', fromDate);
  if (toDate) params.append('toDate', toDate);
  const query = params.toString();
  return api<{ entries: GeneralLedgerEntry[]; count: number }>(
    `/ledger/general-ledger${query ? `?${query}` : ''}`
  );
};

// --- Fiscal Periods ---

export const getPeriods = (year?: number) =>
  api<FiscalPeriod[]>(`/ledger/periods${year ? `?year=${year}` : ''}`);

export const getCurrentPeriod = () =>
  api<FiscalPeriod>('/ledger/periods/current');

export const closePeriod = (id: string) =>
  api<FiscalPeriod>(`/ledger/periods/${id}/close`, { method: 'PATCH' });

export const reopenPeriod = (id: string) =>
  api<FiscalPeriod>(`/ledger/periods/${id}/reopen`, { method: 'PATCH' });

/* ------------------------------ vendors ----------------------------- */

export interface Vendor {
  id: string;
  code: string;
  name: string;
  type: 'SUPPLIER' | 'CUSTOMER' | 'CONSULTANT' | 'OTHER';
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  accountNumber: string | null;
  bankName: string | null;
  accountId: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { vouchers: number };
}

export interface VendorBalance {
  vendorId: string;
  total: string;
  paid: string;
  pending: string;
  balance: string;
}

export const listVendors = (search?: string, type?: string, includeInactive = false) => {
  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (type) params.append('type', type);
  if (includeInactive) params.append('includeInactive', 'true');
  const query = params.toString();
  return api<Vendor[]>(`/vendors${query ? `?${query}` : ''}`);
};

export const getVendorOptions = () =>
  api<{ id: string; code: string; name: string }[]>('/vendors/options');

export const getVendor = (id: string) =>
  api<Vendor>(`/vendors/${id}`);

export const getVendorBalance = (id: string) =>
  api<VendorBalance>(`/vendors/${id}/balance`);

export const createVendor = (data: Record<string, unknown>) =>
  api<Vendor>('/vendors', { method: 'POST', body: JSON.stringify(data) });

export const updateVendor = (id: string, data: Record<string, unknown>) =>
  api<Vendor>(`/vendors/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteVendor = (id: string) =>
  api<{ ok: boolean }>(`/vendors/${id}`, { method: 'DELETE' });

export const toggleVendorActive = (id: string) =>
  api<Vendor>(`/vendors/${id}/activate`, { method: 'PATCH' });
/* ------------------------------ vouchers ----------------------------- */

export interface Voucher {
  id: string;
  voucherNo: string;
  date: string;
  description: string;
  amount: string;
  whtRate: string;
  whtAmount: string;
  netAmount: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED' | 'PAID' | 'REJECTED';
  vendorId: string | null;
  vendor: { id: string; code: string; name: string } | null;
  categoryId: string | null;
  category: { id: string; code: string; name: string } | null;
  bankId: string | null;
  bank: { id: string; name: string } | null;
  beneficiary: string;
  beneficiaryAccountNo: string | null;
  raisedById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  requiredApproverRole: string | null;
  rejectionReason: string | null;
  createdAt: string;
  approvals: {
    id: string;
    action: string;
    fromStatus: string;
    toStatus: string;
    actorId: string;
    actorRole: string;
    limitApplied: string | null;
    remarks: string | null;
    createdAt: string;
  }[];
  _count?: { approvals: number };
}

export interface VoucherApprovalInfo {
  canApprove: boolean;
  requiredRole: string;
  routing: {
    roleCode: string;
    rank: number;
    maxAmount: string;
  };
}

export interface ApprovalLimit {
  roleCode: string;
  rank: number;
  maxAmount: string | null;
}

export const listVouchers = (filters?: {
  status?: string;
  vendorId?: string;
  fromDate?: string;
  toDate?: string;
}) => {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.vendorId) params.append('vendorId', filters.vendorId);
  if (filters?.fromDate) params.append('fromDate', filters.fromDate);
  if (filters?.toDate) params.append('toDate', filters.toDate);
  const query = params.toString();
  return api<Voucher[]>(`/vouchers${query ? `?${query}` : ''}`);
};

export const getVoucher = (id: string) =>
  api<Voucher>(`/vouchers/${id}`);

export const getVoucherApprovalInfo = (id: string) =>
  api<VoucherApprovalInfo>(`/vouchers/${id}/approval-info`);

export const getApprovalLimits = () =>
  api<ApprovalLimit[]>('/vouchers/approval-limits');

export const createVoucher = (data: Record<string, unknown>) =>
  api<Voucher>('/vouchers', { method: 'POST', body: JSON.stringify(data) });

export const updateVoucher = (id: string, data: Record<string, unknown>) =>
  api<Voucher>(`/vouchers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const transitionVoucher = (id: string, action: string, remarks?: string) =>
  api<Voucher>(`/vouchers/${id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ action, remarks }),
  });

export const postVoucher = (id: string) =>
  api<{ id: string; reference: string }>(`/vouchers/${id}/post`, { method: 'POST' });

export const deleteVoucher = (id: string) =>
  api<{ ok: boolean }>(`/vouchers/${id}`, { method: 'DELETE' });

/* ------------------------------ budgets ----------------------------- */

export type BudgetStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';

export interface BudgetLine {
  id: string;
  budgetId: string;
  categoryId: string;
  category: {
    id: string;
    code: string;
    name: string;
    account: { id: string; code: string; name: string } | null;
  };
  itemName: string;
  amountBudgeted: string;
  amountSpent: string;
  amountCommitted: string;
  notes: string | null;
  sortOrder: number;
}

export interface Budget {
  id: string;
  name: string;
  year: number;
  status: BudgetStatus;
  totalBudget: string;
  notes: string | null;
  createdById: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: BudgetLine[];
  totals?: {
    budgeted: string;
    spent: string;
    committed: string;
    remaining: string;
  };
  _count?: { lines: number };
}

export interface BudgetSummaryLine {
  id: string;
  itemName: string;
  categoryName: string;
  categoryCode: string;
  accountCode: string | null;
  accountName: string | null;
  budgeted: string;
  spent: string;
  committed: string;
  remaining: string;
  variance: string;
  percentUsed: string;
  isOverBudget: boolean;
}

export interface BudgetSummary {
  year: number;
  budget: {
    id: string;
    name: string;
    status: BudgetStatus;
    totalBudget: string;
    totalSpent: string;
    totalCommitted: string;
    totalRemaining: string;
    percentUsed: string;
  } | null;
  lines?: BudgetSummaryLine[];
  message?: string;
}

export interface BudgetCheckResult {
  hasBudget: boolean;
  exceeded: boolean;
  remaining: string;
  budgeted: string;
  spent: string;
  committed: string;
}

// --- API functions ---

export const listBudgets = (year?: number, status?: string) => {
  const params = new URLSearchParams();
  if (year) params.append('year', String(year));
  if (status) params.append('status', status);
  const query = params.toString();
  return api<Budget[]>(`/budgets${query ? `?${query}` : ''}`);
};

export const getCurrentBudget = () => api<Budget | null>('/budgets/current');

export const getBudget = (id: string) => api<Budget>(`/budgets/${id}`);

export const getBudgetSummary = (year?: number) => {
  const params = year ? `?year=${year}` : '';
  return api<BudgetSummary>(`/budgets/summary${params}`);
};

export const getVarianceReport = (year?: number) => {
  const params = year ? `?year=${year}` : '';
  return api<BudgetSummary>(`/budgets/variance-report${params}`);
};

export const getBudgetVsActual = (id: string) =>
  api<BudgetSummary>(`/budgets/${id}/vs-actual`);

export const getMonthlyAnalysis = (year?: number) => {
  const params = year ? `?year=${year}` : '';
  return api<{ year: number; months: any[] }>(`/budgets/monthly-analysis${params}`);
};

export const createBudget = (data: Record<string, unknown>) =>
  api<Budget>('/budgets', { method: 'POST', body: JSON.stringify(data) });

export const updateBudget = (id: string, data: Record<string, unknown>) =>
  api<Budget>(`/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const setBudgetStatus = (id: string, status: BudgetStatus) =>
  api<Budget>(`/budgets/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const deleteBudget = (id: string) =>
  api<{ ok: boolean }>(`/budgets/${id}`, { method: 'DELETE' });

export const checkVoucherBudget = (categoryId: string, amount: number, date: string) =>
  api<BudgetCheckResult>(
    `/vouchers/check-budget/${categoryId}?amount=${amount}&date=${date}`,
  );

// --- Expense Categories ---

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  accountId: string | null;
  account: { id: string; code: string; name: string } | null;
  isActive: boolean;
}

export const listExpenseCategories = (includeInactive = false) =>
  api<ExpenseCategory[]>(
    `/expense-categories${includeInactive ? '?includeInactive=true' : ''}`,
  );

export const createExpenseCategory = (data: Record<string, unknown>) =>
  api<ExpenseCategory>('/expense-categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateExpenseCategory = (id: string, data: Record<string, unknown>) =>
  api<ExpenseCategory>(`/expense-categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const deleteExpenseCategory = (id: string) =>
  api<{ ok: boolean }>(`/expense-categories/${id}`, { method: 'DELETE' });

/* ------------------------------ banks ----------------------------- */

export interface Bank {
  id: string;
  name: string;
  accountNumber: string | null;
  accountId: string;
  account: { id: string; code: string; name: string } | null;
  isActive?: boolean;
  _count?: { vouchers: number };
}

export const listBanks = () => api<Bank[]>('/banks');
export const createBank = (data: Record<string, unknown>) =>
  api<Bank>('/banks', { method: 'POST', body: JSON.stringify(data) });
export const updateBank = (id: string, data: Record<string, unknown>) =>
  api<Bank>(`/banks/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteBank = (id: string) =>
  api<{ ok: boolean }>(`/banks/${id}`, { method: 'DELETE' });

export interface PayrollMapping {
  key: string;
  accountId: string | null;
  accountCode: string;
  accountName: string;
  accountType: string;
  isDefault: boolean;
  meta: { label: string; description: string; expectedType: string };
}

export const getPayrollMappings = () =>
  api<Record<string, PayrollMapping>>('/payroll/settings/accounts');

export const setPayrollMapping = (key: string, accountId: string) =>
  api<PayrollMapping>(`/payroll/settings/accounts/${key}`, {
    method: 'PATCH',
    body: JSON.stringify({ accountId }),
  });

