"""Build Learn, 101, and the concise 202A/202B paths from local course content."""
from pathlib import Path
import html
import json
import runpy
import re

ROOT = Path(__file__).resolve().parents[1]
shared = runpy.run_path(str(ROOT / 'scripts/render-meme-101.py'))
page = shared['page']
escape = html.escape
courses = [json.loads(path.read_text(encoding='utf-8')) for path in sorted((ROOT / 'content/meme-202').glob('202?.json'))]
courses.insert(0, json.loads((ROOT / 'content/meme-101b/course.json').read_text(encoding='utf-8')))
courses.extend(json.loads((ROOT / f'content/meme-303/303{track}.json').read_text(encoding='utf-8')) for track in ['a', 'b'])


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
    practical = json.loads((ROOT / f'content/curriculum/practical/{slug}.json').read_text(encoding='utf-8'))
    if set(practical) != {str(i) for i in range(1, count + 1)}:
        raise ValueError(f'{slug}: incomplete practical chapter coverage')
    if not count:
        raise ValueError(f'{code} needs chapters')
    for i, lesson in enumerate(lessons, 1):
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
        following_course = '<a href="./meme-202a.html">Continue to 202A · Snipe →</a> / <a href="./meme-202b.html">202B · Swing →</a>'
    elif code == '303A':
        context = 'Build on <a href="./meme-101b.html">101B · Survival &amp; Hygiene</a> and the evidence lenses in <a href="./meme-202a.html">202A · Snipe</a> / <a href="./meme-202b.html">202B · Swing</a>.'
        following_course = '<a href="./meme-303b.html">Next: 303B · Actor Inventory &amp; Incentives →</a>'
    elif code == '303B':
        context = 'Build on <a href="./meme-101b.html">101B · Survival &amp; Hygiene</a> and <a href="./meme-303a.html">303A · Managing Your Position</a>. Use actor evidence to reassess your own exposure.'
        following_course = '<a href="./meme-303a.html">Revisit 303A · Managing Your Position →</a>'
    else:
        other = next(item for item in courses if item['code'].startswith('202') and item != course)
        context = 'Build on <a href="./meme-101.html">101A · Foundations</a> and <a href="./meme-101b.html">101B · Survival &amp; Hygiene</a>. Choose the question that fits the token; the applied tracks can overlap.'
        following_course = f'<a href="./{other["slug"]}.html">Explore {other["code"]} · {other["name"]} →</a> / <a href="./meme-303a.html">Next: 303A · Managing Your Position →</a>'
    category = 'SURVIVAL BASICS' if code == '101B' else 'MANAGE EXPOSURE' if code == '303A' else 'READ THE ACTORS' if code == '303B' else 'APPLIED LEARNING'
    principle = f'<aside class="course-principle"><p>{escape(course["principle"])}</p></aside>' if course.get('principle') else ''
    body = f'''<article class="learn-content applied-page" id="lesson-content"><header class="learn-intro"><span class="kicker">{category} / {code}</span><h1>{code} · {escape(name)}</h1><p>{escape(course['question'])}</p><p class="learn-muted">{escape(course['intro'])}</p><a class="learn-start" href="./{slug}-lesson-1.html">Start chapter 1 →</a><span class="course-count">{count} chapters with worked investigations · examples + evidence</span></header>{principle}{flow(course['lens'])}<p class="course-context">{context}</p><div class="lesson-grid">{cards}</div><section class="learn-next"><h2>Learn, then investigate</h2><p>{link(route, "Open " + tool + " →")} <span class="learning-divider">/</span> {following_course}</p></section></article>'''
    page(slug, f'{code} · {name}', course['intro'], body)

