# barelinks-7239: bare web addresses in messages are links (kosmos#7239)

## Finished looks like
In a DM and a project room, example.com, example.com/path and https://example.com are links that open in the browser
(a new window, which the Mac and Windows apps send to the system browser); notes.md, 0.7.70 and store.ROOT stay plain.

## Built
- pjBareWeb(tok): host labels ending in a known web ending (a list, not every TLD: endings that are also file
  extensions or code properties are left out: md, sh, py, app, json, info, store, page, link...), an optional port,
  path, query or fragment; the ending must be lowercase. Returns the https:// address or ''.
- pjInline (plain rows) and pjRich's token pass (DMs, the project list, the room through pjBody) link a bare address
  as they link https://, with leading "(" or emphasis and trailing punctuation kept outside. pjRich's fast path takes
  the slow path when a word is a bare address. Calls are guarded: tests lift these renderers alone.
- Code is held before linking, so nothing in a code span or block is linked; an email is not a host.

## Decided
- Opened as https:// (Josh's example is https-only), target=_blank like the #355 links. The Mac app's
  createWebViewWith sends an http(s) new window to NSWorkspace.open, the Windows app opens it in the browser: no
  native change.
- iPhone app: not changed. Its bubbles already link bare addresses through NSDataDetector, keeping web links only
  (measured: meridianworks.kosmosplus.com and example.com/path link; notes.md, 0.7.70, store.ROOT, Kosmos.app do not).
  Two small differences remain: it opens http:// (the site redirects), and it links logger.info. Weakest premise:
  that these are not worth an iPhone change on this card. Would change my mind: Josh seeing either in the app.
- A list of endings, not the full public suffix list: a full list links notes.md (Moldova) and setup.sh.

## Evidence
- web.links-everywhere: bare addresses in pjInline and pjRich, look-alikes plain, code plain, https:// control.
- render-barelinks-7239 (new, gated): a painted DM thread and a room bubble body (pjRoomBody); anchors https:// and
  target=_blank, look-alikes plain, a click opens a new window asking for the https:// address. 7 red on main.

## Review
- Round 1 (.claude/plans/barelinks-7239-review1.md): 1 blocker, 3 warnings, 5 nits. All taken:
  - BLOCKER: the bare arm ran before the cited-file chip, so a project file named like a host lost its Show me. Now
    after it. Unit and browser cases with brand.io in the room's doc names: red with the old order.
  - "in" is off the list (requirements.in). Ambiguous endings (ai, dev, me, at, it, no, co) on a one-dot name link
    only with www., a subdomain, a path or a port: claude.ai/settings and docs.example.dev link; bare claude.ai,
    logo.ai, settings.dev, self.me do not. The trade (bare claude.ai stays plain) is recorded on the card.
  - A code block's path label (pjLinkPaths) is never a website: pjInline(text, { bare: false }).
  - [site](example.com) links to https://example.com.
  - Nits: a 2048-character cap (a 50,000-dot token now costs 0 ms); quotes, angle brackets, emphasis and 's stay
    outside the link (pjBareSplit, for raw and escaped text alike); a ")" the address opened stays in it; README row
    corrected; the check's room half has a cited file and an @mention in play.
- Round 2 (.claude/plans/barelinks-7239-review2.md): 0 blockers, 1 warning, 4 nits. All taken:
  - A cited project file dressed in bold, quotes, parens or 's is checked against the doc names too, and keeps (or
    now gains) its Show me; never a website link. Unit cases for four dressings; the room check has **brand.io**.
  - pjBareSplit takes raw text only; pjRich decodes the word, splits it, and escapes each piece, so an entity is never
    cut (no stray ; after & or <). Its tail is a backwards scan and the parens are counted once: 50 tokens of 2040
    dots cost 0 ms (were 399 ms), 1 ms with an address (were 773 ms). Token cap 512.
  - pjInline's bare arm is gone (its only caller is a code block's path label): pjInline and pjLinkPaths are main's.
  - [example.com](https://example.com): the label that is itself the address is held plain, so one link, not two.
  - Left as judgement calls (recorded in review2): hello.world, this.io, a three-part settings module, curly quotes.
- Round 3 (.claude/plans/barelinks-7239-review3.md): 0 blockers, 0 warnings, 2 nits; converged. A dressed cited file
  chips only as a bare name (no path, no ".."), so an address with a path stays a link; a markdown label with any
  address in it is held plain, so no label is ever a second link. Fuzzed by the reviewer: 355,000 messages render the
  same visible text as main, 400,000 renders with no malformed markup.
