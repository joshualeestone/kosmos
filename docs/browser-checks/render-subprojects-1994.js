'use strict';
// Browser-check-surface: pj-parent pjsub pj-one-subprojects pj-crumb pj-back pj-crumb-cur pj-crumb-lead
// (#2518) the distinctive web/index.html tokens this check asserts (the ancestry/parent
// chip + the sub-projects line + the detail/consolidated sub-projects strip); a change to
// them must update this check at PR time. #2487 changed pj-parent to a full ancestry line
// and staled this check's exact-match to the cut; #2848 added the consolidated placement of
// pj-one-subprojects (Layer 1e), so a change to where that strip lives must update it too.
/* #1994: sub-projects UI: a project can name a parent, shown as a tree in the
 * wide Projects tab (indent) and, #2487, a full ancestry line ("Kosmos › App",
 * middle-elided past depth two) with decorative depth dots everywhere narrow, plus
 * a parent trail + sub-projects section on the detail page, plus
 * a set-parent <select> in project settings that can only offer a valid parent,
 * and (#2458) a parent <select> on the CREATE page that sends `parent` on create.
 * Drives the SHIPPED paintProjects / projectCard / paintProjectSettings / openAddProject
 * + the #pj-create handler against a real fixture PROJECTS tree in the real page, not a copy. Controls that can
 * return the dangerous answer: nothing vanishes (a child of an archived/dangling
 * parent still renders), a stored cycle still renders every row without hanging,
 * and the parent select excludes self + descendants (offer a cycle and the
 * engine would refuse it). Both themes.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-subprojects-1994.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    // The page fires startup polls at file:// that cannot load. We drive the
    // render functions directly with a fixture PROJECTS, so we do NOT stub fetch
    // (a blanket {} stub breaks the unrelated members/free-agent path). Just
    // stop the 5s poll and ignore the harness's own file:// fetch errors, so a
    // genuine console error from the code under test still surfaces.
    await page.addInitScript(() => { window.setInterval = () => 0; });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    await page.goto(PAGE);
    const t = `[${theme}]`;

    // ---- Layer 1: the tree render ----
    const tree = await page.evaluate(() => {
      const mk = (id, name, parent, parentName, archived) => ({ id, name, parent: parent || null, parentName: parentName || null, parentArchived: false, archived: !!archived, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [
        mk('k', 'Kosmos'), mk('app', 'App', 'k', 'Kosmos'), mk('mob', 'Mobile', 'app', 'App'),
        mk('and', 'Android', 'mob', 'Mobile'), mk('ios', 'iOS', 'mob', 'Mobile'), mk('site', 'Site', 'k', 'Kosmos'),
        mk('orph', 'Orphan', 'gone', null), mk('arch', 'Archived one', null, null, true), mk('ac', 'ArchChild', 'arch', 'Archived one'),
      ];
      PJ_SORT = 'az';
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.getElementById('panel-projects').hidden = false;
      // Force the wide LIST sub-view (not the asgrid grid) so the chip-vs-indent
      // rules under test apply: indent carries a nested child, the chip carries
      // an orphan. The --pj-depth STYLE attribute is set regardless of mode, so
      // the depth assertions below are mode-independent; only chipDisplay is not.
      document.getElementById('pj-list').classList.remove('asgrid');
      document.body.classList.remove('consolidated');
      paintProjects();
      const rows = Array.from(document.querySelectorAll('#pj-list .pj-row'));
      const by = {};
      rows.forEach((r, i) => { const chipEl = r.querySelector('.pj-parent'); by[r.getAttribute('data-project')] = {
        i, depth: Number(r.style.getPropertyValue('--pj-depth') || 0),
        // The COMPUTED indent, not the inline --pj-depth var we set: a typo in
        // the `calc(var(--pj-depth,0)*22px)` rule (wrong var/unit) would ship
        // green if we only read back the property we wrote.
        marginLeft: getComputedStyle(r).marginLeft,
        sub: (r.querySelector('.pjsub') || {}).textContent || '',
        chip: (chipEl || {}).textContent || '',
        chipDisplay: chipEl ? getComputedStyle(chipEl).display : 'none',
        childClass: r.classList.contains('child') };
      });
      return { count: rows.length, ids: rows.map((r) => r.getAttribute('data-project')), by };
    });
    // 8 active projects (arch is archived); NOTHING vanishes.
    ok(t + ' all active rows render (nothing vanishes)', tree.count === 8, 'count=' + tree.count + ' ids=' + tree.ids.join(','));
    // nesting: a child of an ACTIVE parent nests (depth>0, after its parent)
    ok(t + ' app nests under k', tree.by.app && tree.by.app.depth === 1 && tree.by.app.i > tree.by.k.i, JSON.stringify(tree.by.app));
    ok(t + ' mobile depth 2', tree.by.mob && tree.by.mob.depth === 2);
    ok(t + ' android/ios depth 3', tree.by.and && tree.by.and.depth === 3 && tree.by.ios.depth === 3);
    ok(t + ' children carry .child class', tree.by.app.childClass && tree.by.and.childClass && !tree.by.k.childClass);
    // sub-project counts derived from the same grouping
    ok(t + ' k shows 2 sub-projects', /2 sub-projects/.test(tree.by.k.sub), tree.by.k.sub);
    ok(t + ' app shows 1 sub-project', /1 sub-project\b/.test(tree.by.app.sub), tree.by.app.sub);
    ok(t + ' leaf shows no sub count', tree.by.and.sub === '');
    // orphan (dangling parent id) renders at top level
    ok(t + ' dangling-parent child renders at top level', tree.by.orph && tree.by.orph.depth === 0);
    // archived-parent child renders at top level BUT keeps the ancestry line (relationship not dropped)
    ok(t + ' archived-parent child renders top level', tree.by.ac && tree.by.ac.depth === 0);
    // #2487: the "under <parent>" chip became a full ancestry line ("Kosmos › App"),
    // so the relationship is now the name(s) without the "under" prefix.
    ok(t + ' archived-parent child keeps its ancestry line', /Archived one/.test(tree.by.ac.chip), tree.by.ac.chip);
    // the ancestry line carries the parent name for a nested child too
    ok(t + ' nested child has ancestry line', /Kosmos/.test(tree.by.app.chip), tree.by.app.chip);
    // In the wide LIST view the indent carries a nested child's relationship, so
    // its chip is hidden; but an orphan (archived/dangling parent) has no indent,
    // so ITS chip must stay visible or the relationship would vanish in list mode.
    ok(t + ' nested child chip hidden in list view', tree.by.app.chipDisplay === 'none', tree.by.app.chipDisplay);
    ok(t + ' orphan chip stays visible in list view', tree.by.ac.chipDisplay !== 'none', 'ac chipDisplay=' + tree.by.ac.chipDisplay);
    // COMPUTED indent renders (not just the inline var): depth 1 -> 22px, depth 2 -> 44px, top level -> 0.
    ok(t + ' computed indent depth1 = 22px', tree.by.app.marginLeft === '22px', tree.by.app.marginLeft);
    ok(t + ' computed indent depth2 = 44px', tree.by.mob.marginLeft === '44px', tree.by.mob.marginLeft);
    ok(t + ' computed indent top level = 0px', tree.by.k.marginLeft === '0px', tree.by.k.marginLeft);
    // CONTROL: without nesting, app would be at the same depth as k. Prove the
    // instrument can see the dangerous answer by checking depth actually varies.
    ok(t + ' CONTROL depth varies (grouping is real, not flat)', new Set(Object.values(tree.by).map((x) => x.depth)).size >= 3);

    // ---- Layer 1b: a stored CYCLE must still render every row, not hang ----
    const cyc = await page.evaluate(() => {
      const mk = (id, name, parent) => ({ id, name, parent: parent || null, parentName: null, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('a', 'A', 'b'), mk('b', 'B', 'a'), mk('c', 'C')];   // a<->b cycle, c free
      PJ_SORT = 'az';
      paintProjects();
      return Array.from(document.querySelectorAll('#pj-list .pj-row')).map((r) => r.getAttribute('data-project')).sort();
    });
    ok(t + ' cycle renders all rows (no vanish, no hang)', cyc.length === 3 && cyc.join(',') === 'a,b,c', JSON.stringify(cyc));

    // ---- Layer 1c: the GRID view drops the indent and shows the chip ----
    // The headline "chip carries the relationship where there is no indent":
    // in the asgrid grid a nested child has no indent (margin 0) and its chip
    // is visible, the inverse of list mode.
    const grid = await page.evaluate(() => {
      const mk = (id, name, parent, parentName) => ({ id, name, parent: parent || null, parentName: parentName || null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos'), mk('app', 'App', 'k', 'Kosmos')];
      PJ_SORT = 'az';
      document.body.classList.remove('consolidated');
      document.getElementById('pj-list').classList.add('asgrid');   // grid sub-view
      paintProjects();
      const row = document.querySelector('#pj-list .pj-row[data-project="app"]');
      const chip = row.querySelector('.pj-parent');
      return { marginLeft: getComputedStyle(row).marginLeft, chipDisplay: chip ? getComputedStyle(chip).display : 'none' };
    });
    ok(t + ' grid view drops the indent', grid.marginLeft === '0px', grid.marginLeft);
    ok(t + ' grid view shows the chip', grid.chipDisplay !== 'none', grid.chipDisplay);

    // ---- Layer 1d: #2487 the ancestry line (full chain + decorative dots) and
    // the detail-page parent trail + sub-projects section. The single "under
    // <parent>" chip became a full path so a grandchild is not mistaken for a
    // top-level project; deep chains middle-elide, keeping root + immediate. ----
    const anc = await page.evaluate(() => {
      const mk = (id, name, parent) => ({ id, name, parent: parent || null, parentName: parent ? name + ' parent' : null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos'), mk('app', 'App', 'k'), mk('mob', 'Mobile', 'app'), mk('gc', 'Deep', 'mob')];
      PJ_SORT = 'az';
      document.body.classList.remove('consolidated');
      document.getElementById('pj-list').classList.add('asgrid');   // grid: the ancestry line is visible
      paintProjects();
      const rowOf = (id) => document.querySelector('#pj-list .pj-row[data-project="' + id + '"]');
      const ancT = (id) => { const e = rowOf(id).querySelector('.pj-anc-t'); return e ? e.textContent : ''; };
      const dotsAria = (id) => { const d = rowOf(id).querySelector('.pj-dots'); return d ? d.getAttribute('aria-hidden') : null; };
      const out = { gcChain: ancT('gc'), mobChain: ancT('mob'), appChain: ancT('app'), gcDots: dotsAria('gc') };
      try {
        PJ_CURRENT = 'mob'; paintOneProject();
        const crumb = document.getElementById('pj-crumb');
        const back = document.getElementById('pj-back');
        const subs = document.getElementById('pj-one-subprojects');
        out.crumbText = crumb ? crumb.textContent : null; out.hasBack = !!back;
        // #2928: the current project is a protected crumb (.pj-crumb-cur) so CSS
        // truncation eats the ancestor lead (.pj-crumb-lead), never the "you are
        // here" name. Capture both to assert the structure, not just the joined text.
        out.crumbCur = crumb ? (crumb.querySelector('.pj-crumb-cur') || {}).textContent || null : null;
        out.crumbLead = crumb ? (crumb.querySelector('.pj-crumb-lead') || {}).textContent || null : null;
        out.subsHidden = subs.hidden; out.subKid = !!subs.querySelector('.pj-subrow[data-project="gc"]');
        // #2487: the row must actually OPEN on click. It lives in #pj-one-view, a
        // sibling of #pj-list, so the list delegate does not cover it -- this proves
        // the section's OWN delegate fires (a row that looks clickable but is inert
        // was the iteration-1 blocker).
        const kidBtn = subs.querySelector('.pj-subrow[data-project="gc"]');
        if (kidBtn) { kidBtn.click(); out.opened = (PJ_CURRENT === 'gc'); } else { out.opened = false; }
        // #2487 hidden branches (both empty states, like the Map check): a top-level
        // project hides the parent trail; a leaf hides the sub-projects section.
        PJ_CURRENT = 'k'; paintOneProject();
        const topCrumbEl = document.getElementById('pj-crumb');
        out.topCrumbText = topCrumbEl ? topCrumbEl.textContent : null;
        out.topCrumbCur = topCrumbEl ? ((topCrumbEl.querySelector('.pj-crumb-cur') || {}).textContent || null) : null;
        out.topHasLead = topCrumbEl ? !!topCrumbEl.querySelector('.pj-crumb-lead') : null;
        PJ_CURRENT = 'gc'; paintOneProject();   // gc is a leaf (no children)
        out.leafSubsHidden = document.getElementById('pj-one-subprojects').hidden;
        // #2928: the back chevron NAVIGATES, it is not just present. A subproject
        // goes UP one nesting level (openProject on the parent); a top-level project
        // returns to the list. Click it and assert the resulting state, mirroring the
        // sub-row click above (which proves openProject fires in this harness). This
        // is the card's core deliverable, so a green presence check was not enough.
        PJ_CURRENT = 'mob'; paintOneProject();          // mob's parent is app
        document.getElementById('pj-back').click();
        out.backSubCurrent = PJ_CURRENT;                // expect 'app'
        out.backSubView = PJ_VIEW;                       // expect 'one'
        PJ_CURRENT = 'k'; paintOneProject();            // k is top-level (no parent)
        document.getElementById('pj-back').click();
        out.backTopCurrent = PJ_CURRENT;                // expect null (back to list)
        out.backTopView = PJ_VIEW;                       // expect 'list'
        out.detailErr = null;
      } catch (e) { out.detailErr = String(e && e.message || e); }
      return out;
    });
    ok(t + ' ancestry: grandchild shows both ancestors', /Kosmos/.test(anc.mobChain) && /App/.test(anc.mobChain), anc.mobChain);
    ok(t + ' ancestry: great-grandchild elides middle, keeps root + immediate', /Kosmos/.test(anc.gcChain) && /Mobile/.test(anc.gcChain) && /…/.test(anc.gcChain), anc.gcChain);
    // #2487: the middle is elided VISUALLY (the … above) but the dropped name rides
    // along as vh text, so the accessible textContent still carries the full chain
    // (space is the only reason to elide and it does not bind a screen reader).
    ok(t + ' ancestry: the elided middle name still reaches a screen reader (vh)', /App/.test(anc.gcChain), anc.gcChain);
    // #2487: like the multi-ancestor chains above, the single-parent chain carries
    // the vh "In " lead-in (see the assertion below). Require the lead-in AND exactly
    // the one parent name and nothing else: anchored so it goes red if the lead-in is
    // dropped on this path, and still distinct from a nested child ("In Kosmos › App").
    ok(t + ' ancestry: child shows the one parent', /^In\s+Kosmos$/.test(anc.appChain), anc.appChain);
    ok(t + ' ancestry: depth dots are decorative (aria-hidden)', anc.gcDots === 'true', 'aria-hidden=' + anc.gcDots);
    // #2928: the detail-page trail is now a full-location breadcrumb ("Kosmos / App
    // / Mobile", current project included) beside a back chevron, replacing #2487's
    // ancestor-only #pj-one-parent trail.
    ok(t + ' detail: breadcrumb shows the full nested chain + back chevron', anc.detailErr === null && anc.hasBack === true && /Kosmos/.test(anc.crumbText || '') && /App/.test(anc.crumbText || '') && /Mobile/.test(anc.crumbText || ''), JSON.stringify({ err: anc.detailErr, back: anc.hasBack, txt: anc.crumbText }));
    // The chain must read root-to-current IN ORDER, not merely contain the names:
    // a garbled or reversed concatenation ("Mobile ... App ... Kosmos") would pass a
    // bare substring check but is the dangerous answer this asserts against.
    ok(t + ' detail: breadcrumb reads root-to-current in order', anc.detailErr === null && (anc.crumbText || '').indexOf('Kosmos') < (anc.crumbText || '').indexOf('App') && (anc.crumbText || '').indexOf('App') < (anc.crumbText || '').indexOf('Mobile'), JSON.stringify({ txt: anc.crumbText }));
    // #2928: the current project is its OWN protected crumb (.pj-crumb-cur) and the
    // ancestors sit in .pj-crumb-lead, which carries the ellipsis and shrinks first.
    // A single-ellipsis container truncated the tail -- i.e. the current name, the one
    // piece a "you are here" breadcrumb exists to show -- so this asserts the structure
    // that protects it, not merely the joined text.
    ok(t + ' #2928 detail: current project is a protected crumb, ancestors in the lead', anc.detailErr === null && anc.crumbCur === 'Mobile' && /Kosmos/.test(anc.crumbLead || '') && /App/.test(anc.crumbLead || ''), JSON.stringify({ cur: anc.crumbCur, lead: anc.crumbLead }));
    // #2928: clicking the back chevron NAVIGATES (the card's core behavior), not
    // merely renders. A subproject goes UP to its parent; a top-level goes to the list.
    ok(t + ' #2928 back: clicking the chevron on a subproject opens its parent', anc.detailErr === null && anc.backSubCurrent === 'app' && anc.backSubView === 'one', JSON.stringify({ err: anc.detailErr, cur: anc.backSubCurrent, view: anc.backSubView }));
    ok(t + ' #2928 back: clicking the chevron on a top-level project returns to the list', anc.detailErr === null && anc.backTopCurrent === null && anc.backTopView === 'list', JSON.stringify({ err: anc.detailErr, cur: anc.backTopCurrent, view: anc.backTopView }));
    ok(t + ' detail: sub-projects section lists a direct child', anc.detailErr === null && anc.subsHidden === false && anc.subKid === true, JSON.stringify({ err: anc.detailErr, h: anc.subsHidden, kid: anc.subKid }));
    ok(t + ' detail: a sub-project row OPENS on click (its own delegate, not the list’s)', anc.detailErr === null && anc.opened === true, JSON.stringify({ err: anc.detailErr, opened: anc.opened }));
    ok(t + ' detail: a top-level project shows just its own name as the single crumb (no ancestor separators)', anc.detailErr === null && /Kosmos/.test(anc.topCrumbText || '') && !/\//.test(anc.topCrumbText || ''), JSON.stringify({ err: anc.detailErr, txt: anc.topCrumbText }));
    // #2928: and that single crumb is the protected current crumb, with NO ancestor
    // lead element at all (a top-level project has no ancestors to truncate).
    ok(t + ' #2928 detail: a top-level project is a single protected crumb with no lead', anc.detailErr === null && anc.topCrumbCur === 'Kosmos' && anc.topHasLead === false, JSON.stringify({ cur: anc.topCrumbCur, hasLead: anc.topHasLead }));
    ok(t + ' detail: a leaf project hides the sub-projects section', anc.detailErr === null && anc.leafSubsHidden === true, JSON.stringify({ err: anc.detailErr, leafSubsHidden: anc.leafSubsHidden }));
    // #2487: the card chain gets a vh "In " lead-in so a screen reader frames the
    // names as ancestry rather than a run of unlabelled text after the card title.
    ok(t + ' ancestry: a vh "In " lead-in frames the names for a screen reader', /In\s/.test(anc.mobChain), anc.mobChain);

    // #2487: the consolidated rail reuses projectCard but ships one rail-specific rule
    // (body.consolidated .pj-anc { justify-content: flex-start }). Assert the ancestry
    // line actually renders (and is displayed, not display:none) under consolidated, so
    // that rule and this surface are not shipped with zero coverage.
    const rail = await page.evaluate(() => {
      const mk = (id, name, parent) => ({ id, name, parent: parent || null, parentName: parent ? name + ' parent' : null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos'), mk('app', 'App', 'k'), mk('mob', 'Mobile', 'app')];
      PJ_SORT = 'az';
      document.getElementById('pj-list').classList.remove('asgrid');
      document.body.classList.add('consolidated');
      paintProjects();
      const row = document.querySelector('#pj-list .pj-row[data-project="mob"]');
      const t2 = row && row.querySelector('.pj-anc-t');
      const anchor = row && row.querySelector('.pj-anc');
      const out = { txt: t2 ? t2.textContent : '', disp: anchor ? getComputedStyle(anchor).display : 'none' };
      document.body.classList.remove('consolidated');   // restore for later layers
      return out;
    });
    ok(t + ' rail (consolidated): the ancestry line renders and is displayed', /Kosmos/.test(rail.txt) && /App/.test(rail.txt) && rail.disp !== 'none', JSON.stringify(rail));

    // ---- Layer 1e: #2848 the CONSOLIDATED sub-project HEADER ----
    // Josh, 0.6.57 review: the sub-project view was "breaking across the top" --
    // a project with a sub-project stacked three bars (a "1 sub-project" label,
    // the child row, and the project name, which lives in the conversation
    // header since #761). placeSubProjects nests the strip UNDER that header in
    // the consolidated view so the two read as ONE header; the tab view keeps
    // the strip above the grid, where #2487 put it. Drives the SHIPPED
    // placeProjectHead + placeSubProjects + paintOneProject against a real
    // parent/child fixture in the real page.
    const subhead = await page.evaluate(() => {
      const mk = (id, name, parent) => ({ id, name, parent: parent || null, parentName: parent ? 'Kosmos' : null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos'), mk('app', 'App', 'k')];   // k has one sub-project (app); app is a leaf
      PJ_SORT = 'az';
      const out = {};
      const oneView = document.getElementById('pj-one-view');
      const subs = document.getElementById('pj-one-subprojects');
      const pj3 = oneView.querySelector('.pj3');
      const midCol = oneView.querySelector('.pjmid');
      const midHead = oneView.querySelector('.pjmidhead');
      const origLayout = document.documentElement.getAttribute('data-layout');
      const origHidden = oneView.hidden;
      try {
        placeProjectHead();                 // the name moves into .pjmidhead, as in production
        oneView.hidden = false;             // so the computed-style reads below are used values, not display:none
        // CONTROL (tab view): the strip stays in #pj-one-view, above the grid --
        // its original #2487 slot. This is the state #2848 changes for consolidated.
        document.documentElement.setAttribute('data-layout', 'tabs');
        document.body.classList.remove('consolidated');
        placeSubProjects(false);
        PJ_CURRENT = 'k'; paintOneProject();
        out.tabParent = subs.parentElement === oneView;
        // DOCUMENT_POSITION_FOLLOWING on compareDocumentPosition(pj3) => pj3 follows subs, i.e. the strip precedes the grid.
        out.tabBeforeGrid = !!(subs.compareDocumentPosition(pj3) & Node.DOCUMENT_POSITION_FOLLOWING);
        // CONSOLIDATED: the strip nests into .pjmid, right after the header, so
        // the name is the top of one header block and the strip sits beneath it.
        document.documentElement.setAttribute('data-layout', 'consolidated');
        document.body.classList.add('consolidated');
        placeSubProjects(true);
        PJ_CURRENT = 'k'; paintOneProject();
        out.consParent = subs.parentElement === midCol;
        out.afterHead = midHead.nextElementSibling === subs;
        out.subsHidden = subs.hidden;
        out.hasKid = !!subs.querySelector('.pj-subrow[data-project="app"]');
        // One line under both: the header drops its own bottom rule while a
        // visible strip follows, and the strip carries the rule.
        out.headBorder = getComputedStyle(midHead).borderBottomWidth;
        out.stripBorder = getComputedStyle(subs).borderBottomWidth;
        // CONTROL that the rule is CONDITIONAL: a leaf project (app, no children)
        // hides the strip, so the :has() does not fire and the header keeps its rule.
        PJ_CURRENT = 'app'; paintOneProject();
        out.leafSubsHidden = subs.hidden;
        out.leafHeadBorder = getComputedStyle(midHead).borderBottomWidth;
        out.err = null;
      } catch (e) { out.err = String(e && e.message || e); }
      // restore for later layers (they run in the tab context)
      document.documentElement.setAttribute('data-layout', origLayout || 'tabs');
      document.body.classList.remove('consolidated');
      placeSubProjects(false);
      oneView.hidden = origHidden;
      return out;
    });
    ok(t + ' #2848 CONTROL (tab): the strip stays above the grid in #pj-one-view', subhead.err === null && subhead.tabParent === true && subhead.tabBeforeGrid === true, JSON.stringify(subhead));
    ok(t + ' #2848 consolidated: the strip nests into the conversation column (.pjmid)', subhead.err === null && subhead.consParent === true, JSON.stringify(subhead));
    ok(t + ' #2848 consolidated: the strip sits directly after the header, not above it', subhead.err === null && subhead.afterHead === true, JSON.stringify(subhead));
    ok(t + ' #2848 consolidated: the strip still lists its sub-project', subhead.err === null && subhead.subsHidden === false && subhead.hasKid === true, JSON.stringify(subhead));
    ok(t + ' #2848 consolidated: header drops its rule, the strip carries it (one line under both)', subhead.err === null && subhead.headBorder === '0px' && subhead.stripBorder === '1px', JSON.stringify(subhead));
    ok(t + ' #2848 CONTROL: a leaf hides the strip, so the header keeps its own rule', subhead.err === null && subhead.leafSubsHidden === true && subhead.leafHeadBorder === '1px', JSON.stringify(subhead));

    // ---- Layer 2: the set-parent select ----
    const select = await page.evaluate(() => {
      const mk = (id, name, parent, parentName, archived) => ({ id, name, parent: parent || null, parentName: parentName || null, archived: !!archived, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [
        mk('k', 'Kosmos'), mk('app', 'App', 'k', 'Kosmos'), mk('mob', 'Mobile', 'app', 'App'),
        mk('and', 'Android', 'mob', 'Mobile'), mk('site', 'Site', 'k', 'Kosmos'), mk('arch', 'Archived one', null, null, true),
      ];
      PJ_SORT = 'az'; PJ_CURRENT = 'app';
      paintProjectSettings(pjById('app'));
      const sel = document.getElementById('pjs-parent');
      return { value: sel.value, opts: Array.from(sel.options).map((o) => o.value) };
    });
    ok(t + ' select preselects current parent', select.value === 'k', select.value);
    ok(t + ' select offers Top level (none)', select.opts.includes(''), JSON.stringify(select.opts));
    ok(t + ' select excludes self', !select.opts.includes('app'), JSON.stringify(select.opts));
    // CONTROL that can return the dangerous answer: descendants MUST be excluded,
    // or picking one would create a cycle the engine refuses.
    ok(t + ' select excludes descendants (mob/and)', !select.opts.includes('mob') && !select.opts.includes('and'), JSON.stringify(select.opts));
    ok(t + ' select excludes archived', !select.opts.includes('arch'), JSON.stringify(select.opts));
    ok(t + ' select includes valid parents (k, site)', select.opts.includes('k') && select.opts.includes('site'), JSON.stringify(select.opts));

    // ---- Layer 2b: a current parent that is ARCHIVED must stay represented ----
    // Engine allows archiving a project that has children; if the select could
    // not show that parent it would read "Top level (none)" and a later save of
    // an unrelated field would silently send parent:null. The select must keep
    // the archived parent as its preselected value so the diff stays honest.
    const arch = await page.evaluate(() => {
      const mk = (id, name, parent, parentName, parentArchived, archived) => ({ id, name, parent: parent || null, parentName: parentName || null, parentArchived: !!parentArchived, archived: !!archived, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [
        mk('k', 'Kosmos', null, null, false, true),          // the parent, now ARCHIVED
        mk('app', 'App', 'k', 'Kosmos', true, false),        // child of the archived parent
        mk('site', 'Site', null, null, false, false),
      ];
      PJ_SORT = 'az'; PJ_CURRENT = 'app';
      paintProjectSettings(pjById('app'));
      const sel = document.getElementById('pjs-parent');
      const cur = Array.from(sel.options).find((o) => o.value === 'k');
      return { value: sel.value, hasArchivedParentOption: !!cur, label: cur ? cur.textContent : '' };
    });
    ok(t + ' archived parent stays the select value (no silent un-group)', arch.value === 'k', arch.value);
    ok(t + ' archived parent shown with an option', arch.hasArchivedParentOption, JSON.stringify(arch));
    ok(t + ' archived parent option is labelled archived', /archived/i.test(arch.label), arch.label);

    // ---- Layer 2c: reopening settings clears a stale parent-refusal state ----
    // A parent refusal marks #pjs-parent .bad + aria-invalid. Repainting the
    // select (reopening settings without saving) must clear that STATE, not just
    // the message text, or the field shows a red/invalid border with no reason.
    const reopen = await page.evaluate(() => {
      const mk = (id, name) => ({ id, name, parent: null, parentName: null, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos'), mk('app', 'App')];
      PJ_SORT = 'az'; PJ_CURRENT = 'app';
      pjFieldBad('pjs-parent', 'pjs-parent-err', 'a prior refusal');   // simulate a refusal
      const before = document.getElementById('pjs-parent').classList.contains('bad');
      paintProjectSettings(pjById('app'));                             // reopen the panel
      const el = document.getElementById('pjs-parent');
      return { before, badAfter: el.classList.contains('bad'), ariaAfter: el.getAttribute('aria-invalid') };
    });
    ok(t + ' CONTROL field was marked bad', reopen.before);
    ok(t + ' reopening clears stale invalid state', !reopen.badAfter && !reopen.ariaAfter, JSON.stringify(reopen));

    // ---- Layer 3: the CREATE-page parent select (#2458) ----
    // The backend has accepted `parent` on create since #2467; this is the UI that
    // sends it. Drive the SHIPPED openAddProject (which populates #pj-parent) and the
    // SHIPPED #pj-create click handler, and prove: the select offers Top level + the
    // active projects (archived excluded), a fresh create starts top-level, a chosen
    // parent reaches the POST body, and -- the control that can return the dangerous
    // answer -- a top-level create OMITS parent rather than sending parent:null.
    const create = await page.evaluate(async () => {
      const mk = (id, name, archived, parent) => ({ id, name, parent: parent || null, parentName: null, parentArchived: false, archived: !!archived, summary: {}, agents: [], description: '', unread: 0 });
      // 'sub' is itself a sub-project (parent 'k'); it MUST still be offered as a parent
      // for the new project -- the create selector filters on !archived only, never on
      // !parent (nesting is allowed; the engine only refuses self/cycle, neither reachable
      // for a brand-new project). See the sub-offered assertion below.
      PROJECTS = [mk('k', 'Kosmos'), mk('site', 'Site'), mk('sub', 'Sub of Kosmos', false, 'k'), mk('arch', 'Archived one', true)];
      PJ_SORT = 'az';
      openAddProject();                                   // populates #pj-add-parent, resets to top-level
      const sel = document.getElementById('pj-add-parent');
      const opts = Array.from(sel.options).map((o) => o.value);
      const startValue = sel.value;

      // Capture the POST body via a one-shot fetch stub that REFUSES, so the handler
      // stops before loadProjects/openProject (no file:// side effects) after recording.
      const realFetch = window.fetch;
      let sent = null;
      window.fetch = async (url, o) => {
        if (String(url).indexOf('/api/projects') !== -1 && o && o.method === 'POST') {
          sent = JSON.parse(o.body);
          return { ok: false, json: async () => ({ error: 'stub: captured' }) };
        }
        return realFetch(url, o);
      };
      document.getElementById('pj-name').value = 'Login screen';
      sel.value = 'k';
      document.getElementById('pj-create').click();
      await new Promise((r) => setTimeout(r, 30));
      const withParent = sent;

      sent = null;
      sel.value = '';                                     // top-level
      document.getElementById('pj-create').click();
      await new Promise((r) => setTimeout(r, 30));
      const topLevel = sent;

      window.fetch = realFetch;
      return { opts, startValue, withParent, topLevel };
    });
    ok(t + ' create select offers Top level (none) first', create.opts[0] === '', JSON.stringify(create.opts));
    ok(t + ' create select lists active projects (k, site)', create.opts.includes('k') && create.opts.includes('site'), JSON.stringify(create.opts));
    ok(t + ' create select excludes archived', !create.opts.includes('arch'), JSON.stringify(create.opts));
    // CONTROL: an existing SUB-project must still be offered as a parent -- the create
    // selector must NOT filter on !parent. This fails if the populate ever regressed to
    // also excluding projects that have a parent (which would silently forbid nesting).
    ok(t + ' create select offers an existing sub-project as a parent (does NOT exclude by parent)', create.opts.includes('sub'), JSON.stringify(create.opts));
    ok(t + ' create starts top-level', create.startValue === '', create.startValue);
    ok(t + ' a chosen parent is sent in the create body', create.withParent && create.withParent.parent === 'k', JSON.stringify(create.withParent));
    // CONTROL: top-level MUST omit parent, not send parent:null (absent-not-null discipline).
    ok(t + ' top-level create OMITS parent (absent, not null)', create.topLevel && !('parent' in create.topLevel), JSON.stringify(create.topLevel));

    // ---- Layer 4: #2848 the WIRING, through the real caller (showTab) ----
    // Layer 1e drives placeSubProjects() directly, which proves the function moves
    // the strip -- but not that the shipped code ever calls it. The one production
    // caller is showTab (it runs placeSubProjects(cons) keyed on the same cons that
    // toggles body.consolidated). If that call line were deleted or its flag
    // desynced, production would never nest the strip while every Layer 1e assertion
    // stayed green. So drive showTab itself and assert the strip lands correctly in
    // BOTH effective views. Runs last in the theme so showTab's rail/board side
    // effects cannot disturb the earlier layers.
    const wiring = await page.evaluate(() => {
      const mk = (id, name, parent) => ({ id, name, parent: parent || null, parentName: parent ? 'Kosmos' : null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos'), mk('app', 'App', 'k')];
      PJ_SORT = 'az';
      const out = {};
      const subs = document.getElementById('pj-one-subprojects');
      const oneView = document.getElementById('pj-one-view');
      const midCol = oneView.querySelector('.pjmid');
      try {
        placeProjectHead();
        PJ_CURRENT = 'k';
        if (typeof pjView === 'function') pjView('one');
        paintOneProject();
        // The viewport is 1200px wide (>= the 960 consolidated floor), so with
        // data-layout=consolidated showTab computes cons=true and must nest the strip.
        document.documentElement.setAttribute('data-layout', 'consolidated');
        document.body.classList.remove('consolidated');   // let showTab re-add it
        showTab('projects');
        out.consBody = document.body.classList.contains('consolidated');
        out.consSubsInMid = subs.parentElement === midCol;
        // Flip to the tab layout through the same caller: cons=false, strip restored.
        document.documentElement.setAttribute('data-layout', 'tabs');
        showTab('projects');
        out.tabBody = document.body.classList.contains('consolidated');
        out.tabSubsInOneView = subs.parentElement === oneView;
        out.err = null;
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    });
    // showTab actually flipped the effective view (control: the two body states differ).
    ok(t + ' #2848 wiring CONTROL: showTab toggles body.consolidated (true then false)', wiring.err === null && wiring.consBody === true && wiring.tabBody === false, JSON.stringify(wiring));
    // and the SAME call nested the strip into .pjmid under consolidated ...
    ok(t + ' #2848 wiring: showTab (consolidated) nests the strip into .pjmid', wiring.err === null && wiring.consSubsInMid === true, JSON.stringify(wiring));
    // ... and restored it to #pj-one-view under the tab layout.
    ok(t + ' #2848 wiring: showTab (tab) restores the strip to #pj-one-view', wiring.err === null && wiring.tabSubsInOneView === true, JSON.stringify(wiring));

    await page.close();
  }
  await browser.close();
  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
