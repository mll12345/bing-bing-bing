const fs=require('node:fs');
function wav(f){const b=fs.readFileSync(f);const sr=b.readUInt32LE(24),ch=b.readUInt16LE(22);let o=12;while(o<b.length-8){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='data'){o=o+8;break}o+=8+sz+(sz%2)}const n=(b.length-o)/2;const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=b.readInt16LE(o+i*2)/32768;return{sr,x};}
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
 for(let size=2;size<=n;size<<=1){const half=size>>1,step=n/size;
  for(let i=0;i<n;i+=size)for(let j=0,k=0;j<half;j++,k+=step){const c=Math.cos(2*Math.PI*k/n),s=-Math.sin(2*Math.PI*k/n);
   const a=i+j,b=a+half,tr=re[b]*c-im[b]*s,ti=re[b]*s+im[b]*c;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;}}}
// 倒谱平滑求包络
function env(x,sr,at){
 const N=2048;const re=new Float32Array(N),im=new Float32Array(N);
 for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/N);re[i]=(x[at+i]||0)*w;im[i]=0;}
 fft(re,im);
 const nb=N/2+1;const logm=new Float64Array(nb);
 for(let k=0;k<nb;k++)logm[k]=Math.log(Math.hypot(re[k],im[k])+1e-9);
 // 倒谱低通：只留前 40 个倒谱系数
 const c=new Float64Array(N);
 const rr=new Float32Array(N),ii=new Float32Array(N);
 for(let k=0;k<nb;k++){rr[k]=logm[k];ii[k]=0;}
 for(let k=1;k<N/2;k++){rr[N-k]=logm[k];ii[N-k]=0;}
 fft(rr,ii); fft(rr,ii); // 两次正变换等价于逆变换×N，取实部为倒谱
 for(let k=0;k<N;k++)c[k]=rr[k]/N;
 const cut=40; const cf=new Float64Array(N);
 for(let k=0;k<=cut;k++){cf[k]=c[k]; if(k>0)cf[N-k]=c[N-k];}
 const cr=new Float32Array(N),ci=new Float32Array(N);
 for(let k=0;k<N;k++){cr[k]=cf[k];ci[k]=0;}
 fft(cr,ci);
 const env=new Float64Array(nb);
 for(let k=0;k<nb;k++)env[k]=cr[k];
 return {env,sr,nb};
}
function peaksFor(e){
 const nb=e.nb,sr=e.sr;const sm=new Float64Array(nb);
 for(let k=1;k<nb-1;k++)sm[k]=(e.env[k-1]+2*e.env[k]+e.env[k+1])/4;
 const out=[];
 for(let k=3;k<nb-3;k++){const f=k*sr/nb; if(f<150||f>5000)continue;
  if(sm[k]>sm[k-1]&&sm[k]>sm[k+1]&&sm[k]>sm[k-2]&&sm[k]>sm[k+2]) out.push([Math.round(f),sm[k]]);}
 out.sort((a,b)=>b[1]-a[1]);
 // 只保留互不靠近的峰
 const keep=[];for(const p of out){if(keep.every(q=>Math.abs(q[0]-p[0])>250))keep.push(p);if(keep.length>=5)break;}
 return keep.map(p=>p[0]+'Hz');
}
const man=JSON.parse(fs.readFileSync('demo/冰声_morph.json','utf8'));
const M=wav('demo/冰声_morph.wav');
const O=wav('demo/冰声_114.wav');
// 挑 5 个较长音符
const long=man.first.filter(n=>n.d>0.18).slice(0,5);
for(const nt of long){
 const at=Math.round((nt.t+nt.d*0.25)*M.sr);
 console.log(`t=${nt.t} f0=${nt.f0}  synth: ${peaksFor(env(O.x,O.sr,at)).join(' ')}`);
 console.log(`                      morph: ${peaksFor(env(M.x,M.sr,at)).join(' ')}`);
}
