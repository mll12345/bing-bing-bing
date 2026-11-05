import fs from 'node:fs';
const SR=48000;
function rd(p){const b=fs.readFileSync(p);let o=12,d=null;while(o<b.length-8){const id=b.toString('ascii',o,o+4);const s=b.readUInt32LE(o+4);if(id==='data'){d=b.subarray(o+8,o+8+s);break;}o+=8+s+(s&1);}const n=(d.length>>2);const L=new Float32Array(n);for(let i=0;i<n;i++)L[i]=d.readInt16LE(i*4)/32768;return L;}
const x=rd('test/out/真冰_组2.wav');
// 高频带能量（冰声的 /i/ 元音 F2 在 2k 左右）逐 0.5s 看
console.log('0.5s 窗口高频能量（>1.5k 近似用一阶差分能量）:');
let line='';
for(let w=0;w<20;w++){
  const a=w*0.5*SR,b=Math.min(x.length,a+0.5*SR);
  let e=0,q=0;
  for(let i=a+1;i<b;i++){const d=x[i]-x[i-1];e+=d*d;q+=x[i]*x[i];}
  line+=`${(w*0.5).toFixed(1)}s=${(e/Math.max(1,q)).toFixed(2)} `;
}
console.log(line);
