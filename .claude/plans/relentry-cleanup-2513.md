# relentry-cleanup-2513 -- document the successful-cut `.release-entry.html` leftover

## Card
kosmos#2513 (follow-up to #1455): a SUCCESSFUL cut leaves `.release-entry.html` behind, holding
the shipped version's id + the stamped timestamp. Nothing removes it. The NEXT cut's step 1
refuses it (correctly, by name, with the reason) until the operator overwrites it - a confusing
extra paragraph on an otherwise-clean start. Nothing incorrect can ship through it.

## Decision: option 3 (document it), NOT option 1 (delete) or option 2 (rename in the cut)
The card names three options and instructs deciding one, not building all three.

- REJECT option 1 (cut removes the file after a successful deploy): a cut deleting an
  operator-written input is exactly the move `release_site_restore` already refuses on principle
  (it never removes what it did not certainly create). Adopting it here contradicts that discipline.
- REJECT option 2 (cut renames it to `.release-entry.<version>.done`): this codes the
  highest-blast-radius file in the tree (release.sh) for a RARE, NON-correctness ergonomic gain.
  The edge only bites if the operator reuses the pending-file shape WITHOUT overwriting it; the
  normal per-release overwrite makes the leftover invisible. Touching the cut path for that trade
  is wrong, and worse during a live cut (Baron's 0.6.49 is firing).
- ADOPT option 3 (document): a note where shape (a) is introduced (docs/releasing.md ~line 127),
  saying the file persists after a successful cut, that the next cut's step 1 refuses it harmlessly
  by name, and to overwrite/delete it when beginning the next cut. This is the card author's own
  weak preference and the correct engineering call: it removes the surprise without risking the cut.

## Scope
- docs/releasing.md ONLY: add a `⚠️` note after the shape-(a) block (after line 127). No code, no
  release.sh change, zero cut blast radius. Distinct from the EXISTING dead-attempt leftover note
  (releasing.md ~245-257), which covers a FAILED attempt leaving the entry on the PAGE
  (versions.html) - a different leftover from this successful-cut SOURCE-FILE one.

## Weakest premise
#2513's own: no cut has run the pending (#1455) shape for real, so the described behavior comes from
reading release.sh, not observing a live cut. The note is therefore correct-by-construction against
the code; if a first real pending-shape cut behaves differently, both #2513 and this note update
together. The note documents rather than removes the edge, so it cannot itself break a cut.

## Verification
Docs-only: the challenge-loop reviews the note for accuracy against release.sh step 1 / step 7a and
that it does not contradict the existing dead-attempt note. No test (no code path changes).
