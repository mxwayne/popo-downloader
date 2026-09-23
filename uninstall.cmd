@echo off
chcp 65001 >nul
title POPO 下载助手卸载与清理

echo ========================================================
echo         POPO 下载助手 - 正在执行完全卸载与清理
echo ========================================================
echo.

echo [1/3] 正在终止所有后台常驻服务...
taskkill /F /IM PopoAgent.exe /T >nul 2>&1
taskkill /F /IM popo-agent.exe /T >nul 2>&1
taskkill /F /IM PopoFolderPickerHost.exe /T >nul 2>&1
taskkill /F /IM popo-host.exe /T >nul 2>&1
taskkill /F /IM gopeed.exe /T >nul 2>&1

echo [2/3] 正在清理计划任务与开机自启...
schtasks /Delete /F /TN "POPO Dev Downloader Update Agent*" >nul 2>&1
schtasks /Delete /F /TN "POPO Stable Downloader Update Agent*" >nul 2>&1
schtasks /Delete /F /TN "POPO*" >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "POPO*" /f >nul 2>&1
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.popo.dev_downloader.folder_picker" /f >nul 2>&1
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.popo.stable_downloader.folder_picker" /f >nul 2>&1
reg delete "HKCU\Software\POPODevDownloader" /f >nul 2>&1
reg delete "HKCU\Software\POPOStableDownloader" /f >nul 2>&1

echo [3/3] 正在解除文件占用...
ping 127.0.0.1 -n 2 >nul 2>&1

echo.
echo ========================================================
echo   卸载清理完成！
echo   所有后台进程已结束，注册表与计划任务已全部注销。
echo   现在您可以直接删除该文件夹（不会再提示“程序在运行”）。
echo ========================================================
echo.
pause
