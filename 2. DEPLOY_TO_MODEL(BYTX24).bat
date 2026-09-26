@echo off
setlocal
set "ROOT=%~dp0"
set "MODAL_PROFILE=bytx24"
set "MODAL_WORKSPACE=bytx24"

cd /d "%~dp0"
if errorlevel 1 exit /b 1
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher not found. Install Python 3.11 or newer, then try again.
  pause
  exit /b 1
)
py "%~dp0scripts\publish-github-modal.py" %*
set "PUBLISH_RESULT=%ERRORLEVEL%"
if not "%PUBLISH_RESULT%"=="0" echo Publishing stopped. See the error above.
if /I "%~1"=="--check" exit /b %PUBLISH_RESULT%
echo.
pause
exit /b %PUBLISH_RESULT%
