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
  // #8045: a PHAsset's date is the photo's, not a file timestamp: only those two exact spellings are exempt.
  NSPrivacyAccessedAPICategoryFileTimestamp: /\b((?<!asset\.|key: ")creationDate\w*|contentModificationDate\w*|contentAccessDate\w*|attributeModificationDate\w*|modificationDate\w*|fileModificationDate\w*|NSFileCreationDate|NSFileModificationDate|attributesOfItem|f?getattrlist\w*|st_mtime\w*|st_ctime\w*|st_atime\w*)\b|\b(f?stat|fstatat|lstat)\s*\(/,
  NSPrivacyAccessedAPICategorySystemBootTime: /\b(systemUptime|mach_absolute_time|clock_gettime_nsec_np|CLOCK_UPTIME_RAW\w*|CLOCK_MONOTONIC_RAW\w*)\b/,
  NSPrivacyAccessedAPICategoryDiskSpace: /\b(volumeAvailableCapacity\w*|volumeTotalCapacity\w*|systemFreeSize|systemSize|NSFileSystemFreeSize|NSFileSystemSize|f?statfs|f?statvfs|attributesOfFileSystem)\b/,
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

/* A target's manifest without its XML comments, so a commented-out entry does not count as declared. A target with
   no manifest reads as one declaring nothing. */
function manifestText(file = MANIFEST) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '') : '';
}

/* Apple checks each bundle's own manifest: the app, and the notification extension (KosmosNotice.appex). Each folder
   is a synchronized group of its target, so its sources and its PrivacyInfo.xcprivacy go into that bundle. */
const TARGETS = ['Kosmos', 'KosmosNotice'];

test('kosmos#7352: every Swift folder under ios/ is a target checked here (a new extension cannot slip past)', () => {
  const withSwift = fs.readdirSync(IOS, { withFileTypes: true })
    // kosmos#7559: KosmosUITests is a UI test bundle, run by xcodebuild test on a simulator and never shipped to a phone,
    // so, like LogicTests, it has no privacy manifest to keep. kosmos#7945: tools holds build-time tools run on a Mac
    // (the launch orb's renderer), never compiled into an app.
    .filter((e) => e.isDirectory() && e.name !== 'LogicTests' && e.name !== 'KosmosUITests' && e.name !== 'tools' && !e.name.endsWith('.xcodeproj'))
    .filter((e) => swiftFiles(path.join(IOS, e.name)).length > 0).map((e) => e.name).sort();
  assert.deepEqual(withSwift, [...TARGETS].sort());
});

