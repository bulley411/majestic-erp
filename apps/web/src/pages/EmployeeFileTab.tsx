import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getEmployeeFile, uploadDocument, deleteDocument, downloadDocument,
  ApiError, type FileSection,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

const CATEGORY_LABEL: Record<string, string> = {
  PRE_EMPLOYMENT: 'A. Pre-employment / recruitment',
  ONBOARDING: 'B. Employment and onboarding',
  LIFECYCLE: 'C. Employment lifecycle',
  EXIT: 'D. Exit / cessation',
};

const ORDER = ['PRE_EMPLOYMENT', 'ONBOARDING', 'LIFECYCLE', 'EXIT'];

const readableSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B`
  : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB`
  : `${(bytes / 1048576).toFixed(1)} MB`;

function Row({
  section, employeeId, canUpload, onError,
}: {
  section: FileSection;
  employeeId: string;
  canUpload: boolean;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['employee-file', employeeId] });
    qc.invalidateQueries({ queryKey: ['employees'] });
  };

  const upload = useMutation({
    mutationFn: (file: File) => uploadDocument(employeeId, section.type.id, file),
    onSuccess: () => { onError(null); refresh(); },
    onError: (e) =>
      onError(e instanceof ApiError ? e.message : 'Upload failed.'),
    onSettled: () => {
      setBusy(false);
      if (input.current) input.current.value = '';
    },
  });

  const remove = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => { onError(null); refresh(); },
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Could not delete.'),
  });

  const has = section.files.length > 0;

  return (
    <li className={`filerow${has ? ' filed' : ''}`}>
      <div className="filemain">
        <div className="filehead">
          <span className={`fileflag${has ? ' on' : ''}`} aria-hidden />
          <b>{section.type.name}</b>
          {section.type.required && !has ? <span className="tag warn">Missing</span> : null}
          {section.type.allowMultiple ? <span className="tag">Multiple</span> : null}
        </div>
        {section.type.description ? <em className="fhint">{section.type.description}</em> : null}

        {has ? (
          <ul className="filelist">
            {section.files.map((f) => (
              <li key={f.id}>
                <button
                  className="filelink"
                  onClick={() => downloadDocument(f.id, f.originalName)}
                  title="Download"
                >
                  {f.originalName}
                </button>
                <span className="filemeta mono">
                  {readableSize(f.fileSizeBytes)} ·{' '}
                  {new Date(f.uploadedAt).toLocaleDateString('en-NG')}
                </span>
                {canUpload ? (
                  <button
                    className="linkact danger"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Remove "${f.originalName}"?`)) remove.mutate(f.id);
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {canUpload ? (
        <div className="fileact">
          <input
            ref={input}
            type="file"
            hidden
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) { setBusy(true); upload.mutate(file); }
            }}
          />
          <button
            className="btn"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? 'Uploading…' : has && !section.type.allowMultiple ? 'Replace' : 'Upload'}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export default function EmployeeFileTab({ employeeId }: { employeeId: string }) {
  const { can } = useAuth();
  const canUpload = can('employee.document.upload');
  const [error, setError] = useState<string | null>(null);

  const { data: sections, isLoading } = useQuery({
    queryKey: ['employee-file', employeeId],
    queryFn: () => getEmployeeFile(employeeId),
  });

  if (isLoading) return <div className="loading">Loading file…</div>;
  if (!sections?.length) {
    return (
      <div className="empty">
        <h3>No document types defined</h3>
        <p>Add them under Settings → Document types.</p>
      </div>
    );
  }

  const required = sections.filter((s) => s.type.required);
  const held = required.filter((s) => s.files.length > 0).length;

  return (
    <>
      {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

      <div className="filesummary">
        <span>Required documents</span>
        <b className={held < required.length ? 'warn' : undefined}>
          {held}/{required.length} on file
        </b>
      </div>

      {ORDER.map((category) => {
        const inSection = sections.filter((s) => s.type.category === category);
        if (!inSection.length) return null;
        return (
          <div className="fsection" key={category}>
            <h4>{CATEGORY_LABEL[category]}</h4>
            <ul className="filerows">
              {inSection.map((section) => (
                <Row
                  key={section.type.id}
                  section={section}
                  employeeId={employeeId}
                  canUpload={canUpload}
                  onError={setError}
                />
              ))}
            </ul>
          </div>
        );
      })}

      <p className="fnote">
        Accepted: PDF, Word, Excel, JPG, PNG, WebP. Maximum 10 MB per file.
      </p>
    </>
  );
}