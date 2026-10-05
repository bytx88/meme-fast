## Goal
Learn to reconstruct early inventory, distinguish transfers from sales, estimate remaining pressure, and test whether demand continues without the original group.

## What bundling means

A transaction bundle groups transactions for ordered execution under a submission mechanism. A wallet-analysis tool may also use “bundled” for detected coordinated launch purchases. These labels are not interchangeable with verified common ownership. Read the provider's definition before interpreting its percentage.

A coordinated operator can split purchases across many wallets. That makes the holder list look broader while the underlying inventory remains concentrated. Similar timing or shared exchange funding alone is weak evidence: unrelated buyers can use the same service or trading bot.

The useful question is not just “was it bundled?” It is **how much early inventory is still controlled, what happened to it, and what demand can meet its sales?**

## How to investigate the wallet group

1. Start with the exact chain, contract, launch transaction, and reported bundle transaction IDs. Record the provider, definition, supply denominator, and observation time.
2. Open those transactions in the chain explorer. Identify receiving owner addresses rather than confusing token accounts, routers, pool contracts, or fee collectors with individual owners.
3. Trace funding and direct token transfers. Record each supported link and why it matters. One repeated funding source plus direct transfers and coordinated behavior is stronger than timestamps alone; it still may not establish legal identity.
4. Classify activity as purchase, executed sale, internal transfer, outside transfer, or unresolved. A wallet balance decreasing is not automatically a sale.
5. Reconcile opening and closing balances. If an unexplained difference remains, do not manufacture a trade to make the ledger balance. Investigate missing transactions, other pools, fees, burns, or incomplete address coverage.

Keep a separate list of suspected addresses and stronger supported links. Report “suspected group” when attribution is incomplete. Avoid adding every early buyer to the creator's position.

## Worked inventory ledger: 75% initially bundled

**ILLUSTRATIVE · NOT A LIVE TOKEN.** Assume 100 million units of measured supply. A tool identifies A, B, and C as a supported early group buying 75 million units. Initial purchased share is 75m / 100m = **75%**. This example assumes that denominator stays constant; a real calculation must revisit minting, burns, and provider definitions.

| Address | Initial units | Later purchases | Executed sales | Transfers | Closing units |
| --- | --- | --- | --- | --- | --- |
| A | 30m | 0 | 10m | Sends 8m to supported linked D | 12m |
| B | 25m | 0 | 5m | None | 20m |
| C | 20m | 0 | 0 | Sends 4m to an unverified outside address | 16m |
| D | 0 | 0 | 0 | Receives 8m from A | 8m |
| Supported group total | 75m | 0 | 15m | 4m leaves the supported group; 8m stays inside it | 56m |

The reconciliation is **75m − 15m sales − 4m outside transfer = 56m supported inventory**. A's 8m transfer to D cancels inside the group. If the outside 4m is later shown to remain under related control, attributed inventory becomes 60m, subject to subsequent activity.

The initial 75% bundled purchase figure stays a historical measurement. Current supported group holdings are **56%**, or potentially **60%** if that outside address is connected. Neither number establishes that one visible dev wallet owns that amount.

A wrong shortcut would subtract all transfers as sales and announce only 48m remaining. That confuses a change of address with a change of economic control.

## What did they pay, and what can they still sell?

Cost basis needs quantities and actual spend, not the current marked value. In this example, assume verified initial spend of $3,000 for 75m units, with fees already included and no later purchases. Average acquisition cost is **$0.00004 per unit**. If 15m units are sold for $4,000 net, a proportional allocation assigns $600 of original cost to that sale, so realized profit is $3,400 under that stated accounting convention.

That profit is not the profit of every individual wallet, and it excludes the remaining inventory's result. Transfers complicate address-level cost basis; a transferred-in holding did not necessarily cost the receiver zero. Missing earlier history makes complete cost basis unknown.

Suppose price now marks 56m remaining units at $0.001: their displayed value is $56,000. That is a marginal-price valuation, not $56,000 that the pool can pay out. The group may already have recovered its initial spend while retaining substantial inventory. It can therefore have very different exit incentives from a later buyer.

## Exit capacity: work through the pool, not just market cap

For a simplified constant-product pool, assume reserves of 20m tokens and $20,000, giving a marginal token price of $0.001. Ignore fees and other venues for this illustration. Selling q tokens returns **quote reserve × q / (token reserve + q)**.

| Token sale | Value at starting marginal price | Approximate pool proceeds | Average execution price |
| --- | --- | --- | --- |
| 1m | $1,000 | $952.38 | $0.00095238 |
| 10m | $10,000 | $6,666.67 | $0.00066667 |
| 56m | $56,000 | $14,736.84 | $0.00026316 |

These outputs assume no intervening buys or reserve changes. Real pools, concentrated liquidity, fees, routes, and multiple venues differ. The example shows why remaining inventory cannot simply be multiplied by the chart price to predict proceeds.

Record both reserves; a provider's total liquidity figure may value both sides and is not all available quote currency. Use current executable quotes for several sizes and check quote age. A high liquidity-to-position ratio is context, not a guaranteed exit; withdrawal or simultaneous selling can change it.

