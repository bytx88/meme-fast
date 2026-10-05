"""Build Learn and its foundation, dev/supply, trading, and position paths from local course content."""
from pathlib import Path
import html
import json
import runpy
import re

ROOT = Path(__file__).resolve().parents[1]
shared = runpy.run_path(str(ROOT / 'scripts/render-meme-101.py'))
page = shared['page']
escape = html.escape
dev_tools = runpy.run_path(str(ROOT / 'scripts/render-101c-tools.py'))
template = '101C token review\nAdd source links and UTC check times to each entry.\n\n' + '\n\n'.join(
    label + '\n' + help_text + '\n' for _, label, help_text in dev_tools['FIELDS'])
(ROOT / 'dist/101c-review-template.txt').write_text(template.rstrip() + '\n', encoding='utf-8')
courses = [json.loads(path.read_text(encoding='utf-8')) for path in sorted((ROOT / 'content/meme-202').glob('202?.json'))]
courses.insert(0, json.loads((ROOT / 'content/meme-101b/course.json').read_text(encoding='utf-8')))
courses.insert(1, json.loads((ROOT / 'content/meme-101c/course.json').read_text(encoding='utf-8')))
courses.append(json.loads((ROOT / 'content/meme-303/303a.json').read_text(encoding='utf-8')))
archived_303b = json.loads((ROOT / 'content/meme-303/303b.json').read_text(encoding='utf-8'))
legacy_dev_targets = [9, 10, 11, 7, 7, 2]


def link(route, label, **attrs):
    if not (ROOT / 'dist' / route.split('#')[0]).is_file():
        raise ValueError(f'Missing destination: {route}')
    attributes = ''.join(f' {key.replace("_", "-")}="{escape(str(value), quote=True)}"' for key, value in attrs.items())
    return f'<a href="./{escape(route, quote=True)}"{attributes}>{escape(label)}</a>'


def flow(items):
    return '<ol class="course-flow">' + ''.join(f'<li>{escape(item)}</li>' for item in items) + '</ol>'


