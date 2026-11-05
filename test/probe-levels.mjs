import fs from 'node:fs';
import { separate } from '../src/vocals.js';
import { biquad } from '../src/pcm.js';
const SR=48000;
const raw=new Float32Array(fs.readFileSync('test/src114.f32').buffer.slice(0));
const frames=Math.floor(raw.length/2);
const chs=[new Float32Array(frames),new Float32Array(frames)];
for(let i=0;i<frames;i++){chs[0][i]=raw[i*2];chs[1][i]=raw[i*2+1];}
let s=0;for(let i=0;i<frames;i+=7)s+=chs[0][i]*chs[0][i];
console.log('orig rms',Math.sqrt(s/Math.ceil(frames/7)).toFixed(4));
const sep=separate(chs,SR,()=>{});
const rmsOf=(a)=>{let q=0;for(let i=0;i<a.length;i+=3)q+=a[i]*a[i];return Math.sqrt(q/Math.max(1,Math.ceil(a.length/3)));};
console.log('vocal rms',rmsOf(sep.vocal[0]).toFixed(4));
const inst=Float32Array.from(chs[0]);
for(let i=0;i<frames;i++) inst[i]-=sep.vocal[0][i]*0.92;
biquad(inst,SR,'highpass',22,0.7);
console.log('inst rms',rmsOf(inst).toFixed(4));
