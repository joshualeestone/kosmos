/**
 * kosmos#5535 (E0.6, Enterprise backup) slice 3, its first pure part: what may leave the Mac in a backup.
 * Design v2 / v2.1 on #5535: "never credentials", enforced twice, and REDACT IN PLACE rather than drop, so a
 * transcript with one pasted token keeps its content. FAIL CLOSED: a file that cannot be checked is skipped and
 * recorded by name, never stored unchecked.
 *
 *  1. By path: a deny-list of credential-shaped paths (env files, keys and keystores, provider and tool auth
 *     files, cloud and package-manager credentials, Terraform state, Kosmos's own secrets folder, git internals,
 *     browser profile stores), and compressed containers, whose contents cannot be scanned.
 *  2. By content: the scan, reusing engine/secretmask.js (the hardened detector the setup guide relies on),
 *     never a second set of patterns.
 *     - Compressed bytes (zip, gzip, zlib, bzip2, xz, zstd, 7z, a git pack, a PDF with Flate streams) are skipped
 *       by their magic, whatever the file is called: a scan cannot read deflated bytes.
 *     - UTF-16 text (a BOM, or every other byte NUL) is decoded and scanned as text, and written back in the
 *       same encoding when something is removed.
 *     - Other text: PEM and PGP private-key blocks are cut whole first (they span lines), then the whole text
 *       is masked. When secretmask withholds it (its known-secret search could not finish), the file is skipped:
 *       no fallback, because every partial pass loses detection secretmask has across lines.
 *     - Binary: stored only if scans of its bytes as Latin-1, and with NULs removed, find nothing.
 *  3. By real path: the walker's check that a file's real path (symlinks resolved) stays inside the work
 *     Kosmos, so a link cannot sweep ~/.ssh in.
 *
 * KNOWN, TESTED LOSS when something is removed: secretmask rewrites the text it masks, so a redacted file also
 * loses invisible format characters (a UTF-8 BOM, zero-width joiners, soft hyphens), and its split-key logic can
 * take the word and line break after a masked key with it. A file where nothing fires is stored byte for byte.
 *
 * What is recorded: per file, the action, and for a redaction the kinds and counts of what was removed. Never a
 * value, and never where in the file it sat (a position plus the file is a hint at the value).
 */
const path = require('path');
const { mask, WITHHELD, UNCHECKED } = require('./secretmask');

const CONFIGISH = '(json|ya?ml|toml|ini|txt|conf|cfg|xml|properties)';
// Credential-shaped paths, matched case-insensitively on a forward-slash relative path.
const DENY = [
  [/(^|\/)\.env(\.[^/]*)?$/i, 'environment file'],
  [/(^|\/)\.envrc$/i, 'environment file'],
  [/(^|\/)[^/]+\.env$/i, 'environment file'],
  [/\.(pem|key|p8|p12|pfx|jks|keystore|kdbx|keychain|keychain-db|ppk|gpg|asc|ovpn|tfstate|tfstate\.backup)$/i, 'key, keystore or state file'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, 'ssh key'],
  [/(^|\/)\.(ssh|gnupg|aws|azure|kube|docker|m2|terraform\.d)\//i, 'credential folder'],
  [/(^|\/)(\.netrc|_netrc|\.npmrc|\.pypirc|\.git-credentials|\.pgpass|\.htpasswd|\.vault-token|\.boto|\.s3cfg|\.yarnrc\.yml|pip\.conf|rclone\.conf|kubeconfig)$/i, 'credential file'],
  [/(^|\/)\.git\//i, 'git internals (objects and packs carry every committed secret; config carries remote tokens)'],
  [/(^|\/)\.git$/i, 'git internals'],
  [/(^|\/)\.config\/(gh|gcloud|hub|rclone)\//i, 'tool auth folder'],
  [/(^|\/)\.claude\/\.credentials\.json$/i, 'provider sign-in'],
  [/(^|\/)\.(codex|gemini|grok)\/(auth|oauth_creds|credentials)[^/]*$/i, 'provider sign-in'],
  [new RegExp(`(^|\\/)(credentials?|secrets?|tokens?|auth)(\\.[a-z0-9]+)*\\.${CONFIGISH}$`, 'i'), 'credential-named config file'],
  [/(^|\/)(credentials?|secrets?)$/i, 'credential-named file'],
  [/(^|\/)client_secret[^/]*\.json$/i, 'OAuth client secret'],
  [/(^|\/)secrets\//i, 'secrets folder'],
  [/(^|\/)(cookies|login data|web data|local state)(-journal)?$/i, 'browser profile store'],
  [/\.(zip|gz|tgz|bz2|xz|7z|rar|zst|lz4|dmg|jar|war|whl|apk|ipa|docx|xlsx|pptx|odt|ods|odp|epub|pages|numbers)$/i, 'compressed container (contents cannot be scanned)'],
];

/** Decide by path alone. Returns { include: true } or { include: false, why }. rel uses '/' or the OS separator. */
function pathDecision(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return { include: false, why: 'unusable path' };
  const p = rel.split(path.sep).join('/');
  if (p.startsWith('/') || p.split('/').includes('..')) return { include: false, why: 'path outside the work Kosmos' };
  for (const [re, why] of DENY) if (re.test(p)) return { include: false, why };
  return { include: true };
}

/** True when realPath (symlinks already resolved) is root itself or inside it. Both absolute. */
function insideWorkKosmos(realPath, rootReal) {
  if (!path.isAbsolute(realPath) || !path.isAbsolute(rootReal)) return false;
  const rel = path.relative(rootReal, realPath);
  return rel === '' || (!path.isAbsolute(rel) && rel.split(path.sep)[0] !== '..');
}

const KEY_BLOCK = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY( BLOCK)?-----[\s\S]{0,20000}?-----END [A-Z0-9 ]{0,40}PRIVATE KEY( BLOCK)?-----/g;
const KEY_OPEN = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY( BLOCK)?-----|PuTTY-User-Key-File-/;
const REDACTED_KEY = '-----KOSMOS BACKUP REMOVED A PRIVATE KEY-----';

const withheld = (t) => t === WITHHELD || t === UNCHECKED;
function addFired(into, fired) { for (const f of fired || []) into.set(f.kind, (into.get(f.kind) || 0) + (f.count || 1)); }

function compressed(b) {
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)) return true;  // zip family
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return true;                                          // gzip
  if (b.length >= 2 && b[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(b[1])) return true;                // zlib (git loose objects)
  if (b.length >= 3 && b.subarray(0, 3).toString('latin1') === 'BZh') return true;                           // bzip2
  if (b.length >= 6 && b.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))) return true;  // xz
  if (b.length >= 4 && b.readUInt32LE(0) === 0xfd2fb528) return true;                                        // zstd
  if (b.length >= 6 && b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return true;  // 7z
  if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === 'PACK') return true;                         // git pack
  if (b.subarray(0, 5).toString('latin1') === '%PDF-' && b.includes('/FlateDecode')) return true;            // PDF with deflated streams
  return false;
}

/** 'le' | 'be' | null: a BOM, or (no BOM) a text whose odd or even bytes are almost all NUL. */
function utf16(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'be';
  const n = Math.min(buf.length, 8192) & ~1;
  if (n < 16) return null;
  let oddNul = 0, evenNul = 0;
  for (let i = 0; i < n; i += 2) { if (buf[i] === 0) evenNul++; if (buf[i + 1] === 0) oddNul++; }
  const half = n / 2;
  if (oddNul > 0.9 * half && evenNul < 0.1 * half) return 'le';
  if (evenNul > 0.9 * half && oddNul < 0.1 * half) return 'be';
  return null;
}
const swap16 = (b) => { if (b.length % 2) return null; const c = Buffer.from(b); c.swap16(); return c; };

function isBinary(buf) {
  if (buf.subarray(0, 8192).includes(0)) return true;
  return !Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);  // not valid UTF-8 (a lossy decode changes it)
}

