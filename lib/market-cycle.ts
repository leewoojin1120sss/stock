import {createHmac} from 'node:crypto';
import {DAY,seedStocks,session,type Stock,type Row} from './market-data.ts';

export const CYCLE_MODEL_START=Date.parse('2026-10-20T21:30:00+09:00');
const epoch=session(CYCLE_MODEL_START).day,profiles=seedStocks();
const drawCache=new Map<string,number>();
function draw(secret:string,key:string){const cacheKey=secret+':'+key,cached=drawCache.get(cacheKey);if(cached!==undefined)return cached;const value=createHmac('sha256',secret).update('market-cycle-v1:'+key).digest().readUInt32BE(0)/4294967296;if(drawCache.size>=4096)drawCache.clear();drawCache.set(cacheKey,value);return value;}
type Phase='expansion'|'correction'|'rotation';
type EventTemplate={title:string;source:string;fact:string;condition:string;exposure:Record<string,number>;market:number;};
const templates:EventTemplate[]=[
 {title:'정책금융, 생산성 투자 지원안 발표',source:'산업정책위원회',fact:'자동화·전력 효율화 설비에 대한 보증 지원 범위를 넓히는 방안이 발표됐다. 지원은 심사와 설비 도입 확인을 거쳐 집행된다.',condition:'지원 대상에 실제로 선정되는지와 기업이 부담할 자기자금 규모',exposure:{'로봇':1,'반도체':.7,'전력':.65,'IT 서비스':.5,'금융':-.25},market:.18},
 {title:'국제 물류 항로 차질… 우회 운항 확대',source:'국제교역 조사실',fact:'주요 항로의 통과 제한으로 일부 화물이 우회 운항에 들어갔다. 선복 공급과 유류 할증료 협상이 동시에 진행되고 있다.',condition:'항로 정상화 시점과 장기 운송 계약의 비용 부담 주체',exposure:{'에너지':.7,'조선':.45,'물류':-.8,'운송':-1,'식품':-.45,'전자상거래':-.5},market:-.15},
 {title:'주요 교역권 통관 협의 진전',source:'국제교역 협의체',fact:'일부 산업재와 완성품의 서류 심사를 간소화하는 시범안이 공개됐다. 적용 품목과 원산지 증명 조건은 세부 협의 대상으로 남았다.',condition:'최종 적용 품목과 실제 수출 대금의 회수 속도',exposure:{'자동차':1,'조선':.65,'방산':.55,'반도체':.6,'물류':.5,'유통':-.25},market:.12},
 {title:'기업 차입 심사 강화… 조달 조건 재검토',source:'신용시장 점검단',fact:'대출 심사에서 현금흐름과 담보 여력의 확인 범위가 넓어졌다. 신규 투자 기업과 만기가 집중된 차입자의 조달 일정에 차이가 나타나고 있다.',condition:'차환 계약의 최종 금리와 기업별 현금 보유량',exposure:{'부동산':-1,'바이오':-.85,'이차전지':-.65,'금융':.3,'통신':.2},market:-.18},
 {title:'데이터센터 장비 발주 재개 움직임',source:'정보산업 수요조사센터',fact:'일부 대형 고객이 보류했던 서버·자동화 장비의 발주 검토를 재개했다. 공급사 선정과 검수 조건은 거래처별로 다르다.',condition:'검토 물량이 확정 주문으로 전환되는 비율과 납품 원가',exposure:{'반도체':1,'IT 서비스':.85,'전력':.55,'로봇':.6,'유통':-.2},market:.08},
 {title:'소비재 유통망, 재고 조정 계획 공개',source:'소비유통 조사센터',fact:'판매 채널이 일부 상품의 발주량을 줄이고 할인 행사로 재고를 낮추기로 했다. 행사 매출 증가와 공급사의 납품 단가 인하 요구가 함께 나타났다.',condition:'할인 이후의 재구매율과 미판매 재고의 평가 손실',exposure:{'유통':-.6,'식품':-.65,'전자상거래':-.8,'콘텐츠':.3,'통신':.25},market:-.06},
 {title:'해외 콘텐츠 배급 공동 편성안 마련',source:'문화콘텐츠 유통협의회',fact:'해외 배급 채널이 작품·게임의 공동 편성안을 공개했다. 선급금과 성과 연동 정산의 비중은 개별 계약에서 결정된다.',condition:'편성 확정 여부와 제작·마케팅비를 공제한 실제 정산액',exposure:{'콘텐츠':1,'게임':.9,'플랫폼':.55,'통신':.3,'물류':-.2},market:.04},
 {title:'정보보호 점검 기준 개편안 공개',source:'디지털서비스 점검위원회',fact:'온라인 서비스의 정보 보관과 접근 관리에 대한 추가 점검안이 발표됐다. 전환 기간과 기술 지원 범위는 업종별로 협의 중이다.',condition:'추가 보안 비용과 기존 고객의 서비스 이용 변화',exposure:{'플랫폼':-.8,'전자상거래':-.65,'게임':-.4,'IT 서비스':.7,'통신':.35},market:-.04},
 {title:'의약품 위탁생산 심사 절차 개선 추진',source:'의약산업 협의체',fact:'생산 설비의 중복 서류 확인을 줄이는 절차 개선안이 나왔다. 품질 심사와 제품별 허가 요건은 별도로 유지된다.',condition:'시설별 심사 통과 여부와 확보된 생산 계약 물량',exposure:{'헬스케어':1,'바이오':.7,'물류':.25,'식품':-.2},market:.04},
 {title:'전력 공급 설비 점검 일정 조정',source:'전력운영 점검센터',fact:'일부 전력 설비의 점검 일정이 겹치면서 산업용 전력 계약의 조정 협의가 시작됐다. 생산 일정 변경과 비상 공급 비용이 주요 논의 대상이다.',condition:'정상 가동 시점과 추가 비용을 부담하는 계약 당사자',exposure:{'전력':-.9,'반도체':-.55,'이차전지':-.7,'에너지':.55,'통신':.2},market:-.08}
];
export type CycleEvent={id:string;start:number;end:number;reviewAt:number;revised:boolean;strength:number;template:EventTemplate;stockId:string|null;};
export type MarketCycle={phase:Phase;phaseId:string;from:number;to:number;dailyDrift:number;signals:Record<string,number>;events:CycleEvent[];announcements:Set<string>;};

