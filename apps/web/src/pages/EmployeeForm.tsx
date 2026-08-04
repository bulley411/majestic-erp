import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  getEmployee, getFormOptions, createEmployee, updateEmployee,
  getHistory, ApiError, type FormOptions,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import EmployeeFileTab from './EmployeeFileTab';
import PhotoUpload from '../components/PhotoUpload';
import SalaryTab from './SalaryTab';

/* Sections mirror the MAPA Employee Data Form. */
const TABS = [
  { id: 'personal', label: 'Personal' },
  { id: 'employment', label: 'Employment' },
  { id: 'salary', label: 'Salary' },
  { id: 'payroll', label: 'Bank & statutory' },
  { id: 'contacts', label: 'Next of kin' },
  { id: 'documents', label: 'Employee file' },
  { id: 'history', label: 'History' },
] as const;
type TabId = (typeof TABS)[number]['id'];



const NG_STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
  'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna',
  'Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo',
  'Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];

const PFAS = ['Access Pensions','ARM Pension','CrusaderSterling Pensions','FCMB Pensions',
  'Fidelity Pension','Guaranty Trust Pension','Leadway Pensure','NLPC Pension','NPF Pensions',
  'Nigerian University Pension','Oak Pensions','Pensions Alliance (PAL)','Premium Pension',
  'Radix Pension','Sigma Pensions','Stanbic IBTC Pension','Tangerine APT Pensions',
  'Trustfund Pensions','Veritas Glanvills Pensions'];

type Values = Record<string, unknown>;

/* ---------------------------------------------------------------- */

