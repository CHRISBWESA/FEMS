import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import { join, resolve, sep } from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Where uploaded files are kept.
 *
 * Deliberately OUTSIDE the backend's own source tree (`backend/`), and configurable, because a stored upload is
 * user data rather than code. It is never served as a static directory: every read goes through
 * `resolveStoredPath`, which re-derives the path from the database row and refuses anything that escapes the
 * storage root. That is the difference between "there is a folder" and "there is no traversal".
 *
 * Configured per deployment because a container must mount a volume, not write into its own image layer.
 */
export function storageRoot(): string {
  const configured = (process.env.UPLOAD_DIR || '').trim();
  if (!configured) return resolve(process.cwd(), '..', 'storage', 'uploads');
  return resolve(configured);
}

/**
 * The absolute path of a stored file, or a 404.
 *
 * The stored name is attacker-influenced (it is a timestamp, a random suffix and the sanitized original name), so
 * the resolved path is checked against the storage root before it is used. Two independent checks matter here:
 * `resolve` collapses `..`, and the `startsWith(root + sep)` test rejects anything that landed outside. A name is
 * never concatenated into a response without going through this.
 */
export function resolveStoredPath(storedFilename: string): string {
  if (!storedFilename || typeof storedFilename !== 'string') throw new NotFoundException('File not found');
  const root = storageRoot();
  const candidate = resolve(root, storedFilename);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    // Reaching here means the stored name tried to escape the root. Treated as "not found" rather than reported,
    // so the response does not confirm that such a file exists.
    throw new NotFoundException('File not found');
  }
  return candidate;
}

/** Creates the storage directory and writes the bytes. */
export async function writeStoredFile(storedFilename: string, bytes: Buffer): Promise<void> {
  const path = resolveStoredPath(storedFilename);
  await mkdir(storageRoot(), { recursive: true });
  // 'wx' refuses to overwrite: a collision would otherwise silently replace somebody else's file.
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (err: any) {
    if (err?.code === 'EEXIST') throw new BadRequestException('A file with that name already exists. Try again.');
    throw err;
  }
}

export async function readStoredFile(storedFilename: string): Promise<Buffer> {
  const path = resolveStoredPath(storedFilename);
  try {
    return await readFile(path);
  } catch {
    // The row exists but the bytes do not (a restore that missed the volume, say). Same answer as an unknown id.
    throw new NotFoundException('File not found');
  }
}

export function createStoredFileStream(storedFilename: string) {
  return createReadStream(resolveStoredPath(storedFilename));
}

/** Best-effort removal. A missing file is not an error: the goal is only that it is gone. */
export async function deleteStoredFile(storedFilename: string): Promise<void> {
  try {
    await unlink(resolveStoredPath(storedFilename));
  } catch {
    // Intentionally ignored.
  }
}

/**
 * The `Content-Disposition` for a download.
 *
 * Set on every served file, and always with an ASCII-only `filename=` plus a UTF-8 `filename*=` for names that are
 * not ASCII. Without it a browser guesses from the URL or the type, which is how a `.pdf` that is really something
 * else gets opened as markup.
 */
export function contentDisposition(filename: string): string {
  const safe = filename.replace(/[\r\n"\\]/g, '_');
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** A `Content-Type` the browser will never execute. For anything served to a browser as a download. */
export const SAFE_DOWNLOAD_TYPE = 'application/octet-stream';
