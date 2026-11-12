# absroot-8423: the install marker and status file only under an absolute root

Card: kosmos#8423 (filed by Renet Tilley while fixing #8421; given to Mona Lisa, m3952). Built on updatelog-8421 (b8af9f3dbe); rebased onto main when #8421 merges.

## Finished looks like
engine/update.js writes logs/install.started (#1728) and logs/install.status only under an installed root that is absolute here, so a root in another platform's form (C:\Users\... on a Mac) never puts them in the working directory. A test that fails before the fix proves it.

## Shape (decided)
- absoluteRoot(): installedRoot() when path.isAbsolute, else null. installStatusFile() and installStartedFile() use it, the same guard #8421's autoRecordFile uses.
- Every caller already treats null as no file: markInstallStarted returns, readStartedRecord returns null, and the spawn passes /dev/null with its existing guard. Renet's noteAutoUpdateAtBoot reads the marker in a try (m3952).
- Rejected: fixing it in installedRoot() itself. installedRoot also feeds the install command and the paths the person sees, where a Windows root on Windows is right. Only the file writes need the guard.
- Weakest premise: on a real Windows board the root is a win32 absolute path (C:\...), which path.isAbsolute accepts there. A UNC root (\\server\share) is also absolute on win32.

## Tests
engine/update-absroot-8423.test.js:
- From a throwaway working directory, a person's install (beginInstall({})) under C:\Users\someone\Kosmos writes nothing there. Control: the install launched. Red on updatelog-8421 ("a file was written relative to the working directory").
- Control: under an absolute root the marker is still written.
All 16 update*.test.js files and engine.reachable pass (155 pass, 0 fail, 5 skipped).
