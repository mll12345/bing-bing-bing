const CDP='http://127.0.0.1:9222';
(async()=>{
 const t=(await (await fetch(CDP+'/json/list')).json()).filter(x=>x.type==='page'&&x.url.includes('8199'))[0];
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const p=new Map();
 const send=(m,pr={})=>new Promise((res,rej)=>{const i=++id;p.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:pr}))});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id); m.error?q.rej(new Error(m.error.message)):q.res(m.result);}});
 await new Promise(r=>ws.addEventListener('open',r));
 await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:8199/?cb='+Date.now()});
 await new Promise(r=>setTimeout(r,1500));
 const r=await send('Runtime.evaluate',{expression:`(async()=>{
   const {synthBing}=await import('/src/voice.js?x='+Date.now());
   const {makeFFT}=await import('/src/fft.js');
   const sr=48000;
   const out=[];
   for(const timbre of [1,2,3]){
     const b=synthBing({sr,f0:220,dur:0.45,amp:1,timbre});
     const N=8192, off=Math.round(0.12*sr);
     const re=new Float32Array(N), im=new Float32Array(N);
     for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/N); re[i]=(b[off+i]||0)*w; im[i]=0;}
     const fft=makeFFT(N); fft(re,im,false);
     const mag=new Float32Array(N/2);
     for(let k=0;k<N/2;k++) mag[k]=Math.hypot(re[k],im[k]);
     const hz=k=>k*sr/N;
     const peaks=[];
     for(let k=8;k<N/2-2;k++){ if(mag[k]>mag[k-1]&&mag[k]>=mag[k+1]&&hz(k)>150&&hz(k)<5000) peaks.push([Math.round(hz(k)), +mag[k].toFixed(3)]); }
     peaks.sort((a,b)=>b[1]-a[1]);
     out.push({timbre, top:peaks.slice(0,8)});
   }
   return JSON.stringify(out);
 })()`,returnByValue:true,awaitPromise:true});
 console.log(r.result.value||JSON.stringify(r.exceptionDetails));
 ws.close();
})();
