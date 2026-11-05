// engine.js —— 「冰冰冰版」核心渲染：DJ 加速 → 节拍对齐 → 人声切片 → 合成鼓组 → 母带
import { resample, biquad, reverse, normalize, analyzeTempo } from './pcm.js';
import { kick, clap, hat, snare, iceCrack, riser, makeIceIR, satCurve } from './dsp.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (seed) => {
  // 确定性伪随机，保证同一输入同一输出
  let s = (seed * 2654435761) >>> 0;
  s ^= s << 13; s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5; s >>>= 0;
  return s / 4294967296;
};

/**
 * @param {AudioBuffer} src 原始音频
 * @param {object} opts { ice, speed, drum, rev, maxLen }
 * @param {(p:number, label:string)=>void} progress
 * @returns {Promise<{buffer:AudioBuffer, info:object}>}
 */
export async function renderIce(src, opts, progress = () => {}) {
  const sr = src.sampleRate;
  const speed = clamp(opts.speed || 1.25, 1, 1.5);
  const ice = clamp(Math.round(opts.ice || 3), 1, 5);
  const drumAmt = clamp(opts.drum ?? 0.8, 0, 1.4);
  const revAmt = clamp(opts.rev ?? 0.3, 0, 1);
  const maxLen = clamp(opts.maxLen || 180, 5, 600);

  progress(0.02, '抽取音轨…');

  // ---------- 1. 声道 → Float32 ----------
  const chCount = Math.min(2, src.numberOfChannels);
  const origin = [];
  for (let c = 0; c < chCount; c++) origin.push(src.getChannelData(c).slice());
  const srcLenSec = src.duration;
  const useLen = Math.min(srcLenSec, maxLen);
  const useSamples = Math.floor(useLen * sr);
  for (let c = 0; c < chCount; c++) origin[c] = origin[c].subarray(0, useSamples);

  // ---------- 2. DJ 加速（升速 + 升调） ----------
  progress(0.1, 'DJ 加速中…');
  const sped = origin.map((ch) => resample(ch, speed));
  const spLen = sped[0].length;

  // 单声道参考（分析用）
  const mono = new Float32Array(spLen);
  for (let c = 0; c < chCount; c++) {
    const d = sped[c];
    for (let i = 0; i < spLen; i++) mono[i] += d[i] / chCount;
  }

  // ---------- 3. 节拍分析 ----------
  progress(0.2, '听节拍…');
  const tempo = analyzeTempo(mono, sr);
  const bpm = clamp(opts.bpm && opts.bpm > 0 ? opts.bpm : tempo.bpm, 50, 200);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const sixteen = beat / 4;
  const songBars = Math.max(1, Math.floor(spLen / sr / bar));

  // 结构：2 小节前奏 + 歌曲 + 1 小节尾
  const introBars = srcLenSec > 20 ? 2 : 1;

  // 关键：把歌曲自身的强拍对齐到网格强拍，且不丢开头任何音频。
  // 时间映射 outT = introSec + (srcT - downbeat)，downbeat 是歌曲第一个强拍，
  // 于是 srcT = downbeat 正好落在 introSec（小节边界 = introBars*bar）上。
  const downbeat = opts.bpm ? 0 : clamp(tempo.downbeat || 0, 0, bar);
  const introSec = introBars * bar;
  const outroSec = bar * 0.75;

  const totalSec = introSec + spLen / sr - downbeat + outroSec;
  const outLen = Math.ceil(totalSec * sr) + Math.ceil(sr * 1.2); // 尾巴留给混响

  // ---------- 4. 构建 backing + 切片轨（纯 JS 混音） ----------
  progress(0.3, '切片、倒放、变速…');
  const back = [];
  for (let c = 0; c < chCount; c++) back.push(new Float32Array(outLen));

  const put = (chIdx, destStart, data, gain = 1, srcOffset = 0) => {
    const dst = back[chIdx];
    for (let i = 0; i < data.length; i++) {
      const j = destStart + i;
      if (j < 0 || j >= outLen) continue;
      dst[j] += data[srcOffset + i] * gain;
    }
  };

  // 时间映射：sped 时间 t（0 = 歌曲开头）→ 输出时间 introSec + (t - downbeat)
  // 于是「歌曲自身的强拍」正好落在输出的小节边界上，鼓组与切片全部对齐。
  const dStart = Math.floor((introSec - downbeat) * sr);

  // 4a. 原速（已加速）整轨铺底，切片段做侧链避让
  const chopMask = buildChopPlan(songBars, ice, rnd, introBars);

  const duckEnv = new Float32Array(spLen);
  duckEnv.fill(1);
  chopMask.forEach((seg) => {
    // seg: {bar, fromBeat, toBeat}，bar 是网格小节 → 换到 sped 采样点
    const a = Math.floor((downbeat + seg.bar * bar + seg.fromBeat * beat) * sr);
    const b = Math.floor((downbeat + seg.bar * bar + seg.toBeat * beat) * sr);
    for (let i = Math.max(0, a); i < b && i < spLen; i++) {
      const t = (i - a) / sr;
      const duck = t < 0.012 ? 0.35 + (t / 0.012) * 0.4 : 0.72;
      if (duckEnv[i] > duck) duckEnv[i] = duck;
    }
  });
  for (let c = 0; c < chCount; c++) {
    const d = sped[c];
    const dst = back[c];
    for (let i = 0; i < spLen; i++) {
      const j = dStart + i;
      if (j < outLen) dst[j] += d[i] * duckEnv[i] * 0.92;
    }
  }

  // 4b. 切片事件（dest 是网格时间，srcStart 是 sped 时间）
  const chops = buildChops({
    plan: chopMask, bar, beat, sixteen, sr, songBars, spLen, ice, rnd, downbeat,
  });

  chops.forEach((ev) => {
    const srcStart = Math.floor(ev.srcStart * sr);
    const srcEnd = Math.min(spLen, srcStart + Math.floor(ev.srcLen * sr));
    if (srcEnd - srcStart < 16) return;
    for (let c = 0; c < chCount; c++) {
      const seg = sped[c].subarray(srcStart, srcEnd);
      let buf = new Float32Array(seg.length);
      buf.set(seg);
      // pitch 是「目标音高倍数」：1.5 → 采得更快 → 更高更短
      if (ev.pitch && Math.abs(ev.pitch - 1) > 1e-3) buf = resample(buf, ev.pitch);
      if (ev.rev) buf = reverse(buf);
      applyFade(buf, 0.0025, ev.fadeOut ?? 0.012, sr);
      put(c, Math.floor((introSec + ev.dest) * sr), buf, ev.gain);
    }
  });

  // 4c. 前奏：取歌曲开头（从强拍起）反向铺底，正拍响起时刚好推满
  {
    const fragLen = Math.min(spLen - Math.floor(downbeat * sr), Math.floor(introSec * sr));
    if (fragLen > 64) {
      const src0 = Math.floor(downbeat * sr);
      for (let c = 0; c < chCount; c++) {
        let frag = new Float32Array(fragLen);
        frag.set(sped[c].subarray(src0, src0 + fragLen));
        frag = reverse(frag);
        biquad(frag, sr, 'lowpass', 1900, 0.7);
        for (let i = 0; i < frag.length; i++) {
          const t = i / frag.length;
          frag[i] *= Math.pow(t, 1.8) * 0.5;
        }
        put(c, 0, frag, 0.7);
      }
    }
  }

  // 4d. 结尾：取歌尾反向淡出，留一点冰洞余温
  {
    const tailLen = Math.min(spLen, Math.floor(bar * 1.5 * sr));
    const tailStart = Math.max(0, Math.floor(dStart + spLen - bar * 0.5 * sr));
    if (tailLen > 64) {
      const src0 = Math.max(0, spLen - tailLen);
      for (let c = 0; c < chCount; c++) {
        let frag = new Float32Array(tailLen);
        frag.set(sped[c].subarray(src0, src0 + tailLen));
        frag = reverse(frag);
        biquad(frag, sr, 'lowpass', 3200, 0.7);
        for (let i = 0; i < frag.length; i++) {
          frag[i] *= Math.pow(1 - i / frag.length, 0.7) * 0.5;
        }
        put(c, tailStart, frag, 0.55);
      }
    }
  }

  // 归一化备份轨
  for (let c = 0; c < chCount; c++) normalize(back[c], 0.82);

  // ---------- 5. 离线渲染：鼓组 + 母带 ----------
  progress(0.55, '合成鼓组、冰裂…');
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const octx = new OAC(2, outLen, sr);

  const backBuf = octx.createBuffer(2, outLen, sr);
  for (let c = 0; c < 2; c++) {
    backBuf.getChannelData(c).set(chCount > c ? back[c] : back[0]);
  }
  const backSrc = octx.createBufferSource();
  backSrc.buffer = backBuf;

  // ---- 总线 ----
  const master = octx.createGain();
  master.gain.value = 0.9;

  const preHP = octx.createBiquadFilter();
  preHP.type = 'highpass';
  preHP.frequency.value = 28;

  const lowShelf = octx.createBiquadFilter();
  lowShelf.type = 'lowshelf';
  lowShelf.frequency.value = 90;
  lowShelf.gain.value = 3.5;

  const air = octx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 8200;
  air.gain.value = 3.2;

  const sat = octx.createWaveShaper();
  sat.curve = satCurve(1.35);
  sat.oversample = '2x';

  const comp = octx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 3.4;
  comp.attack.value = 0.008;
  comp.release.value = 0.19;

  const limit = octx.createDynamicsCompressor();
  limit.threshold.value = -3.2;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.002;
  limit.release.value = 0.08;

  master.connect(preHP).connect(lowShelf).connect(air).connect(sat).connect(comp).connect(limit);
  limit.connect(octx.destination);

  // 侧链 pump：只压伴奏轨，鼓组走直连（否则鼓也被压，pumping 就废了）
  const pump = octx.createGain();
  pump.gain.value = 1;
  const drumBus = octx.createGain();
  drumBus.gain.value = 1;
  backSrc.connect(pump);
  pump.connect(master);
  drumBus.connect(master);

  // 混响
  const verb = octx.createConvolver();
  verb.buffer = makeIceIR(octx, 2.2, 3.4);
  const verbGain = octx.createGain();
  verbGain.gain.value = 0.06 + revAmt * 0.5;
  const verbSend = octx.createGain();
  verbSend.gain.value = 1;
  verbSend.connect(verb).connect(verbGain).connect(master);
  drumBus.connect(verbSend);
  backSrc.connect(verbSend);

  backSrc.start(0);

  // ---- 鼓组排布 ----
  const kickTimes = [];
  const sections = [];
  const kickAmp = 0.92 * clamp(drumAmt, 0, 1.4);
  const startBar = -0;
  const lastBar = Math.floor(totalSec / bar);

  for (let b = 0; b < lastBar; b++) {
    const t0 = b * bar;
    const isIntro = b < introBars;
    const songBar = b - introBars;
    const inSong = songBar >= 0 && songBar < songBars;

    // 每 8 小节一个段落
    if (b % 8 === 0) sections.push(t0);

    // 4/4 kick
    for (let k = 0; k < 4; k++) {
      const t = t0 + k * beat;
      if (t > totalSec) break;
      const isFill = !isIntro && songBar % 8 === 7 && k === 3;
      if (isFill) continue;
      kick(octx, drumBus, t, kickAmp * (isIntro ? 0.72 : 1));
      kickTimes.push(t);
    }
    // clap on 2 & 4
    if (!isIntro || b === introBars - 1) {
      clap(octx, drumBus, t0 + beat, 0.5 * clamp(drumAmt, 0, 1.4));
      clap(octx, drumBus, t0 + 3 * beat, 0.55 * clamp(drumAmt, 0, 1.4));
    }
    // 8 分踩镲 + 反拍开镲
    for (let h = 0; h < 8; h++) {
      const t = t0 + h * beat * 0.5;
      if (t > totalSec) break;
      const acc = h % 2 === 0 ? 0.2 : 0.12;
      hat(octx, drumBus, t, acc * clamp(drumAmt, 0.2, 1.4));
      if (h === 7) hat(octx, drumBus, t + beat * 0.25, 0.1 * drumAmt, true);
    }
    // 加花：每 8 小节的最后一小节最后半拍
    if (!isIntro && songBar >= 0 && songBar % 8 === 7) {
      const ft = t0 + 3 * beat;
      for (let s = 0; s < 3; s++) snare(octx, drumBus, ft + s * beat * 0.16, 0.34 - s * 0.07);
      for (let s = 0; s < 4; s++) snare(octx, drumBus, t0 + 3.5 * beat + s * beat * 0.12, 0.2 + s * 0.06);
    }
    // 冰裂点缀
    if (!isIntro && ice >= 2) {
      const every = ice >= 4 ? 2 : ice >= 3 ? 4 : 8;
      if (songBar >= 0 && songBar % every === 0) {
        iceCrack(octx, drumBus, t0 + beat * 0.5, 0.16 + ice * 0.045, verbSend);
      }
    }
    // 上升噪声：段落前一小节
    if (!isIntro && songBar >= 0 && songBar % 8 === 7) {
      riser(octx, drumBus, t0 + 2 * beat, beat * 2, 0.16 + ice * 0.03);
    }
  }
  // 前奏上升
  riser(octx, drumBus, 0, introSec * 0.96, 0.2);
  // 收尾冰裂
  iceCrack(octx, drumBus, Math.max(0, totalSec - bar * 0.4), 0.4, verbSend);

  // ---- 侧链自动化 ----
  const depth = 0.32 + ice * 0.035;
  pump.gain.setValueAtTime(1, 0);
  kickTimes.forEach((t) => {
    if (t <= 0.02) return;
    pump.gain.setValueAtTime(1, Math.max(0, t - 0.002));
    pump.gain.linearRampToValueAtTime(1 - depth, t + 0.014);
    pump.gain.linearRampToValueAtTime(1, t + 0.2);
  });

  // ---- 尾段淡出 ----
  master.gain.setValueAtTime(0.9, Math.max(0, totalSec - 0.05));
  master.gain.linearRampToValueAtTime(0.5, totalSec + 0.6);
  master.gain.linearRampToValueAtTime(0.0001, totalSec + 1.15);

  progress(0.7, '混音母带…');
  const rendered = await octx.startRendering();

  // 后处理：峰值归一 + 软限幅
  const outCh = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) outCh.push(rendered.getChannelData(c).slice());
  let peak = 0;
  for (const ch of outCh) for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]);
    if (a > peak) peak = a;
  }
  const g = peak > 1e-6 ? 0.955 / peak : 1;
  for (const ch of outCh) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] * g;
      // 软膝限幅：0.86 以下原样，之上 tanh 收进 0.995 以内
      if (v > 0.86) ch[i] = 0.86 + Math.tanh((v - 0.86) / 0.135) * 0.135;
      else if (v < -0.86) ch[i] = -0.86 - Math.tanh((-v - 0.86) / 0.135) * 0.135;
      else ch[i] = v;
    }
  }

  progress(0.95, '收尾…');
  const finalBuf = makeAudioBuffer(outCh, sr);
  progress(1, '完成');

  return {
    buffer: finalBuf,
    info: {
      bpm,
      bars: songBars,
      tempo,
      detectedBpm: tempo.bpm,
      speed,
      ice,
      inSec: src.duration,
      outSec: finalBuf.duration,
      sections: sections.length,
      chopCount: chops.length,
      beat,
      downbeat,
    },
  };
}