for course in courses:
    slug, code, name = course['slug'], course['code'], course['name']
    lessons = course['lessons']
    count = len(lessons)
    practical = {} if code == '101C' else json.loads((ROOT / f'content/curriculum/practical/{slug}.json').read_text(encoding='utf-8'))
    if code != '101C' and set(practical) != {str(i) for i in range(1, count + 1)}:
        raise ValueError(f'{slug}: incomplete practical chapter coverage')
    if not count:
        raise ValueError(f'{code} needs chapters')
    for i, lesson in enumerate(lessons, 1):
        if code == '101C':
            source = (ROOT / lesson['body_file']).read_text(encoding='utf-8')
            for required in ['## How to investigate', '## Practical case', '## Check your understanding']:
                if required not in source:
                    raise ValueError(f'{slug}.{i}: missing learning section {required}')
            headings = re.findall(r'^## (.+)$', source, re.M)
            toc = '<nav class="lesson-toc" aria-label="In this lesson"><h2>In this lesson</h2>' + ''.join(
                f'<a href="#{re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")}">{escape(title)}</a>' for title in headings) + '</nav>'
            if i == 13:
                toc = toc.replace('</nav>', '<a href="#review-worksheet">Your review worksheet</a></nav>')
            curriculum = '<nav aria-label="Course chapters"><h2>101C · Dev &amp; Supply</h2>' + ''.join(
                f'<a href="./{slug}-lesson-{n}.html"' + (' aria-current="page"' if n == i else '') + f'><span>{n:02}</span>{escape(item["title"])}</a>'
                for n, item in enumerate(lessons, 1)) + '</nav>'
            previous = f'{slug}-lesson-{i-1}.html' if i > 1 else f'{slug}.html'
            following = f'{slug}-lesson-{i+1}.html' if i < count else f'{slug}.html'
            refs = ''.join(f'<p><a href="{escape(url, quote=True)}" target="_blank" rel="noopener noreferrer">{escape(label)} ↗</a></p>' for label, url in lesson.get('references', []))
            refs = '<section class="course-references"><h2>Mechanism references</h2>' + refs + '</section>' if refs else ''
            lesson_html = shared['markdown'](source)
            case_heading = '<h2 id="practical-case-illustrative">'
            lesson_html = lesson_html.replace(case_heading, dev_tools['field_guide'](i) + case_heading, 1)
            checks_heading = '<h2 id="check-your-understanding-answered">'
            lesson_html = lesson_html.replace(checks_heading,
                (dev_tools['worksheet']() if i == 13 else dev_tools['record_link'](i)) + checks_heading, 1)
            if i == 10:
                paths = [('Dev side', ['Create', 'Launch', 'Market', 'Improve', 'Monetize', 'Reinvest / Exit']),
                         ('Buyer side', ['Discover', 'Assess', 'Enter', 'Monitor', 'Add / Hold / Exit', 'Reassess'])]
                diagram = '<figure class="dev-buyer-cycle"><figcaption>What the dev and buyers do</figcaption>'
                for label, actions in paths:
                    diagram += f'<div><h3>{label}</h3><ol>' + ''.join(f'<li>{action}</li>' for action in actions) + '</ol></div>'
                diagram += '<p>Check how work, promotion, sales, fees, and liquidity affect continued buying.</p></figure>'
                lesson_html = diagram + lesson_html
            body = (f'<div class="learn-content applied-page" id="lesson-content"><p class="learn-breadcrumb">{link("learn.html", "Learn")} / <a href="./{slug}.html">101C · Dev &amp; Supply</a> / {i:02}</p>'
                    f'<header class="learn-intro"><span class="kicker">101C.{i} / CHAPTER {i} OF {count}</span><h1>{escape(lesson["title"])}</h1><p>{escape(lesson["question"])}</p></header>'
                    f'<div class="learn-layout"><aside class="learn-sidebar">{curriculum}</aside><article class="lesson-body">{toc}{lesson_html}{refs}'
                    f'<p class="learn-muted">SAMPLE is made up for this course. For a real token, use current transaction records and platform rules. Inspect shows sampled trades; use external records to check ownership and permissions.</p>'
                    f'<nav class="lesson-pager" aria-label="Previous and next chapters"><a href="./{previous}">← Previous</a><a href="./{following}">Next →</a></nav></article></div></div>')
            page(f'{slug}-lesson-{i}', f'101C.{i} · {lesson["title"]}', lesson['question'], body)
            continue
        if len(lesson['checks']) != 3 or len(lesson['example']) != 3:
            raise ValueError(f'{code}.{i}: use three checks and three example steps')
        steps = [
            ('Definition', f'<p>{escape(lesson["definition"])}</p>'),
            ('Why it matters', f'<p>{escape(lesson["why"])}</p>'),
            ('What to check', '<ul>' + ''.join(f'<li>{escape(check)}</li>' for check in lesson['checks']) + '</ul>'),
            ('Healthy / Dangerous', f'<div class="concept-comparison"><div class="concept-healthy"><h3>Healthy</h3><p>{escape(lesson["healthy"])}</p></div><div class="concept-dangerous"><h3>Dangerous</h3><p>{escape(lesson["dangerous"])}</p></div></div>'),
            ('Beginner mistake', f'<p>{escape(lesson["mistake"])}</p>'),
            ('Takeaway', f'<p><strong>{escape(lesson["takeaway"])}</strong></p>')
        ]
        concept = '<section class="lesson-concept applied-concept" aria-label="Quick read">'
        for step, (label, body) in enumerate(steps, 1):
            modifier = ' concept-takeaway' if step == 6 else ' concept-mistake' if step == 5 else ''
            concept += f'<div class="concept-step{modifier}"><h2><span class="step-number">{step:02}</span>{label}</h2>{body}</div>'
        concept += '</section>'
        framework = '<aside class="lesson-framework" aria-label="Working model">' + ''.join(f'<p>{escape(item)}</p>' for item in lesson.get('framework', [])) + '</aside>' if lesson.get('framework') else ''
        example = '<section class="applied-example" aria-labelledby="example-title"><span class="kicker">ILLUSTRATIVE · NOT A LIVE TOKEN</span><h2 id="example-title">See the idea</h2><ol>'
        example += ''.join(f'<li><span>{n:02}</span><p>{escape(text)}</p></li>' for n, text in enumerate(lesson['example'], 1)) + '</ol></section>'
        guide = practical[str(i)]
        if guide['title'] != lesson['title']:
            raise ValueError(f'{slug}.{i}: practical content title does not match')
        investigation = ('<section class="practical-investigation" aria-labelledby="investigation-title">'
                         '<span class="kicker">WORKED INVESTIGATION · ILLUSTRATIVE</span>'
                         '<h2 id="investigation-title">Work through the evidence</h2>'
                         f'<h3>Mechanism and worked case</h3><p>{escape(guide["walkthrough"])}</p>'
                         f'<h3>How to investigate it</h3><p>{escape(guide["method"])}</p>'
                         f'<h3>Check your reasoning — answered</h3><p>{escape(guide["exercise"])}</p></section>')
        if 'evidence' in lesson:
            tool, route, note = lesson['evidence']
            evidence = f'<section class="applied-handoff" aria-label="Try the evidence"><h2>Try it on a token</h2>{link(route, "See it in Meme Fast → " + tool)}<p>{escape(note)}</p></section>'
        else:
            evidence = f'<section class="applied-handoff" aria-label="External research"><h2>Trace it externally</h2><p>{escape(lesson["external"])}</p></section>'
        references = ''.join(f'<p><a href="{escape(url, quote=True)}" target="_blank" rel="noopener noreferrer">{escape(label)} ↗</a></p>' for label, url in lesson.get('references', []))
        related = ''.join(f'<p><a href="./{escape(route, quote=True)}">{escape(label)} →</a></p>' for label, route in lesson.get('related', []))
        deeper = f'<details class="applied-deeper"><summary>Go deeper</summary><p>{escape(lesson["deeper"])}</p>{references}{related}</details>'
        level, anchor = lesson['foundation']
        foundation = f'<p class="applied-foundation">Need the basics? {link(f"meme-101-level-{level}.html#{anchor}", "Revisit 101A →")}</p>'
        # All destinations are rendered in this pass; validate links after generation.
        curriculum = f'<nav aria-label="Course chapters"><h2>{count} chapters with worked investigations</h2>'
        for n, chapter in enumerate(lessons, 1):
            current = ' aria-current="page"' if n == i else ''
            curriculum += f'<a href="./{slug}-lesson-{n}.html"{current}><span>{n:02}</span>{escape(chapter["title"])}</a>'
        curriculum += '</nav>'
        previous = f'<a href="./{slug}-lesson-{i-1}.html">← Previous chapter</a>' if i > 1 else f'<a href="./{slug}.html">← Course overview</a>'
        following = f'<a href="./{slug}-lesson-{i+1}.html">Next chapter →</a>' if i < count else f'<a href="./{slug}.html">Return to overview →</a>'
        body = f'''<div class="learn-content applied-page" id="lesson-content"><p class="learn-breadcrumb"><a href="./learn.html">Learn</a> / <a href="./{slug}.html">{code} · {escape(name)}</a> / {i:02}</p><header class="learn-intro"><span class="kicker">{code}.{i} / CHAPTER {i} OF {count}</span><h1>{escape(lesson['title'])}</h1><p>{escape(lesson['question'])}</p></header><div class="learn-layout"><aside class="learn-sidebar">{curriculum}</aside><article class="lesson-body applied-body">{concept}{framework}{example}{investigation}{evidence}{deeper}{foundation}<nav class="lesson-pager" aria-label="Previous and next chapters">{previous}{following}</nav></article></div></div>'''
        page(f'{slug}-lesson-{i}', f'{code}.{i} · {lesson["title"]}', lesson['question'], body)
    cards = ''.join(f'<a class="lesson-card" href="./{slug}-lesson-{i}.html"><span>{code}.{i}</span><h2>{escape(lesson["title"])}</h2><p>{escape(lesson["question"])}</p><strong>Read chapter →</strong></a>' for i, lesson in enumerate(lessons, 1))
    tool, route = course['tool']
    if code == '101B':
        context = 'Build on <a href="./meme-101.html">101A · Foundations</a>, then choose <a href="./meme-202a.html">202A · Snipe</a> or <a href="./meme-202b.html">202B · Swing</a>.'
        following_course = '<a href="./meme-101c.html">Continue to 101C · Dev &amp; Supply →</a>'
    elif code == '101C':
        context = 'Follow SAMPLE through all 13 chapters. Build a wallet list, supply record, unlock calendar, transaction ledger, and final review. The numbers and wallet labels are illustrative.'
        following_course = '<a href="./meme-202a.html">Apply the evidence in 202A · Snipe →</a> / <a href="./meme-202b.html">202B · Swing →</a>'
    elif code == '303A':
        context = 'Build on <a href="./meme-101b.html">101B · Survival &amp; Hygiene</a> and the evidence lenses in <a href="./meme-202a.html">202A · Snipe</a> / <a href="./meme-202b.html">202B · Swing</a>.'
        following_course = '<a href="./meme-101c.html">Revisit 101C · Dev &amp; Supply →</a>'
    else:
        other = next(item for item in courses if item['code'].startswith('202') and item != course)
        context = 'Build on <a href="./meme-101.html">101A · Foundations</a> and <a href="./meme-101b.html">101B · Survival &amp; Hygiene</a>. Choose the question that fits the token; the applied tracks can overlap.'
        following_course = f'<a href="./{other["slug"]}.html">Explore {other["code"]} · {other["name"]} →</a> / <a href="./meme-303a.html">Next: 303A · Managing Your Position →</a>'
    category = 'SURVIVAL BASICS' if code == '101B' else 'MANAGE EXPOSURE' if code == '303A' else 'UNDERSTAND THE SUPPLY SIDE' if code == '101C' else 'APPLIED LEARNING'
    principle = f'<aside class="course-principle"><p>{escape(course["principle"])}</p></aside>' if course.get('principle') else ''
    orientation = ('<section class="learn-route"><h2>What you will check</h2><p>Start with the short introduction in Chapter 1. '
        'Chapters 1–2 trace wallets; 3–6 check supply, permissions, unlocks, and liquidity; 7–9 track earnings, buyers, and sales; '
        '10–12 compare creator work with buyer activity. Chapter 13 brings your records together.</p>'
        '<p><a href="./meme-101c-lesson-13.html#review-worksheet">Open your review worksheet →</a> '
        'Save notes in this browser or download a copy. Answers stay visible in every chapter.</p></section>') if code == '101C' else ''
    body = f'''<article class="learn-content applied-page" id="lesson-content"><header class="learn-intro"><span class="kicker">{category} / {code}</span><h1>{code} · {escape(name)}</h1><p>{escape(course['question'])}</p><p class="learn-muted">{escape(course['intro'])}</p><a class="learn-start" href="./{slug}-lesson-1.html">Start chapter 1 →</a><span class="course-count">{count} chapters with worked investigations · examples + evidence</span></header>{principle}{flow(course['lens'])}<p class="course-context">{context}</p>{orientation}<div class="lesson-grid">{cards}</div><section class="learn-next"><h2>Learn, then investigate</h2><p>{link(route, "Open " + tool + " →")} <span class="learning-divider">/</span> {following_course}</p></section></article>'''
    page(slug, f'{code} · {name}', course['intro'], body)

