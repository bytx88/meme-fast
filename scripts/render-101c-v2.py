"""Present the fixed 101C topic coverage in ten beginner-first sections."""
import html
import re
import runpy

TOPIC_SECTIONS = {1: 5, 2: 5, 3: 4, 4: 6, 5: 6, 6: 7, 7: 8,
                  8: 8, 9: 9, 10: 3, 11: 9, 12: 9, 13: 10}


def render(root, course, shared, tools):
    escape = html.escape
    sections = course['sections']
    if len(sections) != 10:
        raise ValueError('101C presentation requires ten sections')
    assigned = [topic for section in sections for topic in section.get('topics', [])]
    if sorted(assigned) != list(range(1, 14)):
        raise ValueError('Preserve each of the thirteen original topics exactly once')
    visuals = runpy.run_path(str(root / 'scripts/render-101c-visuals.py'))
    route = lambda number: f'meme-101c-section-{number}.html'
    for number, section in enumerate(sections, 1):
        references = [reference for topic in section.get('topics', [])
                      for reference in course['lessons'][topic - 1].get('references', [])]
        source = (root / section['body_file']).read_text(encoding='utf-8')
        for heading in ['## How to investigate it', '## Practical case — illustrative', '## Keep this record', '## Check your understanding — answered']:
            if source.count(heading) != 1:
                raise ValueError(f'Section {number} needs one {heading}')
        chunks = source.split('[[TOKEN_LAUNCH_WALKTHROUGH]]')
        content = visuals['launch_walkthrough']().join(shared['markdown'](chunk) for chunk in chunks)
        guide = {4: 3, 5: 1, 6: 4}.get(number)
        if guide:
            content = content.replace('<h2 id="practical-case-illustrative">', tools['field_guide'](guide) + '<h2 id="practical-case-illustrative">', 1)
        record_topic = {1: 3, 2: 13, 3: 10, 4: 3, 5: 1, 6: 5, 7: 6, 8: 7, 9: 9, 10: 13}[number]
        content = content.replace('<h2 id="check-your-understanding-answered">',
            (tools['worksheet']() if number == 10 else tools['record_link'](record_topic)) + '<h2 id="check-your-understanding-answered">', 1)
        headings = re.findall(r'^## (.+)$', source, re.M)
        slugify = lambda value: re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')
        for identifier in re.findall(r' id="([^"]+)"', content):
            if identifier.startswith(('review-', 'help-')) or identifier in ('worksheet-title', 'token-review'):
                continue
            content = content.replace(f'id="{identifier}"', f'id="section-{number}-{identifier}"')
            content = content.replace(f'aria-labelledby="{identifier}"', f'aria-labelledby="section-{number}-{identifier}"')
        toc = '<nav class="lesson-toc" aria-label="In this section"><h2>In this section</h2>' + ''.join(
            f'<a href="#section-{number}-{slugify(title)}">{escape(title)}</a>' for title in headings)
        # Keep old topic and heading bookmarks landing on the equivalent part of the lesson.
        topic_starts = {1: 'What is a bundle?', 2: 'Look across the wallets', 3: 'Creating and launching a token',
                        4: 'Check what the creator can change', 5: 'Count the tokens available now', 6: 'Who controls the trading pool',
                        7: 'How the dev earns', 8: 'Promotion and actual buying', 9: 'Start with what the holders paid',
                        10: 'What each side wants', 11: 'Compare sales with spending and delivery',
                        12: 'Check previous launches and changing demand', 13: 'See beyond your own position'}
        for topic in section.get('topics', []):
            old_source = (root / course['lessons'][topic-1]['body_file']).read_text(encoding='utf-8')
            targets = {slugify(title) for title in headings}
            default = slugify(topic_starts[topic])
            aliases = {default: [f'topic-{topic}']}
            for title in re.findall(r'^## (.+)$', old_source, re.M):
                old_id = slugify(title)
                destination = old_id if old_id in targets else default
                aliases.setdefault(destination, []).append(f'topic-{topic}-{old_id}')
            for destination, identifiers in aliases.items():
                marker = f'<h2 id="section-{number}-{destination}">'
                if marker not in content:
                    raise ValueError(f'Missing bookmark destination: {marker}')
                content = content.replace(marker, ''.join(f'<span class="topic-bookmark" id="{identifier}"></span>' for identifier in identifiers) + marker, 1)
        if number == 3:
            content = ('<figure class="dev-buyer-cycle"><figcaption>What the dev and buyers do</figcaption>'
                '<div><h3>Dev side</h3><ol><li>Create</li><li>Launch</li><li>Promote</li><li>Deliver work</li><li>Earn</li><li>Reinvest or leave</li></ol></div>'
                '<div><h3>Buyer side</h3><ol><li>Discover</li><li>Check</li><li>Buy</li><li>Monitor</li><li>Add, hold, or sell</li><li>Check again</li></ol></div>'
                '<p>Compare the dev’s work, earnings, and sales with buyer activity and liquidity.</p></figure>') + content
        if number == 10:
            toc += '<a href="#review-worksheet">Your review worksheet</a>'
        toc += '</nav>'
        if number == 1:
            # Put the illustrated introduction first; the course navigation remains available.
            toc = ''
        sidebar = '<nav aria-label="Course sections"><h2>101C · Dev &amp; Supply</h2>' + ''.join(
            f'<a href="./{route(n)}"' + (' aria-current="page"' if n == number else '') +
            f'><span>{n:02}</span>{escape(item["title"])}</a>' for n, item in enumerate(sections, 1)) + '</nav>'
        sidebar = ('<div class="section-select" hidden><label for="section-picker">Go to section</label><select id="section-picker">' + ''.join(
            f'<option value="./{route(n)}"' + (' selected' if n == number else '') + f'>{n:02} · {escape(item["title"])}</option>'
            for n, item in enumerate(sections, 1)) + '</select></div>') + sidebar
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
            f'<nav class="lesson-pager" aria-label="Previous and next sections"><a href="./{previous}">← Previous</a><a href="./{following}">Next →</a></nav></article></div></div><script src="./101c-navigation.js" defer></script>')
        shared['page'](route(number)[:-5], f'101C.{number} · {section["title"]}', section['question'], body)
    cards = ''.join(f'<a class="lesson-card" href="./{route(n)}"><span>101C.{n}</span><h2>{escape(item["title"])}</h2><p>{escape(item["question"])}</p><strong>Read section →</strong></a>' for n, item in enumerate(sections, 1))
    body = ('<article class="learn-content applied-page" id="lesson-content"><header class="learn-intro"><span class="kicker">UNDERSTAND THE DEV &amp; SUPPLY / 101C</span>'
        f'<h1>101C · {escape(course["name"])}</h1><p>{escape(course["question"])}</p><p class="learn-muted">{escape(course["intro"])}</p>'
        '<a class="learn-start" href="./meme-101c-section-1.html">Start with the basic terms →</a><span class="course-count">10 sections · explanations, examples, and evidence checks</span></header>'
        f'<aside class="course-principle"><p>{escape(course["principle"])}</p></aside>'
        '<section class="learn-route"><h2>How to use this course</h2><p>Start with the terms, why they matter, and the dev–trader relationship. Then check creation, wallets, permissions, liquidity, earnings, and sales. Finish with one token review.</p>'
        '<p>Each section gives you practical checks and visible answers. SAMPLE is a made-up example; its dated snapshots help you compare the records.</p>'
        '<p><a href="./meme-101c-section-10.html#review-worksheet">Open your review worksheet →</a> Save notes in this browser or download a copy.</p></section>'
        f'<div class="lesson-grid">{cards}</div><section class="learn-next"><h2>Learn, then investigate</h2><p><a href="./order-flow.html">Open Inspect →</a> / <a href="./meme-202a.html">202A · Snipe →</a> / <a href="./meme-202b.html">202B · Swing →</a></p></section></article>')
    shared['page']('meme-101c', '101C · ' + course['name'], course['intro'], body)
