[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'POPOStableDownloader\NativeHost')
)

$ErrorActionPreference = 'Stop'
$hostNames = @('com.popo.stable_downloader.folder_picker', 'com.popo.dev_downloader.folder_picker')

function Get-AgentTaskNames([string]$ProductRoot) {
  $normalized = [System.IO.Path]::GetFullPath($ProductRoot).TrimEnd('\').ToUpperInvariant()
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalized))
    $suffix = [BitConverter]::ToString($hash, 0, 6).Replace('-', '')
    return @("POPO Stable Downloader Update Agent $suffix", "POPO Dev Downloader Update Agent $suffix")
  } finally {
    $sha256.Dispose()
  }
}

# 先终止所有占用该目录的后台服务与进程，避免 Windows 抛出“文件正在使用”导致无法删除
Get-Process -Name 'PopoAgent', 'popo-agent', 'PopoFolderPickerHost', 'popo-host', 'gopeed', 'host', 'updater' -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }

$productRoot = Split-Path -Parent $InstallRoot
$agentTaskNames = Get-AgentTaskNames $productRoot
$agentRunPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

foreach ($taskName in $agentTaskNames) {
  $taskRunValueName = $taskName.Replace(' ', '_')
  $taskQuery = & schtasks.exe /Query /TN $taskName 2>$null
  if ($LASTEXITCODE -eq 0) {
    & schtasks.exe /Delete /F /TN $taskName 2>$null | Out-Null
  }
  if (Test-Path -LiteralPath $agentRunPath) {
    Remove-ItemProperty -LiteralPath $agentRunPath -Name $taskRunValueName -ErrorAction SilentlyContinue
  }
}

# 模糊清理可能存在的旧计划任务
& schtasks.exe /Delete /F /TN "POPO Stable Downloader Update Agent*" 2>$null | Out-Null
& schtasks.exe /Delete /F /TN "POPO Dev Downloader Update Agent*" 2>$null | Out-Null

foreach ($host in $hostNames) {
  $regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$host"
  if (Test-Path -LiteralPath $regPath) {
    Remove-Item -LiteralPath $regPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (Test-Path -LiteralPath $InstallRoot) {
  Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output 'POPO native folder picker was removed for the current user.'
