import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadPhoto, removePhoto, ApiError } from '../lib/api';
import Avatar from './Avatar';

/** Passport photograph panel, shown at the top of the Personal tab. */
export default function PhotoUpload({
  employeeId, initials, hasPhoto, canEdit,
}: {
  employeeId: string;
  initials: string;
  hasPhoto: boolean;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Forces Avatar to refetch after a change, since the URL is identical.
  const [version, setVersion] = useState(0);

  const refresh = () => {
    setVersion((v) => v + 1);
    qc.invalidateQueries({ queryKey: ['employee', employeeId] });
    qc.invalidateQueries({ queryKey: ['employees'] });
  };

  async function choose(file: File) {
    setBusy(true);
    setError(null);
    try {
      await uploadPhoto(employeeId, file);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not upload the photograph.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function clear() {
    if (!confirm('Remove this photograph?')) return;
    setBusy(true);
    try {
      await removePhoto(employeeId);
      refresh();
    } catch {
      setError('Could not remove the photograph.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="photopanel">
      <Avatar key={version} employeeId={employeeId} initials={initials}
        hasPhoto={hasPhoto} size={92} />
      <div className="photoside">
        <span className="photolabel">Passport photograph</span>
        <p className="fhint">JPG, PNG or WebP. Maximum 2 MB.</p>
        {error ? <em className="ferr">{error}</em> : null}
        {canEdit ? (
          <div className="photoacts">
            <input ref={input} type="file" hidden accept=".jpg,.jpeg,.png,.webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) choose(file);
              }} />
            <button className="btn" type="button" disabled={busy}
              onClick={() => input.current?.click()}>
              {busy ? 'Working…' : hasPhoto ? 'Replace' : 'Upload photo'}
            </button>
            {hasPhoto ? (
              <button className="linkact danger" type="button" disabled={busy} onClick={clear}>
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}