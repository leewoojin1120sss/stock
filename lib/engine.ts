import {createHmac,randomBytes} from 'node:crypto';
/* Shared server-clock auction engine. All account money is integer KRW. */
import {STEP,DAY,INITIAL_CASH,FEE,random,session,nextTick,isOpen,fee,tickSize,roundPrice,priceBounds,reserveFor,seedStocks,isEquity,macroAt,dividendDates,exDividend,economicCalendar,type Row,type Stock,type Macro} from './market-data.ts';
import {makeNews} from './news.ts';
import {ensureInformation,informationSnapshot} from './information.ts';
export {STEP,DAY,INITIAL_CASH,FEE,random,session,nextTick,isOpen,fee,tickSize,roundPrice,priceBounds,reserveFor,seedStocks,makeNews};
export type {Stock,Row};
const statement=(db:D1Database,sql:string,values:any[]=[])=>db.prepare(sql).bind(...values);
function insert(db:D1Database,table:string,row:Row){const keys=Object.keys(row);return statement(db,`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,Object.values(row));}
export async function bootstrap(db:D1Database,now:number){
 if(await db.prepare('SELECT id FROM market WHERE id=1').first())return;
 const anchor=session(now).close-DAY,stocks=seedStocks(),commands=[statement(db,'INSERT INTO market(id,last_tick,revision,catalog_version,seed) VALUES(1,?,0,2,?)',[anchor,randomBytes(32).toString('hex')])];
 for(const s of stocks){commands.push(insert(db,'stocks',s),statement(db,'INSERT INTO candles(stock_id,ts,open,high,low,close,volume) VALUES(?,?,?,?,?,?,0)',[s.id,anchor,s.price,s.price,s.price,s.price]));}
 commands.push(statement(db,'INSERT INTO ticks(ts,index_value,rate,fx,oil,gold) VALUES(?,1000,3,1340,78,2700)',[anchor]));
 for(let i=0;i<18;i++)commands.push(insert(db,'news',makeNews(now-i*60000,stocks,true,undefined,i)));
 try{await db.batch(commands);}catch(e){if(!await db.prepare('SELECT id FROM market WHERE id=1').first())throw e;}
}
export async function ensureCatalog(db:D1Database,now:number){
 const market=await db.prepare('SELECT * FROM market WHERE id=1').first<Row>();if(!market)return;if(!market.seed)await statement(db,"UPDATE market SET seed=? WHERE id=1 AND seed=''",[randomBytes(32).toString('hex')]).run();if(market.catalog_version>=2)return;
 const old=await db.prepare('SELECT * FROM stocks').all<Stock>(),profiles=seedStocks(),commands:D1PreparedStatement[]=[];
 // Retire the removed listing without erasing anyone's cash or trade history.
 commands.push(db.prepare("UPDATE orders SET status='cancelled',reserve_cash=0 WHERE status IN ('open','partial')"));
 const retired=old.results.filter(s=>!profiles.some(p=>p.id===s.id));
 for(const s of retired){commands.push(statement(db,"INSERT OR IGNORE INTO cash_events(id,user_id,stock_id,kind,amount,due_at,settled,created) SELECT 'retire-'||user_id||'-'||stock_id,user_id,stock_id,'상장 종료 정산',qty*?, ?,1,? FROM holdings WHERE stock_id=? AND qty>0",[s.price,now,now,s.id]),statement(db,'UPDATE accounts SET cash=cash+COALESCE((SELECT qty*? FROM holdings WHERE user_id=accounts.id AND stock_id=?),0),realized=realized+COALESCE((SELECT qty*?-cost FROM holdings WHERE user_id=accounts.id AND stock_id=?),0) WHERE EXISTS(SELECT 1 FROM holdings WHERE user_id=accounts.id AND stock_id=?)',[s.price,s.id,s.price,s.id,s.id]),statement(db,'DELETE FROM holdings WHERE stock_id=?',[s.id]),statement(db,'DELETE FROM watchlist WHERE stock_id=?',[s.id]),statement(db,"UPDATE stocks SET active=0,name='상장 종료 종목',sector='상장 종료',description='',company_type='상장 종료' WHERE id=?",[s.id]));}
 for(const p of profiles){if(old.results.some(s=>s.id===p.id)){const keys=['name','sector','kind','active','company_type','description','eps','bps','revenue','margin','debt_ratio','export_ratio','nav','annual_fee','payout'];commands.push(statement(db,`UPDATE stocks SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`,[...keys.map(k=>(p as Row)[k]),p.id]));}else{commands.push(insert(db,'stocks',p),statement(db,'INSERT INTO candles(stock_id,ts,open,high,low,close,volume) VALUES(?,?,?,?,?,?,0)',[p.id,market.last_tick,p.price,p.price,p.price,p.price]));}}
 commands.push(db.prepare('DELETE FROM news'));
 for(let i=0;i<18;i++)commands.push(insert(db,'news',makeNews(now-i*60000,profiles,true,undefined,i)));
 // CAS prevents a second simultaneous catalog update from double-crediting settlements.
 commands.unshift(statement(db,'UPDATE market SET catalog_version=2,revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END WHERE id=1',[market.revision]));
 try{await db.batch(commands);}catch(e){const current=await db.prepare('SELECT catalog_version FROM market WHERE id=1').first<Row>();if(!current||current.catalog_version<2)throw e;}
}
export function calculateTick(stocks:Stock[],queued:Row[],activeNews:Row[],ts:number,macro:Macro={rate:3,fx:1340,oil:78,gold:2700},lastMacro:Macro=macro,seed=''){
 const rng=(key:string|number)=>random(seed+key);
 const opening=ts===session(ts).open,eq=stocks.filter(isEquity),marketNoise=(rng(ts+'macro')-.5)*.008,fx=macro.fx/lastMacro.fx-1,oil=macro.oil/lastMacro.oil-1,rate=macro.rate-lastMacro.rate;
 const next=eq.map(s=>{
  const demand=queued.filter(o=>o.stock_id===s.id).reduce((v,o)=>v+(o.side==='buy'?1:-1)*(o.qty-(o.filled_qty||0))*s.price,0),flow=Math.tanh(demand/(s.price*3000))*.009;
  const newsImpact=activeNews.filter(n=>n.ts<=ts&&n.expires>=ts).reduce((v,n)=>v+(n.stock_id===s.id?n.impact:n.sector===s.sector?n.impact*.24:0)*Math.max(0,(n.expires-ts)/(STEP*6)),0);
  const oilExposure=s.sector==='에너지'?.35:['운송','물류','식품','이차전지'].includes(s.sector)?-.5:0,rateExposure=s.sector==='부동산'?-.012:s.company_type==='은행 금융지주'?.003:-.004;
  const change=marketNoise*s.beta+(rng(ts+s.sector)-.5)*.008+(rng(ts+s.id)-.5)*.014*s.beta+flow+newsImpact+fx*(s.export_ratio*.5-(['운송','유통'].includes(s.sector)?.5:.1))+oil*oilExposure+rate*rateExposure;
  const dividend=exDividend(s,ts),previous=roundPrice(Math.max(1,(opening?s.price:s.previous)-dividend),s.kind),reference=roundPrice(Math.max(1,s.price-dividend),s.kind),{lower,upper}=priceBounds(previous,s.kind),price=Math.max(lower,Math.min(upper,roundPrice(reference*(1+change),s.kind)));
  const report=activeNews.find(n=>n.ts===ts&&n.stock_id===s.id&&n.category==='실적'),update=report?JSON.parse(report.details||'{}').financialUpdate:null,eps=update?.eps??s.eps,revenue=update?.revenue??s.revenue;
  return{...s,eps,revenue,price,previous,day_open:opening?price:s.day_open,high:opening?price:Math.max(s.high,price),low:opening?price:Math.min(s.low,price),volume:opening?0:s.volume,turnover:opening?0:s.turnover,net_flow:opening?0:s.net_flow,pe:eps>0?Math.round(price/eps*100)/100:0,dividend:s.payout/price*100};
 });
 const ret=(filter:(s:Stock)=>boolean)=>{const v=next.filter(filter);return v.length?v.reduce((n,s)=>n+s.price/s.previous,0)/v.length-1:0},dayReturn=ret(()=>true);
 for(const s of stocks.filter(s=>s.active!==0&&s.kind!=='stock')){
  const previous=opening?s.price:s.previous,baseNav=opening?s.nav||s.price:s.nav_base||s.previous,mult=s.kind==='inverse'?-1:s.kind==='leverage'?2:s.kind==='inverse2'?-2:1;
  let r=dayReturn*mult;
  if(s.kind==='tech')r=ret(x=>['반도체','IT 서비스','게임','로봇','플랫폼'].includes(x.sector));
  if(s.kind==='consumer')r=ret(x=>['식품','유통','통신','전자상거래'].includes(x.sector));
  if(s.kind==='bond')r=(opening?macro.rate/100/365:0)-rate*.002;
  if(s.kind==='gold')r=(macro.gold/lastMacro.gold)*(macro.fx/lastMacro.fx)-1;
  // Daily fund targets reset against the opening reference, annual cost accrues once a day.
  const dailyCost=opening?s.annual_fee/365:0;
  const nav=s.kind==='gold'||s.kind==='bond'?(s.nav||s.price)*(1+r-dailyCost):baseNav*(1+r-s.annual_fee/365);
  const demand=queued.filter(o=>o.stock_id===s.id).reduce((v,o)=>v+(o.side==='buy'?1:-1)*(o.qty-(o.filled_qty||0)),0),deviation=Math.tanh(demand/3000)*.003;
  const{lower,upper}=priceBounds(previous,s.kind),price=Math.max(lower,Math.min(upper,roundPrice(nav*(1+deviation),s.kind)));
  next.push({...s,nav:Math.round(nav*100)/100,nav_base:baseNav,price,previous,day_open:opening?price:s.day_open,high:opening?price:Math.max(s.high,price),low:opening?price:Math.min(s.low,price),volume:opening?0:s.volume,turnover:opening?0:s.turnover,net_flow:opening?0:s.net_flow});
 }
 return next;
}
export async function advanceMarket(db:D1Database,now:number,maxSteps=4){
 await bootstrap(db,now);await ensureCatalog(db,now);
 for(let step=0;step<maxSteps;step++){
  const m=await db.prepare('SELECT * FROM market WHERE id=1').first<Row>();if(!m)throw Error('MARKET_MISSING');const ts=nextTick(m.last_tick);if(ts>now)return false;
  const [sr,or,nr,last]=await Promise.all([db.prepare('SELECT * FROM stocks WHERE active=1 ORDER BY id').all<Stock>(),statement(db,"SELECT rowid AS sequence,* FROM orders WHERE status IN ('open','partial') AND created<? ORDER BY created,rowid",[ts]).all<Row>(),statement(db,'SELECT * FROM news WHERE expires>=? AND ts<=?',[ts,ts]).all<Row>(),db.prepare('SELECT * FROM ticks ORDER BY ts DESC LIMIT 1').first<Row>()]);
  const oldMacro:Macro={rate:last?.rate??3,fx:last?.fx??1340,oil:last?.oil??78,gold:last?.gold??2700},tickSeed=createHmac('sha256',m.seed).update(String(ts)).digest('hex'),macro=macroAt(ts,oldMacro,tickSeed),generated=makeNews(ts,sr.results,false,macro,undefined,tickSeed),active=[...nr.results,generated];
  const next=calculateTick(sr.results,or.results,active,ts,macro,oldMacro,tickSeed),equities=next.filter(isEquity),idx=equities.reduce((v,s)=>v+s.price/s.initial,0)/Math.max(1,equities.length)*1000;
  const commands=[insert(db,'ticks',{ts,index_value:idx,...macro}),statement(db,'UPDATE market SET last_tick=?,revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END WHERE id=1',[ts,m.revision])];
  for(const s of next){
   const dates=dividendDates(sr.results.find(x=>x.id===s.id)!,ts);if(dates?.record===ts)commands.push(statement(db,"INSERT OR IGNORE INTO cash_events(id,user_id,stock_id,kind,amount,due_at,settled,created) SELECT 'dividend-'||?||'-'||stock_id||'-'||user_id,user_id,stock_id,'배당금',qty*?,?,0,? FROM holdings WHERE stock_id=? AND qty>0",[dates.ex,dates.dps,dates.pay,ts,s.id]));
   let buys=0,sells=0;const eligible=or.results.filter(o=>o.stock_id===s.id&&(o.side==='buy'?o.limit_price>=s.price:o.limit_price<=s.price));
   const prioritize=(side:string)=>eligible.filter(o=>o.side===side).sort((a,b)=>(a.kind==='market'?0:1)-(b.kind==='market'?0:1)||(side==='buy'?b.limit_price-a.limit_price:a.limit_price-b.limit_price)||a.created-b.created||a.sequence-b.sequence);
   const buyTotal=eligible.filter(o=>o.side==='buy').reduce((v,o)=>v+o.qty-o.filled_qty,0),sellTotal=eligible.filter(o=>o.side==='sell').reduce((v,o)=>v+o.qty-o.filled_qty,0),liquidity=s.kind==='stock'?800:1500;
   for(const side of ['buy','sell'])for(const o of prioritize(side)){
    const room=side==='buy'?sellTotal+liquidity-buys:buyTotal+liquidity-sells,qty=Math.min(o.qty-o.filled_qty,Math.max(0,room));if(!qty)continue;if(side==='buy')buys+=qty;else sells+=qty;
    commands.push(insert(db,'fills',{id:o.id+':'+ts,order_id:o.id,qty,price:s.price,fee:fee(s.price*qty),ts}));
   }
   const volume=Math.max(buys,sells),net=buys-sells,old=sr.results.find(x=>x.id===s.id)!;
   commands.push(statement(db,'UPDATE stocks SET price=?,previous=?,day_open=?,high=?,low=?,volume=?,turnover=?,net_flow=?,eps=?,revenue=?,pe=?,dividend=?,nav=?,nav_base=? WHERE id=?',[s.price,s.previous,s.day_open,s.high,s.low,s.volume+volume,s.turnover+volume*s.price,s.net_flow+net,s.eps,s.revenue,s.pe,s.dividend,s.nav,s.nav_base,s.id]),statement(db,'INSERT INTO candles(stock_id,ts,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?)',[s.id,ts,ts===session(ts).open?s.previous:old.price,Math.max(ts===session(ts).open?s.previous:old.price,s.price),Math.min(ts===session(ts).open?s.previous:old.price,s.price),s.price,volume]));

  }
  commands.push(insert(db,'news',generated));
  commands.push(statement(db,'UPDATE accounts SET cash=cash+COALESCE((SELECT SUM(amount) FROM cash_events WHERE user_id=accounts.id AND settled=0 AND due_at<=?),0) WHERE EXISTS(SELECT 1 FROM cash_events WHERE user_id=accounts.id AND settled=0 AND due_at<=?)',[ts,ts]),statement(db,'UPDATE cash_events SET settled=1 WHERE settled=0 AND due_at<=?',[ts]));
  if(ts===session(ts).close)commands.push(db.prepare("UPDATE orders SET status='expired',reserve_cash=0 WHERE status IN ('open','partial')"));
  commands.push(statement(db,'DELETE FROM candles WHERE ts<?',[ts-90*DAY]),statement(db,'DELETE FROM news WHERE expires<?',[ts-14*DAY]));
  try{await db.batch(commands);}catch(e){if(String(e).includes('STALE_MARKET'))continue;const newer=await db.prepare('SELECT last_tick FROM market WHERE id=1').first<Row>();if(!newer||newer.last_tick<ts)throw e;}
 }
 const m=await db.prepare('SELECT last_tick FROM market WHERE id=1').first<Row>();return nextTick(m!.last_tick)<=now;
}
export async function accountFor(db:D1Database,id:string,now:number){await statement(db,'INSERT OR IGNORE INTO accounts(id,nickname,cash,reserved,realized,created) VALUES(?,?,?,0,0,?)',[id,'투자자 '+Math.floor(random(id)*90000+10000),INITIAL_CASH,now]).run();return statement(db,'SELECT nickname,cash,reserved,realized,created,tutorial_done FROM accounts WHERE id=?',[id]).first<Row>();}
export async function placeOrder(db:D1Database,userId:string,input:Row,now:number){
 if(!isOpen(now))throw Error('장은 매일 16:40~23:40에 열립니다. (한국 시간)');const{stockId,side,kind,qty,requestKey}=input;
 if(typeof stockId!=='string'||!['buy','sell'].includes(side)||!['market','limit'].includes(kind)||!Number.isInteger(qty)||qty<1||qty>2000||typeof requestKey!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(requestKey))throw Error('주문 입력을 확인해주세요. 수량은 1~2,000주입니다.');
 const existing=await statement(db,'SELECT id FROM orders WHERE user_id=? AND request_key=?',[userId,requestKey]).first();if(existing)return{duplicate:true};
 const stock=await statement(db,'SELECT * FROM stocks WHERE id=? AND active=1',[stockId]).first<Stock>();if(!stock)throw Error('종목을 찾을 수 없습니다.');
 const bounds=priceBounds(stock.previous,stock.kind),limit=kind==='market'?(side==='buy'?bounds.upper:bounds.lower):input.limitPrice;
 if(!Number.isInteger(limit)||limit<bounds.lower||limit>bounds.upper)throw Error(`주문 가격은 ${bounds.lower.toLocaleString()}~${bounds.upper.toLocaleString()}원입니다.`);if(limit%tickSize(limit,stock.kind)!==0)throw Error(`이 가격의 호가 단위는 ${tickSize(limit,stock.kind)}원입니다.`);
 try{await insert(db,'orders',{id:crypto.randomUUID(),user_id:userId,stock_id:stockId,side,kind,qty,limit_price:limit,reserve_cash:side==='buy'?reserveFor(qty,limit):0,status:'open',created:now,request_key:requestKey,filled_qty:0,fill_value:0}).run();}catch(e){const msg=String(e);if(msg.includes('INSUFFICIENT_CASH'))throw Error('주문 가능 금액이 부족합니다.');if(msg.includes('INSUFFICIENT_SHARES'))throw Error('매도 가능한 주식이 부족합니다.');if(msg.includes('ORDER_LIMIT'))throw Error('미체결 주문은 최대 30건까지 가능합니다.');if(msg.includes('RATE_LIMIT'))throw Error('잠시 후 주문해주세요. (분당 12건)');if(msg.includes('UNIQUE'))return{duplicate:true};throw e;}return{ok:true};
}
export async function cancelOrder(db:D1Database,userId:string,id:unknown){if(typeof id!=='string')throw Error('주문을 확인해주세요.');const r=await statement(db,"UPDATE orders SET status='cancelled',reserve_cash=0 WHERE id=? AND user_id=? AND status IN ('open','partial')",[id,userId]).run();if(!r.meta.changes)throw Error('취소할 수 없는 주문입니다.');return{ok:true};}
export async function snapshot(db:D1Database,userId:string|null,selected:string,now:number,syncing:boolean){
 await ensureInformation(db,now);
 const[stocks,market,news,candles,index,flow,ranking,book]=await Promise.all([
 db.prepare('SELECT * FROM stocks WHERE active=1 ORDER BY id').all<Stock>(),db.prepare('SELECT last_tick FROM market WHERE id=1').first<Row>(),db.prepare('SELECT id,ts,stock_id,sector,title,body,category,details FROM news ORDER BY ts DESC LIMIT 80').all<Row>(),statement(db,'SELECT * FROM (SELECT ts,open,high,low,close,volume FROM candles WHERE stock_id=? ORDER BY ts DESC LIMIT 260) ORDER BY ts',[selected]).all<Row>(),db.prepare('SELECT * FROM (SELECT * FROM ticks ORDER BY ts DESC LIMIT 100) ORDER BY ts').all<Row>(),db.prepare("SELECT stock_id,side,SUM(qty-filled_qty) AS qty,COUNT(*) AS count FROM orders WHERE status IN ('open','partial') GROUP BY stock_id,side").all<Row>(),db.prepare('SELECT a.nickname,a.created,a.cash+a.reserved+COALESCE((SELECT SUM(h.qty*s.price) FROM holdings h JOIN stocks s ON h.stock_id=s.id WHERE h.user_id=a.id),0)+COALESCE((SELECT SUM(amount) FROM cash_events WHERE user_id=a.id AND settled=0),0) AS equity FROM accounts a JOIN credentials c ON c.user_id=a.id ORDER BY equity DESC,a.created LIMIT 20').all<Row>(),statement(db,"SELECT side,kind,limit_price,SUM(qty-filled_qty) AS qty,COUNT(*) AS count FROM orders WHERE stock_id=? AND status IN ('open','partial') GROUP BY side,kind,limit_price ORDER BY limit_price DESC",[selected]).all<Row>()]);
 let account:Row|null=null,holdings:Row[]=[],orders:Row[]=[],watchlist:string[]=[],cashEvents:Row[]=[],fills:Row[]=[];
 if(userId){account=await accountFor(db,userId,now);const[h,o,w,c,f]=await Promise.all([statement(db,'SELECT h.*,s.name,s.price FROM holdings h JOIN stocks s ON s.id=h.stock_id WHERE h.user_id=? AND h.qty>0',[userId]).all<Row>(),statement(db,'SELECT o.*,s.name FROM orders o JOIN stocks s ON s.id=o.stock_id WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 100',[userId]).all<Row>(),statement(db,'SELECT stock_id FROM watchlist WHERE user_id=?',[userId]).all<Row>(),statement(db,'SELECT c.*,s.name FROM cash_events c LEFT JOIN stocks s ON s.id=c.stock_id WHERE user_id=? ORDER BY created DESC LIMIT 100',[userId]).all<Row>(),statement(db,'SELECT f.*,o.stock_id,o.side,s.name FROM fills f JOIN orders o ON o.id=f.order_id JOIN stocks s ON s.id=o.stock_id WHERE o.user_id=? ORDER BY f.ts DESC LIMIT 100',[userId]).all<Row>()]);holdings=h.results;orders=o.results;watchlist=w.results.map(x=>x.stock_id);cashEvents=c.results;fills=f.results;account!.receivable=(await statement(db,'SELECT COALESCE(SUM(amount),0) AS total FROM cash_events WHERE user_id=? AND settled=0',[userId]).first<Row>())!.total;}
 const selectedStock=stocks.results.find(s=>s.id===selected);const publicNews=news.results.map((n):Row=>{let details:Row={};try{details=JSON.parse(n.details);}catch{}delete details.financialUpdate;return{...n,details};});
 return{now,open:isOpen(now),nextTick:nextTick(market!.last_tick),lastTick:market!.last_tick,syncing,stocks:stocks.results,news:publicNews,candles:candles.results,index:index.results,flow:flow.results,ranking:ranking.results,book:book.results,calendar:economicCalendar(now,stocks.results),dividendSchedule:selectedStock?dividendDates(selectedStock,now):null,account,holdings,orders,watchlist,cashEvents,fills,information:await informationSnapshot(db,userId,now)};
}
export type GameState=Awaited<ReturnType<typeof snapshot>>;
