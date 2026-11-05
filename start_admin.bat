@echo off
chcp 65001 > nul
title GPS Tracker Admin Dashboard
echo =========================================================
echo   GPS Tracker Admin Dashboard Launcher
echo =========================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_admin.ps1"

pause
