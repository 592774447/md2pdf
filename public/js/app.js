let markdownContent = '';
let currentFileName = '';
let uploadedImages = {};

const md = window.markdownit({
    html: true,
    linkify: false,
    typographer: true,
    breaks: true
});

md.renderer.rules.fence = function (tokens, idx, options, env, slf) {
    const token = tokens[idx];
    const code = token.content.trim();
    const info = token.info ? token.info.trim() : '';
    const langName = info.split(/\s+/g)[0];

    if (langName === 'mermaid') {
        return `<div class="mermaid">${code}</div>\n`;
    }

    return `<pre><code class="language-${langName}">${md.utils.escapeHtml(code)}</code></pre>\n`;
};

const elements = {
    uploadArea: document.getElementById('uploadArea'),
    fileInput: document.getElementById('fileInput'),
    fileInfo: document.getElementById('fileInfo'),
    fileName: document.getElementById('fileName'),
    removeFile: document.getElementById('removeFile'),
    previewBtn: document.getElementById('previewBtn'),
    generateBtn: document.getElementById('generateBtn'),
    previewContainer: document.getElementById('previewContainer'),
    closePreview: document.getElementById('closePreview'),
    progressContainer: document.getElementById('progressContainer'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    cancelBtn: document.getElementById('cancelBtn'),
    imageSection: document.getElementById('imageSection'),
    imageList: document.getElementById('imageList'),
    imageInput: document.getElementById('imageInput'),
    uploadImageBtn: document.getElementById('uploadImageBtn'),
    forceSinglePage: document.getElementById('forceSinglePage'),
    pageWidth: document.getElementById('pageWidth'),
    pageFormat: document.getElementById('pageFormat')
};

function updatePageInputByForceSingle() {
    const checked = elements.forceSinglePage && elements.forceSinglePage.checked;
    const labelText = document.getElementById('pageInputLabelText');
    const labelDesc = document.getElementById('pageInputLabelDesc');
    const marginInput = document.getElementById('margin');
    if (checked) {
        elements.pageWidth.style.display = '';
        elements.pageFormat.style.display = 'none';
        if (labelText) labelText.textContent = '页面宽度 (mm)';
        if (labelDesc) labelDesc.textContent = '设置 PDF 的页面宽度';
        if (marginInput) marginInput.disabled = false;
    } else {
        elements.pageWidth.style.display = 'none';
        elements.pageFormat.style.display = '';
        if (labelText) labelText.textContent = '纸张大小 (mm)';
        if (labelDesc) labelDesc.textContent = '选择 PDF 的纸张大小';
        if (marginInput) marginInput.disabled = true;
    }
}

if (elements.forceSinglePage && elements.pageWidth && elements.pageFormat) {
    elements.forceSinglePage.addEventListener('change', updatePageInputByForceSingle);
    updatePageInputByForceSingle();
}

let _progressTimer = null;
let _progressStartTs = null;
let _autoProgressTimer = null;
let _autoProgressStartTs = null;
let _autoDisplayedPercent = 0;
let _autoTargetDuration = 20000;

const THEMES = {
    vue: { file: 'vue.css', desc: '💚 Vue 明亮风格' },
    atom: { file: 'atom.css', desc: '🌑 Atom 暗色风格' },
    light: { file: 'light.css', desc: '☀️ Light 明亮风格' },
    github: { file: 'github.css', desc: '🐱 GitHub 明亮风格' },
    monokai: { file: 'monokai.css', desc: '🌃 Monokai 暗色风格' },
    solarized: { file: 'solarized.css', desc: '🌌 Solarized 暗色风格' }
};

function handleFileSelect(file) {
    if (!file || !file.name.endsWith('.md')) {
        alert('❌ 请选择有效的 Markdown (.md) 文件');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        markdownContent = e.target.result;
        currentFileName = file.name.replace('.md', '');
        elements.uploadArea.style.display = 'none';
        elements.fileInfo.style.display = 'flex';
        elements.fileName.textContent = '📄 ' + file.name;
        elements.previewBtn.disabled = false;
        elements.generateBtn.disabled = false;

        detectImageReferences();
    };

    reader.onerror = () => {
        alert('❌ 文件读取失败');
    };

    reader.readAsText(file);
}

elements.uploadArea.addEventListener('click', () => {
    elements.fileInput.click();
});

elements.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileSelect(file);
});

