# 🧊 冰冰冰版 生成器

把一首歌变成「冰冰冰版」——DJ 加速升调、四四拍电子鼓、人声切片 stutter、冰裂音效，全程在浏览器里跑完，不传服务器。

参考效果：[🧊冰爱（雨爱DJ）🧊 — BV1EnhE68EBe](https://www.bilibili.com/video/BV1EnhE68EBe/)

## 用法

1. 打开页面，拖入一个 **MP4 / MP3 / M4A / WAV**（≤120MB）
2. 调「冰度 / 加速倍率 / 鼓组强度 / 冰洞混响」
3. 点「🧊 冰冰冰！」，渲染完可以试听
4. 导出 **WAV** 音频，或导出 **WebM 视频**（1280×720，带冰晶动画和歌名）

## 它是怎么做的

整条链路是纯前端 Web Audio + 手写 DSP，没有一个第三方依赖：

| 环节 | 做法 |
|---|---|
| 解码 | `decodeAudioData`；解不动就回退 `<video>` + `MediaElementSource` + `ScriptProcessor` 实时录流（AC-3/DTS 之类的容器也能救一下） |
| DJ 加速 | 重采样器直接改读写步长 —— 加速即升调，和黑胶 33→45 转一个原理 |
| 节拍分析 | 频谱 flux → 去均值 → 自相关 → **梳状打分**（对 lag×1..4 加权求和，解决半频/倍频） + 相位一致性，0.25 BPM 步长扫 68–200 |
| 网格对齐 | 用检出的 phase / downbeat 把歌曲强拍映射到输出小节边界，切片和鼓都锚在同一个网格上 |
| 鼓组 | kick / clap / hihat / snare / iceCrack / riser 全部程序化合成，噪声用 WeakMap 缓存 |
| 切片 | 在网格上摘 1/16～1 拍的碎片，重复 2–6 次做 stutter，可倒放、可变调、可加冰裂 |
| 混音 | 侧链 pumping（人声让位给鼓）、冰洞 IR 卷积混响、tanh 软膝限幅 |
| 导出 | 手写 16bit PCM WAV 编码器；视频走 `canvas.captureStream(30)` + `MediaRecorder`（vp9/opus） |

## 本地开发

没有构建步骤，任何静态服务器都行：

```bash
node test/serve.js 8199
# 打开 http://127.0.0.1:8199/
```

`test/` 下有一套跑在 headless Chrome 里的自动化测试（CDP 驱动）：

```bash
node test/tempo.js test/fx128.wav     # 节拍检测精度
node test/drive.js                    # harness 全链路
node test/dump.js http://127.0.0.1:8199/ test/song45.mp4 out.wav 3 1.25 0.8 0.3 180
node test/analyze.js test/out/out.wav # 客观量测（峰值/RMS/网格强度/削波）
node test/ui-test.js                  # 端到端 UI
```

## 浏览器要求

Chrome / Edge 90+（需要 Web Audio、`MediaRecorder`、`captureStream`）。Safari 能渲染和导出 WAV，视频导出可能不行。

## License

MIT
