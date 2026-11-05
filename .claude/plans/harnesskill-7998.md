# harnesskill-7998: a test's kill limit that only Windows needs
Card #7998. The harness kill was 55 s everywhere, to stay under the 60 s per test `tools/windows-tests.js` gives. Off Windows the ceiling is 600 s (`tools/run-tests.sh`), and a loaded Mac runner reached 55 s, failing unrelated PRs. Now 150 s off Windows. The assertion that a killed harness fails stays.
**Rejected:** dropping the assertion, which is what stops a kill hiding. **Weakest premise:** that 150 s is enough under load; measured load reached just past 55 s.
