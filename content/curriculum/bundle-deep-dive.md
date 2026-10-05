## Goal
Screen early supply with a bubble map and the top ten holders. Learn what should make you investigate, watch, or pass before considering entry.

## Start here: a practical entry screen

**Your working rule: no ordinary holder above 3% of the verified tradable float.** Apply it to supported linked groups too, not just individual wallets.

This is a concentration filter, not proof that a token is good to enter. Also check sellability, permissions, usable liquidity, an executable quote for your size, and a credible reason for demand.

Check the denominator. A provider's “% of total supply” may differ from your “% of float.” Classify pool, burn, locked, exchange, and system addresses separately; do not blindly subtract them. If float or ownership is unclear, mark the screen unresolved.

## How to check the bundle: bubble map first

1. Copy the **exact contract and chain** into a supported bubble-map tool such as Bubblemaps. Check its timestamp and coverage.
2. Look for **large bubbles and connected clusters**. Click large ordinary holders and inspect links, amounts, and dates. A line commonly represents a transfer, not proven common ownership; read the tool's legend.
3. Open those addresses in the chain explorer. Check first activity, funding, purchases, and transfers. A fresh address is not necessarily a new person.
4. Review the **top ten ordinary holders**. Compare freshness, allocations, and buying time. Look beyond ten if a cluster extends further.
5. Refresh after the first move. Did the group hold, transfer, or sell?

**A bubble map is a good first screen, but a clean map does not clear the token.** Unconnected buyers and missing or stale coverage can hide coordination.

## Top-ten holder check: what to look for

| Check | How to check | How to interpret it |
| --- | --- | --- |
| Are they fresh addresses? | Open each large holder; compare first activity and transactions before launch. | Several fresh wallets increase suspicion, but unrelated buyers can also use new wallets. |
| Similar allocations? | Compare token quantities or supply shares. Look for repeated near-equal positions below your 3% limit. | Possible wallet splitting. Similar sizes alone do not establish a bundle. |
| Buying at the same time? | Open actual purchase transactions; compare timestamps, blocks, and any provider-reported bundle IDs. | Same-block purchases are a coordination lead, not proof: launch bots and unrelated traders can coincide. |
| Same funding source? | Trace the initial funding transaction and direct subsequent links. | A common private funder plus synchronized behavior strengthens the hypothesis. Shared exchange or router infrastructure alone is weak evidence. |
| Connected to the creator? | Trace deployment funding, direct transfers, and repeated supported destinations. | Stronger links can support a creator-related group. Keep attribution provisional when links are weak. |
| Selling or just transferring? | Check whether the transaction contains an actual swap and what assets were received. | A transfer moves inventory; a sale exchanges it. Count supported receiving wallets with the group. |

## Common patterns that can disguise concentration

Transfers remain visible onchain. Address attribution can be difficult; these patterns are leads, not proof of intent.

| Pattern | What you may see | What to do |
| --- | --- | --- |
| Split supply across wallets | Many small positions, sometimes each below 3%, with similar funding and launch timing. | Review the supported cluster as a whole rather than clearing each address separately. |
| Move inventory away from the visible dev | Creator balance falls while fresh addresses receive tokens. | Open the outgoing transfers and follow recipients. Check whether the group still holds the supply. |
| Relay through several addresses | A sends to B, then B sends to C; the top-holder list changes. | Follow the transaction path until current holders or actual sales are identified. Missing history stays unresolved. |
| Use unconnected launch wallets | Fresh wallets buy together without transferring tokens between themselves. | Supplement the bubble map with funding history, purchase timing, and bundle evidence. No map links does not mean independent buyers. |
| Show small buys while larger sales occur | Green buys are highlighted, but related wallets reduce inventory. | Compare actual purchases and sales over the same interval; do not judge from one green transaction. |
| Inflate apparent participation | Repeated trades or balance splitting creates more activity or addresses. | Check distinct supported participants, repeated funding, transfers, and whether demand persists without the group. |

## Sudden surge in the first 30 minutes: how to investigate

**A sharp rise without a verified external catalyst is a reason to inspect who bought, not proof the dev bought its own supply.** Thin liquidity, unrelated speculation, bots, discovery feeds, or an unobserved catalyst can also produce it.

1. Mark the surge window; find the largest actual purchases in the pool trades or explorer.
2. Open those buyers. Compare freshness, funding, timing, allocations, and creator links. A router is not the buyer.
3. Do other buyers continue when the group stops buying? Compare liquidity before and after.
4. Check later swaps and transfers: did related wallets sell into new buyers or move inventory to fresh addresses?
5. Look for a dated, exact-token catalyst. No news in your sample does not establish that none exists.

A justified conclusion might be: **“Most surge buying came from several fresh wallets funded by the same non-exchange address, with direct creator links; related wallets later sold into new buying.”** That supports suspected coordinated activity. Without those links, say **“buyer attribution unresolved”**, not “dev pump.”

## Practical worked screen

**ILLUSTRATIVE · NOT A LIVE TOKEN.** The top ten ordinary holders each appear below 3%. The map and explorer support a group of five fresh wallets holding about 2% each, funded by the same private address and buying in the launch window. Your screen sees a **10% linked group**, so the individual 3% limit has not cleared concentration. Check creator links and later behavior before assigning ownership.

## Make the result useful

- **Pass this screen:** verified float; no ordinary holder or supported group breaches your limit; no critical unresolved links. This only passes the concentration check.
- **Watch / unresolved:** stale map, unclear float, missing history, or suspicious but unverified coordination. Record exactly what evidence is missing.
- **Fails your screen:** an ordinary holder or supported group exceeds your limit. A collection of sub-3% wallets does not override the group total.

## Practice, with worked answers

- **Ten bubbles under 3%: automatically good to enter?** No. Check linked groups, float definition, permissions, liquidity, and demand.
- **Three fresh wallets buy the same block: proven dev bundle?** No. Inspect funding, reported bundle evidence, and creator links.
- **Creator sends tokens to a new wallet: has it exited?** Not through that transfer. Follow the receiving wallet and actual sales.
- **Price doubles in 20 minutes with no observed news: dev pump?** Not established. Identify the buyers and their links before attributing the move.

Use external bubble-map and explorer tools for these checks; Meme Fast does not currently verify complete wallet linkage.