/* ---------------- 切片规划 ---------------- */

/** 决定哪些小节、哪些拍子插入切片段 */
function buildChopPlan(songBars, ice, r, introBars) {
  const plan = [];
  for (let b = 0; b < songBars; b++) {
    const R = r(b * 977 + 13);
    if (b < 2) continue; // 开头留白
    if (ice === 1) {
      if (b % 8 === 3) plan.push({ bar: b, fromBeat: 2, toBeat: 4 });
    } else if (ice === 2) {
      if (b % 4 === 2) plan.push({ bar: b, fromBeat: 2.5, toBeat: 4 });
      if (R > 0.86) plan.push({ bar: b, fromBeat: 3, toBeat: 4 });
    } else if (ice === 3) {
      if (b % 2 === 1) plan.push({ bar: b, fromBeat: 2, toBeat: 4 });
      if (b % 8 === 6 && R > 0.5) plan.push({ bar: b, fromBeat: 0, toBeat: 2 });
    } else if (ice === 4) {
      if (b % 2 === 1) plan.push({ bar: b, fromBeat: 1.5, toBeat: 4 });
      if (R > 0.55) plan.push({ bar: b, fromBeat: 0, toBeat: 1.5 });
    } else {
      plan.push({ bar: b, fromBeat: R > 0.4 ? 1 : 0, toBeat: 4 });
    }
  }
  return plan;
}

