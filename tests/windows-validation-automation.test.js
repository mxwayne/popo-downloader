const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");

test("routine Windows workflow verifies and packages only the Dev channel", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "windows-validation.yml"),
    "utf8"
  );
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /npm run check:full:windows/);
  assert.match(workflow, /npm run build:dev-package/);
  assert.match(workflow, /Build isolated Dev package[\s\S]*shell: powershell/);
  assert.match(workflow, /popo-dev-downloader-\*-win-x64\.zip/);
  assert.doesNotMatch(workflow, /build:release-package|stable\/latest\.json|contents: write/);
});

test("remote validation uses an isolated Git snapshot and the fixed Dev sync", () => {
  const sender = fs.readFileSync(path.join(root, "scripts", "remote-windows-dev.sh"), "utf8");
  const runner = fs.readFileSync(path.join(root, "scripts", "windows-remote-runner.sh"), "utf8");
  const validator = fs.readFileSync(path.join(root, "scripts", "windows-dev-validate.ps1"), "utf8");

  assert.match(sender, /git .* bundle create/);
  assert.match(sender, /for-each-ref .* --contains/);
  assert.match(sender, /cat > .*working-tree\.patch/);
  assert.match(sender, /git .* diff --binary --full-index HEAD/);
  assert.match(sender, /ls-files --others --exclude-standard/);
  assert.match(sender, /POPODevValidation/);
  assert.match(runner, /git clone --quiet/);
  assert.match(runner, /GIT_TERMINAL_PROMPT=0 git clone/);
  assert.match(runner, /git -C .* apply/);
  assert.match(validator, /npm run check:full:windows/);
  assert.match(validator, /POPO_WINDOWS_TESTS=PASS/);
  assert.match(validator, /POPO_DEV_SYNC=PASS/);
  assert.match(validator, /POPO_DEV_SYNC_BATCH_TIME=/);
  assert.match(sender, /POPO_WINDOWS_BUILD_DEV_PACKAGE/);
  assert.match(sender, /POPO_WINDOWS_INSTALL_DEV_PACKAGE/);
  assert.match(sender, /POPO_WINDOWS_SOURCE_MODE/);
  assert.match(sender, /POPO_WINDOWS_REMOTE_BASH/);
  assert.match(sender, /Refusing unsafe Windows remote Bash path/);
  assert.match(sender, /remote_ssh\(\)/);
  assert.match(runner, /-BuildDevPackage/);
  assert.match(runner, /-InstallDevPackage/);
  assert.match(validator, /npm run build:dev-package/);
  assert.match(validator, /popo-dev-setup\.exe/);
  assert.match(validator, /Process\]::Start\(\$setupStartInfo\)/);
  assert.match(validator, /setupStartInfo\.WorkingDirectory = \$packageRoot/);
  assert.match(validator, /File\]::ReadAllText\([\s\S]*manifest\.json[\s\S]*Encoding\]::UTF8/);
  assert.match(validator, /cleanupAttempt -lt 4/);
  assert.match(fs.readFileSync(path.join(root, "setup", "PopoSetup.cs"), "utf8"), /DescribeDirectoryMismatch\(sourceExtension, extensionRoot\)/);
  assert.match(validator, /POPO_DEV_INSTALL=PASS/);
  assert.match(validator, /installState\.version -ne \$devVersionName/);
  assert.doesNotMatch(validator, /installState\.versionName/);
  assert.match(validator, /com\.popo\.dev_downloader\.folder_picker/);
  assert.match(validator, /folfhehnopknchpoaajfpboibbhnlanf/);
  assert.ok(
    validator.indexOf("POPO_WINDOWS_TESTS=PASS") <
      validator.indexOf("scripts/sync-dev-extension.ps1"),
    "Dev sync must remain after the full Windows test PASS marker"
  );
  assert.match(validator, /System32.*env:PATH|env:PATH.*System32/s);
  assert.match(validator, /scripts\/sync-dev-extension\.ps1/);
  assert.match(sender, /WINDOWS VERIFY:/);
  assert.match(sender, /SOURCE: Mac working tree/);
  assert.match(sender, /MAC COMMIT:/);
  assert.match(sender, /DIRTY CHANGES:/);
  assert.match(sender, /WINDOWS TESTS:/);
  assert.match(sender, /DEV PACKAGE INSTALL:/);
  assert.match(sender, /DEV SYNC:/);
  assert.match(sender, /DEV SYNC BATCH:/);
  assert.match(sender, /DEV TARGET:/);
  assert.match(sender, /STABLE OPERATION REQUESTED: NO/);
  assert.match(sender, /patch_sha256=.*shasum -a 256/);
  assert.match(sender, /untracked_sha256=.*shasum -a 256/);
  assert.match(runner, /node:crypto/);
  assert.match(runner, /tar --no-same-owner --no-same-permissions --keep-old-files/);
  assert.match(runner, /Refusing archive entry that collides with a tracked source file/);
  assert.match(runner, /Refusing archive entry that replaces an existing checkout path/);
  assert.match(runner, /Refusing archive entry beneath a symbolic link/);
  assert.ok(sender.includes("if [[ ! $host =~ ^[A-Za-z0-9][A-Za-z0-9._@-]*$ ]]"));
  assert.ok(sender.includes("if [[ $remote_bash != bash && ! $remote_bash =~ ^[A-Za-z]:\\\\([A-Za-z0-9._-]+\\\\)*bash\\.exe$ ]]"));
  assert.match(sender, /\$env:PATH = \(Split-Path -LiteralPath '\$remote_bash'\)/);
  assert.match(sender, /-EncodedCommand \$encoded_command/);
  assert.ok(sender.includes("if [[ ! $remote_root =~ ^/[A-Za-z]/([A-Za-z0-9_-]+/)*POPODevValidation$ ]]"));
  assert.ok(runner.includes("if [[ ! $remote_root =~ ^/[A-Za-z]/([A-Za-z0-9_-]+/)*POPODevValidation$ ]]"));
  assert.match(validator, /popo-dev-downloader-\$devVersionName-win-x64/);
  assert.match(validator, /Expand-Archive -LiteralPath \$packageZip/);
  assert.match(validator, /popo-dev-setup\.exe/);
  assert.match(sender, /Reload "POPO Dev 下载助手" in chrome:\/\/extensions/);
  assert.doesNotMatch(sender + runner + validator, /POPOStableDownloader|build:release-package/);
});

