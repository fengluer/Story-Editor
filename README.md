# Story Editor

Story Editor 是一个本地运行的分支剧情表编辑器，用于编写、整理和校验游戏对话、互动叙事及多分支剧本。

项目同时提供表格编辑与可视化节点编辑，支持 CSV/XLSX 导入导出、剧本预处理、本地草稿、结构校验，以及由“上帝 AI + 独立角色 AI”协作完成的场景编写。

[English README](./README.en.md)

## 下载

- [下载免安装版](https://github.com/fengluer/Story-Editor/releases/latest/download/Story-Editor-portable-latest.zip)
- [下载安装包](https://github.com/fengluer/Story-Editor/releases/latest/download/Story-Editor-installer-latest.exe)
- [查看全部 Release](https://github.com/fengluer/Story-Editor/releases)

免安装版解压后运行：

```text
win-unpacked/Story Editor.exe
```

## 适用场景

- 游戏任务和角色对话编辑。
- 视觉小说、互动小说和分支叙事制作。
- 以 CSV/XLSX 作为交付格式的剧情数据维护。
- 已有剧情表的结构检查、批量修订和格式转换。
- 根据人物设定、场景状态和故事大纲生成一幕连续剧情。

## 核心功能

### 表格编辑

表格模式适合快速查看和修改剧情数据：

- 直接编辑节点 ID、父节点、角色、人物 ID、对话位置、正文、背景图和跳转目标等字段。
- 添加对话、选项、奖励和结束节点。
- 在线性剧情中自动维护常用的 `parent_id` 与 `skip` 关系。
- 删除节点后自动修复相关线性跳转。
- 选中节点后在侧栏查看类型、角色、位置、字数和正文预览。

### 节点编辑

节点模式用于直观处理剧情分支：

- 以可拖动节点展示剧情结构。
- 拖出连线即可设置节点跳转和父子关系。
- 支持选项组、分支首句和共同后续节点。
- 支持中键拖动画布及触控板双指移动。
- 节点位置保存在本机，重新打开时继续使用原有布局。

### 分支与节点类型

编辑器内置常见剧情节点操作：

- 普通对话节点。
- 多选项分支节点。
- 奖励节点。
- 结束节点。
- 向现有选项组追加新选项。

添加节点时，编辑器会尽量自动完成父节点、跳转目标、分支入口和汇合节点的绑定，减少手工填写 ID 的工作量。

### 导入与导出

- 导入 CSV 或 XLSX 剧情表。
- 将当前内容导出为 CSV 或 XLSX。
- 支持拖放文件导入。
- 保留四行表头中的字段类型、中文说明和导出端标记。
- 可编辑并保存自定义字段模板。

### 剧本预处理

可以从 Excel 复制“场景、角色名、正文”三列，然后一键转换为连续剧情节点。

```text
场景       角色名      正文
bg_room    $player     你醒了。
bg_room    旁白        房间里很安静。
```

转换规则：

- 第 1 列写入 `backPic`。
- 第 2 列写入 `role`。
- 第 3 列写入 `content`。
- `旁白` 和 `旁白：`只写正文，不写角色名。
- 正文为空的行会被忽略。

### 内容替换

- 在剧情字段中批量查找和替换文本。
- 支持普通文本和正则表达式。
- 可撤销最近一次批量替换。

### 校验与高亮

编辑器会汇总结构和内容问题，并在表格及节点视图中标出对应节点：

- 检查起始节点、结束节点、父节点和跳转关系。
- 检查重复或无效的节点 ID。
- 设置每行正文的字数上限，留空时关闭该项检查。
- 检查正文中的换行符。
- 检查指定角色是否位于右侧，例如要求 `$player` 使用 `boxPos = r`。
- 对错误和警告使用不同颜色高亮。

### 草稿与本地状态

- 默认每 3 分钟自动保存草稿。
- 支持手动保存当前进度。
- 草稿、模板、节点位置、语言和校验偏好保存在本机。
- 保存和导出成功后提供明确提示。

### 中英文界面

工具栏可以在中文和英文之间切换，语言选择会保存在本机。

## AI 场景编写

AI 编写采用“上帝 AI 负责全局导演，角色 AI 只负责自身行动”的结构。它不是让单个模型一次性续写全文，而是按轮次维护场景、信息边界和角色状态。

### 工作方式

每一轮生成包含两个阶段：

1. 上帝 AI 阅读故事背景、大纲、已有剧情、场景状态和角色私有设定。
2. 上帝 AI 选择当前行动角色，并分别分配各角色实际能看到、听到或收到的信息。
3. 被选中的角色 AI 只根据自身人设、目标、秘密、记忆和已知信息作出行动。
4. 角色可以说话、执行动作、移动到其他场景或保持沉默。
5. 有效行动会转换为剧情节点，并进入下一轮上下文。

角色不会因为某段文字出现在剧本中就自动知道它。其他角色的秘密、内心、私下行为和不同场景发生的事情，只有经过合理观察或消息传递后才能进入该角色的认知。

### AI 配置

在“AI 设定”中可以配置：

- Provider、协议、Base URL、API Key 和模型清单。
- 全局默认模型，以及上帝 AI 和各角色的专用模型。
- 故事背景与大纲，包括世界观、时代背景、核心冲突、关键节点和整体走向。
- 角色名、人物 ID、人设、说话风格、私人目标、动机、秘密和初始记忆。
- 场景名称、背景图字段、环境描述、开场状态和初始在场角色。

内置 OpenAI、OpenRouter、Ollama、LM Studio 和自定义 Provider 预设，支持：

- OpenAI Responses API。
- OpenAI-compatible Chat Completions API。

### 生成一幕剧情

点击“AI 编写”后选择：

- 起始场景。
- 本次导演要求，例如希望本幕发生的事件或需要避免的内容。
- 参考轮数，用于控制本幕的大致篇幅和节奏。

参考轮数必须填写大于 0 的整数。它不是固定输出轮数：当前互动可以提前结束，也可以为了完成动作少量延长。

AI 的结束标准是“当前一幕形成明确落点”，不要求整部故事完结。主线冲突、人物长期目标和部分悬念可以保留到后续幕；本幕只需完成当前互动，并通过结果确认、决定、后果、离场、转场或下一步目标形成自然结束。

### 生成控制

- 生成前检查角色、场景、模型和故事设定中的明显冲突。
- 实时显示当前轮次、行动角色和生成结果预览。
- 可以停止生成并保留已经产生的阶段性内容。
- 生成失败后可以重试。
- 预览确认后才会将节点写入编辑器。
- 可以清空 AI 事件、角色私有记忆、位置和当前视角，开始新的 Session。
- 清空 AI 记忆不会删除编辑器中已有的剧本节点。

### 数据与密钥

AI 模型调用仅在 Electron 桌面版中可用。浏览器开发模式可以编辑 AI 设定，但不会直接发送模型请求。

每个 Provider 的 API Key 由 Electron 使用操作系统加密能力保存，不会写入剧情 CSV、XLSX 或浏览器草稿。角色、场景和模型设定按当前剧情文件名保存在本机。

## 剧情表格式

默认剧情表使用四行表头：

```text
id,isBegin,sign,parent_id,bgmPath,role,roleID,boxPos,content,mp3Path,backPic,skip,failSkip,reward
int,string,string,int,string,string,string,string,string,string,string,int,string,string
子ID,起始点,标志,父ID,背景BGM,人物#Lang,人物ID,位置,对话内容#Lang,MP3路径,背景图片,跳转,失败跳转,奖励
c/s,c,c,c,c,c,c,c,c,c,c,c,c,c/s
```

常用字段：

| 字段 | 用途 |
| --- | --- |
| `id` | 节点唯一 ID |
| `isBegin` | 起始节点填写 `TRUE` |
| `sign` | 节点类型：对话 `#`、选项 `&`、结束 `END`、奖励 `$` |
| `parent_id` | 父节点 ID |
| `role` | 显示的角色名 |
| `roleID` | 稳定的人物 ID |
| `boxPos` | 对话框位置：左侧 `l`、右侧 `r` |
| `content` | 对话、旁白或选项正文 |
| `backPic` | 背景图片字段 |
| `skip` | 成功跳转目标节点 ID |
| `failSkip` | 失败跳转目标节点 ID |
| `reward` | 奖励配置 |

字段模板可以在编辑器内调整，因此项目也能处理包含额外业务字段的剧情表。

## 快速开始

### 桌面版

1. 下载免安装版或安装包。
2. 启动 `Story Editor.exe`。
3. 导入已有 CSV/XLSX，或直接添加第一个对话节点。
4. 使用表格模式编辑内容，使用节点模式整理分支。
5. 通过校验后导出 CSV 或 XLSX。

### 本地开发

需要安装 Node.js。

```bash
npm install
npm run dev
```

浏览器访问：

```text
http://localhost:5173/
```

启动包含 AI 调用能力的 Electron 开发环境：

```bash
npm run electron:dev
```

## 测试与构建

```bash
npm test
npm run build
```

构建桌面预览：

```bash
npm run electron:preview
```

## 发布桌面版

Windows 下可以运行：

```text
package-release.cmd
```

也可以使用命令：

```bash
npm run release
npm run release:installer
npm run release:portable
```

产物输出到 `release/`：

```text
Story-Editor-installer-YYYYMMDD-HHmmss.exe
Story-Editor-installer-latest.exe
Story-Editor-portable-YYYYMMDD-HHmmss.zip
Story-Editor-portable-latest.zip
```

## 技术栈

- React 19
- TypeScript
- Vite
- Electron
- SheetJS (`xlsx`)
- Vitest

## 开源协议

项目使用 [MIT License](./LICENSE)。你可以使用、复制、修改、合并、发布和分发本项目，但需要保留原始版权及许可证声明。
