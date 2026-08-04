import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * File storage for employee documents.
 *
 * Files are written under UPLOAD_DIR using a generated uuid as the name.
 * The name the user supplied is stored in the database and never touches
 * the filesystem — that removes path traversal, name collisions, and
 * character-encoding problems in one step.
 */

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/// Photographs are displayed at 46px in the directory; 2 MB is generous.
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/**
 * Allowed types, keyed by MIME, with the magic bytes each should start
 * with. Browsers and API clients both lie about MIME type, so the declared
 * type is checked against the actual file contents before anything is
 * written to disk.
 */
const ALLOWED: Record<string, { ext: string[]; magic: number[][] }> = {
  'application/pdf': { ext: ['.pdf'], magic: [[0x25, 0x50, 0x44, 0x46]] },
  'image/jpeg': { ext: ['.jpg', '.jpeg'], magic: [[0xff, 0xd8, 0xff]] },
  'image/png': { ext: ['.png'], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/webp': { ext: ['.webp'], magic: [[0x52, 0x49, 0x46, 0x46]] },
  'application/msword': { ext: ['.doc'], magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: ['.docx'],
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  'application/vnd.ms-excel': { ext: ['.xls'], magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: ['.xlsx'],
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
};

export const ACCEPTED_EXTENSIONS = [
  ...new Set(Object.values(ALLOWED).flatMap((a) => a.ext)),
].sort();

export class FileRejected extends Error {}

const startsWith = (buf: Buffer, sig: number[]) =>
  sig.every((byte, i) => buf[i] === byte);

/**
 * Validates the declared type against the file's actual leading bytes.
 * An executable renamed to .pdf declares application/pdf and would
 * otherwise be accepted on the client's word alone.
 */
export function validateFile(
  buffer: Buffer,
  originalName: string,
  declaredMime: string,
  opts: { maxBytes?: number; allowedMimes?: string[] } = {},
): void {
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES;

  if (buffer.length === 0) throw new FileRejected('The file is empty.');
  if (buffer.length > maxBytes) {
    throw new FileRejected(
      `File is ${(buffer.length / 1048576).toFixed(1)} MB. The limit is ${
        maxBytes / 1048576
      } MB.`,
    );
  }

  if (opts.allowedMimes && !opts.allowedMimes.includes(declaredMime)) {
    throw new FileRejected(
      `Only ${opts.allowedMimes.map((m) => m.split('/')[1].toUpperCase()).join(', ')} images are accepted.`,
    );
  }

  const rule = ALLOWED[declaredMime];
  if (!rule) {
    throw new FileRejected(
      `${declaredMime || 'That file type'} is not accepted. Allowed: ${ACCEPTED_EXTENSIONS.join(', ')}`,
    );
  }

  const ext = extname(originalName).toLowerCase();
  if (!rule.ext.includes(ext)) {
    throw new FileRejected(
      `A ${declaredMime} file should have extension ${rule.ext.join(' or ')}.`,
    );
  }

  if (!rule.magic.some((sig) => startsWith(buffer, sig))) {
    throw new FileRejected(
      'The file contents do not match its type. It may be corrupt or renamed.',
    );
  }
}

export const checksum = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

export async function saveFile(buffer: Buffer, originalName: string): Promise<string> {
  if (!existsSync(UPLOAD_DIR)) await mkdir(UPLOAD_DIR, { recursive: true });
  const storedName = `${randomUUID()}${extname(originalName).toLowerCase()}`;
  await writeFile(join(UPLOAD_DIR, storedName), buffer);
  return storedName;
}

/**
 * Resolves a stored name to a path, refusing anything that is not a plain
 * uuid-style filename. These come from our own database, but the check
 * means a corrupted row still cannot reach outside UPLOAD_DIR.
 */
function resolveStored(storedName: string): string {
  if (!/^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i.test(storedName)) {
    throw new FileRejected('Invalid file reference.');
  }
  return join(UPLOAD_DIR, storedName);
}

export const readStoredFile = (storedName: string) => readFile(resolveStored(storedName));

export async function deleteStoredFile(storedName: string): Promise<void> {
  try {
    await unlink(resolveStored(storedName));
  } catch {
    // Already gone. The database row is the record of truth; a missing
    // file on disk should not block removing it.
  }
}