# AGENTS.md

## 项目概述

clear-filename：Windows 文件名痕迹搜索与清理工具（BS 架构）。浏览器输入 JavaScript 正则，后端按来源（见「来源一览」）在文件名及各类痕迹文本（注册表值数据、IDE/浏览器配置、事件消息等）中搜索匹配，前端表格展示，用户勾选后删除；另提供 5 项系统级清理（清空 USN Journal、删除卷影副本、覆盖空闲空间、清空安全事件日志均需管理员权限；整键删除 WPS 表格的最近文件列表只需普通权限）。

信任模型：本机单用户工具。服务监听全部网卡且无鉴权，/api/search、/api/delete、/api/system 均不做权限与归属校验：kind 只按 switch 分发，file/lnk/jumplist 的 location 直接 unlink（可删任意路径）；/api/system 的 drive 只做 replace(/:$/) 就拼进 cmd.exe 命令行（可注入任意命令）；registry 的 extra.regPath 未转义就拼进 PowerShell 单引号字符串（valueName 只转义单引号）。只应在本机使用，不要对外暴露。

技术栈：Node.js + Express 5（CommonJS；Node 18+ 来自 express 5 的 engines，package.json 未声明），前端原生 HTML/CSS/JS，零构建、零测试框架、零 CDN 依赖。

## 快速上手

