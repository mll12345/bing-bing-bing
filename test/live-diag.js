const fs=require('node:fs');
const http=require('node:http');
const PAGE=process.argv[2];
(async()=>{
  const list=await new Promise((res,rej)=>http.get({host:'127.0.0.1',port:9222,path:'/json/list'},r=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>res(JSON.parse(s)))}).on('error',rej));
  const t=list.find(x=>x.type==='page'&&x.url.includes(PAGE.replace(/^https?:\/\//,'')))||list.find(x=>x.type==='page'&&x.url.includes('github.io'));
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  let id=0;const pend=new Map();const logs=[];
  const send=(m,q={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))});
  ws.onmessage=e=>{const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);return}
    if(m.method==='Runtime.consoleAPICalled')logs.push('CONSOLE '+m.params.args.map(a=>a.value||a.description||'').join(' '));
    if(m.method==='Runtime.exceptionThrown')logs.push('EXC '+JSON.stringify(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||m.params.exceptionDetails.text));
    if(m.method==='Log.entryAdded')logs.push('LOG '+m.params.entry.level+' '+m.params.entry.text);
  };
  await new Promise(r=>ws.onopen=r);
  await send('Runtime.enable');await send('Log.enable');await send('Network.enable');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Page.enable');await send('Page.navigate',{url:PAGE+'?cb='+Date.now()});
  await new Promise(r=>setTimeout(r,4000));
  const r=await send('Runtime.evaluate',{expression:`(async()=>{const m=await fetch('samples/bing-bank.json');const b=await fetch('samples/bing-bank.bin');return JSON.stringify({json:m.status,bin:b.status,bytes:(await b.arrayBuffer()).byteLength})})()`,awaitPromise:true,returnByValue:true});
  console.log('fetch test:',r&&r.result&&r.result.value);
  const r2=await send('Runtime.evaluate',{expression:`(async()=>{try{const {renderBank}=await import('./src/bank.js');return 'bank ok '+typeof renderBank}catch(e){return 'ERR '+e.message}})()`,awaitPromise:true,returnByValue:true});
  console.log('module test:',r2&&r2.result&&r2.result.value);
  console.log(logs.join('\n'));
  ws.close();
})();
