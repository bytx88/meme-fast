"""Render the supplied Meme 101 lessons as accessible static course pages."""
from pathlib import Path
import html
import json
import re

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
CONTENT = ROOT / 'content/meme-101'
GUIDANCE = json.loads((CONTENT / 'concept-guidance.json').read_text(encoding='utf-8'))
EVIDENCE = json.loads((CONTENT / 'tool-evidence.json').read_text(encoding='utf-8'))

# Complete the few fields missing from the original lesson drafts.
SUPPLEMENTS = {
    'Bundle Push': {'Beginner mistake': 'Treating coordinated buying as proof that independent demand has taken over.'},
    'Entry Liquidity': {'Beginner mistake': 'Using the displayed price as the average execution price for your whole order.'},
    'Catalyst': {'Why does it matter?': 'An event can change access or participation, but an announcement alone does not establish new demand.'},
    'Rug Pull': {'Why does it matter?': 'Control over supply, trading rules, or liquidity can undermine ordinary exits.', 'What should I check?': '- Liquidity controllers and withdrawal permissions\n- Minting and trading permissions\n- Related-wallet inventory and transfers\n- Changes to fees, restrictions, or pool depth'},
    'Mint Authority': {'Beginner mistake': 'Checking supply once without checking who can create more.'},
    'Freeze Authority': {'Beginner mistake': 'Assuming a successful buy means transfers and selling cannot later be restricted.'},
    'Unlocked-Liquidity Warning': {'Beginner mistake': 'Ignoring the warning or treating it as proof of a rug without checking the actual controller.'},
    'Stop Loss': {'Beginner mistake': 'Treating a stop trigger as a guaranteed execution price or maximum loss.'},
    'Scaling Out': {'Beginner mistake': 'Planning profit targets without checking whether the intended sale can execute.'},
    'Taking Initial Capital Out': {'What should I check?': '- Proceeds after fees and other execution costs\n- Original amount invested\n- Remaining position value\n- Remaining liquidity and exit conditions'},
    'Survivorship Bias': {'Beginner mistake': 'Learning only from winning tokens and visible profitable wallets.'},
    'Exit Strategy': {'Why does it matter?': 'Written exit conditions give you a way to respond when the evidence or your acceptable exposure changes.', 'What should I check?': '- Conditions for reducing or closing\n- Position size and executable quotes\n- Evidence that would invalidate the thesis\n- How remaining exposure changes after partial exits'},
    'Entry Liquidity vs Exit Liquidity': {'What should I check?': '- Current buy and sell quotes for the intended size\n- Fees and price impact\n- Pool coverage and depth\n- How demand could change before exit', 'Beginner mistake': 'Assuming easy buying during hype means equally easy selling later.'},
    'The Core Meme-Trading Question': {'What is it?': 'A research question connecting ownership, entry cost, current behavior, and future demand.', 'Why does it matter?': 'A price move alone does not tell you who can sell or what demand could absorb that inventory.', 'What should I check?': '- Who controls sellable supply\n- What is known about their cost basis\n- What their balances and trades show now\n- Current liquidity and evidence of demand', 'Beginner mistake': 'Asking only whether the price can go up.', 'Takeaway': '**Connect supply, behavior, and exit capacity before drawing a conclusion.**'}
}


def inline(value):
    return re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', html.escape(value))


def markdown(source):
    output, paragraph, listing = [], [], None
    def flush():
        if paragraph:
            output.append('<p>' + inline(' '.join(paragraph)) + '</p>')
            paragraph.clear()
    def close_list():
        nonlocal listing
        if listing:
            output.append(f'</{listing}>')
            listing = None
    for line in source.splitlines():
        line = line.strip()
        if not line or line == '---':
            flush()
            close_list()
            continue
        heading = re.match(r'^(#{1,3}) (.*)', line)
        item = re.match(r'^(?:- |\d+\. )(.*)', line)
        if heading:
            flush()
            close_list()
            level = max(2, len(heading[1]))
            slug = re.sub(r'[^a-z0-9]+', '-', heading[2].lower()).strip('-')
            anchor = f' id="{slug}"' if level == 2 else ''
            output.append(f'<h{level}{anchor}>{inline(heading[2])}</h{level}>')
        elif item:
            flush()
            kind = 'ul' if line.startswith('- ') else 'ol'
            if kind != listing:
                close_list()
                listing = kind
                output.append(f'<{kind}>')
            output.append(f'<li>{inline(item[1])}</li>')
        else:
            close_list()
            paragraph.append(line)
    flush()
    close_list()
    return '\n'.join(output)