/** 根据规划生成具体切片事件。dest = 网格时间（0 = 歌曲第一拍），srcStart = sped 时间 */
function buildChops({ plan, bar, beat, sixteen, sr, songBars, spLen, ice, rnd: r, downbeat = 0 }) {
  const evs = [];
  const spLenSec = spLen / sr;

  plan.forEach((seg) => {
    const segStartBeat = seg.bar * 4 + seg.fromBeat;
    const segEndBeat = seg.bar * 4 + seg.toBeat;
    const segDur = (segEndBeat - segStartBeat) * beat;
    if (segDur <= 0.02) return;

    // 取一段源：落在该小节内部靠前的位置（sped 时间轴，含 downbeat 偏移）
    const barStartSec = downbeat + seg.bar * bar;
    let srcStart = barStartSec + (seg.fromBeat % 2) * beat * 0.5;
    const sliceLen = ice >= 4 ? sixteen * 0.5 : ice >= 3 ? sixteen : sixteen * 1.5;
    srcStart = Math.min(srcStart, Math.max(0, spLenSec - sliceLen - 0.02));
    if (srcStart < 0) return;

    const step = ice >= 5 ? sixteen * 0.5 : sixteen;
    const steps = Math.floor(segDur / step);
    const baseT = segStartBeat * beat;

    for (let s = 0; s < steps; s++) {
      const t = baseT + s * step;
      const R = r(Math.round(t * 1000) + 7);
      // 16 步节奏型（按 ice 选择密度）
      let play = true;
      if (ice <= 2) play = s % 2 === 0;
      else if (ice === 3) play = s % 4 !== 3;
      else if (ice === 4) play = !(s % 8 === 6);
      else play = true;

      // 高级技巧：三连音「冰-冰-冰」
      if (ice >= 3 && s === steps - 2) play = true;

      if (!play) continue;

      const accent = s === 0 ? 1 : 0.72 + R * 0.28;
      const rev = ice >= 4 && R > 0.82;
      const pitch = R > 0.9 ? (R > 0.95 ? 1.5 : 0.75) : 1;
      evs.push({
        dest: t,
        srcStart,
        srcLen: Math.min(sliceLen, segDur - s * step + 0.02),
        gain: 0.85 * accent,
        rev,
        pitch,
        fadeOut: 0.01,
      });
    }

    // 强收：最后三连「冰 冰 冰」
    if (ice >= 3) {
      const tEnd = segEndBeat * beat - sixteen * 3.1;
      for (let k = 0; k < 3; k++) {
        evs.push({
          dest: tEnd + k * sixteen * 1.05,
          srcStart,
          srcLen: sixteen * 0.95,
          gain: 0.95 - k * 0.12,
          rev: false,
          pitch: 1,
          fadeOut: 0.006,
        });
      }
    }
  });

  return evs;
}

function applyFade(buf, fadeIn, fadeOut, sr = 44100) {
  const n = buf.length;
  const fi = Math.max(1, Math.floor(fadeIn * sr));
  const fo = Math.max(1, Math.floor(fadeOut * sr));
  for (let i = 0; i < Math.min(fi, n); i++) buf[i] *= i / fi;
  for (let i = 0; i < Math.min(fo, n); i++) buf[n - 1 - i] *= i / fo;
  return buf;
}

/** 用离屏 ctx 生成 AudioBuffer（兼容 Safari 的 2 声道） */
function makeAudioBuffer(chs, sr) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const n = chs[0].length;
  const ctx = new OAC(2, Math.max(1, Math.min(n, 44100 * 60)), sr); // 仅为 createBuffer
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const s = chs[Math.min(c, chs.length - 1)];
    d.set(s);
  }
  return buf;
}
