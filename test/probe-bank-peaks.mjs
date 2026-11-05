import fs from 'node:fs';
import { makeFFT } from '../src/fft.js';
const SR=44100;
function rd(p){const b=fs.readFileSync(p);let o=12,d=null;while(o<b.length-8){const id=b.toString('ascii',o,o+4);const s=b.readUInt32LE(o+4);if(id==='data'){d=b.subarray(o+8,o+8+s);break;}o+=8+s+(s&1);}const n=d.length>>1;const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=d.readInt16LE(i*2)/32768;return x;}
// 每个母本「冰」的谱峰，确认 F2 在 2000-2600Hz（真 /iŋ/）
const meta=JSON.parse(fs.readFileSync('samples/bing-bank.json','utf8'));
const bin=fs.readFileSync('samples/bing-bank.bin');
const i16=new Int16Array(bin.buffer,bin.byteOffset,bin.length/2);
const pool=new Float32Array(i16.length);
for(let i=0;i<i16.length;i++)pool[i]=i16[i]/32768;
const N=2048,fft=makeFFT(N);
for(const s of meta.syllables.slice(0,6)){
  const c=s.off+Math.floor(s.len*0.35);
  if(c+N>pool.length)continue;
  const re=new Float32Array(N),im=new Float32Array(N);
  for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));re[i]=pool[c+i]*w;}
  fft(re,im,false);
  const peaks=[];
  for(let i=3;i<N/2-1;i++){
    const m=Math.hypot(re[i],im[i]),l=Math.hypot(re[i-1],im[i-1]),r2=Math.hypot(re[i+1],im[i+1]);
    if(m>l&&m>r2)peaks.push([Math.round(i*SR/N),m]);
  }
  peaks.sort((a,b)=>b[1]-a[1]);
  const top=peaks.slice(0,4).map(p=>p[0]).sort((a,b)=>a-b);
  console.log(`f0=${s.f0} 峰=${top.join('/')}Hz`);
}
