# Chrome DevTools MCP 回退方案 - JS 提取函数

当 `agent-browser` 不可用时，AI 使用 `chrome-devtools` MCP 的 `evaluate_script` 工具执行以下 JS 函数完成导出。

## 1. 滚动加载全部消息

每次调用后等待 1.5 秒，重复执行直到消息数量连续 3 次不再增加。

```javascript
// 滚动到底部触发懒加载
(() => {
  const scroller = document.querySelector('.overflow-y-scroll');
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
  return document.querySelectorAll('[data-testid="send_message"], [data-testid="receive_message"]').length;
})()
```

## 2. 获取页面标题

```javascript
document.querySelector('[data-testid="thread_share_title"]')?.textContent || document.title
```

## 3. 滚动指定消息到可视区

用于触发图片懒加载。`INDEX` 替换为消息索引（从 0 开始）。

```javascript
(() => {
  const msgs = document.querySelectorAll('[data-testid="send_message"], [data-testid="receive_message"]');
  const target = msgs[INDEX];
  if (target) target.scrollIntoView({ behavior: 'instant', block: 'center' });
  return 'ok';
})()
```

## 4. 批量提取消息内容

`OFFSET` 和 `BATCH_SIZE` 替换为实际值（建议 BATCH_SIZE=5）。

```javascript
(() => {
  function htmlToMd(el) {
    if (!el) return '';
    function c(n) {
      if (n.nodeType === 3) return n.textContent;
      if (n.nodeType !== 1) return '';
      var t = n.tagName.toLowerCase();
      var ch = Array.from(n.childNodes).map(c).join('');
      switch(t) {
        case 'h1': return '# ' + ch.trim() + '\n\n';
        case 'h2': return '## ' + ch.trim() + '\n\n';
        case 'h3': return '### ' + ch.trim() + '\n\n';
        case 'h4': return '#### ' + ch.trim() + '\n\n';
        case 'p': return ch.trim() + '\n\n';
        case 'div':
          if (n.classList.contains('paragraph-element') || n.className.match(/paragraph-/))
            return ch.trim() + '\n\n';
          if (n.className.match(/md-box-line-break|wrapper-/)) return '';
          if (n.classList.contains('katex-display')) {
            var tex = n.querySelector('annotation[encoding="application/x-tex"]');
            return tex ? '$$\n' + tex.textContent + '\n$$\n\n' : ch;
          }
          return ch;
        case 'br': return '\n';
        case 'strong': case 'b': return '**' + ch + '**';
        case 'em': case 'i': return '*' + ch + '*';
        case 'code':
          if (n.parentElement && n.parentElement.tagName.toLowerCase() === 'pre') return ch;
          return '`' + ch + '`';
        case 'pre':
          var codeEl = n.querySelector('code');
          var lang = codeEl && codeEl.className ? (codeEl.className.match(/language-(\w+)/) || [])[1] || '' : '';
          var code = codeEl ? codeEl.textContent : ch;
          return '```' + lang + '\n' + code.trim() + '\n```\n\n';
        case 'ul': return ch + '\n';
        case 'ol': return ch + '\n';
        case 'li':
          var par = n.parentElement ? n.parentElement.tagName.toLowerCase() : 'ul';
          var idx = Array.from(n.parentElement.children).indexOf(n);
          var pfx = par === 'ol' ? (idx+1) + '. ' : '- ';
          return pfx + ch.trim() + '\n';
        case 'a': return '[' + ch + '](' + (n.getAttribute('href') || '') + ')';
        case 'blockquote': return '> ' + ch.trim().replace(/\n/g, '\n> ') + '\n\n';
        case 'hr': return '---\n\n';
        case 'img': return '__IMG_PLACEHOLDER__';
        case 'table':
          var rows = Array.from(n.querySelectorAll('tr'));
          if (!rows.length) return '';
          var lines = [];
          rows.forEach(function(row, ri) {
            var cells = Array.from(row.querySelectorAll('th, td'));
            lines.push('| ' + cells.map(function(cell) { return cell.textContent.trim(); }).join(' | ') + ' |');
            if (ri === 0) lines.push('| ' + cells.map(function() { return '---'; }).join(' | ') + ' |');
          });
          return lines.join('\n') + '\n\n';
        case 'span':
          if (n.classList.contains('katex')) {
            var t2 = n.querySelector('annotation[encoding="application/x-tex"]');
            return t2 ? '$' + t2.textContent + '$' : ch;
          }
          return ch;
        default: return ch;
      }
    }
    return c(el).trim();
  }

  var msgs = document.querySelectorAll('[data-testid="send_message"], [data-testid="receive_message"]');
  var batch = [];
  for (var i = OFFSET; i < Math.min(OFFSET + BATCH_SIZE, msgs.length); i++) {
    var m = msgs[i];
    var role = m.dataset.testid === 'send_message' ? 'user' : 'assistant';
    var contentEl = m.querySelector('[data-testid="message_text_content"]') || m.querySelector('.flow-markdown-body');
    var content = role === 'user' ? (contentEl ? contentEl.textContent.trim() : '') : htmlToMd(contentEl);

    var imgs = m.querySelectorAll('img');
    var imageUrls = [];
    for (var j = 0; j < imgs.length; j++) {
      var img = imgs[j];
      var imgSrc = '';
      if (img.srcset) {
        imgSrc = img.srcset.split(',')[0].trim().split(' ')[0];
      } else if (img.src && !img.src.startsWith('data:')) {
        imgSrc = img.src;
      } else if (img.currentSrc && !img.currentSrc.startsWith('data:')) {
        imgSrc = img.currentSrc;
      }
      if (imgSrc && !imgSrc.startsWith('data:')) {
        imageUrls.push(imgSrc);
      }
    }

    batch.push({ role: role, content: content, images: imageUrls });
  }
  return JSON.stringify(batch);
})()
```

## 5. DOM 兼容说明

豆包分享页有两套渲染模板：

| 模板 | 用户消息选择器 | AI 消息选择器 |
|------|---------------|--------------|
| coco | `[data-testid="message_text_content"]` | `[data-testid="message_text_content"]` |
| samantha | `[data-testid="message_text_content"]` | `.flow-markdown-body`（fallback） |

**图片懒加载处理**：
- `src` 初始为 SVG 占位符（`data:image/svg+xml,...`）
- 需滚动到可见区后从 `srcset` 取真实 URL
- `srcset` 可能包含多个尺寸，取第一个即可

## 6. AI 编排流程（Path B）

```
1. navigate_page → 打开豆包分享链接
2. 等待 2 秒
3. 循环：evaluate_script(滚动脚本) → 等待 1.5 秒 → 检查消息数 → 连续 3 次不变则停止
4. 循环（每 5 条一批）：
   a. evaluate_script(滚动到第 N 条) → 等待 1 秒
   b. evaluate_script(批量提取脚本) → 收集结果
5. 用 Bash curl 下载图片到本地
6. 用 Write 工具生成 index.md
```
