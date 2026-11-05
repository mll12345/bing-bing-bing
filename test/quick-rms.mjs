import fs from 'node:fs';
const SR=48000;
function rd(p){const b=fs.readFileSync(p);let o=12,d=null;while(o<b.length-8){const id=b.toString('ascii',o,o+4);const s=b.readUInt32LE(o+4);if(id==='data'){d=b.subarray(o+8,o+8+s);break;}o+=8+s+(s&1);}const n=(d.length>>1);const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=d.readInt16LE(i*2)/32768;return x;}
const x=rd('test/out/真冰_组2.wav');
let pk=0,s=0;for(let i=0;i<x.length;i++){pk=Math.max(pk,Math.abs(x[i]));s+=x[i]*x[i];}
console.log('peak',pk.toFixed(3),'rms',Math.sqrt(s/x.length).toFixed(3));
// 5 秒窗口 rms
for(let w=0;w<6;w++){const a=w*5*SR,b=Math.min(x.length,a+5*SR);let q=0;for(let i=a;i<b;i++)q+=x[i]*x[i];console.log(`t=${w*5}-${w*5+5}s rms=${Math.sqrt(q/(b-a)).toFixed(3)}`);}
