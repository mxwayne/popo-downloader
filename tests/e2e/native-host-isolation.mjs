// e2e 沙箱扩展与 Stable 扩展使用同一个固定 ID（manifest 里的 key），
// 所以测试 Chromium 能连上本机真实注册的 Stable/Dev 原生助手：打开弹窗就会触发 ensure_gopeed，
// 在真实安装目录里启动 Gopeed（跑测试的会话权限更高时，用户的安装器还结束不了它）。
// 做法：只在沙箱副本里把原生助手名改成一个不存在的名字，行为与没有安装助手的 CI 机器一致。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const UNREACHABLE_NATIVE_HOST = "com.popo.e2e_isolated.no_such_host";

const HOST_CONSTANT = /(const (?:STABLE|DEV)_FOLDER_PICKER_HOST = ")com\.popo\.[a-z_]+\.folder_picker(")/g;

export function isolateNativeHostSource(source) {
  const matches = source.match(HOST_CONSTANT) || [];
  if (matches.length !== 2) {
    throw new Error(
      "e2e native host isolation needs the STABLE_/DEV_FOLDER_PICKER_HOST constants in background.js; "
      + "if they were renamed, update tests/e2e/native-host-isolation.mjs before running e2e on a machine with POPO installed."
    );
  }
  return source.replace(HOST_CONSTANT, `$1${UNREACHABLE_NATIVE_HOST}$2`);
}

export async function isolateNativeHost(extensionRoot) {
  const file = join(extensionRoot, "background.js");
  await writeFile(file, isolateNativeHostSource(await readFile(file, "utf8")), "utf8");
}
