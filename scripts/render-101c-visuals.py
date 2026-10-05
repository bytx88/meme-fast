"""Accessible SVG and HTML diagrams for the introductory walkthrough."""


def icon(kind):
    drawings = {
        'person': '<circle cx="24" cy="16" r="7"/><path d="M10 40v-5a14 14 0 0 1 28 0v5"/>',
        'token': '<circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="12"/><path d="M29 17h-7a4 4 0 0 0 0 8h4a4 4 0 0 1 0 8h-7M24 13v24"/>',
        'wallet': '<rect x="7" y="12" width="34" height="26" rx="5"/><path d="M9 12l24-6v6M29 22h12v10H29z"/><circle cx="34" cy="27" r="1"/>',
        'pool': '<path d="M6 18l18-10 18 10-18 10zM6 26l18 10 18-10M6 34l18 10 18-10"/>',
        'lock': '<rect x="10" y="21" width="28" height="21" rx="4"/><path d="M16 21v-7a8 8 0 0 1 16 0v7M24 29v6"/>',
    }
    return '<svg class="token-picture" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + drawings[kind] + '</svg>'


def launch_walkthrough():
    scenes = [
        ('person', 'token', 'The dev launches SAMPLE', 'The <strong>dev or creator</strong> is the person or team launching it. Its <strong>token address</strong> identifies this exact asset on its chain. Copy the full address; names can be reused.'),
        ('token', 'wallet', 'Tokens go into accounts', 'A <strong>wallet</strong> holds assets. An <strong>allocation</strong> assigns tokens to someone, such as the team or treasury. Find who received them and what they paid.'),
        ('wallet', 'pool', 'Traders buy and sell', 'A <strong>liquidity pool</strong> holds assets for trading. Its reserves and rules affect the price and what a sale receives. Some platforms pay the creator a share of trading fees.'),
    ]
    cards = ''.join(f'<li><span class="scene-number">{i:02}</span><div class="scene-pictures">{icon(a)}<span aria-hidden="true">{"⇄" if i == 3 else "→"}</span>{icon(b)}</div><h3>{title}</h3><p>{text}</p></li>' for i, (a, b, title, text) in enumerate(scenes, 1))
    destinations = [('pool', '30m', 'Pool reserves', 'Used in the trading pool.'), ('lock', '20m', 'Locked team tokens', 'Released on a schedule.'), ('wallet', '100m', 'Available to holders', 'Units ordinary holders can transfer now.')]
    units = ''.join(f'<div class="{kind}-destination">{icon(kind)}<strong>{amount}</strong><span>{label}</span><p>{text}</p></div>' for kind, amount, label, text in destinations)
    return ('<div class="token-walkthrough"><figure class="launch-scenes" aria-labelledby="launch-scenes-title"><figcaption id="launch-scenes-title">One launch, three steps</figcaption><ol>' + cards + '</ol></figure>'
        '<figure class="supply-picture" aria-labelledby="supply-picture-title"><figcaption id="supply-picture-title">Where SAMPLE’s 150m tokens go</figcaption><p><strong>Supply</strong> means the number of token units. This example divides the issued units into three places.</p>'
        '<div class="supply-strip" aria-hidden="true"><span class="supply-pool"></span><span class="supply-lock"></span><span class="supply-holders"></span></div><div class="supply-destinations">' + units + '</div></figure>'
        '<figure class="money-picture" aria-labelledby="money-picture-title"><figcaption id="money-picture-title">Follow what someone paid and received</figcaption><div class="money-path"><div>' + icon('wallet') + '<strong>Buy tokens</strong><span>Money paid → tokens received</span></div><span class="money-path-arrow" aria-hidden="true">→</span><div>' + icon('wallet') + '<strong>Sell tokens</strong><span>Tokens sold → money received</span></div></div>'
        '<p><strong>Cost basis</strong> is what you paid for your tokens. Include relevant fees and use the same cost method for each purchase. If the purchase history is missing, record the cost as unknown.</p><p>A <strong>creator fee</strong> comes from qualifying trading activity under the platform’s rules. Check the recipient and payment. The creator may earn fees while still holding its tokens.</p></figure></div>')