def render_concept(heading, source):
    title = re.sub(r'^\d+\. ', '', heading)
    parts = re.split(r'^### (.+)\n', source, flags=re.M)
    fields = {parts[i]: parts[i+1].replace('\n---', '').strip() for i in range(1, len(parts), 2)}
    for key, value in SUPPLEMENTS.get(title, {}).items():
        fields.setdefault(key, value)
    if title == 'The Core Meme-Trading Question':
        fields['What is it?'] += '\n\n' + parts[0].replace('\n---', '').strip()
    required = ['What is it?', 'Why does it matter?', 'What should I check?', 'Beginner mistake', 'Takeaway']
    if any(not fields.get(key) for key in required):
        raise ValueError(f'Incomplete concept: {title}')
    # Keep examples and contextual notes within the relevant step, in source order.
    contexts = {'Examples': 'What is it?', 'Common forms': 'What is it?', 'Common path': 'What is it?', 'Meme-specific issue': 'Why does it matter?', 'Warning': 'Why does it matter?', 'Possible triggers': 'What should I check?'}
    for extra, destination in contexts.items():
        if extra in fields:
            fields[destination] += f'\n\n**{extra}**\n\n{fields[extra]}'
    healthy, dangerous = GUIDANCE[title]
    healthy = fields.get('Healthy structure', fields.get('Healthier path', healthy))
    dangerous = fields.get('Dangerous structure', fields.get('Dangerous path', dangerous))
    slug = re.sub(r'[^a-z0-9]+', '-', heading.lower()).strip('-')
    def step(number, label, value, modifier=''):
        return f'<div class="concept-step {modifier}"><h3><span class="step-number">{number:02}</span>{label}</h3>{markdown(value)}</div>'
    result = f'<section class="lesson-concept" aria-labelledby="{slug}"><h2 id="{slug}">{html.escape(heading)}</h2>'
    result += step(1, 'Definition', fields['What is it?'])
    result += step(2, 'Why it matters', fields['Why does it matter?'])
    result += step(3, 'What to check', fields['What should I check?'])
    result += f'<div class="concept-step"><h3><span class="step-number">04</span>Healthy / Dangerous</h3><div class="concept-comparison"><div class="concept-healthy"><h4>Healthy</h4>{markdown(healthy)}</div><div class="concept-dangerous"><h4>Dangerous</h4>{markdown(dangerous)}</div></div></div>'
    result += step(5, 'Beginner mistake', fields['Beginner mistake'], 'concept-mistake')
    result += step(6, 'Takeaway', fields['Takeaway'], 'concept-takeaway')
    if title in EVIDENCE:
        tool, route, note = EVIDENCE[title]
        if not (DIST / route).is_file():
            raise ValueError(f'Missing evidence destination: {route}')
        result += f'<div class="concept-evidence"><a href="./{route}">See it in Meme Fast → <span>{html.escape(tool)}</span></a><p>{html.escape(note)}</p></div>'
    return result + '</section>'


def level_body(source):
    parts = re.split(r'^## (.+)\n', source, flags=re.M)
    result = []
    for i in range(1, len(parts), 2):
        heading, body = parts[i], parts[i+1]
        if heading == 'Goal':
            continue  # The goal already appears directly below the page title.
        if re.match(r'^\d+\. ', heading):
            # The Level 8 recap remains a separate closing section.
            concept, *closing = re.split(r'(?=^# )', body, maxsplit=1, flags=re.M)
            result.append(render_concept(heading, concept))
            if closing:
                result.append(markdown(closing[0]))
        else:
            result.append(markdown(f'## {heading}\n{body}'))
    return '\n'.join(result)


