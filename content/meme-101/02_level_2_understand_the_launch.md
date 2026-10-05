# MEME 101 — Level 2: Understand the Launch

## Goal
Understand how a meme token moves from creation into active trading and why launch mechanics affect early risk.

---

## Technical Token Lifecycle (Token LC)

Token LC describes the launch mechanism and the technical milestones a token has reached. For a curve-based launch, a possible path is **Created → Trading / Bonding → Final Stretch → Migrating → Migrated / Graduated → Post-Migration Activity**. Launchpads differ; some tokens start directly in a DEX pool and never follow this path.

### The full technical path

[[TOKEN_LC_DIAGRAM]]

Read the arrows as a possible mechanism path, not a promise that the next stage will occur. A curve launch can stall before completion. A direct-to-DEX launch skips bonding, Final Stretch, and migration. Some platforms distinguish graduation eligibility from completed migration; check their definitions.

### Stage-by-stage mechanism and price behavior

The price paths below explain possible responses and their causes. They are not measured probabilities or a prediction of the next move.

| LC stage | Mechanism and confirmation | Possible price behavior and why | Inventory and trader checks |
| --- | --- | --- | --- |
| Created | Token exists onchain; trading may not be enabled. Check the exact contract, supply, permissions, and creation transaction. A pool's creation time is not necessarily token creation time. | There may be no executable market price yet. An allocation or displayed valuation is not an available trading quote. | Identify creator allocations, reserved supply, and pool or curve balances. System balances are not automatically dev inventory. |
| Trading / Bonding | Trades execute through the launch mechanism. Verify actual trades and the platform's curve progress. Progress is toward a launch threshold, not a holder percentage. | Buying can move the curve price rapidly; sales can reverse the move. Thin depth and concentrated cheap inventory can amplify both directions. | Check early bundled purchases, current related-wallet holdings, buys versus sales, and executable quotes. Fees can begin here when the platform charges them. |
| Final Stretch | Approaching the platform's completion requirement. Meme Fast uses measured progress of 80% or more without confirmed completion; this is a product rule, not a universal threshold. | Anticipation can attract buyers. Early holders may sell into that demand; the launch can stall or fall back instead of completing. | Check remaining requirements, fresh progress, and actual inventory reductions. A near-completion label does not prove migration has started. |
| Migrating | Trading or liquidity transitions to the destination venue. Confirm platform status and the migration transaction rather than inferring it from progress. | Route changes, temporary trading restrictions, and changing liquidity can disrupt quotes. Prices across different venues may not be directly comparable. | Verify transaction completion, destination pool, trading availability, and any fees or restrictions. Do not assume there is always a tradable interval during migration. |
| Migrated / Graduated | The relevant launch transition has completed. Where the platform distinguishes these events, record them separately. Verify the destination pool and usable trading route. | New participation can drive a pump; early-holder sales can produce a dump or sell-the-news reversal. Completion itself does not create durable demand. | Compare seeded liquidity, current depth, remaining early inventory, and actual sales against incoming buying. |
| Post-Migration Trading | Trading is observed in the destination market. Verify recent swaps and liquidity; an old migration event does not establish current activity. | Continued demand can sustain expansion. Weaker demand can lead to fading or a base; renewed demand can produce recovery. A token can also lose liquidity and stop trading actively. | Follow buyer participation, liquidity changes, ownership, and distribution across time. A base or recovery is price behavior, not another graduation. |

### Fees and the Pay Dev signal

**Fees Generated** and **Pay Dev** belong alongside the mechanism path as events, not compulsory steps that every token completes in order. Depending on the platform, fee generation, accrual, eligibility, and an actual creator payout can be different events.

| Event or signal | When it can appear | What it establishes and what to verify |
| --- | --- | --- |
| Fees Generated | Once fee-bearing trading occurs, potentially during bonding or after migration. | Verify the fee rule, amount, recipient allocation, and transactions. Volume alone does not establish creator earnings or a payout. |
| Pay Dev / creator-payment signal | When the platform's trigger is met or first reported. It may appear some time after launch; do not assign it a fixed hour or mandatory LC stage. | Preserve the exact platform label. Check whether it means accrued fees, a claim, a payout, or something else; verify the recipient, amount, and transaction where available. The specific Axiom/Pump/Padre signal definition is not verified in this lesson. |
| DEX Paid | When a profile-payment signal is reported, potentially at different LC stages. | This is separate from a creator-payment signal. It does not establish creator inventory, bundled supply, or selling. |

