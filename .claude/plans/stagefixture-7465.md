# kosmos#7465: the install-board path test's fixture is stageable again

Card: https://github.com/joshualeestone/kosmos/issues/7465 (Ice Cream Kitty, night shift).

- tools/test-install-board-paths-2870.sh derives every "$REPO/..." input of stage_app from the copied deploy/install-board.sh (real copies for sourced libraries, stubs otherwise) instead of a hand list that went stale at #6587.
- A positive control: a --refresh-only run into a real board install (temp dir) must stage, swap and finish, so the guard-absent --refresh-only case is load-bearing again.
- Mutants: no derivation turns the control red (the #6587 cause); a neutered validate_dest turns the guard-absent case red.

Weakest premise: the derivation sees only fully quoted "$REPO/<path>" literals; other spellings fail closed (named in the test).
