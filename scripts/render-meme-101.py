"""Render the supplied Meme 101 lessons as accessible static course pages."""
from pathlib import Path
import html
import re

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
CONTENT = ROOT / 'content/meme-101'


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
if 'meme-101.html' not in header:
    header = header.replace('<a href="./model.html">Model</a>', '<a href="./model.html">Model</a><a href="./meme-101.html">Meme 101</a>')
header = header.replace('<a href="./meme-101.html">', '<a href="./meme-101.html" aria-current="page">')
footer = re.search(r'<footer>[\s\S]*?</footer>', template)[0]


def page(slug, title, description, body):
    document = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · Meme Fast</title><meta name="description" content="{html.escape(description, quote=True)}">
<link rel="canonical" href="https://meme.oneerp.org/{slug}.html"><link rel="icon" type="image/svg+xml" href="./brand-mark.svg?v=2">
<link rel="stylesheet" href="./style.css?v=brand-depth-v2"><link rel="stylesheet" href="./donate.css?v=quiet-donate-v1"><link rel="stylesheet" href="./trader-ui.css?v=3"><link rel="stylesheet" href="./site-footer.css?v=1"><link rel="stylesheet" href="./meme-101.css?v=1">
<script type="module" src="./donate.js?v=static-header-v1"></script><script type="module" src="./page-scroll.js?v=1"></script></head>
<body class="trader-ui"><main class="workspace learn-page"><a class="learn-skip" href="#lesson-content">Skip to learning content</a>{header}
{body}{footer}</main></body></html>'''
    (DIST / f'{slug}.html').write_text(document, encoding='utf-8')


cards = ''.join(f'<a class="lesson-card" href="./{slug}.html"><span>{"LEVEL " + str(i) if i < 9 else "BONUS / 09"}</span><h2>{title}</h2><p>{goal}</p><strong>Open lesson ↗</strong></a>' for i, (slug, title, goal, _) in enumerate(lessons, 1))
page('meme-101', 'Meme 101', 'Eight beginner lessons plus a bundle deep dive: token numbers, launch, ownership, wallets, price, attention, danger, and risk.', f'''<article class="learn-content" id="lesson-content"><header class="learn-intro"><span class="kicker">THE BEGINNER LEARNING PATH</span><h1>Meme 101</h1><p>Read the token. Understand the people behind it.</p><p class="learn-muted">Eight levels, from the first numbers on a token page to planning an exit. Start at Level 1, or choose the question you want to understand.</p><a class="learn-start" href="./meme-101-level-1.html">Start Level 1 →</a><span class="course-count">8 levels + 1 bundle deep dive</span></header><aside class="learn-question"><span class="kicker">KEEP ONE QUESTION IN VIEW</span><p>Who owns the supply, what did they pay for it, what are they doing now, and who will buy it from them?</p></aside><div class="lesson-grid">{cards}</div><section class="learn-next"><h2>Put the questions to work</h2><p>Use <a href="./new-coins.html">Snipe</a> for launch context, <a href="./radar.html">Swing</a> to compare observed tokens, <a href="./order-flow.html">Inspect</a> for sampled swaps, and <a href="./narratives.html">Tweet</a> for attention evidence. Wallet clusters, cost basis, and contract permissions may need external research; these lessons do not imply that Meme Fast measures every concept.</p></section></article>''')
for i, (slug, title, goal, source) in enumerate(lessons):
    headings = re.findall(r'^## (.+)$', source, re.M)
    toc = ''.join(f'<a href="#{re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")}">{html.escape(text)}</a>' for text in headings)
    curriculum = ''.join(f'<a href="./{s}.html" {"aria-current=\"page\"" if s == slug else ""}><span>{n:02}</span> {t}</a>' for n, (s, t, _, _) in enumerate(lessons, 1))
    previous = f'<a href="./{lessons[i-1][0]}.html">← {lessons[i-1][1]}</a>' if i else '<a href="./meme-101.html">← Course overview</a>'
    following = f'<a href="./{lessons[i+1][0]}.html">{lessons[i+1][1]} →</a>' if i < len(lessons)-1 else '<a href="./meme-101.html">Return to overview →</a>'
    page(slug, title, goal, f'''<div class="learn-content" id="lesson-content"><p class="learn-breadcrumb"><a href="./meme-101.html">Meme 101</a> / {"Level " + str(i+1) if i < 8 else "Bonus"}</p><header class="learn-intro"><span class="kicker">{"LEVEL " + str(i+1) + " OF 8" if i < 8 else "BONUS / BUNDLES"}</span><h1>{title}</h1><p>{goal}</p></header><div class="learn-layout"><aside class="learn-sidebar"><nav aria-label="Course lessons"><h2>The learning path</h2>{curriculum}</nav></aside><article class="lesson-body"><nav class="lesson-toc" aria-label="In this lesson"><h2>In this lesson</h2>{toc}</nav>{markdown(source)}<nav class="lesson-pager" aria-label="Previous and next lessons">{previous}{following}</nav></article></div></div>''')
print(f'Rendered overview and {len(lessons)} lessons.')
