# MEME 101 — Level 2: Understand the Launch

## Goal
Understand how a meme token moves from creation into active trading and why launch mechanics affect early risk.

---

## Technical Token Lifecycle (Token LC)

Token LC describes the launch mechanism and the technical milestones a token has reached. For a curve-based launch, a possible path is **Created → Trading / Bonding → Final Stretch → Migrating → Migrated / Graduated → Post-Migration Activity**. Launchpads differ; some tokens start directly in a DEX pool and never follow this path.

### Shared launch vocabulary
- **Created:** the token exists onchain. Token creation and pool creation can happen at different times.
- **Trading / Bonding:** trades occur through the launch mechanism. Bonding progress measures progress toward that platform's completion threshold; it is not a wallet's share of supply.
- **Final Stretch:** approaching completion. Meme Fast uses measured progress of 80% or more without confirmed completion; this is a product threshold, not a universal launchpad rule.
- **Migrating:** the transition is underway, where supported by evidence. High bonding progress alone does not establish that migration has started.
- **Migrated / Graduated:** the launch transition has completed, where the platform links these terms. Verify the destination pool and trading route.
- **Post-Migration Activity:** trading observed after the transition. Activity does not guarantee continuing demand.

**Technical progress, price behavior, and attention answer different questions.** A token can graduate while price falls, or attract attention while early holders sell. Completing a technical milestone does not confirm a bullish move.

### Bundling alongside the launch
A coordinated group can acquire early supply across several wallets. Transaction bundles can execute transactions together; grouping wallets into a suspected ownership cluster requires additional evidence. Neither tells us automatically that the creator owns every wallet.

One possible sequence is **Launch → coordinated early buying → other buyers enter → bundled wallets sell into demand**. The group may instead hold, sell gradually, or transfer inventory. Distribution is observed behavior, not a required lifecycle stage.

For an illustrative token, **75% bundled supply** might mean a detected group acquired or still holds 75% of the supply denominator used by the tool. Check whether the number describes launch purchases or current remaining holdings. It does not establish that the visible dev wallet holds 75%, that the group belongs to the dev, or that selling has begun. A bonding-curve or pool balance is also not automatically creator inventory.

Compare the original allocation, current related-wallet balances, actual sales, transfers, and pool depth. **Bonding 75%, bundled supply 75%, and dev holdings 75% describe different measurements.** DEX Paid is a separate profile-payment signal and does not establish any of these percentages.

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
