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
   const b=window.__ice.state.srcBuffer;
   const n=48000*5;
   const chs=[b.getChannelData(0).slice(0,n), b.getChannelData(1).slice(0,n)];
   const sep=await separate(chs,48000);
   const out={};
   const meas=(name,L,R)=>{let eM=0,eS=0;for(let i=0;i<L.length;i+=5){const m=(L[i]+R[i])/2,s=(L[i]-R[i])/2;eM+=m*m;eS+=s*s;}out[name]=(100*eS/(eM+eS)).toFixed(2);};
   meas('src',chs[0],chs[1]);
   meas('inst',sep.inst[0],sep.inst[1]);
   meas('voc',sep.vocal[0],sep.vocal[1]);
   // 手动构造 mix（与 engine 第 6 步一致）
   const mix=[new Float32Array(n),new Float32Array(n)];
   for(let c=0;c<2;c++){for(let i=0;i<n;i++) mix[c][i]=sep.inst[c][i]*0.94;}
   meas('mix',mix[0],mix[1]);
   // 差异幅度
   let dmax=0, dsum=0;
   for(let i=0;i<n;i++){const d=Math.abs(sep.inst[0][i]-sep.inst[1][i]); if(d>dmax)dmax=d; dsum+=d;}
   out.instDiffMax=dmax.toFixed(4); out.instDiffMean=(dsum/n).toFixed(5);
   let lmax=0; for(let i=0;i<n;i++) lmax=Math.max(lmax,Math.abs(sep.inst[0][i]));
   out.instLPeak=lmax.toFixed(4);
   return JSON.stringify(out);
 })()`,returnByValue:true,awaitPromise:true});
 console.log(r.result.value||JSON.stringify(r.exceptionDetails));
 ws.close();
})();
