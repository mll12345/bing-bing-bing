# 🧊 冰冰冰版 生成器

把一首歌的**每一个字**都换成一个「冰」——音高跟着原唱走，旋律还是那首，歌词全是冰冰冰。

全程在浏览器里跑完，不传服务器。**没有 DJ 加速、没有升调、没有四四拍鼓机**，就是原曲 + 冰声。

参考效果：[🧊 冰冰冰 音效 — BV1HEho6LERf](https://www.bilibili.com/video/BV1HEho6LERf) · [🧊冰爱（雨爱DJ）🧊 — BV1EnhE68EBe](https://www.bilibili.com/video/BV1EnhE68EBe/)

## 用法

1. 打开页面，拖入一个 **MP4 / MP3 / M4A / WAV**（≤120MB）
2. 调「冰声音量 / 冰声音色 / 原唱残留 / 冰洞混响 / 冰裂点缀」
3. 点「🧊 冰冰冰！」，渲染完可以试听
4. 导出 **WAV** 音频，或导出 **WebM 视频**（1280×720，带冰晶动画和歌名）

## 它是怎么做的

整条链路是纯前端 Web Audio + 手写 DSP，没有一个第三方依赖：

| 环节 | 做法 |
|---|---|
| 解码 | `decodeAudioData`；解不动就回退 `<video>` + `MediaElementSource` + `ScriptProcessor` 实时录流（AC-3/DTS 之类的容器也能救一下） |
| 人声分离 | 立体声里人声几乎总在正中。手写 FFT（`src/fft.js`）做 STFT，逐帧逐频点算 mid/(mid+side) 得到软掩蔽；分离出的人声先限带 170Hz 再减，低频 kick/贝斯因此完整留在伴奏里 |
| 旋律跟踪 | 16kHz 下采样、10ms 步长、1024 点 FFT 自相关测基频，倍频纠正 + 抛物线插值；音量骤降 / 音高跳变 / 低于 82Hz 处断字 —— **一个音符 = 一个字 = 一个「冰」** |
| 冰声合成 | 共振峰合成 /piŋ/：Rosenberg 声门脉冲 → 四条共振带（F1~F4）先各自归一到单位 RMS 再加权 → /p/ 爆破噪声 + /i/ 元音 + /ŋ/ 鼻音尾交叉淡化。**基频锁在原歌词的音高上**，所以旋律还是那首歌的旋律 |
| 电平 | 冰声按伴奏 RMS 定标（不是固定音量），所以不管原曲多轻多响，「冰」和伴奏的比例恒定 |
| 混音 | 伴奏 + 可选原唱残留 + 冰声 → 冰洞 IR 卷积混响 → 高通 / 空气感 EQ / tanh 软削波 / 轻压缩 / 限幅 |
| 导出 | 手写 16bit PCM WAV 编码器；视频走 `canvas.captureStream(30)` + `MediaRecorder`（vp9/opus） |

## 本地开发

没有构建步骤，任何静态服务器都行：

```bash
node test/serve.js 8199
# 打开 http://127.0.0.1:8199/
```

`test/` 下有一套跑在 headless Chrome 里的自动化测试（CDP 驱动）：

```bash
node test/drive.js                                        # harness 全链路（音色 1/2/3）
node test/render-full.js http://127.0.0.1:8199/ in.mp3 out.wav 1 2 0 0.25 0.3 300
node test/analyze.js test/out/out.wav                     # 峰值 / RMS / 低频占比 / 削波
node test/stereo.js test/out/out.wav                      # mid/side 能量，验证人声分离没压扁立体声
node test/per-sec.js                                      # 逐秒 RMS，找静音空洞
node test/probe-bing.js                                   # 反测冰声基频是否等于音符基频
node test/ui-test.js                                      # 端到端 UI（点击 → 渲染 → 导出） 
```

## 浏览器要求

Chrome / Edge 90+（需要 Web Audio、`MediaRecorder`、`captureStream`）。Safari 能渲染和导出 WAV，视频导出可能不行。

## License

MIT
