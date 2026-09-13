'use strict';
/**
 * win32-board-copy: the one Explorer launcher.
 *
 * 🛑 NO TEST HERE MAY OPEN A REAL WINDOW. Every arm that reaches a launch injects the
 * runner; the one arm that does not proves the live-execution gate throws inside a
 * test process instead of spawning. Targets are Windows paths with an injected
 * existence check, so a Mac asserts the same arms a Windows box does.
 *
 * ⚠️ THE ARGV IS THE ASSERTION. The runner seam receives exactly what would be handed to
 * explorer.exe, verbatim, so every test below pins the argument list Explorer would parse.
 *
 *   node --test engine/win32explorer.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const explorer = require('./win32explorer');

const FOLDER = 'C:\\Users\\someone\\Kosmos\\Projects\\Brief';
const FILE = 'C:\\Users\\someone\\Kosmos\\Projects\\Brief\\notes.docx';
const DIRECTORY = { isDirectory: () => true, isFile: () => false };
const REGULAR_FILE = { isDirectory: () => false, isFile: () => true };
const q = (p) => '"' + p + '"';

function withWorld({ stat, runnerResult = { ok: true } }, body) {
  const calls = [];
  explorer.setRunner((exe, args) => { calls.push({ exe, args }); return runnerResult; });
  explorer.setStatForTests(stat || (() => DIRECTORY));
  try {
    return body(calls);
  } finally {
    explorer.setRunner(null);
    explorer.setStatForTests(null);
  }
}

test('a real folder is handed to explorer.exe as ONE quoted argument, never through a shell', () => {
  withWorld({}, (calls) => {
    assert.deepEqual(explorer.openFolder(FOLDER), { ok: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0].exe, /\\explorer\.exe$/i, 'the launcher is not explorer.exe');
    assert.deepEqual(calls[0].args, [q(FOLDER)], 'the folder did not arrive as exactly one quoted argument');
  });
});

test('a forward-slash spelling is normalized, and a trailing separator is dropped before quoting', () => {
  withWorld({}, (calls) => {
    assert.equal(explorer.openFolder('C:/Users/someone/Kosmos/').ok, true);
    assert.deepEqual(calls[0].args, [q('C:\\Users\\someone\\Kosmos')]);
  });
});

test('SAFETY 3: a comma stays inside the ONE quoted argument, so it can neither split the path nor add a switch', () => {
  withWorld({}, (calls) => {
    assert.equal(explorer.openFolder('C:\\Users\\someone\\Kosmos\\Projects\\Q3,Q4').ok, true);
    assert.equal(explorer.openFolder('C:\\Users\\someone\\x,/root,').ok, true);
    assert.deepEqual(calls.map((c) => c.args), [
      [q('C:\\Users\\someone\\Kosmos\\Projects\\Q3,Q4')],
      [q('C:\\Users\\someone\\x,\\root,')],
    ]);
    /* A switch that names a second drive path carries a colon past the drive letter, which is
       refused outright (the alternate-data-stream rule) before quoting is even reached. */
    assert.equal(explorer.openFolder('C:\\Users\\someone\\x,/root,C:\\Windows').ok, false);
    assert.equal(calls.length, 2);
  });
  /* And the spawn itself passes the argument verbatim, so Node adds no quoting of its own. */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'win32explorer.js'), 'utf8');
  assert.match(src, /windowsVerbatimArguments: true/);
});

test('SAFETY 2: network shares and device paths are refused for both open and reveal, before any launch', () => {
  const shapes = [
    '\\\\attacker\\share\\x',
    '//attacker/share/x',
    '\\\\attacker@SSL\\DavWWWRoot\\x',
    '\\\\?\\C:\\Users\\someone',
    '\\\\?\\UNC\\attacker\\share',
    '\\\\.\\pipe\\x',
    '\\\\.\\C:\\Users',
    '\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy1\\Users',
  ];
  withWorld({ stat: () => REGULAR_FILE }, (calls) => {
    for (const shape of shapes) {
      for (const [label, out] of [['openFolder', explorer.openFolder(shape)], ['openFile', explorer.openFile(shape)]]) {
        assert.equal(out.ok, false, `${label} accepted ${JSON.stringify(shape)}`);
        assert.match(out.because, /not network shares or device paths/, `${label} ${shape}: ${out.because}`);
      }
    }
    assert.equal(calls.length, 0, 'a network or device path reached Explorer');
  });
});

