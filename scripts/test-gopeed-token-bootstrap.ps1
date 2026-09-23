[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$GopeedDirectory)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$source = (Resolve-Path -LiteralPath $GopeedDirectory).Path
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('POPO-Gopeed-Token-' + [Guid]::NewGuid().ToString('N'))
$gopeedRoot = Join-Path $tempRoot 'Gopeed'
$executable = Join-Path $gopeedRoot 'gopeed.exe'
$bridgePath = Join-Path $gopeedRoot 'storage\.popo-api-token.bridge'
$process = $null

function Get-GopeedPort([int]$ProcessId) {
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    $listener = Get-NetTCPConnection -State Listen -OwningProcess $ProcessId -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -gt 0 } |
      Select-Object -First 1
    if ($listener) { return [int]$listener.LocalPort }
    Start-Sleep -Milliseconds 500
  }
  throw 'Patched Gopeed did not open a loopback API listener within 60 seconds.'
}

function Assert-GopeedAuth([int]$Port, [string]$Token) {
  $unauthorized = $false
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/config" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ne 401) { throw 'Gopeed accepted an unauthenticated API request.' }
  } catch [System.Net.WebException] {
    $status = [int]$_.Exception.Response.StatusCode
    if ($status -ne 401) { throw "Expected HTTP 401 without a token; received $status." }
    $unauthorized = $true
  }
  if (-not $unauthorized) { throw 'Gopeed did not reject a request without an API token.' }

  $authenticated = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/config" `
    -Headers @{ 'X-Api-Token' = $Token } -UseBasicParsing -TimeoutSec 5
  if ($authenticated.StatusCode -ne 200) { throw 'The generated Gopeed API token was rejected.' }
  $body = $authenticated.Content | ConvertFrom-Json
  if ([int]$body.code -ne 0 -or -not $body.data) { throw 'Authenticated Gopeed API returned an invalid response.' }
}

function Stop-Gopeed([System.Diagnostics.Process]$Running) {
  if (-not $Running -or $Running.HasExited) { return }
  try { if ($Running.CloseMainWindow()) { [void]$Running.WaitForExit(5000) } } catch {}
  if (-not $Running.HasExited) {
    try { $Running.Kill(); $Running.WaitForExit(5000) } catch {}
  }
}

try {
  New-Item -ItemType Directory -Path $gopeedRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $gopeedRoot -Recurse -Force
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $executable
  $start.Arguments = '--hidden'
  $start.WorkingDirectory = $gopeedRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $start.EnvironmentVariables['PATH'] = "$env:SystemRoot\System32;$gopeedRoot"

  $process = [System.Diagnostics.Process]::Start($start)
  if (-not $process) { throw 'Patched Gopeed did not start.' }
  $port = Get-GopeedPort $process.Id
  for ($attempt = 0; $attempt -lt 60 -and -not (Test-Path -LiteralPath $bridgePath); $attempt++) {
    Start-Sleep -Milliseconds 500
  }
  if (-not (Test-Path -LiteralPath $bridgePath)) { throw 'Gopeed did not publish its local pairing bridge.' }
  $token = [System.IO.File]::ReadAllText($bridgePath).Trim()
  if ($token.Length -lt 40 -or $token -match '[^A-Za-z0-9_-]') { throw 'Gopeed generated an invalid API token format.' }
  Assert-GopeedAuth $port $token

  $entropy = [System.Text.Encoding]::UTF8.GetBytes('POPO-Gopeed-API-Token-v1')
  $clear = [System.Text.Encoding]::UTF8.GetBytes($token)
  $protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $clear, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $roundtrip = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $protected, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  if ([System.Text.Encoding]::UTF8.GetString($roundtrip) -cne $token) { throw 'DPAPI token protection round-trip failed.' }
  [Array]::Clear($clear, 0, $clear.Length)
  [Array]::Clear($roundtrip, 0, $roundtrip.Length)
  Remove-Item -LiteralPath $bridgePath -Force
  Stop-Gopeed $process
  $process.Dispose()
  $process = $null

  $process = [System.Diagnostics.Process]::Start($start)
  if (-not $process) { throw 'Patched Gopeed did not restart.' }
  $port = Get-GopeedPort $process.Id
  for ($attempt = 0; $attempt -lt 60 -and -not (Test-Path -LiteralPath $bridgePath); $attempt++) {
    Start-Sleep -Milliseconds 500
  }
  if (-not (Test-Path -LiteralPath $bridgePath)) { throw 'Gopeed did not republish the saved pairing bridge after restart.' }
  $restartedToken = [System.IO.File]::ReadAllText($bridgePath).Trim()
  if ($restartedToken -cne $token) { throw 'Gopeed API token changed across a restart.' }
  Assert-GopeedAuth $port $restartedToken
  Write-Output 'GOPEED_TOKEN_BOOTSTRAP=PASS'
} finally {
  Stop-Gopeed $process
  if ($process) { $process.Dispose() }
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
  if ($token) { $token = $null }
}
