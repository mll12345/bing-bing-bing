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
   const {biquad}=await import('/src/pcm.js');
   const b=window.__ice.state.srcBuffer; const sr=b.sampleRate;
   const n=Math.min(b.length, sr*20);
   const chs=[b.getChannelData(0).slice(0,n), b.getChannelData(1).slice(0,n)];
   const sep=await separate(chs,sr);
   const rms=a=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*a[i];return Math.sqrt(s/a.length);};
   const low=a=>{const t=Float32Array.from(a);biquad(t,sr,'lowpass',160,0.7);return rms(t);};
   const mid=a=>{const t=Float32Array.from(a);biquad(t,sr,'highpass',160,0.7);biquad(t,sr,'lowpass',3000,0.7);return rms(t);};
   const hi=a=>{const t=Float32Array.from(a);biquad(t,sr,'highpass',3000,0.7);return rms(t);};
   const o={};
   o.src={rms:+rms(chs[0]).toFixed(4),low:+low(chs[0]).toFixed(4),mid:+mid(chs[0]).toFixed(4),hi:+hi(chs[0]).toFixed(4)};
   o.inst={rms:+rms(sep.inst[0]).toFixed(4),low:+low(sep.inst[0]).toFixed(4),mid:+mid(sep.inst[0]).toFixed(4),hi:+hi(sep.inst[0]).toFixed(4)};
   o.voc={rms:+rms(sep.vocal[0]).toFixed(4),low:+low(sep.vocal[0]).toFixed(4),mid:+mid(sep.vocal[0]).toFixed(4),hi:+hi(sep.vocal[0]).toFixed(4)};
   return JSON.stringify(o);
 })()`,returnByValue:true,awaitPromise:true});
 console.log(r.result.value||JSON.stringify(r.exceptionDetails));
 ws.close();
})();
