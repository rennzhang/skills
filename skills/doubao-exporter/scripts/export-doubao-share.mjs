#!/usr/bin/env node

/**
 * 豆包分享页导出工具
 * 通过 HTTP 直接抓取豆包分享页 SSR 数据，无需浏览器自动化
 *
 * 原理：豆包分享页是 SSR 渲染，对话数据以 JSON 形式嵌入在 HTML 的
 *       data-fn-args 属性中，可直接通过 HTTP 请求 + HTML 解析提取。
 *
 * 输出结构：
 *   <output-dir>/
 *   ├── index.md          # 对话 Markdown
 *   └── assets/           # 图片资源
 *       ├── msg-12-1.jpg
 *       └── msg-12-2.jpg
 *
 * 用法：
 *   node export-doubao-share.mjs <url> [--output <dir>] [--title <name>] [--keep-empty]
 *
 * 示例：
 *   node export-doubao-share.mjs https://www.doubao.com/thread/a7311745f6b2a --title "产品评审会议"
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import https from 'node:https';
import http from 'node:http';

// ═══════════════════════════════════════════
// 参数解析
// ═══════════════════════════════════════════

const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const url = args.find(a => a.startsWith('http'));
const outputDir = getArg('--output');
const customTitle = getArg('--title');
const keepEmpty = args.includes('--keep-empty');

if (!url) {
  console.error('用法: node export-doubao-share.mjs <豆包分享链接> [--output <目录>] [--title <标题>] [--keep-empty]');
  process.exit(1);
}

if (!url.includes('doubao.com/thread/')) {
  console.error('错误: 仅支持豆包分享链接 (doubao.com/thread/...)');
  process.exit(1);
}

// ═══════════════════════════════════════════
// HTTP 请求
// ═══════════════════════════════════════════

function fetch(targetUrl) {
  return new Promise((resolve, reject) => {
    const mod = targetUrl.startsWith('https') ? https : http;
    const req = mod.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 30000,
    }, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetch(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

// ═══════════════════════════════════════════
// HTML 解析：提取 SSR 数据
// ═══════════════════════════════════════════

function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

function extractShareData(html) {
  // 豆包分享页使用 Modern.js SSR，对话数据嵌入在 data-fn-args 属性中
  // SSR 响应有两种格式，需要逐个尝试所有 data-fn-args 属性
  const results = [];
  let searchIdx = 0;

  while (true) {
    const idx = html.indexOf('data-fn-args="', searchIdx);
    if (idx === -1) break;

    const start = idx + 'data-fn-args="'.length;
    const end = html.indexOf('" nonce=', start);
    if (end === -1) { searchIdx = start; continue; }

    try {
      const encoded = html.substring(start, end);
      const decoded = decodeHtmlEntities(encoded);
      const args = JSON.parse(decoded);
      results.push(args);
    } catch {
      // 解析失败，跳过
    }
    searchIdx = end;
  }

  if (results.length === 0) throw new Error('页面结构异常：未找到 data-fn-args');

  // 从所有解析结果中寻找包含 share_info 的数据
  for (const args of results) {
    if (!Array.isArray(args)) continue;

    // 格式 A：直接包含数据 ["route", "shareInfo", { data: { share_info, message_snapshot } }]
    if (args[2]?.data?.share_info) {
      return args[2].data;
    }

    // 格式 B：数据嵌套在 routerDataFnArgs 中
    // ["route", [{ key, routerDataFnArgs: [stringifiedJSON, ...] }]]
    if (Array.isArray(args[1])) {
      for (const fn of args[1]) {
        if (!fn.routerDataFnArgs) continue;
        for (const rawArg of fn.routerDataFnArgs) {
          try {
            const parsed = typeof rawArg === 'string' ? JSON.parse(rawArg) : rawArg;
            if (parsed?.data?.share_info) {
              return parsed.data;
            }
          } catch {
            // 跳过不可解析的参数
          }
        }
      }
    }
  }

  throw new Error('未找到分享数据，页面可能已变更结构');
}

// ═══════════════════════════════════════════
// 图片下载
// ═══════════════════════════════════════════

function downloadFileSync(fileUrl, dest) {
  try {
    execSync(`curl -sL -o "${dest}" "${fileUrl}"`, { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isLikelyImageUrl(url, hintKey = '') {
  if (typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(png|jpe?g|webp|gif|bmp|svg|avif|heic)(\?|$)/i.test(url)) return true;
  if (/image/i.test(hintKey)) return true;
  return false;
}

function extractImageUrls(node, imageSet, hintKey = '') {
  if (!node) return;

  if (typeof node === 'string') {
    if (isLikelyImageUrl(node, hintKey)) imageSet.add(node);
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) extractImageUrls(item, imageSet, hintKey);
    return;
  }

  if (typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    extractImageUrls(value, imageSet, key);
  }
}

function getTextCandidates(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const values = [
    payload.text,
    payload.markdown,
    payload.summary,
    payload.title,
    payload.text_block?.text,
  ];

  if (Array.isArray(payload.queries)) {
    values.push(payload.queries.filter(q => typeof q === 'string' && q.trim()).join('\n'));
  }

  return values
    .filter(v => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean);
}

function extractTextFromContent(value) {
  const parsed = tryParseJson(value);

  if (typeof parsed === 'string') return parsed.trim();
  if (!parsed) return '';

  if (Array.isArray(parsed)) {
    const parts = [];
    for (const block of parsed) {
      const blockParts = [];
      blockParts.push(...getTextCandidates(block));
      blockParts.push(...getTextCandidates(tryParseJson(block?.content)));
      blockParts.push(...getTextCandidates(tryParseJson(block?.content_v2)));

      const uniqueBlockParts = [...new Set(blockParts.map(v => v.trim()).filter(Boolean))];
      if (uniqueBlockParts.length > 0) {
        parts.push(uniqueBlockParts.join('\n\n'));
      }
    }
    return parts.join('\n\n').trim();
  }

  return getTextCandidates(parsed).join('\n\n').trim();
}

// ═══════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════

async function main() {
  // 1. 获取页面 HTML
  console.log(`[doubao-export] 获取页面: ${url}`);
  const html = await fetch(url);
  console.log(`[doubao-export] 页面大小: ${(html.length / 1024).toFixed(1)} KB`);

  // 2. 提取 SSR 数据
  console.log('[doubao-export] 解析 SSR 数据...');
  const data = extractShareData(html);

  const shareInfo = data.share_info;
  const msgSnapshot = data.message_snapshot;

  if (!shareInfo) throw new Error('未找到分享信息，请确认链接有效');
  if (!msgSnapshot?.message_list?.length) throw new Error('未找到消息数据，对话可能为空');

  const title = customTitle || shareInfo.share_name || '豆包对话';
  const messages = msgSnapshot.message_list;

  console.log(`[doubao-export] 标题: ${title}`);
  console.log(`[doubao-export] 消息: ${messages.length} 条`);
  console.log(`[doubao-export] 分享者: ${shareInfo.user?.nick_name || '未知'}`);

  // 3. 解析消息内容
  const allMessages = messages.map((m, i) => {
    // user_type: 1=用户, 2=AI
    const role = m.user_type === 1 ? 'user' : 'assistant';

    const text = extractTextFromContent(m.content);

    // 提取图片 URL（从 meta_infos、content、content_v2 中递归提取）
    const imageSet = new Set();
    extractImageUrls(m.meta_infos, imageSet);
    extractImageUrls(tryParseJson(m.content), imageSet);
    extractImageUrls(tryParseJson(m.content_v2), imageSet);

    return {
      role,
      content: text,
      images: [...imageSet],
      index: i,
    };
  });

  const exportMessages = keepEmpty
    ? allMessages
    : allMessages.filter(m => m.content.trim() !== '' || m.images.length > 0);
  const removedEmptyCount = allMessages.length - exportMessages.length;

  if (exportMessages.length === 0) {
    throw new Error('消息解析后为空，页面结构可能已变更');
  }

  if (!keepEmpty && removedEmptyCount > 0) {
    console.log(`[doubao-export] 已过滤空消息: ${removedEmptyCount} 条`);
  }

  // 4. 准备输出目录
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 50);

  const totalImages = exportMessages.reduce((sum, m) => sum + m.images.length, 0);
  const hasImages = totalImages > 0;

  // 无图片：单文件 .doubao-exports/{title}.md
  // 有图片：目录 .doubao-exports/{title}/index.md + assets/
  const exportRoot = outputDir ? resolve(outputDir) : resolve('.doubao-exports');
  mkdirSync(exportRoot, { recursive: true });

  let baseDir, assetsDir, mdPath;
  if (hasImages) {
    baseDir = join(exportRoot, safeTitle);
    assetsDir = join(baseDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    mdPath = join(baseDir, 'index.md');
  } else {
    baseDir = exportRoot;
    mdPath = join(exportRoot, `${safeTitle}.md`);
  }

  // 5. 下载图片
  if (hasImages) {
    console.log(`[doubao-export] 下载图片: ${totalImages} 张...`);
  }

  let downloadedCount = 0;
  const imageMap = new Map();

  for (let i = 0; i < exportMessages.length; i++) {
    const msg = exportMessages[i];
    const localImages = [];

    for (let j = 0; j < msg.images.length; j++) {
      const imgUrl = msg.images[j];

      let ext = '.jpg';
      if (imgUrl.includes('.png')) ext = '.png';
      else if (imgUrl.includes('.webp')) ext = '.webp';
      else if (imgUrl.includes('.gif')) ext = '.gif';

      const filename = `msg-${i + 1}-${j + 1}${ext}`;
      const destPath = join(assetsDir, filename);

      if (!imageMap.has(imgUrl)) {
        const ok = downloadFileSync(imgUrl, destPath);
        if (ok) {
          imageMap.set(imgUrl, filename);
          downloadedCount++;
          process.stdout.write(`\r[doubao-export]   ${downloadedCount}/${totalImages} 张`);
        }
      }

      localImages.push(imageMap.get(imgUrl) || filename);
    }

    msg.localImages = localImages;
  }

  if (totalImages > 0) {
    console.log('');
    console.log(`[doubao-export] 图片下载完成: ${downloadedCount}/${totalImages}`);
  }

  // 6. 生成 Markdown
  const now = new Date().toISOString().slice(0, 10);
  const userCount = exportMessages.filter(m => m.role === 'user').length;
  const aiCount = exportMessages.filter(m => m.role === 'assistant').length;

  const lines = [
    '---',
    `source: doubao`,
    `title: "${title}"`,
    `url: "${url}"`,
    `exported: ${now}`,
    `message_count: ${exportMessages.length}`,
    `original_message_count: ${allMessages.length}`,
    `removed_empty_messages: ${removedEmptyCount}`,
    `user_messages: ${userCount}`,
    `ai_messages: ${aiCount}`,
    `image_count: ${downloadedCount}`,
    '---',
    '',
    `# ${title}`,
    '',
  ];

  for (let i = 0; i < exportMessages.length; i++) {
    const msg = exportMessages[i];
    lines.push(msg.role === 'user' ? '## User' : '## Doubao');
    lines.push('');

    let content = msg.content || '';

    // 追加图片引用
    if (msg.localImages && msg.localImages.length > 0) {
      const imgMarkdown = msg.localImages.map((f, j) => `![image-${j + 1}](assets/${f})`).join('\n\n');
      if (content === '') {
        content = imgMarkdown;
      } else {
        content = content + '\n\n' + imgMarkdown;
      }
    }

    lines.push(content || '[空消息]');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  const markdown = lines.join('\n');
  writeFileSync(mdPath, markdown, 'utf-8');

  console.log(`[doubao-export] 导出完成！`);
  console.log(`[doubao-export]   文件: ${mdPath}`);
  console.log(`[doubao-export]   消息: ${exportMessages.length} 条（用户 ${userCount} / AI ${aiCount}，原始 ${allMessages.length}）`);
  console.log(`[doubao-export]   图片: ${downloadedCount} 张`);
  console.log(`[doubao-export]   大小: ${(Buffer.byteLength(markdown) / 1024).toFixed(1)} KB`);
}

main().catch(err => {
  console.error(`[doubao-export] 导出失败: ${err.message}`);
  process.exit(1);
});