For a payment signal, ask **what was paid, to whom, when, and under which platform rule?** Record its event time separately from the time you first saw the badge. Missing evidence remains unknown. A payment badge alone does not prove the creator sold tokens or that price will rise.

### Technical progress, price, and attention

**Technical:** what has the token completed? **Price:** what is the market doing? **Attention:** where is interest going? These observations can diverge. A token can graduate while price falls, or attract attention while early holders sell. Completing a technical milestone does not confirm a bullish move. Keep price expansion, exhaustion, fading, bases, and recovery separate from the technical stages.

### Bundling alongside the launch
A coordinated group can acquire early supply across several wallets. Transaction bundles can execute transactions together; grouping wallets into a suspected ownership cluster requires additional evidence. Neither tells us automatically that the creator owns every wallet.

One possible sequence is **Launch → coordinated early buying → other buyers enter → bundled wallets sell into demand**. The group may instead hold, sell gradually, or transfer inventory. Distribution is observed behavior, not a required lifecycle stage.

For an illustrative token, **75% bundled supply** might mean a detected group acquired or still holds 75% of the supply denominator used by the tool. Check whether the number describes launch purchases or current remaining holdings. It does not establish that the visible dev wallet holds 75%, that the group belongs to the dev, or that selling has begun. A bonding-curve or pool balance is also not automatically creator inventory.

Compare the original allocation, current related-wallet balances, actual sales, transfers, and pool depth. **Bonding 75%, bundled supply 75%, and dev holdings 75% describe different measurements.** DEX Paid is a separate profile-payment signal and does not establish any of these percentages.

### Worked example: migration completes while price falls

This is an illustrative token, not a live report or a typical return forecast. All times refer to the same hypothetical session. Market cap is an estimate and is not available exit liquidity.

| Time | Technical event or observation | Price / market-cap observation | Inventory and interpretation |
| --- | --- | --- | --- |
| 10:00 | Trading on the curve begins. | Estimated MC $20K. | A tool reports 75% initially bundled purchases. Verify its denominator and wallet evidence; this is not 75% in the dev wallet. |
| 10:15 | Bonding reaches 75%. | Estimated MC $45K. | Progress and bundled supply are different measurements. Trace holdings and sales before saying the group is distributing. |
| 10:30 | Bonding reaches 92%: Final Stretch under Meme Fast's rule. | Estimated MC $70K; attention is rising. | Anticipation may attract buyers, while early inventory can still be sold into them. |
| 10:40 | Migration is observed underway. | Quotes may be interrupted or differ by venue. | Check the destination and completion; do not fill missing prices with assumed values. |
| 10:41 | Migration completes; destination trading is verified. | Estimated MC at migration $84K. | Technical completion is confirmed. Price continuation is still an open question. |
| 10:42 (+1m) | Post-migration swaps continue. | Estimated MC $91K. | A brief rise does not establish lasting demand or broad participation. |
| 10:46 (+5m) | The token remains migrated. | Estimated MC $73K. | Observed early-wallet sales and weaker buying can explain a decline if supported by transaction evidence. The price drop alone does not prove dev selling. |
| 10:56 (+15m) | Destination trading continues. | Estimated MC $112K. | Renewed buying can support recovery. Check liquidity and remaining inventory; the earlier decline did not undo migration. |

A Pay Dev badge, if observed at any of these times, would be a separate entry with its platform definition and evidence. This example does not invent a payout or its timing.

### Price paths around a technical event

- **Migration → pump:** incoming demand exceeds selling in the available liquidity.
- **Migration → dump:** selling exceeds buying; technical completion can coincide with sell-the-news behavior.
- **Migration → pump → dump:** initial buying lifts price, then distribution or fading demand reverses it.
- **Migration → dump → recovery:** initial selling is followed by renewed buying; investigate what changed.

These are possible observations, not guaranteed sequences or frequency claims. Compare before and after using the same contract, known pool coverage, timestamps, and consistent metrics. Record actual event time when available; otherwise label the first observation time. Price, estimated MC, volume, and liquidity at the event and +1 / +5 / +15 / +60 minutes are useful research checkpoints, not proof that the event caused the move. Missing samples stay unknown.

### Check your understanding

- **Bonding 75% and bundled supply 75%: same thing?** No. One measures launch progress; the other measures purchases or holdings under a tool's definition.
- **Migrated, attention rising, price falling: contradiction?** No. Technical completion, attention, and price can move independently.
- **Pay Dev badge or reduced wallet balance: proof of dev selling?** No. Verify the payment meaning and actual sales; transfers and fee payouts are separate observations.