elements.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.uploadArea.classList.add('drag-over');
});

elements.uploadArea.addEventListener('dragleave', () => {
    elements.uploadArea.classList.remove('drag-over');
});

elements.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
});

elements.removeFile.addEventListener('click', () => {
    markdownContent = '';
    currentFileName = '';
    uploadedImages = {};
    elements.fileInput.value = '';
    elements.uploadArea.style.display = 'block';
    elements.fileInfo.style.display = 'none';
    elements.previewBtn.disabled = true;
    elements.generateBtn.disabled = true;
    elements.previewContainer.style.display = 'none';
    if (elements.imageSection) {
        elements.imageSection.style.display = 'none';
    }
});

function renderMarkdownToHtml(content, theme) {
    if (typeof window.markdownit === 'undefined' || typeof md === 'undefined') {
        return `<pre style="color:red;padding:1em">错误：markdown-it 未加载，请将 markdown-it 放置到 /libs/ 下并刷新页面。</pre>`;
    }

    const fenceRanges = [];
    {
        const fenceRe = /```[\s\S]*?```/g;
        let match;
        while ((match = fenceRe.exec(content)) !== null) {
            fenceRanges.push([match.index, match.index + match[0].length]);
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
    const regex = /\$\$([\s\S]+?)\$\$/g;
    let lastIndex = 0;
    let out = '';
    let mm;
    while ((mm = regex.exec(content)) !== null) {
        const idx = mm.index;
        const endIdx = regex.lastIndex;
        if (isInFence(idx)) {
            continue;
        }
        out += content.slice(lastIndex, idx);
        const id = mathBlocks.length;
        mathBlocks.push(mm[1]);
        out += `${placeholderPrefix}${id}__`;
        lastIndex = endIdx;
    }
    out += content.slice(lastIndex);

    const contentWithPlaceholders = out;

    let htmlBody = md.render(contentWithPlaceholders);

    if (mathBlocks.length > 0) {
        htmlBody = htmlBody.replace(new RegExp(placeholderPrefix + '(\\d+)__', 'g'), (__, idx) => {
            const tex = mathBlocks[Number(idx)] || '';
            return `$$${tex}$$`;
        });
    }

    htmlBody = replaceImagePaths(htmlBody);

    const themeName = theme || document.getElementById('theme').value;
    const themeFile = THEMES[themeName].file;
    const origin = window.location && window.location.origin ? window.location.origin : '';
    const cssUrl = `${origin}/style/${themeFile}`;
    const mermaidJs = `${origin}/libs/mermaid.min.js`;
    const mathjaxJs = `${origin}/libs/tex-mml-svg.js`;
    const pageWidth = document.getElementById('pageWidth').value;
    const margin = document.getElementById('margin').value;
    const isDarkTheme = ['atom', 'monokai', 'solarized'].includes(themeName);

    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <base href="${origin}/">
      <link rel="stylesheet" href="${cssUrl}">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

                html, body {
                    max-width: ${pageWidth}mm !important;
                    margin: 0 auto;
                    padding: ${margin}mm;
                    height: auto !important;
                    min-height: auto;
                    background: ${isDarkTheme ? '#282c34' : '#ffffff'};
                    overflow-y: auto;
                }

                .markdown-body {
                    width: 100%;
                    box-sizing: border-box;
                }

                .markdown-body a:hover {
                    color: inherit !important;
                    text-decoration: none !important;
                }

                * {
                    cursor: default !important;
                }

                h1, h2, h3, h4, h5, h6 {
                    margin-top: 1.2em;
                    margin-bottom: 0.6em;
                }
                p { margin-bottom: 1em; }
                ul, ol { margin-bottom: 1em; }
                pre { margin: 1em 0; }
                table { margin: 1em 0; }
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
                    @page { margin: 0mm ${margin}mm; }
                }
            </style>
            <script src="${mermaidJs}" defer></script>
            ${/\$\$[\s\S]+?\$\$/.test(content) ? `
            <script id="mathjax-config">
        window.MathJax = {
            tex: { inlineMath: [['$','$'], ['\\\\(','\\\\)']], displayMath: [['$$','$$'], ['\\\\[','\\\\]']] },
            options: { skipHtmlTags: ['noscript','style','textarea','pre'] },
            svg: { fontCache: 'global' },
            startup: { typeset: false }
        };
            </script>
            <script src="${mathjaxJs}" defer></script>
            ` : ''}
    </head>
    <body>
      <div class="markdown-body">
        ${htmlBody}
      </div>
      <script>
        if (window.mermaid) {
          mermaid.initialize({ startOnLoad: true, theme: 'default' });
        }
      </script>
    </body>
    </html>
  `;
}

elements.previewBtn.addEventListener('click', async () => {
    if (!markdownContent) return;

    const html = renderMarkdownToHtml(markdownContent);

    let blobUrl = null;
    let previewWindow = null;
    try {
        const blob = new Blob([html], { type: 'text/html' });
        blobUrl = URL.createObjectURL(blob);
        previewWindow = window.open(blobUrl, '_blank');
    } catch (e) {
        console.warn('使用 blob 打开预览失败', e);
        previewWindow = null;
    }

    if (!previewWindow) {
        previewWindow = window.open('', '_blank');
        if (!previewWindow) {
            alert('⚠️ 无法打开预览窗口,请检查浏览器是否阻止了弹出窗口');
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            return;
        }
        try {
            previewWindow.document.write(html);
            previewWindow.document.close();
        } catch (e) {
            try {
                previewWindow.document.open();
                previewWindow.document.documentElement.innerHTML = html;
                previewWindow.document.close();
            } catch (e2) {
                alert('无法在新窗口写入预览内容，可能被浏览器拦截');
                if (blobUrl) URL.revokeObjectURL(blobUrl);
                return;
            }
        }
        if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    } else {
        const onLoaded = () => {
            try {
                previewWindow.document.title = `预览 - ${currentFileName || 'Markdown'}`;

                const favicon = previewWindow.document.createElement('link');
                favicon.rel = 'icon';
                favicon.type = 'image/svg+xml';
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="90">👁️</text></svg>`;
                try {
                    favicon.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
                } catch (e) {
                    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                    favicon.href = URL.createObjectURL(blob);
                }
                previewWindow.document.head.appendChild(favicon);

                const metaCharset = previewWindow.document.createElement('meta');
                metaCharset.setAttribute('charset', 'UTF-8');
                previewWindow.document.head.insertBefore(metaCharset, previewWindow.document.head.firstChild);
            } catch (e) {
                console.warn('注入页面元信息失败', e);
            }

            try {
                const hasMathLocal = /\$\$[\s\S]+?\$\$|\\\(|\\\[/.test(markdownContent);
                if (!hasMathLocal) return;

                if (previewWindow.MathJax || previewWindow.document.getElementById('mathjax-script')) {
                    if (previewWindow.MathJax && typeof previewWindow.MathJax.typesetPromise === 'function') {
                        const t = previewWindow.document.querySelector('.markdown-body');
                        if (t) previewWindow.MathJax.typesetPromise([t]).catch(e => console.error('MathJax typeset error', e));
                    }
                    return;
                }

                const tryTypeset = (attempt = 0) => {
                    const t = previewWindow.document.querySelector('.markdown-body');
                    if (!t) {
                        if (attempt < 100) return setTimeout(() => tryTypeset(attempt + 1), 200);
                        return console.warn('MathJax: target .markdown-body 未就绪，放弃重试');
                    }
                    if (!previewWindow.MathJax || typeof previewWindow.MathJax.typesetPromise !== 'function') {
                        if (attempt < 100) return setTimeout(() => tryTypeset(attempt + 1), 200);
                        return console.warn('MathJax 未就绪');
                    }
                    previewWindow.MathJax.typesetPromise([t]).catch(err => console.error('MathJax typeset error', err));
                };
                tryTypeset(0);
            } catch (e) {
                console.error('注入 MathJax 失败', e);
            }
        };

        try {
            previewWindow.addEventListener('load', onLoaded);
            setTimeout(() => {
                try { onLoaded(); } catch (_) { }
            }, 300);
        } catch (e) {
            try { onLoaded(); } catch (_) { }
        }

        try {
            previewWindow.addEventListener('beforeunload', () => {
                if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
            });
        } catch (e) {
            setTimeout(() => { if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; } }, 3 * 60 * 1000);
        }
    }
});

