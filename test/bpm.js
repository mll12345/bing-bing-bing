const fs=require('fs');
function readWav(f){const b=fs.readFileSync(f);let o=12,fmt,data;
 while(o<b.length-8){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);
  if(id==='fmt ')fmt={ch:b.readUInt16LE(o+10),sr:b.readUInt32LE(o+12),bits:b.readUInt16LE(o+22)};
  else if(id==='data')data=b.subarray(o+8,o+8+sz); o+=8+sz+(sz&1);}
 const n=data.length/2/fmt.ch,dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
 const ch=Array.from({length:fmt.ch},()=>new Float32Array(n));
 for(let i=0;i<n;i++)for(let c=0;c<fmt.ch;c++)ch[c][i]=dv.getInt16((i*fmt.ch+c)*2,true)/32768;
 return {sr:fmt.sr,ch:fmt.ch,n,ch};}
const {sr,ch,n,ch:chs}=readWav(process.argv[2]);
const mono=new Float32Array(n);for(let i=0;i<n;i++)mono[i]=(chs[0][i]+(chs[1]?chs[1][i]:0))/(chs[1]?2:1);
// 多频带 onset：对数间隔的能量差
const hop=Math.round(sr*0.005),frames=Math.floor(n/hop);
// 简易 FFT 不必，用 4 个一阶带通近似分频
function bp(x,fc,q){const y=new Float32Array(x.length);const w=2*Math.PI*fc/sr;
 const alpha=Math.sin(w)/(2*q);const b0=alpha,a0=1+alpha,a1=-2*Math.cos(w),a2=1-alpha;
 let x1=0,x2=0,y1=0,y2=0;
 for(let i=0;i<x.length;i++){const x0=x[i];const y0=(b0*x0-b0*x2-a1*y1-a2*y2)/a0;x2=x1;x1=x0;y2=y1;y1=y0;y[i]=y0;}
 return y;}
const bands=[bp(mono,80,1.2),bp(mono,250,1.5),bp(mono,1000,1.5),bp(mono,3500,1.5)];
const fluxAll=new Float32Array(frames);
for(const bd of bands){const env=new Float32Array(frames);
 for(let f=0;f<frames;f++){let s=0;for(let i=0;i<hop;i++){const v=bd[f*hop+i]||0;s+=v*v}env[f]=Math.sqrt(s/hop)}
 for(let f=1;f<frames;f++){const d=env[f]-env[f-1];if(d>0)fluxAll[f]+=d;}}
// 归一
let mx=0;for(let i=0;i<frames;i++)if(fluxAll[i]>mx)mx=fluxAll[i];
const ac=new Float32Array(400);
for(let lag=10;lag<400;lag++){let acc=0,cnt=0;for(let i=lag;i<frames;i++){acc+=fluxAll[i]*fluxAll[i-lag];cnt++}ac[lag]=acc/cnt;}
const top=[];for(let lag=10;lag<399;lag++){if(ac[lag]>ac[lag-1]&&ac[lag]>=ac[lag+1])top.push([lag,ac[lag]]);}
top.sort((a,b)=>b[1]-a[1]);
console.log(process.argv[2]);
console.log(top.slice(0,10).map(([l,v])=>`lag ${l} (${(l*0.005).toFixed(3)}s) bpm ${(60/(l*0.005)).toFixed(1)} score ${v.toExponential(2)}`).join('\n'));
