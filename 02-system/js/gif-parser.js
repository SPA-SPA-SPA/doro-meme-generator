// ===== GIF 帧提取 =====
// 算法与 kuaizuoa.alitenna.com（其实现适配自 ring-tool）一致的移植版：
// 先扫一遍 GIF 结构拿每帧延迟/处置方式，再优先用 WebCodecs ImageDecoder 精确解码，
// 环境不支持时退化为 <img> 轮询采样。输出为逐帧合成完毕的整幅 canvas。
(function (global) {
    'use strict';

    function extractGifFrames(arrayBuffer) {
        return new Promise(function (resolve) {
            var delays = [];
            var disposals = [];
            var d = new Uint8Array(arrayBuffer);
            if (String.fromCharCode(d[0], d[1], d[2]) !== 'GIF') {
                resolve(null);
                return;
            }
            var packed = d[10], hasGCT = (packed >> 7) & 1;
            var gctSize = hasGCT ? 3 * (1 << ((packed & 7) + 1)) : 0;
            var pos = 13 + gctSize;
            var frameCount = 0;

            try {
                while (pos < d.length) {
                    var b = d[pos++];
                    if (b === 0x3B) break;
                    if (b === 0x21) {
                        var label = d[pos++];
                        if (label === 0xF9) {
                            pos++;
                            var packedGce = d[pos++];
                            var disposal = (packedGce >> 2) & 0x07;
                            disposals.push(disposal);
                            var delay = d[pos] | (d[pos + 1] << 8);
                            delays.push(Math.max(2, delay));
                            pos += 2;
                            pos += 2;
                        } else {
                            while (pos < d.length) {
                                var sz = d[pos++];
                                if (sz === 0) break;
                                pos += sz;
                            }
                        }
                    } else if (b === 0x2C) {
                        frameCount++;
                        pos += 8;
                        var ipacked = d[pos++];
                        var hasLCT = (ipacked >> 7) & 1;
                        var lctSz = hasLCT ? 3 * (1 << ((ipacked & 7) + 1)) : 0;
                        pos += lctSz;
                        pos++;
                        while (pos < d.length) {
                            var sz2 = d[pos++];
                            if (sz2 === 0) break;
                            pos += sz2;
                        }
                    }
                }
            } catch (e) { console.warn('GIF header parse error:', e); }

            if (frameCount < 1) {
                resolve(null);
                return;
            }

            while (delays.length < frameCount) delays.push(10);
            while (disposals.length < frameCount) disposals.push(1);

            if (typeof global.ImageDecoder !== 'undefined') {
                extractWithImageDecoder(arrayBuffer, delays, disposals, resolve);
            } else {
                extractWithImgElement(arrayBuffer, frameCount, delays, resolve);
            }
        });
    }

    function extractWithImageDecoder(arrayBuffer, delays, disposals, resolve) {
        var decoder = new ImageDecoder({ type: 'image/gif', data: arrayBuffer });
        var decoderClosed = false;

        function closeDecoder() {
            if (!decoderClosed) {
                decoderClosed = true;
                try { decoder.close(); } catch (e) { /* ignore */ }
            }
        }

        decoder.tracks.ready.then(function () {
            var track = decoder.tracks.selectedTrack;
            var count = track.frameCount;
            var frames = [];
            var compCanvas = document.createElement('canvas');
            var compCtx = null;
            var prevCanvas = null;

            function finish() {
                closeDecoder();
                var totalDuration = frames.reduce(function (s, f) { return s + f.delay * 10; }, 0);
                resolve({ width: compCanvas.width, height: compCanvas.height, frames: frames, totalDuration: totalDuration });
            }

            function decodeNext(i) {
                if (i >= count) { finish(); return; }
                decoder.decode({ frameIndex: i }).then(function (result) {
                    var vf = result.image;
                    if (i === 0) {
                        compCanvas.width = vf.displayWidth;
                        compCanvas.height = vf.displayHeight;
                        compCtx = compCanvas.getContext('2d');
                        compCtx.clearRect(0, 0, compCanvas.width, compCanvas.height);
                    }

                    var disposal = i < disposals.length ? disposals[i] : 1;

                    if (disposal === 3 && !prevCanvas) {
                        prevCanvas = document.createElement('canvas');
                        prevCanvas.width = compCanvas.width;
                        prevCanvas.height = compCanvas.height;
                        prevCanvas.getContext('2d').drawImage(compCanvas, 0, 0);
                    }

                    compCtx.drawImage(vf, 0, 0);
                    vf.close();

                    var snap = document.createElement('canvas');
                    snap.width = compCanvas.width;
                    snap.height = compCanvas.height;
                    snap.getContext('2d').drawImage(compCanvas, 0, 0);
                    var delay = i < delays.length ? delays[i] : 10;
                    frames.push({ canvas: snap, delay: delay });

                    if (disposal === 2) {
                        compCtx.clearRect(0, 0, compCanvas.width, compCanvas.height);
                    } else if (disposal === 3 && prevCanvas) {
                        compCtx.clearRect(0, 0, compCanvas.width, compCanvas.height);
                        compCtx.drawImage(prevCanvas, 0, 0);
                        prevCanvas = null;
                    }

                    decodeNext(i + 1);
                }).catch(function () {
                    closeDecoder();
                    if (frames.length >= 1) {
                        var totalDuration = frames.reduce(function (s, f) { return s + f.delay * 10; }, 0);
                        resolve({ width: compCanvas.width, height: compCanvas.height, frames: frames, totalDuration: totalDuration });
                    } else {
                        resolve(null);
                    }
                });
            }
            decodeNext(0);
        }).catch(function () {
            closeDecoder();
            resolve(null);
        });
    }

    function extractWithImgElement(arrayBuffer, frameCount, delays, resolve) {
        var blob = new Blob([arrayBuffer], { type: 'image/gif' });
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
            var w = img.naturalWidth, h = img.naturalHeight;
            var frames = [];
            var captureCanvas = document.createElement('canvas');
            captureCanvas.width = w;
            captureCanvas.height = h;
            var cCtx = captureCanvas.getContext('2d');
            var lastHash = '';
            var capturedCount = 0;
            var maxCaptures = frameCount * 3;
            var attempts = 0;
            var totalDurationMs = delays.reduce(function (s, d) { return s + d * 10; }, 0);
            var interval = Math.max(16, Math.floor(totalDurationMs / frameCount * 0.8));

            function finish() {
                URL.revokeObjectURL(url);
                if (frames.length >= 1) {
                    var td = frames.reduce(function (s, f) { return s + f.delay * 10; }, 0);
                    resolve({ width: w, height: h, frames: frames, totalDuration: td });
                } else {
                    resolve(null);
                }
            }

            function capture() {
                attempts++;
                if (capturedCount >= frameCount || attempts > maxCaptures) { finish(); return; }
                cCtx.clearRect(0, 0, w, h);
                cCtx.drawImage(img, 0, 0);

                var sample = cCtx.getImageData(0, 0, Math.min(w, 32), Math.min(h, 32)).data;
                var hash = 0;
                for (var i = 0; i < sample.length; i += 37) hash = ((hash << 5) - hash + sample[i]) | 0;
                var hashStr = '' + hash;

                if (hashStr !== lastHash) {
                    lastHash = hashStr;
                    var snap = document.createElement('canvas');
                    snap.width = w;
                    snap.height = h;
                    snap.getContext('2d').drawImage(captureCanvas, 0, 0);
                    var delay = capturedCount < delays.length ? delays[capturedCount] : 10;
                    frames.push({ canvas: snap, delay: delay });
                    capturedCount++;
                }
                setTimeout(capture, interval);
            }
            capture();
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        img.src = url;
    }

    global.GifParser = { extractGifFrames: extractGifFrames };
})(window);
