# orggate-5531: the "Your company" box only for people it concerns (0.7.29 ship fix)

**Ask:** Splinter and Josh, 10-08 17:44. 0.7.29 (on staging) showed the #5531 "Your company" box to every Kosmos+-connected computer, because it was gated on the Kosmos+ connection (`r.enrolled`) rather than on a company. Personal users would see an Enterprise box they cannot use.

**Change (`web/index.html`, the page only):**
- A computer with no company sees one quiet line: a "Joining a company? Enter its join code" link (`#plus-org-open`, the section's existing link style).
- The full block (the heading, the code field, the joined view) shows only when one of these holds:
  - this Kosmos is a company's work Kosmos;
  - a code check or a review is open;
  - the person opened it;
  - a company note is waiting (stopped, or a refused leave) or a message is on screen.

**Decided, and rejected:**
- Rejected: hiding the box entirely for non-members. Someone invited by email would then have nowhere to type the code, because there is no invite deep link yet. One line is the smallest honest entry.
- Rejected: asking the company whether the account is a member on every paint. That is a signed coordinator round for every Kosmos+ user every minute, to show a box.
- Weakest premise: that one link line counts as "never see an Enterprise box". If Josh wants none at all, it is one line to hide the opener too.

**Tests:**
- `render-orgenroll-5531.js`:
  - O0 checks that only the opener shows, with no heading, code field, consent or joined line.
  - O1 checks that opening it shows the heading and code field.
  - Every later check still passes.
- Making `full` always true makes O0 fail.

## Review 1 (blind, Opus)
- FIXED: the heading and code field started VISIBLE in the markup and only the paint hid them, so a failed /api/org read
  (or the moment before the first read) showed a personal user the full box. They start hidden now; the paint reveals
  them. O17a (fresh page, the read fails) asserts only the opener; removing the markup's `hidden` makes it fail.
- FIXED: O0 waited for the opener, which is visible at once; it now waits for the page's real /api/org read.
- FIXED: an already joined Kosmos was untested on a fresh page. O17b asserts it loads straight into the heading and the
  joined view, with no opener; removing `!!here` makes it fail.
- FIXED: the design-shots script clicks the opener before filling the code.
- NITs taken: the page repaints after setting a company note, so the block matches it at once; the id is
  `plus-org-title` (not `plus-org-h`, a class already used in the consent).
- NIT kept: once opened, the block stays open for the page's life.

## Review 2 (blind, Sonnet)
- TAKEN as a documented rule rather than a mechanism (the reviewer: "a risk for later changes, not a bug today"): a line in
  #plus-org-msg opens the block, and the comment at `msgOn` says every writer relies on that and when a new one may.
- NIT taken: `open: false` declared in PLUS_ORG.
- NITs kept: the first paint in plusOrgMaybe before the message is set (same microtask, no render between); the
  mutation results are in this plan, not re-shown by the check.

## Review 3 (blind, Opus)
- FIXED: no fresh-page arm covered "a company note opens the block" (O8 and O12 ran after O1 had opened it). O17c: a
  fresh page whose Kosmos the company stopped naming shows the heading, the code field and the note, with no opener.
  Removing the note terms from `full` makes it fail.
- NITs taken: the fresh pages report page errors into O6 (now asserted after them); the README row names O17; the first
  repaint in plusOrgMaybe is gone (the one after the message covers it).
- NIT kept: a joined Kosmos whose first read fails shows the opener until the next minute's read (before this branch it
  showed the whole code field then).
