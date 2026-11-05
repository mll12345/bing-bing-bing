const fs=require('node:fs');
function wav(f){const b=fs.readFileSync(f);const sr=b.readUInt32LE(24);let o=12;while(o<b.length-8){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='data'){o=o+8;break}o+=8+sz+(sz%2)}const n=(b.length-o)/2;const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=b.readInt16LE(o+i*2)/32768;return{sr,x};}
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
 for(let size=2;size<=n;size<<=1){const half=size>>1,step=n/size;
  for(let i=0;i<n;i+=size)for(let j=0,k=0;j<half;j++,k+=step){const c=Math.cos(2*Math.PI*k/n),s=-Math.sin(2*Math.PI*k/n);
   const a=i+j,b=a+half,tr=re[b]*c-im[b]*s,ti=re[b]*s+im[b]*c;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;}}}
// 简单可靠的包络：对数幅度 → 滑动平均（窗宽 ~250Hz）
function env(x,sr,at,N=2048){
 const re=new Float32Array(N),im=new Float32Array(N);
 for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/N);re[i]=(x[at+i]||0)*w;im[i]=0;}
 fft(re,im);
 const nb=N/2+1, lm=new Float64Array(nb);
 for(let k=0;k<nb;k++)lm[k]=Math.log(Math.hypot(re[k],im[k])+1e-9);
 const binHz=sr/N, half=Math.max(1,Math.round(125/binHz));
 const out=new Float64Array(nb);
 for(let k=0;k<nb;k++){let s=0,c=0;for(let j=Math.max(1,k-half);j<=Math.min(nb-1,k+half);j++){s+=lm[j];c++;}out[k]=s/c;}
 return {out,sr,nb,N};
}
function peaks(e){
 const nb=e.nb,sr=e.sr,N=e.N;
 const out=[];
 for(let k=4;k<nb-4;k++){const f=k*sr/N; if(f<150||f>5000)continue;
  const v=e.out[k];
  if(v>e.out[k-1]&&v>e.out[k+1]) out.push([Math.round(f),v]);}
 out.sort((a,b)=>b[1]-a[1]);
 const keep=[];for(const p of out){if(keep.every(q=>Math.abs(q[0]-p[0])>300))keep.push(p);if(keep.length>=5)break;}
 return keep.map(p=>p[0]+'Hz').join(' ');
}
const man=JSON.parse(fs.readFileSync('demo/冰声_morph.json','utf8'));
const M=wav('demo/冰声_morph.wav');
const O=wav('demo/冰声_114.wav');
const S=wav('demo/冰声_114.wav');
const long=man.first.filter(n=>n.d>0.16).slice(0,6);
for(const nt of long){
 const at=Math.round((nt.t+nt.d*0.3)*M.sr);
 console.log(`t=${nt.t} d=${nt.d} f0=${nt.f0}`);
 console.log(`   synth: ${peaks(env(O.x,O.sr,at))}`);
 console.log(`   morph: ${peaks(env(M.x,M.sr,at))}`);
}