1. 安装启动：`npm install`（node_modules 未入库）→ `npm start`（默认端口 8300，`PORT` 环境变量可覆盖；仅 Windows）。USN、Prefetch、Amcache、Security 事件需要管理员进程才能读取（普通权限读 Prefetch/Amcache 即 EPERM），需在管理员终端执行 `npm start`；权限不足时各源的处理见「来源一览」的失败策略列（非管理员下 USN/Prefetch/Amcache/Security 返回空或失败条目属预期，不要当成改动引入的回归）；启动时不做管理员权限/Windows 版本自检，权限问题只在搜索或系统操作时才暴露
2. 验证：浏览器打开 http://localhost:8300，输入正则点"搜索"
3. 接口自测（Windows 下 curl/MSYS 传中文参数会乱码，用 Python urllib 或浏览器）：
   - `POST /api/search` {regex, sources, ignoreCase} → {results, truncated, total}；ignoreCase 缺省 true；sources 传空数组或不传等于全部来源（不是"不搜索"）；regex 空或非法返回 400
   - `POST /api/delete` {items} → {results:[{id, ok, message}]}；前端只提交 deletable 条目
   - `POST /api/system/:op` {drive} → {ok, output} 或 {ok:false, error}；op 为 usn/vss/cipher/eventlog/wpsrecent（usn/vss/cipher 按盘执行，eventlog/wpsrecent 忽略 drive；超时 60s/60s/600s/60s/60s，cipher 在大盘上会于 10 分钟中断；超时只保证终止 cmd.exe，不保证结束 cmd 拉起的 cipher/fsutil 等子进程；usn 遇 Error 1179 按"日志本就不存在/已清空"返回成功；wpsrecent 用 reg delete 整键删 HKCU\Software\kingsoft\Office\6.0\et\RecentFiles，键不存在按"已是干净状态"返回成功，删除后调 invalidateCache 清注册表导出缓存——因此 lib/system.js 依赖 lib/search/registry_full.js）
   - 所有 POST 请求体上限 4mb（express.json）：大批量删除需分批提交，否则 413；413 与非法 JSON 返回 Express 默认 HTML 错误页（前端 resp.json() 会抛 SyntaxError），不是 JSON 错误体
   - `GET /api/drives` → {drives:["C:","D:"]}；这里已去掉尾部反斜杠，listDrives 内部返回的是 `C:\` 形式
   - 搜索无整体超时、无取消：各源只有局部超时（eventlog 180s、searchindex 300s、reg export 每键 180s；ps.js 默认 120s 当前无来源使用），filesystem、usn（spawn fsutil 无 timer）、registry 扫描阶段与所有同步读文件源（amcache/browserdl 等）都无超时；usn 逐盘串行，慢盘/映射盘/坏盘会拖住整个请求
4. 改动后端必须重启进程（node 不热加载）；前端 static 文件刷新即生效
5. 运行期无日志：服务端只有启动一行 console.log，没有请求日志/落盘日志；搜索、删除、系统操作的失败只在前端 toast 与回执中体现，排查靠临时打印。端口被占用时进程直接退出（app.listen 无 error 处理）

## 数据流

正则 → POST /api/search → 各来源 search(re) 启动（filesystem 走 worker 线程、usn/eventlog/searchindex 真异步；registry 只有导出阶段异步，导出后逐文件 readFileSync + 同步扫描会整段阻塞事件循环；recyclebin/recent/appmru/browserdl/amcache/prefetch/filemgr 同步读文件，依次阻塞主线程）→ 统一条目数组 → 全量返回（不做每源配额；仅超过 MAX_RESULTS=100000 时按来源顺序整体截断并置 truncated，截断只限制返回条数、不限制各源内部收集量，宽正则仍可能先撑爆内存）→ 前端分批渲染表格 → 勾选 deletable 条目 → POST /api/delete → lib/delete.js 按 kind 分发执行 → 逐条回执。条目 id 由 server 按 source:序号 生成，每次搜索重新编号；删除回执按 id 匹配，跨搜索不可复用。

## 验证

- 无测试框架，不新增测试文件；每次改动后用下面的单来源搜索对比结果。
- 验证只做搜索与条目对比：禁止调用 /api/system/*（清 USN、删卷影、擦空闲空间、清安全日志均不可逆），禁止真实删除文件、注册表值或回收站项；前端手测也不要点「删除选中」。
- 单个来源用 `POST /api/search` 传 `{"regex":"...","sources":["registry"]}` 验证，避免 filesystem 全盘扫描拖住整个请求；对比改动前后的条目数与按 source/kind 的分类分布，确认没丢数据。
- 免服务验证：同步源直接 `node -e "console.log(require('./lib/search/recent').search(/x/i).length)"`，异步源用 `.search(/x/i).then(...)`；不用重启进程或起 HTTP。
- 静默丢数据只能靠条目数对比发现（哪种失败会显示「失败」见「架构约定」的失败策略 ①-⑤）。
- 前端（public/app.js、index.html）没有自动化验证；改渲染/勾选/删除回执后必须在浏览器手测，不要声称已自动验证。
- 调试 PowerShell：psScript 看 lib/ps.js 的 execFile 回调，psStream 看 spawn 的 stdout/stderr（排查完删掉打印）。
- 单来源搜索模板（改 regex 与 sources 后逐行跑，输出条数与 kind 分布）：
   - `import json, urllib.request as u, collections`
   - `body = json.dumps({'regex': r'\.xlsx', 'sources': ['registry']}).encode()`
   - `d = json.loads(u.urlopen(u.Request('http://localhost:8300/api/search', body, {'Content-Type': 'application/json'})).read())`
   - `print(d['total'], d['truncated'], collections.Counter(x['kind'] for x in d['results']))`

## 目录结构

- server.js — Express 入口，SEARCHERS/SOURCE_LABELS 注册来源（见来源一览），注入 id/sourceLabel、超过 MAX_RESULTS 整体截断
- lib/ps.js — PowerShell 调用封装（-EncodedCommand）：psScript 一次性收取、psStream 逐行流式；所有 PowerShell 脚本必须经此（registry 的 reg.exe 导出与 .reg 解析不经它）
- lib/delete.js — 删除逻辑，按 kind 分发；switch 分支就是可删 kind 的白名单，没有额外校验
- lib/system.js — 系统级清理命令执行（cmd + chcp 65001）
- lib/textmatch.js — 大文本匹配工具（限条数 + 上下文片段）
- lib/binscan.js — 二进制私有库的字符串提取（UTF-16 双偏移切分、路径提取与乱码截断），chromedl/wpsqing 共用
- lib/workers/fs-scan.js — 文件系统扫描 worker，每个盘一个线程并行遍历
- lib/search/*.js — 搜索源；SEARCHERS key 与文件名不完全对应：registry → registry_full.js；recent/appmru 合并 jumplist/jetbrains 子模块（不单独注册）；filesystem.js 兼作盘符枚举工具，listDrives 被 server.js（/api/drives）、usn、recyclebin 复用
- public/ — 前端静态资源（index.html / app.js / style.css）
- README.md — 面向用户的使用文档（功能/删除/系统清理/注意事项）

## 来源一览

每源一行：key（展示名 → 实现文件）→ kind / 可删 / 权限 / 覆盖范围 / 失败策略；分号后是机制与坑。失败策略编号见「架构约定」。

- filesystem（文件系统 → filesystem.js + workers/fs-scan.js）→ file / 可删 / 普通 / 全部存在盘符（含映射盘；只匹配文件名，不匹配路径）/ ④⑤；每盘一个 worker；跳过 $Recycle.Bin、$RECYCLE.BIN、System Volume Information、WinSxS、Recovery、node_modules、.git 与 Recent（Recent 交给 recent 源）；不跳 Prefetch，管理员运行时同一 .pf 可能与 prefetch 重复上报
- usn（USN → usn.js）→ usn / 不可删 / 管理员 / 所有盘 / ②（仅所有盘零命中才报，有命中则静默）；fsutil usn readjournal <vol> csv 流式解析；字段按下标取 f[0]=USN、f[1]=文件名、f[3]=reason、f[4]=reasonText、f[5]=时间、f[8]=FileId、f[9]=ParentFileId（错位不会报错、只表现为匹配不到）；Error 5=无权限文本（无专门分支，仅作为错误消息），Error 1179=无日志（搜索按空结果处理）；extra 契约见「架构约定」
- recyclebin（回收站 → recyclebin.js）→ recycle / 可删 / 普通 / 所有盘的 $Recycle.Bin（其他 SID 可能无权限）/ ③④；$I 偏移 24 起 UTF-16 原始文件名（上限 520 字节），配对同目录 $R + 随机名；extra.dataPath 可能为 null
- recent（最近访问 → recent.js + jumplist.js）→ lnk、jumplist / 可删 / 普通 / 仅当前用户（os.homedir() 的 Recent）/ ③④；.lnk 只对文件名 re.test（内容仅用于提取 target，宽松 UTF-16 + 清洗首尾控制字符/反引号）；跳转列表合并后 source 覆盖为 recent，删除整个文件会清掉该应用全部最近记录；extra.target 是保留字段，前端不展示、delete 不读
- registry（注册表 → registry_full.js）→ registry、registry_key / 值可删、键名不可删 / 普通 / HKLM/HKCU/HKU/HKCC；HKU 用 %SystemRoot%\System32\whoami.exe /user 取当前 SID 跳过（须用完整路径，MSYS 的 GNU whoami 不支持 /user）；HKLM 只导出子键（HKLM 与 HKLM\SOFTWARE 自身的值不在导出范围，改 SPLIT_KEYS 前确认父键没有字符串值）；HKCR 是 HKLM\Software\Classes 别名不单独导出，SECURITY 导出失败，SAM 只有键行 / ①③④；reg export 到 os.tmpdir()/clear-filename-reg 缓存 5 分钟，HKLM 用 12 并发进程池（再拆更慢）；快路径逐文件整体读入内存后 UTF-16 扫描，慢路径 slowScan 流式；双路字面预扫：原文命中 REG_SZ、UTF-16 hex 前 8 字符命中 hex 数据（REG_BINARY / EXPAND_SZ / MULTI_SZ，按小写 hex 匹配，依赖 reg export 输出小写，实测成立）；匹配对象是值名 + 值数据；valueText 解 REG_SZ、REG_BINARY 与 hex(2)/hex(7)（EXPAND_SZ/MULTI_SZ），hex(4)/hex(b) 等数值类型不参与；预筛字面只取「所有匹配文本都必然包含」的片段：整串外层括号先剥掉再按顶层 | 拆分，分组内 | 只作废组内字面，? * {0,n} 丢弃前一个字符，断言内部跳过，\d \x \u \c \p \k 等转义整段跳过，提不出可靠字面时整源退化为 slowScan（实测 477MB 缓存约 295s，慢但不会漏）；缓存过期时并发搜索各自 rmSync 重建，先到的请求可能正在 readFileSync 时文件被删 → 整源抛错（①）；导出全部失败时 ensureExports 仍写 STAMP，5 分钟内视为有效缓存、搜索返回空且不重试（③）；fileOf 把非法文件名字符 \ / : * ? " < > | 全部替换为 _，键名自身含 _ 时可能撞文件名（如 Foo_Bar 与 Foo\Bar 都成 Foo_Bar），后导出覆盖先导出（④）；stripOuterGroup/skipGroup/jumpTo/splitBranches/longestLiteral 与 searchindex.js 各一份拷贝（仅注释不同），改一处必须同步；预筛只影响性能，不影响结果正确性，宁可退化为全量扫描也不能用不可靠字面
- searchindex（搜索索引 → searchindex.js）→ index / 不可删 / 普通 / SYSTEMINDEX：只 SELECT System.ItemPathDisplay，System.FileName 仅用于 WHERE 的 LIKE 预筛，JS 再按 basename 确认（目录段命中会漏）/ ①③（超时 → ①，PowerShell 脚本/查询失败 → ③）；纯元字符或字面不可靠的正则退化为全量遍历（300s 超时）；预筛字面提取规则与 registry 同一份拷贝，只影响性能不影响结果；escapeLike 转义 % _ [ 单引号与 PowerShell 的 ` " $，双引号/反引号/$ 不再失效（详见「架构约定」）
- appmru（IDE → appmru.js + jetbrains.js）→ appmru / 不可删 / 普通 / 仅当前用户的 VSCode（storage.json、state.vscdb）、Notepad++（session.xml、config.xml）与 JetBrains 配置（递归 *.xml，单文件 50MB，无文件数上限）/ ④；UTF-8 解码含 NUL 时改 UTF-16；JetBrains 条目 source 覆盖为 appmru；配置文件不自动改写
- browserdl（浏览器 → browserdl.js）→ browserdl / 不可删 / 普通 / 仅当前用户 Chrome/Edge 全部 Profile 的 History / ④（被占用跳过）；SQLite 整库当 UTF-8 文本扫描，会命中 URL 与下载路径；片段清洗后取前 5 条（参数见「架构约定」）
- amcache（Amcache → amcache.js）→ amcache / 不可删 / 管理员 / 硬编码 C:\Windows\AppCompat\Programs\Amcache.hve（系统盘非 C: 时永远空）/ ②（EPERM/EACCES）③（其他读取错误）；二进制 hive 按 UTF-16LE 扫描，片段需清洗伪字符（参数见「架构约定」）
- prefetch（Prefetch → prefetch.js）→ file / 可删 / 管理员 / 硬编码 C:\Windows\Prefetch\*.pf（系统盘非 C: 时永远空）/ ③；文件名"可执行名-哈希.pf" + 内嵌 UTF-16 路径都参与匹配；无权限时 readdir 失败返回空
- eventlog（事件日志 → eventlog.js）→ eventlog / 不可删 / Security 需管理员 / Security 4656/4660/4663 的 ObjectName + Application 全量消息 / ②③；两个日志两个 PowerShell 进程并行（180s），用 List[object] 收集（数组 += 在数万条下 O(n²)）；Get-WinEvent"无匹配事件"按空处理；任一日志拿到 rows 时另一日志的错误被静默丢弃，两边都无 rows 且有 Error 才返回 ②；脚本整体失败被 catch 吞掉，表现为 0 条
- filemgr（文件管理器 → filemgr.js）→ appmru / 不可删 / 普通 / 仅当前用户 Total Commander wincmd.ini / ④；文本 matchAll，不自动改写
- evrun（Everything 历史 → evrun.js）→ evrun / 可删 / 普通 / `%APPDATA%\Everything\Run History.csv`（Everything 打开过的文件路径）/ ③；每行 `"路径",运行次数,时间`，按 CSV 首列 re.test；删除按完整路径移除该行，需先退出 Everything（运行中其退出时会用内存数据覆盖）
- chromedl（下载记录库 → chromedl.js）→ chromedl / 可删 / 普通 / Chrome、Edge 全部 Profile 的 `User Data\<Profile>\shared_proto_db\*.log|*.ldb`（LevelDB 里的下载路径 protobuf）/ ③；UTF-16LE 双偏移 + UTF-8 兜底解码，binscan 提取路径并截断二进制尾巴；删除为整库文件 unlink，浏览器占用时失败
- wpsqing（WPS 云同步 → wpsqing.js）→ wpsqing / 可删 / 普通 / `%LOCALAPPDATA%\kingsoft\WPS Cloud Files\userdata\qing\qing.db`（云同步映射库，SQLite UTF-16LE）/ ③；已删除行的字符串残留在空闲页，SQL 查不到，只能扫库；删除为删除整个 qing.db（WPS 重建）
- qqpcdlp（电脑管家记录 → qqpcdlp.js）→ qqpcdlp / 可删 / 普通 / `C:\ProgramData\Tencent\QQPCMgr\QMDLPList.xml`（文件扫描记录，含路径/MD5/时间）/ ③；解析 `<DLPElement>` 块取 `<File path>`，同一路径的多次扫描只列一条；删除按路径移除全部同名块（需先退出电脑管家，否则其保存时会重写）