test('ARGUMENT INJECTION: anything Explorer could read as a switch, or that is not an absolute drive path, is refused', () => {
  const shapes = [
    '/select,C:\\Windows\\System32\\calc.exe',
    '/e,C:\\',
    '/root,C:\\Users',
    '-help',
    'relative\\folder',
    '\\rooted-without-a-drive',
    'C:\\Users\\someone\\" /select,"C:\\Windows',
    'C:\\Users\\someone\\Kos\nmos',
    'C:\\Users\\someone\\notes.txt:evil.exe',
    'ms-settings:privacy',
    'shell:startup',
    'https://example.com',
    '',
    null,
    undefined,
    42,
  ];
  withWorld({}, (calls) => {
    for (const shape of shapes) {
      const out = explorer.openFolder(shape);
      assert.equal(out.ok, false, `accepted ${JSON.stringify(shape)}`);
      assert.equal(typeof out.because, 'string');
    }
    assert.equal(calls.length, 0, 'a refused target still reached Explorer');
  });
  /* CONTROL: the same world launches for a real folder, so the refusals above are the
     validation and not a runner that never answers. */
  withWorld({}, (calls) => {
    assert.equal(explorer.openFolder(FOLDER).ok, true);
    assert.equal(calls.length, 1);
  });
});

test('a folder that is gone, or is a file, is refused with a sentence and no launch', () => {
  withWorld({ stat: () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); } }, (calls) => {
    assert.deepEqual(explorer.openFolder(FOLDER), { ok: false, because: 'that folder is not there any more' });
    assert.equal(calls.length, 0);
  });
  withWorld({ stat: () => REGULAR_FILE }, (calls) => {
    assert.deepEqual(explorer.openFolder(FOLDER), { ok: false, because: 'that is not a folder' });
    assert.equal(calls.length, 0);
  });
});

