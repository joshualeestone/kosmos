---
pre_challenge: true
method: challenge-loop
branch: introonce-5023
diff_hash: 085e27c4b69be75acc118d332158bef6cca06a5d56a8ead59cbefb4fe3b17454
subdir_audit: passed
timestamp: 2026-10-02T13:44:53Z
converged: true
---

## Challenge loop: 5 blind rounds, Opus and Sonnet alternating; round 5 found only NITs

Ledger in `.claude/plans/introonce-5023.md`.

## [WARNING] Round 1 (opus)
FIXED W1: a static "your first post" rule cannot be followed by an agent with no memory (it may 
re-introduce itself after every restart); Kosmos now decides per agent from its own post store (hasPostBy) and the 
line drops at the next tell after the first post. FIXED W2: "the kind of work you do" invited exactly what the 
privacy rules forbid; now "in general terms (a coding agent, a research agent) ... Never say what your work is for or 
who it is for". FIXED CONVENTION: the file header names the line. NITs taken: the comment no longer overclaims; the 
test pins the limit directly under the line.

## [WARNING] Round 2 (sonnet)
FIXED W1: the birth path wrote the block with no introduction, so a new agent waited for its 
first restart; create.js now asks shouldIntroduce with the agent's store key (test: a new agent gets the line; one 
whose key already has a post does not; dropping the call reddens it). FIXED W2: a corrupt posts.json read as "no 
posts" through loadJson (and was quarantined as a side effect); postedBy now reads directly and answers null for an 
unreadable or wrong-shape file, which leaves the line out (test, with a missing-file control; reading via loadJson 
reddens it). NITs: a discarded held post stops counting (documented); the per-tell read is at birth and restart only; 
within the session of the first post the line still shows (in the weakest premise).

## [WARNING] Round 3 (opus)
FIXED W: once any other reader quarantined a corrupt posts.json, the file was missing and postedBy 
said "no posts", so every agent would be asked again; a missing file with a posts.json.corrupt-* sidecar is now null 
(test; removing the check reddens it). NITs taken: a person's own post (author.type user) never counts for an agent 
(test; removing the skip reddens it); create.js's comment names the unknown case; the long comment line wrapped; the 
rename and re-make cases are written under Decided.

## [WARNING] Round 4 (sonnet)
FIXED W1: the ~300-byte line could push an agent over the instructions size limit and cost it the 
whole block (restart: COULD_NOT; birth: no block); both paths now fall back to the block without it (tests at 
restart and at birth, each padded to fit without the line but not with it; removing either fallback reddens its 
test). FIXED W2: the sidecar guard held only while posts.json was missing; now any sidecar makes a "no" unknown 
(test: a fresh posts.json beside a sidecar; removing the check reddens it). NITs: own name is fine (Decided); the 
null path for permission errors is the same branch as a parse error (tested by that); EOF blank line.

## [WARNING] Round 5 (opus)
NITs only. CONVERGED. Taken: the corruption test's finally removes its sidecar (a failure there 
would otherwise cascade into later tests); an em dash test over the block WITH the introduction. Left: a one-phrase 
kind of agent sits near PASTE_RULE (general terms and "never what it is for or who it is for" keep it a description, 
not a retelling of instructions).

## Checks on the head
engine/communityblock.test.js 14/14, engine/create.test.js 216/216, engine/remove.test.js and every test file reading
communitystore green. Each guard pinned by a mutation that reddens its own test (introduction always/never/published-
only; loadJson read; birth call; sidecar; person posts; size fallback at restart and at birth). CI runs the full suite.