export function marketCycle(ts:number,secret:string,stocks:Stock[]):MarketCycle|null{
 if(ts<CYCLE_MODEL_START)return null;
 const day=Math.floor((session(ts).day-epoch)/DAY),cycle=Math.floor(day/14),position=day-cycle*14;
 const bullish=5+Math.floor(draw(secret,'bull-length:'+cycle)*3),bearish=3+Math.floor(draw(secret,'bear-length:'+cycle)*2);
 const lengths={expansion:bullish,correction:bearish,rotation:14-bullish-bearish};
 const arrangements:Phase[][]=[['expansion','correction','rotation'],['correction','rotation','expansion'],['rotation','expansion','correction']];
 const order=arrangements[cycle===0?0:Math.floor(draw(secret,'order:'+cycle)*3)];let phase=order[0],offset=0;
 for(const candidate of order){phase=candidate;if(position<offset+lengths[phase])break;offset+=lengths[phase];}
 const from=Math.max(CYCLE_MODEL_START,session(epoch+(cycle*14+offset)*DAY).open),to=session(epoch+(cycle*14+offset+lengths[phase])*DAY).open;
 // A mild long-run tendency with genuine negative-drift correction periods.
 const drift={expansion:.0020,correction:-.0022,rotation:.0004}[phase];
 const equities=stocks.filter(s=>s.kind==='stock'&&s.active!==0),rotation=Math.floor(day/4),companyPeriod=Math.floor(day/7),signals:Record<string,number>={};
 for(const s of equities){const base=profiles.find(p=>p.id===s.id),quality=base?Math.tanh((s.eps-base.eps)/Math.max(1,Math.abs(base.eps)))*.002:0;signals[s.id]=(draw(secret,'sector:'+rotation+':'+s.sector)-.5)*.008+(draw(secret,'company:'+companyPeriod+':'+s.id)-.5)*.005+quality;}
 const mean=equities.reduce((n,s)=>n+signals[s.id],0)/Math.max(1,equities.length);for(const s of equities)signals[s.id]-=mean;
 const events:CycleEvent[]=[];
 // One release in each four-day window; adjacent release gaps are 3–5 days.
 for(let block=Math.max(0,Math.floor(day/4)-1);block<=Math.floor(day/4);block++){
  const atDay=block*4+Math.floor(draw(secret,'event-offset:'+block)*2),date=session(epoch+atDay*DAY),start=Math.max(CYCLE_MODEL_START,date.open+(80+Math.floor(draw(secret,'event-hour:'+block)*7)*10)*60000),duration=2+Math.floor(draw(secret,'event-duration:'+block)*3),end=start+duration*DAY;
  if(ts<start||ts>=end)continue;
  const template=templates[Math.floor(draw(secret,'event-kind:'+block)*templates.length)],candidates=equities.filter(s=>Math.abs(template.exposure[s.sector]||0)>=.5),stock=candidates[Math.floor(draw(secret,'event-company:'+block)*candidates.length)];
  events.push({id:'market-event-v1-'+block,start,end,reviewAt:start+Math.ceil(duration/2)*DAY,revised:draw(secret,'event-revision:'+block)>.74,strength:.8+draw(secret,'event-strength:'+block)*.4,template,stockId:stock?.id||null});
 }
 return{phase,phaseId:'market-phase-v1-'+cycle+'-'+offset,from,to,dailyDrift:drift,signals,events,announcements:new Set()};
}
export function cycleMove(stock:Stock,cycle:MarketCycle,ts:number,auctions:number){
 let move=(cycle.dailyDrift*(.75+stock.beta*.25)+(cycle.signals[stock.id]||0))/auctions;
 for(const event of cycle.events){const age=(ts-event.start)/(event.end-event.start),revised=event.revised&&ts>=event.reviewAt,exposure=(event.template.exposure[stock.sector]||0)*(event.stockId===stock.id?1.2:1),market=event.template.market;
  move+=(market*.004+exposure*.007)*event.strength*Math.max(0,1-age)*(revised?-.55:1)/auctions;
  if(cycle.announcements.has(event.id))move+=(market+exposure)*.024*event.strength;
  if(cycle.announcements.has(event.id+'-review'))move-=(market+exposure)*.012*event.strength;
 }
 return move;
}
const phaseCopy:Record<Phase,[string,string,string]>={
 expansion:['기업 투자·주문 회복 기대… 자금 흐름 업종별 차별화','기업의 투자와 주문 회복 기대가 위험자산 선호를 지지하고 있다. 다만 이익 전망과 자금 조달 여력이 다른 기업 사이에서 자금 유입의 속도가 엇갈리고 있다.','경기 기대가 나아져도 실적이 약하거나 비용이 늘어난 회사의 주가는 내려갈 수 있어요.'],
 correction:['실적 눈높이 조정… 차입 부담·현금흐름 재점검','투자자들이 예상 이익과 차입 부담을 다시 비교하면서 위험자산 매입에 신중해지고 있다. 반복 매출과 현금 여력이 있는 기업을 찾는 움직임도 함께 나타나고 있다.','시장이 조심스러워져도 좋은 계약이나 실적을 내놓은 회사는 오를 수 있어요.'],
 rotation:['업종별 순환매… 실적·가격 수준 따라 자금 이동','시장 전체의 방향성보다 업종별 사업 지표와 가격 수준에 따른 자금 이동이 두드러지고 있다. 같은 업종 안에서도 투자 비용과 이익의 지속성에 따라 평가가 달라지고 있다.','시장이 비슷한 자리에 있어도 돈이 몰리는 업종과 빠져나가는 업종은 달라질 수 있어요.']
};
function phaseArticle(cycle:MarketCycle,ts:number):Row{const [title,fact,influence]=phaseCopy[cycle.phase];return{id:cycle.phaseId,ts,stock_id:null,sector:null,title,body:fact,impact:0,expires:cycle.to,category:'시장동향',details:JSON.stringify({source:'부석 시장분석 데스크',oneLine:fact,paragraphs:[fact,'최근 발표를 비교할 때에는 매출과 이익의 방향, 일회성 손익 포함 여부와 현금 회수 조건을 함께 살펴야 한다. 특정 종목의 등락을 시장 전체의 변화와 동일하게 해석하기는 어렵다.','금리·환율·원재료 가격은 같은 방향으로 움직여도 수출 비중과 차입 구조에 따라 기업별 손익에 다르게 전달된다. 현재의 시장 분위기가 모든 종목의 수익률을 결정하는 것은 아니다.','새로운 계약과 실적 발표가 나오면 기존 기대가 수정될 수 있다. 발표 전 주가에 반영된 기대가 높았던 기업은 수치가 개선돼도 다른 반응을 보일 수 있다.'],metrics:[['관찰 범위','시장·업종·개별 기업'],['핵심 비교','이익·현금흐름·가격'],['자료 성격','시장 동향 분석']],focus:['실제 이익과 기대의 차이','업종별 원가·차입 부담','후속 발표와 정정 자료'],easy:{summary:'시장의 분위기가 달라지고 있어요. 그래도 회사마다 돈을 버는 상황과 주가는 다르게 움직여요.',terms:[['위험자산 선호','가격이 크게 움직일 수 있는 투자에도 돈을 넣으려는 마음이에요.'],['순환매','투자금이 한 업종에서 다른 업종으로 옮겨가는 흐름이에요.']],impact:influence,caveat:'이 기사는 시장 상황을 해석한 내용이에요. 새 사건이나 실적이 나오면 해석과 주가 방향이 달라질 수 있어요.'}})};}
function eventArticle(event:CycleEvent,ts:number,review=false):Row{
 const t=event.template,headline=review?t.title+' 후속 점검… 집행 조건·일정 재조정':t.title,fact=review?'앞서 발표된 계획에 추가 확인 절차가 필요해 일부 집행 일정과 적용 범위가 조정됐다. 초기 발표만으로 판단했던 실적 반영 시점도 다시 검토되고 있다.':t.fact;
 const sectors=Object.keys(t.exposure).join('·'),summary=review?'처음 발표한 계획이 그대로 진행되지 않고 있어요. 실제 적용 조건을 다시 확인해야 해요.':'새로운 산업 소식이 나왔어요. 어떤 회사가 관련돼 있고 실제로 돈이 얼마나 들어오거나 나가는지 확인해야 해요.';
 return{id:event.id+(review?'-review':''),ts,stock_id:event.stockId,sector:null,title:headline,body:fact,impact:0,expires:event.end,category:'시장 이슈',details:JSON.stringify({source:t.source,oneLine:fact,paragraphs:[fact,`주요 관찰 업종은 ${sectors}다. 같은 업종이라도 거래처·제품 구성과 기존 계약 조건에 따라 영향의 크기와 반영 시점은 달라질 수 있다.`,`${t.condition}가 핵심 확인 항목이다. 발표 금액이나 검토 물량을 곧바로 이익 증가로 계산하는 것은 적절하지 않다.`,'단기적으로는 새 정보에 따른 주문이 주가에 반영될 수 있고, 이후에는 실제 집행과 기업별 비용 전가 능력에 대한 평가가 이어질 수 있다. 일부 기업은 반대 방향의 영향을 받을 수 있다.','후속 협의나 심사 과정에서 계획이 바뀌거나 지연될 가능성이 있다. 이번 발표만으로 향후 매출과 주가를 확정할 수 없으며, 관련 기업의 계약·실적 자료와 함께 비교할 필요가 있다.'],metrics:[['관련 업종',sectors],['진행 단계',review?'조건 재검토':'발표·협의'],['확인 항목',t.condition]],focus:[t.condition,'기업별 기존 계약과 비용 부담','후속 자료·계획 변경 여부'],easy:{summary,terms:[['집행','발표한 계획대로 실제 돈을 쓰거나 일을 진행하는 것이에요.'],['비용 전가','늘어난 비용을 판매가격에 반영하는 것이에요.']],impact:'관련 주문이 늘거나 비용이 줄어드는 회사에는 도움이 될 수 있어요. 반대로 돈을 더 내거나 판매가 줄어드는 회사에는 부담이 될 수 있어요. 영향은 며칠에 걸쳐 달라질 수 있어요.',caveat:review?'처음 기대했던 효과가 줄거나 반대로 나타날 수도 있어요. 변경된 조건과 실제 성과를 비교해요.':'초기 소식이 틀리거나 계획이 바뀔 수 있어요. 이미 주가에 반영된 기대와 새 발표를 함께 확인해요.'}})};
}
export function cycleArticles(cycle:MarketCycle|null,ts:number,known:Row[]){
 if(!cycle)return[];const ids=new Set(known.map(n=>n.id)),articles:Row[]=[];
 if(!ids.has(cycle.phaseId))articles.push(phaseArticle(cycle,ts));
 for(const event of cycle.events){if(!ids.has(event.id))articles.push(eventArticle(event,ts));if(event.revised&&ts>=event.reviewAt&&!ids.has(event.id+'-review'))articles.push(eventArticle(event,ts,true));}
 cycle.announcements=new Set(articles.map(n=>n.id));return articles;
}
