// dsp.js —— 合成鼓组、混响脉冲、饱和曲线等基础音色件
// 全部程序化生成，零采样依赖。

/** 白噪声缓冲（单声道，2 秒，可循环） */
export function makeNoise(ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // 小步长线性同余，稳定可复现
  let s = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return buf;
}

/** 软饱和曲线：tanh 近似，drive 越大越脏 */
export function satCurve(drive = 1.6, n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return c;
}

/** 冰洞混响脉冲：指数衰减噪声 + 少量早期反射 */
export function makeIceIR(ctx, seconds = 2.1, decay = 3.2) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    // 早期反射（冰面拍打感）
    const taps = [0.007, 0.019, 0.031, 0.047, 0.061].map((x) => x * sr + ch * 13);
    taps.forEach((p, k) => {
      const i = Math.floor(p);
      if (i < len) d[i] += (0.55 - k * 0.09) * (ch ? -1 : 1);
    });
    // 去掉刺耳极高频
    let prev = 0;
    for (let i = 0; i < len; i++) {
      prev = prev * 0.32 + d[i] * 0.68;
      d[i] = prev;
    }
  }
  return ir;
}

/* ---------------- 鼓组 ---------------- */

/** 底鼓：正弦下扫 + 短促 click */
export function kick(ctx, dest, t, g = 1) {
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(155, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.085);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.26);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(1.0 * g, t + 0.004);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(gn).connect(dest);
  o.start(t);
  o.stop(t + 0.32);

  // click
  const nz = ctx.createBufferSource();
  nz.buffer = noiseCache.get(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1600;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.45 * g, t);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
  nz.connect(hp).connect(cg).connect(dest);
  nz.start(t);
  nz.stop(t + 0.04);
}

/** 拍手：三段噪声 + 带通 */
export function clap(ctx, dest, t, g = 1) {
  const taps = [0, 0.011, 0.023, 0.037];
  taps.forEach((dt, i) => {
    const nz = ctx.createBufferSource();
    nz.buffer = noiseCache.get(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1750;
    bp.Q.value = 1.1;
    const gn = ctx.createGain();
    const amp = g * (i === taps.length - 1 ? 0.95 : 0.55);
    gn.gain.setValueAtTime(0.0001, t + dt);
    gn.gain.exponentialRampToValueAtTime(amp, t + dt + 0.002);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.12);
    nz.connect(bp).connect(gn).connect(dest);
    nz.start(t + dt);
    nz.stop(t + dt + 0.14);
  });
}

/** 踩镲 */
export function hat(ctx, dest, t, g = 0.22, open = false) {
  const nz = ctx.createBufferSource();
  nz.buffer = noiseCache.get(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 8200;
  const gn = ctx.createGain();
  const dec = open ? 0.16 : 0.045;
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(g, t + 0.002);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  nz.connect(hp).connect(gn).connect(dest);
  nz.start(t);
  nz.stop(t + dec + 0.02);
}

/** 军鼓（用于加花） */
export function snare(ctx, dest, t, g = 0.5) {
  const nz = ctx.createBufferSource();
  nz.buffer = noiseCache.get(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2600;
  bp.Q.value = 0.7;
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(g, t + 0.003);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  nz.connect(bp).connect(gn).connect(dest);
  nz.start(t);
  nz.stop(t + 0.15);

  const o = ctx.createOscillator();
  const og = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
  og.gain.setValueAtTime(0.3 * g, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(og).connect(dest);
  o.start(t);
  o.stop(t + 0.1);
}

/** 冰裂声：噪声爆破 + 高频共振 + 下坠泛音 */
export function iceCrack(ctx, dest, t, g = 0.5, verb) {
  const nz = ctx.createBufferSource();
  nz.buffer = noiseCache.get(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(7200, t);
  bp.frequency.exponentialRampToValueAtTime(1100, t + 0.16);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(g, t + 0.006);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  nz.connect(bp).connect(gn).connect(dest);
  if (verb) gn.connect(verb);
  nz.start(t);
  nz.stop(t + 0.22);

  // 金属泛音
  [2400, 3610, 5230].forEach((f, i) => {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.22);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(g * 0.16 / (i + 1), t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(og).connect(dest);
    if (verb) og.connect(verb);
    o.start(t);
    o.stop(t + 0.3);
  });
}

/** 上升噪声（段前铺底） */
export function riser(ctx, dest, t, dur = 1.2, g = 0.3) {
  const nz = ctx.createBufferSource();
  nz.buffer = noiseCache.get(ctx);
  nz.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.6;
  bp.frequency.setValueAtTime(320, t);
  bp.frequency.exponentialRampToValueAtTime(9500, t + dur);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(g, t + dur * 0.92);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  nz.connect(bp).connect(gn).connect(dest);
  nz.start(t);
  nz.stop(t + dur + 0.05);
}

const noiseCache = new WeakMap();
noiseCache.get = (ctx) => {
  let v = WeakMap.prototype.get.call(noiseCache, ctx);
  if (!v) {
    v = makeNoise(ctx, 2);
    WeakMap.prototype.set.call(noiseCache, ctx, v);
  }
  return v;
};
