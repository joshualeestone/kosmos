@echo off
REM Start the Kosmos board.
REM
REM PORT: this file does NOT set it, so server.js:823's own fallback governs.
REM That means one fewer place computing the port.
REM
REM 🛑 BUT BE HONEST: THE BROWSER LINE BELOW HARDCODES 16180, AND THAT IS A
REM SIXTH COPY OF THE LITERAL #910 ALREADY TRACKS (server.js, install/kosmos,
REM install/setup.sh, install/pkg-scripts/postinstall, native-app/main.swift).
REM A launcher that opens a browser has to know the port; there is no way to
REM open a URL without naming it. Recorded here rather than left for a sweep to
REM find, because an untracked copy is what makes #910 expensive.
REM
REM ⚠️ If the port ever changes, this file is one of the six that must change,
REM and it is the one nobody grepping .js or .sh will see.
REM
REM Consequence of not setting PORT, so it is a decision and not an oversight:
REM this launcher reaches the fallback server.js's comment calls "dev-only".
REM A Windows bundle IS a bare `node server.js`, so that is the right path
REM rather than a shortcut around one.
setlocal
cd /d "%~dp0"
start "" /min "%~dp0runtime\node.exe" "%~dp0app\server.js"
REM Give it a moment to bind before pointing a browser at it.
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:16180/"
endlocal
