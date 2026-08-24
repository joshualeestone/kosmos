'use strict';
/**
 * The GitHub, Vercel and Cloudflare doors on the Connections tab (#529), driven in a real browser: absent gh is the
 * plain main road with nothing to press; present gh offers Connect with the promise; Connect
 * puts GitHub's one-time code and device URL on the door with Stop; finishing on GitHub reads
 * back as Connected as the account gh names. Runs against TWO boards booted by
 * tools/browser-checks.sh: one with AGENT_WORKFORCE_GH_BIN pointed at nothing, one at a
 * stand-in gh that signs in when a marker file appears. No real gh, no real GitHub.
 *
 *   node docs/browser-checks/render-github-door.js <absent-base> <present-base> <marker-path>
 */
const pw = require('playwright'); const fs = require('node:fs');
const ABSENT = process.argv[2] || 'http://127.0.0.1:17601';
const PRESENT = process.argv[3] || 'http://127.0.0.1:17602';
const MARK = process.argv[4] || '/tmp/fake-gh-mark';
const VMARK = process.argv[5] || '/tmp/fake-vercel-mark';
const VERIFY_PORT = Number(process.argv[6] || 17347); // the board was booted with AGENT_WORKFORCE_CLOUDFLARE_VERIFY_URL pointing here
const http = require('node:http');
let failed = 0;
(async () => {
  // A retry must start signed out: the stand-ins sign in on these markers, and
  // the harness reruns a failed check on the same boards.
  for (const m of [MARK, VMARK]) { try { fs.unlinkSync(m); } catch { /* not there */ } }
  const b = await pw.chromium.launch({ headless: true });
  const say = (k, v, d) => { if (!v) failed += 1; console.log((v ? 'PASS' : 'FAIL') + '  ' + k + (d ? '  ' + d : '')); };
  const openDoor = async (p, base) => {
    await p.goto(base + '/?tab=settings', { waitUntil: 'networkidle' });
    await p.evaluate(() => settingsGo('connect'));
    await p.waitForTimeout(400);
    await p.evaluate(() => { document.querySelectorAll('#s-sec-connect details').forEach((d) => { d.open = true; }); const pill = [...document.querySelectorAll('#s-sec-connect button.boardname')].find((x) => x.textContent.trim() === 'GitHub'); pill.click(); });
    await p.waitForTimeout(900);
    return p.evaluate(() => { const pill = [...document.querySelectorAll('#s-sec-connect button.boardname')].find((x) => x.textContent.trim() === 'GitHub'); const door = pill.closest('.boardrow').nextElementSibling; return { hidden: door.hidden, text: door.textContent.replace(/\s+/g, ' ').trim(), buttons: [...door.querySelectorAll('button')].map((x) => x.textContent.trim()), links: [...door.querySelectorAll('a')].map((a) => a.href) }; });
  };
  // A: gh absent
  let p = await b.newPage(); let d = await openDoor(p, ABSENT);
  say('absent gh: the door opens', !d.hidden);
  say('absent gh: the plain sentence is the main road, with the install link', /this Mac needs the GitHub CLI, and it is not here yet/.test(d.text) && d.links.some((l) => /cli\.github\.com/.test(l)), d.text.slice(0, 140));
  say('absent gh: nothing to press', d.buttons.length === 0, JSON.stringify(d.buttons));
  await p.close();
  // B: gh present, signed out
  p = await b.newPage(); d = await openDoor(p, PRESENT);
  say('present gh: Connect is offered with the promise beneath it', d.buttons.includes('Connect') && /never sees (a|your) password/.test(d.text), d.text.slice(-120));
  await p.evaluate(() => { document.querySelector('[data-svc-connect="GitHub"]').click(); });
  await p.waitForTimeout(2500);
  d = await p.evaluate(() => { const door = document.querySelector('[data-svc-cancel]') ? document.querySelector('[data-svc-cancel]').closest('.svc-door') : null; return door ? { text: door.textContent.replace(/\s+/g, ' ').trim(), links: [...door.querySelectorAll('a')].map((a) => a.href) } : null; });
  say('after Connect: the one-time code and the GitHub device URL are on the door, with Stop', !!d && /WALK-1234/.test(d.text) && d.links.some((l) => /github\.com\/login\/device/.test(l)) && /Stop this sign-in/.test(d.text), d ? d.text.slice(0, 160) : 'no door');
  // the person finishes on GitHub: the fake gh exits 0 when the marker appears
  fs.writeFileSync(MARK, '1');
  await p.waitForTimeout(3500);
  d = await p.evaluate(() => { const pill = [...document.querySelectorAll('#s-sec-connect button.boardname')].find((x) => x.textContent.trim() === 'GitHub'); const door = pill.closest('.boardrow').nextElementSibling; return { text: door.textContent.replace(/\s+/g, ' ').trim(), buttons: [...door.querySelectorAll('button')].map((x) => x.textContent.trim()) }; });
  say('finished on GitHub: the door reads Connected as the account gh names, no code, no Connect', /Connected as walker/.test(d.text) && !/WALK-1234/.test(d.text) && !d.buttons.includes('Connect'), d.text.slice(0, 140));
  // Vercel, same door shape, same board (#529): its stand-in signs in on its own marker.
  const openVercel = async () => {
    await p.evaluate(() => { document.querySelectorAll('#s-sec-connect details').forEach((x) => { x.open = true; }); const pill = [...document.querySelectorAll('#s-sec-connect button.boardname')].find((x) => x.textContent.trim() === 'Vercel'); pill.click(); });
    await p.waitForTimeout(900);
    return p.evaluate(() => { const pill = [...document.querySelectorAll('#s-sec-connect button.boardname')].find((x) => x.textContent.trim() === 'Vercel'); const door = pill.closest('.boardrow').nextElementSibling; return { text: door.textContent.replace(/\s+/g, ' ').trim(), buttons: [...door.querySelectorAll('button')].map((x) => x.textContent.trim()), links: [...door.querySelectorAll('a')].map((a) => a.href) }; });
  };
  d = await openVercel();
  say('Vercel: Connect is offered, with Vercel’s own words and the GitHub-first sentence', d.buttons.includes('Connect') && /Vercel’s own page/.test(d.text) && /needs GitHub connected first/.test(d.text), d.text.slice(-160));
  await p.evaluate(() => { document.querySelector('[data-svc-connect="Vercel"]').click(); });
  await p.waitForTimeout(2500);
  // Do not click the pill again here: a click on an open pill closes the door
  // and stops its paint loop, which is the very state this leg reads.
  d = await p.evaluate(() => { const pill = [...document.querySelectorAll('#s-sec-connect button.boardname')].find((x) => x.textContent.trim() === 'Vercel'); const door = pill.closest('.boardrow').nextElementSibling; return { text: door.textContent.replace(/\s+/g, ' ').trim(), links: [...door.querySelectorAll('a')].map((a) => a.href) }; });
  say('Vercel after Connect: the code and vercel.com/oauth/device are on the door', /VRCL-5678/.test(d.text) && d.links.some((l) => /vercel\.com\/oauth\/device/.test(l)), d.text.slice(0, 160));
  fs.writeFileSync(VMARK, '1');
  await p.waitForTimeout(3500);
  d = await p.evaluate(() => { const pill = [...document.querySelectorAll('#s-sec-connect button.boardname')].find((x) => x.textContent.trim() === 'Vercel'); const door = pill.closest('.boardrow').nextElementSibling; return { text: door.textContent.replace(/\s+/g, ' ').trim(), buttons: [...door.querySelectorAll('button')].map((x) => x.textContent.trim()) }; });
  say('Vercel finished: Connected as the account vercel names', /Connected as vwalker/.test(d.text) && !d.buttons.includes('Connect'), d.text.slice(0, 140));
  // Cloudflare (#529): a pasted token, checked with a stand-in for Cloudflare's verify endpoint
  // that answers active for one token and rejects every other, so no real Cloudflare is involved.
  const stub = http.createServer((req, res) => {
    const ok = (req.headers.authorization || '') === 'Bearer cf_walk_token_abcdefghijklmnopqrstuvwxyz';
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { success: true, result: { id: 'walkwalkwalkwalkwalkwalkwalkwalk', status: 'active' } } : { success: false, errors: [{ message: 'Invalid API Token' }], result: null }));
  });
  await new Promise((r) => stub.listen(VERIFY_PORT, '127.0.0.1', r));
  const openCf = async () => {
    await p.evaluate(() => { document.querySelectorAll('#s-sec-connect details').forEach((x) => { x.open = true; }); const pill = [...document.querySelectorAll('#s-sec-connect button.boardname')].find((x) => x.textContent.trim() === 'Cloudflare'); pill.click(); });
    await p.waitForTimeout(900);
  };
  const readCf = () => p.evaluate(() => { const pill = [...document.querySelectorAll('#s-sec-connect button.boardname')].find((x) => x.textContent.trim() === 'Cloudflare'); const door = pill.closest('.boardrow').nextElementSibling; return { text: door.textContent.replace(/\s+/g, ' ').trim(), buttons: [...door.querySelectorAll('button')].map((x) => x.textContent.trim()), field: !!door.querySelector('[data-svc-token-field]'), fieldType: (door.querySelector('[data-svc-token-field]') || {}).type || null, links: [...door.querySelectorAll('a')].map((a) => a.href) }; });
  await openCf(); d = await readCf();
  say('Cloudflare: a paste field (password type), the link to Cloudflare’s token page, and Connect', d.field && d.fieldType === 'password' && d.links.some((l) => /dash\.cloudflare\.com\/profile\/api-tokens/.test(l)) && d.buttons.includes('Connect'), d.text.slice(-140));
  await p.fill('[data-svc-token-field="Cloudflare"]', 'cf_bad_token_abcdefghijklmnopqrstuvwxyz');
  await p.click('[data-svc-token-go="Cloudflare"]'); await p.waitForTimeout(900); d = await readCf();
  say('Cloudflare rejects: the reason is on the door, the field is emptied, nothing kept', /did not accept that token/.test(d.text) && d.field && !/Connected\./.test(d.text), d.text.slice(-160));
  await p.fill('[data-svc-token-field="Cloudflare"]', 'cf_walk_token_abcdefghijklmnopqrstuvwxyz');
  await p.click('[data-svc-token-go="Cloudflare"]'); await p.waitForTimeout(900); d = await readCf();
  say('Cloudflare accepts: Connected, says Kosmos keeps it in one file, offers Forget, never shows the token', /Connected\./.test(d.text) && /one file on this Mac/.test(d.text) && d.buttons.some((x) => /Forget/.test(x)) && !/cf_walk/.test(d.text), d.text.slice(-160));
  await p.click('[data-svc-forget="Cloudflare"]'); await p.waitForTimeout(900); d = await readCf();
  say('Cloudflare forgotten: back to the paste field', d.field && !/Connected\./.test(d.text), d.text.slice(-100));
  stub.close();
  await b.close();
  console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL  check threw  ' + e.message); process.exit(1); });
