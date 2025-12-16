const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const puppeteer = require('puppeteer');
const markdownIt = require('markdown-it');

const TIMEOUT = 600000;
const PAGE_WIDTH = 580;
const DEVICE_SCALE_FACTOR = 2;
const VIEWPORT_RESOLUTION = '2K';

const RESOLUTIONS = {
  '1K': { width: 1920, height: 1080 },
  '2K': { width: 2560, height: 1440 },
  '4K': { width: 3840, height: 2160 },
};

const THEMES = {
  vue: { file: 'vue.css', desc: 'Vue 明亮风格' },
  atom: { file: 'atom.css', desc: 'Atom 暗色风格' },
  light: { file: 'light.css', desc: 'Light 明亮风格' },
  github: { file: 'github.css', desc: 'GitHub 明亮风格' },
  monokai: { file: 'monokai.css', desc: 'Monokai 暗色风格' },
  solarized: { file: 'solarized.css', desc: 'Solarized 暗色风格' }
};

const HIGHLIGHT_CSS_MAP = {
  vue: 'vue.min.css',
  atom: 'atom.min.css',
  light: 'light.min.css',
  github: 'github.min.css',
  monokai: 'monokai.min.css',
  solarized: 'solarized.min.css'
};

const mdParser = markdownIt({
  html: true,
  linkify: false,
  typographer: true,
  breaks: true,
  highlight: function (code, lang) {
    const langClass = lang ? `language-${lang}` : '';
    return `<pre><code class="${langClass}">${markdownIt().utils.escapeHtml(code)}</code></pre>\n`;
  }
}).use(function (md) {
  const defaultRender = md.renderer.rules.image || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.image = function (tokens, idx, options, env, self) {
    return defaultRender(tokens, idx, options, env, self);
  };

  const fence = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
  md.renderer.rules.fence = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    if (token.info.trim() === 'mermaid') {
      return `<div class="mermaid">\n${token.content}\n</div>`;
    }
    return fence(tokens, idx, options, env, self);
  };
});

const renderJobs = new Map();

function embedImagesInHtml(htmlBody, images = []) {
  if (!images || images.length === 0) return htmlBody;
  const imagesMap = {};
  images.forEach(i => {
    if (i && i.name && i.dataUrl) imagesMap[i.name] = i.dataUrl;
  });

  return htmlBody.replace(/<img([^>]*)src=["']([^"']+)["']([^>]*)>/g, (match, before, src, after) => {
    if (/^https?:\/\//i.test(src) || /^data:/i.test(src) || src.startsWith('file://')) {
      return match;
    }
    const imageName = src.split(/[/\\]/).pop();
    if (imagesMap[imageName]) {
      return `<img${before}src="${imagesMap[imageName]}"${after}>`;
    }
    return match;
  });
}

