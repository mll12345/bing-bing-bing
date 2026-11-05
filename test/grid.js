const fs=require("fs");
function readWav(f){const b=fs.readFileSync(f);let o=12,fmt,data;
 while(o<b.length-8){const id=b.toString("ascii",o,o+4),sz=b.readUInt32LE(o+4);
  if(id==="fmt ")fmt={ch:b.readUInt16LE(o+10),sr:b.readUInt32LE(o+12),bits:b.readUInt16LE(o+22)};
  else if(id==="data")data=b.subarray(o+8,o+8+sz); o+=8+sz+(sz&1);}
 const n=data.length/2/fmt.ch,dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
 const chans=[];for(let c=0;c<fmt.ch;c++)chans.push(new Float32Array(n));
 for(let i=0;i<n;i++)for(let c=0;c<fmt.ch;c++)chans[c][i]=dv.getInt16((i*fmt.ch+c)*2,true)/32768;
 return {sr:fmt.sr,chans,n};}
const f=process.argv[2];
const {sr,chans,n}=readWav(f);
const mono=new Float32Array(n);for(let i=0;i<n;i++){let s=0;for(const c of chans)s+=c[i];mono[i]=s/chans.length;}
function biquad(x,type,fc,q){const w=2*Math.PI*fc/sr,cos=Math.cos(w),sin=Math.sin(w),alpha=sin/(2*q);
 let b0,b1,b2,a0,a1,a2;
 if(type==="lp"){b0=(1-cos)/2;b1=1-cos;b2=(1-cos)/2;a0=1+alpha;a1=-2*cos;a2=1-alpha;}
 else {b0=(1+cos)/2;b1=-(1+cos);b2=(1+cos)/2;a0=1+alpha;a1=-2*cos;a2=1-alpha;}
 const y=new Float32Array(x.length);let x1=0,x2=0,y1=0,y2=0;
 for(let i=0;i<x.length;i++){const x0=x[i];const y0=(b0*x0+b1*x1+b2*x2-a1*y1-a2*y2)/a0;x2=x1;x1=x0;y2=y1;y1=y0;y[i]=y0;}
 return y;}
const hop=Math.round(sr*0.01);
function fluxOf(sig){const frames=Math.floor(sig.length/hop);const env=new Float32Array(frames);
 for(let i=0;i<frames;i++){let s=0;for(let k=0;k<hop;k++){const v=sig[i*hop+k]||0;s+=v*v;}env[i]=Math.sqrt(s/hop);}
 const fl=new Float32Array(frames);for(let i=1;i<frames;i++){const d=env[i]-env[i-1];if(d>0)fl[i]=d;}return fl;}
const low=biquad(biquad(mono,"lp",160,0.707),"lp",160,0.707);
const fl=fluxOf(low);
const frames=fl.length;
// 归一化 flux
let mx=0;for(let i=0;i<frames;i++)if(fl[i]>mx)mx=fl[i];
for(let i=0;i<frames;i++)fl[i]/=mx;
const dur=n/sr;
// 1) 自相关（去均值后）
let mean=0;for(let i=0;i<frames;i++)mean+=fl[i];mean/=frames;
const c=new Float32Array(frames);for(let i=0;i<frames;i++)c[i]=fl[i]-mean;
const maxLag=Math.round(2.0/0.01);
const ac=new Float32Array(maxLag+1);
for(let lag=1;lag<=maxLag&&lag<frames;lag++){let acc=0;for(let i=lag;i<frames;i++)acc+=c[i]*c[i-lag];ac[lag]=acc/(frames-lag);}
// 2) for each BPM: comb score (ac at 1,2,3,4 beats) + phase strength
function phaseStrength(beat){let sx=0,sy=0,sw=0;
 for(let i=1;i<frames;i++){const w=fl[i];if(w<=0)continue;const ang=((i*0.01)%beat)/beat*2*Math.PI;sx+=Math.cos(ang)*w;sy+=Math.sin(ang)*w;sw+=w;}
 return Math.hypot(sx,sy)/(sw||1);}
const rows=[];
for(let bpm=60;bpm<=200;bpm+=0.25){
 const beat=60/bpm;const lag=beat/0.01;if(lag>maxLag-2)continue;
 let comb=0,wk=0;
 for(let k=1;k<=4;k++){const L=Math.round(lag*k);if(L>maxLag)break;const w=1/k;comb+=ac[L]*w;wk+=w;}
 comb/=wk;
 const ps=phaseStrength(beat);
 rows.push({bpm,comb,ps});
}
// 列出 comb top12 与 ps top12
const byComb=[...rows].sort((a,b)=>b.comb-a.comb);
const byPs=[...rows].sort((a,b)=>b.ps-a.ps);
console.log("file",f,"dur",dur.toFixed(1));
console.log("--- comb top ---");
byComb.slice(0,12).forEach(r=>console.log(`bpm ${r.bpm.toFixed(2)} comb ${r.comb.toExponential(2)} phaseStr ${r.ps.toFixed(3)}`));
console.log("--- phaseStrength top ---");
byPs.slice(0,12).forEach(r=>console.log(`bpm ${r.bpm.toFixed(2)} phaseStr ${r.ps.toFixed(3)} comb ${r.comb.toExponential(2)}`));
