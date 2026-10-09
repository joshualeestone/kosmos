/**
 * kosmos#5535 (E0.6, Enterprise backup) slice 3, its first pure part: what may leave the Mac in a backup.
 * Design v2 / v2.1 on #5535: "never credentials", enforced twice, and REDACT IN PLACE rather than drop, so a
 * transcript with one pasted token keeps its content. FAIL CLOSED: a file that cannot be checked is skipped and
 * recorded by name, never stored unchecked.
 *
 *  1. By path: a deny-list of credential-shaped paths (env files, keys and keystores, provider and tool auth
 *     files, cloud and package-manager credentials, Terraform state, Kosmos's own secrets folder and key and token
 *     stores, git internals, browser profile stores), and compressed containers, whose contents cannot be scanned.
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
 * take the word and line break after a masked key with it, and its long_token pattern rewrites long path-like runs in
 * ordinary text (review round 9: 228 of 6,833 repo files changed, e.g. a long plan-file name became a mark). Over-
 * redaction is the safe direction; exempting paths could leak a token in a path segment. A file where nothing
 * fires is stored byte for byte.
 *
 * What is recorded: per file, the action, and for a redaction the kinds and counts of what was removed. Never a
 * value, and never where in the file it sat (a position plus the file is a hint at the value).
 */
const path = require('path');
const { mask, WITHHELD, UNCHECKED } = require('./secretmask');

const CONFIGISH = '(json|ya?ml|toml|ini|txt|conf|cfg|xml|properties|csv)';
// Credential-shaped paths, matched case-insensitively on a forward-slash relative path.
// Templates hold placeholders, not secrets: kept (the final content check still runs on them).
const TEMPLATE = /\.(example|sample|template|dist)$/i;
// #5686 (measured on a real data root): Kosmos's own credential stores outside its secrets folder. The data root is
// inside a named world, so a world snapshot walks past these: per-agent board tokens (engine/sendertoken.js), the
// supervisor's launch secrets (bin/agent-supervisor.sh), each agent's Kosmos+ community key (engine/communitysend.js
// keysFile), this board's sealing key and room keys (engine/fedseal.js), the Mac's tunnel signing keys (mac_key,
// engine/remote.js; install_key, the connector: kosmos-relay crates/tunnel/src/assistant.rs), the phone notify-only
// token (engine/phonenotify.js) and a provider account's API key file (claudeaccounts, geminiaccounts, grokaccounts).
// 🔑 The content scan stores several of these as they are (measured: mac_key, phone-notify.json), so the NAME is the
// only defence, and a copy under a name a writer, editor or Finder gives it must be denied too. So each store name
// is matched as a TOKEN anywhere in a file name, in ANY folder: bounded on both sides by the start or end of the
// name or by a character that is not a letter or digit (STORE_NAME). That denies `.mac_key.tmp-9`, `mac_key copy`,
// `#board.token#` and `remote copy/mac_key`, while `keyboard.tokens.csv` or `imac_keyboard.md` are ordinary. A store
// FOLDER is matched the same way, as a token in a folder name (`sendertokens.bak/`, `old sendertokens/`,
// `communitysend copy/`), and in a community folder any file named with the token `keys` is a key file
// (`keys.json`, `keys.bak.json`). Cost, on the safe side: a person's own file or folder whose name holds one of these
// store names as a whole token (`mac_key-notes.md`, `chats/mac_key-chat.jsonl`, a project's own `communitysend/keys.json`).
const TOKEN = (name) => `([^/]*[^a-z0-9/])?${name}([^a-z0-9/][^/]*)?`;
const STORE_NAME = (name) => new RegExp(`(^|\\/)${TOKEN(name)}$`, 'i');
const STORE_FOLDER = (name) => new RegExp(`(^|\\/)${TOKEN(name)}\\/`, 'i');
/* Two linear tests rather than one pattern with `(.*\/)?` in it, which is quadratic on a path repeating the folder. */
const COMMUNITY_DIR = STORE_FOLDER('communitysend');
const KEYS_FILE = STORE_NAME('keys');
const KOSMOS_STORES = [
  [STORE_FOLDER('sendertokens'), 'Kosmos agent tokens'],
  [STORE_FOLDER('launch-secrets'), 'Kosmos launch secrets'],
  [{ test: (p) => COMMUNITY_DIR.test(p) && KEYS_FILE.test(p) }, 'Kosmos+ community agent keys'],
  [STORE_NAME('fed-seal-(key|rooms)'), 'Kosmos room sealing keys'],
  [STORE_NAME('board\\.token'), 'Kosmos board token'],
  [STORE_NAME('(mac_key|install_key)'), 'Kosmos Mac signing key'],
  [STORE_NAME('phone-notify'), 'Kosmos phone notify token'],
  [STORE_NAME('\\.?kosmos-[a-z0-9]+-apikey'), 'provider API key'],
];

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
  [/(^|\/)\.claude(-[^/]*)?\/\.credentials\.json$/i, 'provider sign-in'],  // review 7: an extra account's ~/.claude-<label> too
  [/(^|\/)\.(codex|gemini|grok)(-[^/]*)?\/(auth|oauth_creds|credentials)[^/]*$/i, 'provider sign-in'],
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
  // Kosmos's own stores are judged BEFORE the template exemption: `mac_key.example` or `board.token.sample` is a copy
  // of a key the content scan cannot see, never a template.
  for (const [re, why] of KOSMOS_STORES) if (re.test(p)) return { include: false, why };
  if (TEMPLATE.test(p)) return { include: true };
  for (const [re, why] of DENY) if (re.test(p)) return { include: false, why };
  const origins = tempOrigins(p);
  if (origins === null) return { include: false, why: 'a temp or backup copy with a name too long to check' };
  for (const origin of origins) {
    for (const [re, why] of DENY) if (re.test(origin)) return { include: false, why: `${why} (a temp copy being written)` };
  }
  return { include: true };
}