course_cards = '<a class="course-card" href="./meme-101.html"><span>START HERE / 101A</span><h2>Foundations</h2><p>What am I looking at?</p><small>Token numbers, launch, ownership, flow, attention, and risk.</small><strong>8 levels + bundle deep dive →</strong></a>'
for course in courses:
    course_cards += f'<a class="course-card" href="./{course["slug"]}.html"><span>NEXT LAYER / {course["code"]}</span><h2>{escape(course["name"])}</h2><p>{escape(course["question"])}</p><small>{escape(course["intro"])}</small><strong>{len(course["lessons"])} chapters with worked investigations →</strong></a>'
page('learn', 'Learn', '101A Foundations, 101B Survival & Hygiene, 202A Snipe, 202B Swing, 303A Managing Your Position, and 303B Actor Inventory & Incentives. Practical lessons with worked investigations and evidence.', f'''<article class="learn-content learning-hub" id="lesson-content"><header class="learn-intro"><span class="kicker">LEARN / CONNECT THE EVIDENCE</span><h1>Understand the move.</h1><p>Learn the mechanism. Work through the numbers. Investigate the evidence.</p><p class="learn-muted">Understand the token. Check what could kill the trade. Explore the move, then manage the exposure.</p></header><div class="course-grid">{course_cards}</div>{flow(['Understand the mechanism', 'Work through a case', 'Check the evidence'])}<section class="learn-next"><h2>Build the case, then check it</h2><p>101A explains the token. 101B separates thesis from hygiene. 202A investigates the early move; 202B investigates the structure after it. 303A manages your exposure. 303B reads the actors and incentives around it.</p></section></article>''')
position_courses = [course for course in courses if course['code'].startswith('303')]
position_cards = ''.join(f'<a class="course-card" href="./{course["slug"]}.html"><span>{course["code"]}</span><h2>{escape(course["name"])}</h2><p>{escape(course["question"])}</p><strong>{len(course["lessons"])} chapters with worked investigations →</strong></a>' for course in position_courses)
page('meme-303', '303 · Position & Actors', 'Choose 303A to manage your position or 303B to read actor inventory and incentives.', f'<article class="learn-content learning-hub" id="lesson-content"><header class="learn-intro"><span class="kicker">303 / TWO CONNECTED COURSES</span><h1>Your position. The actors around it.</h1><p>Start with your exposure, then read whose incentives can change the trade.</p></header><div class="course-grid">{position_cards}</div></article>')
legacy_numbers = []
for course in position_courses:
    for i, lesson in enumerate(course['lessons'], 1):
        old = lesson['legacy_lesson']
        legacy_numbers.append(old)
        target = f'{course["slug"]}-lesson-{i}.html'
        label = escape(f'{course["code"]}.{i} · {lesson["title"]}')
        redirect = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{label}</title><link rel="canonical" href="https://meme.oneerp.org/{target}"><meta http-equiv="refresh" content="0;url=./{target}"></head><body><p>This chapter is now in {course["code"]}.</p><a href="./{target}">Continue to {label} →</a></body></html>\n'
        (ROOT / 'dist' / f'meme-303-lesson-{old}.html').write_text(redirect, encoding='utf-8')
if sorted(legacy_numbers) != list(range(1, 18)):
    raise ValueError('All 17 legacy 303 chapters must map exactly once')

sitemap_path = ROOT / 'dist/sitemap.xml'
sitemap = sitemap_path.read_text(encoding='utf-8')
sitemap = re.sub(r'\s*<url><loc>https://meme\.oneerp\.org/meme-303-lesson-\d+\.html</loc></url>', '', sitemap)
slugs = ['learn'] + [course['slug'] for course in courses] + [f'{course["slug"]}-lesson-{i}' for course in courses for i in range(1, len(course["lessons"])+1)]
entries = ''.join(f'  <url><loc>https://meme.oneerp.org/{slug}.html</loc></url>\n' for slug in slugs if f'/{slug}.html</loc>' not in sitemap)
sitemap_path.write_text(sitemap.replace('</urlset>', entries + '</urlset>'), encoding='utf-8')
print(f'Rendered Learn and {len(courses)} courses: {sum(len(course["lessons"]) for course in courses)} chapters.')
