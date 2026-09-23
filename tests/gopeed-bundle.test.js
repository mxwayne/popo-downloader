"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const vendorRoot = path.join(__dirname, "..", "vendor", "gopeed", "v1.9.3");
const expectedHash = "02b3b2f0ce4b0e0008edc835802ad6f4b241eb863f312b0bdd77b2b2afc9e012";

test("bundled Gopeed is the verified official v1.9.3 portable release", () => {
  const archive = fs.readFileSync(
    path.join(vendorRoot, "Gopeed-v1.9.3-windows-amd64-portable.zip")
  );
  assert.equal(crypto.createHash("sha256").update(archive).digest("hex"), expectedHash);
  assert.ok(fs.statSync(path.join(vendorRoot, "portable", "gopeed.exe")).size > 0);

  const metadata = JSON.parse(fs.readFileSync(path.join(vendorRoot, "metadata.json"), "utf8"));
  assert.equal(metadata.version, "v1.9.3");
  assert.equal(metadata.license, "GPL-3.0");
  assert.equal(metadata.binarySha256, expectedHash);

  const license = fs.readFileSync(path.join(vendorRoot, "LICENSE"), "utf8");
  assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
  const llvmLicense = fs.readFileSync(path.join(vendorRoot, "LLVM-MinGW-LICENSE.TXT"), "utf8");
  assert.match(llvmLicense, /Apache License v2\.0 with LLVM Exceptions/);
  assert.ok(fs.statSync(path.join(vendorRoot, "Gopeed-v1.9.3-source.zip")).size > 0);
});

test("Gopeed Dev build generates and persists an API token and publishes it only for local pairing", () => {
  const patch = fs.readFileSync(path.join(vendorRoot, "popo-api-token-bootstrap.patch"), "utf8");
  const builder = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "build-gopeed-patched.ps1"),
    "utf8"
  );
  const nativeHost = fs.readFileSync(
    path.join(__dirname, "..", "native-host", "FolderPickerHost.cs"),
    "utf8"
  );
  const popup = fs.readFileSync(
    path.join(__dirname, "..", "src", "ui", "popup-components.tsx"),
    "utf8"
  );

  assert.match(patch, /Random\.secure\(\)/);
  assert.match(patch, /saveStartConfig/);
  assert.match(patch, /\.popo-api-token\.bridge/);
  assert.match(builder, /Gopeed-v1\.9\.3-source\.zip/);
  assert.match(builder, /git -C \$source apply/);
  assert.match(builder, /'libc\+\+\.dll', 'libunwind\.dll'/);
  assert.match(
    fs.readFileSync(path.join(__dirname, "..", "scripts", "build-test-package.ps1"), "utf8"),
    /gopeed-v1\.9\.3-popo-token-v1/
  );
  const packageBuilder = fs.readFileSync(path.join(__dirname, "..", "scripts", "build-test-package.ps1"), "utf8");
  assert.match(packageBuilder, /LLVM-MinGW-LICENSE\.TXT/);
  assert.match(nativeHost, /ProtectedData\.Protect/);
  assert.match(nativeHost, /WriteGopeedTokenBridge\(gopeedPath, apiToken\)/);
  assert.doesNotMatch(popup, /gopeedApiToken|保存密钥/);
});
