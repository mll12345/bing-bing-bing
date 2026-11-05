import fs from 'node:fs';
import { makeFFT } from '../src/fft.js';
const meta=JSON.parse(fs.readFileSync('samples/bing-bank.json','utf8'));
const bin=fs.readFileSync('samples/bing-bank.bin');
const i16=new Int16Array(bin.buffer,bin.byteOffset,bin.length/2);
const pool=new Float32Array(i16.length);
for(let i=0;i<i16.length;i++)pool[i]=i16[i]/32768;
const SR=44100,N=2048,fft=makeFFT(N);
for(let g=0;g<4;g++){
  const tri=meta.syllables.slice(g*3,g*3+3);
  let cSum=0,cnt=0;
  for(const s of tri){
    const mid=s.off+(s.len>>1);
    for(const c of [mid-1024,mid]){
      if(c<0||c+N>pool.length)continue;
      const re=new Float32Array(N),im=new Float32Array(N);
      for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));re[i]=pool[c+i]*w;}
      fft(re,im,false);
      let num=0,den=0;
      for(let i=2;i<N/2;i++){const m=Math.hypot(re[i],im[i]);num+=m*(i*SR/N);den+=m;}
      if(den>0){cSum+=num/den;cnt++;}
    }
  }
  console.log(`组${g+1} f0=${meta.groups[g].f0} centroid=${(cSum/Math.max(1,cnt)).toFixed(0)}Hz`);
}
