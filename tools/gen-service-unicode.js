#!/usr/bin/env node
'use strict';
/* #4373 part B: regenerate engine/feedpublish.js NEWER_THAN_SERVICE, the characters this board's Node calls
   assigned but the community service's Python still calls unassigned (so the service refuses them).
   Usage: node tools/gen-service-unicode.js [python]   (default python3.14, the service's version)
   Prints the Unicode versions on both sides, the range and code-point counts, and the regex line to paste.
   Run it with the Node the board ships, when engine/communitycomment-4373.test.js's tripwire fails. */
const { execFileSync } = require('node:child_process');

const python = process.argv[2] || 'python3.14';
const py = `
import sys, unicodedata
print(unicodedata.unidata_version)
cn = [c for c in range(0x110000) if unicodedata.category(chr(c)) == 'Cn']
sys.stdout.write(' '.join(map(str, cn)))
`;
const out = execFileSync(python, ['-c', py], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const nl = out.indexOf('\n');
const pyVersion = out.slice(0, nl);
const pyCn = out.slice(nl + 1).split(' ').map(Number);

const nodeCn = /^\p{Cn}$/u;
const newer = pyCn.filter((c) => !(c >= 0xd800 && c <= 0xdfff) && !nodeCn.test(String.fromCodePoint(c)));

const ranges = [];
for (const c of newer) {
  const last = ranges[ranges.length - 1];
  if (last && c === last[1] + 1) last[1] = c; else ranges.push([c, c]);
}
const hex = (c) => '\\u{' + c.toString(16).toUpperCase() + '}';
const body = ranges.map(([a, b]) => (a === b ? hex(a) : hex(a) + '-' + hex(b))).join('');

process.stderr.write(`service Python ${python}: Unicode ${pyVersion}; this Node ${process.versions.node}: Unicode ${process.versions.unicode}\n`);
process.stderr.write(`${ranges.length} ranges, ${newer.length} code points\n`);
process.stdout.write(`const NEWER_THAN_SERVICE = /[${body}]/u;\n`);
