@echo off
setlocal
chcp 65001 >nul
title POPO 下载助手 - 安装与更新维护

if exist "%~dp0POPO-Dev-Setup.exe" (
  start "" "%~dp0POPO-Dev-Setup.exe"
  exit /b 0
)
if exist "%~dp0popo-dev-setup.exe" (
  start "" "%~dp0popo-dev-setup.exe"
  exit /b 0
)
if exist "%~dp0POPO-Setup.exe" (
  start "" "%~dp0POPO-Setup.exe"
  exit /b 0
)
if exist "%~dp0popo-setup.exe" (
  start "" "%~dp0popo-setup.exe"
  exit /b 0
)
if exist "%~dp0native-host\install.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0native-host\install.ps1" -ExtensionRoot "%~dp0extension" -BundledGopeedRoot "%~dp0Gopeed"
  pause
  exit /b 0
)

echo 未找到安装程序，请确保文件完整。
pause
