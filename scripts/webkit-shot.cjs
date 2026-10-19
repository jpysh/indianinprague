// iPhone-width WebKit check for shop pages (CLAUDE.md). Needs playwright, which is not a project dependency:
//   mkdir /tmp/pw && cd /tmp/pw && npm i playwright && npx playwright install webkit
//   (cd dist && python3 -m http.server 4399 &) ; OUT=/tmp node /path/to/scripts/webkit-shot.cjs /cs/wardrobe/fashion.html
// Prints scrollWidth vs clientWidth (overflow check) and writes a PNG per URL to $OUT. Run from the playwright folder.
const {webkit,devices}=require("playwright");
(async()=>{const b=await webkit.launch();const c=await b.newContext({...devices["iPhone 13"],reducedMotion:"reduce"});const p=await c.newPage();
for(const u of process.argv.slice(2)){await p.goto("http://localhost:4399"+u,{waitUntil:"networkidle"});
const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,t:document.querySelector("h1")?.innerText}));
console.log(u,JSON.stringify(o));await p.screenshot({path:process.env.OUT+"/"+u.replace(/\W+/g,"_")+".png"});}
await b.close()})();