function buildFullHtml(options) {
  const { mdContent, themeName, pageWidth, margin } = options;
  const mdFileName = options.fileName || 'markdown';
  const cssFilePath = path.join(__dirname, 'style', THEMES[themeName].file);
  const cssFileUrl = `file:///${cssFilePath.replace(/\\/g, '/')}`;
  const highlightCssFile = HIGHLIGHT_CSS_MAP[themeName] || 'github.min.css';
  const highlightCssPath = path.join(__dirname, 'style', highlightCssFile);
  const highlightCssUrl = `file:///${highlightCssPath.replace(/\\/g, '/')}`;
  const highlightJsPath = path.join(__dirname, 'public', 'libs', 'highlight.min.js');
  const highlightJsUrl = `file:///${highlightJsPath.replace(/\\/g, '/')}`;
  const isDarkTheme = ['atom', 'monokai', 'solarized'].includes(themeName);
  const mermaidLocalPath = path.join(__dirname, 'public', 'libs', 'mermaid.min.js');
  const mermaidUrl = `file:///${mermaidLocalPath.replace(/\\/g, '/')}`;
  const mathjaxLocalPath = path.join(__dirname, 'public', 'libs', 'tex-mml-svg.js');
  const mathjaxUrl = `file:///${mathjaxLocalPath.replace(/\\/g, '/')}`;

  const fenceRanges = [];
  {
    const fenceRe = /^```.*$/gm;
    let m;
    while ((m = fenceRe.exec(mdContent)) !== null) {
      const startIndex = m.index;
      const fenceClose = mdContent.indexOf('```', startIndex + m[0].length);
      if (fenceClose >= 0) {
        fenceRanges.push([startIndex, fenceClose + 3]);
        fenceRe.lastIndex = fenceClose + 3;
      }
    }
  }

  function isInFence(pos) {
    for (let i = 0; i < fenceRanges.length; i++) {
      const r = fenceRanges[i];
      if (pos >= r[0] && pos < r[1]) return true;
    }
    return false;
  }

  const mathBlocks = [];
  const placeholderPrefix = 'MATHBLOCK_PLACEHOLDER_';
  const mathRe = /(\$\$[\s\S]+?\$\$|\\\\\([\s\S]+?\\\\\)|\\\\\[[\s\S]+?\\\\\])/g;
  let lastIndex = 0;
  let out = '';
  let mm;
  while ((mm = mathRe.exec(mdContent)) !== null) {
    const idx = mm.index;
    const endIdx = mathRe.lastIndex;
    if (isInFence(idx)) {
      continue;
    }
    out += mdContent.slice(lastIndex, idx);
    const id = mathBlocks.length;
    mathBlocks.push(mm[0]);
    out += `${placeholderPrefix}${id}__`;
    lastIndex = endIdx;
  }
  out += mdContent.slice(lastIndex);

  const contentWithPlaceholders = out;
  const htmlAfterMd = mdParser.render(contentWithPlaceholders);

  let htmlBody = htmlAfterMd.replace(new RegExp(placeholderPrefix + '(\\d+)__', 'g'), (__, idx) => {
    const tex = mathBlocks[Number(idx)] || '';
    return tex;
  });

  const hasMath = /\$\$[\s\S]+?\$\$|\\\\\(|\\\\\[/.test(mdContent);
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="${cssFileUrl}">
      <link rel="stylesheet" href="${highlightCssUrl}">
      <title>${mdFileName} - PDF 导出</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
          max-width: ${pageWidth}mm !important;
          margin: 0 auto;
          padding: ${margin}mm;
          height: auto !important;
          min-height: auto;
          background: ${isDarkTheme ? '#282c34' : '#ffffff'};
          overflow-y: auto;
        }
        .markdown-body { width: 100%; box-sizing: border-box; }
        h1,h2,h3,h4,h5,h6 { margin-top: 1.2em; margin-bottom: 0.6em; }
        p { margin-bottom: 1em; } ul, ol { margin-bottom: 1em; } pre { margin: 1em 0; } table { margin: 1em 0; }
        .mermaid { display: block; margin: 1.5em auto; text-align: center; }
        .hljs-comment, .hljs-quote { font-style: normal !important; }
        @media print {
          body { padding: 0; height: auto !important; min-height: 100vh; }
          @page :first { margin-top: 0mm; }
          @page { margin: 0mm ${margin}mm; }
        }
      </style>
      <script src="${mermaidUrl}" defer></script>
      <script src="${highlightJsUrl}" defer></script>
      ${hasMath ? `
      <script id="mathjax-config" type="text/javascript">
    window.MathJax = {
      tex: { inlineMath: [['$','$'], ['\\\\(','\\\\)']], displayMath: [['$$','$$'], ['\\\\[','\\\\]']] },
      options: { skipHtmlTags: ['noscript','style','textarea','pre'] },
      svg: { fontCache: 'global' },
      startup: { typeset: false }
    };
      </script>
      <script id="mathjax-script" src="${mathjaxUrl}" defer></script>
      ` : ''}
    </head>
    <body>
      <div class="markdown-body">
        ${htmlBody}
      </div>
      <script>
        if (window.mermaid) {
          mermaid.initialize({ startOnLoad: true });
        }
        if (window.hljs) {
          hljs.highlightAll();
          document.querySelectorAll('code.hljs').forEach(function(el){
            el.classList.remove('hljs');
          });
        } else {
          setTimeout(function tryHighlight() {
            if (window.hljs) {
              hljs.highlightAll();
              document.querySelectorAll('code.hljs').forEach(function(el){
                el.classList.remove('hljs');
              });
            } else {
              setTimeout(tryHighlight, 200);
            }
          }, 200);
        }
      </script>
    </body>
    </html>
  `;
}

async function generatePdfFromPayload(payload, startTime) {
  let htmlFilePath;
  try {
    const themeName = payload.theme || 'atom';
    if (!THEMES[themeName]) {
      throw new Error(`主题 "${themeName}" 不存在`);
    }

    const mdContent = payload.markdown || '';
    const margin = parseFloat(payload.margin) || 10;
    const scaleFactor = parseFloat(payload.scaleFactor) || DEVICE_SCALE_FACTOR;
    const resolutionKey = payload.resolution || VIEWPORT_RESOLUTION;
    let resolution = RESOLUTIONS['4K'];
    if (typeof resolutionKey === 'string') {
      if (RESOLUTIONS[resolutionKey]) {
        resolution = RESOLUTIONS[resolutionKey];
      } else if (/^\d+\s*[x×]\s*\d+$/i.test(resolutionKey)) {
        const parts = resolutionKey.split(/x|×/i).map(p => parseInt(p.trim(), 10));
        if (parts.length === 2 && parts[0] && parts[1]) {
          resolution = { width: parts[0], height: parts[1] };
        }
      }
    } else if (typeof resolutionKey === 'object' && resolutionKey.width && resolutionKey.height) {
      resolution = resolutionKey;
    }

    const images = Array.isArray(payload.images) ? payload.images : [];

    let pageWidth = PAGE_WIDTH;
    let format = 'A4';
    if (payload.forceSingle) {
      pageWidth = parseFloat(payload.pageWidth) || PAGE_WIDTH;
    } else {
      format = payload.format || 'A4';
    }

    const fullHtmlInitial = buildFullHtml({ mdContent, themeName, pageWidth, margin, fileName: payload.fileName });
    const hasMath = /\$\$[\s\S]+?\$\$|\\\\\(|\\\\\[/.test(mdContent);
    const fullHtml = embedImagesInHtml(fullHtmlInitial, images);

    const tmpBaseDir = process.env.PDF_TMP_DIR || process.env.MD2PDF_TMP || os.tmpdir();
    const tmpDir = path.join(tmpBaseDir, 'md2pdf_tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    htmlFilePath = path.join(tmpDir, `${(payload.fileName || 'md')}-${Date.now()}.html`);
    fs.writeFileSync(htmlFilePath, fullHtml, 'utf8');

    const renderId = payload.renderId || `${payload.fileName || 'md'}-${Date.now()}`;
    renderJobs.set(renderId, { htmlFilePath, debugPdfPath: null, browser: null, aborted: false });

    let executablePath = process.env.MD2PDF_CHROME || process.env.CHROME_PATH;
    if (!executablePath) {
      const candidates = [];
      if (process.platform === 'win32') {
        candidates.push(
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        );
      } else if (process.platform === 'darwin') {
        candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      } else {
        candidates.push(
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/snap/bin/chromium',
          '/opt/google/chrome/chrome'
        );
      }
      for (const c of candidates) {
        if (c && fs.existsSync(c)) { executablePath = c; break; }
      }
    }

    console.log(`DEBUG: 使用浏览器可执行文件: ${executablePath || '(默认 Puppeteer 内置)'} `);

    const browser = await puppeteer.launch({
      headless: "new",
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ],
      timeout: TIMEOUT,
      protocolTimeout: TIMEOUT
    });

    if (renderJobs.has(renderId)) {
      try { renderJobs.get(renderId).browser = browser; } catch (e) { }
    }

    const page = await browser.newPage();
    await page.setDefaultTimeout(TIMEOUT);
    await page.setDefaultNavigationTimeout(TIMEOUT);
    await page.setViewport({ ...resolution, deviceScaleFactor: scaleFactor });

    const fileUrl = `file:///${htmlFilePath.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: ['domcontentloaded', 'networkidle0'], timeout: TIMEOUT });

    await page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      await Promise.all(imgs.map(img => {
        if (img.complete) return;
        return new Promise(resolve => { img.addEventListener('load', resolve); img.addEventListener('error', resolve); });
      }));
    });

    await page.waitForFunction(() => {
      const nodes = document.querySelectorAll('.mermaid');
      return Array.from(nodes).every(div => div.querySelector('svg'));
    }, { timeout: TIMEOUT }).catch(() => { });

    if (hasMath) {
      try {
        await page.waitForFunction(() => {
          return window.MathJax && typeof window.MathJax.typesetPromise === 'function';
        }, { timeout: 10000 }).catch(() => false);

        await page.evaluate(async () => {
          try {
            if (!window.MathJax) return;
            const target = document.querySelector('.markdown-body') || document.body;
            if (typeof window.MathJax.typesetPromise === 'function') {
              await window.MathJax.typesetPromise([target]);
            } else if (window.MathJax.startup && typeof window.MathJax.startup.defaultPageReady === 'function') {
              await window.MathJax.startup.defaultPageReady();
            }
          } catch (e) {
            console.warn('MathJax typeset error in page context', e && e.message);
          }
        });

        await new Promise(resolve => setTimeout(resolve, 200));
        console.log('DEBUG: MathJax typeset completed (if present)');
      } catch (e) {
        console.warn('等待 MathJax 渲染失败或超时', e && e.message);
      }
    }

    const contentHeight = await page.evaluate(() => {
      return Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 0);
    });
    const heightMm = Math.ceil(contentHeight * 0.264583);
    console.log(`DEBUG: contentHeight(px)=${contentHeight}, height(mm)=${heightMm}, forceSingle=${!!payload.forceSingle}`);

    const forceSingle = !!payload.forceSingle;

    let pdfOptions = {};

    if (forceSingle) {
      pdfOptions = {
        ...pdfOptions,
        printBackground: true,
        width: `${pageWidth}mm`,
        height: `${heightMm}mm`,
        preferCSSPageSize: false,
        pageRanges: '1'
      };
    } else {
      pdfOptions = {
        ...pdfOptions,
        printBackground: true,
        preferCSSPageSize: true,
        format,
      };
    }

    let pdfBuffer;
    let debugPdfPath;
    try {
      try {
        pdfBuffer = await page.pdf(pdfOptions);
      } catch (pdfErr) {
        const job = renderJobs.get(renderId);
        const isAborted = job && job.aborted;
        const msg = pdfErr && pdfErr.message ? pdfErr.message : '';
        if (isAborted || /detached|Target closed|Session closed|Page crashed/i.test(msg)) {
          throw new Error('RENDER_ABORTED');
        }
        throw pdfErr;
      }
    } finally {
      try { await browser.close(); } catch (e) { console.warn('关闭浏览器失败', e && e.message); }
      const debugEnabled = String(process.env.MD2PDF_DEBUG || '').trim() === '1';
      if (debugEnabled && pdfBuffer) {
        try {
          const debugDir = path.join(tmpBaseDir, 'md2pdf_debug');
          if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
          debugPdfPath = path.join(debugDir, `${payload.fileName || 'markdown'}-${Date.now()}.pdf`);
          fs.writeFileSync(debugPdfPath, pdfBuffer);
          console.log(`DEBUG: PDF 已写入临时文件: ${debugPdfPath} (大小: ${pdfBuffer.length} bytes)`);
          if (renderJobs.has(renderId)) renderJobs.get(renderId).debugPdfPath = debugPdfPath;
        } catch (dbgErr) {
          console.warn('DEBUG: 写临时 PDF 文件失败', dbgErr && dbgErr.message);
        }
      }
      if (htmlFilePath && fs.existsSync(htmlFilePath)) {
        try { fs.unlinkSync(htmlFilePath); } catch (e) { console.warn('清理临时 HTML 失败', e && e.message); }
      }
      try { renderJobs.delete(renderId); } catch (e) { }
    }

    const uniqueTs = Date.now();
    const outFileName = `${payload.fileName || 'markdown'}-${themeName}-${uniqueTs}.pdf`;
    return { buffer: pdfBuffer, fileName: outFileName, debugPdfPath };
  } catch (error) {
    if (htmlFilePath && fs.existsSync(htmlFilePath)) {
      try { fs.unlinkSync(htmlFilePath); } catch (e) { console.warn('错误处理时清理 HTML 失败', e && e.message); }
    }
    try { if (payload && payload.renderId) renderJobs.delete(payload.renderId); } catch (e) { }
    throw error;
  }
}

