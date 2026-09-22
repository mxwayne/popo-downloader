@echo off
setlocal
chcp 65001 >nul
title POPO 下载助手 - 一键卸载与清理

echo ========================================================
echo         POPO 下载助手 - 正在执行完全卸载与清理
echo ========================================================
echo.

echo [1/4] 正在停止后台常驻服务与进程...
taskkill /F /IM PopoAgent.exe /T >nul 2>&1
taskkill /F /IM popo-agent.exe /T >nul 2>&1
taskkill /F /IM PopoFolderPickerHost.exe /T >nul 2>&1
taskkill /F /IM popo-host.exe /T >nul 2>&1
taskkill /F /IM gopeed.exe /T >nul 2>&1
taskkill /F /IM host.exe /T >nul 2>&1
taskkill /F /IM updater.exe /T >nul 2>&1

echo [2/4] 正在清理开机自启计划任务...
schtasks.exe /Delete /F /TN "POPO Stable Downloader Update Agent*" >nul 2>&1
schtasks.exe /Delete /F /TN "POPO Dev Downloader Update Agent*" >nul 2>&1

echo [3/4] 正在注销 Chrome 本机消息服务与注册表项...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Name 'PopoAgent', 'popo-agent', 'PopoFolderPickerHost', 'popo-host', 'gopeed' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Remove-Item 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.popo.*' -Recurse -Force -ErrorAction SilentlyContinue; Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name '*POPO*' -ErrorAction SilentlyContinue; Remove-Item 'HKCU:\Software\POPOStableDownloader' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item 'HKCU:\Software\POPODevDownloader' -Recurse -Force -ErrorAction SilentlyContinue;" >nul 2>&1

if exist "%~dp0native-host\uninstall.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0native-host\uninstall.ps1" >nul 2>&1
)

echo [4/4] 文件解除占用完成！
echo.
echo ========================================================
echo   卸载与清理成功！
echo   所有后台进程已结束，注册表与计划任务已全部注销。
echo   现在您可以直接删除本文件夹（不会再提示“程序在运行”）。
echo ========================================================
echo.
pause
