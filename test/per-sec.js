const fs=require('node:fs');
const buf=fs.readFileSync('test/out/full_ice.wav');
// parse
const sr=buf.readUInt32LE(24), ch=buf.readUInt16LE(22), bits=buf.readUInt16LE(34);
let off=12, dataOff=-1, dataLen=0;
while(off<buf.length-8){const id=buf.toString('ascii',off,off+4); const sz=buf.readUInt32LE(off+4);
  if(id==='data'){dataOff=off+8;dataLen=sz;break;} off+=8+sz+(sz%2);}
const n=Math.floor(dataLen/(ch*bits/8));
const L=new Float32Array(n);
for(let i=0;i<n;i++) L[i]=buf.readInt16LE(dataOff+i*ch*2)/32768;
// 每 1s 的 rms，找空洞
const sec=Math.floor(sr);
const rows=[];
for(let s=0;s*sr<n;s++){
  let acc=0,cnt=0;
  for(let i=s*sr;i<Math.min(n,(s+1)*sr);i+=7){acc+=L[i]*L[i];cnt++;}
  rows.push(+Math.sqrt(acc/cnt).toFixed(4));
}
// 统计 rms 低于 0.02 的秒数
const quiet=rows.map((v,i)=>[i,v]).filter(([i,v])=>v<0.02);
console.log('secs',rows.length,'quietSecs',quiet.length, JSON.stringify(quiet.slice(0,15)));
const mn=Math.min(...rows), mx=Math.max(...rows);
console.log('min',mn,'max',mx);
// 输出前 40 秒曲线，方便看动态
console.log(rows.slice(0,40).join(' '));