## 架构约定

- 搜索源模块导出 `search(re)`，返回统一条目结构：`{ source, kind, name, location, match, deletable, deleteHint, extra }`；`id`（source:序号）与 `sourceLabel` 由 server.js 注入，来源不要自己造 id。
- 新增搜索源五步：lib/search/ 新文件（文件名不必与 key 同名，registry 即 registry_full.js）→ server.js 的 SEARCHERS + SOURCE_LABELS 注册 → public/index.html 加来源勾选（默认 checked，即新来源对所有用户默认开启）→ 在「来源一览」补一行（kind/可删/权限/覆盖范围/失败策略/机制与坑）→ 同步 README.md 功能列表；前端 data-source 与 SEARCHERS key 必须同名，不一致会被 server 静默丢弃，该来源永不执行。
- 新增系统级清理四步：lib/system.js 的 switch 加命令 → public/index.html 加按钮 → public/app.js 的 SYS_OPS 加 [选择器, op, 二次确认文案] → 同步 README.md。
- 新增可删 kind 三步：lib/delete.js 的 switch 加分支（参数只能来自 location/extra）→ 在本文补充该 kind 的 extra 契约 → 同步 README.md 删除行为。
- 搜索源只读，不执行删除；删除所需全部信息（location、extra）随条目回传，前端原样回传。
- kind 与 delete.js 的 switch 分支是硬耦合：deletable=true 而 kind 没有对应分支时，搜索阶段完全正常，点删除才报"该类型不支持直接删除"，链路上没有任何静态校验。
- 删除按 kind 分发：file/lnk/jumplist → unlink（只需 location）；recycle → 删 $I（location）+ $R 配对（extra.dataPath，可缺省）；registry → PowerShell 删值并尽力重写 MRUListEx（必须 extra.regPath + extra.valueName，缺失报"缺少定位信息"；valueName 为空（@= 默认值）会通过 undefined 检查，PowerShell -Name '' 很可能失败；Remove-ItemProperty 带 -ErrorAction SilentlyContinue，任何删除失败（默认值、值已不存在、路径失效）都被吞掉，脚本末尾固定输出 ok，回执一律报成功；MRUListEx 只在值名等于序号文本时移除该项，否则原样重写并补 -1；重写失败被 catch 吞掉，不影响值删除）；prefetch 复用 kind='file'（删的是 .pf 文件，需管理员）；其余 kind（usn / index / eventlog / amcache / appmru / browserdl 等）走 default 分支报「不支持直接删除」；删值后 invalidateCache 清空导出缓存，下一次搜索需重新全量导出
- 来源失败策略，新增来源必须明确选一种（「来源一览」逐源标注）：① 抛错 → server 兜底生成 kind='error' 条目（id=source:error，deletable=false）；② 自行返回 kind='error' 条目（usn 全部盘零命中且出错、amcache EPERM/EACCES、eventlog 两边都无 rows 且有 Error；id 由 server 注入为 source:序号）；③ 整体静默返回空（prefetch 无权限；searchindex 的 PowerShell 脚本/查询失败时 psStream 不 reject，也表现为 0 条，超时除外；文件/目录本就不存在不算失败，不计入 ③）；④ 部分失败静默丢数据（registry 的 exportOne 失败、filesystem 无权限目录 readdir 失败即 continue、recent/recyclebin/browserdl/appmru/jetbrains/filemgr 逐文件 try/catch continue）；⑤ 整块静默丢失（filesystem 单盘 worker error / exit≠0 直接返回空，该盘数据无提示消失；权限不足只是逐目录 continue）。只有 ①② 前端会标「失败」，③④⑤ 界面完全无感，排查只能靠条目数对比
- searchindex 把用户正则的字面片段经 escapeLike 拼进 PowerShell 双引号字符串（$cmd.CommandText = "SELECT ... ${where}"）；escapeLike 做两层转义：SQL LIKE 的 % _ [ 与单引号，以及 PowerShell 双引号字符串里的 ` " $（反引号转义），字面片段可安全嵌入；改动拼接口径时必须同时验证这两层，否则会静默 0 条或漏匹配
- matchAll 的条数与片段长度按源不同：默认 (max=50, half=60)；amcache/browserdl 用 (20, 80)；eventlog 用 (10, 60)；registry 用 (3, 60)。改片段展示前先确认该源的调用参数。
- extra 契约（前端原样回传，delete.js 按 kind 读取）：registry → { regPath, valueName }；recycle → { dataPath }（可能为 null）；recent 的 lnk 条目 → { target }（跳转列表条目无 extra）、usn → { drive, usn, reason, reasonText, time, fileId, parentFileId } 是保留字段，前端不展示、delete.js 不读；registry_key（命中键名）deletable=false 且无 extra；evrun → { historyFile }（CSV 路径，location 是记录的文件路径，删除时按它匹配行）；chromedl → { browser, profile }（保留字段）；wpsqing 无 extra；qqpcdlp → { listFile }（记录文件路径）；其余 kind 无需 extra。
- deletable=false 的条目前端不可勾选，原因统一写在 deleteHint（索引随删除自动清除、配置文件不自动改写、日志无法单条删除、hive 需整体重置等）。
- 前端表格 7 列：勾选 / 来源(sourceLabel) / 名称 / 位置 / 匹配片段 / 删除方式(deleteHint) / 状态；状态徽章按 kind='error' → 失败、deletable → 可删除、其余 → 手动处理；只有 deletable 行有勾选框，全选只作用于已渲染的可删除行（分批渲染，每批 200 条）；删除成功后前端只把成功项从本地列表移除并重渲染（不重新搜索），并把 total 改成剩余条数、清掉 truncated 标记（界面计数会小于原始搜索结果）；失败项保留。
- match 片段生成（appmru/jetbrains/filemgr/browserdl/amcache/eventlog/registry）统一走 lib/textmatch.js 的 matchAll（限条数 + 上下文片段）；registry 的扫描本身走 pushByNeedle 字面预扫 / slowScan 逐行 + re.test，不经 matchAll；recent 只对 .lnk 文件名 re.test（.lnk 内容仅用于提取 target），jumplist/prefetch 是 UTF-16 片段扫描 + re.test，同样不走它。matchAll 必须克隆带 g 的正则（不克隆时 exec 每次返回同一匹配，会重复收集同一片段 max 次而非遍历后续匹配）；零宽匹配必须手动推进 lastIndex（m.index === g.lastIndex 时 ++）防死循环；克隆只保留 i 并强制加 g。
- 所有来源共享同一个 RegExp 对象（flags 只有 i/空，不带 g，lastIndex 不变），不得依赖或修改 lastIndex；filesystem 把 source/flags 传给 worker 线程，由 worker 内自建 RegExp。

## Windows 环境要点（踩坑记录）

- PowerShell 传中文必须走 lib/ps.js 的 -EncodedCommand（UTF-16LE Base64），命令行直传被按 GBK 解码乱码；脚本第一条语句必须是 `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)`，且必须在任何输出之前（先输出再赋值不生效）。脚本前不能加 BOM：BOM 会粘住第一条语句使其静默失败（错误只进 stderr、退出码仍为 0），曾致 eventlog 首行的编码赋值失效、中文全变成 U+FFFD 替换字符。不要为"无头运行"另加 chcp 或 $OutputEncoding
- PowerShell 5.1 写法：泛型 List 新代码统一用 `[System.Collections.Generic.List[object]]::new()`（lib/delete.js 仍用 `New-Object System.Collections.Generic.List[int]`，两种写法实测都正常，不必为"统一"改无关代码）；哈希表字面量的条目之间只能用分号或换行分隔，用逗号（`@{ Log = 'A', Text = ... }`）会整段语法错误；条目用分号/换行分隔时 `Text = $x -replace "\r\n", ' | '` 不加括号也能正常解析
- ps.js 只按退出码判成败：psScript 成功时丢弃 stderr（常含 CLIXML 进度记录），失败时用 stderr 作错误消息（空则退回 err.message）；psStream 仅当退出码非 0 且 stderr 为空才 reject，实际几乎不 reject，失败会表现为 0 条结果
- 系统命令（fsutil/vssadmin/cipher/wevtutil）经 cmd.exe 前置 chcp 65001 转 UTF-8 输出；退出码是成功与否的权威依据，stderr 可能是英文或 GBK
- registry 快路径把每个 .reg 逐个 readFileSync 后整体转 UTF-16 文本再扫（串行、峰值数百 MB），slowScan 才是流式，新增来源不要照搬这种整文件读入
- 实测基线（随机器与已装软件变化，仅供参考）：全量导出约 40 个 .reg / 477MB，HKLM 拆分后约 6s；SAM 导出只有文件头 + 键行（约 138B，无值数据），SECURITY 无导出文件

## 修改约束

- 保持现有风格：CommonJS、原生前端、零新依赖；2 空格缩进、单引号、语句带分号、注释与 UI 文案用中文（SOURCE_LABELS 全中文）
- 正则语义：用户输入即 JS 正则源码，直接 new RegExp，不转义、不加输入校验；默认追加 i 标志（前端"忽略大小"可关闭），不存在 u/s/m/y 标志
- 只改要求范围；不创建测试文件/测试配置
- 改用户可见行为（来源、删除方式、系统清理、限制）须同步 README.md：它面向用户讲怎么用，本文讲实现与坑
