"""Present the fixed 101C topic coverage in ten beginner-first sections."""
import html
import re

TOPIC_SECTIONS = {1: 5, 2: 5, 3: 4, 4: 6, 5: 6, 6: 7, 7: 8,
                  8: 8, 9: 9, 10: 3, 11: 9, 12: 9, 13: 10}


def presentation_text(source):
    source = source.replace('Chapters 1–12', 'Sections 1–9')
    source = re.sub(r'Chapter (\d+)', lambda m: f'Section {TOPIC_SECTIONS[int(m[1])]}', source)
    return source.replace('Later chapters', 'Later sections')


def render(root, course, shared, tools):
    escape = html.escape
    sections = course['sections']
    if len(sections) != 10:
        raise ValueError('101C presentation requires ten sections')
    assigned = [topic for section in sections for topic in section.get('topics', [])]
    if sorted(assigned) != list(range(1, 14)):
        raise ValueError('Preserve each of the thirteen original topics exactly once')
    route = lambda number: f'meme-101c-section-{number}.html'
    for number, section in enumerate(sections, 1):
        parts, references = [], []
        if section.get('body_file'):
            parts.append(('basics' if number == 1 else 'importance', section['title'],
                          (root / section['body_file']).read_text(encoding='utf-8'), None))
        for topic in section.get('topics', []):
            lesson = course['lessons'][topic - 1]
            parts.append((f'topic-{topic}', lesson['title'], presentation_text(
                (root / lesson['body_file']).read_text(encoding='utf-8')), topic))
            references.extend(lesson.get('references', []))
        toc = '<nav class="lesson-toc" aria-label="In this section"><h2>In this section</h2>'
        content = ''
        for anchor, title, source, topic in parts:
            rendered = shared['markdown'](source)
            if topic:
                rendered = rendered.replace('<h2 id="practical-case-illustrative">',
                    tools['field_guide'](topic) + '<h2 id="practical-case-illustrative">', 1)
            rendered = rendered.replace('<h2 id="check-your-understanding-answered">',
                (tools['worksheet']() if topic == 13 else tools['record_link'](topic or 13)) +
                '<h2 id="check-your-understanding-answered">', 1)
            # Namespaced topic anchors keep merged investigation/case headings unique.
            ids = re.findall(r' id="([^"]+)"', rendered)
            for identifier in ids:
                if identifier.startswith(('review-', 'help-')) or identifier in ('worksheet-title', 'token-review'):
                    continue
                rendered = rendered.replace(f'id="{identifier}"', f'id="{anchor}-{identifier}"')
                rendered = rendered.replace(f'href="#{identifier}"', f'href="#{anchor}-{identifier}"')
                rendered = rendered.replace(f'aria-labelledby="{identifier}"', f'aria-labelledby="{anchor}-{identifier}"')
            if len(parts) == 1:
                for heading in re.findall(r'^## (.+)$', source, re.M):
                    identifier = re.sub(r'[^a-z0-9]+', '-', heading.lower()).strip('-')
                    toc += f'<a href="#{anchor}-{identifier}">{escape(heading)}</a>'
            else:
                toc += f'<a href="#{anchor}">{escape(title)}</a>'
            content += f'<section class="course-topic" id="{anchor}">'
            if len(parts) > 1:
                content += f'<h2 class="topic-title">{escape(title)}</h2>'
            if topic:
                content += f'<p class="topic-question">{escape(course["lessons"][topic - 1]["question"])}</p>'
            if topic == 3:
                content += '<p>Record what each holder paid to acquire tokens. An allocation and a later market purchase can have very different costs. Section 9 shows how to reconstruct purchases and sales from transactions.</p>'
            content += rendered + '</section>'
        if number == 3:
            content = ('<figure class="dev-buyer-cycle"><figcaption>What the dev and buyers do</figcaption>'
                '<div><h3>Dev side</h3><ol><li>Create</li><li>Launch</li><li>Promote</li><li>Deliver work</li><li>Earn</li><li>Reinvest or leave</li></ol></div>'
                '<div><h3>Buyer side</h3><ol><li>Discover</li><li>Check</li><li>Buy</li><li>Monitor</li><li>Add, hold, or sell</li><li>Check again</li></ol></div>'
                '<p>Compare the dev’s work, earnings, and sales with buyer activity and liquidity.</p></figure>') + content
        if number == 10:
            toc += '<a href="#review-worksheet">Your review worksheet</a>'
        toc += '</nav>'
        sidebar = '<nav aria-label="Course sections"><h2>101C · Dev &amp; Supply</h2>' + ''.join(
            f'<a href="./{route(n)}"' + (' aria-current="page"' if n == number else '') +
            f'><span>{n:02}</span>{escape(item["title"])}</a>' for n, item in enumerate(sections, 1)) + '</nav>'
        refs = ''.join(f'<p><a href="{escape(url, quote=True)}" target="_blank" rel="noopener noreferrer">{escape(label)} ↗</a></p>'
                       for label, url in dict.fromkeys(tuple(ref) for ref in references))
        if refs:
            refs = '<section class="course-references"><h2>Mechanism references</h2>' + refs + '</section>'
        previous = route(number - 1) if number > 1 else 'meme-101c.html'
        following = route(number + 1) if number < 10 else 'meme-101c.html'
        body = (f'<div class="learn-content applied-page" id="lesson-content"><p class="learn-breadcrumb"><a href="./learn.html">Learn</a> / <a href="./meme-101c.html">101C · Dev &amp; Supply</a> / {number:02}</p>'
            f'<header class="learn-intro"><span class="kicker">101C / SECTION {number} OF 10</span><h1>{escape(section["title"])}</h1><p>{escape(section["question"])}</p></header>'
            f'<div class="learn-layout"><aside class="learn-sidebar">{sidebar}</aside><article class="lesson-body">{toc}{content}{refs}'
            '<p class="learn-muted">SAMPLE is made up for this course. Date each finding. For a real token, use current transaction records and platform rules. Inspect shows sampled trades; use external records to check ownership and permissions.</p>'
            f'<nav class="lesson-pager" aria-label="Previous and next sections"><a href="./{previous}">← Previous</a><a href="./{following}">Next →</a></nav></article></div></div>')
        shared['page'](route(number)[:-5], f'101C.{number} · {section["title"]}', section['question'], body)
    cards = ''.join(f'<a class="lesson-card" href="./{route(n)}"><span>101C.{n}</span><h2>{escape(item["title"])}</h2><p>{escape(item["question"])}</p><strong>Read section →</strong></a>' for n, item in enumerate(sections, 1))
    body = ('<article class="learn-content applied-page" id="lesson-content"><header class="learn-intro"><span class="kicker">UNDERSTAND THE DEV &amp; SUPPLY / 101C</span>'
        f'<h1>101C · {escape(course["name"])}</h1><p>{escape(course["question"])}</p><p class="learn-muted">{escape(course["intro"])}</p>'
        '<a class="learn-start" href="./meme-101c-section-1.html">Start with the basic terms →</a><span class="course-count">10 sections · explanations, examples, and evidence checks</span></header>'
        f'<aside class="course-principle"><p>{escape(course["principle"])}</p></aside>'
        '<section class="learn-route"><h2>How to use this course</h2><p>Start with the terms, why they matter, and the dev–trader relationship. Then check creation, wallets, permissions, liquidity, earnings, and sales. Finish with one token review.</p>'
        '<p>All the original topics are included. Each section gives you practical checks and visible answers. SAMPLE is a made-up example; its dated snapshots help you compare the records.</p>'
        '<p><a href="./meme-101c-section-10.html#review-worksheet">Open your review worksheet →</a> Save notes in this browser or download a copy.</p></section>'
        f'<div class="lesson-grid">{cards}</div><section class="learn-next"><h2>Learn, then investigate</h2><p><a href="./order-flow.html">Open Inspect →</a> / <a href="./meme-202a.html">202A · Snipe →</a> / <a href="./meme-202b.html">202B · Swing →</a></p></section></article>')
    shared['page']('meme-101c', '101C · ' + course['name'], course['intro'], body)
