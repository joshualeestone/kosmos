@echo off
REM Double-clickable wrapper. The real work is in install-kosmos.ps1.
REM
REM -ExecutionPolicy Bypass is scoped to THIS process only. It does not change
REM the machine's policy, which is why it is preferred over asking the person
REM to run Set-ExecutionPolicy, an instruction that outlives the install and
REM weakens the machine permanently.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-kosmos.ps1"
if errorlevel 1 (
  echo.
  echo Install did not complete. The message above says why.
  pause
  exit /b 1
)
pause
