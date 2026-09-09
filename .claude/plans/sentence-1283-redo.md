# sentence-1283-redo: inline sentence-dressers delegate to asSentence(), killing the doubled full stop

## Goal (kosmos#1283)
`web/index.html` dressed an engine "because" sentence for a person in eight inline places, with no shared definition, and they did not agree. Three appended a full stop UNCONDITIONALLY, so any engine string already ending in a stop rendered a doubled `..` (measured: 5 of 363 `because` strings already end in a stop). A shared `asSentence()` helper already exists in main (web/index.html:12410: trims, handles empty, capitalizes, guards the stop).

## Change
Seven of the eight sites now delegate to `asSentence()`:
- Three doubled-stop BUGS (unconditional append): `memWhy` (`+ '. '` -> `asSentence(why) + ' '`), the tunnel `st.textContent` (`+ '.'` -> `asSentence(because)`), `placedWords` (`+ '.'` -> `asSentence(note)`).
- Four already-correct guard-the-stop sites, consolidated: the connections detail dresser, the `why.textContent` status line, the reports `sentence`, and `pjSentence`.

Left untouched per Ice Cream Kitty's measured finding: the role/TITLE capitalizer (the titles resolver, `return parsed.charAt(0).toUpperCase() + parsed.slice(1);`) is NOT a sentence and correctly gets no stop.

## Constraints
- Behaviour-preserving except the removed doubled stop. asSentence trims + handles empty, matching each site's prior guard (verified per-site).
- No visual change beyond the removed `..`.
- web/index.html is a shared 1.2MB file; scope is exactly these seven one-line call sites. Collision cleared with Angel (her first-run-screen-fixes merged as #2541, touched none of these regions).

## Done when
The three unconditional-append sites no longer double a stop, seven sites call asSentence, the title capitalizer is unchanged, and no other behaviour shifts. Diff: 7 insertions, 8 deletions, web/index.html only.