test('kosmos#7352: every required-reason API each target uses is declared in that target’s own privacy manifest', () => {
  assert.ok(swiftFiles(path.join(IOS, 'Kosmos')).length > 20, 'the iPhone app sources were found');
  for (const target of TARGETS) {
    const file = path.join(IOS, target, 'PrivacyInfo.xcprivacy');
    const manifest = manifestText(file);
    const sources = swiftFiles(path.join(IOS, target)).map((f) => [f, code(f)]);
    for (const [category, uses] of Object.entries(CATEGORIES)) {
      const users = sources.filter(([, text]) => uses.test(text)).map(([f]) => path.relative(__dirname, f));
      if (users.length) assert.ok(manifest.includes(`<string>${category}</string>`), `${category} is used (${users.join(', ')}) but not declared in ${path.relative(__dirname, file)}`);
    }
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

test('kosmos#7352: the detector flags each spelling on the list, and ordinary words do not (a control)', () => {
  const flagged = (s) => Object.entries(CATEGORIES).filter(([, r]) => r.test(s)).map(([c]) => c);
  const uses = {
    NSPrivacyAccessedAPICategoryUserDefaults: ['UserDefaults.standard', 'NSUserDefaults.standard', '@AppStorage("k")'],
    NSPrivacyAccessedAPICategoryFileTimestamp: ['.contentModificationDateKey', 'values.creationDate', '.creationDateKey', '.contentAccessDateKey', 'NSFileModificationDate', 'attributesOfItem(atPath: p)', 'stat(p, &s)', 'lstat(p, &s)', 'fgetattrlist(fd)', 's.st_mtimespec'],
    NSPrivacyAccessedAPICategorySystemBootTime: ['ProcessInfo.processInfo.systemUptime', 'mach_absolute_time()', 'clock_gettime_nsec_np(CLOCK_UPTIME_RAW)'],
    NSPrivacyAccessedAPICategoryDiskSpace: ['.volumeAvailableCapacityForImportantUsageKey', '.volumeTotalCapacityKey', 'NSFileSystemFreeSize', 'statvfs(p, &s)', 'fstatfs(fd, &s)'],
    NSPrivacyAccessedAPICategoryActiveKeyboards: ['UITextInputMode.activeInputModes'],
  };
  for (const [category, samples] of Object.entries(uses)) {
    for (const s of samples) assert.ok(flagged(s).includes(category), `${s} is not flagged as ${category}`);
  }
  for (const s of ['let stat = 3', 'asset.creationDate', 'NSSortDescriptor(key: "creationDate", ascending: false)', 'stats.count', 'status', 'statusBar', 'stateful', '.fileSizeKey', 'Date()']) {
    assert.deepEqual(flagged(s), [], `${s} is flagged but is not a required-reason API`);
  }
});

/* kosmos#8654: the data the app collects, declared in the manifest, must be exactly the App Privacy label's "Data types
   to declare" table (ios/store/privacy-label.md), each linked to the person, not used for tracking, for app
   functionality, as that table says for every row. Read from the label itself, so the two cannot drift apart.
   Review 1: the manifest is PARSED as a plist (a duplicate key refuses, as it would hide a value from Apple's reader,
   which keeps the last), every key is checked by its exact name, every row of the label's table must be read, and every
   type must be one Apple defines (a misspelled constant is ignored at upload). */
const LABEL = path.join(IOS, 'store', 'privacy-label.md');
// Apple's NSPrivacyCollectedDataType constants (the "Describing data use in privacy manifests" list).
const APPLE_TYPES = ['Name', 'EmailAddress', 'PhoneNumber', 'PhysicalAddress', 'OtherUserContactInfo', 'Health', 'Fitness',
  'PaymentInfo', 'CreditInfo', 'OtherFinancialInfo', 'PreciseLocation', 'CoarseLocation', 'SensitiveInfo', 'Contacts',
  'EmailsOrTextMessages', 'PhotosorVideos', 'AudioData', 'GameplayContent', 'CustomerSupport', 'OtherUserContent',
  'BrowsingHistory', 'SearchHistory', 'UserID', 'DeviceID', 'PurchaseHistory', 'ProductInteraction', 'AdvertisingData',
  'OtherUsageData', 'CrashData', 'PerformanceData', 'OtherDiagnosticData', 'EnvironmentScanning', 'Hands', 'Head',
  'OtherDataTypes'].map((n) => 'NSPrivacyCollectedDataType' + n);
function labelRows() {
  const md = fs.readFileSync(LABEL, 'utf8');
  const at = md.indexOf('## Data types to declare');
  const end = md.indexOf('\n## ', at + 1);
  const lines = md.slice(at, end < 0 ? undefined : end).split('\n').filter((l) => l.startsWith('|'));
  const body = lines.slice(2);   // the header and the |---| line
  const types = body.map((l) => (/^\| [^|>]+> \*\*([^*]+)\*\* \|/.exec(l) || [])[1]).filter(Boolean)
    .map((n) => 'NSPrivacyCollectedDataType' + n.replace(/\s+/g, ''));
  return { body: body.length, types };
}
// A minimal plist reader: dict, array, key, string, true, false. Comments are dropped first.
function parsePlist(xml) {
  const tokens = [...xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)(dict|array|key|string|true|false)(\/?)>([^<]*)/g)];
  let i = 0;
  const skipToRoot = () => { while (i < tokens.length && !(tokens[i][1] === '' && tokens[i][2] === 'dict')) i += 1; };
  function value() {
    const [, close, tag, selfClose, text] = tokens[i++];
    if (close) throw new Error('unexpected </' + tag + '>');
    if (tag === 'true' || tag === 'false') { if (!selfClose) i += 1; return tag === 'true'; }
    if (tag === 'string' || tag === 'key') { i += 1; return text; }
    if (tag === 'array') { if (selfClose) return []; const out = []; while (!(tokens[i][1] && tokens[i][2] === 'array')) out.push(value()); i += 1; return out; }
    if (tag === 'dict') {
      if (selfClose) return {};
      const out = {};
      while (!(tokens[i][1] && tokens[i][2] === 'dict')) {
        if (tokens[i][2] !== 'key') throw new Error('a dict value without a key');
        const k = value();
        if (Object.prototype.hasOwnProperty.call(out, k)) throw new Error('duplicate key ' + k);
        out[k] = value();
      }
      i += 1;
      return out;
    }
    throw new Error('unknown tag ' + tag);
  }
  skipToRoot();
  return value();
}
test('kosmos#8654: the plist reader this test relies on refuses a duplicate key and reads booleans and arrays', () => {
  assert.throws(() => parsePlist('<plist><dict><key>a</key><true/><key>a</key><false/></dict></plist>'), /duplicate key a/);
  assert.deepEqual(parsePlist('<plist><dict><key>a</key><array><string>x</string></array><key>b</key><false/><key>c</key><array/></dict></plist>'), { a: ['x'], b: false, c: [] });
});
test('kosmos#8654: the manifest declares exactly the data types the App Privacy label declares, as the label says them', () => {
  const md = fs.readFileSync(LABEL, 'utf8');
  const { body, types: want } = labelRows();
  assert.ok(want.length >= 5, 'the label\'s data-type table was not read (' + want.length + ' rows)');
  assert.equal(want.length, body, 'a row of the label\'s data-type table was not read as "Category > **Type**" (' + want.length + ' of ' + body + ')');
  assert.ok(md.includes('**linked to the person\'s identity: yes**, **used for tracking: no**'), 'the label no longer says every row is linked and not tracking; update this test with it');
  const plist = parsePlist(fs.readFileSync(MANIFEST, 'utf8'));
  const got = plist.NSPrivacyCollectedDataTypes;
  assert.ok(Array.isArray(got), 'the manifest has no NSPrivacyCollectedDataTypes array');
  assert.deepEqual(got.map((g) => g.NSPrivacyCollectedDataType).sort(), want.slice().sort(), 'the manifest and the label declare different data types');
  for (const g of got) {
    assert.ok(APPLE_TYPES.includes(g.NSPrivacyCollectedDataType), g.NSPrivacyCollectedDataType + ' is not a data type Apple defines');
    assert.deepEqual(Object.keys(g).sort(), ['NSPrivacyCollectedDataType', 'NSPrivacyCollectedDataTypeLinked', 'NSPrivacyCollectedDataTypePurposes', 'NSPrivacyCollectedDataTypeTracking'], g.NSPrivacyCollectedDataType + ' has a missing or misspelled key: ' + Object.keys(g).join(', '));
    assert.equal(g.NSPrivacyCollectedDataTypeLinked, true, g.NSPrivacyCollectedDataType + ' is not marked linked to the person');
    assert.equal(g.NSPrivacyCollectedDataTypeTracking, false, g.NSPrivacyCollectedDataType + ' is not marked as not used for tracking');
    assert.deepEqual(g.NSPrivacyCollectedDataTypePurposes, ['NSPrivacyCollectedDataTypePurposeAppFunctionality'], g.NSPrivacyCollectedDataType + ' has other purposes than app functionality');
  }
});
