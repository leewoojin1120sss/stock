import {createHmac} from 'node:crypto';
import {companyProfile} from './company-profile.ts';
import {rateLimit} from './auth.ts';
import {makeNews,NEWS_TYPES} from './news.ts';
import {communityRumor} from './community-rumors.ts';
import {articleDetails} from './editorial.ts';
import {random,marketRandom,STEP,isOpen,type Row,type Stock,DAY,type Macro} from './market-data.ts';
import {RESEARCH_COST,RESEARCH_DURATION} from './research-pass.ts';
export {RESEARCH_COST,RESEARCH_DURATION};
export const CONTENT_CADENCE={community:20*60000,news:30*60000,research:60*60000};
const q=(db:D1Database,sql:string,args:unknown[]=[])=>db.prepare(sql).bind(...args);
const put=(db:D1Database,table:string,row:Row)=>{const keys=Object.keys(row);return q(db,`INSERT OR IGNORE INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,Object.values(row));};
const money=(n:number)=>Math.round(n).toLocaleString('ko-KR');
export function companyRelease(stock:Stock,ts:number){const p=companyProfile(stock);return{id:'company-ir-'+stock.id,ts,stock_id:stock.id,sector:stock.sector,title:stock.name+' | '+p.slogan,body:p.promise,impact:0,expires:ts+DAY*365,category:'기업소식',details:JSON.stringify({source:stock.name+' IR',paragraphs:[p.promise,stock.description,p.products.map(([name,desc])=>name+': '+desc).join(' · '),'사업별 비중은 '+p.segments.map(s=>s.name+' '+s.share+'%').join(', ')+'입니다. 각 사업의 판매량과 비용이 전체 실적에 얼마나 반영되는지 다음 발표와 비교할 수 있습니다.'],metrics:stock.kind==='stock'?[['주요 사업',stock.company_type],['사업 거점',p.location],['해외 매출',(stock.export_ratio*100).toFixed(1)+'%']]:[['상품 유형',stock.company_type],['연간 운용 비용',(stock.annual_fee*100).toFixed(2)+'%'],['순자산가치',stock.nav.toFixed(2)+'원']],focus:p.strengths})};}
export function makeCommunityTip(stock:Stock,ts:number,seed:string,index:number){return{id:'market-tip-'+ts+'-'+index,user_id:null,stock_id:stock.id,...communityRumor(stock,ts,seed,index),source:'unverified',created:ts};}
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
 if(market.info_version<3){
  // Refresh automated wording only; player posts, money and paid passes stay intact.
  const old=(await db.prepare("SELECT * FROM community_posts WHERE user_id IS NULL AND source='unverified' ORDER BY created DESC LIMIT 100").all<Row>()).results;
  const updates:D1PreparedStatement[]=[];
  for(const post of old){const stock=stocks.find(s=>s.id===post.stock_id);if(!stock)continue;const index=Number(String(post.id).split('-').at(-1))||0,next=makeCommunityTip(stock,post.created,seed,index);updates.push(q(db,'UPDATE community_posts SET title=?,body=?,author=? WHERE id=? AND user_id IS NULL',[next.title,next.body,next.author,post.id]));}
  // A bounded, once-only launch edition makes the new writing visible at once.
  // Preserve archived articles, account balances, user discussions and paid passes.
  const current=await db.prepare('SELECT rate,fx,oil,gold FROM ticks ORDER BY ts DESC LIMIT 1').first<Macro>(),macro=current||{rate:3,fx:1340,oil:78,gold:2700};
  for(let i=0;i<NEWS_TYPES.length;i++){
   const article=makeNews(now,stocks,false,macro,i,seed+':editorial-v3:'+i);article.id='editorial-v3-launch-'+i;article.impact=0;
   const d=JSON.parse(article.details);delete d.financialUpdate;article.details=JSON.stringify(d);updates.push(put(db,'news',article));
   if([1,4,9,15].includes(i)&&article.stock_id){const stock=stocks.find(s=>s.id===article.stock_id)!;updates.push(put(db,'research_reports',buildResearch(stock,article,now)));}
  }
  updates.push(db.prepare('UPDATE market SET info_version=3 WHERE id=1 AND info_version<3'));await db.batch(updates);
 }
 const due=Math.floor(now/STEP)*STEP,last=Math.min(due,market.info_cursor+24*STEP),commands:D1PreparedStatement[]=[];
 if(last<=market.info_cursor)return{syncing:false,published:0};
 const latest=await db.prepare('SELECT rate,fx,oil,gold FROM ticks ORDER BY ts DESC LIMIT 1').first<Macro>(),macro=latest||{rate:3,fx:1340,oil:78,gold:2700};
 const candidates=(await db.prepare("SELECT n.* FROM news n WHERE n.stock_id IS NOT NULL AND n.category!='기업소식' AND NOT EXISTS(SELECT 1 FROM research_reports r WHERE r.news_id=n.id) ORDER BY n.ts DESC LIMIT 60").all<Row>()).results;
 const used=new Set<string>();let published=0;
 for(let ts=market.info_cursor+STEP;ts<=last;ts+=STEP){
  if(ts%CONTENT_CADENCE.community===0){const stock=equities[Math.floor(marketRandom(seed+ts+'tip')*equities.length)];commands.push(put(db,'community_posts',makeCommunityTip(stock,ts,seed,Math.floor(marketRandom(seed+ts+'format')*8))));published++;}
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
