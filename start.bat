@echo off
rem Abre el Modeler y el Backend en dos ventanas. El Backend usa Backend\.venv.
if /i "%~1"=="backend" goto backend

start "Modeler" cmd /k "cd /d "%~dp0Modeler" && npm install && npm run start:example"
start "Backend" cmd /k call "%~f0" backend
exit /b

:backend
cd /d "%~dp0Backend"
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv || exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt || exit /b 1
".venv\Scripts\python.exe" server.py