lessons = []
for index, path in enumerate(sorted(CONTENT.glob('*.md')), 1):
    source = path.read_text(encoding='utf-8-sig')
    title = source.splitlines()[0].split(': ', 1)[1]
    goal = re.search(r'## Goal\s+([^\n]+)', source)[1]
    lessons.append((f'meme-101-level-{index}', title, goal, source.split('\n', 1)[1]))

bundle = '''## Goal
Read coordinated supply from accumulation through distribution.

## 1. What a bundle is
A bundle can involve coordinated launch transactions or related wallets. Similar timing is a lead, not proof of common ownership. Shared exchange funding alone can also reflect unrelated customers; combine funding, transfers, timing, and repeated behavior.

## 2. Supply and entry
Check how much supply a suspected cluster controls, when it entered, and what it paid. Many holder addresses can still represent one operator. Estimated cost basis may be incomplete when transfers or earlier trades are missing.

## 3. What the wallets are doing
Distinguish holding, accumulation, launch sniping, support activity, and distribution. Look for synchronized or staggered sales, transfers to fresh wallets, replenishing buys, and selling into each rise.

## 4. After the bundle push
A coordinated push can move price rapidly. Ask whether independent buyers take over when that support stops. Look for unrelated entrants, persistent demand, and ownership spreading over time.

## 5. Exit capacity
Compare remaining inventory with pool depth and observed demand. A liquidity-to-position ratio is context, not a guarantee that the pool can absorb a sale at the displayed price.

## Five numbers to investigate
- Bundle supply percentage: estimated supply controlled by the suspected cluster.
- Bundle cost basis: what the cluster appears to have paid.
- Bundle remaining percentage: how much inventory remains available to sell.
- Liquidity / bundle value: pool capital relative to that inventory.
- Organic ownership growth: whether independent buyers are replacing the original holders.

## Two paths to compare
**Accumulation → push → independent demand takes over.**

**Accumulation → push → retail enters → coordinated distribution.**

Neither path guarantees an outcome. Follow balances, trades, liquidity, and demand over time.

## Bundle checklist
1. What evidence connects these wallets?
2. How much supply do they still hold?
3. What is known and unknown about their entry cost?
4. Are they accumulating, supporting, transferring, or selling?
5. Does activity persist without their buys?
6. How large is their inventory relative to exit capacity?
'''
lessons.append(('meme-101-bundles', 'Bundle deep dive', 'Follow coordinated supply, cost basis, and independent demand.', bundle))
template = (DIST / 'model.html').read_text(encoding='utf-8')
header = re.search(r'<header class="masthead">[\s\S]*?</header>', template)[0]
header = header.replace(' aria-current="page"', '')
header = re.sub(r'<a href="\./(?:meme-101|learn)\.html"[^>]*>(?:Meme 101|Learn)</a>', '', header)
header = header.replace('<a href="./model.html">Model</a>', '<a href="./learn.html" aria-current="page">Learn</a><a href="./model.html">Model</a>')
footer = re.search(r'<footer>[\s\S]*?</footer>', template)[0]


def page(slug, title, description, body):
    track = 'meme-101' if slug.startswith('meme-101') else 'meme-202a' if slug.startswith('meme-202a') else 'meme-202b' if slug.startswith('meme-202b') else 'learn'
    tabs = '<nav class="learning-tracks" aria-label="Learning courses">'
    for target, label in [('learn', 'All courses'), ('meme-101', '101 · Foundations'), ('meme-202a', '202A · Snipe'), ('meme-202b', '202B · Swing')]:
        current = ' aria-current="page"' if track == target else ''
        tabs += f'<a href="./{target}.html"{current}>{label}</a>'
    tabs += '</nav>'
    document = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · Meme Fast</title><meta name="description" content="{html.escape(description, quote=True)}">
