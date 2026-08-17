# clear-filename

Windows 文件名痕迹搜索与清理工具（Browser/Server 架构）。输入 JavaScript 正则表达式，从文件系统与各类"痕迹"位置搜索匹配文件名的记录，并删除搜索出的记录。

## 功能

- 按正则表达式搜索文件名，覆盖 10 类来源：全盘文件系统、回收站记录、最近使用（.lnk）、注册表 MRU（RecentDocs/WordWheelQuery/RunMRU/记事本）、注册表扩展（打开/保存对话框、地址栏历史、WPS 最近文档、Office 最近文档、WinRAR/7-Zip 历史）、跳转列表、Windows 搜索索引、应用 MRU（VSCode/Notepad++）、浏览器下载历史（Chrome/Edge）、Prefetch
- 搜索来源可勾选，结果按来源聚合展示（来源/名称/位置/匹配片段/删除方式）
- 删除可删除的记录：文件、快捷方式、回收站条目、注册表值；不可直接删除的条目明确标注处理方式
- 系统级清理（需管理员权限）：清空 USN Journal、删除全部卷影副本、覆盖磁盘空闲空间

## 快速开始

```bash
npm install
npm start
```

浏览器打开 http://localhost:8300 。

指定端口（可选）：Windows cmd 用 `set PORT=9000 && npm start`，bash 用 `PORT=9000 npm start`。

## 使用说明

1. 输入正则表达式（JavaScript 语法，如 `内部★|秘密★|机密★`）
2. 勾选搜索来源（默认全选）
3. 点击"搜索"（全盘扫描需几分钟，搜索按钮禁用直至完成）
4. 勾选结果行，点击"删除选中"，确认后逐条删除并显示回执

注意：删除不可恢复；标记"手动处理"的条目不会被勾选，需按提示手动处理。

## 删除行为

- 文件 / .lnk / 跳转列表 / Prefetch：直接删除
- 回收站记录：删除 $I 索引与对应 $R 数据文件（永久删除）
- 注册表值（MRU 与扩展来源）：删除值并同步清理 MRUListEx 排序表
- 搜索索引条目：随文件删除自动清除，无需且无法直接删除
- 应用 MRU（VSCode/Notepad++ 配置）与浏览器下载历史：不自动改写，避免破坏配置/数据库，需手动处理

## 搜索来源与位置

| 来源 | 位置 |
| --- | --- |
| 文件系统（全盘） | 所有盘符，跳过 $Recycle.Bin、System Volume Information、WinSxS、Recovery、node_modules、.git |
| 回收站记录 | 各盘 $Recycle.Bin 下 $I 文件中的原始文件名 |
| 最近使用 .lnk | %APPDATA%\Microsoft\Windows\Recent |
| 注册表 MRU | HKCU 下 Explorer\RecentDocs、Explorer\WordWheelQuery、Explorer\RunMRU、Notepad |
| 注册表扩展 | HKCU 下 Explorer\ComDlg32（打开/保存对话框）、Explorer\TypedPaths（地址栏）、Kingsoft（WPS）、Microsoft\Office、WinRAR、7-Zip |
| 跳转列表 | %APPDATA%\Microsoft\Windows\Recent\AutomaticDestinations、CustomDestinations |
| 搜索索引 | Windows Search SYSTEMINDEX（LIKE 预筛 + 正则二次确认） |
| 应用 MRU | VSCode globalStorage、Notepad++ session/config |
| 浏览器下载历史 | Chrome / Edge User Data\Default\History |
| Prefetch | C:\Windows\Prefetch\*.pf（仅 .exe 被执行过） |

## 系统级清理（需管理员权限）

页面底部操作区，盘符默认 C:，三个操作：

- 清空 USN Journal：`fsutil usn deletejournal /d`，清空 NTFS 变更日志（Everything 类工具的数据源），清后需全量重建索引
- 删除全部卷影副本：`vssadmin delete shadows`，清除还原点/备份快照中的旧文件
- 覆盖磁盘空闲空间：`cipher /w`，擦除已删除文件的数据残留，耗时极长（可达数小时）

无管理员权限时返回"拒绝访问"（Error 5）。本服务需以管理员身份运行才能执行成功。

## 项目结构

```
server.js            Express 入口：/api/search、/api/delete、/api/system
lib/ps.js            PowerShell 调用封装（-EncodedCommand 规避中文编码问题）
lib/delete.js        删除逻辑，按 kind 分发
lib/system.js        系统级清理（fsutil/vssadmin/cipher）
lib/search/          10 个搜索源模块，统一导出 search(re)
public/              前端页面（原生 HTML/CSS/JS，零依赖）
```

## 注意事项

- 跳转列表命中后删除整个 .automaticDestinations-ms 文件，会清掉该应用的全部最近记录
- 结果过多时每来源最多展示 500 条（总上限 2000），避免单一来源淹没其他来源与页面卡顿
- 搜索索引来源依赖正则中的字面片段做预筛，纯元字符正则（如 `.*`）跳过该来源
- 注册表与搜索索引查询通过 PowerShell 执行，首次运行可能需要数秒
