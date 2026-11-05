// bank.js —— 用「真人的冰」当母本，只做重采样变调 + 每组自己的音色
// 注意：如果四组都精确重采样到目标音高，四组会听起来一模一样（音高被抹平了）。
// 所以每组额外套一层固定的滤波器塑形，让「组」这个选择真的能听出来。

import { biquad } from './pcm.js';

function resampleRatio(src, ratio) {
  const n = Math.max(1, Math.floor(src.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = x | 0;
    const f = x - i0;
    out[i] = (src[i0] || 0) * (1 - f) + (src[i0 + 1] || 0) * f;
  }
  return out;
}

// 每组的性格（在母本上做固定塑形，不随音高变）
const GROUP_TONE = {
  1: [['peaking', 260, 0.8, 6.0], ['highshelf', 3200, 0.7, -5.0]], // 闷、厚
  2: [],                                                            // 原样
  3: [['highshelf', 2400, 0.7, 6.5], ['peaking', 900, 1.1, -3.5]],  // 亮、细
  4: [['peaking', 1500, 1.6, 8.0], ['highshelf', 5200, 0.7, -2.5]], // 鼻音重
};

const semis = (a, b) => 12 * Math.log2(a / b);

/**
 * @param {Float32Array} pool
 * @param {{syllables:{off:number,len:number,f0:number}[]}} idx
 * @param {{start:number,dur:number,f0:number,amp:number}[]} notes
 */
export function renderBank(pool, idx, notes, opt) {
  const sr = opt.sr;
  const len = opt.len;
  const gain = opt.gain == null ? 1 : opt.gain;
  const groupCount = Math.max(1, Math.floor(idx.syllables.length / 3));
  const group = Math.min(Math.max(1, opt.group || 2), groupCount);
  const progress = opt.progress || (() => {});
  const out = new Float32Array(len);

  // 「只要一声」：每组固定只用母本里的第一个音节
  const base = (group - 1) * 3;
  const one = idx.syllables[base];
  if (!one) return { data: out, count: 0 };

  const mine = [{
    data: Float32Array.from(pool.subarray(one.off, one.off + one.len)),
    f0: one.f0 || 400,
  }];
  for (const [type, f, q, g] of GROUP_TONE[group] || []) {
    biquad(mine[0].data, sr, type, f, q, g);
  }

  let count = 0;
  let lastEnd = -1;
  let maxAmp = 1e-6;
  for (const nt of notes) maxAmp = Math.max(maxAmp, nt.amp || 0);
  for (let k = 0; k < notes.length; k++) {
    const nt = notes[k];
    if (k % 40 === 0) progress(0.2 + 0.7 * (k / notes.length));

    const ratio = Math.max(0.55, Math.min(1.9, mine[0].f0 / Math.max(60, nt.f0)));
    const dst = resampleRatio(mine[0].data, ratio);
    if (!dst.length) continue;

    const want = Math.max(Math.floor(0.10 * sr), Math.min(Math.floor(0.24 * sr), Math.floor(nt.dur * sr)));
    const n = Math.min(want, dst.length);

    let peak = 1e-6;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(dst[i]));
    // 保留原唱的力度起伏，而不是每一声都压成同一个响度
    const dyn = Math.min(1, Math.max(0, (nt.amp || 0) / maxAmp));
    const target = (0.10 + 0.55 * dyn) * gain;
    const g = target / peak;

    const at = Math.max(0, Math.floor(nt.start * sr));
    // 上一声还没结束就接上（真人连着唱会有轻微交叠）
    const start = Math.max(at, lastEnd > 0 ? lastEnd - Math.floor(0.01 * sr) : at);
    const fadeIn = Math.min(Math.floor(0.002 * sr), n >> 3);
    const fadeOut = Math.min(Math.floor(0.025 * sr), n >> 2);
    for (let i = 0; i < n; i++) {
      const j = start + i;
      if (j >= len) break;
      let w = 1;
      if (i < fadeIn) w = i / fadeIn;
      else if (i > n - fadeOut) w = (n - i) / fadeOut;
      out[j] += dst[i] * g * w;
    }
    lastEnd = start + n;
    count++;
  }
  progress(0.95);
  return { data: out, count };
}
