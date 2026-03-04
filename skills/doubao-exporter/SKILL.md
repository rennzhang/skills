---
name: doubao-exporter
description: |
  从豆包（Doubao）分享链接导出对话内容为 Markdown + 图片。
  适用场景：团队使用豆包做会议记录后，将会议总结导出为结构化文档供 AI 分析或归档。
  触发关键词："导出豆包"、"豆包会议记录"、"下载豆包对话"、提供 doubao.com/thread/ 链接。
  主路径为纯 HTTP 提取（零依赖），浏览器自动化作为备选方案。
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

# Doubao Exporter - 豆包对话导出

从豆包分享链接自动提取对话内容，导出为 Markdown + 图片，适用于会议记录存档和 AI 分析。

## 触发条件

当用户消息中包含以下内容时触发：

- 豆包分享链接（`doubao.com/thread/...`）
- "导出豆包"、"豆包对话"、"豆包会议记录"
- "把豆包的内容下载下来"、"保存豆包对话"

## 前置要求

- Node.js >= 18（仅此一项，主路径无其他依赖）

## 工作流程

### Path A：HTTP 直接提取（推荐）

豆包分享页是 SSR 渲染，对话数据以 JSON 形式嵌入在 HTML 的 `data-fn-args` 属性中，可通过纯 HTTP 请求提取，无需浏览器。

**步骤：**

1. 运行导出脚本：

```bash
node <skill-dir>/scripts/export-doubao-share.mjs <url> [--output <dir>] [--title <name>] [--keep-empty]
```

2. 脚本自动完成：
   - HTTP 请求获取分享页 HTML
   - 解析 `data-fn-args` 属性中的 SSR JSON 数据
   - 提取 `share_info`（标题、分享者）和 `message_snapshot`（对话列表）
   - 自动过滤无文本且无图片的空消息（可用 `--keep-empty` 关闭）
   - 消息内容已是 Markdown 格式，无需额外转换
   - 下载图片到 `assets/`（如有）
   - 生成 `index.md`

**参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `<url>` | 是 | 豆包分享链接，格式：`https://www.doubao.com/thread/xxx` |
| `--output <dir>` | 否 | 输出目录。默认：`.doubao-exports/{title}/` |
| `--title <name>` | 否 | 自定义标题。默认从分享数据提取 |
| `--keep-empty` | 否 | 保留空消息。默认会过滤无文本且无图片的消息 |

**示例：**

```bash
# 导出会议记录
node <skill-dir>/scripts/export-doubao-share.mjs https://www.doubao.com/thread/a7311745f6b2a --title "产品评审会议"

# 指定输出目录
node <skill-dir>/scripts/export-doubao-share.mjs https://www.doubao.com/thread/a7311745f6b2a --output ./meeting-notes/q1-review
```

### Path B：浏览器自动化（备选）

当 Path A 失败时（如豆包页面结构变更、SSR 数据不再内嵌、反爬限制等），使用浏览器自动化作为备选。

**优先级**：`agent-browser` → `chrome-devtools` MCP

**方式 1：agent-browser**

需先安装：`pnpm add -g agent-browser` 或 `npm install -g agent-browser`

```bash
agent-browser open "<url>"
agent-browser wait --load networkidle
# 使用 agent-browser eval 执行 JS 提取消息内容
```

**方式 2：chrome-devtools MCP**

当 agent-browser 也不可用时，AI 使用 chrome-devtools MCP 工具手动完成：

1. **打开页面**：使用 `navigate_page` 打开豆包分享链接
2. **等待加载**：使用 `evaluate_script` 检查页面是否加载完成
3. **滚动加载全部消息**：执行滚动脚本直到消息不再增加
4. **逐批提取内容**：执行提取脚本（参考 `references/extraction-snippets.md`）
5. **下载图片**：使用 `curl` 下载图片到本地
6. **生成 Markdown**：使用 Write 工具将提取的内容写入 `index.md`

> 详细的 JS 提取函数见 `references/extraction-snippets.md`

## 输出结构

```
<output-dir>/
├── index.md          # 对话 Markdown（含图片引用和 YAML 前置元数据）
└── assets/           # 图片资源
    ├── msg-12-1.jpg
    └── msg-51-2.png
```

**index.md 格式：**

```markdown
---
source: doubao
title: "会议标题"
url: "https://www.doubao.com/thread/xxx"
exported: 2026-03-04
message_count: 42
---

# 会议标题

## User

用户的提问或指令...

---

## Doubao

豆包的回复内容（Markdown 格式）...

![image-1](assets/msg-3-1.jpg)

---
```

## 输出目录策略

| 条件 | 输出目录 |
|------|---------|
| 默认 | `.doubao-exports/{title}/`（项目级） |
| 用户指定 `--output` | 用户指定的路径 |

## SSR 数据结构说明

豆包分享页基于 Modern.js SSR，关键数据路径：

```
HTML → <script data-fn-args="..."> (第二个)
  → JSON: ["thread_(token)/page", "shareInfo", { data: { share_info, message_snapshot } }]
    → share_info: { share_id, share_name, user: { nick_name } }
    → message_snapshot.message_list[]: { content (JSON string), user_type (1=用户/2=AI), content_type }
      → JSON.parse(content).text → Markdown 格式的对话内容
```

## 已知限制

- 分享链接必须是公开可访问的（`doubao.com/thread/` 格式），不支持需要登录的对话
- 图片 URL 带时间签名，过期后无法重新下载，导出后图片保存在本地
- 如豆包调整 SSR 数据嵌入方式，Path A 可能失效，需切换到 Path B

## 注意事项

- 导出前确认分享链接可正常打开
- 建议为每次导出指定有意义的 `--title`，便于后续检索
- 导出完成后可直接将 `index.md` 交给 AI 分析会议要点、提取待办事项等
