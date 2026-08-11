// ST1: the 'uploads' bucket is PRIVATE. Files are stored as storage PATHS (UploadFile returns
// the path), and displayed via short-lived signed URLs minted on demand with the viewer's
// authenticated session. This module is the single place that turns a stored value into a
// viewable URL, and the <SignedImage> / <SignedFileLink> drop-ins that use it.
//
// resolveFileUrl() is tolerant of every shape a stored value might take:
//   - a bare storage path            "2026-08-10/uuid.jpg"      -> signed
//   - a legacy public uploads URL    ".../object/public/uploads/2026-08-10/uuid.jpg" -> re-signed
//   - an already-signed uploads URL  ".../object/sign/uploads/..."                    -> re-signed
//   - an external / public-assets / data: / blob: URL           -> returned unchanged
//
// Anonymous (logged-out) pages have no storage SELECT grant, so createSignedUrl fails there —
// those pages receive already-signed URLs from a server signer instead of using this directly.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const PUBLIC_MARKER = '/storage/v1/object/public/uploads/';
const SIGN_MARKER = '/storage/v1/object/sign/uploads/';

// Resolve a stored value to { external } (use as-is) or { bucket, path } (needs a signed URL).
// Handles: an `esign:` -prefixed private path (e-sign signature images), a bare 'uploads' path, a
// legacy public/sign 'uploads' URL, and external / data: / blob: URLs.
function extractStorageRef(value) {
  if (value.startsWith('data:') || value.startsWith('blob:')) return { external: value };
  if (value.startsWith('esign:')) return { bucket: 'esign', path: value.slice(6).replace(/^\/+/, '') };
  if (/^https?:\/\//i.test(value)) {
    const pub = value.indexOf(PUBLIC_MARKER);
    if (pub !== -1) return { bucket: 'uploads', path: decodeURIComponent(value.slice(pub + PUBLIC_MARKER.length).split('?')[0]) };
    const sig = value.indexOf(SIGN_MARKER);
    if (sig !== -1) return { bucket: 'uploads', path: decodeURIComponent(value.slice(sig + SIGN_MARKER.length).split('?')[0]) };
    return { external: value }; // some other absolute URL — leave it alone
  }
  return { bucket: 'uploads', path: value.replace(/^\/+/, '') }; // a bare storage path
}

// The raw 'uploads' storage path for a stored value (a bare path or a legacy uploads URL), or null
// if the value is external / esign / empty. For delete/remove flows that operate on the uploads
// bucket and need the path, not a URL.
export function storagePathOf(value) {
  if (!value || typeof value !== 'string') return null;
  const ref = extractStorageRef(value);
  if (ref.external || ref.bucket !== 'uploads') return null;
  return ref.path || null;
}

export async function resolveFileUrl(value, { expiresIn = 3600 } = {}) {
  if (!value || typeof value !== 'string') return null;
  const { external, bucket, path } = extractStorageRef(value);
  if (external) return external;
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    console.warn('[fileUrl] could not sign', bucket, path, error?.message || error);
    return null;
  }
  return data.signedUrl;
}

// Resolve a whole array of stored values to signed URLs (drops any that fail to sign).
export async function resolveFileUrls(values, opts) {
  if (!Array.isArray(values)) return [];
  const out = await Promise.all(values.map((v) => resolveFileUrl(v, opts)));
  return out.filter(Boolean);
}

// React hook: stored value -> signed URL (null while resolving / on failure).
export function useSignedUrl(value, opts) {
  const [url, setUrl] = useState(null);
  const key = Array.isArray(value) ? value.join(',') : value;
  useEffect(() => {
    let active = true;
    if (!value) { setUrl(null); return; }
    resolveFileUrl(value, opts).then((u) => { if (active) setUrl(u); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

// Drop-in <img> replacement that signs its src on the fly. External URLs pass straight through.
export function SignedImage({ src, alt = '', fallback = null, ...props }) {
  const url = useSignedUrl(src);
  if (!url) return fallback;
  return <img src={url} alt={alt} {...props} />;
}

// Open a stored file in a new tab (signs first). Use for "View PDF" / "Download" buttons.
export async function openSignedFile(value) {
  const url = await resolveFileUrl(value);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

// Anchor-styled button that opens a signed file. Renders as a <button> so no bare href leaks.
export function SignedFileLink({ src, children, className, title, onClickBefore, ...props }) {
  return (
    <button
      type="button"
      className={className}
      title={title}
      onClick={() => { if (onClickBefore) onClickBefore(); openSignedFile(src); }}
      {...props}
    >
      {children}
    </button>
  );
}
