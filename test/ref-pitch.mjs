import fs from 'node:fs';
import { pitchTrack } from '../src/voice.js';
const SR=44100;
const raw=new Float32Array(fs.readFileSync('test/ref.f32').buffer.slice(0));
const n=Math.floor(raw.length/2);
const mono=new Float32Array(n);
for(let i=0;i<n;i++) mono[i]=(raw[i*2]+raw[i*2+1])/2;
const tr=pitchTrack(mono,SR,()=>{});
let line='';
for(let i=0;i<tr.frames;i++){
  const t=i*tr.hopSec;
  if(t>5.3) break;
  const c=tr.clarity[i];
  line += `${t.toFixed(2)}:${c>0.5?tr.f0[i].toFixed(0):'--'} `;
}
console.log(line);
