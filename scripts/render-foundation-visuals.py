"""Text-first teaching diagrams shared by the foundation and supply courses."""
import html


def cards(title, items, note='', ordered=False):
    tag = 'ol' if ordered else 'ul'
    body = ''.join(f'<li><strong>{html.escape(label)}</strong><span>{html.escape(text)}</span></li>'
                   for label, text in items)
    return (f'<figure class="foundation-visual"><figcaption>{html.escape(title)}</figcaption>'
            f'<{tag} class="foundation-cards">{body}</{tag}><p>{html.escape(note)}</p></figure>')


VISUALS = {
    'WALLET_BASICS': cards('Follow the address before the balance', [
        ('Your wallet address', 'The public address you use to receive assets. It identifies an account, not necessarily a person.'),
        ('The token address', 'Identifies the token itself. On Solana this is its mint address; copied names do not identify the same token.'),
        ('Your token account', 'On Solana, holds units of one token for an owner. One wallet can own several token accounts.')],
        'Connect lets an app see your public account. Signing approves a specific message or transaction: read it first. Never enter your recovery phrase into a website.'),
    'VALUATION_EXAMPLE': cards('One price, three different numbers — illustrative', [
        ('Market cap: $200,000', '$0.01 × 20m circulating units.'),
        ('FDV: $1,000,000', '$0.01 × 100m fully diluted units, assuming this is the stated total/max supply.'),
        ('Pool liquidity: about $20,000', '1m tokens marked at $10,000 plus $10,000 of quote currency.')],
        'Cap and FDV value supply at the current price. They are not cash available for exits. Check which supply the provider uses; some meme dashboards label total-supply valuation as market cap.'),
    'SWAP_QUOTE': cards('Read a DEX sale preview — illustrative', [
        ('1. Your order', 'Sell 1,000 tokens. The pre-trade reference price suggests $100.'),
        ('2. Route quote', 'Expected output: $97 after pool/route fees. Suppose the interface reports 2% price impact; the remaining difference includes fees.'),
        ('3. Your limit', 'For this example, 1% tolerance sets minimum received to $96.03: $97 × 0.99. Read the actual minimum shown by your app.')],
        'Price impact comes from your order moving the pool price. Slippage is the difference between the quote and execution. Tolerance limits acceptable execution movement; it does not remove impact. Network fees are separate, and a failed transaction may still incur them.', True),
    'ATTENTION_EXAMPLE': cards('Turn a story into something you can check', [
        ('Narrative', 'The story: “AI agents are getting attention.”'),
        ('Meta', 'The wider theme: several AI-agent tokens compete for the same buyers.'),
        ('Hype cycle', 'Attention grows, peaks, fades, and may return. The next stage is not guaranteed.'),
        ('Alpha', 'A claimed useful information advantage: “this token has a new integration.” Verify the original announcement, date, and exact token address.')],
        'Twenty reposts can come from one claim. Check the primary source, then look for actual buying and returning participation.'),
    'BUNDLE_INVENTORY': cards('Cheap early inventory can take three paths', [
        ('Constructive', 'Sell gradually to pay for marketing, liquidity, development, or other disclosed work. Check where the money went and what was delivered.'),
        ('Neutral / speculative', 'Early buyers took launch risk and later take profits. Check the size and pace of sales.'),
        ('Predatory', 'Insiders attract public buyers, then dump cheap inventory into them. Compare promotion, linked sales, and remaining holdings.')],
        'Illustrative EARLY token: five wallets buy 2m units each at $0.0001. Combined cost is $1,000 before fees. At $0.001, their 10m units mark at $10,000. A large sale may receive much less. Early entry suggests a cost advantage; verify the actual payments.'),
    'BUNDLE_EVIDENCE': cards('Build the evidence for coordination and control', [
        ('1. Extremely early buying', 'Bought at creation or very soon after.'),
        ('2. Similar timing', 'Purchases arrived together.'),
        ('3. Large combined supply', 'Several small wallets hold a meaningful total.'),
        ('4. Similar behavior', 'Amounts, routes, or repeated actions match.'),
        ('5. Common funding', 'Trace the source; a shared exchange can serve unrelated users.'),
        ('6. Transfers between wallets', 'Check direction, purpose, and current owners.'),
        ('7. Bubble-map linkage', 'Open the underlying transfers; the map may repeat evidence already counted.'),
        ('8. Synchronized selling', 'Check actual swaps and received assets; bots can react together too.')],
        'This is an investigation path, not a proof score. Corroborating evidence strengthens the case for one economic entity—a person or group managing inventory together. Coordination alone does not prove common ownership.', True),
}
