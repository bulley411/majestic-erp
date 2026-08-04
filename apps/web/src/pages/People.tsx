import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listEmployees, type Employee } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import EmployeeForm from './EmployeeForm';
import Avatar from '../components/Avatar';

const CATEGORIES = ['PRE_EMPLOYMENT', 'ONBOARDING', 'LIFECYCLE', 'EXIT'] as const;
const GROUP_CLASS: Record<string, string> = {
  PRE_EMPLOYMENT: 'grpA',
  ONBOARDING: 'grpB',
  LIFECYCLE: 'grpC',
  EXIT: 'grpD',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On leave',
  ONBOARDING: 'Onboarding',
  SUSPENDED: 'Suspended',
  EXITED: 'Exited',
};
const AVATAR_TONES = ['a1', 'a2', 'a3', 'a4', 'a5'];

const naira = (v: string | null) =>
  v === null ? '—' : '₦' + Number(v).toLocaleString('en-NG', { maximumFractionDigits: 0 });

const initials = (e: Employee) => (e.firstName[0] ?? '') + (e.lastName[0] ?? '');

function FileMeter({ employee }: { employee: Employee }) {
  const { totals, held, applicable } = employee.fileCompleteness;
  const onFile = held.PRE_EMPLOYMENT + held.ONBOARDING + held.LIFECYCLE;
  const missing = applicable - onFile;

  return (
    <div className="filebar">
      <div className="lbl">
        <span>Employee file</span>
        <b className={missing > 4 ? 'warn' : undefined}>
          {onFile}/{applicable}
          {missing > 0 ? ` · ${missing} missing` : ' · complete'}
        </b>
      </div>
      <div className="segs">
        {CATEGORIES.map((category) => {
          const size = totals[category] ?? 0;
          const filled = held[category] ?? 0;
          // Exit records do not apply while an employee is still serving.
          const notApplicable = category === 'EXIT' && employee.status !== 'EXITED';
          return (
            <span className={`seggrp ${GROUP_CLASS[category]}`} key={category}>
              {Array.from({ length: size }, (_, i) => (
                <span key={i} className={`seg ${notApplicable ? 'na' : i < filled ? 'on' : ''}`} />
              ))}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Card({ employee, tone, onOpen }: {
  employee: Employee; tone: string; onOpen: () => void;
}) {
  return (
    <article
      className="card"
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div className="chead">
       <Avatar employeeId={employee.id} initials={initials(employee)}
          tone={tone} hasPhoto={employee.hasPhoto} />
        <div className="who">
          <h3>
            {employee.firstName} {employee.lastName}
          </h3>
          <p>{employee.jobTitle?.name ?? 'Unassigned'}</p>
          <div className="sid mono">
            <span className={`dot ${employee.status.toLowerCase()}`} />
            {employee.staffId}
          </div>
        </div>
      </div>

      <div className="meta">
        <span className="tag">{employee.department?.name ?? 'No department'}</span>
        {employee.gradeLevel ? <span className="tag gl">{employee.gradeLevel.code}</span> : null}
        <span className="tag">{STATUS_LABEL[employee.status] ?? employee.status}</span>
      </div>

      <FileMeter employee={employee} />

      <div className="foot">
        <span>Monthly gross</span>
        <span className="pay">
          {naira(employee.currentGross)}
          <small>/mo</small>
        </span>
      </div>
    </article>
  );
}

export default function People() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { can } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['employees', search],
    queryFn: () => listEmployees(search),
  });

  const employees = data ?? [];
  const active = employees.filter((e) => e.status === 'ACTIVE').length;

  return (
    <>
      <header className="topbar">
        <div className="crumb">People</div>
        <div className="titlerow">
          <h2 className="page">
            Employees
            <span className="count">
              {isLoading ? 'Loading…' : `${employees.length} on record · ${active} active`}
            </span>
          </h2>
          <div className="acts">
            <button className="btn">Export</button>
            {can('employee.write') ? (
              <button className="btn pri" onClick={() => setOpen('new')}>Add employee</button>
            ) : null}
          </div>
        </div>
        <div className="tabs">
          <div className="tab on">Directory</div>
          <div className="tab">Org chart</div>
          <div className="tab">File audit</div>
          <div className="tab">Exits</div>
        </div>
      </header>

      <div className="filters">
        <div className="search">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, staff ID, RSA PIN…"
            style={{ paddingLeft: 11 }}
          />
        </div>
      </div>

      <div className="body">
        {error ? (
          <div className="error">
            <strong>Could not load employees.</strong>
            <p style={{ marginTop: 6 }}>{(error as Error).message}</p>
            <p style={{ marginTop: 6, fontSize: 12 }}>
              Check the API is running on port 3000 and the database is migrated.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="grid">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="skel" key={i} />
            ))}
          </div>
        ) : null}

        {!isLoading && !error && employees.length === 0 ? (
          <div className="empty">
            <h3>No employees yet</h3>
            <p>Add your first employee, or import from the July payroll sheet.</p>
          </div>
        ) : null}

        {employees.length > 0 ? (
          <div className="grid">
            {employees.map((employee, i) => (
              <Card
                key={employee.id}
                employee={employee}
                tone={AVATAR_TONES[i % 5]}
                onOpen={() => setOpen(employee.id)}
              />
            ))}
          </div>
        ) : null}

        {open ? <EmployeeForm employeeId={open} onClose={() => setOpen(null)} /> : null}

        <div className="legend">
          <h4>Employee file</h4>
          <div className="lgi">
            <span className="lgs">
              <i />
              <i />
              <i />
            </span>
            On file
          </div>
          <div className="lgi">
            <span className="lgs">
              <i className="off" />
              <i className="off" />
              <i className="off" />
            </span>
            Missing
          </div>
          <div className="lgi">
            <span className="lgs">
              <i className="na" />
              <i className="na" />
              <i className="na" />
            </span>
            Not applicable
          </div>
        </div>
      </div>
    </>
  );
}
