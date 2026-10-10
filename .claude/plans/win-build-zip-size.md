# Windows build log: the zip's real size, the unpacked total labelled

**Posture:** production

**Branch:** `win-build-zip-size` · **Source:** Homer's 2026-10-10 Kosmos feedback, triaged to the
Windows lane by Splinter.

## The defect

The last line of `tools/build-kosmos-windows.sh` printed `unzip -l "$ZIPOUT" | tail -1` right
under the zip path. That total line is the **unpacked** size, so the 0.7.38 log read
`121050890  319 files` and looked like the download had grown from 45 MB to 121 MB. The zip was
45105090 bytes. Nothing was wrong with the build; the log misled the person reading it.

## The change

Print the zip's own byte count (`wc -c < "$ZIPOUT"`), then the unpacked total and the file
count, each labelled. The unpacked total is read from `$LISTING`, the listing the contents checks
above already validated, rather than a second `unzip -l`:

```
==> zip 45105090 bytes; unpacked 121050890 bytes in 319 files
```

Log output only. No check, refusal or artifact changes.

## Verification

- New test in `tools.build-windows-570.test.js` pins the summary: the zip's own size via
  `wc -c`, the `unpacked` label, and the old bare `unzip -l | tail -1` echo absent. Control: the
  test fails against origin/main's script and passes against this one.

- The new lines run against the real 0.7.38 zip produced the line above.
- `bash -n` on the script.
- Source-reading tests over this script, through the schtasks preload:
  `tools.build-windows-570`, `tools.build-windows-connector-4597`,
  `tools.whats-new-check-3955`, `engine/win32update`: 142 tests, 140 pass, 1 skip, 1 fail. The
  failure (#4928, "the main version did not pass") fails the same way, for the same reason, on
  unchanged origin/main.

## Weakest part

`read -r _unpacked _nfiles _` assumes `unzip -l`'s total line keeps its "bytes count files"
shape. If a different unzip printed it differently the line would be mislabelled, but the build
itself would not be affected. `read` would still exit 0 in that case, so the mislabel would be
quiet; acceptable for a log-only line.
