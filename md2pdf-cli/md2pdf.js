const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const markdownIt = require('markdown-it');

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

const TIMEOUT = 200000;
const BROWSER = 'auto';
const PAGE_WIDTH = 580;
const DEVICE_SCALE_FACTOR = 2;
const VIEWPORT_RESOLUTION = '4K';

const RESOLUTIONS = {
  '1K': { width: 1920, height: 1080 },
  '2K': { width: 2560, height: 1440 },
  '4K': { width: 3840, height: 2160 },
};

const THEMES = {
  vue: { file: 'vue.css', desc: '专业 Vue.js 风格' },
  atom: { file: 'atom.css', desc: 'Atom 编辑器暗色主题' },
  light: { file: 'light.css', desc: '简洁明亮风格' },
  github: { file: 'github.css', desc: 'GitHub Markdown 风格' },
  monokai: { file: 'monokai.css', desc: 'Monokai 代码高亮风格' },
  solarized: { file: 'solarized.css', desc: 'Solarized 暗色主题' }
};

function logStep(step, message) {
  const steps = {
    1: { icon: '📄', color: colors.blue, action: '读取' },
    2: { icon: '🔄', color: colors.cyan, action: '解析' },
    3: { icon: '🚀', color: colors.magenta, action: '启动' },
    4: { icon: '🔍', color: colors.yellow, action: '渲染' },
    5: { icon: '🔧', color: colors.cyan, action: '生成' },
    6: { icon: '🧹', color: colors.gray, action: '清理' }
  };

  const { icon, color, action } = steps[step] || { icon: '⚙️', color: colors.blue, action: '处理' };
  console.log(`${icon} ${color}[步骤 ${step}/6]${colors.reset} ${color}${colors.bright}${action}${colors.reset}${message}`);
}

function printResultTable(duration) {
  console.log('\n' + colors.bright + colors.green + '✅ [完成] 转换成功' + colors.reset + ' ' +
    colors.gray + `(耗时: ${duration.toFixed(2)}秒)` + colors.reset);
}

function printProgress(current, total, label) {
  const progressWidth = 30;
  const percent = Math.floor((current / total) * 100);
  const filledWidth = Math.floor((current / total) * progressWidth);
  const emptyWidth = progressWidth - filledWidth;

  const filled = '█'.repeat(filledWidth);
  const empty = '░'.repeat(emptyWidth);

  process.stdout.write(`\r${colors.cyan}[${filled}${empty}]${colors.reset} ${percent}% ${label}`);

  if (current === total) {
    process.stdout.write('\n');
  }
}