/* #5686 review 3: a writer's temp copy is named AROUND the file it replaces, so a rule anchored on the end of the
   name never sees it: `.tls.key.tmp` (the connector's atomic writes), `auth.json.kosmos-<pid>-t<n>-...tmp`
   (engine/securewrite.js), `signin-device.key.new-<pid>-<hex>`, an editor's `.id_rsa.swp` or `id_rsa~`, a download's
   `id_rsa (1)`. So a COPY-SHAPED name (see COPY_SHAPED) is also judged as every name it could be a copy of: each
   leading run of it up to a '.', '-', '_', '~' or space, with and without a leading dot. A tail after the ending (a pid,
   a random suffix: `.tmp-k3j9z`, `.bak2`) is accepted when it carries a digit, so `secrets.new-approach.md` is ordinary.
   What this does NOT cover, said so nobody reads it as complete: a copy whose ending is not in COPY_SHAPED, and a copy
   named IN FRONT of its origin (emacs `#id_rsa#` and `.#id_rsa`, `tmp-id_rsa`), and a tail with no digit in it
   (`.tmp-abcxyz`). For Kosmos's own stores the token and
   folder rules above (STORE_NAME, STORE_FOLDER) need none of this; for other credentials the content scan and the final raw check
   stand behind it (a PEM key, for one, is found by its content whatever the file is called).
   Over-skip, on the safe side: an origin is judged by EVERY deny rule, so a copy of ordinary work whose name starts
   like a denied one is skipped too, even when the uncopied name would be kept (secrets_plan.tmp,
   cookies-recipe.md.tmp, contract.docx.bak, .git-blame.bak, server.key.md.bak although server.key.md is kept,
   .env.example.bak although .env.example is kept: the template exemption is not applied to an origin).
   Bounded (review 4, review 7): the tail repeats only after a separator, so COPY_SHAPED cannot backtrack
   exponentially, and a name longer than any filesystem allows is judged on its last 64 characters before the regex
   sees it. A copy-shaped name over 255 characters is skipped outright, so at most 510 leading runs are
   tried and a hostile name cannot make the scan quadratic. (Filesystems cap a name in bytes, not characters; this caps
   the work, and a real name over it is rare and skipped on the safe side.) */
