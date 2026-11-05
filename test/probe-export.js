const fs=require('node:fs');
function readWav(f){const b=fs.readFileSync(f);const sr=b.readUInt32LE(24),ch=b.readUInt16LE(22),bits=b.readUInt16LE(34);let o=12,d=-1,dl=0;while(o<b.length-8){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='data'){d=o+8;dl=sz;break}o+=8+sz+(sz%2)}const n=Math.floor(dl/(ch*bits/8));const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=b.readInt16LE(d+i*ch*2)/32768;return {sr,x};}
function spec(x,sr,at,dur,N=2048){
  const off=Math.floor(at*sr); const re=new Float32Array(N),im=new Float32Array(N);
  for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1)); re[i]=(x[off+i]||0)*w;}
  // naive DFT over bins of interest 100..5000 with 10Hz step (fine, small N)
  const out=[];
  for(let f=100;f<=5000;f+=10){
    let sr2=0,si=0; const w=2*Math.PI*f/sr;
    for(let i=0;i<N;i++){sr2+=re[i]*Math.cos(w*i); si-=re[i]*Math.sin(w*i);}
    out.push([f,Math.hypot(sr2,si)]);
  }
  return out;
}
const {sr,x}=readWav('demo/冰声_114.wav');
// 找最响的 0.3s 窗口
let best={e:0,at:0};
for(let t=1;t<40;t+=0.05){let e=0;const o=Math.floor(t*sr);for(let i=0;i<sr*0.1;i++)e+=x[o+i]*x[o+i];if(e>best.e)best={e,at:t};}
console.log('loudest window at',best.at.toFixed(2),'s');
const sp=spec(x,sr,best.at+0.03);
// 取前 12 个局部峰
const peaks=[];
for(let i=2;i<sp.length-2;i++){if(sp[i][1]>sp[i-1][1]&&sp[i][1]>sp[i+1][1])peaks.push(sp[i]);}
peaks.sort((a,b)=>b[1]-a[1]);
console.log('top spectral peaks (Hz, mag):');
peaks.slice(0,12).forEach(([f,m])=>console.log('  ',f,Math.round(m)));
