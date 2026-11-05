import fs from 'node:fs';
import { separate } from '../src/vocals.js';
import { biquad } from '../src/pcm.js';
import { pitchTrack, toNotes } from '../src/voice.js';
import { renderBank } from '../src/bank.js';
import { makeFFT } from '../src/fft.js';
const SR=48000, SEC=20;
const raw=new Float32Array(fs.readFileSync('test/src114.f32').buffer.slice(0));
const frames=Math.min(Math.floor(raw.length/2),SEC*SR);
const chs=[new Float32Array(frames),new Float32Array(frames)];
for(let i=0;i<frames;i++){chs[0][i]=raw[i*2];chs[1][i]=raw[i*2+1];}
const sep=separate(chs,SR,()=>{});
const v=Float32Array.from(sep.vocal[0]);biquad(v,SR,'highpass',170,0.7);
const notes=toNotes(pitchTrack(v,SR,()=>{}),{minDur:0.07,clarityMin:0.26});
const meta=JSON.parse(fs.readFileSync('samples/bing-bank.json','utf8'));
const bin=fs.readFileSync('samples/bing-bank.bin');
const i16=new Int16Array(bin.buffer,bin.byteOffset,bin.length/2);
const pool=new Float32Array(i16.length);for(let i=0;i<i16.length;i++)pool[i]=i16[i]/32768;
const r=meta.sr/SR;
const idx={syllables:meta.syllables.map(s=>({off:Math.round(s.off/r),len:Math.round(s.len/r),f0:s.f0}))};
const pr=new Float32Array(Math.floor(pool.length/r));
for(let i=0;i<pr.length;i++){const x=i*r,i0=x|0,f=x-i0;pr[i]=(pool[i0]||0)*(1-f)+(pool[i0+1]||0)*f;}
const N=2048,fft=makeFFT(N);
for(const g of [1,2,3,4]){
  const b=renderBank(pr,idx,notes,{sr:SR,len:frames,gain:1,group:g,progress:()=>{}});
  let best=0,bi=0;
  for(let i=0;i+N<=frames;i+=512){let e=0;for(let k=0;k<N;k++)e+=b.data[i+k]*b.data[i+k];if(e>best){best=e;bi=i;}}
  const re=new Float32Array(N),im=new Float32Array(N);
  for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));re[i]=b.data[bi+i]*w;}
  fft(re,im,false);
  let num=0,den=0;
  for(let i=2;i<N/2;i++){const m=Math.hypot(re[i],im[i]);num+=m*(i*SR/N);den+=m;}
  let pk = 0;
  for (let i = 0; i < frames; i++) pk = Math.max(pk, Math.abs(b.data[i]));
  console.log('组' + g, 'centroid=' + (num / den).toFixed(0) + 'Hz', 'peak=' + pk.toFixed(3));
}
