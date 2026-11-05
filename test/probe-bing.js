const CDP='http://127.0.0.1:9222';
(async()=>{
 const t=(await (await fetch(CDP+'/json/list')).json()).filter(x=>x.type==='page'&&x.url.includes('8199'))[0];
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const p=new Map();
 const send=(m,pr={})=>new Promise((res,rej)=>{const i=++id;p.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:pr}))});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id); m.error?q.rej(new Error(m.error.message)):q.res(m.result);}});
 await new Promise(r=>ws.addEventListener('open',r));
 await send('Runtime.enable');
 const r=await send('Runtime.evaluate',{expression:`(async()=>{
   const {separate}=await import('/src/vocals.js');
   const {pitchTrack,toNotes,renderBingTrack,synthBing}=await import('/src/voice.js');
   const b=window.__ice.state.srcBuffer; const sr=b.sampleRate;
   const n=Math.min(b.length, sr*20);
   const chs=[b.getChannelData(0).slice(0,n), b.getChannelData(1).slice(0,n)];
   const sep=await separate(chs,sr);
   const tr=pitchTrack(sep.mono,sr);
   const notes=toNotes(tr,{minDur:0.07,clarityMin:0.26});
   const bing=renderBingTrack(notes,sr,n,{gain:1,timbre:2});
   // 用 pitchTrack 反过来测冰声轨，看是否与音符基频一致
   const tr2=pitchTrack(bing.data,sr);
   const rows=[];
   for(const nt of notes.slice(0,10)){
     const f0=Math.round(nt.start/tr2.hopSec)+3;
     const i0=Math.max(0,Math.min(tr2.frames-1,f0));
     rows.push({t:+nt.start.toFixed(2), want:Math.round(nt.f0), got:Math.round(tr2.f0[i0]), cl:+tr2.clarity[i0].toFixed(2), amp:+nt.amp.toFixed(3)});
   }
   // 同时存一份冰声轨 WAV
   const buf=new ArrayBuffer(44+bing.data.length*2); const v=new DataView(buf);
   const wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
   wr(0,'RIFF'); v.setUint32(4,36+bing.data.length*2,true); wr(8,'WAVE'); wr(12,'fmt ');
   v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sr,true);
   v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); wr(36,'data');
   v.setUint32(40,bing.data.length*2,true);
   for(let i=0;i<bing.data.length;i++){const s=Math.max(-1,Math.min(1,bing.data[i])); v.setInt16(44+i*2, s*32767, true);}
   await fetch('/save/bing_only.wav',{method:'POST',body:new Blob([buf])});
   return JSON.stringify({notes:notes.length, rows});
 })()`,returnByValue:true,awaitPromise:true});
 console.log(r.result.value||JSON.stringify(r.exceptionDetails));
 ws.close();
})();
