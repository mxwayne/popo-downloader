# 第三方软件说明

## Gopeed v1.9.3

本测试包包含基于 Gopeed v1.9.3 Windows amd64 portable 版本构建的本地下载引擎。POPO 仅增加首次启动 API Token 的自动生成与 Native Messaging 配对支持，任务引擎、存储格式和下载行为保持 Gopeed 原实现。

- 项目主页：https://github.com/GopeedLab/gopeed
- 官方发布包：https://github.com/GopeedLab/gopeed/releases/download/v1.9.3/Gopeed-v1.9.3-windows-amd64-portable.zip
- 上游版本：v1.9.3
- 上游源码提交：a5cd53f94c18ac65add684b1113fa5f0b47cc4da
- 许可证：GNU General Public License v3.0（GPL-3.0）

Gopeed Windows 构建包随附 LLVM-MinGW 的 `libc++.dll` 与 `libunwind.dll` 运行库，许可证文本见包内 `licenses/gopeed/LLVM-MinGW-LICENSE.TXT`（Apache-2.0 with LLVM Exceptions）。
- 官方发布包 SHA-256：`02b3b2f0ce4b0e0008edc835802ad6f4b241eb863f312b0bdd77b2b2afc9e012`

许可证全文、上游版本元数据、对应版本的完整源码归档和 POPO 补丁位于测试包的 `licenses/gopeed/` 目录。
