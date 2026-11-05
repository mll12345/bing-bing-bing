const fs=require('node:fs');
function readWav(f){const b=fs.readFileSync(f);const sr=b.readUInt32LE(24),ch=b.readUInt16LE(22),bits=b.readUInt16LE(34);let o=12,d=-1,dl=0;while(o<b.length-8){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='data'){d=o+8;dl=sz;break}o+=8+sz+(sz%2)}const n=Math.floor(dl/(ch*bits/8));const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=b.readInt16LE(d+i*ch*2)/32768;return {sr,x};}
(async()=>{
 const {pitchTrack}=await import('../src/voice.js');
 const {sr,x}=readWav('demo/冰声_114.wav');
 const man=JSON.parse(fs.readFileSync('demo/冰声_114.json','utf8'));
 const tr=pitchTrack(x,sr);
 let hit=0,n=0,rows=[];
 for(const nt of man.notes){
   const i=Math.min(tr.frames-1,Math.round((nt.t+0.03)/tr.hopSec));
   const got=tr.f0[i];
   if(tr.clarity[i]>0.5){n++; if(Math.abs(1200*Math.log2(got/nt.f0))<60) hit++;}
   if(rows.length<8) rows.push({t:nt.t,want:Math.round(nt.f0),got:Math.round(got),cl:+tr.clarity[i].toFixed(2)});
 }
 rows.forEach(r=>console.log(`  t=${r.t}  want=${r.want}  got=${r.got}  clarity=${r.cl}`));
 console.log(`match ${hit}/${n} (${(100*hit/Math.max(1,n)).toFixed(1)}%)`);
})();

