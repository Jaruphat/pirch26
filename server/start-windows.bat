@echo off
REM PIRCH26 LAN server for Windows (needs Node.js 22.13+ from https://nodejs.org)
set PORT=8080
set NODE_NO_WARNINGS=1
echo Starting PIRCH26 LAN server on port %PORT% ...
echo Open http://%COMPUTERNAME%:%PORT% from other computers in the office.
node "%~dp0server.js"
pause
