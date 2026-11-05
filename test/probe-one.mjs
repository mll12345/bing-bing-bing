import fs from 'node:fs';
import { makeFFT } from '../src/fft.js';
const SR=44100;
function rd(p){const b=fs.readFileSync(p);let o=12,d=null;while(o<b.length-8){const id=b.toString('ascii',o,o+4);const s=b.readUInt32LE(o+4);if(id==='data'){d=b.subarray(o+8,o+8+s);break;}o+=8+s+(s&1);}const n=d.length>>1;const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=d.readInt16LE(i*2)/32768;return x;}
const N=2048,fft=makeFFT(N);
for(let g=1;g<=4;g++){
  const x=rd(`test/out/one${g}.wav`);
  // 最响 1024 点
  let best=0,bi=0;
  for(let i=0;i+N<=x.length;i+=256){let e=0;for(let k=0;k<N;k++)e+=x[i+k]*x[i+k];if(e>best){best=e;bi=i;}}
  const re=new Float32Array(N),im=new Float32Array(N);
  for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));re[i]=x[bi+i]*w;}
  fft(re,im,false);
  let num=0,den=0;const pk=[];
  for(let i=2;i<N/2;i++){const m=Math.hypot(re[i],im[i]);num+=m*(i*SR/N);den+=m;pk.push([i*SR/N,m]);}
  pk.sort((a,b)=>b[1]-a[1]);
  console.log(`组${g} len=${(x.length/SR).toFixed(2)}s centroid=${(num/den).toFixed(0)}Hz 峰=${pk.slice(0,3).map(p=>Math.round(p[0])).join('/')}`);
}
