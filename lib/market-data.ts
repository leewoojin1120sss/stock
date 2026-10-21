export const STEP=600_000,DAY=86_400_000,INITIAL_CASH=10_000_000,FEE=.001;
export const MARKET_CADENCE_SWITCH=Date.parse('2026-10-20T21:00:00+09:00'),FAST_STEP=300_000;
export function marketInterval(ts:number){return ts<MARKET_CADENCE_SWITCH?STEP:FAST_STEP;}
export type Row=Record<string,any>;
export type Stock={id:string;name:string;sector:string;kind:string;initial:number;price:number;previous:number;day_open:number;high:number;low:number;volume:number;turnover:number;shares:number;pe:number;dividend:number;beta:number;net_flow:number;active:number;company_type:string;description:string;eps:number;bps:number;revenue:number;margin:number;debt_ratio:number;export_ratio:number;nav:number;nav_base:number;annual_fee:number;payout:number};
export function random(seed:string){let h=2166136261;for(let i=0;i<seed.length;i++)h=Math.imul(h^seed.charCodeAt(i),16777619);return(h>>>0)/4294967296;}
// Avalanche similar symbol suffixes without changing existing company identities.
export function marketRandom(seed:string){let h=(random(seed)*4294967296)>>>0;h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;return(h>>>0)/4294967296;}
export const SPECIAL_OPEN_DAY='2026-10-19';
export function session(ts:number){const day=Math.floor((ts+9*3600000)/DAY)*DAY-9*3600000,special=new Date(day+9*3600000).toISOString().slice(0,10)===SPECIAL_OPEN_DAY;return{day,open:day+(special?1200:1000)*60000,close:day+1420*60000,special};}
export function nextTick(ts:number){const s=session(ts);if(ts<s.open)return s.open;if(ts>=s.close)return session(s.day+DAY).open;const interval=marketInterval(ts),next=(Math.floor(ts/interval)+1)*interval;return Math.min(s.close,ts<MARKET_CADENCE_SWITCH?Math.min(next,MARKET_CADENCE_SWITCH):next);}
export function auctionSlot(ts:number){const s=session(ts),at=Math.max(s.open,Math.min(ts,s.close));if(s.open>=MARKET_CADENCE_SWITCH)return Math.floor((at-s.open)/FAST_STEP);if(at<=MARKET_CADENCE_SWITCH)return Math.floor((at-s.open)/STEP);return Math.floor((MARKET_CADENCE_SWITCH-s.open)/STEP)+Math.floor((at-MARKET_CADENCE_SWITCH)/FAST_STEP);}
export function auctionsInSession(ts:number){return auctionSlot(session(ts).close)+1;}
export function isOpen(ts:number){const s=session(ts);return ts>=s.open&&ts<s.close;}
export function fee(amount:number){return Math.floor((amount+999)/1000);}
export function tickSize(price:number,kind='stock'){return kind!=='stock'?(price<2000?1:5):price<2000?1:price<5000?5:price<20000?10:price<50000?50:price<200000?100:price<500000?500:1000;}
export function roundPrice(price:number,kind='stock',mode:'round'|'ceil'|'floor'='round'){let value=Math.max(1,Math[mode](price/tickSize(price,kind))*tickSize(price,kind));return Math.max(1,Math[mode](value/tickSize(value,kind))*tickSize(value,kind));}
export function priceBounds(previous:number,kind='stock'){const mult=kind==='leverage'||kind==='inverse2'?2:1;return{lower:roundPrice(previous*(1-.3*mult),kind,'ceil'),upper:roundPrice(previous*(1+.3*mult),kind,'floor')};}
export function reserveFor(qty:number,price:number){return qty*(price+fee(price));}
const companies=[
 ['000001','가지환클라우드','IT 서비스','SaaS','기업용 클라우드·보안 구독 서비스를 운영합니다. 고객 유지율과 서버 가동률, 데이터센터 전력비가 주요 경영 변수입니다.',.2],
 ['000002','강선후바이오','바이오','연구개발 기업','항체 치료제를 개발합니다. 임상 진척도, 기술 이전 계약금, 연구개발 자금 소진 속도를 확인할 필요가 있습니다.',.4],
 ['000003','강현규금융','금융','은행 금융지주','은행·카드·자산운용을 보유한 금융지주입니다. 예대마진과 대손충당금, 자본 적정성이 실적에 반영됩니다.',.08],
 ['000004','고범수에너지','에너지','정유·화학','정제유와 화학 소재를 생산합니다. 국제유가 자체보다 정제마진, 재고평가손익, 원재료 조달 조건의 영향이 큽니다.',.42],
 ['000005','권아현미디어','콘텐츠','IP 기업','영상·음악 IP를 제작·유통합니다. 제작비 회수, 해외 판권 계약, 작품별 흥행 편차가 주요 변수입니다.',.35],
 ['000006','김관율리테일','유통','내수 소비주','편의점과 생활용품 매장을 운영합니다. 기존점 매출, 임대료, 인건비와 소비 심리를 살펴볼 수 있습니다.',.03],
 ['000007','김민찬모터스','자동차','수출 제조업','승용차·전기차와 부품을 생산합니다. 해외 판매 비중이 높으며 환율, 판매 믹스, 품질보증 비용에 민감합니다.',.72],
 ['000008','김예준반도체','반도체','파운드리','고성능 연산용 반도체를 위탁 생산합니다. 수율, 가동률, 첨단 공정 투자와 주요 고객 발주가 실적을 좌우합니다.',.86],
 ['000009','노지환플랫폼','플랫폼','인터넷 플랫폼','검색·광고·결제 서비스를 운영합니다. 광고 단가, 거래액, 고객 획득 비용과 규제 환경에 노출돼 있습니다.',.12],
 ['000010','문서희게임즈','게임','게임 개발사','PC·모바일 게임을 개발하고 서비스합니다. 신작 일정, 결제 이용자 수와 플랫폼 수수료가 핵심 지표입니다.',.62],
 ['000011','박시후배터리','이차전지','소재·셀 제조','배터리 셀과 양극재를 공급합니다. 리튬 가격, 장기 공급계약과 공장 증설 일정, 고객 재고의 영향을 받습니다.',.79],
 ['000012','신성현조선','조선','수주 산업','LNG 운반선과 친환경 선박을 건조합니다. 선가·후판 가격, 수주 잔고, 인도 시점에 따라 수익 인식이 달라집니다.',.91],
 ['000013','양다연푸드','식품','필수 소비재','가공식품과 식자재를 생산합니다. 곡물 가격과 포장재, 해외 유통망, 제품 가격 전가력이 핵심 변수입니다.',.24],
 ['000014','유동우로보틱스','로봇','성장 기업','협동로봇과 공장 자동화 장비를 개발합니다. 설비투자 사이클, 신규 수주, 연구개발 비용을 확인할 수 있습니다.',.48],
 ['000015','유소윤리츠','부동산','물류 리츠','물류센터와 도심 오피스를 보유합니다. 임대율, 임대료 인상률, 차입금 만기와 조달금리가 현금흐름을 결정합니다.',0],
 ['000016','이나경항공','운송','항공사','국제 여객과 항공화물을 운송합니다. 탑승률, 항공유, 환율과 리스료·달러 부채가 실적 변수입니다.',.25],
 ['000017','이민서증권','금융','증권사','위탁매매·기업금융·자산관리를 영위합니다. 거래대금, 채권 평가손익과 부동산 금융 익스포저에 노출돼 있습니다.',.05],
 ['000018','이서영제약','헬스케어','CDMO·제약','의약품 위탁 생산과 전문의약품을 공급합니다. 공장 가동률, 허가 심사, 생산 품질과 장기 계약이 주요 변수입니다.',.65],
 ['000019','이우진홀딩스','지주','복합 지주회사','제조·서비스 자회사를 보유합니다. 자회사 배당, 순자산가치 할인율과 자본 배분 정책을 확인할 수 있습니다.',.31],
 ['000021','조우성디펜스','방산','수출 방위산업','방산 장비와 통신 시스템을 공급합니다. 수출 허가, 장기 납품 계약, 대금 회수 일정과 연구개발 비용이 반영됩니다.',.67],
 ['000022','조은솔인슈어','금융','손해보험','자동차·장기·일반보험을 운영합니다. 손해율, 금리, 보험계약 서비스마진과 투자자산의 질이 중요합니다.',.04],
 ['000023','차주해호텔리츠','부동산','호텔 리츠','도심 호텔과 복합 상업시설에 투자합니다. 객실 단가·가동률, 임차인의 지급 능력, 차입금 재조달을 확인할 수 있습니다.',0],
 ['000024','한덕규그린파워','전력','신재생 발전','태양광·풍력 발전소를 운영합니다. 발전량, 전력 판매가격, 장기 전력구매계약과 설비 유지비가 실적 변수입니다.',.14],
 ['000025','허유진로지스틱스','물류','해운·종합 물류','컨테이너 해운과 창고·내륙 운송을 운영합니다. 운임, 선복 공급, 연료비와 국제 교역량에 민감합니다.',.81],
 ['000026','문주원텔레콤','통신','통신 인프라','이동통신과 데이터 인프라를 운영합니다. 가입자당 매출, 해지율, 주파수 비용과 설비투자 규모를 확인할 수 있습니다.',.03],
 ['000027','민경서커머스','전자상거래','온라인 유통','온라인 쇼핑과 풀필먼트 서비스를 운영합니다. 총거래액뿐 아니라 판매 수수료율, 배송비, 재구매율이 수익성을 결정합니다.',.09]
] as const;
export const isEquity=(s:Stock)=>s.kind==='stock'&&s.active!==0;
export function seedStocks():Stock[]{
 const result:Stock[]=companies.map(([id,name,sector,type,description,exports])=>{
  const baseName=name.slice(0,3),p=roundPrice(12000+Math.floor(random(baseName)*780)*100),shares=1000000+Math.floor(random(id+'shares')*90)*100000;
  const revenue=Math.round(p*shares/(.7+random(id+'ps')*3)),margin=type==='연구개발 기업'?-28:5+random(id+'margin')*17,eps=Math.round(revenue*margin/100*.78/shares),bps=Math.round(p/(.65+random(id+'pbr')*2.2));
  const payout=type.includes('리츠')?Math.round(p*.055):eps>0?Math.round(eps*(.15+random(id+'payout')*.3)):0;
  return{id,name,sector,kind:'stock',initial:p,price:p,previous:p,day_open:p,high:p,low:p,volume:0,turnover:0,shares,pe:eps>0?Math.round(p/eps*100)/100:0,dividend:payout/p*100,beta:type.includes('리츠')?.65:.7+random(id+'beta')*1.1,net_flow:0,active:1,company_type:type,description,eps,bps,revenue,margin,debt_ratio:type.includes('리츠')?180:type==='은행 금융지주'?850:35+random(id+'debt')*160,export_ratio:exports,nav:0,nav_base:10000,annual_fee:0,payout};
 });
 const funds=[['000101','부석 26 ETF','index','지수 ETF',.0015],['000102','부석 인버스','inverse','인버스 ETF',.004],['000103','부석 레버리지 2X','leverage','레버리지 ETF',.006],['000104','부석 인버스 2X','inverse2','인버스 ETF',.006],['000105','부석 테크 TOP ETF','tech','섹터 ETF',.003],['000106','부석 생활소비 ETF','consumer','섹터 ETF',.0025],['000107','부석 단기채 ETF','bond','채권 ETF',.001],['000108','부석 골드 ETF','gold','원자재 ETF',.004]] as const;
 for(const[id,name,kind,type,cost]of funds)result.push({id,name,sector:kind==='bond'?'채권':kind==='gold'?'원자재':'ETF',kind,initial:10000,price:10000,previous:10000,day_open:10000,high:10000,low:10000,volume:0,turnover:0,shares:10000000,pe:0,dividend:0,beta:kind==='leverage'||kind==='inverse2'?2:kind==='bond'?.1:1,net_flow:0,active:1,company_type:type,description:kind==='bond'?'단기 국채의 이자수익과 금리 변화에 따른 가격 변동을 반영합니다.':kind==='gold'?'달러 금 가격과 원/달러 환율에 연동됩니다. 환헤지를 하지 않습니다.':kind==='tech'?'반도체·클라우드·게임·로봇 기업을 동일 비중으로 편입합니다.':kind==='consumer'?'식품·유통·통신 기업을 동일 비중으로 편입합니다.':'부석 26 지수의 일일 수익률을 지정 배수로 추종하며 매일 기준을 재설정합니다.',eps:0,bps:0,revenue:0,margin:0,debt_ratio:0,export_ratio:0,nav:10000,nav_base:10000,annual_fee:cost,payout:0});
 return result;
}
export type Macro={rate:number;fx:number;oil:number;gold:number};
export function macroAt(ts:number,previous:Macro={rate:3,fx:1340,oil:78,gold:2700},seed=''):Macro{const rng=(key:string)=>random(seed+key);const opening=ts===session(ts).open,day=String(session(ts).day),scale=Math.sqrt(marketInterval(ts)/STEP);return{rate:opening&&rng(day+'rate')>.78?Math.max(.5,Math.min(7,previous.rate+(rng(day+'rate-side')>.5?.25:-.25))):previous.rate,fx:Math.round(Math.max(950,Math.min(1900,previous.fx*(1+(rng(ts+'fx')-.5)*.003*scale)))*100)/100,oil:Math.round(Math.max(30,Math.min(160,previous.oil*(1+(rng(ts+'oil')-.5)*.008*scale)))*100)/100,gold:Math.round(Math.max(1200,Math.min(6000,previous.gold*(1+(rng(ts+'gold')-.5)*.004*scale)))*100)/100};}
export function dividendDates(stock:Stock,now:number){if(stock.kind!=='stock'||stock.payout<=0)return null;const twice=stock.company_type.includes('리츠'),slots=twice?[19*60+20,23*60+20]:[23*60+20],unit=tickSize(stock.price),dps=Math.max(unit,Math.round(stock.payout/(30*(twice?2:1))/unit)*unit);for(let day=0;day<3;day++)for(const minute of slots){const record=session(now).day+day*DAY+minute*60000;if(record<now||record<session(record).open)continue;return{record,ex:record,pay:record+20*60000,dps,frequency:twice?(session(record).special?'오늘 1회 · 평소 2회':'매일 2회'):'매일 1회'};}return null;}
export function exDividend(stock:Stock,ts:number){const dates=dividendDates(stock,ts);return dates?.ex===ts?dates.dps:0;}
export function economicCalendar(now:number,stocks:Stock[]){
 const s=session(now),eq=stocks.filter(isEquity).sort((a,b)=>marketRandom('calendar-deck-v3:'+a.id)-marketRandom('calendar-deck-v3:'+b.id)),day=Math.floor(s.day/DAY),times=s.special?[[20,10],[20,30],[21,0],[21,30],[22,0],[23,0]]:[[16,50],[17,10],[18,0],[19,0],[20,30],[22,0]];
 const types=[5,0,7,2,16,9],labels=[['업종 수요·현장 동향','고객 발주·공급망 점검','주요 사업 현장 브리핑'],['분기 실적 설명회','사업부 실적 브리핑','실적·비용 구조 설명회'],['외환·원자재 동향'],['투자 계획 설명회','사업 거점·설비 투자 브리핑','서비스·생산 인프라 점검'],['사업 전망 설명회','주요 고객·판매 계획 브리핑','다음 분기 경영 전망'],['경영 현안 공시','주주·사업 운영 설명회','이사회 주요 안건 브리핑']];
 let company=0;return times.map(([h,m],i)=>{const market=i===2,stock=market?null:eq[((day*5+company++)%eq.length+eq.length)%eq.length],ts=s.day+h*3600000+m*60000,title=labels[i][Math.floor(marketRandom('calendar-title:'+day+':'+i)*labels[i].length)];return{ts,title,newsType:types[i],stock_id:stock?.id||null,organization:market?'외환시장·원자재시장 데스크':stock?.name||'기업 데스크',completed:ts<=now};});
}
