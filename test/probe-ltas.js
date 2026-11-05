const fs=require('node:fs');
function wav(f){const b=fs.readFileSync(f);const sr=b.readUInt32LE(24),ch=b.readUInt16LE(22);let o=12;while(o<b.length-8){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='data'){o=o+8;break}o+=8+sz+(sz%2)}const n=(b.length-o)/2;const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=b.readInt16LE(o+i*2)/32768;return{sr,x};}
// 长时平均谱（LPC-free）：对有声帧做 FFT，取对数幅度平均
function ltas(x,sr,from=20,to=120){
  const N=2048,H=1024;const nb=N/2+1;const acc=new Float64Array(nb);let cnt=0;
  const re=new Float32Array(N),im=new Float32Array(N);
  for(let o=Math.floor(from*sr);o+N<Math.min(x.length,to*sr);o+=H){
    let e=0;for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/N);re[i]=x[o+i]*w;im[i]=0;e+=re[i]*re[i];}
    if(Math.sqrt(e/N)<0.01) continue;
    // naive DFT too slow for 2048*1000 frames; use radix-2
    fft(re,im);
    for(let k=0;k<nb;k++)acc[k]+=Math.log(Math.hypot(re[k],im[k])+1e-9);
    cnt++;
  }
  for(let k=0;k<nb;k++)acc[k]/=Math.max(1,cnt);
  return {sr,N,nb,acc,cnt};
}
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
 for(let size=2;size<=n;size<<=1){const half=size>>1,step=n/size;
  for(let i=0;i<n;i+=size)for(let j=0,k=0;j<half;j++,k+=step){const c=Math.cos(2*Math.PI*k/n),s=-Math.sin(2*Math.PI*k/n);
   const a=i+j,b=a+half,tr=re[b]*c-im[b]*s,ti=re[b]*s+im[b]*c;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;}}}
function envPeaks(L,sr,nb){
  const f=k=>k*sr/nb;
  // 平滑 + 找 3 个峰
  const sm=new Float64Array(nb);
  for(let k=1;k<nb-1;k++)sm[k]=(L[k-1]+2*L[k]+L[k+1])/4;
  const peaks=[];
  for(let k=2;k<nb-2;k++) if(sm[k]>sm[k-1]&&sm[k]>sm[k+1]&&f(k)>150&&f(k)<5000) peaks.push([Math.round(f(k)),sm[k]]);
  peaks.sort((a,b)=>b[1]-a[1]);
  return peaks.slice(0,6);
}
const A=wav('demo/冰声_morph.wav');
const a=ltas(A.x,A.sr);
console.log('morph frames',a.cnt);
console.log('peaks:',envPeaks(a.acc,A.sr,a.nb).map(p=>p[0]+'Hz').join(' '));
const B=wav('demo/冰声_114.wav');
const b=ltas(B.x,B.sr);
console.log('old frames',b.cnt);
console.log('peaks:',envPeaks(b.acc,B.sr,b.nb).map(p=>p[0]+'Hz').join(' '));
