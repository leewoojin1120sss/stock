import {createHmac} from 'node:crypto';
import {companyProfile} from './company-profile.ts';
import {rateLimit} from './auth.ts';
import {makeNews} from './news.ts';
import {random,STEP,isOpen,type Row,type Stock,DAY,type Macro} from './market-data.ts';
export const RESEARCH_COST=500000,RESEARCH_DURATION=DAY;
export const CONTENT_CADENCE={community:20*60000,news:30*60000,research:60*60000};
const q=(db:D1Database,sql:string,args:unknown[]=[])=>db.prepare(sql).bind(...args);
const put=(db:D1Database,table:string,row:Row)=>{const keys=Object.keys(row);return q(db,`INSERT OR IGNORE INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,Object.values(row));};
const money=(n:number)=>Math.round(n).toLocaleString('ko-KR');
export function companyRelease(stock:Stock,ts:number){const p=companyProfile(stock);return{id:'company-ir-'+stock.id,ts,stock_id:stock.id,sector:stock.sector,title:stock.name+' | '+p.slogan,body:p.promise,impact:0,expires:ts+DAY*365,category:'기업소식',details:JSON.stringify({source:stock.name+' IR',paragraphs:[p.promise,stock.description,p.products.map(([name,desc])=>name+': '+desc).join(' · '),'사업별 비중은 '+p.segments.map(s=>s.name+' '+s.share+'%').join(', ')+'입니다. 각 사업의 판매량과 비용이 전체 실적에 얼마나 반영되는지 다음 발표와 비교할 수 있습니다.'],metrics:stock.kind==='stock'?[['주요 사업',stock.company_type],['사업 거점',p.location],['해외 매출',(stock.export_ratio*100).toFixed(1)+'%']]:[['상품 유형',stock.company_type],['연간 운용 비용',(stock.annual_fee*100).toFixed(2)+'%'],['순자산가치',stock.nav.toFixed(2)+'원']],focus:p.strengths})};}
const sectorLeads:Record<string,[string,string]>={
 'IT 서비스':['클라우드 계약 갱신 얘기','기업 고객이 계약 기간을 바꾸고 있다는 말을 들었어요. 신규 가입 숫자만 봐도 되는지, 고객 유지율과 서버 비용까지 봐야 하는지 궁금하네요.'],
 '바이오':['임상 일정 바뀐다는 소문','임상 참여 기관이 추가된다는 글을 봤는데 공지 원문은 아직 못 찾았어요. 연구개발 지출과 기술 이전 계약금이 언제 들어오는지도 같이 볼까요?'],
 '금융':['금융회사 수익 숫자 질문','이자 수익이나 투자 수익이 달라졌다는 얘기가 있어요. 예대마진·대손충당금·채권 평가손익 중 어느 항목인지 원문부터 확인해보고 싶어요.'],
 '에너지':['정제마진 현장 얘기','정유제품 주문 조건이 바뀌었다는 말을 들었어요. 원유 가격만 보면 되는 줄 알았는데 정제마진과 재고 평가도 따로 봐야겠네요.'],
 '콘텐츠':['해외 판권 계약설','해외 배급사가 새 IP 판권을 검토한다는 글이 돌고 있어요. 확정 계약인지 단순 협의인지 아직 모르겠고 제작비 회수 조건도 궁금해요.'],
 '유통':['매장 행사 체감 공유','이번 행사에 사람이 많았다는 후기를 봤어요. 매출이 늘어도 할인 비용이 커졌을 수 있으니 객단가와 기존점 판매 수량을 같이 보려고요.'],
 '자동차':['해외 딜러 주문 얘기','해외 딜러가 주문 구성을 바꾼다는 얘기를 들었어요. 비싼 차 판매 비중과 할인 금액, 환헤지 조건은 아직 확인하지 못했어요.'],
 '반도체':['수율 이야기 출처 있나요','새 공정 수율이 달라졌다는 게시물을 봤어요. 어떤 제품의 어느 기간 숫자인지 없어서 공장 가동률과 고객 주문도 확인해보고 싶네요.'],
 '플랫폼':['광고 단가 관측','판매자들 사이에서 광고 단가가 달라졌다는 얘기가 있어요. 이용자가 늘어난 것과 광고주가 실제 낸 돈은 다른 숫자라 구분해서 봐야겠어요.'],
 '게임':['신작 테스트 참가자 후기','테스트 참가자가 늘었다는 글을 봤어요. 출시 후 실제 결제 이용자와 재방문이 얼마나 이어질지는 아직 알 수 없겠네요.'],
 '이차전지':['고객 재고 조정 소문','배터리 고객사가 다음 납품 시기를 조정한다는 말이 있어요. 계약 총액과 이번 분기 실제 출하량을 구분해서 확인해볼 생각이에요.'],
 '조선':['선박 인도 일정 질문','선박 인도 시점이 달라질 수 있다는 얘기가 있어요. 수주 잔고가 바로 현금은 아니라서 검수와 잔금 지급 일정도 같이 봐야겠죠?'],
 '식품':['신제품 반응 얘기','신제품을 재구매했다는 후기를 몇 개 봤어요. 전체 수요인지는 모르겠고 곡물·포장재 원가와 할인 행사 비용도 궁금해요.'],
 '로봇':['공장 자동화 상담 늘었나요','자동화 장비 상담이 늘었다는 얘기를 들었어요. 상담이 실제 수주로 이어졌는지는 모르겠네요. 설치 후 유지관리 계약도 확인해보고 싶어요.'],
 '부동산':['임대 계약 갱신 관측','임차인이 계약 조건을 다시 협의한다는 글을 봤어요. 임대율·임대료뿐 아니라 리츠 차입금의 만기와 금리도 함께 봐야겠네요.'],
 '운송':['탑승률 체감 공유','노선이 꽉 찼다는 후기가 있어요. 특정 항공편 얘기일 수 있고 항공유·환율·리스 비용까지 봐야 실제 실적을 알 수 있겠죠?'],
 '헬스케어':['생산 계약 관련 질문','의약품 생산 일정이 늘었다는 소문을 봤어요. CDMO 계약인지 자체 의약품인지, 생산 허가와 가동률 수치가 있는 자료를 찾는 중이에요.'],
 '지주':['자회사 배당 얘기','자회사가 배당을 바꾼다는 글이 돌고 있어요. 지주회사에 실제 들어오는 현금과 자회사 주식의 장부 가치를 구분해서 보고 싶어요.'],
 '방산':['수출 계약 진행설','수출 협상이 진행 중이라는 얘기를 들었어요. 허가·선급금·납품 일정 중 어디까지 확정됐는지 원문이 있으면 같이 보죠.'],
 '전력':['발전량 현장 관측','발전소 점검이 끝났다는 얘기가 있어요. 실제 발전량과 전력 판매가격, PPA 비중은 아직 확인하지 못했어요.'],
 '물류':['운임 견적 변화 얘기','화주가 받은 운임 견적이 바뀌었다는 글을 봤어요. 장기 계약과 이번 주 현물 가격이 섞인 얘기인지 확인해봐야겠네요.'],
 '통신':['가입자 이동 관측','요금제 이동이 늘었다는 말을 들었어요. 가입자 수와 가입자 한 명당 매출, 마케팅 비용을 같이 비교해보고 싶네요.'],
 '전자상거래':['배송·반품 체감 공유','배송이 빨라졌다는 후기가 보이네요. 주문이 늘어도 반품과 풀필먼트 비용이 더 들 수 있어 판매 수수료와 함께 보고 있어요.']
};
export function makeCommunityTip(stock:Stock,ts:number,seed:string,index:number){
 const r=random(seed+stock.id+ts),p=companyProfile(stock),specific=sectorLeads[stock.sector]||['최근 사업 소식 궁금해요','최근 사업 소식의 원문을 찾고 있어요. 확인된 숫자가 있으면 같이 비교해보고 싶네요.'];
 const claims:[string,string][]=[specific,['매출 숫자의 비교 기간 질문','매출이 '+Math.round(8+r*25)+'% 달라졌다는 글을 봤어요. 전년 동기인지 전분기인지 빠져 있어서 원문을 찾는 중이에요.'],['주문이 많다는 말, 확인해봤나요','다음 거래에 주문이 몰린다는 말을 들었어요. 호가창에 기다리는 수량과 실제 체결량을 나눠서 확인해보고 싶어요.'],['주요 사업 직접 써본 분?','이 회사의 '+p.products[0][0]+'를 써봤다는 후기를 봤어요. 일부 이용자의 느낌인지 전체 재구매율에 나타나는 변화인지는 아직 모르겠어요.'],['현금흐름 자료 같이 읽어요','이익과 현금흐름이 다르게 움직인다는 글을 봤어요. 재고나 매출채권이 늘었는지, 대금이 언제 들어오는지 원문을 비교하고 있어요.'],['환율에 같은 방향으로 움직일까요','원/달러가 바뀌면 무조건 같은 방향으로 움직인다는 글이 있던데, 해외 매출과 달러 원가·외화 빚을 같이 봐야 하지 않을까요?'],['이번 배당 대상 질문','배당 직전에 사면 된다는 글을 봤는데, 받을 사람을 정하는 시각의 거래 직전 보유량이 기준인 것 같아요. 종목 배당 탭과 다시 비교해볼게요.'],['실적 전망과 발표 숫자 차이','가이던스가 바뀌었다는 얘기가 있어요. 회사가 예상한 숫자인지 이미 발표된 실적인지부터 확인해보고 싶네요.']];
 const pair=claims[index%claims.length];return{id:'market-tip-'+ts+'-'+index,user_id:null,stock_id:stock.id,title:stock.name+' · '+pair[0],body:pair[1],source:'unverified',author:['시장제보봇','업종관측봇','자료토론봇','현장메모봇'][index%4],created:ts};
}
export function buildResearch(stock:Stock,article:Row,now:number){
 let details:Row={};try{details=typeof article.details==='string'?JSON.parse(article.details):article.details||{};}catch{}
 const profile=companyProfile(stock),source=details.source||stock.name+' IR',variant=Math.floor(random(article.id+'research')*6),formats=['발표 원문 읽기','숫자와 조건 비교','사업 구조 점검','현금흐름 노트','실적 가정 계산','업종별 체크포인트'];
 const sectorNotes:Record<string,string>={
 '금융':'금융회사는 이자를 받는 자산과 이자를 내는 부채를 함께 봅니다. 예대마진이나 투자 수익이 늘어도 대손충당금과 채권 평가손익이 달라질 수 있습니다. 부채 비율은 제조업과 그대로 비교하기 어렵습니다.',
 '부동산':'리츠는 임대료가 들어오는 시점과 이자를 내는 시점이 다를 수 있습니다. 임대율뿐 아니라 계약 갱신 조건, 유지보수 투자와 차환 금리를 함께 비교합니다.',
 '바이오':'연구개발 기업은 지금의 매출보다 임상 진행 단계와 남은 현금이 중요할 수 있습니다. 기술 이전 계약의 총액 중 계약금과 단계별 조건을 충족해야 받는 돈을 나누어 봅니다.',
 '반도체':'공장을 더 돌린 양과 정상 제품의 비율인 수율을 나눠 봅니다. 가동률이 높아져도 불량이나 감가상각비가 늘면 이익의 변화 폭은 달라질 수 있습니다.',
 '콘텐츠':'계약 총액과 제작비를 회수한 뒤 회사에 남는 몫은 다릅니다. IP 판권 기간, 국가별 권리와 작품별 성과 차이를 확인합니다.',
 '조선':'수주 잔고는 아직 인도하지 않은 계약입니다. 선박을 만드는 동안 드는 원가, 공정별 대금 지급과 최종 검수 시점을 구분해 봅니다.',
 '운송':'탑승률과 객단가가 함께 바뀌면 매출이 달라집니다. 항공유·리스료·달러 빚의 결제 시점과 환헤지 조건도 확인합니다.',
 '전자상거래':'총거래액은 판매자가 거래한 전체 금액이고, 회사 매출이나 이익과는 다릅니다. 수수료·직매입 비중과 배송·반품 비용을 함께 비교합니다.'
 };
 const business=sectorNotes[stock.sector]||stock.description+' '+profile.products.map(([name,description])=>name+'는 '+description).join('. ')+'.';
 const ratio=stock.eps>0?'주가 '+money(stock.price)+'원을 EPS '+money(stock.eps)+'원으로 나누면 PER '+(stock.price/stock.eps).toFixed(2)+'배입니다. 같은 업종이라도 이익의 지속 기간과 빚의 규모가 다르면 배수의 뜻이 달라집니다.':'현재 EPS는 '+money(stock.eps)+'원입니다. 이익이 0 이하이므로 PER을 계산하지 않습니다. 매출·현금 보유와 사업 비용을 나누어 봐야 합니다.';
 const paragraphs=(details.paragraphs||[article.body]) as string[];
 const sections=[{title:'발표에서 확인할 내용',body:paragraphs[0]||article.body},{title:'계약·비용·집계 기준',body:paragraphs[1]||article.body},{title:'이 회사의 사업과 연결하기',body:business},{title:'주가와 이익을 숫자로 비교하기',body:ratio+' BPS는 '+money(stock.bps)+'원이며, 주가를 BPS로 나눈 PBR은 '+(stock.price/stock.bps).toFixed(2)+'배입니다.'},{title:'다음 자료에서 확인할 항목',body:(paragraphs[2]||'')+' '+(details.focus||profile.strengths).join(' · ')}];
 const ordered=variant===3?[sections[0],sections[2],sections[1],sections[3],sections[4]]:sections;
 return{id:'research-'+article.id,stock_id:stock.id,news_id:article.id,title:stock.name+' · '+article.category+' '+formats[variant],summary:source+'의 발표 수치·계약 조건과 '+profile.products[0][0]+' 사업을 함께 살펴봅니다.',created:now,body:JSON.stringify({source:'부석 리서치센터',checkedAt:now,lead:article.body,metrics:details.metrics||[],sections:ordered,sources:[{id:article.id,title:article.title,source,publishedAt:article.ts}],snapshot:{price:stock.price,eps:stock.eps,bps:stock.bps,at:now},scenarioNote:'주가는 '+money(stock.price)+'원으로 고정하고 EPS만 바꿔 계산한 비교입니다. 실제 실적 전망과 구분해서 읽습니다.',scenarios:stock.eps>0?[-20,-10,0,10,20].map(change=>({label:'EPS '+(change>0?'+':'')+change+'%',eps:Math.round(stock.eps*(1+change/100)),pe:stock.price/Math.max(1,Math.round(stock.eps*(1+change/100)))})):[]})};
}
export async function ensureInformation(db:D1Database,now:number){
 let market=await db.prepare('SELECT info_version,info_cursor,reset_at,seed FROM market WHERE id=1').first<Row>();if(!market)return{syncing:false,published:0};
 const stocks=(await db.prepare('SELECT * FROM stocks WHERE active=1 ORDER BY id').all<Stock>()).results,equities=stocks.filter(s=>s.kind==='stock');if(!equities.length)return{syncing:false,published:0};
 const seed=createHmac('sha256',market.seed).update('information').digest('hex');
 if(market.info_version<1){
  const rows=stocks.map(s=>put(db,'news',companyRelease(s,now)));
  for(let i=0;i<12;i++){const stock=equities[(i*7+Math.floor(random(seed)*equities.length))%equities.length];rows.push(put(db,'community_posts',makeCommunityTip(stock,now-i*60000,seed,i)));}
  const initial=(await db.prepare("SELECT * FROM news WHERE stock_id IS NOT NULL AND category!='기업소식' ORDER BY ts DESC LIMIT 6").all<Row>()).results;
  for(const article of initial){const stock=stocks.find(s=>s.id===article.stock_id);if(stock)rows.push(put(db,'research_reports',buildResearch(stock,article,article.ts)));}
  rows.push(q(db,'UPDATE market SET info_version=1,info_cursor=MAX(info_cursor,?) WHERE id=1',[Math.floor(now/STEP)*STEP]));
  await db.batch(rows);market={...market,info_version:1,info_cursor:Math.max(market.info_cursor,Math.floor(now/STEP)*STEP)};
 }
 const due=Math.floor(now/STEP)*STEP,last=Math.min(due,market.info_cursor+24*STEP),commands:D1PreparedStatement[]=[];
 if(last<=market.info_cursor)return{syncing:false,published:0};
 const latest=await db.prepare('SELECT rate,fx,oil,gold FROM ticks ORDER BY ts DESC LIMIT 1').first<Macro>(),macro=latest||{rate:3,fx:1340,oil:78,gold:2700};
 const candidates=(await db.prepare("SELECT n.* FROM news n WHERE n.stock_id IS NOT NULL AND n.category!='기업소식' AND NOT EXISTS(SELECT 1 FROM research_reports r WHERE r.news_id=n.id) ORDER BY n.ts DESC LIMIT 60").all<Row>()).results;
 const used=new Set<string>();let published=0;
 for(let ts=market.info_cursor+STEP;ts<=last;ts+=STEP){
  if(ts%CONTENT_CADENCE.community===0){const stock=equities[Math.floor(random(seed+ts+'tip')*equities.length)];commands.push(put(db,'community_posts',makeCommunityTip(stock,ts,seed,Math.floor(random(seed+ts+'format')*8))));published++;}
  if(ts%CONTENT_CADENCE.news===0&&!isOpen(ts)){const article=makeNews(ts,stocks,false,macro,(Math.floor(ts/CONTENT_CADENCE.news)+Math.floor(random(seed+'cycle')*18))%18,seed+ts);article.id='bulletin-'+ts;article.impact=0;const details=JSON.parse(article.details);delete details.financialUpdate;article.details=JSON.stringify(details);commands.push(put(db,'news',article));candidates.unshift(article);published++;}
  if(ts%CONTENT_CADENCE.research===0){let article=candidates.find(n=>n.stock_id&&n.ts<=ts&&!used.has(n.id));if(!article){article=makeNews(ts,stocks,false,macro,11,seed+'research'+ts);article.id='research-source-'+ts;article.impact=0;commands.push(put(db,'news',article));}const stock=stocks.find(s=>s.id===article.stock_id);if(stock){used.add(article.id);commands.push(put(db,'research_reports',buildResearch(stock,article,ts)));published++;}}
 }
 commands.push(q(db,'UPDATE market SET info_cursor=MAX(info_cursor,?) WHERE id=1',[last]));
 commands.push(q(db,"DELETE FROM community_posts WHERE user_id IS NULL AND created<?",[now-14*DAY]));
 await db.batch(commands);
 return{syncing:last<due,published};
}
export async function subscriptionFor(db:D1Database,userId:string|null,now:number){const row=userId?await q(db,'SELECT expires FROM subscriptions WHERE user_id=?',[userId]).first<Row>():null;return{active:!!row&&row.expires>now,expires:row?.expires||0,cost:RESEARCH_COST,duration:RESEARCH_DURATION};}
export async function informationSnapshot(db:D1Database,userId:string|null,now:number){const[posts,reports,subscription]=await Promise.all([db.prepare("SELECT p.id,p.stock_id,p.title,p.body,p.source,p.created,CASE WHEN p.user_id IS NULL THEN p.author ELSE a.nickname END AS author,s.name AS stock_name,p.user_id FROM community_posts p LEFT JOIN accounts a ON a.id=p.user_id JOIN stocks s ON s.id=p.stock_id WHERE s.active=1 ORDER BY p.created DESC,p.id DESC LIMIT 60").all<Row>(),db.prepare('SELECT r.id,r.stock_id,r.news_id,r.title,r.summary,r.created,s.name AS stock_name FROM research_reports r JOIN stocks s ON s.id=r.stock_id WHERE s.active=1 ORDER BY r.created DESC,r.id LIMIT 30').all<Row>(),subscriptionFor(db,userId,now)]);return{publication:{communityMinutes:20,researchMinutes:60,newsMinutes:30,nextCommunity:(Math.floor(now/CONTENT_CADENCE.community)+1)*CONTENT_CADENCE.community,nextResearch:(Math.floor(now/CONTENT_CADENCE.research)+1)*CONTENT_CADENCE.research},posts:posts.results.map(({user_id,...p}):Row=>({...p,own:!!userId&&user_id===userId})),reports:reports.results,subscription};}
export async function subscribe(db:D1Database,userId:string,key:unknown,now:number){if(typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw Error('구독 요청을 확인해주세요.');const previous=await q(db,'SELECT expires FROM research_purchases WHERE user_id=? AND request_key=?',[userId,key]).first<Row>();if(previous)return{ok:true,duplicate:true,expires:previous.expires};try{await q(db,'INSERT INTO research_purchases(id,user_id,request_key,cost,created,expires) VALUES(?,?,?,?,?,?)',[crypto.randomUUID(),userId,key,RESEARCH_COST,now,now+RESEARCH_DURATION]).run();}catch(e){const error=String(e);if(error.includes('SUBSCRIPTION_ACTIVE'))return{ok:true,...await subscriptionFor(db,userId,now)};if(error.includes('SUBSCRIPTION_FUNDS'))throw Error('구독할 계좌 잔액이 부족합니다.');if(error.includes('UNIQUE'))return{ok:true,duplicate:true,...await subscriptionFor(db,userId,now)};throw e;}return{ok:true,...await subscriptionFor(db,userId,now)};}
export async function researchArticle(db:D1Database,userId:string|null,id:string,now:number){if(!userId)throw Error('로그인 후 리서치를 구독해주세요.');if(!(await subscriptionFor(db,userId,now)).active)throw Error('리서치 구독이 필요합니다.');const report=await q(db,'SELECT r.*,s.name AS stock_name FROM research_reports r JOIN stocks s ON s.id=r.stock_id WHERE r.id=? AND s.active=1',[id]).first<Row>();if(!report)throw Error('기사를 찾을 수 없습니다.');return{...report,body:JSON.parse(report.body)};}
export async function publishPost(db:D1Database,userId:string,input:Row,now:number){if(typeof input.stockId!=='string'||typeof input.title!=='string'||typeof input.body!=='string'||input.title.trim().length<4||input.title.length>70||input.body.trim().length<8||input.body.length>600)throw Error('제목 4~70자, 내용 8~600자로 입력해주세요.');if(!await q(db,'SELECT id FROM stocks WHERE id=? AND active=1',[input.stockId]).first())throw Error('종목을 확인해주세요.');await rateLimit(db,'community:'+userId,now,3);await q(db,"INSERT INTO community_posts(id,user_id,stock_id,title,body,source,author,created) VALUES(?,?,?,?,?,'user','',?)",[crypto.randomUUID(),userId,input.stockId,input.title.trim(),input.body.trim(),now]).run();return{ok:true};}
export async function deletePost(db:D1Database,userId:string,id:unknown){if(typeof id!=='string')throw Error('게시글을 확인해주세요.');const result=await q(db,'DELETE FROM community_posts WHERE id=? AND user_id=?',[id,userId]).run();if(!result.meta.changes)throw Error('삭제할 수 없는 게시글입니다.');return{ok:true};}
