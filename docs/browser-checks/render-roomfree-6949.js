'use strict';
/* #6949: on a room post an agent has claimed (#6946, the 🙋 reaction), the page labels the 🙋 pill as a claim
 * ("Claimed by <name>, <age>") and offers "Free for another agent" beside it. Pressing it frees the claim through the
 * real free-claim route, repaints the one row and says so in the room's live region.
 *
 * Driven against the SHIPPED page and the real routes: self-boots a sandboxed server, creates a project with an agent,
 * posts two messages, and writes the agent's reactions straight into the sandbox's message log (a marked 🙋 row from the
 * agent is a claim, as react() writes it; no agent token is needed for that).
 *
 * Arms, each with its control:
 *  - the claimed post's 🙋 pill is labelled and has Free beside it; CONTROL: the other post, where the same agent's
 *    reaction is 👍, has no Free and no claim label;
 *  - the person pressing the claimed 🙋 pill (agreeing, #6946) repaints the row and keeps the claim label and Free;
 *  - a free that cannot be sent says so in a toast and leaves Free pressable; a 409 (mocked, then the board's real one)
 *    redraws the row with the holder the board answered, names both in the toast, and keeps focus in the row;
 *  - Free frees it: the agent's 🙋 goes, Free goes, the live region says so, and the room's agent view prints the note.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-roomfree-6949.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();
const HAND = '\u{1F64B}';
const THUMB = '\u{1F44D}';

let failures = 0, ran = 0;
const ok = (n) => { ran++; console.log('PASS  ' + n); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };
const check = (cond, n, why) => (cond ? ok(n) : bad(n, why));

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-' + k.toLowerCase() + '-'));
  }
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'roomer-discord', claim: 'roomer', title: '✳ idle' }) + '\n');
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'roomer-discord\n');
  fs.writeFileSync(roots.DATA + '/fake-screen', '❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)\n');
  // The engine's own name for the log, in this sandbox (required after the env is set, so LOG is the sandbox's).
  process.env.AGENT_WORKFORCE_DATA = roots.DATA;
  const LOG = require('../../engine/messages').LOG;
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions',
      AGENT_WORKFORCE_FAKE_SCREEN: roots.DATA + '/fake-screen' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
      const t = '[' + theme + ']';
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|favicon|status (of )?404|status of 409 \(Conflict\)|net::ERR_FAILED/.test(m.text())) errs.push(m.text()); });

      await p.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

      const pjName = 'Claims ' + theme;
      const made = await p.evaluate(async (name) => {
        const r1 = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        if (!r1.ok) return { error: 'project create ' + r1.status };
        const id = (await r1.json()).project.id;
        await fetch('/api/project/' + id + '/agent/roomer', { method: 'POST', headers: { 'content-type': 'application/json' } });
        for (const text of ['can someone take the release notes', 'and the changelog', 'and the docs']) {
          const r2 = await fetch('/api/project/' + id + '/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
          const j = await r2.json().catch(() => null);
          if (j && j.delivery && j.delivery.state === 'could_not') return { error: 'post refused: ' + j.delivery.because };
        }
        const room = await (await fetch('/api/project/' + id + '/room')).json();
        const posts = room.rows.filter((r) => r.kind === 'post').map((r) => r.id);
        const all = await (await fetch('/api/projects')).json();
        const rec = (Array.isArray(all) ? all : (all.projects || [])).find((x) => x.id === id);
        const a = rec && Array.isArray(rec.agents) ? rec.agents[0] : null;
        const member = typeof a === 'string' ? a : (a && (a.sessionName || a.name)) || null;
        return { id, posts, member };
      }, pjName);
      if (made.error || !made.posts || made.posts.length < 3 || !made.member) { bad(t + ' fixture', JSON.stringify(made)); await p.close(); continue; }
      const [claimed, other, twoForms] = made.posts;
      const at = new Date(Date.now() - 3 * 3600 * 1000).toISOString();   // claimed three hours ago
      fs.appendFileSync(LOG, JSON.stringify({ kind: 'reaction', project: made.id, of: claimed, emoji: HAND, op: 'add', claim: true, from: made.member, at }) + '\n');
      fs.appendFileSync(LOG, JSON.stringify({ kind: 'reaction', project: made.id, of: other, emoji: THUMB, op: 'add', from: made.member, at }) + '\n');
      // Two raised-hand pills on one post: an older skin-toned 🙋 from an agent no longer here, then the holder's claim.
      fs.appendFileSync(LOG, JSON.stringify({ kind: 'reaction', project: made.id, of: twoForms, emoji: HAND + '\u{1F3FD}', op: 'add', from: 'gone-agent', at }) + '\n');
      fs.appendFileSync(LOG, JSON.stringify({ kind: 'reaction', project: made.id, of: twoForms, emoji: HAND, op: 'add', claim: true, from: made.member, at }) + '\n');

      await p.click('[data-tab="projects"]');
      await p.locator('#pj-list').getByText(pjName, { exact: true }).first().click();
      await p.waitForSelector('#pj-room', { state: 'visible' });
      await p.waitForSelector('#pj-room .rxns[data-post="' + other + '"] .rxn', { timeout: 15000 }).catch(() => {});
      const box = (id) => p.locator('#pj-room .rxns[data-post="' + id + '"]');
      const read = (id) => box(id).evaluate((b) => {
        const pill = b.querySelector('.rxn[data-emoji="\u{1F64B}"]');
        const free = b.querySelector('.rxn-free');
        const age = b.querySelector('.rxn-claim-age');
        return { pills: b.querySelectorAll('.rxn').length, claimPill: !!b.querySelector('.rxn.rxn-claim'),
          age: age ? age.textContent : null, ageAt: age ? age.getAttribute('data-at') : null,
          freeAria: free ? free.getAttribute('aria-label') : null,
          title: pill ? pill.getAttribute('title') : null, aria: pill ? pill.getAttribute('aria-label') : null,
          free: !!free, freeBy: free ? free.getAttribute('data-claim-by') : null, freeText: free ? free.textContent : null,
          freeDisabled: free ? free.disabled : null, freeShown: free ? free.getBoundingClientRect().width > 0 : false };
      }).catch((e) => ({ error: String(e) }));

      const c1 = await read(claimed);
      check(c1.claimPill && /^Claimed by [^,()]+$/.test(String(c1.title)), t + ' the claimed post\'s 🙋 pill is labelled as a claim, naming only the holder once', JSON.stringify(c1));
      check(/Claimed by /.test(String(c1.aria)) && !/ago/.test(String(c1.aria) + c1.title + c1.freeAria), t + ' and its accessible name says so, with no age in any attribute', JSON.stringify(c1));
      check(c1.age === 'claimed 3 hours ago' && !!c1.ageAt, t + ' the age shows as text beside it', JSON.stringify(c1));
      check(/^Free for another agent\. Claimed by /.test(String(c1.freeAria)), t + ' Free\'s accessible name starts with its visible words', String(c1.freeAria));
      // The age ticking over is not a new room shape (it would rebuild the room every minute); a changed label is.
      const shape = await box(claimed).evaluate((b) => {
        const html = b.outerHTML;
        const aged = html.replace('claimed 3 hours ago', 'claimed 4 hours ago');
        const renamed = html.replace(/title="Claimed by /, 'title="Claimed by someone else, ');
        return { ageSame: aged !== html && threadShape(aged) === threadShape(html), labelDiffers: renamed !== html && threadShape(renamed) !== threadShape(html) };
      }).catch((e) => ({ error: String(e) }));
      check(shape.ageSame === true, t + ' the age ticking over leaves the room\'s shape alone', JSON.stringify(shape));
      check(shape.labelDiffers === true, t + ' CONTROL: a changed claim label is a new shape', JSON.stringify(shape));
      check(c1.free && c1.freeShown && c1.freeBy === made.member && c1.freeText === 'Free for another agent', t + ' Free for another agent sits beside it, naming the holder', JSON.stringify(c1));
      const two = await box(twoForms).evaluate((b) => ({ pills: [...b.querySelectorAll('.rxn')].map((x) => x.getAttribute('data-emoji') + (x.classList.contains('rxn-claim') ? ':claim' : '')),
        frees: b.querySelectorAll('.rxn-free').length })).catch((e) => ({ error: String(e) }));
      check(Array.isArray(two.pills) && two.pills.length === 2 && two.pills[1] === HAND + ':claim' && !String(two.pills[0]).endsWith(':claim') && two.frees === 1,
        t + ' with two raised-hand pills, the claim is drawn on the one the holder is on, with one Free', JSON.stringify(two));
      const o1 = await read(other);
      check(o1.pills === 1 && !o1.free && !o1.claimPill && !/Claimed/.test(String(o1.title)),
        t + ' CONTROL: the same agent\'s 👍 on the other post has no claim label and no Free', JSON.stringify(o1));

      // The person agrees by pressing the 🙋 pill (#6946): the one-row repaint keeps the claim label and Free.
      await box(claimed).locator('.rxn[data-emoji="' + HAND + '"]').click();
      await p.waitForFunction((id) => { const b = document.querySelector('#pj-room .rxns[data-post="' + id + '"] .rxn.mine'); return !!b; }, claimed, { timeout: 5000 }).catch(() => {});
      const c2 = await read(claimed);
      check(c2.claimPill && c2.free && /^Claimed by/.test(String(c2.title)), t + ' after the person\'s own 🙋 the repainted row still shows the claim and Free', JSON.stringify(c2));
      await box(claimed).locator('.rxn[data-emoji="' + HAND + '"]').click();   // take the agreement back
      await p.waitForFunction((id) => !document.querySelector('#pj-room .rxns[data-post="' + id + '"] .rxn.mine'), claimed, { timeout: 5000 }).catch(() => {});

      const toastSays = async (re) => {
        await p.waitForFunction((src) => { const el = document.getElementById('msg-toast'); return el && new RegExp(src).test(el.textContent); }, re.source, { timeout: 5000 }).catch(() => {});
        return p.evaluate(() => { const el = document.getElementById('msg-toast'); return el ? el.textContent : null; });
      };
      const focusIn = (id) => p.evaluate((pid) => { const a = document.activeElement; return a ? (a.closest('.rxns[data-post="' + pid + '"]') ? a.className : '#' + a.id) : null; }, id);

      // A free that could not be sent: a toast says so, Free stays pressable, the claim still shown.
      await p.route('**/free-claim', (route) => route.abort());
      await box(claimed).locator('.rxn-free').click();
      const t0 = await toastSays(/^We could not free that post\. Check that Kosmos is still running, then try again\.$/);
      check(t0 === 'We could not free that post. Check that Kosmos is still running, then try again.', t + ' a free that could not be sent says so in a toast', String(t0));
      const c3 = await read(claimed);
      check(c3.free && c3.freeDisabled === false && c3.claimPill, t + ' and Free is pressable again, with the claim still shown', JSON.stringify(c3));
      await p.unroute('**/free-claim');

      // A refused free (the claim changed hands since the page drew it): the 409 carries the post as it is now, so the
      // row redraws with the new holder, the toast names both, and focus stays in the row.
      await p.route('**/free-claim', (route) => route.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ ok: false, claimedBy: 'newhand', because: 'x', reactions: [{ emoji: HAND, count: 1, who: ['newhand'], mine: false }],
          claim: { by: 'newhand', at: new Date().toISOString() } }) }));
      await box(claimed).locator('.rxn-free').focus();
      await p.keyboard.press('Enter');   // from the keyboard, so focus is the page's to keep
      const t1 = await toastSays(/no longer holds it, newhand does\.$/);
      check(/^We could not free that post: .+ no longer holds it, newhand does\.$/.test(String(t1)), t + ' a refused free names who holds it now', String(t1));
      const c5 = await read(claimed);
      check(c5.freeBy === 'newhand' && c5.claimPill, t + ' and the row redraws with the holder the board answered', JSON.stringify(c5));
      check(await focusIn(claimed) === 'rxn-free', t + ' and focus stays on the row\'s Free', String(await focusIn(claimed)));
      await p.unroute('**/free-claim');

      // The real board's 409: the page now names newhand, who does not hold it; the board answers with the real holder.
      await box(claimed).locator('.rxn-free').click();
      await p.waitForFunction((id) => { const f = document.querySelector('#pj-room .rxns[data-post="' + id + '"] .rxn-free'); return f && f.getAttribute('data-claim-by') !== 'newhand'; }, claimed, { timeout: 5000 }).catch(() => {});
      const c6 = await read(claimed);
      check(c6.freeBy === made.member, t + ' the board\'s real 409 redraws the row with the real holder', JSON.stringify(c6));
      const t2 = await toastSays(/newhand no longer holds it, .+ does\.$/);
      check(/^We could not free that post: newhand no longer holds it, .+ does\.$/.test(String(t2)), t + ' and its toast names the real holder', String(t2));

      // Free frees it, through the real route, from the keyboard; while the request is out the row is rebuilt (as a
      // repaint can), so the answer must land on the row now on screen, not the one the press came from.
      let repaintedMidFlight = false;
      await p.route('**/free-claim', async (route) => {
        try {   // #6022: a handler that throws at teardown must not crash the check
          repaintedMidFlight = await p.evaluate(() => {
            // A repaint that rebuilt the row (a full repaint over the same content keeps it, measured): put a copy of it in
            // its place, so the row the press came from is no longer the one on screen.
            const old = document.querySelector('#pj-room .rxns[data-bc-tag="pressed"]');
            if (!old) return false;
            const copy = old.cloneNode(true);
            delete copy.dataset.bcTag;
            old.replaceWith(copy);
            return !document.querySelector('#pj-room .rxns[data-bc-tag="pressed"]') && !!copy.querySelector('.rxn-free');
          }).catch(() => false);
          await route.continue();
        } catch { /* the page closed under it */ }
      });
      await box(claimed).evaluate((b) => { b.dataset.bcTag = 'pressed'; });
      await box(claimed).locator('.rxn-free').focus();
      const answered = p.waitForResponse((r) => r.url().endsWith('/free-claim'), { timeout: 5000 }).catch(() => null);
      await p.keyboard.press('Enter');
      await answered;
      await p.waitForTimeout(150);   // the page's own repaint of the answer, well inside a room poll, so a poll cannot mend it
      const c4 = await read(claimed);
      await p.unroute('**/free-claim');
      check(repaintedMidFlight, t + ' precondition: the row was rebuilt while the free was out', String(repaintedMidFlight));
      check(c4.pills === 0 && !c4.free && !c4.claimPill, t + ' after Free the agent\'s 🙋 and the Free control are gone from the row on screen', JSON.stringify(c4));
      const said = await p.evaluate(() => { const el = document.getElementById('pj-room-say'); return el ? el.textContent : null; });
      check(/^Freed\. .+ no longer holds this post, and another agent can claim it\.$/.test(String(said)), t + ' the room\'s live region says it was freed', String(said));
      check(await focusIn(claimed) === '#pj-post', t + ' with the row empty, focus goes to the room\'s composer, not the page', String(await focusIn(claimed)));
      const text = await p.evaluate(async (id) => (await fetch('/api/project/' + id + '/room?as=text')).text(), made.id);
      check(text.includes('The person freed the claim ' + made.member + ' held on [' + claimed + ']') && !text.includes('[' + claimed + '] is claimed by'),
        t + ' the agents\' room view prints the note and no claim line', text.slice(-600));
      const o2 = await read(other);
      check(o2.pills === 1 && !o2.free, t + ' the other post\'s 👍 is untouched', JSON.stringify(o2));

      check(errs.length === 0, t + ' no page errors', errs.join(' | '));
      await p.close();
    }
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log(failures ? failures + ' of ' + ran + ' checks failed' : 'all ' + ran + ' checks passed');
  process.exit(failures || ran === 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
