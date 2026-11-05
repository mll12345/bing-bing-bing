const urls=[
 'https://mll12345.github.io/bing-bing-bing/README.md',
 'https://mll12345.github.io/bing-bing-bing/samples/%E5%86%B0%E7%BB%841.mp3',
 'https://github.com/mll12345/bing-bing-bing',
 'https://cdn.jsdelivr.net/gh/mll12345/bing-bing-bing@main/index.html',
 'https://cdn.jsdelivr.net/gh/mll12345/bing-bing-bing@main/src/bank.js'
];
for(const u of urls){
  try{
    const r=await fetch(u,{redirect:'manual'});
    const t=await r.text();
    console.log(r.status, u, 'len', t.length);
  }catch(e){ console.log('ERR', u, e.message); }
}
