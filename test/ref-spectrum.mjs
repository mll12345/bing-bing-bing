import fs from 'node:fs';
import { makeFFT } from '../src/fft.js';
const SR=44100;
const raw=new Float32Array(fs.readFileSync('test/ref.f32').buffer.slice(0));
const n=Math.floor(raw.length/2);
const mono=new Float32Array(n);
for(let i=0;i<n;i++) mono[i]=(raw[i*2]+raw[i*2+1])/2;
const bursts=[[0.20,0.60],[1.55,1.95],[2.55,2.95],[3.35,3.75],[4.08,4.45],[4.80,5.10]];
const N=4096;const fft=makeFFT(N);
for(const [t0,t1] of bursts){
  const acc=new Float32Array(N/2);
  let cnt=0;
  for(let p=Math.floor(t0*SR);p+N<=Math.floor(t1*SR);p+=N/2){
    const re=new Float32Array(N);const im=new Float32Array(N);
    for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));re[i]=mono[p+i]*w;}
    fft(re,im,false);
    for(let i=1;i<N/2;i++) acc[i]+=Math.hypot(re[i],im[i]);
    cnt++;
  }
  for(let i=0;i<acc.length;i++) acc[i]/=cnt;
  const peaks=[];
  for(let i=2;i<acc.length-2;i++){
    if(acc[i]>acc[i-1]&&acc[i]>acc[i+1]&&acc[i]>acc[i-2]&&acc[i]>acc[i+2]) peaks.push({hz:Math.round(i*SR/N),m:acc[i]});
  }
  peaks.sort((a,b)=>b.m-a.m);
  console.log(`${t0}-${t1}s peaks:`, peaks.slice(0,8).map(p=>p.hz).join(' '));
}