const COPY_SHAPED = /(\.(tmp|temp|part|swp|swo|swx|bak|backup|old|orig|save|prev|new)\d*([-.](?=[a-z]*\d)[0-9a-z]+)*|~|\.\d+| \d+| copy( \d+)?| \(\d+\))$/i;
const MAX_COPY_NAME = 255;
function tempOrigins(p) {
  const cut = p.lastIndexOf('/') + 1;
  const dir = p.slice(0, cut);
  const base = p.slice(cut);
  if (base.length > 4 * MAX_COPY_NAME) return COPY_SHAPED.test(base.slice(-64)) ? null : [];
  if (!COPY_SHAPED.test(base)) return [];
  if ([...base].length > MAX_COPY_NAME) return null;
  const out = new Set();
  for (const b of base.startsWith('.') ? [base, base.slice(1)] : [base]) {
    for (let i = 1; i < b.length; i++) if ('.-_~ '.includes(b[i])) out.add(dir + b.slice(0, i));
  }
  return [...out];
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
    if (!mediaKind(b) && appendedZip(b)) return true;  // a zip after a stub (a self-extractor, a jar)
  }
  return false;
}

/* A zip appended after a stub is recognized by a WELL-FORMED end-of-central-directory record that closes the file
   (its comment length reaches the end), not by four signature bytes anywhere: in a large compressed media file
   those occur by chance (a real screenshot in this repo had PK\x05\x06 at offset 124094). */