function Field({
  label, name, values, errors, set, type = 'text', options, required, hint, span,
}: {
  label: string; name: string; values: Values;
  errors: Record<string, string>; set: (k: string, v: unknown) => void;
  type?: string; options?: { value: string; label: string }[];
  required?: boolean; hint?: string; span?: boolean;
}) {
  const raw = values[name];
  const value = raw == null ? '' : type === 'date' ? String(raw).slice(0, 10) : String(raw);
  const error = errors[name];

  return (
    <label className={`ffield${span ? ' span2' : ''}${error ? ' has-error' : ''}`}>
      <span>
        {label}
        {required ? <b aria-hidden> *</b> : null}
      </span>
      {options ? (
        <select value={value} onChange={(e) => set(name, e.target.value || undefined)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea rows={2} value={value} onChange={(e) => set(name, e.target.value)} />
      ) : type === 'checkbox' ? (
        <input type="checkbox" checked={!!raw} onChange={(e) => set(name, e.target.checked)} />
      ) : (
        <input type={type} value={value} onChange={(e) => set(name, e.target.value)} />
      )}
      {error ? <em className="ferr">{error}</em> : hint ? <em className="fhint">{hint}</em> : null}
    </label>
  );
}

const Grid = ({ children, title }: { children: ReactNode; title?: string }) => (
  <div className="fsection">
    {title ? <h4>{title}</h4> : null}
    <div className="fgrid">{children}</div>
  </div>
);

/* ---------------------------------------------------------------- */

export default function EmployeeForm({
  employeeId, onClose,
}: { employeeId: string | 'new'; onClose: () => void }) {
  const isNew = employeeId === 'new';
  const { can } = useAuth();
  const editable = can('employee.write');
  const qc = useQueryClient();

  const [tab, setTab] = useState<TabId>('personal');
  const [values, setValues] = useState<Values>({ nationality: 'Nigerian' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Which fields the user actually touched. Only these are sent on save,
  // so editing one tab cannot be blocked by an unrelated field elsewhere.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const dirty = touched.size > 0;
  const [banner, setBanner] = useState<string | null>(null);

  const { data: options } = useQuery({ queryKey: ['employee-options'], queryFn: getFormOptions });
  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => getEmployee(employeeId),
    enabled: !isNew,
  });
  const { data: history } = useQuery({
    queryKey: ['employee-history', employeeId],
    queryFn: () => getHistory(employeeId),
    enabled: !isNew && tab === 'history',
  });

  useEffect(() => {
    if (employee) setValues(employee as unknown as Values);
  }, [employee]);

const set = (k: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => { const n = { ...prev }; delete n[k]; return n; });
    setTouched((prev) => new Set(prev).add(k));
  };

  const save = useMutation({
    mutationFn: async () => {
      // Send only editable fields — the API rejects unknown keys and the
      // detail response carries joined objects the schema does not accept.
      const allowed = [
        'staffId','firstName','middleName','lastName','dateOfBirth','gender','maritalStatus',
        'nationality','stateOfOrigin','localGovernmentArea','residentialAddress','phoneNumber',
        'personalEmail','departmentId','jobTitleId','gradeLevelId','employmentType','status',
        'dateOfEmployment','dateOfAssumption','supervisorId','bankName','bankAccountName',
        'bankAccountNumber','pensionFundAdministrator','rsaPin','taxIdentificationNumber',
        'nhfNumber','nhfEnrolled','annualRentPaid','nextOfKinName','nextOfKinRelationship',
        'nextOfKinPhone','nextOfKinAddress','emergencyContactName','emergencyContactRelationship',
        'emergencyContactPhone','emergencyContactAddress',
      ];
      const payload: Values = {};
      for (const k of allowed) {
        if (isNew) {
          if (values[k] !== undefined && values[k] !== '') payload[k] = values[k];
        } else if (touched.has(k)) {
          payload[k] = values[k];
        }
      }
      if (!isNew && Object.keys(payload).length === 0) return { id: employeeId };
      return isNew ? createEmployee(payload) : updateEmployee(employeeId, payload);
    },
    onSuccess: () => {
      setTouched(new Set());
      setErrors({});
      setBanner('Saved.');
      setTimeout(() => setBanner(null), 2500);
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee', employeeId] });
      if (isNew) onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors) {
        setErrors(err.fieldErrors);
        // Jump to the first tab holding an error, so it is not hidden.
        const map: Record<string, TabId> = {
          firstName:'personal', lastName:'personal', dateOfBirth:'personal',
          phoneNumber:'personal', personalEmail:'personal',
          staffId:'employment', dateOfEmployment:'employment', dateOfAssumption:'employment',
          supervisorId:'employment',
          bankName:'payroll', bankAccountNumber:'payroll', rsaPin:'payroll',
          pensionFundAdministrator:'payroll', taxIdentificationNumber:'payroll',
        };
        const first = Object.keys(err.fieldErrors)[0];
        if (map[first]) setTab(map[first]);
        setBanner(null);
      } else {
        setBanner(err instanceof Error ? err.message : 'Could not save.');
      }
    },
  });



  const opt = (o: FormOptions | undefined) => o ?? {
    departments: [], jobTitles: [], gradeLevels: [], supervisors: [], banks: [], structures: [],
  };
  const o = opt(options);

  const close = () => {
    if (dirty && !confirm('You have unsaved changes. Close anyway?')) return;
    onClose();
  };

  if (!isNew && isLoading) return <div className="drawer"><div className="loading">Loading…</div></div>;

  const name = isNew
    ? 'New employee'
    : `${values.firstName ?? ''} ${values.lastName ?? ''}`.trim();

  return (
    <div className="drawerwrap" role="dialog" aria-modal="true">
      <div className="drawerscrim" onClick={close} />
      <div className="drawer">
        <header className="dhead">
          <div>
            <div className="crumb">{isNew ? 'People' : String(values.staffId ?? '')}</div>
            <h2 className="page">{name || 'Employee'}</h2>
          </div>
          <div className="acts">
            {editable ? (
              <button
                className="btn pri"
                disabled={save.isPending || (!dirty && !isNew)}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : isNew ? 'Create employee' : 'Save changes'}
              </button>
            ) : null}
            <button className="btn" onClick={close}>Close</button>
          </div>
        </header>

        {banner ? <div className="dbanner">{banner}</div> : null}
        {Object.keys(errors).length ? (
          <div className="dbanner err">
            {Object.keys(errors).length} field{Object.keys(errors).length > 1 ? 's need' : ' needs'} attention.
          </div>
        ) : null}

        <nav className="tabs dtabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}
              disabled={isNew && (t.id === 'documents' || t.id === 'history'|| t.id === 'salary')}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="dbody">
          {tab === 'personal' && !isNew ? (
            <PhotoUpload
              employeeId={employeeId}
              initials={`${String(values.firstName ?? '')[0] ?? ''}${String(values.lastName ?? '')[0] ?? ''}`}
              hasPhoto={!!employee?.hasPhoto}
              canEdit={editable}
            />
          ) : null}
          {tab === 'personal' ? (
            <Grid title="A. Personal information">
              <Field label="First name" name="firstName" required {...{ values, errors, set }} />
              <Field label="Middle name" name="middleName" {...{ values, errors, set }} />
              <Field label="Last name" name="lastName" required {...{ values, errors, set }} />
              <Field label="Date of birth" name="dateOfBirth" type="date" {...{ values, errors, set }} />
              <Field label="Gender" name="gender" {...{ values, errors, set }}
                options={[{value:'MALE',label:'Male'},{value:'FEMALE',label:'Female'}]} />
              <Field label="Marital status" name="maritalStatus" {...{ values, errors, set }}
                options={['SINGLE','MARRIED','DIVORCED','WIDOWED'].map((v)=>({value:v,label:v[0]+v.slice(1).toLowerCase()}))} />
              <Field label="Nationality" name="nationality" {...{ values, errors, set }} />
              <Field label="State of origin" name="stateOfOrigin" {...{ values, errors, set }}
                options={NG_STATES.map((s)=>({value:s,label:s}))} />
              <Field label="Local government area" name="localGovernmentArea" {...{ values, errors, set }} />
              <Field label="Phone number" name="phoneNumber" {...{ values, errors, set }}
                hint="08012345678" />
              <Field label="Email address" name="personalEmail" type="email" {...{ values, errors, set }} />
              <Field label="Residential address" name="residentialAddress" type="textarea" span {...{ values, errors, set }} />
            </Grid>
          ) : null}

          {tab === 'employment' ? (
            <Grid title="B. Employment information">
              <Field label="Staff ID" name="staffId" required {...{ values, errors, set }}
                hint="MAPA-26-PER-0008" />
              <Field label="Department" name="departmentId" {...{ values, errors, set }}
                options={o.departments.map((d)=>({value:d.id,label:d.name}))} />
              <Field label="Job title" name="jobTitleId" {...{ values, errors, set }}
                options={o.jobTitles.map((j)=>({value:j.id,label:j.name}))} />
              <Field label="Grade / level" name="gradeLevelId" {...{ values, errors, set }}
                options={o.gradeLevels.map((g)=>({value:g.id,label:`${g.code} — ${g.name}`}))} />
              <Field label="Employment type" name="employmentType" {...{ values, errors, set }}
                options={['PERMANENT','CONTRACT','TEMPORARY','OTHER'].map((v)=>({value:v,label:v[0]+v.slice(1).toLowerCase()}))} />
              <Field label="Status" name="status" {...{ values, errors, set }}
                options={['ONBOARDING','ACTIVE','ON_LEAVE','SUSPENDED','EXITED'].map((v)=>({value:v,label:v.replace('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase())}))} />
              <Field label="Date of employment" name="dateOfEmployment" type="date" {...{ values, errors, set }} />
              <Field label="Date of assumption" name="dateOfAssumption" type="date" {...{ values, errors, set }}
                hint="Payroll activates from this date" />
              <Field label="Reporting supervisor" name="supervisorId" span {...{ values, errors, set }}
                options={o.supervisors.filter((s)=>s.id!==employeeId)
                  .map((s)=>({value:s.id,label:`${s.firstName} ${s.lastName} (${s.staffId})`}))} />
            </Grid>
          ) : null}

          {tab === 'payroll' ? (
            <>
              <Grid title="C. Payroll and statutory information">
                <Field label="Bank name" name="bankName" {...{ values, errors, set }}
                  options={o.banks.map((b)=>({value:b.name,label:b.name}))} />
                <Field label="Account name" name="bankAccountName" {...{ values, errors, set }} />
                <Field label="Account number" name="bankAccountNumber" {...{ values, errors, set }}
                  hint="10-digit NUBAN" />
                <Field label="Pension fund administrator" name="pensionFundAdministrator" {...{ values, errors, set }}
                  options={PFAS.map((p)=>({value:p,label:p}))} />
                <Field label="RSA PIN" name="rsaPin" {...{ values, errors, set }}
                  hint="PEN followed by 12 digits" />
                <Field label="Tax identification number" name="taxIdentificationNumber" {...{ values, errors, set }} />
                <Field label="NHF number" name="nhfNumber" {...{ values, errors, set }} />
                <Field label="Enrolled in NHF" name="nhfEnrolled" type="checkbox" {...{ values, errors, set }} />
                <Field label="Declared annual rent (₦)" name="annualRentPaid" type="number" span
                  {...{ values, errors, set }}
                  hint="Drives rent relief in the PAYE computation. 20% of this, capped at ₦500,000." />
              </Grid>
              <p className="fnote">
                RSA PIN and account number are masked in the audit trail. Changes here
                affect net pay from the next payroll run.
              </p>
            </>
          ) : null}

          {tab === 'contacts' ? (
            <>
              <Grid title="D. Next of kin">
                <Field label="Name" name="nextOfKinName" {...{ values, errors, set }} />
                <Field label="Relationship" name="nextOfKinRelationship" {...{ values, errors, set }} />
                <Field label="Phone number" name="nextOfKinPhone" {...{ values, errors, set }} />
                <Field label="Address" name="nextOfKinAddress" type="textarea" {...{ values, errors, set }} />
              </Grid>
              <Grid title="E. Emergency contact">
                <Field label="Name" name="emergencyContactName" {...{ values, errors, set }} />
                <Field label="Relationship" name="emergencyContactRelationship" {...{ values, errors, set }} />
                <Field label="Phone number" name="emergencyContactPhone" {...{ values, errors, set }} />
                <Field label="Address" name="emergencyContactAddress" type="textarea" {...{ values, errors, set }} />
              </Grid>
            </>
          ) : null}
        {tab === 'salary' ? <SalaryTab employeeId={employeeId} /> : null}
       {tab === 'documents' ? <EmployeeFileTab employeeId={employeeId} /> : null}

          {tab === 'history' ? (
            <div className="fsection">
              {!history?.length ? (
                <p className="fnote">No changes recorded yet.</p>
              ) : (
                <ul className="histlist">
                  {history.map((h) => (
                    <li key={h.id}>
                      <div className="histhead">
                        <b>{h.action}</b>
                        <em>{new Date(h.createdAt).toLocaleString('en-NG')}</em>
                      </div>
                      {h.after ? (
                        <div className="histfields">
                          {Object.entries(h.after).map(([k, v]) => (
                            <span key={k}>
                              {k}: <b>{String(v ?? '—')}</b>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
