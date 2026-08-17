# AGENTS.md

## 项目概述

clear-filename：Windows 文件名痕迹搜索与清理工具（BS 架构）。浏览器输入 JavaScript 正则，后端从 13 类痕迹来源搜索匹配文件名的记录，前端表格展示，用户勾选后删除；另提供 4 项系统级清理（清空 USN Journal、删除卷影副本、覆盖空闲空间、清空安全事件日志，均需管理员权限）。

技术栈：Node.js + Express 5（CommonJS），前端原生 HTML/CSS/JS，零构建、零测试框架、零 CDN 依赖。

## 快速上手

1. 启动：`npm start`（默认端口 8300，`PORT` 环境变量可覆盖）
2. 验证：浏览器打开 http://localhost:8300，输入正则点"搜索"
3. 接口自测：`POST /api/search`（{regex, sources} → {results, truncated, total}）、`POST /api/delete`（{items} → {results:[{id, ok, message}]}）、`POST /api/system/:op`（{drive}，op 为 usn/vss/cipher/eventlog → {ok, output} 或 {ok:false, error}）。注意 Windows 下 curl/MSYS 传中文参数会乱码，自测用 Python urllib 或浏览器
4. 改动后端必须重启进程（node 不热加载）；前端 static 文件刷新即生效

## 数据流

正则 → POST /api/search → 各来源 search(re) 并行执行 → 统一条目数组 → 服务端归一化（文本截断 300、每源限 500、总限 2000）→ 前端分批渲染表格 → 勾选 deletable 条目 → POST /api/delete → lib/delete.js 按 kind 分发执行 → 逐条回执

## 目录结构

- server.js — Express 入口，SEARCHERS/SOURCE_LABELS 注册全部来源，条目归一化与限流
- lib/ps.js — PowerShell 调用封装（-EncodedCommand），所有注册表/索引查询必须经此
- lib/delete.js — 删除逻辑，按 kind 分发
- lib/system.js — 系统级清理命令执行（cmd + chcp 65001）
- lib/textmatch.js — 大文本匹配工具（克隆 g 正则防 exec 死循环、限匹配数）
- lib/search/*.js — 13 个搜索源，每源一个文件
- public/ — 前端静态资源（index.html / app.js / style.css）

## 架构约定

- 搜索源模块导出 `search(re)`，返回统一条目结构：`{ source, kind, name, location, match, deletable, deleteHint, extra }`
- 新增搜索源三步：lib/search/ 新文件 → server.js 的 SEARCHERS + SOURCE_LABELS 注册 → public/index.html 加来源勾选
- 搜索源只读，不执行删除；删除所需全部信息（location、extra）随条目回传，前端原样回传
- 删除按 kind 分发：file/lnk/jumplist → unlink（只需 location）；recycle → 删 $I（location）+ $R 配对（extra.dataPath，可缺省）；registry → PowerShell 删值并重写 MRUListEx（必须 extra.regPath + extra.valueName，缺失报"缺少定位信息"）
- extra 契约（前端原样回传，delete.js 按 kind 读取）：registry/registry_extra → { regPath, valueName }；recyclebin → { dataPath }；recent → { target }（仅展示用）；其余 kind 无需 extra
- deletable=false 的条目前端不可勾选，deleteHint 说明原因（索引随删除自动清除、配置文件不自动改写、事件日志无法单条删除、浏览器数据库被占用等）
- 大文本匹配统一走 lib/textmatch.js：必须克隆带 g 的正则（无 g 的 re.exec 只返回第一个匹配，循环会无限执行导致 OOM，曾实际崩溃）；克隆仅保留 i 标志，u/s/m/y 等标志丢失（如 s 模式下 . 不匹配换行，行为与浏览器不一致）
- 所有来源共享同一个 RegExp 对象，不得依赖/修改其 lastIndex

## Windows 环境要点（踩坑记录）

- PowerShell 传中文必须走 lib/ps.js 的 -EncodedCommand（UTF-16LE Base64），命令行直传被按 GBK 解码乱码；脚本开头必须 `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)`
- 系统命令（fsutil/vssadmin/cipher/wevtutil）经 cmd.exe 前置 chcp 65001 转 UTF-8 输出；退出码是成功与否的权威依据，stderr 可能是英文或 GBK
- registry_extra 枚举 18 个注册表根，每根配额 500 条、文本截断 500 字符（防止大 JSON 撑爆内存，曾因 Office 树全量枚举 OOM）
- jetbrains 源递归扫 JetBrains 目录 *.xml（上限 3000 文件、单文件 ≤2MB）
- eventlog 源：Security 查 4656/4660/4663，Application 查全部事件消息文本；Get-WinEvent"无匹配事件"异常按空结果处理，仅"拒绝访问"上报错误
- 文件系统扫描跳过目录：`$Recycle.Bin`/`$RECYCLE.BIN`、`System Volume Information`、`WinSxS`、`Recovery`、`node_modules`、`.git`
- 回收站 $I 解析：偏移 24 起 UTF-16 原始文件名（上限 520 字节），配对文件为同目录 `$R` + 随机名
- .lnk 目标路径为宽松 UTF-16 提取，需清洗首尾控制字符/反引号（见 recent.js）

## 修改约束

- 保持现有风格：CommonJS、原生前端、零构建、零新依赖
- 正则语义：用户输入即 JS 正则源码，直接 new RegExp，不转义、不加输入校验
- 只改要求范围；不创建测试文件/测试配置
