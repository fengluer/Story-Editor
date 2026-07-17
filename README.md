# Story Editor

一个本地运行的分支剧情表编辑器，支持 CSV/XLSX 导入导出、表格编辑、节点连线编辑、剧本预处理、校验高亮、多语言界面和 Electron 桌面打包。

[English README](./README.en.md)

## 下载

- [下载免安装版](https://github.com/fengluer/Story-Editor/releases/latest/download/Story-Editor-portable-latest.zip)
- [下载安装包](https://github.com/fengluer/Story-Editor/releases/latest/download/Story-Editor-installer-latest.exe)
- [查看全部 Release](https://github.com/fengluer/Story-Editor/releases)

免安装版解压后运行：

```text
win-unpacked/Story Editor.exe
```

## 功能

- 导入和导出 CSV/XLSX 剧情表。
- 支持中文/英文界面切换。
- 支持四行表头格式：字段名、类型、中文说明、导出端标记。
- 表格模式：快速编辑角色、位置、正文、背景图片等字段。
- 节点模式：用可拖动节点和连线编辑父节点与跳转关系。
- 剧本预处理：从 Excel 复制“场景 / 角色名 / 正文”三列，一键生成剧情节点。
- 校验栏：
  - 节点结构校验。
  - 每行字数上限校验，留空则不校验；超限节点红色高亮。
  - 正文换行符校验，打开后包含换行符的节点红色高亮。
  - 指定人物必须在右侧的校验，例如 `$player`；不符合的节点黄色高亮。
- 保存、导出 CSV、导出 XLSX 成功后会显示成功提示。
- 本地自动保存草稿，默认每 3 分钟保存一次。
- 支持打包为安装包或免安装版。
- AI 编写：上帝 AI 分析场景、按角色分配可见/可听信息，再驱动相互隔离的角色 AI 生成剧情。

## 快速开始

### 普通使用

1. 下载免安装版 zip。
2. 解压到任意目录。
3. 双击 `Story Editor.exe`。
4. 点击“导入”选择 CSV/XLSX 剧情表，或直接开始添加节点。

### 开发运行

需要先安装 Node.js。

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:5173/
```

Windows 下也可以双击：

```text
start-editor.cmd
```

## 剧情表格式

编辑器默认识别这种 CSV/XLSX 表：

```text
id,isBegin,sign,parent_id,bgmPath,role,roleID,boxPos,content,mp3Path,backPic,skip,failSkip,reward
int,string,string,int,string,string,string,string,string,string,string,int,string,string
子ID,起始点,标志,父ID,背景BGM,人物#Lang,人物ID,位置,对话内容#Lang,MP3路径,背景图片,跳转,失败跳转,奖励
c/s,c,c,c,c,c,c,c,c,c,c,c,c,c/s
```

常用字段：

- `id`：节点 ID。
- `isBegin`：起始节点填写 `TRUE`。
- `sign`：节点类型，普通对话为 `#`，选项为 `&`，结束为 `END`，奖励为 `$`。
- `parent_id`：父节点 ID。
- `role`：角色名。
- `roleID`：人物 ID。
- `boxPos`：位置，左侧为 `l`，右侧为 `r`。
- `content`：正文或选项文本。
- `backPic`：背景图片。
- `skip`：跳转目标节点 ID。
- `reward`：奖励配置。

## 使用说明

### 语言切换

工具栏右侧提供语言切换按钮，可以在中文和英文界面之间切换。语言选择会保存到本机。

### 表格模式

表格模式适合批量编辑字段。点击左侧序号可以选中节点，点击底部节点栏可以新增对话、选项、奖励或结束节点。

新增节点时，编辑器会自动维护线性剧情常用的 `parent_id` 和 `skip`。在表格模式中添加节点后，页面会自动跳转到新增节点。

### 节点模式

节点模式适合编辑分支逻辑。

- 拖动节点标题栏可以移动节点。
- 按住中键拖动画布，或使用触控板双指拖动画布。
- 从节点上的“拖出连线”拖到目标节点，会自动设置跳转并绑定父节点。
- 如果目标是选项节点，会把同组选项一起连出来，表格中跳转目标使用 ID 较小的选项。
- 顶部节点按钮在节点模式中用于拖出新节点，新节点不会自动连线。

### 剧本预处理

从 Excel 复制三列内容：

```text
场景    角色名    正文
bg_room $player  你醒了。
bg_room 旁白      房间里很安静。
```

点击“剧本预处理”后会生成普通对话节点：

- 第 1 列写入 `backPic`。
- 第 2 列写入 `role`。
- 第 3 列写入 `content`。
- 如果角色名是 `旁白` 或 `旁白：`，不会写入 `role`，但正文仍会写入。
- 空正文行会跳过。

### AI 编写

AI 调用需要使用 Electron 桌面版；普通 `npm run dev` 网页模式可以编辑设定，但不会直接发送模型请求。

1. 点击顶部“AI 设定”。
2. 在“Provider 与模型”中添加 Provider，配置协议、Base URL、API Key 和模型清单，然后用 `provider/model` 选择默认模型。内置 OpenAI、OpenRouter、Ollama、LM Studio 和自定义预设。
3. 配置上帝 AI 的导演规则，并为每个角色填写人设、说话风格、私人目标、动机、秘密和初始记忆。
4. 添加场景并勾选现场角色。场景限制现场视觉和听觉；电话、短信等内容可以由上帝跨场景定向分配。
5. 点击“AI 编写”，选择场景、导演要求和生成轮数。

每轮先由上帝 AI 分析全局事实，决定每个角色分别能看到、听到或收到什么，再选择一个现场角色行动。角色新产生的台词和动作不会自动广播，要在后续轮次由上帝分配后，其他角色才会知道。角色也可以选择只行动或保持沉默；完全沉默不会写入空白剧情节点。

当前支持 OpenAI Responses 和 OpenAI-compatible Chat Completions 两种协议。每个 Provider 的 API Key 分别由 Electron 使用操作系统加密能力保存，不写入剧情 CSV、XLSX 或浏览器草稿。角色和场景设定按当前剧情文件名保存在本机。

### 校验

校验栏会显示结构问题和内容问题，并在表格/节点中高亮对应节点。

- “每行字数上限”：填写数字后启用字数校验；清空则关闭该校验；超限节点红色高亮。
- “正文换行符校验”：打开后，如果 `content` 正文包含换行符，对应节点会红色高亮。
- “人物靠右校验”：例如填写 `$player`，所有 `role` 包含 `$player` 的节点都必须是右侧 `boxPos = r`；留空则关闭该校验；不符合的节点黄色高亮。

### 保存与导出

- 草稿会自动保存到本机。
- 点击“保存进度”可以手动保存草稿，成功后会显示成功提示。
- 点击 `CSV` 或 `XLSX` 可以导出当前剧情表，成功后会显示导出成功提示。

## 打包

双击：

```text
package-release.cmd
```

然后选择：

```text
1) Installer
2) Portable
```

也可以用命令行：

```bash
npm run release
npm run release:installer
npm run release:portable
```

打包结果会输出到 `release/`：

```text
Story-Editor-installer-YYYYMMDD-HHmmss.exe
Story-Editor-installer-latest.exe
Story-Editor-portable-YYYYMMDD-HHmmss.zip
Story-Editor-portable-latest.zip
```

发布 GitHub Release 时，建议上传 `Story-Editor-portable-latest.zip` 和 `Story-Editor-installer-latest.exe`，这样 README 中的下载链接可以一直指向最新版。

## 验证

```bash
npm run test
npm run build
```

## 开源说明

本项目使用 MIT License 开源。你可以自由使用、复制、修改、合并、发布、分发、再授权或销售本项目副本，但需要保留原始版权声明和许可证声明。

完整许可证见 [LICENSE](./LICENSE)。
