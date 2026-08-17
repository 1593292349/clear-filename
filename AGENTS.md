# AGENTS.md

## 项目概述

clear-filename：Windows 文件名痕迹搜索与清理工具，Browser/Server 架构。按 JavaScript 正则表达式搜索文件名，覆盖文件系统、回收站、最近使用、注册表 MRU、注册表扩展（打开/保存对话框、WPS、Office、压缩软件）、跳转列表、搜索索引、应用 MRU、浏览器下载历史、Prefetch 共 10 类来源，并删除搜索出的记录；另提供系统级清理（清空 USN Journal、删除卷影副本、覆盖空闲空间，需管理员权限）。

技术栈：Node.js（>=18，开发环境 v24）+ Express 4，前端原生 HTML/CSS/JS，无构建步骤、无 TypeScript、无测试框架、无 lint 配置。保持精简。

## 目录结构

- server.js — Express 入口，POST /api/search、POST /api/delete，SEARCHERS 对象注册全部来源
- lib/ps.js — PowerShell 调用封装，所有注册表/搜索索引访问必须经此模块
- lib/delete.js — 删除逻辑，按 kind 分发
- lib/system.js — 系统级清理（fsutil/vssadmin/cipher，经 cmd chcp 65001 转 UTF-8 输出）
- lib/search/*.js — 10 个搜索源，每源一个文件
- public/ — 前端静态资源（express.static 托管，零 CDN 依赖）

## 常用命令

- 启动：`npm start` 或 `node server.js`，默认端口 8300，可用环境变量 PORT 覆盖
- 无测试/构建/格式化命令

## 架构约定

- 每个搜索源模块只导出 `search(re)`，返回统一条目结构：
  `{ source, kind, name, location, match, deletable, deleteHint, extra }`
- 新增搜索源 = lib/search/ 下新文件 + server.js 的 SEARCHERS 一行注册，前端来源勾选自动出现
- 搜索模块只读，不执行删除；删除所需全部信息（location、extra）随条目返回，前端原样回传
- lib/delete.js 按 kind 分发：file/lnk/jumplist 直接 unlink，recycle 删 $I+$R 配对，registry 走 PowerShell 删值并重写 MRUListEx
- 不可直接删除的类型（index、appmru）置 deletable=false，由前端拦截勾选，deleteHint 说明原因
- 前端保持原生零 CDN 依赖；风格沿用现有 CSS 变量与类名

## Windows 特有注意事项

- 传中文给 powershell.exe 必须走 lib/ps.js 的 -EncodedCommand（UTF-16LE Base64），直接传命令行参数会被按 GBK 解码导致乱码
- 所有 PowerShell 脚本开头必须设置 `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)`，否则 stdout 按 GBK 输出、Node 按 UTF-8 解码乱码
- 系统级命令（fsutil/vssadmin/cipher）经 cmd.exe 执行并前置 `chcp 65001` 转 UTF-8 输出；失败时 stderr 可能为英文或 GBK，错误信息截断 2000 字符返回
- registry_extra 的删除复用 delete.js 的 registry 分支（Remove-ItemProperty + MRUListEx），值为 REG_SZ 时 MRUListEx 清理自动跳过
- 文件系统扫描默认跳过目录：`$Recycle.Bin`、`System Volume Information`、`WinSxS`、`Recovery`、`node_modules`、`.git`
- 回收站 $I 文件解析：偏移 24 起为 UTF-16 原始文件名（上限 520 字节），配对文件为同目录 `$R` + 随机名
- .lnk 目标路径为宽松 UTF-16 提取，需清洗首尾控制字符/反引号（见 recent.js）

## 修改约束

- 保持 CommonJS 风格，不引入构建步骤
- 不增加未要求的输入校验、依赖或配置文件
- 正则语义：用户输入即 JavaScript 正则源码，直接 new RegExp，不转义
