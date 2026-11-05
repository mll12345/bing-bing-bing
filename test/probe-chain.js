const CDP='http://127.0.0.1:9222';
(async()=>{
 const t=(await (await fetch(CDP+'/json/list')).json()).filter(x=>x.type==='page'&&x.url.includes('8199'))[0];
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const p=new Map();
 const send=(m,pr={})=>new Promise((res,rej)=>{const i=++id;p.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:pr}))});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id); m.error?q.rej(new Error(m.error.message)):q.res(m.result);}});
 await new Promise(r=>ws.addEventListener('open',r));
 await send('Runtime.enable');
 const r=await send('Runtime.evaluate',{expression:`(async()=>{
   const {satCurve}=await import('/src/dsp.js');
   const sr=48000, n=sr*2;
   const octx=new OfflineAudioContext(2,n,sr);
   const buf=octx.createBuffer(2,n,sr);
   const a=buf.getChannelData(0), b=buf.getChannelData(1);
   for(let i=0;i<n;i++){a[i]=0.4*Math.sin(2*Math.PI*220*i/sr); b[i]=0.4*Math.sin(2*Math.PI*330*i/sr);}
   const src=octx.createBufferSource(); src.buffer=buf;
   const hp=octx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=24;
   const air=octx.createBiquadFilter(); air.type='highshelf'; air.frequency.value=9000; air.gain.value=1.6;
   const sat=octx.createWaveShaper(); sat.curve=satCurve(1.12); sat.oversample='2x';
   const comp=octx.createDynamicsCompressor(); comp.threshold.value=-18; comp.knee.value=10; comp.ratio.value=2.6;
   const limit=octx.createDynamicsCompressor(); limit.threshold.value=-2.4; limit.ratio.value=20;
   src.connect(hp).connect(air).connect(sat).connect(comp).connect(limit).connect(octx.destination);
   src.start();
   const out=await octx.startRendering();
   const L=out.getChannelData(0), R=out.getChannelData(1);
   let eM=0,eS=0; for(let i=0;i<n;i+=5){const m=(L[i]+R[i])/2,s=(L[i]-R[i])/2;eM+=m*m;eS+=s*s;}
   return JSON.stringify({sidePct:(100*eS/(eM+eS)).toFixed(2), ch:out.numberOfChannels});
 })()`,returnByValue:true,awaitPromise:true});
 console.log(r.result.value||JSON.stringify(r.exceptionDetails));
 ws.close();
})();