test("remote validation rejects SSH options and shell syntax in host and root before connecting", (t) => {
  const script = path.join(root, "scripts", "remote-windows-dev.sh");
  const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (bash.error || bash.status !== 0) {
    t.skip("Bash is unavailable on this host");
    return;
  }
  const hostileInputs = [
    { POPO_WINDOWS_HOST: "-oProxyCommand=whoami" },
    { POPO_WINDOWS_REMOTE_ROOT: "/d/POPO/Validation/x';whoami;# /POPODevValidation" },
    { POPO_WINDOWS_REMOTE_BASH: "C:\\Windows\\Temp\\bash.exe';whoami;#" },
  ];
  for (const override of hostileInputs) {
    const result = spawnSync("bash", [script], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, ...override },
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Refusing unsafe Windows (SSH host|validation root|remote Bash path)/);
  }
});

test("real-browser smoke stays short and expands only for download logic", () => {
  const smoke = fs.readFileSync(path.join(root, "scripts", "print-windows-smoke.mjs"), "utf8");
  assert.match(smoke, /扩展重新加载正常/);
  assert.match(smoke, /POPO 页面识别正常/);
  assert.match(smoke, /单文件下载正常/);
  assert.match(smoke, /文件夹\/批量下载正常/);
  assert.match(smoke, /--download-logic/);
  assert.match(smoke, /暂停正常/);
  assert.match(smoke, /继续正常/);
  assert.match(smoke, /失败重试正常/);
});