elements.closePreview.addEventListener('click', () => {
    elements.previewContainer.style.display = 'none';
});

function detectImageReferences() {
    const markdownImageRegex = /!\[.*?\]\((.*?)\)/g;
    const htmlImageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

    const markdownMatches = [...markdownContent.matchAll(markdownImageRegex)];
    const htmlMatches = [...markdownContent.matchAll(htmlImageRegex)];

    const allImagePaths = [
        ...markdownMatches.map(m => m[1]),
        ...htmlMatches.map(m => m[1])
    ];

    const localImages = allImagePaths.filter(path => {
        return !path.startsWith('http://') && !path.startsWith('https://');
    });

    try {
        const names = localImages.map(p => (p || '').split(/[/\\]/).pop()).filter(Boolean);
        window.referencedImageNames = new Set(names);
    } catch (e) {
        window.referencedImageNames = new Set();
    }

    if (localImages.length > 0) {
        showImageSection(localImages);
    } else {
        if (elements.imageSection) {
            elements.imageSection.style.display = 'none';
        }
    }
}

function showImageSection(referencedImages) {
    if (!elements.imageSection) return;

    elements.imageSection.style.display = 'block';

    const imageFileNames = referencedImages.map(p => p.split(/[/\\]/).pop());
    const uniqueFileNames = [...new Set(imageFileNames)];

    const uploadedCount = Object.keys(uploadedImages).length;
    const totalCount = uniqueFileNames.length;

    if (!elements.imageList) return;

    let html = `
      <div class="image-info">
        <p><strong>📸 检测到文档引用了 ${imageFileNames.length} 处图片 (${uniqueFileNames.length} 个不同文件)</strong></p>
        <p class="image-status">已上传: ${uploadedCount} / ${totalCount}</p>
      </div>
      <div class="image-notice">
        <p><strong>⚠️ 注意事项:</strong></p>
        <ul>
          <li><strong>上传的图片文件名</strong> 要与 <strong>引用的图片文件名</strong> 一致 !</li>
          <li>图片检测支持的 HTML 语法: <code>&lt;img src="image.png"&gt;</code></li>
          <li>图片检测支持的 Markdown 语法: <code>![alt text](image.png)</code></li>
          <li>支持格式: JPG, PNG, GIF, WEBP</li>
          <li>建议图片大小不超过 5MB</li>
        </ul>
      </div>
      <div class="referenced-images">
        <p><strong>需要上传的图片文件名:</strong></p>
        <ul>
    `;

    uniqueFileNames.forEach(fileName => {
        const isUploaded = !!uploadedImages[fileName];
        const status = isUploaded ? '✅' : '❌';

        const refPaths = referencedImages.filter(path => {
            const name = (path || '').split(/[/\\]/).pop();
            return name === fileName;
        });

        const pathsText = refPaths.length > 1 ? ` <small style="color: #64748b;">(${refPaths.length} 处引用)</small>` : '';

        html += `<li>${status} <code>${fileName}</code>${pathsText}</li>`;
    });

    html += `
        </ul>
      </div>
    `;

    if (uploadedCount > 0) {
        html += `
        <div class="uploaded-images">
          <p><strong>已上传的图片:</strong></p>
          <div class="image-grid">
      `;
        Object.entries(uploadedImages).forEach(([name, dataUrl]) => {
            html += `
          <div class="image-item">
            <img src="${dataUrl}" alt="${name}" />
            <div class="image-name">${name}</div>
            <button class="remove-image" onclick="removeImage('${name.replace(/'/g, "\\'")}')">删除</button>
          </div>
        `;
        });
        html += `
          </div>
        </div>
      `;
    }

    elements.imageList.innerHTML = html;
}

