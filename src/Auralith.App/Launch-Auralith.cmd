@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '.' -Recurse -File | Unblock-File"
start "" "%~dp0Auralith.exe"