course_cards = '<a class="course-card" href="./meme-101.html"><span>START HERE / 101A</span><h2>Foundations</h2><p>What am I looking at?</p><small>Token numbers, launch, ownership, flow, attention, and risk.</small><strong>8 foundation levels →</strong></a>'
card_labels = {'101B': 'THEN / 101B', '101C': 'THEN / 101C', '202A': 'CHOOSE YOUR LENS / 202A', '202B': 'CHOOSE YOUR LENS / 202B', '303A': 'MANAGE YOUR EXPOSURE / 303A'}
for course in courses:
    description = ('See beyond the visible dev wallet. Understand who controls supply, what they can change or sell, how they earn, and how their incentives affect buyers.'
                   if course['code'] == '101C' else course['intro'])
    course_cards += f'<a class="course-card" href="./{course["slug"]}.html"><span>{card_labels[course["code"]]}</span><h2>{escape(course["name"])}</h2><p>{escape(course["question"])}</p><small>{escape(description)}</small><strong>{len(course["lessons"])} chapters with worked investigations →</strong></a>'
page('learn', 'Learn', 'Understand what you are buying into. Learn token mechanics, demand and supply hygiene, creator incentives, market evidence, and position management.', f'''<article class="learn-content learning-hub" id="lesson-content"><header class="learn-intro"><span class="kicker">LEARN / SEE BOTH SIDES</span><h1>Understand what you’re buying into.</h1><p>Read the buyer side and the supply side. Test why demand might arrive—and who controls the inventory, permissions, liquidity, and incentives behind the token.</p><p class="learn-muted">Supply hygiene helps uncover structural risks. It does not guarantee market demand. A convincing story does not clear the supply checks.</p></header><section class="learn-question" aria-labelledby="lesson-promise"><h2 id="lesson-promise">What every lesson should help you do</h2><p>Understand what it is, how it works, where and how to check, what the evidence means, and what you still cannot see.</p></section><nav class="learn-route" aria-label="Recommended learning path"><h2>Your learning path</h2><ol><li><a href="./meme-101.html">101A · Understand the basics</a></li><li><a href="./meme-101b.html">101B · Check thesis and hygiene</a></li><li><a href="./meme-101c.html">101C · Understand the dev and supply</a></li><li>Choose your market lens: <a href="./meme-202a.html">202A · Snipe</a> or <a href="./meme-202b.html">202B · Swing</a></li><li><a href="./meme-303a.html">303A · Manage your exposure</a></li></ol><p>Start with 101A if you are new. Use 101B and 101C before applying a market lens; Snipe and Swing are alternatives for different questions. Return to earlier checks when conditions change.</p></nav><div class="course-grid">{course_cards}</div><section class="learn-next"><h2>Build the case, then check it</h2><p>101A explains the token. 101B separates the demand thesis from hygiene. 101C teaches the creator and supply mechanics, then the dev–buyer relationship. Together they prepare you to investigate the early move in 202A or later structure in 202B. 303A turns that evidence into exposure limits, reassessment, and exit planning.</p></section></article>''')
position_courses = [course for course in courses if course['code'].startswith('303')]
position_cards = ''.join(f'<a class="course-card" href="./{course["slug"]}.html"><span>{course["code"]}</span><h2>{escape(course["name"])}</h2><p>{escape(course["question"])}</p><strong>{len(course["lessons"])} chapters with worked investigations →</strong></a>' for course in position_courses)
page('meme-303', '303 · Your Position', 'Manage exposure in 303A; dev and supply mechanics are consolidated in 101C.', f'<article class="learn-content learning-hub" id="lesson-content"><header class="learn-intro"><h1>Manage your position.</h1><p>Creator inventory, incentives, and the dev–buyer relationship now belong in <a href="./meme-101c.html">101C · Dev &amp; Supply</a>.</p></header><div class="course-grid">{position_cards}</div></article>')


