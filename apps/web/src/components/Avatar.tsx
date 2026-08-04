import { useEffect, useState } from 'react';
import { fetchPhoto } from '../lib/api';

/**
 * Shows an employee's photograph, falling back to initials.
 *
 * Photos are behind the auth guard, so they are fetched as blobs rather
 * than set as an img src. The object URL is revoked on unmount, which
 * matters on the directory page where cards mount and unmount as the
 * search filter changes.
 */
export default function Avatar({
  employeeId, initials, tone, hasPhoto, size,
}: {
  employeeId: string;
  initials: string;
  tone?: string;
  hasPhoto?: boolean;
  size?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPhoto) { setUrl(null); return; }

    let objectUrl: string | null = null;
    let cancelled = false;

    fetchPhoto(employeeId).then((u) => {
      if (cancelled) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      objectUrl = u;
      setUrl(u);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employeeId, hasPhoto]);

  const style = size ? { width: size, height: size, fontSize: size * 0.34 } : undefined;

  if (url) {
    return (
      <div className={`av photo ${tone ?? ''}`} style={style}>
        <img src={url} alt="" />
      </div>
    );
  }
  return <div className={`av ${tone ?? ''}`} style={style}>{initials}</div>;
}