/* `.rtf` is on the reveal side since review round 2 (its handler's parser-bug history). */
const DANGEROUS = ['.bat', '.cmd', '.exe', '.lnk', '.url', '.hta', '.vbs', '.js', '.wsf', '.ps1', '.scr', '.pif', '.cpl', '.msc', '.msi', '.appref-ms', '.rtf'];
const ALLOWED = ['.txt', '.md', '.csv', '.tsv', '.log', '.json', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic',
  '.mp3', '.m4a', '.wav', '.mp4', '.mov', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.zip'];
const DIR = 'C:\\Users\\someone\\Kosmos\\Projects\\Brief\\';

test('SAFETY 1: a file whose type can run a program is SHOWN in File Explorer, never opened, and the person is told why', () => {
  const names = [
    ...DANGEROUS.map((ext) => 'Q3 report' + ext),
    'Q3 report.pdf.bat',
    'Q3 report.PDF.BAT',
    'Q3 report.pdf.bat.',
    'Q3 report.pdf.bat ',
    'Q3 report.pdf.bat. .',
    'README',
  ];
  withWorld({ stat: () => REGULAR_FILE }, (calls) => {
    for (const name of names) {
      const out = explorer.openFile(DIR + name);
      assert.deepEqual(out, { ok: true, revealedInstead: true, say: explorer.REVEALED_INSTEAD_SENTENCE }, `${name} was not revealed instead`);
      const args = calls[calls.length - 1].args;
      assert.equal(args.length, 1, `${name}: more than one argument`);
      assert.ok(args[0].startsWith('/select,"'), `${name} was OPENED, not selected: ${args[0]}`);
    }
    assert.equal(calls.length, names.length);
  });
  assert.equal(explorer.REVEALED_INSTEAD_SENTENCE,
    'Kosmos showed this file in File Explorer instead of opening it, because files of this type can run programs.');
});

test('each allowed document type OPENS, in any letter case', () => {
  assert.deepEqual([...explorer.OPENABLE_FILE_EXTENSIONS].sort(), [...ALLOWED].sort(), 'the allow-list changed without this test');
  withWorld({ stat: () => REGULAR_FILE }, (calls) => {
    for (const ext of ALLOWED) {
      for (const spelled of [ext, ext.toUpperCase()]) {
        const file = DIR + 'Q3 report' + spelled;
        assert.deepEqual(explorer.openFile(file), { ok: true }, `${spelled} did not open`);
        assert.deepEqual(calls[calls.length - 1].args, [q(file)], `${spelled} was not opened as one quoted path`);
      }
    }
  });
});

test('a trailing dot or space is judged the way Windows judges it: stripped, so notes.pdf. is a .pdf', () => {
  /* Windows drops trailing dots and spaces from a file name, so these ARE the .pdf and the
     .bat. The allow-list already fails closed on an undetermined type, so the dangerous half
     is covered either way; this is the half that must still OPEN. */
  withWorld({ stat: () => REGULAR_FILE }, (calls) => {
    for (const name of ['notes.pdf.', 'notes.pdf ', 'notes.pdf. .']) {
      assert.deepEqual(explorer.openFile(DIR + name), { ok: true }, `${JSON.stringify(name)} was not opened as the .pdf it is`);
      assert.ok(!calls[calls.length - 1].args[0].startsWith('/select,'), `${JSON.stringify(name)} was only shown`);
    }
    for (const name of ['notes.bat.', 'notes.bat ']) {
      assert.equal(explorer.openFile(DIR + name).revealedInstead, true, `${JSON.stringify(name)} was opened`);
    }
  });
});

test('openFile refuses a folder, a stream and a network file before any launch', () => {
  withWorld({ stat: () => DIRECTORY }, (calls) => {
    assert.equal(explorer.openFile(FOLDER).ok, false);
    assert.equal(calls.length, 0);
  });
  withWorld({ stat: () => REGULAR_FILE }, (calls) => {
    assert.equal(explorer.openFile(DIR + 'notes.txt:hidden.exe').ok, false, 'an alternate data stream was opened');
    assert.equal(explorer.openFile('\\\\attacker\\share\\notes.pdf').ok, false);
    assert.equal(calls.length, 0);
    assert.deepEqual(explorer.openFile(FILE), { ok: true });
  });
});

test('NIT 3 (review round 2): the drive-letter rule judges the NAMED path, the type judges the RESOLVED one', () => {
  withWorld({ stat: () => REGULAR_FILE }, (calls) => {
    /* A mapped drive: named Z:\, resolved to a share. It opens, and Explorer gets the Z:\ name. */
    assert.deepEqual(explorer.openFile('\\\\server\\share\\proj\\a.pdf', { namedAs: 'Z:\\proj\\a.pdf' }), { ok: true });
    assert.deepEqual(calls[calls.length - 1].args, [q('Z:\\proj\\a.pdf')]);
    /* The type is the resolved target's: a .pdf NAME resolving to a .bat is shown, not opened. */
    assert.equal(explorer.openFile('\\\\server\\share\\proj\\b.bat', { namedAs: 'Z:\\proj\\a.pdf' }).revealedInstead, true);
    const before = calls.length;
    /* A record naming a share ITSELF is refused, whatever it resolves to. */
    assert.match(explorer.openFile('C:\\x\\a.pdf', { namedAs: '\\\\server\\share\\a.pdf' }).because, /not network shares or device paths/);
    /* A resolved device form, stream or unsafe character is refused even under a drive-letter name. */
    for (const resolved of ['\\\\?\\GLOBALROOT\\Device\\x\\a.pdf', '\\\\.\\pipe\\a.pdf', '\\\\server\\share\\a.pdf:evil.exe', 'C:\\x\\a.pdf:evil.exe', 'C:\\x\\a"b.pdf']) {
      assert.equal(explorer.openFile(resolved, { namedAs: 'Z:\\proj\\a.pdf' }).ok, false, `a resolved ${resolved} was accepted`);
    }
    assert.equal(calls.length, before, 'a refused pair reached Explorer');
  });
});

test('a failed reveal reports the failure, not a reveal', () => {
  withWorld({ stat: () => REGULAR_FILE, runnerResult: { ok: false, because: explorer.EXPLORER_DID_NOT_OPEN } }, () => {
    assert.deepEqual(explorer.openFile(DIR + 'setup.exe'), { ok: false, because: 'File Explorer did not open' });
  });
});

test('Settings pages are a closed list: the sleep page opens, anything else is refused', () => {
  withWorld({}, (calls) => {
    assert.deepEqual(explorer.openSettingsPage('sleep'), { ok: true });
    assert.deepEqual(calls[0].args, ['ms-settings:powersleep']);
    for (const other of ['privacy', 'ms-settings:privacy', '__proto__', 'constructor', '']) {
      assert.equal(explorer.openSettingsPage(other).ok, false, `opened ${other}`);
    }
    assert.equal(calls.length, 1, 'a page outside the list reached Explorer');
  });
});

test('THE LIVE GATE: with no runner and no production opt-in, a test process throws instead of spawning Explorer', () => {
  explorer.setStatForTests(() => DIRECTORY);
  try {
    assert.throws(() => explorer.openFolder(FOLDER), /tried to execute .*explorer\.exe.* for real inside a test/i);
    assert.throws(() => explorer.openSettingsPage('sleep'), /for real inside a test/i);
  } finally {
    explorer.setStatForTests(null);
  }
});

test('the launch never waits on an exit code: success is answered from the spawn itself (source-pinned)', () => {
  /* Explorer exits 1 when the window opened. A launcher that used execFileSync or read
     the exit status would report every success as a failure, which is exactly what
     this module exists to avoid, so the shape is pinned. */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'win32explorer.js'), 'utf8');
  assert.match(src, /spawn\(exe, args, \{ detached: true, stdio: 'ignore', windowsHide: false, shell: false, windowsVerbatimArguments: true \}\)/);
  assert.match(src, /child\.unref\(\);\s*return \{ ok: true \};/);
  assert.doesNotMatch(src, /execFileSync|spawnSync|\.on\('exit'|\.on\('close'/, 'the launcher waits on Explorer\'s exit status');
});
