// pcm.js —— 纯 JS 的 PCM 工具：重采样、双二阶滤波、能量分析
// 全部在 Float32Array 上原地/离线运算，不依赖 AudioContext。

/** 线性插值重采样：speed>1 加速且升调（DJ 加速效果） */
export function resample(input, speed) {
  if (Math.abs(speed - 1) < 1e-4) return input.slice();
  const outLen = Math.max(1, Math.floor(input.length / speed));
  const out = new Float32Array(outLen);
  const last = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i * speed;
    const i0 = pos | 0;
    const frac = pos - i0;
    const a = input[i0] || 0;
    const b = i0 < last ? input[i0 + 1] : 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** RBJ 双二阶系数 */
function coeffs(type, sr, f, q, gainDb = 0) {
  const w0 = (2 * Math.PI * f) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    case 'highshelf': {
      const s2 = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s2);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - s2);
      a0 = A + 1 - (A - 1) * cos + s2;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - s2;
      break;
    }
    default:
      throw new Error('bad filter type ' + type);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 原地双二阶滤波（Direct Form I） */
export function biquad(data, sr, type, f, q = 0.707, gainDb = 0) {
  const c = coeffs(type, sr, Math.min(f, sr * 0.48), q, gainDb);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x0 = data[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    data[i] = y0;
  }
  return data;
}

/** 反向拷贝 */
export function reverse(input) {
  const out = new Float32Array(input.length);
  const n = input.length;
  for (let i = 0; i < n; i++) out[i] = input[n - 1 - i];
  return out;
}

/** 归一化到目标峰值 */
export function normalize(input, peak = 0.98) {
  let max = 0;
  for (let i = 0; i < input.length; i++) {
    const a = Math.abs(input[i]);
    if (a > max) max = a;
  }
  if (max <= 1e-6) return input;
  const k = peak / max;
  for (let i = 0; i < input.length; i++) input[i] *= k;
  return input;
}

