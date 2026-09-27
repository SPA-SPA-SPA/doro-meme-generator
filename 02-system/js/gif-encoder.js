// ===== GIF89a 编码器 =====
// 移植自 kuaizuoa.alitenna.com（其实现适配自 ring-tool）：
// 全局调色板（关键色 + 帧采样）、Floyd-Steinberg 抖动最近色匹配、
// 帧间差分用透明色索引表达（disposal=1），LZW 压缩输出。
(function (global) {
    'use strict';

    /**
     * 编码GIF图像
     * @param {ImageData[]} frames - 帧数据数组
     * @param {number} w - 宽度
     * @param {number} h - 高度
     * @param {number|number[]} delayOrDelays - 帧延迟（1/100秒）
     * @returns {Uint8Array} GIF二进制数据
     */
    function encodeGIF(frames, w, h, delayOrDelays) {
        var buf = [];
        function writeByte(b) { buf.push(b & 0xff); }
        function writeShort(s) { writeByte(s & 0xff); writeByte((s >> 8) & 0xff); }
        function writeString(s) { for (var i = 0; i < s.length; i++) writeByte(s.charCodeAt(i)); }

        var palette = buildGlobalPalette(frames, w, h);
        var colorTable = palette.colors;
        var palBits = 8;
        var palSize = 1 << palBits;

        writeString('GIF89a');
        writeShort(w);
        writeShort(h);
        writeByte(0x80 | (palBits - 1));
        writeByte(0);
        writeByte(0);

        for (var pi = 0; pi < palSize; pi++) {
            writeByte(colorTable[pi * 3] || 0);
            writeByte(colorTable[pi * 3 + 1] || 0);
            writeByte(colorTable[pi * 3 + 2] || 0);
        }

        // NETSCAPE扩展（循环播放）
        writeByte(0x21); writeByte(0xff); writeByte(11);
        writeString('NETSCAPE2.0');
        writeByte(3); writeByte(1); writeShort(0); writeByte(0);

        var ti = palette.transparentIndex;
        var prevIndexed = null;

        for (var f = 0; f < frames.length; f++) {
            var indexed = quantizeFrame(frames[f].data, w, h, palette);
            var frameIndexed = indexed;
            var disposal;

            if (f === 0) {
                disposal = 0x00;
            } else {
                disposal = 0x05;
                frameIndexed = new Uint8Array(w * h);
                for (var i = 0; i < w * h; i++) {
                    frameIndexed[i] = (indexed[i] === prevIndexed[i]) ? ti : indexed[i];
                }
            }
            prevIndexed = indexed;

            var fd = Array.isArray(delayOrDelays) ? delayOrDelays[f] : delayOrDelays;
            writeByte(0x21); writeByte(0xf9); writeByte(4); writeByte(disposal);
            writeShort(fd); writeByte(ti); writeByte(0);

            writeByte(0x2c);
            writeShort(0); writeShort(0); writeShort(w); writeShort(h);
            writeByte(0);

            var minCodeSize = palBits;
            writeByte(minCodeSize);
            var compressed = lzwEncode(frameIndexed, minCodeSize);
            var pos = 0;
            while (pos < compressed.length) {
                var chunk = Math.min(255, compressed.length - pos);
                writeByte(chunk);
                for (var j = 0; j < chunk; j++) writeByte(compressed[pos++]);
            }
            writeByte(0);
        }

        writeByte(0x3b);
        return new Uint8Array(buf);
    }

    function buildGlobalPalette(frames, w, h) {
        var colors = new Uint8Array(256 * 3);
        var nextSlot = 1; // 0 保留给透明色

        function addColor(r, g, b) {
            if (nextSlot >= 256) return false;
            for (var j = 1; j < nextSlot; j++) {
                var dr = colors[j * 3] - r;
                var dg = colors[j * 3 + 1] - g;
                var db = colors[j * 3 + 2] - b;
                if (dr * dr + dg * dg + db * db < 50) return false;
            }
            colors[nextSlot * 3] = r;
            colors[nextSlot * 3 + 1] = g;
            colors[nextSlot * 3 + 2] = b;
            nextSlot++;
            return true;
        }

        // 添加关键纯色
        var keyColors = [
            [255, 255, 255], [0, 0, 0], [128, 128, 128],
            [255, 0, 0], [0, 255, 0], [0, 0, 255],
            [255, 255, 0], [255, 128, 0], [255, 0, 255],
            [0, 255, 255], [192, 192, 192], [64, 64, 64]
        ];
        for (var k = 0; k < keyColors.length; k++) addColor(keyColors[k][0], keyColors[k][1], keyColors[k][2]);

        // 从帧中采样补充颜色
        var sampleFrames = Math.min(frames.length, 10);
        var seenColors = new Set();

        for (var s0 = 1; s0 < nextSlot; s0++) {
            var key0 = (colors[s0 * 3] << 16) | (colors[s0 * 3 + 1] << 8) | colors[s0 * 3 + 2];
            seenColors.add(key0);
        }

        for (var fi = 0; fi < sampleFrames && nextSlot < 256; fi++) {
            var idx = Math.floor(fi * frames.length / sampleFrames);
            var d = frames[idx].data;
            var step = Math.max(1, Math.floor(w * h / 10000));
            for (var i = 0; i < w * h && nextSlot < 256; i += step) {
                if (d[i * 4 + 3] < 128) continue;
                var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
                var key = (r << 16) | (g << 8) | b;

                if (!seenColors.has(key)) {
                    var tooClose = false;
                    for (var j = 1; j < nextSlot; j++) {
                        var dr = colors[j * 3] - r;
                        var dg = colors[j * 3 + 1] - g;
                        var db = colors[j * 3 + 2] - b;
                        if (dr * dr + dg * dg + db * db < 100) {
                            tooClose = true;
                            break;
                        }
                    }
                    if (!tooClose) {
                        colors[nextSlot * 3] = r;
                        colors[nextSlot * 3 + 1] = g;
                        colors[nextSlot * 3 + 2] = b;
                        seenColors.add(key);
                        nextSlot++;
                    }
                }
            }
        }

        return { colors: colors, transparentIndex: 0, usedCount: nextSlot };
    }

    function quantizeFrame(pixels, w, h, palette) {
        var pc = palette.colors;
        var nc = palette.usedCount || 256;
        var indexed = new Uint8Array(w * h);
        var ti = palette.transparentIndex;

        // Floyd-Steinberg 抖动
        var errR = new Float32Array(w * h);
        var errG = new Float32Array(w * h);
        var errB = new Float32Array(w * h);

        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var i = y * w + x;
                if (pixels[i * 4 + 3] < 128) { indexed[i] = ti; continue; }

                var r = Math.max(0, Math.min(255, pixels[i * 4] + errR[i]));
                var g = Math.max(0, Math.min(255, pixels[i * 4 + 1] + errG[i]));
                var b = Math.max(0, Math.min(255, pixels[i * 4 + 2] + errB[i]));

                var best = 1;
                var bestDist = Infinity;
                for (var j = 1; j < nc; j++) {
                    var dr = r - pc[j * 3];
                    var dg = g - pc[j * 3 + 1];
                    var db = b - pc[j * 3 + 2];
                    var dist = dr * dr + dg * dg + db * db;
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = j;
                    }
                }
                indexed[i] = best;

                var pr = pc[best * 3], pg = pc[best * 3 + 1], pb = pc[best * 3 + 2];
                var er = r - pr, eg = g - pg, eb = b - pb;

                if (x + 1 < w) {
                    errR[i + 1] += er * 7 / 16;
                    errG[i + 1] += eg * 7 / 16;
                    errB[i + 1] += eb * 7 / 16;
                }
                if (y + 1 < h) {
                    if (x > 0) {
                        errR[i + w - 1] += er * 3 / 16;
                        errG[i + w - 1] += eg * 3 / 16;
                        errB[i + w - 1] += eb * 3 / 16;
                    }
                    errR[i + w] += er * 5 / 16;
                    errG[i + w] += eg * 5 / 16;
                    errB[i + w] += eb * 5 / 16;
                    if (x + 1 < w) {
                        errR[i + w + 1] += er * 1 / 16;
                        errG[i + w + 1] += eg * 1 / 16;
                        errB[i + w + 1] += eb * 1 / 16;
                    }
                }
            }
        }
        return indexed;
    }

    function lzwEncode(indexed, minCodeSize) {
        var clearCode = 1 << minCodeSize;
        var eoiCode = clearCode + 1;
        var output = [];
        var codeSize = minCodeSize + 1;
        var nextCode = eoiCode + 1;
        var table = {};

        var codeLimit = function () { return 1 << codeSize; };

        function initTable() {
            table = {};
            for (var i = 0; i < clearCode; i++) table[i] = i;
            nextCode = eoiCode + 1;
            codeSize = minCodeSize + 1;
        }

        var bitBuf = 0, bitCount = 0;

        function writeCode(code) {
            bitBuf |= code << bitCount;
            bitCount += codeSize;
            while (bitCount >= 8) {
                output.push(bitBuf & 0xff);
                bitBuf >>= 8;
                bitCount -= 8;
            }
        }

        initTable();
        writeCode(clearCode);

        if (!indexed.length) {
            writeCode(eoiCode);
            if (bitCount > 0) output.push(bitBuf & 0xff);
            return output;
        }

        var current = indexed[0];
        for (var i = 1; i < indexed.length; i++) {
            var next = indexed[i];
            var key = current + ',' + next;
            if (table[key] !== undefined) {
                current = table[key];
            } else {
                writeCode(current);
                if (nextCode < 4096) {
                    table[key] = nextCode++;
                    if (nextCode > codeLimit() && codeSize < 12) codeSize++;
                } else {
                    writeCode(clearCode);
                    initTable();
                }
                current = next;
            }
        }
        writeCode(current);
        writeCode(eoiCode);
        if (bitCount > 0) output.push(bitBuf & 0xff);
        return output;
    }

    global.GifEncoder = { encodeGIF: encodeGIF };
})(window);
