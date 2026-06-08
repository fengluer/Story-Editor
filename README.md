# 剧情编辑器

纯前端本地剧情表编辑器，支持导入 CSV/XLSX、编辑剧情节点、批量替换文本、配置表头模板，并按四行元数据结构导出 CSV/XLSX。

编辑进度会保存到浏览器本地存储。页面打开后会自动恢复上次草稿，也可以点击“保存进度”手动保存。

## 开发运行

```bash
npm install
npm run dev
```

打开 `http://localhost:5173/`。

Windows 下也可以直接双击 `start-editor.cmd` 一键启动服务。

## 验证

```bash
npm run test
npm run build
```

测试覆盖样表解析、CSV/XLSX 回读、批量替换、模板字段扩展和样表引用校验。
