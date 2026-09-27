# 快做啊! - doro 表情包生成器

一个开箱即用的 doro 表情包生成器：上传头像（自动叠加旋转+弹跳动效）、输入文字、
调节字号/位置/播放速度，一键导出 GIF。纯静态实现，在线、本地均可运行。

交互与视觉版式参考 [kuaizuoa.alitenna.com](https://kuaizuoa.alitenna.com/)，
底图为已清理的 doro 动画（去除了原素材中烘焙的文字与第三方头像贴片）。

## 在线使用

部署到 GitHub Pages 后，直接把站点链接发给朋友即可，手机浏览器也能用。

## 本地使用

**双击 `index.html`** 即可运行，无需安装任何依赖，完全离线可用
（也可用任意静态服务器托管本目录）。

## 功能

- 头像：上传后圆形裁剪（Cropper.js），自带淡青色描边与 Y 轴旋转 + 弹跳动效（动效可关），
  支持在预览图上直接拖动调整位置
- 文字：内容 / 字号 / 左右上下微调
- 速度：0.5–3.0 倍速（1.0 为原始 GIF 原生节奏）
- 导出：仅 GIF（512×512，循环播放）

## 目录结构

```
index.html            页面入口
css/style.css         样式（含深色模式、移动端适配）
js/app.js             主逻辑：合成 / 动效 / 预览 / 裁剪 / 导出 / 双语
js/gif-parser.js      GIF 解帧
js/gif-encoder.js     GIF89a 编码器
js/doro-data.js       doro 底图（base64 内嵌，更换底图改这里）
vendor/cropper/       Cropper.js 1.6.2
```

## 部署（GitHub Pages）

推送后 GitHub Actions 会自动把本目录发布为 Pages 站点
（工作流见 `.github/workflows/deploy.yml`）。若首次部署未生效，
到仓库 Settings → Pages 把 Source 设为 **GitHub Actions** 再重跑工作流。

## 说明与致谢

- 交互设计与 GIF 解帧/编码算法移植自 kuaizuoa.alitenna.com（其实现适配自 ring-tool）
- doro 素材版权归原作者所有，本项目仅供个人娱乐，请勿用于商业用途
