// ===== doro 表情包生成器 主逻辑 =====
// 功能与布局沿用 kuaizuoa.alitenna.com 的交互设计（文字/字号/微调位置/速度/头像裁剪），
// 底图换成清理后的 doro 动画，仅保留 GIF 导出。经典脚本写法，支持 file:// 直接打开。
(function (global) {
    'use strict';

    // ===== 国际化 =====
    var i18n = {
        zh: {
            title: '快做啊!',
            btn_lang: 'EN',
            section_avatar: '头像',
            section_text: '文字',
            section_speed: '速度',
            section_export: '导出',
            avatar_upload_hint: '点击或拖拽上传头像',
            avatar_upload_formats: '支持 JPG、PNG 格式',
            avatar_recrop: '重新裁剪',
            avatar_replace: '更换头像',
            placeholder_text: '输入文字...',
            label_fine_tune: '微调位置',
            label_avatar_tune: '头像位置',
            label_text_size: '字号',
            label_avatar_size: '大小',
            label_text_x: '左右',
            label_text_y: '上下',
            label_avatar_fx: '旋转 + 弹跳动效',
            btn_export_gif: '导出 GIF',
            export_status_generating: '正在生成...',
            export_status_encoding: '正在编码...',
            export_status_done: '导出成功！',
            export_status_error: '导出失败',
            crop_title: '裁剪头像',
            crop_confirm: '确认',
            crop_cancel: '取消',
            preview_tip: '提示：可直接在预览图上拖动头像调整位置'
        },
        en: {
            title: 'Do it!',
            btn_lang: '中',
            section_avatar: 'Avatar',
            section_text: 'Text',
            section_speed: 'Speed',
            section_export: 'Export',
            avatar_upload_hint: 'Click or drag to upload',
            avatar_upload_formats: 'JPG, PNG supported',
            avatar_recrop: 'Re-crop',
            avatar_replace: 'Replace',
            placeholder_text: 'Enter text...',
            label_fine_tune: 'Position',
            label_avatar_tune: 'Avatar Position',
            label_text_size: 'Size',
            label_avatar_size: 'Size',
            label_text_x: 'Horizontal',
            label_text_y: 'Vertical',
            label_avatar_fx: 'Spin + bounce FX',
            btn_export_gif: 'Export GIF',
            export_status_generating: 'Generating...',
            export_status_encoding: 'Encoding...',
            export_status_done: 'Exported!',
            export_status_error: 'Export failed',
            crop_title: 'Crop Avatar',
            crop_confirm: 'OK',
            crop_cancel: 'Cancel',
            preview_tip: 'Tip: drag the avatar directly on the preview'
        }
    };

    var currentLang = localStorage.getItem('doro-lang') || 'zh';

    function t(key) {
        return (i18n[currentLang] && i18n[currentLang][key]) || i18n.zh[key] || key;
    }

    function applyLang() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            var text = t(key);
            if (el.tagName === 'INPUT' && el.type !== 'checkbox') {
                el.placeholder = text;
            } else {
                el.textContent = text;
            }
        });
        var langBtn = document.getElementById('langBtn');
        if (langBtn) langBtn.textContent = t('btn_lang');
    }

    function initI18n() {
        applyLang();
    }

    function toggleLang() {
        currentLang = currentLang === 'zh' ? 'en' : 'zh';
        localStorage.setItem('doro-lang', currentLang);
        applyLang();
    }

    // ===== 全局状态 =====
    var state = {
        // 底图帧
        templateFrames: [],   // [{canvas, delay}]
        templateWidth: 500,
        templateHeight: 500,
        templateLoaded: false,

        // 头像
        avatarCanvas: null,   // 裁剪后的 512x512 canvas
        avatarX: 438,         // 头像中心X（相对底图尺寸）
        avatarY: 380,         // 头像中心Y
        avatarSize: 120,      // 头像直径
        avatarFx: true,       // 旋转+弹跳动效

        // 文字
        textContent: '快做啊！',
        textSize: 52,
        textColor: '#20222b',
        textX: 250,
        textY: 462,

        // 速度（1.0 = doro 原始 GIF 的原生节奏）
        speed: 1.0,

        // 头像动效参数（与参考站一致，按周期比例）
        spinSpeed: 1.2,        // 每GIF周期旋转圈数
        spinMinScale: 0.2,     // 旋转最小缩放
        bounceAmplitude: 0.3,  // 弹跳幅度（头像直径比例）
        bouncePhase: 15 / 23,  // 弹跳峰值位置
        bounceRise: 5.5 / 23,  // 起飞时间
        bounceHang: 0,         // 滞空时间
        bounceFall: 2.5 / 23,  // 落地时间
        spinAngle: 0,          // 累积旋转角度（运行时状态）

        // 预览
        previewPlaying: false,
        currentFrame: 0,
        animationId: null,

        // Cropper
        cropper: null
    };

    var EXPORT_SIZE = 512;

    // ===== Y轴旋转 + 弹跳效果 =====
    function computeBounce(t, peakAt, riseTime, hangTime, fallTime) {
        var dt = t - peakAt;
        if (dt > 0.5) dt -= 1;
        if (dt < -0.5) dt += 1;

        if (dt >= -riseTime && dt < 0) {
            var p = (dt + riseTime) / riseTime;
            return Math.sin(p * Math.PI / 2);
        } else if (dt >= 0 && dt < hangTime) {
            return 1.0;
        } else if (dt >= hangTime && dt < hangTime + fallTime) {
            var p2 = (dt - hangTime) / fallTime;
            return Math.cos(p2 * Math.PI / 2);
        }
        return 0;
    }

    function getSpinTransform(frameIndex, totalFrames) {
        // 旋转：连续累积，保留翻转但跳过纸片薄相
        var anglePerFrame = (2 * Math.PI * state.spinSpeed) / totalFrames;
        state.spinAngle += anglePerFrame;
        var raw = Math.cos(state.spinAngle);
        var sign = raw >= 0 ? 1 : -1;
        var min = state.spinMinScale;
        var scaleX = sign * Math.max(Math.abs(raw), min);

        // 弹跳
        var t = frameIndex / totalFrames;
        var bounceY = -computeBounce(t, state.bouncePhase, state.bounceRise, state.bounceHang, state.bounceFall)
            * state.bounceAmplitude;

        return { scaleX: scaleX, bounceY: bounceY };
    }

    // ===== 文字渲染 =====
    var defaultFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Microsoft YaHei", sans-serif';

    function drawText(ctx, scale) {
        if (!state.textContent) return;
        var text = state.textContent;
        var fontSize = state.textSize * scale;
        ctx.font = 'bold ' + fontSize + 'px ' + defaultFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var x = state.textX * scale;
        var y = state.textY * scale;

        ctx.fillStyle = state.textColor;
        ctx.fillText(text, x, y);
    }

    // ===== 逐帧合成 =====
    function compositeFrame(ctx, frameIndex, outputSize) {
        var frames = state.templateFrames;
        if (!frames.length) return;

        var fi = frameIndex % frames.length;
        var tw = state.templateWidth;
        var th = state.templateHeight;
        var w = outputSize || tw;
        var h = outputSize ? Math.round(outputSize * th / tw) : th;
        var scale = w / tw;

        ctx.canvas.width = w;
        ctx.canvas.height = h;
        ctx.clearRect(0, 0, w, h);

        // ① 底图帧
        ctx.drawImage(frames[fi].canvas, 0, 0, w, h);

        // ② 头像（Y轴旋转 + 弹跳）
        if (state.avatarCanvas) {
            var scaleX = 1, bounceY = 0;
            if (state.avatarFx) {
                var tr = getSpinTransform(fi, frames.length);
                scaleX = tr.scaleX;
                bounceY = tr.bounceY;
            }
            var size = state.avatarSize * scale;
            var cx = state.avatarX * scale;
            var cy = state.avatarY * scale;
            var radius = size / 2;
            var bounceOffset = bounceY * size;

            ctx.save();
            ctx.translate(cx, cy + bounceOffset);
            ctx.scale(scaleX, 1);

            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();

            ctx.drawImage(state.avatarCanvas, -radius, -radius, size, size);
            ctx.restore();
        }

        // ③ 文字
        drawText(ctx, scale);
    }

    // ===== 导出帧生成 =====
    // 帧跳过+延迟误差扩散实现倍速；最小延迟2cs保证浏览器兼容
    function generateAllFrames(outputSize) {
        var templateFrames = state.templateFrames;
        if (!templateFrames.length) return { frames: [], delays: [] };

        var tw = state.templateWidth;
        var th = state.templateHeight;
        var w = outputSize || tw;
        var h = outputSize ? Math.round(outputSize * th / tw) : th;

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');

        var savedAngle = state.spinAngle;
        state.spinAngle = 0;

        var totalCount = templateFrames.length;
        var MIN_CS = 2; // 浏览器GIF最小安全延迟（<2cs可能被浏览器强制为10cs）

        var originalTotalCs = templateFrames.reduce(function (sum, f) { return sum + f.delay; }, 0);
        var targetTotalCs = Math.max(totalCount, Math.round(originalTotalCs / state.speed));

        var idealDelayPerFrame = targetTotalCs / totalCount;
        var selectedIndices;

        if (idealDelayPerFrame >= MIN_CS) {
            selectedIndices = Array.from({ length: totalCount }, function (_, i) { return i; });
        } else {
            var keepCount = Math.max(1, Math.floor(targetTotalCs / MIN_CS));
            selectedIndices = [];
            for (var i = 0; i < keepCount; i++) {
                selectedIndices.push(Math.min(Math.round(i * totalCount / keepCount), totalCount - 1));
            }
        }

        var idealDelayPerSelected = targetTotalCs / selectedIndices.length;
        var frameDelays = [];
        var errorAccum = 0;
        for (var k = 0; k < selectedIndices.length; k++) {
            var ideal = idealDelayPerSelected + errorAccum;
            var rounded = Math.max(MIN_CS, Math.round(ideal));
            errorAccum = ideal - rounded;
            frameDelays.push(rounded);
        }

        var frames = [];
        var delays = [];
        var nextSel = 0;

        for (var fi = 0; fi < totalCount; fi++) {
            compositeFrame(ctx, fi, outputSize);
            if (nextSel < selectedIndices.length && selectedIndices[nextSel] === fi) {
                frames.push(ctx.getImageData(0, 0, w, h));
                delays.push(frameDelays[nextSel]);
                nextSel++;
            }
        }

        state.spinAngle = savedAngle;

        return { frames: frames, delays: delays, width: w, height: h };
    }

    // ===== 实时预览 =====
    var previewCanvas = null;
    var previewCtx = null;
    var lastFrameTime = 0;

    function initPreview(canvas) {
        previewCanvas = canvas;
        previewCtx = canvas.getContext('2d');
    }

    function startPreview() {
        if (state.previewPlaying) return;
        state.previewPlaying = true;
        state.currentFrame = 0;
        lastFrameTime = performance.now();
        tick();
    }

    function tick() {
        if (!state.previewPlaying || !state.templateLoaded) return;

        var now = performance.now();
        var frames = state.templateFrames;
        if (!frames.length) return;

        // 按实际经过时间推进帧，高倍速时正确跳帧
        var advanced = false;
        var elapsed = now - lastFrameTime;
        while (elapsed > 0) {
            var fi = state.currentFrame % frames.length;
            var frameDelay = frames[fi].delay * 10 / state.speed;
            if (elapsed < frameDelay) break;
            elapsed -= frameDelay;
            lastFrameTime += frameDelay;
            state.currentFrame = (state.currentFrame + 1) % frames.length;
            advanced = true;
        }

        if (advanced) renderFrame();
        state.animationId = requestAnimationFrame(tick);
    }

    function renderFrame() {
        if (!previewCtx || !state.templateLoaded) return;
        var containerSize = previewCanvas.parentElement.clientWidth;
        compositeFrame(previewCtx, state.currentFrame, containerSize);
    }

    // ===== 底图加载 =====
    async function loadTemplate() {
        try {
            var uri = global.DORO_GIF_DATA_URI;
            if (!uri) {
                console.error('缺少 doro-data.js 底图数据');
                return false;
            }
            var base64 = uri.split(',')[1];
            var bin = atob(base64);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            var result = await GifParser.extractGifFrames(bytes.buffer);
            if (!result || !result.frames.length) {
                console.error('底图帧提取失败');
                return false;
            }
            state.templateFrames = result.frames;
            state.templateWidth = result.width;
            state.templateHeight = result.height;
            state.templateLoaded = true;
            return true;
        } catch (e) {
            console.error('底图加载失败:', e);
            return false;
        }
    }

    // ===== 头像上传 + Cropper 裁剪 =====
    var cropperInstance = null;
    var cropImageURL = null;

    function initAvatar() {
        var uploadArea = document.getElementById('avatarUploadArea');
        var fileInput = document.getElementById('avatarInput');

        uploadArea.addEventListener('click', function () { fileInput.click(); });

        uploadArea.addEventListener('dragover', function (e) {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });
        uploadArea.addEventListener('dragleave', function () {
            uploadArea.classList.remove('drag-over');
        });
        uploadArea.addEventListener('drop', function (e) {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            var file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) handleFile(file);
        });

        fileInput.addEventListener('change', function () {
            if (fileInput.files[0]) handleFile(fileInput.files[0]);
            fileInput.value = '';
        });

        document.getElementById('avatarRecropBtn').addEventListener('click', function () {
            if (cropImageURL) openCropModal(cropImageURL);
        });

        document.getElementById('avatarReplaceBtn').addEventListener('click', function () {
            fileInput.click();
        });

        document.getElementById('cropConfirm').addEventListener('click', confirmCrop);
        document.getElementById('cropCancel').addEventListener('click', closeCropModal);

        document.getElementById('cropModal').addEventListener('click', function (e) {
            if (e.target.id === 'cropModal') closeCropModal();
        });
    }

    function handleFile(file) {
        if (cropImageURL) URL.revokeObjectURL(cropImageURL);
        cropImageURL = URL.createObjectURL(file);
        openCropModal(cropImageURL);
    }

    function openCropModal(url) {
        var modal = document.getElementById('cropModal');
        var img = document.getElementById('cropImage');
        img.src = url;
        modal.style.display = 'flex';

        img.onload = function () {
            if (cropperInstance) cropperInstance.destroy();
            cropperInstance = new Cropper(img, {
                aspectRatio: 1,
                viewMode: 1,
                dragMode: 'move',
                autoCropArea: 1,
                cropBoxResizable: true,
                guides: false,
                center: true,
                highlight: false,
                background: false
            });
        };
    }

    function closeCropModal() {
        var modal = document.getElementById('cropModal');
        modal.style.display = 'none';
        if (cropperInstance) {
            cropperInstance.destroy();
            cropperInstance = null;
        }
    }

    function confirmCrop() {
        if (!cropperInstance) return;

        var croppedCanvas = cropperInstance.getCroppedCanvas({
            width: 512,
            height: 512
        });

        state.avatarCanvas = croppedCanvas;
        closeCropModal();
        updateThumb();
        renderFrame();
    }

    function updateThumb() {
        var uploadArea = document.getElementById('avatarUploadArea');
        var thumbWrap = document.getElementById('avatarThumb');
        var thumbImg = document.getElementById('avatarThumbImg');

        if (state.avatarCanvas) {
            thumbImg.src = state.avatarCanvas.toDataURL();
            uploadArea.style.display = 'none';
            thumbWrap.style.display = 'flex';
        } else {
            uploadArea.style.display = 'flex';
            thumbWrap.style.display = 'none';
        }
    }

    // ===== 预览画布上直接拖动头像 =====
    function initCanvasDrag() {
        var dragging = false;

        function toTemplateCoords(e) {
            var rect = previewCanvas.getBoundingClientRect();
            var tw = state.templateWidth;
            return {
                x: (e.clientX - rect.left) * (tw / rect.width),
                y: (e.clientY - rect.top) * (tw / rect.height)
            };
        }

        function overAvatar(e) {
            if (!state.avatarCanvas) return false;
            var p = toTemplateCoords(e);
            var dx = p.x - state.avatarX;
            var dy = p.y - state.avatarY;
            return Math.sqrt(dx * dx + dy * dy) <= state.avatarSize / 2 + 12;
        }

        previewCanvas.addEventListener('pointerdown', function (e) {
            if (!overAvatar(e)) return;
            dragging = true;
            previewCanvas.classList.add('avatar-drag');
            previewCanvas.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        previewCanvas.addEventListener('pointermove', function (e) {
            if (dragging) {
                var p = toTemplateCoords(e);
                state.avatarX = Math.max(0, Math.min(state.templateWidth, Math.round(p.x)));
                state.avatarY = Math.max(0, Math.min(state.templateHeight, Math.round(p.y)));
                syncSlider('avatarX', 'avatarXVal', state.avatarX);
                syncSlider('avatarY', 'avatarYVal', state.avatarY);
                renderFrame();
            } else {
                previewCanvas.style.cursor = overAvatar(e) ? 'grab' : 'default';
            }
        });

        previewCanvas.addEventListener('pointerup', function () {
            dragging = false;
            previewCanvas.classList.remove('avatar-drag');
        });
    }

    function syncSlider(sliderId, valId, v) {
        var slider = document.getElementById(sliderId);
        var valEl = document.getElementById(valId);
        if (slider) slider.value = v;
        if (valEl) valEl.textContent = v;
    }

    // ===== UI 交互 =====
    function initUI() {
        initDarkMode();
        initLangToggle();
        initExpandableSections();
        initTextControls();
        initAvatarControls();
        initSpeedControl();
        initExportControls();
    }

    function initExpandableSections() {
        document.querySelectorAll('.expandable-header').forEach(function (header) {
            header.addEventListener('click', function () {
                var body = header.nextElementSibling;
                var arrow = header.querySelector('.expand-arrow');
                var isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : 'block';
                if (arrow) arrow.classList.toggle('expanded', !isOpen);
            });
        });
    }

    function initDarkMode() {
        var btn = document.getElementById('darkModeBtn');
        var stored = localStorage.getItem('doro-dark');
        if (stored === 'true') document.body.classList.add('dark-mode');
        updateDarkIcon();

        btn.addEventListener('click', function () {
            document.body.classList.toggle('dark-mode');
            localStorage.setItem('doro-dark', document.body.classList.contains('dark-mode'));
            updateDarkIcon();
        });
    }

    function updateDarkIcon() {
        var isDark = document.body.classList.contains('dark-mode');
        document.querySelector('.icon-sun').style.display = isDark ? 'none' : 'block';
        document.querySelector('.icon-moon').style.display = isDark ? 'block' : 'none';
    }

    function initLangToggle() {
        document.getElementById('langBtn').addEventListener('click', function () {
            toggleLang();
        });
    }

    function initTextControls() {
        var contentInput = document.getElementById('textContent');
        contentInput.addEventListener('input', function () {
            state.textContent = contentInput.value;
            renderFrame();
        });

        bindSlider('textSize', 'textSizeVal', function (v) { state.textSize = v; renderFrame(); });
        bindSlider('textX', 'textXVal', function (v) { state.textX = v; renderFrame(); });
        bindSlider('textY', 'textYVal', function (v) { state.textY = v; renderFrame(); });
    }

    function initAvatarControls() {
        bindSlider('avatarX', 'avatarXVal', function (v) { state.avatarX = v; renderFrame(); });
        bindSlider('avatarY', 'avatarYVal', function (v) { state.avatarY = v; renderFrame(); });
        bindSlider('avatarSize', 'avatarSizeVal', function (v) { state.avatarSize = v; renderFrame(); });

        var fx = document.getElementById('avatarFx');
        fx.addEventListener('change', function () {
            state.avatarFx = fx.checked;
            renderFrame();
        });
    }

    function initSpeedControl() {
        var slider = document.getElementById('speed');
        var valEl = document.getElementById('speedVal');
        if (!slider) return;

        slider.addEventListener('input', function () {
            var v = parseFloat(slider.value);
            if (valEl) valEl.textContent = v.toFixed(1);
            state.speed = v;
        });
    }

    function initExportControls() {
        var statusEl = document.getElementById('exportStatus');
        var btn = document.getElementById('exportGifBtn');

        function onProgress(status) {
            statusEl.textContent = t('export_status_' + status);
            if (status === 'done') setTimeout(function () { statusEl.textContent = ''; }, 3000);
        }

        btn.addEventListener('click', async function () {
            btn.disabled = true;
            try {
                await exportGIF(onProgress);
            } catch (e) {
                console.error('导出失败:', e);
                onProgress('error');
            } finally {
                btn.disabled = false;
            }
        });
    }

    function bindSlider(sliderId, valId, onChange, formatter) {
        var slider = document.getElementById(sliderId);
        var valEl = document.getElementById(valId);
        if (!slider) return;

        slider.addEventListener('input', function () {
            var v = parseInt(slider.value);
            if (valEl) valEl.textContent = formatter ? formatter(v) : v;
            onChange(v);
        });
    }

    // ===== 导出 =====
    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    async function exportGIF(onProgress) {
        onProgress && onProgress('generating');
        await new Promise(function (r) { setTimeout(r, 50); });

        var result = generateAllFrames(EXPORT_SIZE);
        if (!result.frames.length) {
            onProgress && onProgress('error');
            return;
        }

        onProgress && onProgress('encoding');
        await new Promise(function (r) { setTimeout(r, 50); });

        var gifData = GifEncoder.encodeGIF(result.frames, result.width, result.height, result.delays);
        downloadBlob(new Blob([gifData], { type: 'image/gif' }), '快做啊.gif');
        onProgress && onProgress('done');
    }

    // ===== 调试/测试钩子 =====
    global.__debugExportGifBlob = async function () {
        var result = generateAllFrames(EXPORT_SIZE);
        var gifData = GifEncoder.encodeGIF(result.frames, result.width, result.height, result.delays);
        return new Blob([gifData], { type: 'image/gif' });
    };

    global.App = {
        state: state,
        exportGIF: exportGIF,
        compositeFrame: compositeFrame,
        renderFrame: renderFrame
    };

    // ===== 初始化 =====
    document.addEventListener('DOMContentLoaded', async function () {
        initI18n();
        initUI();
        initAvatar();

        var canvas = document.getElementById('previewCanvas');
        initPreview(canvas);
        initCanvasDrag();

        var ok = await loadTemplate();
        if (ok) {
            startPreview();
        }
    });
})(window);
