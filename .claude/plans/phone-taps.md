# phone-taps: Monday's phone sweep, the newcomer's first screens (#5218, #5219, #5220, #5221)

Splinter 23:42: audit the screens a Kosmos+ newcomer hits on a phone; card; fix as after-Monday PRs. MERGE AFTER
MONDAY (main is frozen until the 07:00 pin).

## Done looks like (touch screens and any coarse pointer only; desktop unchanged)
- #5218, the agents board: each agent's name (.namego) has a 44px hit area (centred ::after); a notice's close the
  same; the menu's tabs and Sort agents are 44 tall.
- #5219, a project's room: a document row and Try again are 44 tall.
- #5220, AI settings: the terminal box (#d-term-say) is 16px text, because under 16 iPhone Safari zooms the page on
  a tap, and 44 tall; Open Terminal, Remove this agent, Send and Trust & Restart are 44 tall.
- #5221: Sort projects, Upload an org chart and Join Kosmos+ are 44; the Tasks back chevron keeps its 32px circle with
  a 44px hit area.
- Deliberately KEPT, measured, not missed:
  - the room header's 36px areas (#4663): at 44, render-room-msgbox-2806's pixel scan found 64px of the breadcrumb
    answering as Back, and View All as + New task on a tablet; reverted to 36
  - the composer's file, emoji and Post: #4108's row
  - the reaction chips (36): repeated in every message
  - Answer (button.ansgo, box 63x24, hit area about 75x40 from its ::after inset -8px -6px): a 44 area reaches the
    next row (its own comment). Its BOX is what the audit lists (63x24); its reach is about 40 (Angel's review corrected
    an earlier "about 40" that read as the box).
- docs/browser-checks/mobile-shots.js gains a covers audit beside taps:
  - across every control's own box (every 3px, edges included), a tap must land on that control
  - a point answered by another control OUTSIDE that control's drawn box (1px slack for a snapped shared edge) is a
    cover: a hit area taking a neighbour's tap
  - a point INSIDE another control's box counts too (padding taken back by a negative margin is a hit area), unless
    the two sit in different layers (each one's nearest ANCESTOR that is fixed, absolute, sticky or an open dialog:
    an open menu over the page is stacking; two absolute siblings in one layer are not) or the other is drawn inside
    this one (a label's own input); 1.5px of a snapped shared edge is ignored
  - labels are scanned (a label row takes a tap for its control), and a DESCENDANT's hit area over its own card counts
    (Angel's review: both were false greens); only an ancestor answering inside a control is skipped

## Measured
- mobile-shots, 9 screens x SE and iPhone 15 x light and dark (36 shots):
  - small taps: before home 7, login-notice 8, nav-menu 9, project-room 13, AI settings 5, others 1 each; after
    0 except the kept ones above
  - covers 0
- Covers audit controls:
  - the room header back at 44 reads a cover (View All <- + New task), as the pixel scan does; a 15-point sample did
    not, hence the dense scan
  - the open menu over Sort agents is not a cover
  - edge-to-edge view toggles are not covers (1px slack)
- render-phone-taps-5218.js, all PASS:
  - light and dark at 390 with touch
  - desktop control: the name keeps its 16px line and no hit area; the terminal box keeps 15px
  - against main: 8 FAILs (names, Sort agents, the 15px terminal box, 34px buttons)
  - a 600px name area: covers FAIL (the scan can fail)
  - names have no control within even a 160x120 area (0 covers in both datasets), so 44 is safe there
- Synthetic page (fitOf lifted): a label row under a neighbour's ::after and a child's ::after over its card now
  read as covers (the previous version missed the nested one and caught the label only via its checkbox); an honest
  label beside a button reads 0. Real screens, 12 incl. the three Settings ones, 48 shots: covers 0.
- render-room-msgbox-2806 passes (the room header kept at 36). Wiring 12/12.

- Round 2 (blind): padded hit areas were a false green (fixed: told apart by layer); the check pinned only part of its
  claim (fixed: it reads every rule from computed style, with stand-ins for the data-only controls; deleting the
  menu-tab, document-row, Try again and Tasks-back rules now reds it by name); the name's area is clipped on a touch
  tablet's one-screen list, carded as #5225 (scope here is the phone).
- Synthetic covers cases: label, nested and padded caught; honest label and an absolute menu not; real screens 48
  shots, 0; the room header at 44 still caught.

- Round 3 (blind): the check's name-area line passed on the unresolved text of an unrendered ::after, and
  includes('44px') matched 144px (fixed: areas read as numbers on the board, where names are laid out; #tsk-back shown
  for the read; a 44x10 name area now reds it by name); two absolute siblings overlapping were exempted as
  stacking (fixed: layers by ancestor; synthetic case 6 caught, the open menu still exempt); :popover-open guarded.

- Round 4 (blind): the check read hit areas' SIZE only, so an area knocked loose (host not positioned: the ::after
  spans the page) passed (fixed: each area is probed for reach AND bounded, nothing hit 40px out, on a laid-out
  element: names and a stand-in close on the board, the back chevron on a real Tasks view; removing position:relative
  now reds 4 lines). Covers false reds fixed: a fixed control is its own layer; a control and its own label skip each
  other; points outside a clipping ancestor are skipped. The check now LIFTS fitOf from mobile-shots instead of a copy,
  so the two cannot drift. Reviewer's cases 7-10 read clean.
- KNOWN, NOT FIXED (named): a padded hit area over a neighbour when each sits in its own absolutely positioned row
  wrapper reads as stacking (case 11). Telling that from a real overlay needs z-order, which hit-testing alone does not
  give; none of the audited screens has the shape (48 shots, 0 covers; the room-at-44 control still caught).

## Weakest premise
- WebKit ran on Mortals in Angel's review (AI settings and names clean); not re-run here after round 2's changes,
  which touch only the tool and the check, not the page's CSS.
