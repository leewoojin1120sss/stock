/* Shared, deterministic auction engine. All money is integer KRW. */
export const STEP = 600_000, DAY = 86_400_000, INITIAL_CASH = 10_000_000;
export const FEE = 0.001;
export type Row = Record<string, any>;
export type Stock = { id:string; name:string; sector:string; kind:string; initial:number; price:number; previous:number; day_open:number; high:number; low:number; volume:number; turnover:number; shares:number; pe:number; dividend:number; beta:number; net_flow:number };
const names = ['가지환','강선후','강현규','고범수','권아현','김관율','김민찬','김예준','노지환','문서희','박시후','신성현','양다연','유동우','유소윤','이나경','이민서','이서영','이우진','정도현','조우성','조은솔','차주해','한덕규','허유진','문주원','민경서'];
const sectors = ['테크놀로지','바이오','금융','에너지','엔터테인먼트','소비재','모빌리티','반도체','플랫폼'];
const suffixes = ['테크','바이오','금융','에너지','엔터','리테일','모빌리티','반도체','플랫폼'];
export function random(seed:string) { let h=2166136261; for(let i=0;i<seed.length;i++) h=Math.imul(h^seed.charCodeAt(i),16777619); return (h>>>0)/4294967296; }
export function session(ts:number) { const day=Math.floor((ts+9*3_600_000)/DAY)*DAY-9*3_600_000; return {day,open:day+1000*60_000,close:day+1420*60_000}; }
export function nextTick(ts:number) { const s=session(ts); return ts<s.open?s.open:ts<s.close?Math.min(s.close,ts+STEP):s.open+DAY; }
export function isOpen(ts:number) { const s=session(ts); return ts>=s.open&&ts<s.close; }
export function fee(amount:number) {return Math.floor((amount+999)/1000);}
export function priceBounds(previous:number) {return {lower:Math.max(1,Math.ceil(previous*.7)),upper:Math.floor(previous*1.3)};}
export function seedStocks():Stock[] {
 const out=names.map((n,i)=>{const p=12000+Math.floor(random(n)*780)*100;return {id:String(i+1).padStart(6,'0'),name:n+suffixes[i%9],sector:sectors[i%9],kind:'stock',initial:p,price:p,previous:p,day_open:p,high:p,low:p,volume:0,turnover:0,shares:1_000_000+Math.floor(random(n+'shares')*90)*100_000,pe:Math.round((8+random(n+'pe')*35)*10)/10,dividend:Math.round(random(n+'div')*40)/10,beta:Math.round((.7+random(n+'beta')*1.1)*100)/100,net_flow:0};});
 for(const [i,name,kind] of [[101,'부석 27 ETF','index'],[102,'부석 인버스','inverse'],[103,'부석 레버리지 2X','leverage'],[104,'부석 인버스 2X','inverse2']] as const)out.push({id:String(i).padStart(6,'0'),name,sector:'ETF',kind,initial:10000,price:10000,previous:10000,day_open:10000,high:10000,low:10000,volume:0,turnover:0,shares:10_000_000,pe:0,dividend:0,beta:kind==='leverage'||kind==='inverse2'?2:1,net_flow:0});
 return out;
}
export function makeNews(ts:number, stocks:Stock[], initial=false) {
 const s=stocks[Math.floor(random(ts+'news-symbol')*27)];
 const events=[['신규 계약','대형 공급 계약 체결… 매출 성장 기대','가상 기업이 장기 공급 계약을 발표했습니다. 계약 이행과 수익성은 아직 확정되지 않았습니다.',.014],['실적 전망','분기 실적 전망 상향… 시장 기대 확대','가상 증권사들이 수요 증가를 이유로 이익 추정치를 높였습니다. 실제 결과는 전망과 다를 수 있습니다.',.012],['비용 부담','원가 부담 확대… 단기 수익성 우려','가상 원자재 가격 상승으로 비용 증가가 예상됩니다. 가격 전가 능력이 향후 관건입니다.',-.014],['투자 확대','차세대 사업 투자 발표… 성장과 비용 사이','가상 기업이 연구개발 투자를 확대합니다. 장기 성장 기대와 단기 비용 부담이 함께 존재합니다.',.007],['수요 둔화','수요 전망 하향… 투자 심리 위축','가상 산업 조사에서 신규 주문의 둔화가 확인됐습니다. 다음 분기의 회복 여부를 지켜볼 필요가 있습니다.',-.012],['산업 동향','업종 지원 정책 발표… 관련주 관심','게임 속 산업 지원 정책이 발표됐습니다. 같은 업종에도 긍정적 파급 효과가 제한적으로 반영됩니다.',.009]] as const;
 const e=events[Math.floor(random(ts+'news-type')*events.length)];
 return {id:initial?'opening-'+ts:'news-'+ts,ts,stock_id:s.id,sector:s.sector,title:s.name+' '+e[1],body:e[2]+' 이 소식은 모의투자용으로 생성되며 실제 인물과 무관합니다.',impact:e[3],expires:ts+STEP*6,category:e[0]};
}
const statement=(db:D1Database,sql:string,values:any[]=[])=>db.prepare(sql).bind(...values);
export async function bootstrap(db:D1Database,now:number) {
 if(await db.prepare('SELECT id FROM market WHERE id=1').first())return;
 const anchor=session(now).close-DAY, stocks=seedStocks();
 const commands=[statement(db,'INSERT INTO market(id,last_tick,revision) VALUES(1,?,0)',[anchor])];
 for(const s of stocks){const keys=Object.keys(s);commands.push(statement(db,`INSERT INTO stocks(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,Object.values(s)));commands.push(statement(db,'INSERT INTO candles(stock_id,ts,open,high,low,close,volume) VALUES(?,?,?,?,?,?,0)',[s.id,anchor,s.price,s.price,s.price,s.price]));}
 commands.push(statement(db,'INSERT INTO ticks(ts,index_value) VALUES(?,1000)',[anchor]));
 for(let i=0;i<4;i++){const n=makeNews(now-i*1000,stocks,true);const keys=Object.keys(n);commands.push(statement(db,`INSERT INTO news(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,Object.values(n)));}
 try{await db.batch(commands);}catch(e){if(!await db.prepare('SELECT id FROM market WHERE id=1').first())throw e;}
}
export function calculateTick(stocks:Stock[],queued:Row[],activeNews:Row[],ts:number) {
 const opening=ts===session(ts).open;
 const marketNoise=(random(ts+'macro')-.5)*.011;
 const next=stocks.filter(s=>s.kind==='stock').map(s=>{
  const demand=queued.filter(o=>o.stock_id===s.id).reduce((v,o)=>v+(o.side==='buy'?1:-1)*o.qty*s.price,0);
  const flow=Math.tanh(demand/(s.price*3000))*.009;
  const newsImpact=activeNews.filter(n=>n.ts<=ts&&n.expires>=ts).reduce((v,n)=>v+(n.stock_id===s.id?n.impact:n.sector===s.sector?n.impact*.24:0)*Math.max(0,(n.expires-ts)/(STEP*6)),0);
  const change=marketNoise*s.beta+(random(ts+s.sector)-.5)*.009+(random(ts+s.id)-.5)*.018*s.beta+flow+newsImpact;
  const previous=opening?s.price:s.previous,{lower,upper}=priceBounds(previous);
  const price=Math.max(lower,Math.min(upper,Math.round(s.price*(1+change))));
  return {...s,price,previous,day_open:opening?price:s.day_open,high:opening?price:Math.max(s.high,price),low:opening?price:Math.min(s.low,price),volume:opening?0:s.volume,turnover:opening?0:s.turnover,net_flow:opening?0:s.net_flow};
 });
 const dayReturn=next.reduce((sum,s)=>sum+s.price/s.previous,0)/27-1;
 for(const s of stocks.filter(s=>s.kind!=='stock')){
  const previous=opening?s.price:s.previous, mult=s.kind==='index'?1:s.kind==='inverse'?-1:s.kind==='leverage'?2:-2;
  const {lower,upper}=priceBounds(previous), price=Math.max(lower,Math.min(upper,Math.round(previous*(1+mult*dayReturn-.0005))));
  next.push({...s,price,previous,day_open:opening?price:s.day_open,high:opening?price:Math.max(s.high,price),low:opening?price:Math.min(s.low,price),volume:opening?0:s.volume,turnover:opening?0:s.turnover,net_flow:opening?0:s.net_flow});
 }
 return next;
}
export async function advanceMarket(db:D1Database,now:number,maxSteps=4) {
 await bootstrap(db,now);
 for(let step=0;step<maxSteps;step++){
  const m=await db.prepare('SELECT * FROM market WHERE id=1').first<Row>(); if(!m)throw Error('MARKET_MISSING');
  const ts=nextTick(m.last_tick);if(ts>now)return false;
  const [sr,or,nr]=await Promise.all([db.prepare('SELECT * FROM stocks').all<Stock>(),statement(db,"SELECT * FROM orders WHERE status='open' AND created<? ORDER BY created,id",[ts]).all<Row>(),statement(db,'SELECT * FROM news WHERE expires>=? AND ts<=?',[ts,ts]).all<Row>()]);
  const generated=makeNews(ts,sr.results), active=ts%1_800_000===0?[...nr.results,generated]:nr.results;
  const next=calculateTick(sr.results,or.results,active,ts);
  const idx=next.filter(s=>s.kind==='stock').reduce((n,s)=>n+s.price/s.initial,0)/27*1000;
  // Unique tick and revision guard make competing materializers mutually exclusive.
  const commands=[statement(db,'INSERT INTO ticks(ts,index_value) VALUES(?,?)',[ts,idx]),statement(db,'UPDATE market SET last_tick=?,revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END WHERE id=1',[ts,m.revision])];
  for(const s of next){
   let buys=0,sells=0; const eligible=or.results.filter(o=>o.stock_id===s.id&&(o.side==='buy'?o.limit_price>=s.price:o.kind==='market'||o.limit_price<=s.price));
   const buyTotal=eligible.filter(o=>o.side==='buy').reduce((x,o)=>x+o.qty,0),sellTotal=eligible.filter(o=>o.side==='sell').reduce((x,o)=>x+o.qty,0);
   // User orders cross first; the virtual market maker supplies up to 2,000 net shares per interval.
   const buyCapacity=sellTotal+2000,sellCapacity=buyTotal+2000;
   for(const o of eligible){if(o.side==='buy'?buys+o.qty>buyCapacity:sells+o.qty>sellCapacity)continue;
    if(o.side==='buy')buys+=o.qty;else sells+=o.qty;
    commands.push(statement(db,"UPDATE orders SET status='filled',fill_price=?,fee=?,filled_at=? WHERE id=? AND status='open'",[s.price,fee(s.price*o.qty),ts,o.id]));
   }
   const volume=buys+sells,net=buys-sells;
   commands.push(statement(db,'UPDATE stocks SET price=?,previous=?,day_open=?,high=?,low=?,volume=?,turnover=?,net_flow=? WHERE id=?',[s.price,s.previous,s.day_open,s.high,s.low,s.volume+volume,s.turnover+volume*s.price,s.net_flow+net,s.id]));
   const old=sr.results.find(x=>x.id===s.id)!;
   commands.push(statement(db,'INSERT INTO candles(stock_id,ts,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?)',[s.id,ts,old.price,Math.max(old.price,s.price),Math.min(old.price,s.price),s.price,volume]));
  }
  if(active.includes(generated)){const keys=Object.keys(generated);commands.push(statement(db,`INSERT INTO news(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,Object.values(generated)));}
  if(ts===session(ts).close)commands.push(db.prepare("UPDATE orders SET status='expired' WHERE status='open'"));
  commands.push(statement(db,'DELETE FROM candles WHERE ts<?',[ts-90*DAY]),statement(db,'DELETE FROM news WHERE expires<?',[ts-7*DAY]));
  try{await db.batch(commands);}catch(e){if(String(e).includes('STALE_MARKET'))continue;const newer=await db.prepare('SELECT last_tick FROM market WHERE id=1').first<Row>();if(!newer||newer.last_tick<ts)throw e;}
 }
 const m=await db.prepare('SELECT last_tick FROM market WHERE id=1').first<Row>();return nextTick(m!.last_tick)<=now;
}
export async function accountFor(db:D1Database,id:string,now:number){
 // Never publish email or a real-name default on the ranking.
 await statement(db,'INSERT OR IGNORE INTO accounts(id,nickname,cash,reserved,realized,created) VALUES(?,?,?,0,0,?)',[id,'투자자 '+Math.floor(random(id)*90000+10000),INITIAL_CASH,now]).run();
 return statement(db,'SELECT nickname,cash,reserved,realized,created FROM accounts WHERE id=?',[id]).first<Row>();
}
export async function placeOrder(db:D1Database,userId:string,input:Row,now:number){
 if(!isOpen(now))throw Error('장은 매일 16:40~23:40에 열립니다. (한국 시간)');
 const {stockId,side,kind,qty,requestKey}=input;
 if(typeof stockId!=='string'||!['buy','sell'].includes(side)||!['market','limit'].includes(kind)||!Number.isInteger(qty)||qty<1||qty>2000||typeof requestKey!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(requestKey))throw Error('주문 입력을 확인해주세요. 수량은 1~2,000주입니다.');
 const existing=await statement(db,'SELECT id FROM orders WHERE user_id=? AND request_key=?',[userId,requestKey]).first();if(existing)return {duplicate:true};
 const stock=await statement(db,'SELECT * FROM stocks WHERE id=?',[stockId]).first<Stock>();if(!stock)throw Error('종목을 찾을 수 없습니다.');
 const bounds=priceBounds(stock.previous); const limit=kind==='market'?(side==='buy'?bounds.upper:bounds.lower):input.limitPrice;
 if(!Number.isInteger(limit)||limit<bounds.lower||limit>bounds.upper)throw Error(`주문 가격은 ${bounds.lower.toLocaleString()}~${bounds.upper.toLocaleString()}원입니다.`);
 const reserved=side==='buy'?qty*limit+fee(qty*limit):0;
 try{await statement(db,"INSERT INTO orders(id,user_id,stock_id,side,kind,qty,limit_price,reserve_cash,status,created,request_key) VALUES(?,?,?,?,?,?,?,?,'open',?,?)",[crypto.randomUUID(),userId,stockId,side,kind,qty,limit,reserved,now,requestKey]).run();}catch(e){
  const msg=String(e);if(msg.includes('INSUFFICIENT_CASH'))throw Error('주문 가능 금액이 부족합니다. 시장가 매수는 상한가 기준으로 금액을 확보합니다.');if(msg.includes('INSUFFICIENT_SHARES'))throw Error('매도 가능한 주식이 부족합니다.');if(msg.includes('ORDER_LIMIT'))throw Error('미체결 주문은 최대 30건까지 가능합니다.');if(msg.includes('RATE_LIMIT'))throw Error('잠시 후 주문해주세요. (분당 12건)');if(msg.includes('UNIQUE'))return {duplicate:true};throw e;
 }
 return {ok:true};
}
export async function cancelOrder(db:D1Database,userId:string,id:unknown){if(typeof id!=='string')throw Error('주문을 확인해주세요.');const r=await statement(db,"UPDATE orders SET status='cancelled' WHERE id=? AND user_id=? AND status='open'",[id,userId]).run();if(!r.meta.changes)throw Error('취소할 수 없는 주문입니다.');return {ok:true};}
export async function snapshot(db:D1Database,userId:string|null,selected:string,now:number,syncing:boolean){
 const [stocks,market,news,candles,index,flow,ranking]=await Promise.all([
 db.prepare('SELECT * FROM stocks ORDER BY id').all<Stock>(),db.prepare('SELECT last_tick FROM market WHERE id=1').first<Row>(),db.prepare('SELECT * FROM news ORDER BY ts DESC LIMIT 24').all<Row>(),statement(db,'SELECT * FROM (SELECT ts,open,high,low,close,volume FROM candles WHERE stock_id=? ORDER BY ts DESC LIMIT 130) ORDER BY ts',[selected]).all<Row>(),db.prepare('SELECT * FROM (SELECT * FROM ticks ORDER BY ts DESC LIMIT 80) ORDER BY ts').all<Row>(),statement(db,"SELECT stock_id,side,SUM(qty) AS qty,COUNT(*) AS count FROM orders WHERE status='open' GROUP BY stock_id,side").all<Row>(),db.prepare('SELECT a.nickname,a.created,a.cash+a.reserved+COALESCE(SUM(h.qty*s.price),0) AS equity FROM accounts a LEFT JOIN holdings h ON h.user_id=a.id LEFT JOIN stocks s ON h.stock_id=s.id GROUP BY a.id ORDER BY equity DESC,a.created LIMIT 20').all<Row>()]);
 let account:Row|null=null,holdings:Row[]=[],orders:Row[]=[],watchlist:string[]=[];
 if(userId){account=await accountFor(db,userId,now);const [h,o,w]=await Promise.all([statement(db,'SELECT h.*,s.name,s.price FROM holdings h JOIN stocks s ON s.id=h.stock_id WHERE h.user_id=? AND h.qty>0',[userId]).all<Row>(),statement(db,'SELECT o.*,s.name FROM orders o JOIN stocks s ON s.id=o.stock_id WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 100',[userId]).all<Row>(),statement(db,'SELECT stock_id FROM watchlist WHERE user_id=?',[userId]).all<Row>()]);holdings=h.results;orders=o.results;watchlist=w.results.map(x=>x.stock_id);}
 return {now,open:isOpen(now),nextTick:nextTick(market!.last_tick),lastTick:market!.last_tick,syncing,stocks:stocks.results,news:news.results,candles:candles.results,index:index.results,flow:flow.results,ranking:ranking.results,account,holdings,orders,watchlist};
}
export type GameState=Awaited<ReturnType<typeof snapshot>>;
