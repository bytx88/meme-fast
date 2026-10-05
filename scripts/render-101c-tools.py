"""Render the 101C field guides and browser-local research worksheet."""
import html

escape = html.escape
FIELDS = [
    ('identity', 'Token and check time', 'Chain, full token address, launch mode, and UTC check time.'),
    ('inventory', 'Wallets and holdings', 'Owner, units, confirmed links, suspected links, supply total used, and transaction sources.'),
    ('supply', 'Supply and allocations', 'Total units, pool reserves, locked units, available holder units, and sources.'),
    ('powers', 'Creator permissions', 'Mint, freeze, fee, transfer, and upgrade controls; controller/status and sources.'),
    ('unlocks', 'Locks and next releases', 'Contract, beneficiary, claimable units, next amount/date/timezone, and change rights.'),
    ('liquidity', 'Pools and sale quotes', 'Pair, pool, liquidity controller, lock coverage/expiry, quote size, proceeds, impact, and time.'),
    ('earnings', 'Creator earnings', 'Fee rule/source, recipient, earned-but-waiting and received amounts, claims, sales, and spending evidence.'),
    ('demand', 'Buyer activity and catalyst', 'Equal windows, pool coverage, group/other buying, primary sources, and competitors.'),
    ('ledger', 'Group transaction ledger', 'Opening holdings + purchases + outside inflows - sales - outside outflows = closing holdings. Internal transfers cancel.'),
    ('timeline', 'Creator work and buyer response', 'Dated delivery, promotion, disclosure, spending, buyer activity, and source links.'),
    ('history', 'Previous launches', 'Contracts, team-link confidence, promises, delivery, sales, and outcomes.'),
    ('unknowns', 'Unanswered questions', 'Missing history, uncertain links, unknown controllers, stale data, and needed evidence.'),
    ('conclusion', 'Conclusion and next check', 'Separate demand and supply statuses, your screening limit, and what to check next with date/time.'),
]


def worksheet():
    fields = ''.join(
        f'<div class="review-field"><label for="review-{key}">{escape(label)}</label>'
        f'<p id="help-{key}">{escape(help_text)}</p>'
        f'<textarea id="review-{key}" name="{key}" rows="3" aria-describedby="help-{key}"></textarea></div>'
        for key, label, help_text in FIELDS)
    return ('<section class="review-sheet" id="review-worksheet" aria-labelledby="worksheet-title">'
            '<h2 id="worksheet-title">Your token review worksheet</h2>'
            '<p>Add your notes, source links, and timestamps. Save keeps them in this browser on this device. '
            'Notes are not sent to Meme Fast. Download a copy if you want to keep it elsewhere.</p>'
            '<p><a href="./101c-review-template.txt" download>Download a blank worksheet</a></p>'
            '<form id="token-review">' + fields +
            '<div class="review-actions"><button type="button" id="review-save">Save in this browser</button>'
            '<button type="button" id="review-download">Download my notes</button>'
            '<button type="button" id="review-example" aria-expanded="false" aria-controls="review-sample">View worked example</button></div>'
            '<p id="review-status" role="status" aria-live="polite">Notes have not been saved yet.</p></form>'
            '<div id="review-sample" hidden><h3>SAMPLE worked example</h3>'
            '<p>Illustrative, before the Day 2 unlock. Your own notes stay in the form above.</p>'
            '<dl><dt>Supply and holdings</dt><dd>150m issued; 30m pool reserves; 20m locked; 100m available holder units. '
            'The creator group has 8m available units after selling 5m and buying 1m.</dd>'
            '<dt>Unlock</dt><dd>4m at 09:00 UTC on Day 2. With no other changes: 12m / 104m = about 11.5%.</dd>'
            '<dt>Permissions and liquidity</dt><dd>Mint and freeze revoked in this example. Main liquidity position locked for 30 days; '
            'secondary pool rights differ. Illustrative 5m sale quote had 18% impact.</dd>'
            '<dt>Earnings and demand</dt><dd>$200 received and $100 waiting to be withdrawn under the made-up fee rule. '
            'Other observed buying weakened. Cost history and private promotion payments remain unknown.</dd>'
            '<dt>Conclusion</dt><dd>The 8% group holding exceeds the example 3% limit. Recheck balances, unlock transactions, '
            'quotes, and whether other buyers return.</dd></dl></div>'
            '<noscript><p>Browser saving and downloading your notes require JavaScript. Use the blank worksheet link instead.</p></noscript>'
            '</section><script src="./101c-review.js" defer></script>')


def field_guide(number):
    if number not in (1, 2, 3, 4):
        return ''
    holders = number in (1, 2)
    asset = '101c-holders.svg' if holders else '101c-explorer.svg'
    note = ('In Holders, use Account to investigate the owner and Token Account for the units held. '
            'Save Quantity and the Percentage definition. Custody and pool rows need their own roles.' if holders else
            'Find Current Supply, Decimals, the Authority menu, and Token Extensions. Open specific authority details '
            'before recording mint or freeze status; a summary label can refer to a different authority.')
    return ('<figure class="explorer-guide"><figcaption>Where to look in the explorer</figcaption>'
            f'<a href="./{asset}" target="_blank" rel="noopener"><img src="./{asset}" '
            f'alt="Annotated Solscan {"holder table" if holders else "supply and profile fields"}" loading="lazy"></a>'
            f'<p>{escape(note)}</p><p class="learn-muted">Captured 5 October 2026 on the public '
            '<a href="https://solscan.io/token/So11111111111111111111111111111111111111112" target="_blank" rel="noopener noreferrer">Wrapped SOL page</a>. '
            'This is a navigation example. Wrapped SOL has special token mechanics; its numbers and authority labels are not the SAMPLE case '
            'or a standard meme-token assessment. Open your own token address to do the checks.</p></figure>')


def record_link(number):
    key = ['inventory', 'inventory', 'supply', 'powers', 'unlocks', 'liquidity', 'earnings',
           'demand', 'ledger', 'timeline', 'timeline', 'history', 'conclusion'][number - 1]
    return (f'<p class="record-handoff"><a href="./meme-101c-section-10.html#review-{key}" target="_blank" rel="noopener">'
            'Add these findings to your review worksheet →</a></p>')
