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
 *  3. FINAL CHECK, whatever path decided the file: the bytes about to be stored are scanned again RAW (as Latin-1,
 *     and with NULs removed). Anything key-shaped left, or a scan that cannot finish, skips the file. Every view a
 *     decode can get wrong (a UTF-32 BOM read as UTF-16, a false BOM in front of ASCII, NUL-interleaved text after
 *     the first 8 KiB) leaves the raw bytes readable here, so "nothing key-shaped is stored" holds by construction.
 *  4. By real path: the walker's check that a file's real path (symlinks resolved) stays inside the work
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
// Templates hold placeholders, not secrets: kept (the final content check still runs on them).
const TEMPLATE = /\.(example|sample|template|dist)$/i;
const DENY = [
  [/(^|\/)\.env(\.[^/]*)?$/i, 'environment file'],
  [/(^|\/)\.envrc$/i, 'environment file'],
  [/(^|\/)[^/]+\.env$/i, 'environment file'],
  [/\.(pem|key|p8|p12|pfx|jks|keystore|kdbx|keychain|keychain-db|ppk|gpg|asc|ovpn|tfstate|tfstate\.backup|tfvars|secret|token)$/i, 'key, keystore, state or secret file'],
  [/(^|\/)(authorized_keys|\.terraformrc|\.dockercfg|\.my\.cnf|logins\.json|key4\.db|cookies\.sqlite|\.(bash|zsh|sh|python|node_repl|psql|mysql)_history|\.histfile)$/i, 'credential or history file'],
  [/(^|\/)service[-_]?account[^/]*\.json$/i, 'service account key'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, 'ssh key'],
  [/(^|\/)\.(ssh|gnupg|aws|azure|kube|docker|m2|terraform\.d)\//i, 'credential folder'],
  [/(^|\/)(\.netrc|_netrc|\.npmrc|\.pypirc|\.git-credentials|\.pgpass|\.htpasswd|\.vault-token|\.boto|\.s3cfg|\.yarnrc\.yml|pip\.conf|rclone\.conf|kubeconfig)$/i, 'credential file'],
  [/(^|\/)\.git\//i, 'git internals (objects and packs carry every committed secret; config carries remote tokens)'],
  [/(^|\/)\.git$/i, 'git internals'],
  [/(^|\/)\.config\/(gh|gcloud|hub|rclone|op|doctl)\//i, 'tool auth folder'],
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
  if (TEMPLATE.test(p)) return { include: true };
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
  const at = (i, hex) => b.length >= i + hex.length / 2 && b.subarray(i, i + hex.length / 2).equals(Buffer.from(hex, 'hex'));
  if (at(0, '504b0304') || at(0, '504b0506') || at(0, '504b0708') || at(0, '504b0102')) return true;  // zip family
  if (at(0, '1f8b') || at(0, '1f9d')) return true;                                                    // gzip, compress (.Z)
  if (/^BZh[1-9]/.test(b.subarray(0, 4).toString('latin1')) && at(4, '314159265359')) return true;    // bzip2
  if (at(0, 'fd377a585a00')) return true;                                                             // xz
  if (at(0, '28b52ffd')) return true;                                                                 // zstd
  if (at(0, '377abcaf271c')) return true;                                                             // 7z
  if (at(0, '04224d18')) return true;                                                                 // lz4 frame
  if (at(0, '526172211a07')) return true;                                                             // rar
  if (at(0, '5041434b') && (at(4, '00000002') || at(4, '00000003'))) return true;                     // git pack
  if (b.subarray(0, 5).toString('latin1') === '%PDF-' && b.includes('/FlateDecode')) return true;     // PDF with deflated streams
  if (isBinary(b)) {
    // zlib (git loose objects) and lzma have weak magic: trusted only on a file that is binary anyway.
    if (b.length >= 2 && (b[0] & 0x0f) === 8 && ((b[0] << 8) | b[1]) % 31 === 0) return true;
    if (at(0, '5d0000')) return true;
    if (b.includes(Buffer.from('504b0304', 'hex')) || b.includes(Buffer.from('504b0506', 'hex'))) return true;  // a zip after a stub
  }
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

/* Latin-1 / Windows-1252 TEXT: no NUL at all, and almost no control bytes (other than tab, newline, carriage return
   and form feed). A binary with no NUL (a contrived PNG, say) has control bytes and stays binary, so it is never
   redacted in place, which would corrupt it. */
function latin1Text(buf) {
  if (buf.includes(0)) return false;
  let ctl = 0;
  for (const c of buf) if (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12) ctl++;
  return ctl <= buf.length * 0.001;
}

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

/* The FINAL check on bytes about to be stored, whatever path produced them: raw Latin-1, and with NULs removed.
   ownPlaceholders: true only for text WE masked. secretmask's placeholder (U+2022) reads as three Latin-1
   characters in the raw view and would itself look like a password (in a URL, say), so it is mapped back. That is
   safe only because a text that ALREADY held the placeholder is skipped before masking (secretmask trusts a value
   starting with it, so content could use it to hide a password). A binary is never mapped. */
function rawClean(bytes, ownPlaceholders) {
  let latin = bytes.toString('latin1');
  if (ownPlaceholders) latin = latin.replace(/\u00e2\u0080\u00a2/g, '\u2022');
  for (const s of [latin, latin.replace(/\0/g, '')]) {
    const m = mask(s);
    if (m.fired.length || withheld(m.text) || KEY_OPEN.test(s)) return false;
  }
  return true;
}
/* A binary is scanned on its printable runs only (8 or more printable ASCII bytes, as strings(1) does): a key is
   always such a run, while structured image data (HEIC, ICNS, Mach-O) made the shape patterns fire on noise and
   dropped ordinary screenshots and icons from backups (review round 3 measured 11 of 151 real files). Runs are
   taken from the raw bytes and from the bytes with NULs removed (UTF-16/32 text inside a binary). */
const PLACEHOLDER_BYTES = Buffer.from('••••', 'utf8');
/* Media and font formats, by magic: structured image, glyph and code data makes the GENERIC kinds fire on noise
   (long_token on base64 metadata, url_credential on glyph names; review rounds 3 and 4 measured both on this
   Mac's own files). For these formats only, the generic kinds are ignored; every specific detector still counts.
   Any other binary (a SQLite, LevelDB or plist store) counts them, since Azure and SendGrid keys fire only as
   long_token. */
const GENERIC_KINDS = new Set(['long_token', 'url_credential']);
function mediaOrFont(b) {
  const at = (i, hex) => b.length >= i + hex.length / 2 && b.subarray(i, i + hex.length / 2).equals(Buffer.from(hex, 'hex'));
  const ascii = (i, s) => b.length >= i + s.length && b.subarray(i, i + s.length).toString('latin1') === s;
  return at(0, '89504e470d0a1a0a') || at(0, 'ffd8ff') || ascii(0, 'GIF8') || (ascii(0, 'RIFF') && ascii(8, 'WEBP'))
    || at(0, '49492a00') || at(0, '4d4d002a') || ascii(4, 'ftyp') || ascii(0, 'icns') || ascii(0, '%PDF-')
    || at(0, 'feedfacf') || at(0, 'cffaedfe') || at(0, 'feedface') || at(0, 'cefaedfe') || at(0, 'cafebabe')
    || at(0, '00010000') || ascii(0, 'OTTO') || ascii(0, 'true') || ascii(0, 'ttcf') || ascii(0, 'wOFF') || ascii(0, 'wOF2');
}
function binaryClean(bytes) {
  // Content holding the masking placeholder could hide a password behind it (secretmask trusts it): fail closed.
  if (bytes.includes(PLACEHOLDER_BYTES)) return false;
  const media = mediaOrFont(bytes);
  const runsOf = (s) => (s.match(/[\x20-\x7e\t]{8,}/g) || []).join('\n');
  const latin = bytes.toString('latin1');
  const noNul = latin.replace(/\0/g, '');
  const views = [runsOf(latin), runsOf(noNul)];
  // A key split by one control byte breaks a run (or drops a short prefix run): for non-media binaries, also read
  // the bytes with every non-printable byte deleted. Not for media: deleting them stitches image noise together.
  if (!media) views.push(latin.replace(/[^\x20-\x7e\t\n]/g, ''));
  for (const s of views) {
    const m = mask(s);
    const counted = m.fired.filter((f) => !(media && GENERIC_KINDS.has(f.kind)));
    // withheld: defence in depth (a withheld search also fires split_search_limit, which is counted)
    if (counted.length || withheld(m.text) || KEY_OPEN.test(s)) return false;
  }
  return !KEY_OPEN.test(latin) && !KEY_OPEN.test(noNul);
}

const PLACEHOLDER_RUN = '\u2022\u2022\u2022\u2022';
function storeOrSkip(buf, text, kinds, encode) {
  // Content already holding secretmask's placeholder could use it to hide a password (secretmask trusts a value
  // that starts with it): fail closed.
  if (text.includes(PLACEHOLDER_RUN)) return { action: 'skip', why: 'text that already holds the masking placeholder' };
  const masked = maskText(text, kinds);
  if (masked === null) return { action: 'skip', why: 'text that could not be fully checked' };
  const redacted = [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind));
  const data = redacted.length ? encode(masked) : buf;
  if (!data) return { action: 'skip', why: 'could not write the redacted text back' };
  if (!rawClean(data, true)) return { action: 'skip', why: 'something shaped like a credential is still readable in the bytes' };
  return { action: 'store', data, redacted };
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
      // No NUL near the start and only invalid UTF-8: most likely Latin-1 / Windows-1252 text. Decode it as such
      // and redact it (Latin-1 round-trips every byte), rather than skipping the whole file.
      if (latin1Text(buf)) {
        // U+2022 has no Latin-1 byte (it would truncate to 0x22, a quote): the marker is written as '*' instead.
        return storeOrSkip(buf, buf.toString('latin1'), kinds, (s) => Buffer.from(s.replace(/\u2022/g, '*'), 'latin1'));
      }
      if (!binaryClean(buf)) return { action: 'skip', why: 'binary file holding something shaped like a credential, or that could not be checked' };
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
