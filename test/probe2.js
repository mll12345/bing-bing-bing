const http=require('http');
const getJSON=(p)=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9222,path:p},(r)=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>{try{res(JSON.parse(s))}catch(e){rej(e)}})}).on('error',rej)});
(async()=>{
 const list=await getJSON('/json/list');const t=list.find(x=>x.type==='page'&&x.url.includes('8199'));
 const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const p=new Map();const logs=[];
 const send=(m,q={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id);return;}
  if(m.method==='Runtime.exceptionThrown')logs.push('EXC '+(m.params.exceptionDetails?.exception?.description||m.params.exceptionDetails?.text));
  if(m.method==='Runtime.consoleAPICalled')logs.push('CONSOLE '+m.params.type+' '+m.params.args.map(a=>a.value??a.description).join(' '));};
 await new Promise(r=>ws.onopen=r);
 await send('Runtime.enable');await send('Log.enable');
 await send('Page.reload',{ignoreCache:true});
 await new Promise(r=>setTimeout(r,3000));
 const r=await send('Runtime.evaluate',{expression:`JSON.stringify({ice:typeof window.__ice,hasState:!!window.__ice?.state,err:document.getElementById('errBox')?.textContent||''})`,returnByValue:true});
 console.log(r.result.value);
 console.log(logs.join('\n'));
 ws.close();process.exit(0);
})();
