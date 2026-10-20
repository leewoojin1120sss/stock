import {createHmac} from 'node:crypto';
import {companyProfile} from './company-profile.ts';
import {rateLimit} from './auth.ts';
import {makeNews} from './news.ts';
import {articleDetails} from './editorial.ts';
import {random,STEP,isOpen,type Row,type Stock,DAY,type Macro} from './market-data.ts';
export const RESEARCH_COST=500000,RESEARCH_DURATION=DAY;
export const CONTENT_CADENCE={community:20*60000,news:30*60000,research:60*60000};
const q=(db:D1Database,sql:string,args:unknown[]=[])=>db.prepare(sql).bind(...args);
const put=(db:D1Database,table:string,row:Row)=>{const keys=Object.keys(row);return q(db,`INSERT OR IGNORE INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,Object.values(row));};
const money=(n:number)=>Math.round(n).toLocaleString('ko-KR');
export function companyRelease(stock:Stock,ts:number){const p=companyProfile(stock);return{id:'company-ir-'+stock.id,ts,stock_id:stock.id,sector:stock.sector,title:stock.name+' | '+p.slogan,body:p.promise,impact:0,expires:ts+DAY*365,category:'기업소식',details:JSON.stringify({source:stock.name+' IR',paragraphs:[p.promise,stock.description,p.products.map(([name,desc])=>name+': '+desc).join(' · '),'사업별 비중은 '+p.segments.map(s=>s.name+' '+s.share+'%').join(', ')+'입니다. 각 사업의 판매량과 비용이 전체 실적에 얼마나 반영되는지 다음 발표와 비교할 수 있습니다.'],metrics:stock.kind==='stock'?[['주요 사업',stock.company_type],['사업 거점',p.location],['해외 매출',(stock.export_ratio*100).toFixed(1)+'%']]:[['상품 유형',stock.company_type],['연간 운용 비용',(stock.annual_fee*100).toFixed(2)+'%'],['순자산가치',stock.nav.toFixed(2)+'원']],focus:p.strengths})};}
const sectorLeads:Record<string,[string,string]>={
 'IT 서비스':['회사에서 이 서비스 쓰는 사람?','새 고객이 늘었다던데 진짜인가요? 쓰기 편해졌으면 저는 조금 오를 것 같아요. 그냥 제 느낌입니다.'],
 '바이오':['신약 소문 믿어도 될까요','시험 잘됐다는 얘기가 도는데 원문은 못 봤어요. 기대만으로 너무 오른 것 같아서 저는 일단 기다려요.'],
 '금융':['은행 이자 수입 늘까요','대출 이자 받는 게 늘면 좋은 거 아닌가요? 못 갚는 사람도 늘 수 있다길래 헷갈리네요.'],
 '에너지':['기름값 오르면 여기도 오름?','기름값이 오른다는 글 봤는데 이 회사도 돈 더 버나요? 재료 사는 값도 오를 것 같아서 모르겠어요.'],
 '콘텐츠':['새 작품 해외에서 인기라던데','해외에서 반응 좋다는 글 몇 개 봤어요. 저는 좀 기대되는데 댓글만 보고 믿으면 안 되겠죠.'],
 '유통':['매장 사람 꽤 많던데요','주말에 손님 많았다는 후기 봤어요. 할인 때문에 붐빈 걸 수도 있지만 저는 매출 기대해봅니다.'],
 '자동차':['새 차 반응 괜찮은 듯','디자인 괜찮다는 얘기 많네요. 잘 팔리면 오를 것 같은데 실제 판매 숫자는 아직 못 봤어요.'],
 '반도체':['공장 바쁘다던데 출처 있음?','공장이 바쁘다는 글 봤는데 어디서 나온 얘긴가요? 주문이 진짜 늘었으면 좋겠네요.'],
 '플랫폼':['이 앱 요즘 자주 보이네요','주변에서 쓰는 사람이 늘었어요. 제 주변만 그럴 수도 있어서 주식은 더 지켜보려구요.'],
 '게임':['신작 해본 사람 후기 좀','영상은 재밌어 보이던데 해보신 분 있나요? 저는 출시 전에 기대감으로 오를 것 같아요. 틀릴 수도요.'],
 '이차전지':['배터리 주문 줄었다는 말 있던데','누가 주문 줄었다고 하던데 확인은 못 했어요. 진짜면 좀 내릴 것 같아서 일단 안 사려구요.'],
 '조선':['배 주문 많이 받았다는 글 봄','배를 많이 주문받았다는데 돈은 나중에 들어오는 거죠? 바로 이익이 확 늘어나는 건 아닌 듯해요.'],
 '식품':['신제품 또 사먹을 듯?','맛있다는 후기가 꽤 보이네요. 많이 팔리면 좋겠지만 후기 몇 개로 전체를 알긴 어렵겠죠.'],
 '로봇':['로봇 설치 늘었다는 얘기','공장에 로봇 더 넣는다는 소문 있네요. 저는 기대 중인데 계약 발표부터 기다려볼게요.'],
 '부동산':['빈 사무실 줄었다던데','빌딩에 새 회사 들어온다는 글 봤어요. 월세 더 받으면 좋겠지만 이자도 많이 낼 것 같네요.'],
 '운송':['비행기 좌석 꽉 찼다는 후기','사람 많으면 돈 잘 벌까요? 기름값 비싸서 생각보다 안 남을 수도 있겠네요.'],
 '헬스케어':['약 생산 늘린다는 소문','생산 늘린다는 얘기를 들었는데 확인된 글은 못 찾았어요. 저는 아직 지켜보는 쪽입니다.'],
 '지주':['자회사 잘되면 여기도 오르나요','자회사가 잘나간다는데 이 회사에도 돈이 들어오겠죠? 어떻게 연결되는지 아시는 분 있나요.'],
 '방산':['해외 계약 얘기 또 나오네요','이번엔 계약된 건지 협상 중인 건지 모르겠어요. 저는 기대하지만 발표 전엔 크게 안 살래요.'],
 '전력':['발전소 점검 끝났다는 얘기','다시 전기 많이 만들면 나아지려나요? 수리비 얼마나 들었는지는 못 봤어요.'],
 '물류':['배송 물량 늘었다던데요','배송 많아졌다는 글 봤는데 사람 뽑는 비용도 늘겠죠? 저는 조금 기대하고 있어요.'],
 '통신':['요금제 바꾸는 사람 많네요','싼 요금제로 바꾸는 사람 많던데 회사는 돈 덜 버는 거 아닌가요? 제 생각엔 조금 부담일 듯요.'],
 '전자상거래':['배송 빨라졌다는 후기','저는 편해졌다는 글을 많이 봤어요. 주문은 늘 것 같은데 배송비로 얼마나 남는지는 모르겠네요.']
};
export function makeCommunityTip(stock:Stock,ts:number,seed:string,index:number){
 const r=random(seed+stock.id+ts),p=companyProfile(stock),specific=sectorLeads[stock.sector]||['요즘 이 회사 어떻게 봐요?','저는 아직 고민 중이에요. 최근 소식 아는 분 있나요?'];
 const claims:[string,string][]=[specific,['이번엔 오를 것 같아요','최근 기사 보고 조금 기대 중이에요. 그래도 이미 많이 오른 거면 내릴 수도 있겠죠. 저는 소액만 생각 중입니다.'],['저는 좀 내릴 것 같은데요','기대가 너무 큰 것 같아요. 실제로 잘 팔리는지 보고 사려구요. 제 예상이 틀릴 수도 있어요.'],['직접 써본 사람 있나요?',p.products[0][0]+' 써본 분 후기 좀 부탁해요. 광고 말고 실제 느낌 궁금합니다.'],['지금 사는 건 너무 급할까요','가격이 움직이니까 마음이 급하네요. 회사가 잘 버는지부터 봐야겠죠? 다들 어떻게 보세요.'],['소문 출처 찾은 분?','단톡방에 좋은 얘기 돌던데 원문은 없네요. 확인 안 된 소문일 수도 있으니 저는 일단 기다릴게요.'],['배당 언제 들어오는지 아세요','배당 준다는데 몇 시까지 가지고 있어야 하나요? 배당 받으면 주가도 내려간다던데 헷갈려요.'],['기사랑 주가 반대로 가네요','기사 좋아 보이는데 왜 내리죠? 사람들이 더 좋은 발표를 기대한 건가요. 쉽게 설명해주실 분?']];
 const pair=claims[index%claims.length];return{id:'market-tip-'+ts+'-'+index,user_id:null,stock_id:stock.id,title:stock.name+' · '+pair[0],body:pair[1],source:'unverified',author:['상승기대봇','관망봇','종목수다봇','소문메모봇'][Math.floor(r*4)],created:ts};
}
export function buildResearch(stock:Stock,article:Row,now:number){
 const details=articleDetails(article),profile=companyProfile(stock),source=details.source||stock.name+' IR';
 const metrics=(details.metrics||[]) as string[][],paragraphs=(details.paragraphs||[article.body]) as string[];
 const eps=stock.eps,per=eps>0?stock.price/eps:null,pbr=stock.price/stock.bps;
 const keyNumbers=metrics.slice(0,3).map(([label,value])=>label+' '+value).join(' · ');
 const sections=[
  {title:'핵심 판단',body:details.easy.impact+' '+keyNumbers+'.'},
  {title:'원문에서 확인되는 사실',body:paragraphs[0]||article.body},
  {title:'실적에 연결되는 경로',body:(paragraphs[1]||'')+' '+profile.products[0][0]+' 사업에서 실제 판매와 현금 유입으로 이어지는지가 핵심이다.'},
  {title:'가격과 재무 수치',body:'작성 시점 주가 '+money(stock.price)+'원, EPS '+money(eps)+'원, BPS '+money(stock.bps)+'원이다. '+(per?'PER '+per.toFixed(2)+'배, ':'적자로 PER은 산출하지 않으며, ')+'PBR은 '+pbr.toFixed(2)+'배다. 현재 가격을 기준으로 계산한 배수이며 적정 주가를 보장하지 않는다.'},
  {title:'예상이 빗나갈 조건',body:details.easy.caveat+' '+(paragraphs[2]||'')},
  {title:'다음에 확인할 자료',body:(details.focus||profile.strengths).join(' · ')+'. 기사 발표 시각과 분석 작성 시각의 차이를 확인하고, 정정 공시·실제 납품·확정 실적이 나오면 기존 가정을 다시 비교한다.'}
 ];
 const oneLine=keyNumbers?keyNumbers+' — '+details.easy.summary:details.oneLine;
 return{id:'research-'+article.id,stock_id:stock.id,news_id:article.id,title:stock.name+' · '+article.category+' 핵심 분석',summary:oneLine,created:now,body:JSON.stringify({source:'부석 리서치센터',checkedAt:now,lead:article.body,oneLine,easy:details.easy,metrics,sections,sources:[{id:article.id,title:article.title,source,publishedAt:article.ts}],snapshot:{price:stock.price,eps,bps:stock.bps,at:now},evidenceNote:'인용한 발표 수치와 계산식을 대조했다. 원문 자체의 누락·정정 가능성과 향후 주가 예상은 별개이며, 독립적인 현장 확인을 뜻하지 않는다.',scenarioNote:'작성 시점 주가 '+money(stock.price)+'원을 고정하고 이익만 달라진다고 가정한 계산이다. 목표 주가나 확정 실적 예상이 아니다.',scenarios:eps>0?[-20,-10,0,10,20].map(change=>({label:'EPS '+(change>0?'+':'')+change+'%',eps:Math.round(eps*(1+change/100)),pe:stock.price/Math.max(1,Math.round(eps*(1+change/100)))})):[]})};
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
 if(market.info_version<2){
  // Refresh automated wording only; player posts, money and paid passes stay intact.
  const old=(await db.prepare("SELECT * FROM community_posts WHERE user_id IS NULL AND source='unverified' ORDER BY created DESC LIMIT 100").all<Row>()).results;
  const updates:D1PreparedStatement[]=[];
  for(const post of old){const stock=stocks.find(s=>s.id===post.stock_id);if(!stock)continue;const index=Number(String(post.id).split('-').at(-1))||0,next=makeCommunityTip(stock,post.created,seed,index);updates.push(q(db,'UPDATE community_posts SET title=?,body=?,author=? WHERE id=? AND user_id IS NULL',[next.title,next.body,next.author,post.id]));}
  updates.push(db.prepare('UPDATE market SET info_version=2 WHERE id=1 AND info_version<2'));await db.batch(updates);
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
export async function informationSnapshot(db:D1Database,userId:string|null,now:number){const[posts,reports,subscription]=await Promise.all([q(db,"SELECT p.id,p.stock_id,p.title,p.body,p.source,p.created,CASE WHEN p.user_id IS NULL THEN p.author ELSE a.nickname END AS author,s.name AS stock_name,p.user_id,(SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id) AS comments,(SELECT COUNT(*) FROM community_likes l WHERE l.post_id=p.id) AS likes,EXISTS(SELECT 1 FROM community_likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked FROM community_posts p LEFT JOIN accounts a ON a.id=p.user_id JOIN stocks s ON s.id=p.stock_id WHERE s.active=1 ORDER BY p.created DESC,p.id DESC LIMIT 60",[userId]).all<Row>(),db.prepare('SELECT r.id,r.stock_id,r.news_id,r.title,r.summary,r.created,s.name AS stock_name FROM research_reports r JOIN stocks s ON s.id=r.stock_id WHERE s.active=1 ORDER BY r.created DESC,r.id LIMIT 30').all<Row>(),subscriptionFor(db,userId,now)]);return{publication:{communityMinutes:20,researchMinutes:60,newsMinutes:30,nextCommunity:(Math.floor(now/CONTENT_CADENCE.community)+1)*CONTENT_CADENCE.community,nextResearch:(Math.floor(now/CONTENT_CADENCE.research)+1)*CONTENT_CADENCE.research},posts:posts.results.map(({user_id,...p}):Row=>({...p,own:!!userId&&user_id===userId})),reports:reports.results,subscription};}
export async function subscribe(db:D1Database,userId:string,key:unknown,now:number){if(typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw Error('구독 요청을 확인해주세요.');const previous=await q(db,'SELECT expires FROM research_purchases WHERE user_id=? AND request_key=?',[userId,key]).first<Row>();if(previous)return{ok:true,duplicate:true,expires:previous.expires};try{await q(db,'INSERT INTO research_purchases(id,user_id,request_key,cost,created,expires) VALUES(?,?,?,?,?,?)',[crypto.randomUUID(),userId,key,RESEARCH_COST,now,now+RESEARCH_DURATION]).run();}catch(e){const error=String(e);if(error.includes('SUBSCRIPTION_ACTIVE'))return{ok:true,...await subscriptionFor(db,userId,now)};if(error.includes('SUBSCRIPTION_FUNDS'))throw Error('구독할 계좌 잔액이 부족합니다.');if(error.includes('UNIQUE'))return{ok:true,duplicate:true,...await subscriptionFor(db,userId,now)};throw e;}return{ok:true,...await subscriptionFor(db,userId,now)};}
export async function researchArticle(db:D1Database,userId:string|null,id:string,now:number){if(!userId)throw Error('로그인 후 리서치를 구독해주세요.');if(!(await subscriptionFor(db,userId,now)).active)throw Error('리서치 구독이 필요합니다.');const report=await q(db,'SELECT r.*,s.name AS stock_name FROM research_reports r JOIN stocks s ON s.id=r.stock_id WHERE r.id=? AND s.active=1',[id]).first<Row>();if(!report)throw Error('기사를 찾을 수 없습니다.');const body=JSON.parse(report.body);if(!body.easy){const original=await q(db,'SELECT category,title,body,details FROM news WHERE id=?',[report.news_id]).first<Row>(),d=articleDetails(original||{category:'리서치',body:body.lead,details:{}});body.easy=d.easy;body.oneLine=d.oneLine;body.evidenceNote='원문에 기재된 수치에 근거한 분석이며 자료의 정정 가능성과 미래 전망의 불확실성은 남아 있습니다.';}return{...report,body};}
export async function publishPost(db:D1Database,userId:string,input:Row,now:number){if(typeof input.stockId!=='string'||typeof input.title!=='string'||typeof input.body!=='string'||input.title.trim().length<4||input.title.length>70||input.body.trim().length<8||input.body.length>600)throw Error('제목 4~70자, 내용 8~600자로 입력해주세요.');if(!await q(db,'SELECT id FROM stocks WHERE id=? AND active=1',[input.stockId]).first())throw Error('종목을 확인해주세요.');await rateLimit(db,'community:'+userId,now,3);await q(db,"INSERT INTO community_posts(id,user_id,stock_id,title,body,source,author,created) VALUES(?,?,?,?,?,'user','',?)",[crypto.randomUUID(),userId,input.stockId,input.title.trim(),input.body.trim(),now]).run();return{ok:true};}
export async function deletePost(db:D1Database,userId:string,id:unknown){if(typeof id!=='string')throw Error('게시글을 확인해주세요.');const result=await q(db,'DELETE FROM community_posts WHERE id=? AND user_id=?',[id,userId]).run();if(!result.meta.changes)throw Error('삭제할 수 없는 게시글입니다.');return{ok:true};}
async function existingPost(db:D1Database,id:unknown){if(typeof id!=='string'||id.length>160)throw Error('게시글을 확인해주세요.');const post=await q(db,'SELECT id FROM community_posts WHERE id=?',[id]).first<Row>();if(!post)throw Error('게시글이 삭제되었거나 없습니다.');return post;}
export async function communityThread(db:D1Database,userId:string|null,id:unknown){
 await existingPost(db,id);
 const post=await q(db,'SELECT p.*,s.name AS stock_name,CASE WHEN p.user_id IS NULL THEN p.author ELSE a.nickname END AS nickname,(SELECT COUNT(*) FROM community_likes l WHERE l.post_id=p.id) AS likes,EXISTS(SELECT 1 FROM community_likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked FROM community_posts p LEFT JOIN accounts a ON a.id=p.user_id JOIN stocks s ON s.id=p.stock_id WHERE p.id=?',[userId,id]).first<Row>();
 const rows=await q(db,'SELECT c.id,c.body,c.created,c.user_id,a.nickname AS author FROM community_comments c JOIN accounts a ON a.id=c.user_id WHERE c.post_id=? ORDER BY c.created,c.id LIMIT 100',[id]).all<Row>();
 const {user_id, ...safe}=post!;
 return{...safe,author:safe.nickname,own:!!userId&&user_id===userId,comments:rows.results.map(({user_id,...c})=>({...c,own:!!userId&&user_id===userId}))};
}
export async function commentOnPost(db:D1Database,userId:string,input:Row,now:number){
 await existingPost(db,input.id);if(typeof input.body!=='string'||input.body.trim().length<2||input.body.length>300)throw Error('댓글은 2~300자로 입력해주세요.');
 if(typeof input.requestKey!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey))throw Error('댓글 요청을 확인해주세요.');
 const id='comment-'+userId+'-'+input.requestKey;if(await q(db,'SELECT id FROM community_comments WHERE id=?',[id]).first())return{ok:true};
 await rateLimit(db,'comment:'+userId,now,5);await q(db,'INSERT OR IGNORE INTO community_comments(id,post_id,user_id,body,created) VALUES(?,?,?,?,?)',[id,input.id,userId,input.body.trim(),now]).run();return{ok:true};
}
export async function likePost(db:D1Database,userId:string,id:unknown,liked:unknown,now:number){await existingPost(db,id);if(typeof liked!=='boolean')throw Error('추천 요청을 확인해주세요.');await rateLimit(db,'like:'+userId,now,30);if(liked)await q(db,'INSERT OR IGNORE INTO community_likes(post_id,user_id,created) VALUES(?,?,?)',[id,userId,now]).run();else await q(db,'DELETE FROM community_likes WHERE post_id=? AND user_id=?',[id,userId]).run();return{ok:true};}
export async function deleteComment(db:D1Database,userId:string,id:unknown){if(typeof id!=='string'||id.length>240)throw Error('댓글을 확인해주세요.');const r=await q(db,'DELETE FROM community_comments WHERE id=? AND user_id=?',[id,userId]).run();if(!r.meta.changes)throw Error('삭제할 수 없는 댓글입니다.');return{ok:true};}
