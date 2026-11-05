const CDP='http://127.0.0.1:9222';
const PAGE='https://mll12345.github.io/bing-bing-bing/';
(async()=>{
 const l=await (await fetch(CDP+'/json/list')).json();
 const t=l.filter(x=>x.type==='page')[0];
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const p=new Map(); const errs=[];
 const send=(m,pr={})=>new Promise((res,rej)=>{const i=++id;p.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:pr}))});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
   if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id);m.error?q.rej(new Error(m.error.message)):q.res(m.result);return;}
   if(m.method==='Runtime.exceptionThrown')errs.push('EXC '+(m.params.exceptionDetails?.exception?.description||m.params.exceptionDetails?.text));
   if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errs.push('ERR '+m.params.args.map(a=>a.value??a.description??'').join(' '));
   if(m.method==='Network.loadingFailed')errs.push('FAIL '+m.params.errorText+' '+m.params.requestId);
 });
 await new Promise(r=>ws.addEventListener('open',r));
 await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
 await send('Page.navigate',{url:PAGE+'?cb='+Date.now()});
 await new Promise(r=>setTimeout(r,4000));
 const r=await send('Runtime.evaluate',{expression:`JSON.stringify({ice:!!window.__ice, drop:!!document.getElementById('dropzone'), err:document.getElementById('errBox')?.textContent||'', mods:[typeof window.__ice]})`,returnByValue:true});
 console.log(r.result.value);
 console.log(errs.slice(0,10).join('\n'));
 ws.close();
})();