<link rel="canonical" href="https://meme.oneerp.org/{slug}.html"><link rel="icon" type="image/svg+xml" href="./brand-mark.svg?v=2">
<link rel="stylesheet" href="./style.css?v=brand-depth-v2"><link rel="stylesheet" href="./donate.css?v=quiet-donate-v1"><link rel="stylesheet" href="./trader-ui.css?v=3"><link rel="stylesheet" href="./site-footer.css?v=1"><link rel="stylesheet" href="./meme-101.css?v=1"><link rel="stylesheet" href="./meme-101-concepts.css?v=1"><link rel="stylesheet" href="./learning.css?v=1">
<script type="module" src="./donate.js?v=static-header-v1"></script><script type="module" src="./page-scroll.js?v=1"></script></head>
<body class="trader-ui"><main class="workspace learn-page"><a class="learn-skip" href="#lesson-content">Skip to learning content</a>{header}{tabs}
{body}{footer}</main></body></html>'''
    (DIST / f'{slug}.html').write_text(document, encoding='utf-8')


cards = ''.join(f'<a class="lesson-card" href="./{slug}.html"><span>{"LEVEL " + str(i) if i < 9 else "BONUS / 09"}</span><h2>{title}</h2><p>{goal}</p><strong>Open lesson ↗</strong></a>' for i, (slug, title, goal, _) in enumerate(lessons, 1))
page('meme-101', 'Meme 101', 'Eight beginner lessons plus a bundle deep dive: token numbers, launch, ownership, wallets, price, attention, danger, and risk.', f'''<article class="learn-content" id="lesson-content"><header class="learn-intro"><span class="kicker">THE BEGINNER LEARNING PATH</span><h1>Meme 101</h1><p>Read the token. Understand the people behind it.</p><p class="learn-muted">Eight levels, from the first numbers on a token page to planning an exit. Start at Level 1, or choose the question you want to understand.</p><a class="learn-start" href="./meme-101-level-1.html">Start Level 1 →</a><span class="course-count">8 levels + 1 bundle deep dive</span></header><aside class="learn-question"><span class="kicker">KEEP ONE QUESTION IN VIEW</span><p>Who owns the supply, what did they pay for it, what are they doing now, and who will buy it from them?</p></aside><div class="lesson-grid">{cards}</div><section class="learn-next"><h2>Put the questions to work</h2><p>Use <a href="./new-coins.html">Snipe</a> for launch context, <a href="./radar.html">Swing</a> to compare observed tokens, <a href="./order-flow.html">Inspect</a> for sampled swaps, and <a href="./narratives.html">Tweet</a> for attention evidence. Wallet clusters, cost basis, and contract permissions may need external research; these lessons do not imply that Meme Fast measures every concept.</p></section></article>''')
for i, (slug, title, goal, source) in enumerate(lessons):
    headings = [heading for heading in re.findall(r'^## (.+)$', source, re.M) if heading != 'Goal' and (i >= 8 or re.match(r'^\d+\. ', heading) or 'Checklist' in heading)]
    toc = ''.join(f'<a href="#{re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")}">{html.escape(text)}</a>' for text in headings)
    curriculum = ''.join(f'<a href="./{s}.html" {"aria-current=\"page\"" if s == slug else ""}><span>{n:02}</span> {t}</a>' for n, (s, t, _, _) in enumerate(lessons, 1))
    previous = f'<a href="./{lessons[i-1][0]}.html">← {lessons[i-1][1]}</a>' if i else '<a href="./meme-101.html">← Course overview</a>'
    following = f'<a href="./{lessons[i+1][0]}.html">{lessons[i+1][1]} →</a>' if i < len(lessons)-1 else '<a href="./meme-101.html">Return to overview →</a>'
    content = level_body(source) if i < 8 else markdown(source)
    page(slug, title, goal, f'''<div class="learn-content" id="lesson-content"><p class="learn-breadcrumb"><a href="./meme-101.html">Meme 101</a> / {"Level " + str(i+1) if i < 8 else "Bonus"}</p><header class="learn-intro"><span class="kicker">{"LEVEL " + str(i+1) + " OF 8" if i < 8 else "BONUS / BUNDLES"}</span><h1>{title}</h1><p>{goal}</p></header><div class="learn-layout"><aside class="learn-sidebar"><nav aria-label="Course lessons"><h2>The learning path</h2>{curriculum}</nav></aside><article class="lesson-body"><nav class="lesson-toc" aria-label="In this lesson"><h2>In this lesson</h2>{toc}</nav>{content}<nav class="lesson-pager" aria-label="Previous and next lessons">{previous}{following}</nav></article></div></div>''')
print(f'Rendered overview and {len(lessons)} lessons.')