function handleImageUpload(files) {
    const refNames = (window.referencedImageNames && window.referencedImageNames.size) ? window.referencedImageNames : null;

    Array.from(files).forEach(file => {
        if (refNames && !refNames.has(file.name)) {
            alert(`❌ ${file.name}: 该图片未在文档中引用，无法上传（请上传文档中引用的图片）`);
            return;
        }

        if (!file.type.match(/image\/(jpeg|jpg|png|gif|webp)/)) {
            alert(`❌ ${file.name}: 不支持的图片格式`);
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            alert(`❌ ${file.name}: 图片大小超过 5MB`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            uploadedImages[file.name] = e.target.result;
            detectImageReferences();
        };
        reader.readAsDataURL(file);
    });
}

window.removeImage = function (imageName) {
    delete uploadedImages[imageName];
    detectImageReferences();
};

function replaceImagePaths(html) {
    return html.replace(/<img([^>]*)src="([^"]+)"([^>]*)>/g, (match, before, src, after) => {
        if (src.startsWith('http://') || src.startsWith('https://')) {
            return match;
        }

        const imageName = src.split(/[/\\]/).pop();
        if (uploadedImages[imageName]) {
            return `<img${before}src="${uploadedImages[imageName]}"${after}>`;
        }

        try {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><text x="10" y="50" fill="red">图片缺失: ${imageName}</text></svg>`;
            const data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            return `<img${before}src="${src}"${after} onerror="this.onerror=null;this.src='${data}'">`;
        } catch (e) {
            return `<img${before}src="${src}"${after}>`;
        }
    });
}

if (elements.uploadImageBtn) {
    elements.uploadImageBtn.addEventListener('click', () => {
        elements.imageInput.click();
    });
}

if (elements.imageInput) {
    elements.imageInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImageUpload(e.target.files);
        }
    });
}

let currentRenderId = null;

elements.generateBtn.addEventListener('click', async () => {
    if (!markdownContent) return;

    currentRenderId = `${currentFileName || 'markdown'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (elements.cancelBtn) elements.cancelBtn.style.display = 'inline-block';

    showProgress('正在准备生成 PDF（上传到服务器）...', 10);

    try {
        const theme = document.getElementById('theme').value;
        const margin = document.getElementById('margin').value;
        const scaleFactor = document.getElementById('scaleFactor').value;
        const forceSingle = !!(elements.forceSinglePage && elements.forceSinglePage.checked);
        const resolution = document.getElementById('resolution') ? document.getElementById('resolution').value : undefined;

        let pageWidth = undefined;
        let format = undefined;
        if (forceSingle) {
            pageWidth = elements.pageWidth.value;
        } else {
            format = elements.pageFormat.value;
        }

        const images = Object.entries(uploadedImages).map(([name, dataUrl]) => ({ name, dataUrl }));

        showProgress('正在分析 Markdown 内容并转换为 PDF 文件 !', 30);

        const payload = {
            markdown: markdownContent,
            theme,
            margin,
            scaleFactor,
            forceSingle,
            resolution,
            fileName: currentFileName || 'markdown',
            images,
            renderId: currentRenderId
        };
        if (forceSingle) {
            payload.pageWidth = pageWidth;
        } else {
            payload.format = format;
        }

        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.status === 204) {
            hideProgress();
            clearUploadedImages();
            return;
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`服务器返回错误: ${res.status} ${res.statusText} ${text}`);
        }

        showProgress('服务器生成完成，正在下载 PDF...', 80);

        const blob = await res.blob();
        const disposition = res.headers.get('content-disposition') || '';
        let filename = `${payload.fileName}-${theme}.pdf`;
        const m = /filename\*?=(?:UTF-8'')?["']?([^;"']+)/i.exec(disposition);
        if (m && m[1]) {
            filename = decodeURIComponent(m[1].replace(/['"]/g, ''));
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showProgress('✅ PDF 下载完成', 100);
        setTimeout(() => { hideProgress(); }, 1200);
    } catch (err) {
        alert('❌ PDF 生成失败: ' + (err && err.message));
        hideProgress();
    } finally {
        if (elements.cancelBtn) elements.cancelBtn.style.display = 'none';
        currentRenderId = null;
    }
});

if (elements.cancelBtn) {
    elements.cancelBtn.addEventListener('click', async () => {
        if (!currentRenderId) return;

        elements.cancelBtn.disabled = true;
        showProgress('正在取消渲染...', 0);

        try {
            const resp = await fetch('/api/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ renderId: currentRenderId })
            });

            if (!resp.ok) {
                let detail = '';
                try {
                    const json = await resp.json();
                    detail = json && json.error ? json.error : JSON.stringify(json);
                } catch (_) {
                    detail = await resp.text().catch(() => resp.statusText);
                }
                alert(`❌ 取消失败: ${detail || resp.statusText}`);
                return;
            }

            showProgress('✅ 已取消渲染', 100);
        } catch (e) {
            console.warn('取消请求失败', e);
            alert('❌ 取消请求失败: ' + (e && e.message ? e.message : '网络或服务器错误'));
        } finally {
            elements.cancelBtn.disabled = false;
            hideProgress();
            if (elements.cancelBtn) elements.cancelBtn.style.display = 'none';
            currentRenderId = null;

            clearUploadedImages();
        }
    });
}

function _ensureProgressMeta() {
    if (!elements.progressContainer) return;
    if (elements.progressContainer.dataset.metaInit) return;

    const row = document.createElement('div');
    row.className = 'progress-row';

    const left = document.createElement('div');
    left.className = 'progress-left';
    const spinner = document.createElement('div');
    spinner.className = 'progress-spinner';
    left.appendChild(spinner);
    if (elements.cancelBtn) {
        left.appendChild(elements.cancelBtn);
    }

    const middle = document.createElement('div');
    middle.className = 'progress-middle';
    middle.appendChild(elements.progressText);
    const existingBar = elements.progressContainer.querySelector('.progress-bar');
    if (existingBar) {
        middle.appendChild(existingBar);
    } else {
        const pb = document.createElement('div');
        pb.className = 'progress-bar';
        const pf = document.createElement('div');
        pf.className = 'progress-fill';
        pf.id = 'progressFill';
        pb.appendChild(pf);
        middle.appendChild(pb);
        elements.progressFill = pf;
    }

    const meta = document.createElement('div');
    meta.className = 'progress-meta';

    const percent = document.createElement('div');
    percent.className = 'progress-percent';
    percent.id = 'progressPercent';
    percent.textContent = '0%';

    const elapsed = document.createElement('div');
    elapsed.className = 'progress-elapsed';
    elapsed.id = 'progressElapsed';
    elapsed.textContent = '0s';

    meta.appendChild(percent);
    meta.appendChild(elapsed);

    row.appendChild(left);
    row.appendChild(middle);
    row.appendChild(meta);

    elements.progressContainer.insertBefore(row, elements.progressContainer.firstChild);

    elements._percent = percent;
    elements._elapsed = elapsed;

    elements.progressFill = elements.progressContainer.querySelector('.progress-fill') || elements.progressFill;

    elements.progressContainer.dataset.metaInit = '1';
}

function showProgress(text, percent) {
    if (!elements.progressContainer) return;
    _ensureProgressMeta();

    elements.progressContainer.style.display = 'block';
    elements.progressText.textContent = text || elements.progressText.textContent;

    if (!elements.progressFill) {
        elements.progressFill = elements.progressContainer.querySelector('.progress-fill');
        if (!elements.progressFill) {
            const pb = elements.progressContainer.querySelector('.progress-bar') || document.createElement('div');
            pb.className = 'progress-bar';
            const pf = document.createElement('div');
            pf.className = 'progress-fill';
            elements.progressFill = pf;
            pb.appendChild(pf);
            elements.progressContainer.appendChild(pb);
        }
    }

    if (typeof percent === 'number' && percent >= 100) {
        _autoDisplayedPercent = 100;
        if (_autoProgressTimer) { clearInterval(_autoProgressTimer); _autoProgressTimer = null; }
    }

    try {
        elements.progressFill.style.width = (_autoDisplayedPercent || 0) + '%';
    } catch (e) {
        console.warn('无法更新 progressFill 宽度', e);
    }

    if (elements._percent) elements._percent.textContent = (_autoDisplayedPercent || 0) + '%';

    if (!_progressStartTs) _progressStartTs = Date.now();
    if (_progressTimer) clearInterval(_progressTimer);
    _progressTimer = setInterval(() => {
        if (!elements._elapsed) return;
        const sec = Math.floor((Date.now() - _progressStartTs) / 1000);
        elements._elapsed.textContent = `${sec}s`;
    }, 500);

    const themeElem = document.getElementById('theme');
    const themeName = themeElem ? themeElem.value : '';

    const THEME_AUTO_DURATIONS_MS = {
        vue: 12000,
        atom: 52000,
        light: 42000,
        github: 12000,
        monokai: 47000,
        solarized: 50000,
    };

    _autoTargetDuration = THEME_AUTO_DURATIONS_MS[themeName] || 50000;

    if ((typeof percent !== 'number' || percent < 100) && currentRenderId) {
        if (_autoProgressTimer) { clearInterval(_autoProgressTimer); _autoProgressTimer = null; }
        _autoProgressStartTs = Date.now();
        _autoDisplayedPercent = 0;

        const stepMs = Math.max(10, Math.floor(_autoTargetDuration / 100));

        _autoProgressTimer = setInterval(() => {
            if (!currentRenderId) {
                _autoDisplayedPercent = 100;
                try { elements.progressFill.style.width = '100%'; } catch (e) { }
                if (elements._percent) elements._percent.textContent = '100%';
                clearInterval(_autoProgressTimer); _autoProgressTimer = null;
                return;
            }

            const elapsed = Date.now() - _autoProgressStartTs;

            if (elapsed >= _autoTargetDuration) {
                if (_autoDisplayedPercent < 99) _autoDisplayedPercent = 99;
            } else {
                if (_autoDisplayedPercent < 99) _autoDisplayedPercent = Math.min(99, _autoDisplayedPercent + 1);
            }

            try {
                elements.progressFill.style.width = (_autoDisplayedPercent || 0) + '%';
            } catch (e) { }
            if (elements._percent) elements._percent.textContent = (_autoDisplayedPercent || 0) + '%';

        }, stepMs);
    }
}

function hideProgress() {
    if (!elements.progressContainer) return;
    elements.progressContainer.style.display = 'none';
    elements.progressFill.style.width = '0%';

    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
    _progressStartTs = null;

    if (_autoProgressTimer) { clearInterval(_autoProgressTimer); _autoProgressTimer = null; }
    _autoProgressStartTs = null;
    _autoDisplayedPercent = 0;

    if (elements._percent) elements._percent.textContent = '0%';
    if (elements._elapsed) elements._elapsed.textContent = '0s';
}

window.addEventListener('DOMContentLoaded', () => {

    const checkDependencies = () => {
        const missing = [];
        if (typeof window.markdownit === 'undefined') missing.push('markdown-it');
        if (typeof window.mermaid === 'undefined') missing.push('mermaid');
        if (typeof window.MathJax === 'undefined') missing.push('MathJax');

        if (missing.length > 0) {
            const msg = `❌ 依赖库加载失败: ${missing.join(', ')}\n\n说明: 本工具仅从本地加载依赖，请确保以下库已放置在项目的 /libs/ 目录并可被访问:\n - markdown-it (markdownit 或 markdown-it.min.js)\n - mermaid (mermaid.min.js)\n\n建议:\n1. 将上述文件复制到 /libs/ 下\n2. 刷新页面重试`;
            console.error(msg);
            alert(msg);
            return false;
        }
        return true;
    };

    setTimeout(() => {
        if (!checkDependencies()) {
            console.log('尝试使用备用 CDN 加载依赖库...');
        }
    }, 2000);

    const initMermaid = () => {
        if (window.mermaid) {
            console.log('初始化 Mermaid...');
            window.mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                themeVariables: {
                    fontFamily: '"Segoe UI", "Segoe UI Emoji", "SF Pro Display", "Apple Color Emoji", "PingFang SC", "Microsoft YaHei", "Noto Color Emoji", sans-serif'
                },
                securityLevel: 'loose',
                logLevel: 'debug',
                flowchart: {
                    useMaxWidth: true,
                    htmlLabels: true,
                    curve: 'basis'
                },
                sequence: {
                    useMaxWidth: true,
                    htmlLabels: true
                },
                gantt: {
                    useMaxWidth: true
                }
            });
            console.log('Mermaid 初始化完成');
        } else {
            console.warn('Mermaid 库未加载,将在加载后自动初始化');
            let retryCount = 0;
            const retryInterval = setInterval(() => {
                retryCount++;
                if (window.mermaid) {
                    clearInterval(retryInterval);
                    initMermaid();
                } else if (retryCount > 20) {
                    clearInterval(retryInterval);
                    console.error('Mermaid 加载超时');
                }
            }, 500);
        }
    };

    initMermaid();
});

function clearUploadedImages() {
    uploadedImages = {};

    try {
        if (elements.imageInput) {
            elements.imageInput.value = '';
        }
        detectImageReferences();
    } catch (e) {
        console.warn('清理上传图片 UI 失败', e);
    }
}
