import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const SR=44100;
const meta=JSON.parse(fs.readFileSync('samples/bing-bank.json','utf8'));
const bin=fs.readFileSync('samples/bing-bank.bin');
const i16=new Int16Array(bin.buffer,bin.byteOffset,bin.length/2);
const pool=new Float32Array(i16.length);
for(let i=0;i<i16.length;i++)pool[i]=i16[i]/32768;
const segs=[];
for(let g=0;g<4;g++){
  const tri=meta.syllables.slice(g*3,g*3+3);
  const parts=[];
  for(const s of tri){
    const d=new Float32Array(s.len+Math.floor(0.04*SR));
    for(let i=0;i<s.len;i++){const t=i>s.len-0.04*SR?(s.len-i)/(0.04*SR):1;d[i]=pool[s.off+i]*t;}
    parts.push(d);
  }
  segs.push(parts);
}
const gap=Math.floor(0.75*SR), inner=Math.floor(0.30*SR);
let total=Math.floor(0.25*SR);
for(const p of segs)for(const d of p)total+=d.length+inner;
total+=gap*3;
const out=new Float32Array(total);
let off=Math.floor(0.25*SR);
for(let g=0;g<4;g++){
  segs[g].forEach((d,i)=>{
    for(let k=0;k<d.length;k++)out[off+k]=d[k];
    off+=d.length;
    if(i<2)off+=inner;
  });
  off+=gap;
}
let pk=0;for(let i=0;i<out.length;i++)pk=Math.max(pk,Math.abs(out[i]));
const gg=0.9/(pk||1);
const n=out.length;
const b=Buffer.alloc(44+n*2);
b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVE',8);
b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
b.writeUInt32LE(SR,24);b.writeUInt32LE(SR*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
b.write('data',36);b.writeUInt32LE(n*2,40);
for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,out[i]*gg))*32767),44+i*2);
fs.writeFileSync('test/out/preview4.wav',b);
execFileSync('ffmpeg',['-v','error','-y','-i','test/out/preview4.wav','-b:a','192k','demo/冰声_4组试听.mp3']);
console.log('4组试听',(n/SR).toFixed(2)+'s');
