// bank.js —— 用「真人的冰」当母本，而不是合成
// 母本来自参考音频切出来的真实音节（3 个一组，共 4 组），
// 播放时只做 PSOLA 变调 + 变长，波形本身是真人嗓子，所以是「冰」不是音效。

import { psola } from './reslice.js';

/**
 * @param {Float32Array} pool     所有母本拼在一起的单声道样本
 * @param {{sr:number, syllables:{off:number,len:number,f0:number}[], groups:{group:number,f0:number}[]}} idx
 * @param {{start:number,dur:number,f0:number,amp:number}[]} notes
 * @param {{sr:number, len:number, gain?:number, group?:number, progress?:Function}} opt
 */
export function renderBank(pool, idx, notes, opt) {
  const sr = opt.sr;
  const len = opt.len;
  const gain = opt.gain == null ? 1 : opt.gain;
  const group = Math.min(4, Math.max(1, opt.group || 2));
  const progress = opt.progress || (() => {});
  const out = new Float32Array(len);

  // 该组的三个母本（idx.syllables 按顺序就是 4 组 × 3 个）
  const base = (group - 1) * 3;
  const mine = idx.syllables.slice(base, base + 3).map((s) => ({
    data: pool.subarray(s.off, s.off + s.len),
    f0: s.f0 || 400,
  }));
  if (!mine.length) return { data: out, count: 0 };

  let count = 0;
  for (let k = 0; k < notes.length; k++) {
    const nt = notes[k];
    if (k % 40 === 0) progress(0.2 + 0.7 * (k / notes.length));
    const src = mine[k % mine.length];

    const outLen = Math.max(Math.floor(0.09 * sr), Math.floor((nt.dur * 0.95 + 0.05) * sr));
    const dst = psola(src.data, sr, src.f0, nt.f0, outLen);
    if (!dst.length) continue;

    let peak = 1e-6;
    for (let i = 0; i < outLen; i++) peak = Math.max(peak, Math.abs(dst[i]));
    const target = Math.min(0.95, Math.max(0.08, nt.amp * 1.2)) * gain;
    const g = target / peak;

    const at = Math.max(0, Math.floor(nt.start * sr));
    const fadeIn = Math.min(Math.floor(0.003 * sr), outLen >> 3);
    const fadeOut = Math.min(Math.floor(0.015 * sr), outLen >> 3);
    for (let i = 0; i < outLen; i++) {
      const j = at + i;
      if (j >= len) break;
      let w = 1;
      if (i < fadeIn) w = i / fadeIn;
      else if (i > outLen - fadeOut) w = (outLen - i) / fadeOut;
      out[j] += dst[i] * g * w;
    }
    count++;
  }
  progress(0.95);
  return { data: out, count };
}
