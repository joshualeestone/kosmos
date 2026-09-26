'use strict';
// Browser-check-surface: d-file-btn d-file d-img d-msg d-untied d-withdrawn

/**
 * #4038 (Josh, 2026-09-26: "Change picture for an agent doesn't seem to be working"). A sandboxed board:
 *  - a tied agent (April): "Change picture" opens the picker; a chosen PNG (solid red) is saved ("Saved.") and REACHES
 *    the picture on her page and on her card on the board (read by pixel colour, not by src, so a stale image fails);
 *    choosing the same file again saves again (the input is cleared each time);
 *  - an untied agent (a stranger's pane): the button is disabled, the reason is on the page, and no picker opens.
 *  - back on a tied agent the button is live and names no reason (aria-describedby is set only while disabled);
 *  - April leaves the board while her page is open: disabled, naming #d-withdrawn; she returns: live, no stale reason.
 *
 * Run: NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-avatar-4038.js [shotsDir]
 */
require('./lib-sandbox-home.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-avatar4038-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-avatar4038-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-avatar4038-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-avatar4038-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-avatar4038-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* A 16x16 PNG of one colour, built here so the check carries no binary fixture. */
function solidPng(r, g, b) {
  const w = 16; const h = 16;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  fleet.install([
    fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' }),
    fleet.stranger('outsider'),
  ]);
  const red = path.join(SANDBOX, 'red.png');
  fs.writeFileSync(red, solidPng(220, 20, 20));
  const SHOTS = process.argv[2] || null;
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.waitForSelector('[data-agent="april"]', { timeout: 8000 });

  /* The colour at the centre of an <img>, read through a canvas: what the person SEES, not what src says. */
  const colourOf = (sel) => page.evaluate((s) => {
    const img = document.querySelector(s);
    if (!img || !img.complete || !img.naturalWidth) return null;
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, sel);
  const isRed = (c) => !!c && c[0] > 180 && c[1] < 80 && c[2] < 80;

  await page.evaluate(() => openDetail('april', 'profile'));
  await page.waitForSelector('#d-file-btn', { state: 'visible', timeout: 5000 });
  chk(!(await colourOf('#d-img')) || !isRed(await colourOf('#d-img')), 'CONTROL: April\'s page picture is not red before the upload');
  for (const round of ['first', 'same file again']) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }), page.click('#d-file-btn')]);
    await chooser.setFiles(red);
    await page.waitForFunction(() => /Saved\./.test(document.getElementById('d-msg').textContent), null, { timeout: 8000 }).catch(() => {});
    const msg = await page.evaluate(() => document.getElementById('d-msg').textContent);
    chk(msg === 'Saved.', `(${round}) the chosen picture is saved`, JSON.stringify(msg));
    await page.evaluate(() => { document.getElementById('d-msg').textContent = ''; });
  }
  await page.waitForTimeout(800);
  const pageColour = await colourOf('#d-img');
  chk(isRed(pageColour), 'the new picture reaches April\'s page', JSON.stringify(pageColour));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'avatar-page.png') });
  await page.evaluate(() => showTab && showTab('agents'));
  await page.waitForTimeout(6000);   // a board poll repaints the cards
  const cardColour = await colourOf('[data-agent="april"] img');
  chk(isRed(cardColour), 'the new picture reaches April\'s card on the board', JSON.stringify(cardColour));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'avatar-board.png') });

  await page.evaluate(() => openDetail('outsider', 'profile'));
  await page.waitForTimeout(1200);
  const untied = await page.evaluate(() => ({ btn: document.getElementById('d-file-btn').disabled, why: !document.getElementById('d-untied').hidden && document.getElementById('d-untied').textContent }));
  chk(untied.btn === true, 'on an untied agent Change picture is disabled, not a silent no-op', JSON.stringify(untied));
  chk(!!untied.why && /will not change its picture/.test(untied.why), 'and the page says why', JSON.stringify(untied.why));
  let opened = false;
  await Promise.all([page.waitForEvent('filechooser', { timeout: 1500 }).then(() => { opened = true; }).catch(() => {}),
    page.click('#d-file-btn', { force: true, timeout: 1500 }).catch(() => {})]);
  chk(!opened, 'and no picker opens for it (not a regression guard: main opened none either, silently)');
  const untiedDesc = await page.evaluate(() => document.getElementById('d-file-btn').getAttribute('aria-describedby'));
  chk(untiedDesc === 'd-untied', 'the disabled button names the sentence that says why', JSON.stringify(untiedDesc));
  await page.evaluate(() => openDetail('april', 'profile'));
  await page.waitForTimeout(1200);
  const back = await page.evaluate(() => ({ btn: document.getElementById('d-file-btn').disabled, desc: document.getElementById('d-file-btn').getAttribute('aria-describedby') }));
  chk(back.btn === false && back.desc === null, 'back on a tied agent the button is live and names no stale reason', JSON.stringify(back));

  /* Withdrawn, driven live: April leaves the board while her page is open, then comes back. */
  const btnState = () => page.evaluate(() => ({ btn: document.getElementById('d-file-btn').disabled,
    desc: document.getElementById('d-file-btn').getAttribute('aria-describedby'), shown: !document.getElementById('d-withdrawn').hidden }));
  fleet.install([fleet.stranger('outsider')]);
  await page.waitForFunction(() => !document.getElementById('d-withdrawn').hidden, null, { timeout: 15000 }).catch(() => {});
  const gone = await btnState();
  chk(gone.shown && gone.btn === true && gone.desc === 'd-withdrawn', 'a withdrawn agent\'s button is disabled and names the withdrawn sentence', JSON.stringify(gone));
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' }), fleet.stranger('outsider')]);
  await page.waitForFunction(() => document.getElementById('d-withdrawn').hidden, null, { timeout: 15000 }).catch(() => {});
  const returned = await btnState();
  chk(!returned.shown && returned.btn === false && returned.desc === null, 'when she is back the button is live and names no stale reason', JSON.stringify(returned));
  chk(errors.length === 0, 'no page errors', JSON.stringify(errors.slice(0, 2)));

  await browser.close();
  server.close();
  console.log(fail.length ? `FAILED: ${fail.length}` : 'All checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
