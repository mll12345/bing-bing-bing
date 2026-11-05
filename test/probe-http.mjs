const urls=[
 'https://mll12345.github.io/bing-bing-bing/',
 'https://mll12345.github.io/bing-bing-bing',
 'https://mll12345.github.io/bing-bing-bing/demo/%E5%86%B0%E5%86%B0%E5%86%B0%E7%89%88_114_%E7%BB%841.mp3',
 'https://mll12345.github.io/bing-bing-bing/src/bank.js'
];
for(const u of urls){
  const r=await fetch(u,{redirect:'manual'});
  const t=await r.text();
  console.log(u,'->',r.status,'len',t.length,'|',t.slice(0,60).replace(/\n/g,' '));
}
