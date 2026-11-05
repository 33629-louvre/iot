@echo off
chcp 65001 > nul
title GPS Tracker Central Admin Launcher
echo =========================================================
echo   GPS Tracker Admin Dashboard Launcher
echo =========================================================

cd /d "%~dp0backend_server"

set PYTHON_EXE=
if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" (
    set PYTHON_EXE="%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
) else (
    set PYTHON_EXE=python
)

echo [1/2] กำลังเปิดเซิร์ฟเวอร์หลังบ้าน (Port 3000)...
start "GPS Tracker Server (Port 3000)" cmd /k %PYTHON_EXE% server.py

ping 127.0.0.1 -n 3 > nul

echo [2/2] กำลังเปิดหน้าเว็บ Admin Dashboard ในเบราว์เซอร์...
start http://127.0.0.1:3000/admin

echo.
echo =========================================================
echo   ระบบหลังบ้านทำงานเรียบร้อยแล้วที่: http://127.0.0.1:3000/admin
echo   (สามารถย่อหน้าต่างเซิร์ฟเวอร์สีดำนี้ไว้ได้ แต่อย่าเพิ่งปิด)
echo =========================================================
pause
