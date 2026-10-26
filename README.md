# clear-filename

Windows 文件名痕迹搜索与清理工具（浏览器/服务器架构）。输入正则表达式，从全盘文件系统与各类"痕迹"位置搜索匹配文件名的记录，并删除搜索出的记录。

## 功能

- 搜索 16 个来源：全盘文件系统、USN Journal、回收站、最近使用记录（.lnk + 跳转列表）、注册表全量（HKLM/HKCU/HKU/HKCC）、Windows 搜索索引、IDE 配置（VSCode/Notepad++/JetBrains）、浏览器历史（Chrome/Edge）、Amcache、Prefetch、事件日志、Total Commander 历史、Everything 运行历史、浏览器下载记录库（shared_proto_db）、WPS 云同步映射库（qing.db）、腾讯电脑管家扫描记录（QMDLPList.xml）
- 来源可勾选，结果表格展示来源/名称/位置/匹配片段/删除方式，悬停可看完整内容
- 删除可删除的记录；不可直接删除的条目标注"手动处理"及原因
- 系统级清理：清空 USN Journal、删除卷影副本、覆盖磁盘空闲空间、清空安全事件日志（均需管理员权限）、清理 WPS 最近文件列表（普通权限）

## 系统要求

- Windows 10 / 11
- Node.js 18 及以上

## 安装与启动

```bash
npm install
npm start
```

浏览器打开 http://localhost:8300 。指定端口（可选）：Windows cmd 用 `set PORT=9000 && npm start`，bash 用 `PORT=9000 npm start`。

## 使用说明

1. 输入正则表达式（JavaScript 语法，如 `\.xlsx$|2026`）
2. 勾选搜索来源（默认全选）
3. 点击"搜索"（全盘扫描需几分钟，期间按钮禁用）
4. 勾选结果行，点击"删除选中"，确认后逐条删除并显示回执

## 删除行为

- 文件 / 快捷方式 / 跳转列表 / Prefetch：直接删除
- 回收站记录：删除索引与数据文件（永久删除，不经过回收站）
- 注册表值：删除并同步清理排序表
- Everything 运行历史：从 `%APPDATA%\Everything\Run History.csv` 移除对应行（需先退出 Everything，否则其退出时可能写回）
- 浏览器下载记录库（shared_proto_db）/ WPS 云同步映射库（qing.db）：删除整个库文件（需先关闭对应程序；同一库内的其他记录会一并清除，程序会重建库）
- 电脑管家扫描记录：从 `C:\ProgramData\Tencent\QQPCMgr\QMDLPList.xml` 移除对应条目（同一路径的多条扫描记录一并移除；需先退出电脑管家，否则其保存时会重写列表）
- 搜索索引条目、应用配置文件（VSCode/Notepad++/浏览器/JetBrains/Total Commander）：不自动改写，标注"手动处理"

## 系统级清理（WPS 最近列表除外，均需管理员权限）

页面底部操作区，盘符默认 C:，五个操作：

- 清空 USN Journal：清空 NTFS 变更日志（Everything 类工具的数据源），清后需全量重建索引
- 删除全部卷影副本：清除系统还原点/备份快照中的旧文件
- 覆盖磁盘空闲空间：擦除已删除文件的数据残留，耗时极长（可达数小时），期间请勿关机
- 清空安全事件日志：清除全部安全审计记录（含文件系统审计），不可恢复
- 清理 WPS 最近文件列表：整键删除 `HKEY_CURRENT_USER\Software\kingsoft\Office\6.0\et\RecentFiles`（WPS 表格的「最近使用」记录，含 files / files_bak / Sequence 子键），不使用盘符，普通权限即可；建议先退出 WPS 再执行，否则 WPS 退出时可能把列表写回

前四项无管理员权限时返回"拒绝访问"。请以管理员身份运行本服务后重试。

## 注意事项

- 删除不可恢复，操作前请确认目标
- 全盘扫描耗时较长，属正常现象
- 跳转列表命中后删除整个文件，会清掉该应用的全部最近记录
- 结果全量返回；仅超过 10 万条时整体截断，请用更精确的正则缩小范围
- 搜索索引来源按正则中的字面片段预筛；取不出「必然出现」的字面时（如 `.*`、`\.(xlsx|docx)$`）退化为全量遍历（很慢），但不会因预筛漏掉结果
- 注册表来源匹配值名与值数据（REG_SZ、REG_BINARY、REG_EXPAND_SZ、REG_MULTI_SZ）；DWORD/QWORD 等数值类型不参与文本匹配