async function generatePdf(themeName, mdFilePath, startTime) {
  let htmlFilePath;
  let pdfPath;

  try {
    const mdDir = path.resolve(path.dirname(mdFilePath));
    const basePath = `file:///${mdDir.replace(/\\/g, '/')}/`;
    const mdFileName = path.basename(mdFilePath, '.md');
    const outputDir = path.join(__dirname, 'output');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    logStep(1, ' Markdown文件...');
    const mdContent = fs.readFileSync(mdFilePath, 'utf8');
    const mermaidCdn = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js';

    const mdParser = markdownIt({
      html: true,
      linkify: false,
      typographer: true,
      breaks: true
    }).use(function (md) {
      const defaultRender = md.renderer.rules.image || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };

      md.renderer.rules.image = function (tokens, idx, options, env, self) {
        let src = tokens[idx].attrGet('src');
        if (src && !src.startsWith('http') && !src.startsWith('file://')) {
          src = basePath + encodeURI(src).replace(/'/g, '%27');
          tokens[idx].attrSet('src', src);
        }
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

    logStep(2, ' HTML内容...');
    const htmlBody = mdParser.render(mdContent);
    const cssFilePath = path.join(__dirname, 'style', THEMES[themeName].file);
    const cssFileUrl = `file:///${cssFilePath.replace(/\\/g, '/')}`;

    const fullHtml = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="${cssFileUrl}">
      <title>${mdFileName} - PDF 导出</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        html,
        body {
          max-width: ${PAGE_WIDTH}mm !important;
          margin: 0 auto;
          padding: 10mm;
          height: auto !important;
          min-height: auto;
          background: ${themeName === 'atom' ? '#282c34' : '#ffffff'};
        }
        .markdown-body {
          width: 100%;
          box-sizing: border-box;
        }
        h1, h2, h3, h4, h5, h6 {
          margin-top: 1.2em;
          margin-bottom: 0.6em;
        }
        p {
          margin-bottom: 1em;
        }
        ul, ol {
          margin-bottom: 1em;
        }
        pre {
          margin: 1em 0;
        }
        table {
          margin: 1em 0;
        }
        .mermaid {
          display: block;
          margin: 1.5em auto;
          text-align: center;
        }
        @media print {
          body {
            padding: 0;
            height: auto !important;
            min-height: 100vh;
          }
          @page :first { margin-top: 0mm; }
          @page { margin: 0mm 10mm; }
        }
      </style>
      <script src="${mermaidCdn}"></script>
    </head>
    <body>
      <div class="markdown-body">
        ${htmlBody}
      </div>
      <script>
        if (window.mermaid) {
          mermaid.initialize({ startOnLoad: true });
        }
      </script>
    </body>
    </html>
    `;

    htmlFilePath = path.resolve(mdDir, `${mdFileName}-${themeName}-${Date.now()}.html`);
    fs.writeFileSync(htmlFilePath, fullHtml, 'utf8');

    let executablePath;
    let browserName = '';
    if (process.platform === 'win32') {
      const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

      if (BROWSER === 'chrome') {
        executablePath = chromePath;
        browserName = 'Chrome';
      } else if (BROWSER === 'edge') {
        executablePath = edgePath;
        browserName = 'Edge';
      } else {
        if (fs.existsSync(chromePath)) {
          executablePath = chromePath;
          browserName = 'Chrome';
        } else {
          executablePath = edgePath;
          browserName = 'Edge';
        }
      }
    } else if (process.platform === 'darwin') {
      executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      browserName = 'Chrome';
    } else {
      executablePath = '/usr/bin/google-chrome';
      browserName = 'Chrome';
    }

    logStep(3, ` 浏览器引擎(${browserName})...`);

    const browser = await puppeteer.launch({
      headless: "new",
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      timeout: TIMEOUT
    });

    const page = await browser.newPage();
    const fileUrl = `file:///${htmlFilePath.replace(/\\/g, '/')}`;

    await page.setDefaultTimeout(TIMEOUT);
    await page.setDefaultNavigationTimeout(TIMEOUT);

    const viewport = typeof VIEWPORT_RESOLUTION === 'string'
      ? RESOLUTIONS[VIEWPORT_RESOLUTION]
      : VIEWPORT_RESOLUTION;
    await page.setViewport({ ...viewport, deviceScaleFactor: DEVICE_SCALE_FACTOR });

    logStep(4, ' 页面资源...');
    await page.goto(fileUrl, {
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: TIMEOUT
    });

    await page.evaluate(async () => {
      const selectors = Array.from(document.querySelectorAll('img'));
      await Promise.all(selectors.map(img => {
        if (img.complete) return;
        return new Promise((resolve) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', resolve);
        });
      }));
    });

    await page.waitForFunction(() => {
      const nodes = document.querySelectorAll('.mermaid');
      return Array.from(nodes).every(div => div.querySelector('svg'));
    }, { timeout: TIMEOUT }).catch(() => { });

    const bodyHandle = await page.$('body');
    const boundingBox = await bodyHandle.boundingBox();
    const contentHeight = Math.ceil(boundingBox.height);
    const heightMm = contentHeight * 0.264583;

    logStep(5, ' PDF文档...');
    const pdfFileName = `${mdFileName}-${themeName}-${Date.now()}.pdf`;
    pdfPath = path.join(outputDir, pdfFileName);

    await page.pdf({
      path: pdfPath,
      printBackground: true,
      width: `${PAGE_WIDTH}mm`,
      height: `${heightMm}mm`,
      preferCSSPageSize: false,
      format: null,
      pageRanges: '1'
    });

    await browser.close();

    logStep(6, ' 临时文件...');
    if (fs.existsSync(htmlFilePath)) {
      fs.unlinkSync(htmlFilePath);
    }

    const duration = (Date.now() - startTime) / 1000;

    printResultTable(duration);

    return pdfPath;
  } catch (error) {
    console.log('\n' + colors.bright + colors.red + '❌ 生成PDF失败:' + colors.reset);
    console.log(colors.red + error.message + colors.reset);

    if (htmlFilePath && fs.existsSync(htmlFilePath)) {
      try {
        fs.unlinkSync(htmlFilePath);
      } catch (cleanError) { }
    }
    return null;
  }
}

(async () => {
  const startTime = Date.now();

  try {
    const themeName = process.argv[2] || 'atom';
    const mdFilePath = process.argv[3] || path.join(__dirname, 'markdown', 'markdown.md');

    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      console.log(colors.bright + colors.cyan + '\n📝 Markdown 转 PDF 工具 v2.1' + colors.reset + colors.gray + colors.reset + '\n');
      console.log(colors.yellow + '用法: ' + colors.reset + `node ${path.basename(__filename)} [主题名称|all] [Markdown文件路径]\n`);

      console.log(colors.bright + '可用主题:' + colors.reset);
      Object.entries(THEMES).forEach(([name, { desc }]) => {
        console.log(`  ${colors.green}•${colors.reset} ${colors.cyan}${name.padEnd(10)}${colors.reset} ${desc}`);
      });

      console.log(colors.bright + '\n示例:' + colors.reset);
      console.log(`  ${colors.gray}$${colors.reset} node ${path.basename(__filename)} --help`);
      console.log(`  ${colors.gray}$${colors.reset} node ${path.basename(__filename)} all ./markdown/markdown.md`);

      const date = new Date();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const dateStr = `${date.getFullYear()}年${month}月${day}日 ${hours}:${minutes}`;

      console.log(colors.yellow + '\n💡 提示: ' + colors.reset + '所有主题都经过优化，确保PDF输出效果美观且避免内容分页!\n');
      console.log(colors.magenta + '🌟 作者: ' + colors.reset + '任帅 ' + colors.gray + `(${dateStr})` + colors.reset + '\n');

      return;
    }

    if (themeName === 'all') {
      if (!fs.existsSync(mdFilePath)) {
        console.error(colors.red + `❌ 错误: Markdown 文件不存在: ${mdFilePath}` + colors.reset);
        return;
      }

      console.log(colors.bright + colors.blue + '🔄 准备批量生成所有主题PDF' + colors.reset);

      let completed = 0;
      const themeNames = Object.keys(THEMES);

      for (const t of themeNames) {
        console.log(colors.cyan + `\n▶ 正在处理: ${t} 主题 (${completed + 1}/${themeNames.length})` + colors.reset);
        await generatePdf(t, mdFilePath, startTime);
        completed++;

        printProgress(completed, themeNames.length, `主题处理进度`);
      }

      console.log(colors.green + `\n✅ 已完成所有 ${themeNames.length} 个主题的生成` + colors.reset);
      return;
    }

    if (!THEMES[themeName]) {
      console.error(colors.red + `❌ 错误: 主题 "${themeName}" 不存在` + colors.reset);
      console.log(colors.blue + `可用主题: ${Object.keys(THEMES).join(', ')}` + colors.reset);
      process.exit(1);
    }

    if (!fs.existsSync(mdFilePath)) {
      console.error(colors.red + `❌ 错误: Markdown 文件不存在: ${mdFilePath}` + colors.reset);
      process.exit(1);
    }

    await generatePdf(themeName, mdFilePath, startTime);

  } catch (error) {
    console.error(colors.bright + colors.red + '\n❌ 发生错误:' + colors.reset);
    console.error(colors.red + error.message + colors.reset);
    process.exit(1);
  }
})();