function appendedZip(b) {
  const sig = Buffer.from('504b0506', 'hex');
  const from = Math.max(0, b.length - 65557);
  for (let pos = b.lastIndexOf(sig); pos >= from; pos = pos > 0 ? b.lastIndexOf(sig, pos - 1) : -1) {
    if (pos + 22 <= b.length && pos + 22 + b.readUInt16LE(pos + 20) === b.length) return true;
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
/* Media and font formats, by magic, each with the GENERIC kinds it may ignore. Structured image, glyph and code
   data makes generic kinds fire on noise: long_token on base64 metadata (images) and on 39% of Mach-O files,
   url_credential on glyph names (fonts; it fires on only 3 of 1,377 Mach-O files, so code keeps it). Every
   SPECIFIC detector still counts everywhere. Any other binary (SQLite, LevelDB, plist stores) counts both,
   since Azure and SendGrid keys fire only as long_token. Magics are checked strictly (PNG needs IHDR, a font a
   sane table count, ISO media a known image brand), so a store cannot pass as media by a short prefix by chance.
   Residual, stated: a long_token-only key compiled into a Mach-O (or a Java .class, which shares cafebabe), a
   url_credential inside a font, a store crafted with real media headers, or a zip appended to a real image
   (a polyglot), passes; the threat model is accidental secrets in ordinary work, not a user hiding them from their employer. */
const ISO_IMAGE_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis']);
const ISO_AV_BRANDS = new Set(['M4A ', 'M4V ', 'mp41', 'mp42', 'isom', 'qt  ']);
function mediaKind(b) {
  const at = (i, hex) => b.length >= i + hex.length / 2 && b.subarray(i, i + hex.length / 2).equals(Buffer.from(hex, 'hex'));
  const ascii = (i, s) => b.length >= i + s.length && b.subarray(i, i + s.length).toString('latin1') === s;
  const tables = () => b.length >= 6 && b.readUInt16BE(4) >= 4 && b.readUInt16BE(4) <= 64;
  if (at(0, '89504e470d0a1a0a') && ascii(12, 'IHDR')) return 'image';
  if (at(0, 'ffd8ff') || ascii(0, 'GIF87a') || ascii(0, 'GIF89a') || (ascii(0, 'RIFF') && ascii(8, 'WEBP'))) return 'image';
  if (at(0, '49492a00') || at(0, '4d4d002a') || ascii(0, 'icns')) return 'image';
  if (ascii(0, 'BM') && b.length >= 18 && [12, 40, 52, 56, 64, 108, 124].includes(b.readUInt32LE(14))) return 'image';   // BMP: its DIB header size
  if (at(0, '00000100') && b.length >= 6 && b.readUInt16LE(4) >= 1 && b.readUInt16LE(4) <= 64) return 'image';         // ICO: a sane image count
  if (ascii(4, 'ftyp') && ISO_IMAGE_BRANDS.has(b.subarray(8, 12).toString('latin1'))) return 'image';
  // Audio and video: sample data fires long_token like image data (review round 6 measured 10 of 17 real system
  // sounds skipped). Strict magics: the container AND its form or brand.
  if ((ascii(0, 'FORM') && (ascii(8, 'AIFF') || ascii(8, 'AIFC'))) || (ascii(0, 'RIFF') && ascii(8, 'WAVE')) || ascii(0, 'caff')
    || (ascii(0, 'ID3') && b.length > 3 && b[3] >= 2 && b[3] <= 4) || (ascii(4, 'ftyp') && ISO_AV_BRANDS.has(b.subarray(8, 12).toString('latin1')))
    || (ascii(0, 'OggS') && b.length > 4 && b[4] === 0) || ascii(0, 'fLaC')) return 'audio';
  if (at(0, 'feedfacf') || at(0, 'cffaedfe') || at(0, 'feedface') || at(0, 'cefaedfe') || at(0, 'cafebabe')) return 'code';
  if (at(0, '0061736d01000000')) return 'code';   // WebAssembly, version 1
  if (((at(0, '00010000') || ascii(0, 'OTTO') || ascii(0, 'true')) && tables()) || ascii(0, 'ttcf') || ascii(0, 'wOFF') || ascii(0, 'wOF2')) return 'font';
  return null;
}
const IGNORED_KINDS = { image: new Set(['long_token']), audio: new Set(['long_token']), code: new Set(['long_token']), font: new Set(['long_token', 'url_credential']) };
function binaryClean(bytes) {
  // Content holding the masking placeholder could hide a password behind it (secretmask trusts it): fail closed.
  if (bytes.includes(PLACEHOLDER_BYTES)) return false;
  const media = mediaKind(bytes);
  const runsOf = (s) => (s.match(/[\x20-\x7e\t]{8,}/g) || []).join('\n');
  // Adobe XMP in media writes xmpDM:key="..." attributes, which fire assigned_secret (8 of 42 system .mov files).
  // Only that attribute's NAME is removed, for media kinds: its value and the rest of the packet are still scanned,
  // so a key pasted into any field skips the file. (Round 9 dropped the packet, round 10 the value: both leaked.)
  const dropXmp = (s) => (media ? s.replace(/xmpDM:key=(?=")/g, ' ') : s);  // the attribute NAME only: its value is still scanned
  const latin = dropXmp(bytes.toString('latin1'));
  const noNul = latin.replace(/\0/g, '');
  const views = [runsOf(latin), runsOf(noNul)];
  // A key split by one control byte breaks a run (or drops a short prefix run): for non-media binaries, also read
  // the bytes with every non-printable byte deleted. Not for media: deleting them stitches image noise together.
  if (!media) views.push(latin.replace(/[^\x20-\x7e\t\n]/g, ''));
  for (const s of views) {
    const m = mask(s);
    const counted = m.fired.filter((f) => !(media && IGNORED_KINDS[media].has(f.kind)));
    // withheld: defence in depth (a withheld search also fires split_search_limit, which is counted)
    if (counted.length || withheld(m.text) || KEY_OPEN.test(s)) return false;
  }
  return !KEY_OPEN.test(latin) && !KEY_OPEN.test(noNul);  // defence in depth: secretmask's private_key also fires on a bare opening
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