def write_redirect(old_slug, target, label):
    document = (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                f'<title>{escape(label)}</title><link rel="canonical" href="https://meme.oneerp.org/{target}">'
                f'<meta http-equiv="refresh" content="0;url=./{target}"></head><body><p>This material is now in 101C · Dev &amp; Supply.</p>'
                f'<a href="./{target}">{escape(label)} →</a></body></html>\n')
    (ROOT / 'dist' / f'{old_slug}.html').write_text(document, encoding='utf-8')

write_redirect('meme-101-bundles', 'meme-101c-lesson-1.html', 'Bundles: what you are buying into')
write_redirect('meme-101b-lesson-9', 'meme-101c-lesson-2.html', 'Primary address, side wallets & blind spots')
write_redirect('meme-303b', 'meme-101c.html', '101C · Understand the Dev & Supply')
for i, target in enumerate(legacy_dev_targets, 1):
    write_redirect(f'meme-303b-lesson-{i}', f'meme-101c-lesson-{target}.html', archived_303b['lessons'][i-1]['title'])
legacy_numbers = []
for course in position_courses:
    for i, lesson in enumerate(course['lessons'], 1):
        old = lesson['legacy_lesson']
        legacy_numbers.append(old)
        target = f'{course["slug"]}-lesson-{i}.html'
        label = escape(f'{course["code"]}.{i} · {lesson["title"]}')
        redirect = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{label}</title><link rel="canonical" href="https://meme.oneerp.org/{target}"><meta http-equiv="refresh" content="0;url=./{target}"></head><body><p>This chapter is now in {course["code"]}.</p><a href="./{target}">Continue to {label} →</a></body></html>\n'
        (ROOT / 'dist' / f'meme-303-lesson-{old}.html').write_text(redirect, encoding='utf-8')
