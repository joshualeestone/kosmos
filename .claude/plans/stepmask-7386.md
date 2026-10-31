# #7386: a secret split by an invisible character is masked in the Windows step text

**Branch:** `stepmask-7386` · **Card:** kosmos#7386 (from the blind review of #7368's follow-up).

## The defect

`engine/win32streamstate.js` `stepOfUse` builds the step an agent's card and the board log show (the shell command, or the tool and what it acts on), masked by `secretmask`. A secret with an invisible character inside it (a C1 control, a bidi mark, and more) broke the mask's patterns, so it showed. Measured on main: a bidi mark inside a `sk_live_` key showed the key whole; C1 controls where "password is X" needs spaces showed X.

## The change

`stepCopies(v, bound)` reads each value in one pass (a sticky regex per run kind) and builds three copies, each stopped at the cut (STEP_MAX * 3 code points):
1. shown: whitespace, C0/DEL and U+FEFF to one space, other hidden characters kept (main's display);
2. removed: hidden characters, C0 and U+FEFF dropped, whitespace (line breaks included) a space;
3. spaced: all of them a space.

Hidden = Cc, Cf, Mn, Co, Default_Ignorable_Code_Point, U+2800, and a whitespace run holding a line break or tab. The step shows `mask(shown)`; if the value is hidden and either copy masks anything, the whole value is the mask. A shell step masks only its command, so the shared mask cache gets no more entries than on main.

Accepted: a multi-line or tabbed command holding a secret shows the mask whole.

## Tests

`engine/win32streamstate.stepmask-7386.test.js`, 16 tests through the publisher's own write: every reviewed character family and split point, Unicode spaces, padding, megabyte commands, line breaks, and controls (no secret: shown as on main). Each fix test fails on the version before it. `deliverystreak.turn-7368.test.js` 17/17. Focused run (43 files): 1928 pass, 0 fail.

## Filed separately

#7395: secretmask does not mask an AKIA key right after an underscore (main too).
