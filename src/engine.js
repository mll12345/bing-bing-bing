// engine.js —— 「冰冰冰版」核心渲染
// 流程：分离人声 → 跟踪旋律 → 把原唱每个字的元音改成 /i/、尾巴改成 /ŋ/（借用原唱嗓子唱「冰」）
//       → 与伴奏混音 → 混响母带
// 不含任何 DJ 处理：不变速、不升调、不套四四拍鼓机、不做侧链 pumping
import { resample, biquad, normalize } from './pcm.js';
import { separate } from './vocals.js';
import { pitchTrack, toNotes } from './voice.js';
import { renderMorphBing } from './morph.js';
import { iceCrack, makeIceIR, satCurve } from './dsp.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * @param {AudioBuffer} src 原始音频
 * @param {object} opts { voice, timbre, keep, rev, sparkle, speed, maxLen }
 * @param {(p:number, label:string)=>void} progress
 * @returns {Promise<{buffer:AudioBuffer, info:object}>}
 */
export async function renderIce(src, opts, progress = () => {}) {
  const sr = src.sampleRate;
  const speed = clamp(opts.speed == null ? 1 : opts.speed, 1, 1.5);
  const voiceGain = clamp(opts.voice == null ? 1 : opts.voice, 0, 2);
  const timbre = clamp(Math.round(opts.timbre == null ? 2 : opts.timbre), 1, 4);
  const keepVocal = clamp(opts.keep == null ? 0 : opts.keep, 0, 1);
  const revAmt = clamp(opts.rev == null ? 0.25 : opts.rev, 0, 1);
  const sparkle = clamp(opts.sparkle == null ? 0.3 : opts.sparkle, 0, 1);
  const maxLen = clamp(opts.maxLen == null ? 180 : opts.maxLen, 5, 600);

  progress(0.02, '抽取音轨…');

  // ---------- 1. 声道 → Float32 ----------
  const chCount = Math.min(2, src.numberOfChannels);
  const origin = [];
  for (let c = 0; c < chCount; c++) origin.push(src.getChannelData(c).slice());
  const srcLenSec = src.duration;
  const useLen = Math.min(srcLenSec, maxLen);
  const useSamples = Math.floor(useLen * sr);
  for (let c = 0; c < chCount; c++) origin[c] = origin[c].subarray(0, useSamples);

  // ---------- 2. 可选变速（默认 1.00，不动原曲） ----------
  const working = speed > 1.0001
    ? origin.map((ch) => resample(ch, speed))
    : origin;
  const len = working[0].length;

  // ---------- 3. 人声 / 伴奏分离 ----------
  progress(0.06, '分离人声…');
  const sep = separate(working, sr, (p, label) => progress(0.06 + p * 0.24, label));

  // 分离出的「人声」里混着被中置的全部低频（kick/贝斯），
  // 直接整条减掉会把伴奏掏空。所以先把人声限到人声频段（170Hz 以上），
  // 再把这部分从原曲里减掉 —— 低频因此完整留在伴奏里。
  const vocHP = [];
  const inst = [];
  for (let c = 0; c < chCount; c++) {
    const v = sep.vocal ? Float32Array.from(sep.vocal[Math.min(c, sep.vocal.length - 1)]) : null;
    if (v) biquad(v, sr, 'highpass', 170, 0.7);
    vocHP.push(v);
    const base = Float32Array.from(working[c]);
    if (v) {
      for (let i = 0; i < base.length; i++) base[i] -= v[i] * 0.92;
      biquad(base, sr, 'highpass', 22, 0.7);
    }
    inst.push(base);
  }

  // ---------- 4. 旋律跟踪 → 音符（一个字一个冰） ----------
  progress(0.3, '听旋律…');
  const track = pitchTrack(vocHP[0] || sep.mono, sr, (p, label) => progress(0.3 + p * 0.25, label));
  const notes = toNotes(track, { minDur: 0.07, clarityMin: 0.26 });

  // ---------- 5. 共振峰换元音：用原唱自己的嗓子唱「冰」 ----------
  progress(0.55, '唱冰…');
  // 需要一条干净的、能直接听到「字」的人声：中置分离结果限到 120Hz 以上
  const vocalSrc = vocHP[0] ? Float32Array.from(vocHP[0]) : (() => {
    const m = new Float32Array(len);
    for (let i = 0; i < len; i++) m[i] = (working[0][i] + working[Math.min(1, working.length - 1)][i]) / 2;
    return m;
  })();
  biquad(vocalSrc, sr, 'highpass', 120, 0.7);
  const bing = renderMorphBing(vocalSrc, sr, notes, {
    gain: 1,
    timbre,
    progress: (p, label) => progress(p, label),
  });

  // ---------- 6. 纯 JS 混底：伴奏 + 残留原唱 + 冰声 ----------
  progress(0.8, '混合…');
  const outroSec = 1.4;
  const outLen = len + Math.ceil(outroSec * sr);

  // 冰声按伴奏能量定标，保证不管原曲多轻多响，「冰」与伴奏的比例恒定
  const rmsOf = (a) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 3) s += a[i] * a[i];
    return Math.sqrt(s / Math.max(1, Math.ceil(a.length / 3)));
  };
  const instRms = 0.5 * (rmsOf(inst[0]) + rmsOf(inst[inst.length - 1]));
  const bingRms = rmsOf(bing.data);
  const bingScale = bingRms > 1e-6 ? ((instRms * 1.15) / bingRms) * clamp(voiceGain, 0, 2) : 0;

  const mix = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(outLen);
    const src0 = inst[Math.min(c, inst.length - 1)];
    const voc = vocHP[Math.min(c, vocHP.length - 1)];
    for (let i = 0; i < len; i++) {
      d[i] = src0[i] + (voc ? voc[i] * keepVocal : 0) + bing.data[i] * bingScale;
    }
    mix.push(d);
  }
  for (const d of mix) normalize(d, 0.9);

  // ---------- 7. 离线渲染：冰裂 + 混响 + 母带 ----------
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const octx = new OAC(2, outLen, sr);

  const srcBuf = octx.createBuffer(2, outLen, sr);
  for (let c = 0; c < 2; c++) srcBuf.getChannelData(c).set(mix[c]);
  const main = octx.createBufferSource();
  main.buffer = srcBuf;

  const master = octx.createGain();
  master.gain.value = 0.92;

  const hp = octx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 24;

  const air = octx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 9000;
  air.gain.value = 1.6;

  const sat = octx.createWaveShaper();
  sat.curve = satCurve(1.12);
  sat.oversample = '2x';

  const comp = octx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 10;
  comp.ratio.value = 2.6;
  comp.attack.value = 0.012;
  comp.release.value = 0.22;

  const limit = octx.createDynamicsCompressor();
  limit.threshold.value = -2.4;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.002;
  limit.release.value = 0.1;

  main.connect(hp).connect(air).connect(sat).connect(comp).connect(limit);
  limit.connect(master).connect(octx.destination);
  main.start(0);

  // 冰洞混响
  const verb = octx.createConvolver();
  verb.buffer = makeIceIR(octx, 2.0, 3.2);
  const verbGain = octx.createGain();
  verbGain.gain.value = 0.04 + revAmt * 0.42;
  verb.connect(verbGain).connect(master);

  // 冰声送一点混响，让「冰」在冰洞里回响
  if (revAmt > 0.01) {
    const bingVerb = octx.createGain();
    bingVerb.gain.value = 0.14 + revAmt * 0.3;
    bingVerb.connect(verb);
    // 冰声已经混在主轨里，这里用一个高通版本再送一遍，制造「冰」的空气感
    const hpv = octx.createBiquadFilter();
    hpv.type = 'highpass';
    hpv.frequency.value = 700;
    main.connect(hpv).connect(bingVerb);
  }

  // ---- 冰裂点缀：落在每个音符的强拍上，轻轻一层 ----
  const fxBus = octx.createGain();
  fxBus.gain.value = 1;
  fxBus.connect(limit);
  if (sparkle > 0.02) {
    const every = Math.max(1, Math.round(notes.length / 26));
    notes.forEach((nt, i) => {
      if (i % every !== 0) return;
      const g = (0.06 + sparkle * 0.16) * (0.6 + Math.min(1, nt.amp * 6) * 0.4);
      iceCrack(octx, fxBus, Math.max(0, nt.start - 0.01), g, verb);
    });
  }

  // 尾段淡出
  const end = len / sr;
  master.gain.setValueAtTime(0.92, Math.max(0, end - 0.15));
  master.gain.linearRampToValueAtTime(0.45, end + 0.7);
  master.gain.linearRampToValueAtTime(0.0001, Math.min(outLen / sr - 0.02, end + outroSec));

  progress(0.9, '混音母带…');
  const rendered = await octx.startRendering();

  // ---------- 8. 收尾整理 ----------
  const out = [];
  for (let c = 0; c < 2; c++) {
    const d = rendered.getChannelData(c).slice();
    fadeEdges(d, sr, 0.02, 0.05);
    out.push(d);
  }
  let peak = 0;
  for (const d of out) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0.0001) {
    const g = 0.955 / peak;
    for (const d of out) for (let i = 0; i < d.length; i++) d[i] *= g;
  }

  const buffer = makeAudioBuffer(out, sr);
  progress(1, '完成');

  const info = {
    notes: bing.count,
    timbre,
    voice: voiceGain,
    keptVocal: keepVocal,
    speed,
    sparkle,
    inSec: Math.round(srcLenSec * 10) / 10,
    outSec: Math.round((buffer.duration) * 10) / 10,
    separated: sep.centered,
  };
  window.__iceInfo = info;
  return { buffer, info };
}

/* ---------------- 小工具 ---------------- */

function fadeEdges(d, sr, fin, fout) {
  const a = Math.max(1, Math.floor(fin * sr));
  const b = Math.max(1, Math.floor(fout * sr));
  const n = d.length;
  for (let i = 0; i < Math.min(a, n); i++) d[i] *= i / a;
  for (let i = 0; i < Math.min(b, n); i++) d[n - 1 - i] *= i / b;
}

function makeAudioBuffer(chs, sr) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const n = chs[0].length;
  const ctx = new OAC(2, Math.max(1, Math.min(n, 44100)), sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) buf.getChannelData(c).set(chs[c]);
  return buf;
}
