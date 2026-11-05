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
   const chs=[b.getChannelData(0).slice(0,48000*5), b.getChannelData(1).slice(0,48000*5)];
   let eS=0,eM=0;
   for(let i=0;i<chs[0].length;i+=5){const m=(chs[0][i]+chs[1][i])/2,s=(chs[0][i]-chs[1][i])/2;eM+=m*m;eS+=s*s;}
   const sep=await separate(chs,48000);
   let ieS=0,ieM=0,veS=0,veM=0;
   const n=sep.inst[0].length;
   for(let i=0;i<n;i+=5){const m=(sep.inst[0][i]+sep.inst[1][i])/2,s=(sep.inst[0][i]-sep.inst[1][i])/2;ieM+=m*m;ieS+=s*s;
     const vm=(sep.vocal[0][i]+sep.vocal[1][i])/2, vs=(sep.vocal[0][i]-sep.vocal[1][i])/2; veM+=vm*vm; veS+=vs*vs;}
   return JSON.stringify({srcSide:(100*eS/(eM+eS)).toFixed(2), instSide:(100*ieS/(ieM+ieS)).toFixed(2), vocSide:(100*veS/(veM+veS+1e-12)).toFixed(2), instChans:sep.inst.length, n});
 })()`,returnByValue:true,awaitPromise:true});
 console.log(r.result.value||JSON.stringify(r.exceptionDetails));
 ws.close();
})();
