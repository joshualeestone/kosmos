'use strict';
/**
 * kosmos#7352: App Store Connect refuses an upload (ITMS-91053) when the app uses a required-reason API that its
 * privacy manifest (ios/Kosmos/PrivacyInfo.xcprivacy) does not declare. This reads the iPhone sources for each
 * category's APIs and fails when one is used but the manifest does not name the category, so a new use is caught
 * here rather than at upload.
 *
 *   node --test ios.privacy-manifest-7352.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const IOS = path.join(__dirname, 'ios');
const MANIFEST = path.join(IOS, 'Kosmos', 'PrivacyInfo.xcprivacy');
/* Apple's required-reason categories and the Swift spellings that use them. */
const CATEGORIES = {
  NSPrivacyAccessedAPICategoryUserDefaults: /UserDefaults\b|@AppStorage\b/,
  NSPrivacyAccessedAPICategoryFileTimestamp: /\b(creationDate|contentModificationDate|modificationDate|fileModificationDate|attributesOfItem|f?getattrlist\w*|st_mtime\w*|st_ctime\w*)\b|\b(f?stat|fstatat|lstat)\s*\(/,
  NSPrivacyAccessedAPICategorySystemBootTime: /\b(systemUptime|mach_absolute_time)\b/,
  NSPrivacyAccessedAPICategoryDiskSpace: /\b(volumeAvailableCapacity\w*|volumeTotalCapacity\w*|systemFreeSize|systemSize|f?statfs|f?statvfs|attributesOfFileSystem)\b/,
  NSPrivacyAccessedAPICategoryActiveKeyboards: /\bactiveInputModes\b/,
};

function swiftFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'LogicTests' && !e.name.endsWith('.xcodeproj')) out.push(...swiftFiles(p)); }
    else if (e.name.endsWith('.swift')) out.push(p);
  }
  return out;
}

/* Comments are removed first, so a comment naming an API is not a use of it. String literals are skipped over
   (kept), so a "https://" inside one is not read as the start of a comment. */
function code(file) {
  const src = fs.readFileSync(file, 'utf8');
  return src.replace(/"(?:\\.|[^"\\\n])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ''));
}

/* The manifest without its XML comments, so a commented-out entry does not count as declared. */
function manifestText() {
  return fs.readFileSync(MANIFEST, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
}

test('kosmos#7352: every required-reason API the iPhone app uses is declared in its privacy manifest', () => {
  const manifest = manifestText();
  const files = swiftFiles(IOS);
  assert.ok(files.length > 20, `the iPhone sources were found (${files.length} Swift files)`);
  const sources = files.map((f) => [f, code(f)]);
  for (const [category, uses] of Object.entries(CATEGORIES)) {
    const users = sources.filter(([, text]) => uses.test(text)).map(([f]) => path.relative(__dirname, f));
    if (users.length) assert.ok(manifest.includes(`<string>${category}</string>`), `${category} is used (${users.join(', ')}) but not declared in ${path.relative(__dirname, MANIFEST)}`);
  }
});

test('kosmos#7352: UserDefaults is in use today, so the check is aimed at something real', () => {
  const used = swiftFiles(IOS).some((f) => CATEGORIES.NSPrivacyAccessedAPICategoryUserDefaults.test(code(f)));
  assert.ok(used, 'no UserDefaults use found: the category patterns may have stopped matching');
});

test('kosmos#7352: the UserDefaults reason is CA92.1 (this app only, no app-group suite)', () => {
  const manifest = manifestText();
  assert.match(manifest, /NSPrivacyAccessedAPICategoryUserDefaults<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>CA92\.1<\/string>/);
  const suite = swiftFiles(IOS).filter((f) => /UserDefaults\(\s*suiteName/.test(code(f)));
  assert.deepEqual(suite, [], 'an app-group UserDefaults suite needs reason 1C8F.1 added to the manifest');
});