### Evidence and coverage
Keep milestones, inventory, and price observations separate. Unknown evidence means unknown, not incomplete. A collector's first observation time can differ from the actual onchain event time. Meme Fast currently shows available launch progress and graduation coverage; these lessons do not imply that it detects every bundle, creator relationship, payment, or migration event.

---

## 1. Bonding Curve

### What is it?
A bonding curve is a launch mechanism where token price changes according to buying and selling activity before the token reaches a normal liquidity pool.

### Why does it matter?
Early buyers may enter much cheaper than later traders.

### What should I check?
- How far along the curve the token is
- How much buying is needed before graduation
- Whether early buyers already control large supply
- Whether momentum is accelerating or fading

### Beginner mistake
Assuming every bonding-curve token will graduate.

### Takeaway
**Early launch price is shaped by the curve, not by a mature market.**

---

## 2. Graduation

### What is it?
Graduation is the transition from the launch mechanism into a DEX liquidity pool.

### Why does it matter?
Graduation changes how the token trades and often brings a new wave of attention, bots, and liquidity.

### What should I check?
- Where liquidity is created
- How much liquidity is seeded
- Who controls the LP tokens
- Whether early holders sell into graduation

### Beginner mistake
Treating graduation as guaranteed continuation.

### Takeaway
**Graduation is a transition point, not a promise of higher price.**

---

## 3. DEX

### What is it?
A decentralized exchange is where traders swap tokens directly through liquidity pools.

### Why does it matter?
Different chains and DEXs have different liquidity, bots, routing, fees, and trading behavior.

### What should I check?
- Which DEX hosts the main pool
- Whether there are multiple pools
- Pool liquidity
- Trading fees
- Routing quality

### Beginner mistake
Buying from a small secondary pool instead of the main pool.

### Takeaway
**Know where the real liquidity is.**

---

## 4. Snipers

### What is it?
Snipers are wallets or bots that enter extremely early around launch.

### Why does it matter?
They can acquire very cheap inventory and later sell into retail demand.

### What should I check?
- Entry time
- Entry price
- Current holdings
- Amount already sold
- Whether sniper wallets are related

### Beginner mistake
Looking only at what a sniper still holds.

### Takeaway
**Early cost basis matters as much as current holdings.**

---

## 5. Fresh Wallets

### What is it?
Fresh wallets are newly created or newly funded wallets with little prior transaction history.

### Why does it matter?
Clusters of fresh wallets can indicate coordinated launch participation or attempts to hide ownership.

### What should I check?
- Funding source
- Timing of funding
- Similar trade size
- Similar entry time
- Transfers between wallets

### Beginner mistake
Assuming every fresh wallet is a new independent trader.

### Takeaway
**Fresh wallets are clues, not proof. Follow their funding.**

---

## 6. Slippage

### What is it?
Slippage is the difference between the expected trade price and the actual execution price.

### Why does it matter?
Thin meme markets can move quickly while your transaction is executing.

### What should I check?
- Slippage setting
- Current volatility
- Liquidity
- Trade size
- Whether the token has unusual transfer taxes or restrictions

### Beginner mistake
Setting extremely high slippage without understanding the cost.

### Takeaway
**More slippage can improve execution but can also produce a much worse fill.**

---

## 7. Spread

### What is it?
Spread is the practical difference between what buyers pay and what sellers receive.

### Why does it matter?
In thin markets, you may lose money immediately simply by entering and exiting.

### What should I check?
- Pool depth
- Price impact
- Fees
- Difference between quoted buy and sell value

### Beginner mistake
Treating the chart price as the price you can actually trade.

### Takeaway
**Displayed price and executable price can be very different.**

---

## 8. MEV / Sandwiching

### What is it?
MEV refers to transaction-ordering strategies used by bots. A sandwich attack places transactions around yours to profit from your price impact.

### Why does it matter?
Large or high-slippage trades can become attractive targets.

### What should I check?
- Slippage
- Transaction protection offered by the platform
- Trade size
- Chain conditions

### Beginner mistake
Assuming every bad execution is random slippage.

### Takeaway
**Your transaction can be part of someone else's trading strategy.**

---

## Level 2 Checklist

Before trading a newly launched token, know:

1. Is it still on a bonding curve?
2. Has it graduated?
3. Where is the main liquidity pool?
4. Who entered extremely early?
5. Are fresh wallets clustered?
6. What slippage and price impact are you accepting?
7. Is the launch already dominated by bots or snipers?