## How to tell holding, transfers, support, and selling apart

| Observation | What it supports | What it does not establish |
| --- | --- | --- |
| Units unchanged across known group addresses | Inventory retained during the covered interval | Conviction, absence of hidden addresses, or future holding |
| Units move A → D without a swap | A transfer; potentially unchanged group inventory | A sale or independent new demand |
| Group executes purchases around price declines | Observed buying that may support price | Why it bought, whether it will keep buying, or independent demand |
| Actual swaps reduce group token quantity | Inventory sales during the stated window | Malicious intent or an inevitable price collapse |
| Holder count rises through transfers | More addresses hold units | More independent buyers or wider economic ownership |

To describe distribution, show quantities sold, time window, remaining supported inventory, and receiving demand. To describe “support,” show purchases and price response, while keeping intent provisional.

## Test whether demand survives the original group's buying

Use equal, non-overlapping windows and the same pool coverage. Here is a deliberately simplified comparison where identities are independently supported. “Other buyers” does not mean all of them are proven unrelated.

| Window | Group buy value | Other buy value | Total sell value | Price response | Interpretation |
| --- | --- | --- | --- | --- | --- |
| A: first 5 minutes | $8k | $2k | $3k | Strong rise | Most buying depends on the group |
| B: next 5 minutes | $1k | $7k | $5k | Range holds | Other buying has grown while group buying declined |
| C1: possible next window | $0 | $8k | $6k | Range holds with comparable depth | Evidence of continuing demand without group buys |
| C2: alternative next window | $0 | $1k | $6k | Price falls, depth weakens | Buying appears dependent on the earlier support |

C1 and C2 are alternative cases, not simultaneous outcomes. One supportive window is preliminary evidence. Repeat the comparison, check trade concentration and wallet coverage, and account for liquidity changes. Trade count can include repeated buyers or routing; transaction senders can be routers. Do not rename all non-group trades “organic” without evidence.

A group can sell while new buyers absorb its inventory. Conversely, a group can stop buying without selling and price can still fall because other demand disappears. Ownership, sales, and price are separate observations.

## Connect the inventory to Token LC

During bonding, early purchases can establish cheap inventory and accelerate progress. Near Final Stretch, anticipation may create additional demand into which that inventory can be sold. At migration, venue and liquidity change; compare actual transactions and destination depth. After migration, the same group can retain, transfer, or sell its remaining units.

**Bundling is not a mandatory LC stage; selling is not proof that graduation failed.** Fee generation and Pay Dev signals are also separate from token inventory sales. Verify the platform's definition, recipient, and transaction before interpreting a payment badge.

## Turn the checklist into an investigation

| Question | What to record | How the answer changes the interpretation |
| --- | --- | --- |
| What connects these wallets? | Bundle IDs, direct transfers, funding paths, timing, alternative explanations | Stronger links justify a group ledger; weak links require separate balances and qualified attribution |
| How much do they still hold? | Initial buys, later buys, actual sales, outside transfers, closing balances | Remaining inventory measures potential supply pressure; initial purchase percentage does not do that alone |
| What did they pay? | Actual quantities, spend, proceeds, fees, missing history | Low-cost holders may be profitable at prices where later buyers lose; unknown basis prevents a precise profit claim |
| Are they buying, holding, transferring, or selling? | Classified transactions with quantities and time window | Sales change inventory; internal transfers may conceal it without reducing it |
| Does activity persist without their buys? | Comparable windows, supported identities, buying concentration, depth | Continuing other demand weakens the dependency hypothesis; disappearing demand strengthens it |
| Can the market absorb the remaining inventory? | Current reserves, route quotes at multiple sizes, competing sales | Large price impact limits achievable proceeds even when chart value looks large |

## Practice, with worked answers

1. **A group holds 40m, sells 5m, and transfers 10m internally. What remains?** 35m. Internal transfers do not reduce its aggregate inventory.
2. **The tool reports 75% initially bundled, but only 20% is currently attributed. Is the current pressure necessarily 75%?** No. Separate the historical purchases from current holdings; investigate sales, transfers, and missing attribution.
3. **Price falls while a Pay Dev badge appears. Does that prove dev selling?** No. Identify the badge's payment meaning and independently verify token sales.
4. **Holder count doubles after one wallet splits its balance. Has independent demand doubled?** No. Address count is not economic-owner count, and transfers are not purchases.
5. **Independent buying persists while group inventory falls. Is a dump guaranteed?** No. Sales may be absorbed. Review remaining inventory, liquidity, and persistence rather than predicting from the bundle label.

## Your research output

Write a short conclusion with numbers and limits: **“At the stated time, the supported group held 56m of a 100m measured supply after 15m verified sales and a 4m unresolved outside transfer. Buying from other observed addresses continued in two comparable windows. Large-sale quotes still showed substantial impact. Common control and complete history remain provisional.”**

That is an auditable investigation. “Bundled, dangerous” is only a label. Meme Fast's current sampled swaps and launch-stage views can help orient the work; complete wallet linkage, initial bundles, and cost basis may require external explorer or provider evidence. This lesson does not claim the app already computes a complete group ledger.