function maskText(text, kinds) {
  // Private keys first, whole, wherever they are: they span lines.
  let keys = 0;
  const t = text.replace(KEY_BLOCK, () => { keys++; return REDACTED_KEY; });
  if (KEY_OPEN.test(t)) return null;  // an opening with no end (or a PuTTY key): cannot bound it, so skip the file
  if (keys) kinds.set('private_key', (kinds.get('private_key') || 0) + keys);
  const whole = mask(t);
  /* WITHHELD or UNCHECKED: secretmask could not finish its search for the board's known secrets. No fallback:
     a line-by-line pass loses its multi-line detection of a held value split across lines (review round 1
     measured it), and an overlapping-window pass was slow (seconds per file) and failed on the same inputs anyway.
     This only happens with held secrets plus text dense with near-matches; plain text up to 2 MB never withholds
     (measured), so real transcripts rarely reach it. When one does, it is skipped by name, never stored unchecked. */
  if (withheld(whole.text)) return null;
  addFired(kinds, whole.fired);
  return whole.text;
}

function storeOrSkip(buf, text, kinds, encode) {
  const masked = maskText(text, kinds);
  if (masked === null) return { action: 'skip', why: 'text that could not be fully checked' };
  const redacted = [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind));
  if (!redacted.length) return { action: 'store', data: buf, redacted };
  const data = encode(masked);
  return data ? { action: 'store', data, redacted } : { action: 'skip', why: 'could not write the redacted text back' };
}

/**
 * Decide and redact one file's bytes. Returns
 *   { action: 'store', data, redacted: [{ kind, count }] }   (data is buf itself when nothing was found)
 *   { action: 'skip', why }
 * Never throws: anything unexpected skips the file.
 */
function scanFile(rel, buf) {
  try {
    const p = pathDecision(rel);
    if (!p.include) return { action: 'skip', why: p.why };
    if (!Buffer.isBuffer(buf)) return { action: 'skip', why: 'unreadable' };
    if (compressed(buf)) return { action: 'skip', why: 'compressed content (cannot be scanned)' };
    const kinds = new Map();
    const u16 = utf16(buf);
    if (u16) {
      const bom = (u16 === 'le' && buf[0] === 0xff && buf[1] === 0xfe) || (u16 === 'be' && buf[0] === 0xfe && buf[1] === 0xff);
      const le = u16 === 'le' ? buf : swap16(buf);
      if (!le || le.length % 2) return { action: 'skip', why: 'UTF-16 text of odd length' };
      const text = le.subarray(bom ? 2 : 0).toString('utf16le');
      return storeOrSkip(buf, text, kinds, (s) => {
        const out = Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(s, 'utf16le')]);
        return u16 === 'le' ? out : swap16(out);
      });
    }
    if (isBinary(buf)) {
      const latin = buf.toString('latin1');
      for (const s of [latin, latin.replace(/\0/g, '')]) {
        const m = mask(s);
        if (m.fired.length || withheld(m.text) || KEY_OPEN.test(s)) return { action: 'skip', why: 'binary file holding something shaped like a credential, or that could not be checked' };
      }
      return { action: 'store', data: buf, redacted: [] };
    }
    return storeOrSkip(buf, buf.toString('utf8'), kinds, (s) => Buffer.from(s, 'utf8'));
  } catch {
    return { action: 'skip', why: 'could not be checked' };
  }
}

module.exports = {
  pathDecision,
  insideWorkKosmos,
  scanFile,
};
