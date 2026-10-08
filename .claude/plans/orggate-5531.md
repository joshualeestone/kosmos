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
