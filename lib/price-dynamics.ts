// Symmetric log-price noise: uncertainty remains, while company information can
// outweigh the common market lottery. No price floor, target index or rebound rule.
export const PRICE_MODEL_VERSION='balanced-v2';
export const PRICE_NOISE={market:.0028,sector:.008,company:.015,jumpProbability:.015,jumpSize:.045} as const;
export type PriceFactors={market:number;sector:number;company:number;jumps:number;orders:number;news:number;macro:number;cycle:number;fundamentals:number;dividend:number};
export type TickAttribution={before:number;after:number;factors:PriceFactors;other:number};
export function newAttribution():TickAttribution{return{before:0,after:0,factors:{market:0,sector:0,company:0,jumps:0,orders:0,news:0,macro:0,cycle:0,fundamentals:0,dividend:0},other:0};}
export function addAttribution(out:TickAttribution,initial:number,before:number,after:number,reference:number,dividend:number,parts:PriceFactors,count:number){
 const unit=1000/(count*initial),log=Object.values(parts).reduce((a,b)=>a+b,0);
 // Allocate the exact theoretical exponential move, not its first-order estimate.
 // The remaining difference includes price ticks, daily limits and ex-date rounding.
 const slope=reference*(Math.abs(log)<1e-12?1:Math.expm1(log)/log)*unit;
 out.before+=before*unit;out.after+=after*unit;
 for(const key of Object.keys(parts) as (keyof PriceFactors)[])out.factors[key]+=parts[key]*slope;
 out.factors.dividend-=dividend*unit;
 out.other=out.after-out.before-Object.values(out.factors).reduce((a,b)=>a+b,0);
}