/** 计算逐点的对数包络（用于绘制波形） */
export function envelope(data, buckets = 800) {
  const out = new Float32Array(buckets);
  const per = Math.max(1, Math.floor(data.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const s = b * per;
    const e = Math.min(data.length, s + per);
    for (let i = s; i < e; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    out[b] = peak;
  }
  return out;
}

/**
 * 节拍分析：低频能量包络 → 起点强度 → 自相关求周期
 * 返回 { bpm, beat, phase, downbeat }
 */
export function analyzeTempo(mono, sr) {
  // 1. 低频通道（kick 检测）
  const low = biquad(biquad(mono.slice(), sr, 'lowpass', 160, 0.707), sr, 'lowpass', 160, 0.707);

  const hop = Math.round(sr * 0.01); // 10ms
  const frames = Math.floor(low.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) {
      const v = low[base + i] || 0;
      s += v * v;
    }
    env[f] = Math.sqrt(s / hop);
  }
  // 起点强度（正差分）
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = env[f] - env[f - 1];
    flux[f] = d > 0 ? d : 0;
  }

  // 2. 自相关（去均值，归一化 flux）
  let fmax = 0;
  for (let f = 0; f < frames; f++) if (flux[f] > fmax) fmax = flux[f];
  if (fmax > 0) for (let f = 0; f < frames; f++) flux[f] /= fmax;
  let fmean = 0;
  for (let f = 0; f < frames; f++) fmean += flux[f];
  fmean /= frames || 1;
  const centered = new Float32Array(frames);
  for (let f = 0; f < frames; f++) centered[f] = flux[f] - fmean;

  const hopSec = 0.01;
  const maxLag = Math.min(Math.round(2.0 / hopSec), frames - 2);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = lag; i < frames; i++) acc += centered[i] * centered[i - lag];
    ac[lag] = acc / (frames - lag);
  }

  // 梳状打分：一个真正的节拍周期，在 1/2/3/4 拍处都应该有自相关峰。
  // 只看单个 lag 会被半频/倍频骗走（DJ 快歌尤其明显），梳状加权能稳住八度。
  const acAt = (lagF) => {
    const l0 = Math.floor(lagF);
    if (l0 < 1 || l0 + 1 > maxLag) return 0;
    const fr = lagF - l0;
    return ac[l0] * (1 - fr) + ac[l0 + 1] * fr;
  };
  const combScore = (bpmCand) => {
    const lag = 60 / bpmCand / hopSec;
    if (lag > maxLag - 1 || lag < 2) return -Infinity;
    let s = 0, w = 0;
    for (let k = 1; k <= 4; k++) {
      if (lag * k > maxLag) break;
      const wk = 1 / k;            // 长周期权重略低，但仍然是必需的证据
      s += acAt(lag * k) * wk;
      w += wk;
    }
    return w > 0 ? s / w : -Infinity;
  };

  // 相位一致性：真实节拍下，低频 onset 会大量落在同一相位上
  const phaseStrength = (beatSec) => {
    let sx = 0, sy = 0, sw = 0;
    for (let f = 1; f < frames; f++) {
      const w = flux[f];
      if (w <= 0) continue;
      const ang = (((f * hopSec) % beatSec) / beatSec) * 2 * Math.PI;
      sx += Math.cos(ang) * w;
      sy += Math.sin(ang) * w;
      sw += w;
    }
    return sw > 0 ? Math.hypot(sx, sy) / sw : 0;
  };

  // 粗扫 0.25 BPM 步长，用「梳状分 × 相位一致性」联合打分
  const RANGE = [68, 200];
  const cands = [];
  for (let b = RANGE[0]; b <= RANGE[1]; b += 0.25) {
    const c = combScore(b);
    if (!isFinite(c)) continue;
    cands.push({ bpm: b, comb: c, ps: phaseStrength(60 / b) });
  }
  // 归一化后联合排序（相位一致性抗噪，梳状分定周期）
  let cMax = 0, cMin = Infinity, pMax = 0;
  cands.forEach((c) => { cMax = Math.max(cMax, c.comb); cMin = Math.min(cMin, c.comb); pMax = Math.max(pMax, c.ps); });
  const span = Math.max(1e-12, cMax - cMin);
  cands.forEach((c) => {
    const cn = (c.comb - cMin) / span;
    const pn = pMax > 0 ? c.ps / pMax : 0;
    c.score = cn * 0.65 + pn * 0.35;
  });
  cands.sort((a, b) => b.score - a.score);
  let bpm = cands.length ? cands[0].bpm : 120;

  // 八度校正：把 bpm 折到手感区间，但必须在候选里挑「证据最强」的那个八度
  const octaves = [0.5, 1, 2];
  let bestOct = bpm, bestOctScore = -Infinity;
  const byBpm = new Map(cands.map((c) => [Math.round(c.bpm * 100), c]));
  for (const k of octaves) {
    const cand = bpm * k;
    if (cand < RANGE[0] || cand > RANGE[1]) continue;
    // 同一周期族的分数：用相邻 0.5 BPM 窗口里的最高分，容忍量化误差
    let s = -Infinity;
    for (let d = -0.75; d <= 0.7501; d += 0.25) {
      const hit = byBpm.get(Math.round((cand + d) * 100));
      if (hit && hit.score > s) s = hit.score;
    }
    if (!isFinite(s)) continue;
    // 轻推 110~165（这个系列的常规区间），但不压过证据
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(cand / 148) / 0.55, 2));
    let sc = s * (0.8 + 0.2 * prior); if (cand < 82) sc *= 0.9; // 这个系列的歌基本都是 90+ BPM
    if (sc > bestOctScore) { bestOctScore = sc; bestOct = cand; }
  }
  bpm = bestOct;
  // 「冰冰冰版」面向的是 90+ BPM 的现代流行/电子乐：八度歧义时一律取快的一侧，
  // 慢歌被识别成 half-time 会让鼓组听起来拖沓，这是更糟的失败方式。
  while (bpm < 92) bpm *= 2;
  // 上限折叠：DJ 加速后 195 BPM 之类的超快速度对 4/4 鼓组意味着「每拍一下」,听感是抽搐而不是蹦迪,
  // 一律按 half-time 折叠回 85-172 的手感区间。
  while (bpm > 172) bpm /= 2;
  if (!isFinite(bpm) || bpm <= 0) bpm = 120;

  const beat = 60 / bpm;

  // 3. 相位：flux 加权圆均值（比「挑峰」稳，低音通奏不会被当成鼓点）
  let sx = 0, sy = 0, sw = 0;
  for (let f = 1; f < frames; f++) {
    const w = flux[f];
    if (w <= 0) continue;
    const ang = (((f * hopSec) % beat) / beat) * 2 * Math.PI;
    sx += Math.cos(ang) * w;
    sy += Math.sin(ang) * w;
    sw += w;
  }
  let phase = sw > 0 ? (Math.atan2(sy, sx) / (2 * Math.PI)) * beat : 0;
  phase = ((phase % beat) + beat) % beat;

  // 3b. 精修：加权均值会被 kick 的长尾拖后十几毫秒，再在 ±60ms 内找
  // 「网格点上 flux 之和最大」的偏移。用线性插值取值，避免 10ms 阶梯。
  const fluxAt = (tSec) => {
    const x = tSec / hopSec;
    const i = Math.floor(x);
    if (i < 0 || i + 1 >= frames) return 0;
    const fr = x - i;
    return flux[i] * (1 - fr) + flux[i + 1] * fr;
  };
  const gridSum = (off) => {
    let s = 0, cnt = 0;
    for (let t = off; t < low.length / sr; t += beat) {
      s += Math.max(fluxAt(t), fluxAt(t + 0.004) * 0.7);
      cnt++;
    }
    return cnt ? s / cnt : 0;
  };
  let refined = phase, bestSum = -Infinity;
  for (let d = -0.06; d <= 0.0601; d += 0.001) {
    const off = ((phase + d) % beat + beat) % beat;
    const s = gridSum(off);
    if (s > bestSum) { bestSum = s; refined = off; }
  }
  phase = refined;

  // 4. 下拍：4 个候选里挑低频（kick）能量最大的一拍。
  // 很多 DJ 曲每拍都有 kick，分数会打平；这时选最早的候选，
  // 因为 downbeat 越大 = 开头被裁掉越多。
  const cand = [];
  for (let m = 0; m < 4; m++) {
    const t0 = phase + m * beat;
    let acc = 0;
    for (let t = t0; t < low.length / sr; t += beat * 4) {
      const f = Math.round(t / hopSec);
      if (f >= 0 && f < frames) acc += flux[f];
    }
    cand.push({ t: t0, acc });
  }
  const maxAcc = Math.max(...cand.map((c) => c.acc), 1e-9);
  const good = cand.filter((c) => c.acc >= maxAcc * 0.88);
  let downbeat = (good.length ? good[0] : cand[0]).t;
  // 折进 [0, 1 小节)：引擎只用它做「歌曲第一个强拍的偏移」
  const barSpan = beat * 4;
  downbeat = ((downbeat % barSpan) + barSpan) % barSpan;

  return {
    bpm: Math.round(bpm * 10) / 10,
    beat,
    phase,
    downbeat,
    strength: cands.length ? +cands[0].ps.toFixed(3) : 0,
    octaveCertain: cands.length > 1 ? +(cands[0].score - cands[1].score).toFixed(3) : 0,
  };
}





