# dlink-7899: daemon stage, symlink-aware move-aside and loud renames

Addresses #7899 (round 8 WARNINGs of #7887, branch `dfail-7887`, merged as #7900).

## Finished looks like

1. The printed move-aside, with a symlink (dangling or live) at the agent path, moves nothing and names the symlink.
   Before: a dangling one read as "nothing done: not there (already moved aside)"; a live one was moved through.
2. The put-back's rename advice and the move-aside's `.earlier` rename refuse a name that is a symlink (dangling
   links pass `test ! -e`) and print a line when the name is taken, instead of stopping silently.
3. Each new arm in `tools/test-ci-runner-daemon-7001.sh` runs the printed text in its state and went red on main.

## Decided

- **The move-aside refuses any symlink at the agent path, not only a dangling one** (`test ! -L` before `test -f`
  in the success chain). The card names only the failure branch's wording; refusing a live link too matches the
  put-back, which already refuses (`test ! -L $a`), and the stage itself, which prints no command for a dangling
  symlink at the agent path (the `dangling` arm). Rejected: wording-only fix, which would still copy a link's target into the root-owned dir and remove the
  link. Would change my mind: a real install where the agent plist is a symlink by design (none seen; svc.sh writes a
  regular file).
- **The rename's failure line is an unquoted `echo`** inside the printed advice, because the advice already sits in
  a single-quoted `echo` and nesting quotes there is fragile. The text holds only letters, spaces, a colon and a
  comma, so sh, bash and zsh all print it as written. It fires on any failure of the chain (name taken, a symlink at
  the name, or a probe that could not run), so it says "taken or could not be checked".
- The old parenthetical "(if that name is taken too, ...)" is dropped: the command now says that itself.
- NITs on the card (a directory or FIFO at the agent, an unreadable agent leaving an empty retired copy) are not
  built: unlikely states whose advice is already safe.

## Weakest part

The new arms run the printed text with `sudo` stripped (as the existing #7887 arms do), so they pin the `&&`/`||`
flow and the wording, not which user runs each probe. The `test ! -L` probes copy the user of their neighbours
(CI user on the agent and on the put-back name, root on the `.earlier` name), checked by reading, not by a test.

## Not done

- No live run on a CI Mac.
