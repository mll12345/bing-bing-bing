import fs from 'node:fs';
const SR=44100;
const raw=new Float32Array(fs.readFileSync('test/ref.f32').buffer.slice(0));
const n=Math.floor(raw.length/2);
const mono=new Float32Array(n);
for(let i=0;i<n;i++) mono[i]=(raw[i*2]+raw[i*2+1])/2;
const hop=Math.floor(SR*0.005);
const out=[];
for(let p=0;p+hop<=n;p+=hop){
  let s=0;for(let i=0;i<hop;i++)s+=mono[p+i]*mono[p+i];
  out.push(Math.sqrt(s/hop));
}
const mx=Math.max(...out);
let line='';
for(let i=0;i<out.length;i++){
  const t=i*0.005;
  const v=out[i]/mx;
  const bar='#'.repeat(Math.round(v*30));
  if(t>0.10&&t<1.20) line+=`${t.toFixed(3)} ${v.toFixed(2).padStart(5)} ${bar}\n`;
}
console.log(line);
