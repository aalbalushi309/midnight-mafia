@echo off
rem Starts the game and creates a public link your friends can open from anywhere.
title Midnight Mafia
cd /d "%~dp0.."
echo Starting Midnight Mafia...
start "Midnight Mafia server" cmd /k "node server"
timeout /t 2 /nobreak >nul
echo.
echo Creating your public invite link (look for the https://....trycloudflare.com line below).
echo Send that link to your friends. Keep this window open while you play.
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:3000
pause
