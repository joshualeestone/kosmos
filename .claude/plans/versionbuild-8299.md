# versionbuild-8299: kosmos --version names the build (kosmos#8299, item 7 of #8298)

## Change
`kosmos version`, `--version` and `-v` print `0.8.00 (build e224150682)`, from the app line of the VERSION file the Mac and
Linux bundles carry. Linux records a full commit and Mac git's short form, so a longer hex build is cut to 10 and seats can compare. A dirty build reads
`<commit>-dirty`, from either spelling the two bundles use. Reading the file is best effort: the version prints even if it cannot be read. No VERSION file, or a
build recorded as unknown, prints the version alone, as before.

## Rejected
A second line for the build: `kosmos version` was one line, and the card asks for it on that line.

## Not done
Windows has no `version` verb (tools.windows-kosmos-cli-verbs-parity.test.js records that: the zip carries it in
manifest.json), so nothing changes there.

## Weakest premise
That nothing parses this line as a bare version. A sweep of the repo finds only the tests that pin it.