for chapter, target in zip(archived_303b['lessons'], legacy_dev_targets):
    legacy_numbers.append(chapter['legacy_lesson'])
    write_redirect(f"meme-303-lesson-{chapter['legacy_lesson']}", f'meme-101c-lesson-{target}.html', chapter['title'])
if sorted(legacy_numbers) != list(range(1, 18)):
    raise ValueError('All 17 legacy 303 chapters must map exactly once')

sitemap_path = ROOT / 'dist/sitemap.xml'
sitemap = sitemap_path.read_text(encoding='utf-8')
sitemap = re.sub(r'\s*<url><loc>https://meme\.oneerp\.org/(?:meme-303-lesson-\d+|meme-303b(?:-lesson-\d+)?|meme-101-bundles|meme-101b-lesson-9)\.html</loc></url>', '', sitemap)
slugs = ['learn'] + [course['slug'] for course in courses] + [f'{course["slug"]}-lesson-{i}' for course in courses for i in range(1, len(course["lessons"])+1)]
entries = ''.join(f'  <url><loc>https://meme.oneerp.org/{slug}.html</loc></url>\n' for slug in slugs if f'/{slug}.html</loc>' not in sitemap)
sitemap_path.write_text(sitemap.replace('</urlset>', entries + '</urlset>'), encoding='utf-8')
print(f'Rendered Learn and {len(courses)} courses: {sum(len(course["lessons"]) for course in courses)} chapters.')
