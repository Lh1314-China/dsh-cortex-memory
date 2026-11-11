import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ATTACHMENT_READ_LIMIT = 50 * 1024 * 1024;

export function inspectLocalAttachment(uri, { maxBytes = ATTACHMENT_READ_LIMIT } = {}) {
  const text = String(uri ?? '').trim();
  if (!text) throw new Error('attachment uri is required');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('attachment uri must be a file:// URL');
  }
  if (url.protocol !== 'file:') throw new Error('only file:// attachments can be inspected');
  const file = fileURLToPath(url);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('attachment is not a regular file');
  if (stat.size > maxBytes) throw new Error(`attachment is larger than ${maxBytes} bytes`);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return {
    kind: 'file',
    uri: text,
    name: path.basename(file),
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256,
  };
}
