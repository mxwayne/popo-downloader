# GitHub 备用更新源

状态：用户已确认（2026-11-17）；随 0.8.1 实现，待 Windows 现场验收。

## 目的

腾讯云更新源在部分网络下不可用。GitHub Release 已公开发布同一个 ZIP，把它作为备用源，用户开启代理即可更新。

## 设计

1. 发布时多生成并上传 `latest.github.json`：字段与 `latest.json` 相同，`url` 为 `https://github.com/<repo>/releases/download/v<version>/<zip>`，用同一把私钥单独签名。
2. Native Host 先读腾讯云清单；失败时读 `https://github.com/mxwayne/popo-downloader/releases/latest/download/latest.github.json`。两者都失败时，报告腾讯云的错误。
3. 校验：签名、版本、sha256、大小照旧。GitHub 清单的下载地址必须以 `/mxwayne/popo-downloader/releases/download/v<version>/` 开头。
4. 重定向：手动逐跳跟随，每一跳必须是 https、443 端口、无用户信息，主机为 `github.com`（路径前缀 `/mxwayne/popo-downloader/`）或 GitHub 资源主机白名单。其余一律拒绝。
5. 分离执行：后台更新器下载腾讯云包失败时，对同一版本回退到 GitHub 清单。
6. 只有 0.8.1 及以后的客户端含此逻辑；0.8.0 及更早版本不会走 GitHub。Agent 不变。

## 不做

- 不让 `latest.github.json` 切换 stable 通道；通道仍只由腾讯云 `latest.json` 决定。
- 不接受未签名或任意主机的清单。

## 验收

- `tests/update-source.test.js`（Windows）：腾讯云与 GitHub 地址规则、错仓库、相似主机、http、版本路径、用户信息、被篡改字段；重定向 ALLOWED/DENIED。
- `tests/release-automation.test.js`：发布脚本生成、校验并上传 `latest.github.json`。
- 现场：0.8.0 机器更新到 0.8.1（腾讯云）；之后断开腾讯云验证备用源。
