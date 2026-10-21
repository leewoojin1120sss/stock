import type {Stock,Macro} from './market-data.ts';

// Sector assumptions, not target prices. Financial years run over 30 market days,
// matching the existing accelerated dividend calendar. No share issuance implied.
const DAY=86_400_000;
export const FINANCIAL_YEAR_DAYS=30;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const round=(n:number,d=2)=>Math.round(n*10**d)/10**d;
// PS, operating margin, PBR, liabilities/equity %, interest-bearing fraction,
// payout fraction, imported-input exposure, oil-cost exposure, investment intensity.
const profiles:Record<string,number[]>={
 '000001':[3.5,19,2.8,55,.35,.18,.12,.02,.08],
 '000002':[6,-28,2.4,45,.35,0,.18,.01,.04],
 '000003':[1.2,27,.7,850,.03,.32,.02,0,.02],
 '000004':[.55,7,.85,125,.55,.3,.65,-.04,.06],
 '000005':[1.8,15,1.8,65,.35,.2,.08,.01,.06],
 '000006':[.45,4.5,.9,110,.45,.35,.28,.03,.035],
 '000007':[.65,9.5,1,105,.5,.3,.35,.02,.075],
 '000008':[2.6,22,1.6,85,.6,.22,.32,.025,.16],
 '000009':[3,23,2.4,45,.3,.12,.12,.015,.07],
 '000010':[2.8,24,2.3,35,.25,.18,.08,.005,.045],
 '000011':[1.8,8,1.5,130,.65,.12,.55,.05,.13],
 '000012':[1.1,8,1.4,175,.45,.16,.35,.04,.07],
 '000013':[.9,8,1.3,75,.4,.32,.45,.04,.04],
 '000014':[3.5,7,2.7,65,.4,.05,.3,.02,.09],
 '000015':[4.6,62,.95,140,.9,.8,.01,.005,.12],
 '000016':[.55,9,.9,240,.7,.2,.5,.32,.09],
 '000017':[1.1,19,.8,500,.06,.35,.03,0,.025],
 '000018':[3.5,24,2.5,80,.5,.23,.35,.015,.11],
 '000019':[1,14,.65,100,.45,.35,.2,.02,.04],
 '000021':[2.4,14,2.1,115,.4,.18,.25,.02,.085],
 '000022':[.8,12,.75,700,.025,.35,.02,0,.015],
 '000023':[3.6,46,.9,155,.9,.75,.03,.015,.1],
 '000024':[2.4,26,1.3,165,.8,.3,.15,.01,.18],
 '000025':[.85,12,1.05,120,.6,.28,.25,.22,.08],
 '000026':[1.2,16,1.1,110,.6,.45,.16,.025,.12],
 '000027':[.7,4,1.6,100,.4,0,.2,.08,.05],
};
export function financeProfile(s:Stock){const p=profiles[s.id]||[1.5,12,1.2,90,.5,.25,.2,.03,.07];return{ps:p[0],margin:p[1],pbr:p[2],debt:p[3],interestShare:p[4],payout:p[5],imports:p[6],oil:p[7],investment:p[8],financial:s.sector==='금융'};}
export function financialMetrics(s:Stock,rate=3){
 const p=financeProfile(s),equity=s.bps*s.shares,liabilities=equity*s.debt_ratio/100;
 const interestDebt=liabilities*p.interestShare,spread=1.1+clamp(s.debt_ratio/p.debt-1,-.5,2)*1.2;
 const interest=interestDebt*Math.max(.005,(rate+spread)/100),operating=s.revenue*s.margin/100;
 // Financial-company operating earnings already include deposit/insurance funding
 // costs. Only corporate interest-bearing debt is charged here, not all deposits.
 const pretax=operating-interest,net=pretax>0?pretax*.78:pretax;
 return{equity,liabilities,assets:equity+liabilities,interestDebt,interest,operating,net,eps:Math.round(net/s.shares),coverage:interest>0?operating/interest:null};
}
export function calibrateFundamentals(s:Stock,rate=3):Stock{
 if(s.kind!=='stock')return s;
 const p=financeProfile(s),blend=(old:number,target:number)=>old*.8+target*.2;
 const n={...s,revenue:Math.round(blend(s.revenue,s.initial*s.shares/p.ps)),margin:round(blend(s.margin,p.margin)),bps:round(blend(s.bps,s.initial/p.pbr)),debt_ratio:round(blend(s.debt_ratio,p.debt))};
 // Banking/insurance liabilities and rental revenue have different accounting
 // scales. Correct those structural exceptions more than the ordinary 20% blend.
 if(p.financial)n.debt_ratio=p.debt;
 if(s.company_type.includes('리츠')){n.margin=p.margin;n.revenue=Math.round(s.initial*s.shares/p.ps);}
 n.eps=financialMetrics(n,rate).eps;n.payout=Math.max(0,Math.round(n.eps*p.payout));
 return{...n,pe:n.eps>0?round(n.price/n.eps):0,dividend:n.payout/n.price*100};
}
export function earningsUpdate(s:Stock,ts:number,macro:Macro,noise:number,newsSignal=0){
 const p=financeProfile(s),elapsed=s.financial_at?Math.max(0,(ts-s.financial_at)/DAY):1;
 // At most one new financial statement per company/day. Other articles reuse it.
 if(elapsed<1)return null;
 const weight=Math.min(1,elapsed/7.5),fx=macro.fx/(s.financial_fx||1340)-1,oil=macro.oil/(s.financial_oil||78)-1;
 const sales=clamp(noise*.12+newsSignal*.7+fx*s.export_ratio*.28,-.12,.12)*weight;
 const revenue=Math.max(1,Math.round(s.revenue*(1+sales)));
 const margin=round(clamp(s.margin+(p.margin-s.margin)*.08*weight+sales*22+(fx*(s.export_ratio*.3-p.imports*.45)-oil*p.oil)*100*weight,-45,70));
 const export_ratio=round(clamp(s.export_ratio+(s.export_ratio>0?noise*.008*weight:0),0,.98),5);
 const next={...s,revenue,margin,export_ratio};
 return{revenue,margin,export_ratio,eps:financialMetrics(next,macro.rate).eps,financial_at:ts,financial_fx:macro.fx,financial_oil:macro.oil,financial_rate:macro.rate};
}
export function accrueBalance(s:Stock,auctions:number,dividend:number){
 const p=financeProfile(s),fraction=1/(FINANCIAL_YEAR_DAYS*auctions),income=s.eps*s.shares*fraction;
 const equityBefore=s.bps*s.shares,liabilitiesBefore=equityBefore*s.debt_ratio/100;
 const distributions=dividend*s.shares,equity=Math.max(s.shares,equityBefore+income-distributions);
 // Depreciation is already in operating profit. Cash retained after maintenance
 // and growth investment can repay debt; deficits require additional borrowing.
 const depreciation=s.revenue*p.investment*.65*fraction,capex=s.revenue*p.investment*fraction;
 const freeCash=income+depreciation-capex-distributions;
 const debtChange=freeCash<0?-freeCash:-(Math.min(freeCash*.25,liabilitiesBefore*p.interestShare));
 const liabilities=Math.max(0,liabilitiesBefore+debtChange);
 return{bps:equity/s.shares,debt_ratio:liabilities/equity*100};
}
export function nextPayout(s:Stock){
 const p=financeProfile(s),target=Math.max(0,s.eps)*p.payout;
 const stressed=s.debt_ratio>p.debt*1.8;
 return Math.max(0,Math.round(s.payout*.8+target*(stressed?.5:1)*.2));
}
export function fundamentalSignal(s:Stock){
 const p=financeProfile(s),roe=s.eps/Math.max(1,s.bps),yieldRate=s.eps/Math.max(1,s.price);
 // Valuation is a weak, bounded influence conditional on earnings and leverage.
 // Cheap loss-makers get no automatic bargain signal; no target-price guarantee.
 const quality=Math.tanh((roe-.08)*4)*.0007;
 const valuation=s.eps>0?Math.tanh((yieldRate-.045)*12)*.0006:0;
 const debtStress=Math.tanh(Math.max(0,s.debt_ratio/p.debt-1.2))*.0008;
 return quality+valuation-debtStress;
}
export function rateSensitivity(s:Stock){const p=financeProfile(s);return p.financial?.0015-.001*Math.max(0,s.debt_ratio/p.debt-1):-.0025-.0035*clamp(s.debt_ratio*p.interestShare/100,0,4);}
