import fs from 'node:fs';
const meta=JSON.parse(fs.readFileSync('samples/bing-bank.json','utf8'));
const bin=fs.readFileSync('samples/bing-bank.bin');
const i16=new Int16Array(bin.buffer,bin.byteOffset,bin.length/2);
const pool=new Float32Array(i16.length);
for(let i=0;i<i16.length;i++)pool[i]=i16[i]/32768;
const SR=meta.sr;
function per(x){
  let r0=0;for(let k=0;k<x.length;k++)r0+=x[k]*x[k];
  let best=0,bl=0;
  for(let lag=30;lag<Math.min(500,x.length-10);lag++){
    let s=0;for(let k=0;k+lag<x.length;k++)s+=x[k]*x[k+lag];
    const v=s/(r0+1e-9);
    if(v>best){best=v;bl=lag;}
  }
  return [best,SR/bl];
}
for(let g=0;g<4;g++){
  const s=meta.syllables[g*3];
  const seg=pool.subarray(s.off,s.off+s.len);
  const [p,f]=per(seg);
  console.log(`组${g+1} 母本 周期=${p.toFixed(3)} 周期对应频率=${f.toFixed(0)}Hz f0=${s.f0} len=${(s.len/SR).toFixed(2)}s`);
}