const app = express();
const PORT = process.env.PORT || 80;

app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/style', express.static(path.join(__dirname, 'style')));
app.use('/libs', express.static(path.join(__dirname, 'libs')));

const router = express.Router();

router.post('/api/cancel', async (req, res) => {
  try {
    const id = (req.body && req.body.renderId) || req.query.renderId;
    if (!id) return res.status(400).json({ error: '缺少 renderId' });
    const job = renderJobs.get(id);
    if (!job) return res.status(404).json({ error: '未找到对应的渲染作业' });

    job.aborted = true;
    if (job.browser) {
      try { await job.browser.close(); } catch (e) { }
    }
    try { if (job.htmlFilePath && fs.existsSync(job.htmlFilePath)) fs.unlinkSync(job.htmlFilePath); } catch (e) { }
    try { if (job.debugPdfPath && fs.existsSync(job.debugPdfPath)) fs.unlinkSync(job.debugPdfPath); } catch (e) { }
    renderJobs.delete(id);
    return res.json({ ok: true, message: '已取消' });
  } catch (e) {
    console.error('取消作业失败', e && e.message);
    return res.status(500).json({ error: e && e.message });
  }
});

router.post('/api/generate', async (req, res) => {
  const startTime = Date.now();
  try {
    const payload = req.body || {};
    if (!payload.markdown) {
      return res.status(400).json({ error: '缺少 markdown 字段' });
    }
    if (payload.theme && !THEMES[payload.theme]) {
      return res.status(400).json({ error: `主题 "${payload.theme}" 不存在` });
    }

    const result = await generatePdfFromPayload(payload, startTime);
    let buffer = result && result.buffer ? result.buffer : null;
    if (!buffer) throw new Error('生成的 PDF 为空');
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);

    const filename = encodeURIComponent(result.fileName);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', Buffer.byteLength(buffer));
    res.setHeader('Content-Transfer-Encoding', 'binary');
    res.status(200);
    res.end(buffer, 'binary');

    try {
      const debugEnabled = String(process.env.MD2PDF_DEBUG || '').trim() === '1';
      if (!debugEnabled && result && result.debugPdfPath && fs.existsSync(result.debugPdfPath)) {
        try { fs.unlinkSync(result.debugPdfPath); } catch (e) { }
      }
    } catch (e) { }
  } catch (err) {
    const msg = err && err.message ? err.message : '';
    if (msg === 'RENDER_ABORTED' || /detached|Target closed|Session closed|Page crashed|Navigating frame was detached/i.test(msg)) {
      return res.status(204).end();
    }
    res.status(500).json({ error: msg || '生成 PDF 失败' });
  }
});

app.use('/', router);

app.listen(PORT, () => {
  console.log('\n🚀 Markdown 转 PDF Web 服务已启动!');
  console.log(`📍 访问地址: http://localhost:${PORT}`);
  console.log('✨ 支持的浏览器: Chrome, Edge (基于 Chromium)\n');
});

module.exports = app;
