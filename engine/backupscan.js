/**
 * kosmos#5535 (E0.6, Enterprise backup) slice 3, its first pure part: what may leave the Mac in a backup.
 * Design v2 / v2.1 on #5535: "never credentials", enforced twice, and REDACT IN PLACE rather than drop, so a
 * transcript with one pasted token keeps everything but the token. FAIL CLOSED: a file that cannot be checked
 * is skipped and recorded by name, never stored unchecked.
 *
 *  1. By path: a deny-list of credential-shaped paths (env files, keys and keystores, provider and
 *     tool auth files, git and package-manager credentials, Kosmos's own secrets folder). Also compressed
 *     archives: their contents cannot be scanned, so they are skipped by name.
 *  2. By content: the scan, reusing engine/secretmask.js (the hardened detector the setup guide
 *     relies on), never a second set of patterns.
 *     - TEXT: PEM private-key blocks are cut whole first (they span lines), then the whole text is masked. When
 *       secretmask withholds a long text (its search budget is sized for chat), it is masked line by line; a
 *       line still withheld skips the file.
 *     - BINARY (a NUL in the first 8 KiB, or bytes that are not UTF-8): it cannot be redacted without breaking it,
 *       so it is stored only if a scan of its bytes as Latin-1 finds nothing; any hit, or a withheld scan, skips it.
 *  3. By real path: the walker's check that a file's real path (symlinks resolved) stays inside the
 *     work Kosmos, so a link cannot sweep ~/.ssh in.
 *
 * What is recorded: per file, the action, and for a redaction the kinds and counts of what was removed. Never a
 * value, and never where in the file it sat (a position plus the file is a hint at the value).
 */
const path = require('path');
const { mask, WITHHELD, UNCHECKED } = require('./secretmask');

// Credential-shaped paths, matched case-insensitively on a forward-slash relative path.
const DENY = [
  [/(^|\/)\.env(\.[^/]*)?$/i, 'environment file'],
  [/\.(pem|key|p12|pfx|jks|keystore|kdbx|keychain|keychain-db|ppk|gpg|asc|ovpn)$/i, 'key or keystore'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, 'ssh key'],
  [/(^|\/)\.(ssh|gnupg|aws|azure|kube|docker)\//i, 'credential folder'],
  [/(^|\/)(\.netrc|_netrc|\.npmrc|\.pypirc|\.git-credentials|\.pgpass|\.htpasswd)$/i, 'credential file'],
  [/(^|\/)\.git\/config$/i, 'git config (remote URLs can carry tokens)'],
  [/(^|\/)\.config\/(gh|gcloud|hub)\//i, 'tool auth folder'],
  [/(^|\/)\.claude\/\.credentials\.json$/i, 'provider sign-in'],
  [/(^|\/)\.(codex|gemini|grok)\/(auth|oauth_creds|credentials)[^/]*$/i, 'provider sign-in'],
  [/(^|\/)(credentials?|secrets?|tokens?|auth)(\.[a-z0-9]+)?$/i, 'credential-named file'],
  [/(^|\/)secrets\//i, 'secrets folder'],
  [/\.(zip|gz|tgz|bz2|xz|7z|rar|zst|lz4|dmg|jar)$/i, 'compressed archive (contents cannot be scanned)'],
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
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(path.sep)[0] !== '..');
}

const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]{0,20000}?-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g;
const PEM_OPEN = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----/;
const REDACTED_PEM = '-----KOSMOS BACKUP REMOVED A PRIVATE KEY-----';

const withheld = (t) => t === WITHHELD || t === UNCHECKED;
function addFired(into, fired) { for (const f of fired || []) into.set(f.kind, (into.get(f.kind) || 0) + (f.count || 1)); }

function isBinary(buf) {
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) return true;
  return !Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);  // not valid UTF-8 (a lossy decode changes it)
}

function maskText(text, kinds) {
  // PEM private keys first, whole, wherever they are: they span lines, so a per-line pass could not catch them.
  let pem = 0;
  let t = text.replace(PEM_BLOCK, () => { pem++; return REDACTED_PEM; });
  if (PEM_OPEN.test(t)) return null;  // an opening with no end: cannot tell how much is key, so skip the file
  if (pem) kinds.set('private_key', (kinds.get('private_key') || 0) + pem);
  const whole = mask(t);
  if (!withheld(whole.text)) { addFired(kinds, whole.fired); return whole.text; }
  // Too long for one search: line by line (secretmask's budget is sized for chat, not for transcripts).
  const out = [];
  for (const line of t.split('\n')) {
    const m = mask(line);
    if (withheld(m.text)) return null;
    addFired(kinds, m.fired);
    out.push(m.text);
  }
  return out.join('\n');
}

/**
 * Decide and redact one file's bytes. Returns
 *   { action: 'store', data, redacted: [{ kind, count }] }   (data may equal buf when nothing was found)
 *   { action: 'skip', why }
 * Never throws: anything unexpected skips the file.
 */
function scanFile(rel, buf) {
  try {
    const p = pathDecision(rel);
    if (!p.include) return { action: 'skip', why: p.why };
    if (!Buffer.isBuffer(buf)) return { action: 'skip', why: 'unreadable' };
    const kinds = new Map();
    if (isBinary(buf)) {
      const m = mask(buf.toString('latin1'));
      if (withheld(m.text)) return { action: 'skip', why: 'binary file that could not be checked' };
      if (m.fired.length || PEM_OPEN.test(buf.toString('latin1'))) return { action: 'skip', why: 'binary file holding something shaped like a credential' };
      return { action: 'store', data: buf, redacted: [] };
    }
    const masked = maskText(buf.toString('utf8'), kinds);
    if (masked === null) return { action: 'skip', why: 'text that could not be fully checked' };
    const redacted = [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind));
    return { action: 'store', data: redacted.length ? Buffer.from(masked, 'utf8') : buf, redacted };
  } catch {
    return { action: 'skip', why: 'could not be checked' };
  }
}

module.exports = {
  pathDecision,
  insideWorkKosmos,
  scanFile,
};
