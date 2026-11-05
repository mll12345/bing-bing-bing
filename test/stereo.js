// stereo.js —— 检查 L/R 相关性与 mid/side 能量占比，判断能否做中置人声提取
// 用法: node test/stereo.js <wav>
const fs = require('node:fs');

function readWav(p) {
  const b = fs.readFileSync(p);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        tag: b.readUInt16LE(off + 8),
        ch: b.readUInt16LE(off + 10),
        sr: b.readUInt32LE(off + 12),
        bits: b.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      data = b.subarray(off + 8, off + 8 + sz);
      break;
    }
    off += 8 + sz + (sz % 2);
  }
  return { fmt, data };
}

const p = process.argv[2];
const { fmt, data } = readWav(p);
console.log(JSON.stringify(fmt));
const ch = fmt.ch;
const bits = fmt.bits;
const bytes = bits / 8;
const n = Math.floor(data.length / (bytes * ch));
const get = (i, c) => {
  const o = (i * ch + c) * bytes;
  if (bits === 16) return data.readInt16LE(o) / 32768;
  if (bits === 32) return data.readFloatLE(o);
  if (bits === 24) {
    const v = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16);
    return (v & 0x800000 ? v - 0x1000000 : v) / 8388608;
  }
  return 0;
};

let eL = 0, eR = 0, eM = 0, eS = 0, corr = 0;
for (let i = 0; i < n; i += 3) {
  const l = get(i, 0);
  const r = ch > 1 ? get(i, 1) : l;
  eL += l * l; eR += r * r;
  const m = (l + r) / 2, s = (l - r) / 2;
  eM += m * m; eS += s * s;
  corr += l * r;
}
const tot = eM + eS;
console.log('L rms', Math.sqrt(eL / (n / 3)).toFixed(4));
console.log('R rms', Math.sqrt(eR / (n / 3)).toFixed(4));
console.log('mid/side energy: M=' + (eM / tot * 100).toFixed(2) + '%  S=' + (eS / tot * 100).toFixed(2) + '%');
console.log('L*R correlation', (corr / Math.sqrt(eL * eR)).toFixed(4));
