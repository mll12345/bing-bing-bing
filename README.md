# 🧊 冰冰冰版 生成器

把一首歌的**每一个字**都换成一个「冰」——音高跟着原唱走，旋律还是那首，歌词全是冰冰冰。

全程在浏览器里跑完，不传服务器。**没有 DJ 加速、没有升调、没有四四拍鼓机**，就是原曲 + 冰声。

参考效果：[🧊 冰冰冰 音效 — BV1HEho6LERf](https://www.bilibili.com/video/BV1HEho6LERf) · [🧊冰爱（雨爱DJ）🧊 — BV1EnhE68EBe](https://www.bilibili.com/video/BV1EnhE68EBe/)

**线上地址**：<https://mll12345.github.io/bing-bing-bing/>

**成品试听**（161 秒原曲 → 502 个冰，四组各一版，都是真人母本）：

- [第 1 组](demo/冰冰冰版_114_真冰_组1.mp3)（母本音高 ≈437Hz）
- [第 2 组](demo/冰冰冰版_114_真冰_组2.mp3)（≈606Hz）
- [第 3 组](demo/冰冰冰版_114_真冰_组3.mp3)（≈721Hz）
- [第 4 组](demo/冰冰冰版_114_真冰_组4.mp3)（≈427Hz）

每组再给一段 35 秒试听：`demo/冰冰冰版_114_真冰_组N_前35秒.mp3`

## 用法

1. 打开页面，拖入一个 **MP4 / MP3 / M4A / WAV**（≤120MB）
2. 点「试听四组」的 1/2/3/4 按钮，挑一组喜欢的冰声（点一下就会把「冰声组」切过去）
3. 调「冰声音量 / 原唱残留 / 冰洞混响 / 冰裂点缀」
4. 点「🧊 冰冰冰！」，渲染完可以试听
5. 导出 **WAV** 音频，或导出 **WebM 视频**（1280×720，带冰晶动画和歌名）

## 它是怎么做的

整条链路是纯前端 Web Audio + 手写 DSP，没有一个第三方依赖：

| 环节 | 做法 |
|---|---|
| 解码 | `decodeAudioData`；解不动就回退 `<video>` + `MediaElementSource` + `ScriptProcessor` 实时录流（AC-3/DTS 之类的容器也能救一下） |
| 人声分离 | 立体声里人声几乎总在正中。手写 FFT（`src/fft.js`）做 STFT，逐帧逐频点算 mid/(mid+side) 得到软掩蔽；分离出的人声先限带 170Hz 再减，低频 kick/贝斯因此完整留在伴奏里 |
| 旋律跟踪 | 16kHz 下采样、10ms 步长、1024 点 FFT 自相关测基频，倍频纠正 + 抛物线插值；音量骤降 / 音高跳变 / 低于 82Hz 处断字 —— **一个音符 = 一个字 = 一个「冰」** |
| 冰声母本 | **不合成声音**。参考音效里 12 个真人的「冰」被逐个切成单字（`samples/bing-bank.bin` + `.json`），3 个一组共 4 组；点按钮试听的就是这 12 个母本 |
| 变调拼接 | 每个音符从本组母本里取一个，用 **PSOLA**（源域取一个源周期、输出域铺一个目标周期，两域窗宽不同）把基频拉到音符音高、长度拉到音符时长。共振峰随波形一起保留，所以是同一个真人在唱「冰」，只是音高变了 |
| 响度 | 冰声按**音符窗口内**的 RMS 与伴奏对齐（不是整轨 RMS，否则会被大量静音摊薄）；峰值进来后走软膝限幅再提响度 |
| 混音 | 伴奏 + 可选原唱残留 + 冰声 → 冰洞 IR 卷积混响 → 高通 / 空气感 EQ / tanh 软削波 / 轻压缩 / 限幅 |
| 导出 | 手写 16bit PCM WAV 编码器；视频走 `canvas.captureStream(30)` + `MediaRecorder`（vp9/opus） |

## 本地开发

没有构建步骤，任何静态服务器都行：

```bash
node test/serve.js 8199
# 打开 http://127.0.0.1:8199/
```

### 重建母本池

```bash
ffmpeg -v error -y -i demo/王牌冰锐_音频.mp4 -ac 2 -ar 48000 -f f32le test/ref.f32
node test/ref-onsets.mjs        # 起音检测切出 12 个「冰」→ test/out/ref-pool.*
node test/make-bank-asset.mjs   # → samples/bing-bank.bin / .json（网页用的母本池）
node test/make-previews.mjs     # → samples/冰组1..4.mp3（按钮试听）
```

### 测试（跑在 headless Chrome 里，CDP 驱动）

```bash
node test/ui-test.js                                              # 端到端 UI（上传 → 渲染 → 播放 → 导出）
node test/drive.js                                                # harness 全链路
node test/dump.js http://127.0.0.1:8199/ in.mp4 out.wav 2 2 0 0.25 0.3 180
node test/analyze.js test/out/out.wav                             # 峰值 / RMS / 频段比 / 削波
node test/probe-reslice.mjs test/out/out.wav                      # 周期性（判断像不像人声）
node test/bank-full.mjs test/src114.f32 2 'demo/xxx'              # Node 直跑整曲，秒级
```

## 浏览器要求

Chrome / Edge 90+（需要 Web Audio、`MediaRecorder`、`captureStream`）。Safari 能渲染和导出 WAV，视频导出可能不行。

## License

MIT
