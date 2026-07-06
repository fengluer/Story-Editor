# Story Editor

A local branching story table editor with CSV/XLSX import and export, table editing, draggable node editing, script preprocessing, validation highlights, multilingual UI, and Electron desktop packaging.

[中文说明](./README.md)

## Download

- [Download portable build](https://github.com/fengluer/Story-Editor/releases/latest/download/Story-Editor-portable-latest.zip)
- [Download installer](https://github.com/fengluer/Story-Editor/releases/latest/download/Story-Editor-installer-latest.exe)
- [View all releases](https://github.com/fengluer/Story-Editor/releases)

For the portable build, unzip it and run:

```text
win-unpacked/Story Editor.exe
```

## Features

- Import and export story tables as CSV/XLSX.
- Switch between Chinese and English UI.
- Supports the four-row table header format: field key, type, label, and export channel.
- Table mode for fast editing of role, position, content, background image, and other fields.
- Node mode for editing parent and skip relationships with draggable nodes and links.
- Script preprocessing: copy Scene / Role / Content columns from Excel and generate story nodes.
- Validation panel:
  - Story structure validation.
  - Per-row character limit validation; empty means disabled. Over-limit nodes are highlighted red.
  - Content line break validation. When enabled, nodes whose content contains line breaks are highlighted red.
  - Right-side role validation, such as `$player`. Invalid nodes are highlighted yellow.
- Success toasts after saving, exporting CSV, or exporting XLSX.
- Local draft auto-save every 3 minutes by default.
- Build as an installer or a portable desktop package.

## Quick Start

### For Users

1. Download the portable zip.
2. Unzip it anywhere.
3. Run `Story Editor.exe`.
4. Click Import to load a CSV/XLSX story table, or start by adding nodes.

### For Development

Install Node.js first.

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

On Windows, you can also double-click:

```text
start-editor.cmd
```

## Story Table Format

The editor recognizes CSV/XLSX tables like this:

```text
id,isBegin,sign,parent_id,bgmPath,role,roleID,boxPos,content,mp3Path,backPic,skip,failSkip,reward
int,string,string,int,string,string,string,string,string,string,string,int,string,string
子ID,起始点,标志,父ID,背景BGM,人物#Lang,人物ID,位置,对话内容#Lang,MP3路径,背景图片,跳转,失败跳转,奖励
c/s,c,c,c,c,c,c,c,c,c,c,c,c,c/s
```

Common fields:

- `id`: Node ID.
- `isBegin`: Use `TRUE` for the starting node.
- `sign`: Node type. Dialogue is `#`, choice is `&`, end is `END`, reward is `$`.
- `parent_id`: Parent node ID.
- `role`: Role name.
- `roleID`: Character ID.
- `boxPos`: Position. Left is `l`, right is `r`.
- `content`: Dialogue or choice text.
- `backPic`: Background image.
- `skip`: Target node ID.
- `reward`: Reward configuration.

## Usage

### Language Switch

Use the language toggle on the right side of the toolbar to switch between Chinese and English. The choice is saved locally.

### Table Mode

Table mode is best for editing many fields quickly. Click the row number to select a node. Use the node bar at the bottom to add dialogue, choice, reward, or end nodes.

When adding nodes, the editor automatically maintains common linear `parent_id` and `skip` links. In table mode, newly added nodes are scrolled into view.

### Node Mode

Node mode is best for editing branching logic.

- Drag a node header to move a node.
- Pan the canvas with the middle mouse button, or use two-finger trackpad scrolling.
- Drag from a node's link handle to a target node to set skip and parent relationships.
- If the target is a choice node, all options in the same group are linked. The table uses the option with the smaller ID as the skip target.
- Node buttons at the top are drag handles in node mode. Dragging out a new node does not auto-connect it.

### Script Preprocessing

Copy three columns from Excel:

```text
Scene   Role     Content
bg_room $player  You wake up.
bg_room Narrator The room is quiet.
```

Click Preprocess to generate dialogue nodes:

- Column 1 writes to `backPic`.
- Column 2 writes to `role`.
- Column 3 writes to `content`.
- If the role is `旁白` or `旁白：`, `role` is left empty, but content is still written.
- Rows without content are skipped.

### Validation

The validation panel lists structure and content issues, and highlights matching rows/nodes.

- Character limit per row: enter a number to enable it; clear the input to disable it. Over-limit nodes are highlighted red.
- Content line break check: when enabled, nodes whose `content` contains line breaks are highlighted red.
- Right-side role check: for example, enter `$player`. All nodes whose `role` contains `$player` must use `boxPos = r`. Empty disables the check. Invalid nodes are highlighted yellow.

### Save and Export

- Drafts are saved locally.
- Click Save Progress to save manually. A success toast is shown after saving.
- Click CSV or XLSX to export the current story table. A success toast is shown after export.

## Packaging

Double-click:

```text
package-release.cmd
```

Then choose:

```text
1) Installer
2) Portable
```

Or use commands:

```bash
npm run release
npm run release:installer
npm run release:portable
```

Outputs are written to `release/`:

```text
Story-Editor-installer-YYYYMMDD-HHmmss.exe
Story-Editor-installer-latest.exe
Story-Editor-portable-YYYYMMDD-HHmmss.zip
Story-Editor-portable-latest.zip
```

When publishing a GitHub Release, upload `Story-Editor-portable-latest.zip` and `Story-Editor-installer-latest.exe` so the README download links always point to the latest version.

## Verification

```bash
npm run test
npm run build
```

## Open Source Notes

This project is open source under the MIT License. You may freely use, copy, modify, merge, publish, distribute, sublicense, or sell copies of this project, as long as the original copyright notice and license notice are preserved.

See [LICENSE](./LICENSE) for the full license text.
