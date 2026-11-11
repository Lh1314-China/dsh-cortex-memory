const KINDS = new Set(['image', 'audio', 'video', 'file']);
const HEX = /^[a-f0-9]{64}$/i;

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * Reference-only multimodal metadata. No bytes are fetched, decoded or stored;
 * callers remain responsible for the URI and for any model-side use.
 */
export function normalizeAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('attachments must be an array');
  if (value.length > 8) throw new Error('at most 8 attachments');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`attachments[${index}] must be an object`);
    const kind = clean(item.kind ?? 'file', 20).toLowerCase();
    if (!KINDS.has(kind)) throw new Error(`attachments[${index}].kind must be image/audio/video/file`);
    const uri = clean(item.uri, 2000);
    if (!uri) throw new Error(`attachments[${index}].uri is required`);
    const out = { kind, uri };
    const name = clean(item.name, 200);
    const mime = clean(item.mime, 100);
    const sha256 = clean(item.sha256, 64);
    if (name) out.name = name;
    if (mime) out.mime = mime;
    if (item.bytes != null) {
      const bytes = Number(item.bytes);
      if (!Number.isInteger(bytes) || bytes < 0 || bytes > 1_000_000_000) throw new Error(`attachments[${index}].bytes must be 0..1e9`);
      out.bytes = bytes;
    }
    if (sha256) {
      if (!HEX.test(sha256)) throw new Error(`attachments[${index}].sha256 must be 64 hex chars`);
      out.sha256 = sha256.toLowerCase();
    }
    return out;
  });
}
