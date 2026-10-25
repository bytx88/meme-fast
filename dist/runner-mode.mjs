import {esc,when} from './market-format.mjs';
import {RUNNER_CONFIG} from './runner-policy.mjs';

const {policy:POLICY,scores:SCORES}=RUNNER_CONFIG;
const QUOTE_MAX_AGE=RUNNER_CONFIG.sampling.quoteMaxAgeMinutes*60000;
const modeLabels=Object.fromEntries(Object.entries(SCORES).map(([label,score])=>[score,label]));

function comparableHistory(history){
 if(history?.usable!==true)return false;
 if(history.provisional===true){
  return history.periodHours===1&&history.comparablePeriods===POLICY.provisionalBaselinePeriods+1&&
   history.baselinePeriods===POLICY.provisionalBaselinePeriods&&history.matchedTokens>=POLICY.minimumPopulation;
 }
 return history.comparablePeriods>=POLICY.baselinePeriods+1&&history.baselinePeriods>=POLICY.baselinePeriods;
}

export function runnerMode(report,now=Date.now()){
 const score=report?.score;
 const supported=report?.policy?.version===POLICY.version;
 const covered=report?.coverage?.reliable===true&&report?.coverage?.reservedPass===true;
 const age=now-report?.updatedAt;
 const fresh=Number.isFinite(report?.updatedAt)&&age>=0&&age<=QUOTE_MAX_AGE;
 return report?.ready===true&&supported&&covered&&comparableHistory(report.history)&&fresh&&
  Number.isInteger(score)&&Object.values(SCORES).includes(score)?String(score):'—';
}

export const formatMode=mode=>modeLabels[mode]?`${mode} (${modeLabels[mode]})`:mode;

export function runnerDetails(report,failed=false){
 const mode=failed?'—':runnerMode(report);
 const counts=report?.counts24h;
 const rows=RUNNER_CONFIG.levels.map(level=>[level,level>=1000000?`$${level/1000000}M`:`$${level/1000}K`]);
 const periods=Number.isInteger(report?.history?.comparablePeriods)?report.history.comparablePeriods:0;
 const hours=POLICY.periodHours.includes(report?.history?.periodHours)?`${report.history.periodHours}H`:'equal-length';
 return `<section class="market-runner-mode" aria-label="Solana runner mode"><h3>Solana Mode <strong>${formatMode(mode)}</strong></h3>
 <p>${esc(failed?'Runner data unavailable':report?.reason||'Awaiting reliable Solana runner history')}</p>
 <div class="market-runner-counts">${rows.map(([key,label])=>`<span>${label}<b>${Number.isInteger(counts?.[key])&&counts[key]>=0?counts[key].toLocaleString():'—'}</b></span>`).join('')}</div>
 <p>Observed runners · rolling 24H · partial sample</p>
 <p>${report?.history?.provisional?'Provisional · ':''}${periods} comparable covered ${hours} periods · ${report?.coverage?.observedTokens??report?.coverage?.valuedTokens??0}/${report?.coverage?.eligibleTokens??0} tracked tokens freshly observed · ${report?.coverage?.valuedTokens??0} valued · ${report?.coverage?.nonqualifyingTokens??0} independently observed with zero 24H volume</p>
 <p>Tracked sample, not a market-wide census. ${report?.coverage?.gaps?`Coverage gaps: ${Object.entries(report.coverage.gaps).map(([key,value])=>`${esc(key)} ${Number(value)||0}`).join(', ')||'none'}.`: ''}</p><p class="market-timestamp">Runner update ${esc(when(report?.updatedAt))}</p>${runnerMethod()}</section>`;
}
function runnerMethod(){
 return `<details><summary>Mode method and coverage</summary><p>${Object.values(SCORES).map(score=>formatMode(String(score))).join(' · ')}. A dash means the evidence is insufficient. Mode follows a bounded rolling sample of observable Solana markets, admitted independently of future gains. It counts unique tracked tokens reaching $500K, $1M, $5M and $10M market cap. Initial above-threshold tokens and repeat reclaims are excluded. Two distinct quotes within 15 minutes must confirm attainment, with at least $3K liquidity and positive 24H volume. Up to 300 markets are tracked. Every admitted token stays in the denominator for 72 hours, including fallen or missing markets. Quote sampling runs independently every five minutes through the shared source; missing follow-up remains unknown.</p>
 <p>Initial provisional Mode compares the oldest covered hour with the latest complete hour, using at least 50 of the same tokens observed in at least 90% of slots in both hours and covering at least 95% of each hourly sample. In-between gaps are not treated as observed. Rising provisional evidence gives 4, falling gives 2, stable gives 3, and a fully covered absence gives 1; 5 needs fuller baseline history. With at least three comparable periods, automatically compare adjacent 24H, 6H or 1H periods, with two earlier periods for a baseline. Each period needs at least 50 tracked markets, 90% reliable collection slots, 95% fresh runner-observation coverage of the entire cohort per slot, and comparable sample sizes. A fully covered absence of sustained runners is 1 (Hard); sparse positive evidence is withheld. Discovery freshness is shown separately; complete cohort quotes do not certify market-wide discovery. At least three supported thresholds must agree. High/low uses the available baseline median; rising/falling needs a change of at least 20%. Sufficient, broadly stable evidence gives 3. Conflicting or insufficient evidence stays —. There is no fixed calendar waiting rule.</p>
 <p>These are sampled first observed crossings, not all Solana memes or first lifetime crossings. Saved event and coverage records are reused; price-only snapshots and untimed market caps cannot supply missing crossings. Missing market caps are not replaced with FDV. For missing Dex quotes, the shared GeckoTerminal source checks exact-mint aggregate activity. Fresh zero aggregate 24H volume proves the token cannot meet the existing runner rule at that observation. Such tokens remain tracked, with unknown caps, separate activity observations and no crossing events. Missing, stale or malformed activity still leaves a coverage gap. Counts can miss moves between observations. Mode is descriptive and has no validated predictive trading performance.</p></details>`;
}
