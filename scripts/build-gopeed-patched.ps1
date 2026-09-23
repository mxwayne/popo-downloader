[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$GoExecutable = 'go',
  [string]$FlutterExecutable = 'flutter'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
$vendor = Join-Path $repo 'vendor\gopeed\v1.9.3'
$sourceZip = Join-Path $vendor 'Gopeed-v1.9.3-source.zip'
$patchPath = Join-Path $vendor 'popo-api-token-bootstrap.patch'
$buildRoot = if ($env:POPO_GOPEED_BUILD_ROOT) {
  [System.IO.Path]::GetFullPath($env:POPO_GOPEED_BUILD_ROOT)
} else {
  'D:\POPO\Tooling\Build'
}
$work = Join-Path $buildRoot ('gopeed-' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path $work 'source'
$portable = [System.IO.Path]::GetFullPath($OutputDirectory)
$flutterRoot = Join-Path $source 'ui\flutter'
$release = Join-Path $flutterRoot 'build\windows\x64\runner\Release'

foreach ($tool in @($sourceZip, $patchPath)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Gopeed build input is missing: $tool" }
}
if (-not (Get-Command $GoExecutable -ErrorAction SilentlyContinue)) {
  throw "Go toolchain is required to build the pinned Gopeed source: $GoExecutable"
}
if (-not (Get-Command $FlutterExecutable -ErrorAction SilentlyContinue)) {
  throw "Flutter 3.41.2 is required to build the pinned Gopeed source: $FlutterExecutable"
}

New-Item -ItemType Directory -Path $source -Force | Out-Null
Expand-Archive -LiteralPath $sourceZip -DestinationPath $source
$controller = Join-Path $flutterRoot 'lib\app\modules\app\controllers\app_controller.dart'
$controllerText = [System.IO.File]::ReadAllText($controller)
[System.IO.File]::WriteAllText($controller, $controllerText, (New-Object System.Text.UTF8Encoding($false)))
& git -C $source apply --check --ignore-space-change $patchPath
if ($LASTEXITCODE -ne 0) { throw 'The POPO Gopeed bootstrap patch does not match the pinned Gopeed v1.9.3 source.' }
& git -C $source apply --ignore-space-change $patchPath
if ($LASTEXITCODE -ne 0) { throw 'The POPO Gopeed bootstrap patch could not be applied.' }

$gitCommand = Get-Command git -ErrorAction Stop
$gitRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $gitCommand.Source))
$mingw = Join-Path $gitRoot 'mingw64\bin'
if (Test-Path -LiteralPath $mingw) { $env:PATH = "$mingw;$env:PATH" }
$llvmMingw = if ($env:POPO_LLVM_MINGW_ROOT) {
  [System.IO.Path]::GetFullPath($env:POPO_LLVM_MINGW_ROOT)
} else {
  'D:\POPO\Tooling\llvm-mingw'
}
if (-not (Get-Command gcc -ErrorAction SilentlyContinue) -and
    (Test-Path -LiteralPath (Join-Path $llvmMingw 'bin\clang.exe')) -and
    (Test-Path -LiteralPath (Join-Path $llvmMingw 'bin\clang++.exe'))) {
  $env:CC = Join-Path $llvmMingw 'bin\clang.exe'
  $env:CXX = Join-Path $llvmMingw 'bin\clang++.exe'
  $env:PATH = (Join-Path $llvmMingw 'bin') + ';' + $env:PATH
}
$env:CGO_ENABLED = '1'
$env:GOARCH = 'amd64'
$env:GOOS = 'windows'
$goVersion = (& $GoExecutable version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $goVersion -notmatch 'go1\.24\.') {
  throw "Go 1.24.x is required by the pinned source; found: $goVersion"
}

Push-Location $source
try {
  & $GoExecutable build -tags nosqlite -ldflags='-w -s -X github.com/GopeedLab/gopeed/pkg/base.Version=1.9.3' -buildmode=c-shared -o (Join-Path $flutterRoot 'windows\libgopeed.dll') github.com/GopeedLab/gopeed/bind/desktop
  if ($LASTEXITCODE -ne 0) { throw 'Building Gopeed desktop engine failed.' }
  & $GoExecutable build -ldflags='-w -s' -o (Join-Path $flutterRoot 'assets\exec\host.exe') .\cmd\host
  if ($LASTEXITCODE -ne 0) { throw 'Building Gopeed host helper failed.' }
  & $GoExecutable build -ldflags='-w -s' -o (Join-Path $flutterRoot 'assets\exec\updater.exe') .\cmd\updater
  if ($LASTEXITCODE -ne 0) { throw 'Building Gopeed updater helper failed.' }
} finally {
  Pop-Location
}

Push-Location $flutterRoot
$previousCl = $env:CL
try {
  & $FlutterExecutable pub get
  if ($LASTEXITCODE -ne 0) { throw 'Resolving Gopeed Flutter dependencies failed.' }
  # New Windows hosted images ship an MSVC STL that promotes the legacy
  # coroutine header deprecation to an error. This pinned Gopeed dependency
  # still includes plugins using that header; MSVC documents this macro as
  # the compatibility opt-out while those dependencies migrate.
  $env:CL = (@($previousCl, '/D_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS') |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' '
  & $FlutterExecutable build windows '--dart-define=UPDATE_CHANNEL=windowsPortable'
  if ($LASTEXITCODE -ne 0) { throw 'Building the POPO-patched Gopeed desktop application failed.' }
} finally {
  $env:CL = $previousCl
  Pop-Location
}

foreach ($required in @(
  (Join-Path $release 'gopeed.exe'),
  (Join-Path $release 'data\app.so'),
  (Join-Path $release 'libgopeed.dll')
)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Patched Gopeed build output is missing: $required"
  }
}

if (Test-Path -LiteralPath $portable) { Remove-Item -LiteralPath $portable -Recurse -Force }
New-Item -ItemType Directory -Path $portable -Force | Out-Null
Get-ChildItem -LiteralPath $release -Force | Copy-Item -Destination $portable -Recurse -Force
$originalPortable = Join-Path $vendor 'portable'
foreach ($dependency in @(
  'libstdc++-6.dll', 'libgcc_s_seh-1.dll', 'libwinpthread-1.dll',
  'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'
)) {
  $builtFile = Join-Path $portable $dependency
  if (-not (Test-Path -LiteralPath $builtFile)) {
    Copy-Item -LiteralPath (Join-Path $originalPortable $dependency) -Destination $portable
  }
}
foreach ($dependency in @('libc++.dll', 'libunwind.dll')) {
  $builtFile = Join-Path $portable $dependency
  if (-not (Test-Path -LiteralPath $builtFile)) {
    $runtimeFile = Join-Path $llvmMingw "bin\$dependency"
    if (-not (Test-Path -LiteralPath $runtimeFile)) {
      throw "The LLVM-MinGW runtime required by the patched Gopeed engine is missing: $runtimeFile"
    }
    Copy-Item -LiteralPath $runtimeFile -Destination $portable
  }
}
Write-Output "POPO_PATCHED_GOPEED=$portable"
Remove-Item -LiteralPath $work -Recurse -Force
