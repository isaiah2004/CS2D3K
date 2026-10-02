import { beforeAll, describe, expect, it } from 'vitest'
import { loadTestVault } from '../../../helpers/vault'
import { extractSubpath, renderFrontmatter, renderMarkdown } from '@/lib/markdown/render'

/** Render to a detached element so we can query the output like a user-visible DOM */
const render = (src: string, opts: Partial<Parameters<typeof renderMarkdown>[1]> = {}): HTMLElement => {
  const el = document.createElement('div')
  el.innerHTML = renderMarkdown(src, { sourcePath: 'notes/Source.md', ...opts })
  return el
}

beforeAll(async () => {
  await loadTestVault({
    'notes/Source.md': '# Source',
    'notes/Sibling.md': '# Sibling',
    'Top.md': '# Top',
    'My Note.md': '',
    'img/pic.png': ''
  })
})

describe('lib/markdown/render wikilinks', () => {
  it('renders a resolved wikilink as an internal link', () => {
    const a = render('see [[Sibling]]').querySelector('a')!
    expect(a.className).toBe('internal-link')
    expect(a.dataset.href).toBe('Sibling')
    expect(a.getAttribute('href')).toBe('#')
    expect(a.textContent).toBe('Sibling')
  })
  it('marks unresolved wikilinks', () => {
    const a = render('[[Missing]]').querySelector('a')!
    expect(a.classList.contains('is-unresolved')).toBe(true)
    expect(a.dataset.href).toBe('Missing')
  })
  it('shows the alias and keeps the subpath in data-href', () => {
    const a = render('[[Top#Intro|the intro]]').querySelector('a')!
    expect(a.textContent).toBe('the intro')
    expect(a.dataset.href).toBe('Top#Intro')
    expect(a.className).toBe('internal-link')
  })
  it('labels heading links as "Note > Heading"', () => {
    expect(render('[[Top#Intro]]').querySelector('a')!.textContent).toBe('Top > Intro')
  })
  it('treats same-document heading links as resolved', () => {
    const a = render('[[#Section]]').querySelector('a')!
    expect(a.className).toBe('internal-link')
    expect(a.textContent).toBe('Section')
    expect(a.dataset.href).toBe('#Section')
  })
  it('escapes html in link text', () => {
    const a = render('[[<b>x</b>]]').querySelector('a')!
    expect(a.textContent).toBe('<b>x</b>')
    expect(a.querySelector('b')).toBeNull()
  })
  it('leaves an unclosed wikilink as text', () => {
    const el = render('[[open')
    expect(el.querySelector('a')).toBeNull()
    expect(el.textContent).toContain('[[open')
  })
})

describe('lib/markdown/render embeds', () => {
  it('renders embeds as placeholders with source and alt', () => {
    const span = render('![[Top#^blk|caption]]').querySelector('span.internal-embed') as HTMLElement
    expect(span.dataset.src).toBe('Top#^blk')
    expect(span.dataset.alt).toBe('caption')
  })
  it('resolves relative markdown images to resource urls', () => {
    const img = render('![pic](../img/pic.png)').querySelector('img')!
    expect(img.getAttribute('src')).toBe('vault://local/img/pic.png')
  })
  it('leaves external and unresolved images alone', () => {
    const el = render('![a](https://x.com/a.png) ![b](nope.png)')
    expect([...el.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['https://x.com/a.png', 'nope.png'])
  })
})

describe('lib/markdown/render links', () => {
  it('opens external links in a new window', () => {
    const a = render('[site](https://example.com)').querySelector('a')!
    expect(a.className).toBe('external-link')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener')
    expect(a.getAttribute('href')).toBe('https://example.com')
  })
  it('linkifies bare urls as external links', () => {
    expect(render('go to https://example.com now').querySelector('a.external-link')!.getAttribute('href')).toBe('https://example.com')
  })
  it('renders relative markdown links as internal links with a decoded data-href', () => {
    const a = render('[n](../My%20Note.md#Head)').querySelector('a')!
    expect(a.className).toBe('internal-link')
    expect(a.dataset.href).toBe('../My Note.md#Head')
    expect(a.getAttribute('href')).toBe('#')
  })
  it('marks unresolved markdown links', () => {
    expect(render('[n](Nope.md)').querySelector('a')!.className).toBe('internal-link is-unresolved')
  })
  it('keeps same-document anchors untouched', () => {
    const a = render('[n](#head)').querySelector('a')!
    expect(a.getAttribute('href')).toBe('#head')
    expect(a.className).toBe('')
  })
})

describe('lib/markdown/render callouts', () => {
  it('renders a callout with type, title and content', () => {
    const q = render('> [!warning] Be careful\n> body text').querySelector('blockquote')!
    expect(q.className).toBe('callout')
    expect(q.dataset.callout).toBe('warning')
    expect(q.dataset.calloutFold).toBeUndefined()
    expect(q.querySelector('.callout-title-inner')!.textContent).toBe('Be careful')
    expect(q.querySelector('.callout-content')!.textContent!.trim()).toBe('body text')
    expect(q.querySelector('.callout-fold')).toBeNull()
  })
  it('defaults the title to the capitalized type and lowercases the type', () => {
    const q = render('> [!NOTE]\n> x').querySelector('blockquote')!
    expect(q.dataset.callout).toBe('note')
    expect(q.querySelector('.callout-title-inner')!.textContent).toBe('Note')
    expect(q.querySelector('.callout-content')!.textContent!.trim()).toBe('x')
  })
  it('renders a title-only callout without an empty paragraph', () => {
    const q = render('> [!tip] Just a title').querySelector('blockquote')!
    expect(q.querySelector('.callout-title-inner')!.textContent).toBe('Just a title')
    expect(q.querySelector('p')).toBeNull()
  })
  it('renders inline markdown in the title', () => {
    expect(render('> [!info] See [[Top]]').querySelector('.callout-title-inner a.internal-link')).not.toBeNull()
  })
  it('supports foldable callouts collapsed by default', () => {
    const q = render('> [!faq]- Question\n> answer').querySelector('blockquote')!
    expect(q.className).toBe('callout is-collapsed')
    expect(q.dataset.calloutFold).toBe('-')
    expect(q.querySelector('.callout-fold')).not.toBeNull()
  })
  it('supports foldable callouts expanded by default', () => {
    const q = render('> [!faq]+ Question\n> answer').querySelector('blockquote')!
    expect(q.className).toBe('callout')
    expect(q.dataset.calloutFold).toBe('+')
    expect(q.querySelector('.callout-fold')).not.toBeNull()
  })
  it('keeps later blocks inside the callout content', () => {
    const q = render('> [!note]\n> first\n>\n> second').querySelector('blockquote')!
    expect([...q.querySelectorAll('.callout-content p')].map((p) => p.textContent)).toEqual(['first', 'second'])
  })
  it('leaves plain blockquotes alone', () => {
    const q = render('> just a quote').querySelector('blockquote')!
    expect(q.classList.contains('callout')).toBe(false)
  })
})

describe('lib/markdown/render tasks', () => {
  it('turns task list items into checkboxes with their source line', () => {
    const el = render('intro\n\n- [ ] open\n- [x] done')
    const items = [...el.querySelectorAll('li')]
    expect(items.map((li) => li.className)).toEqual(['task-list-item', 'task-list-item is-checked'])
    expect(items.map((li) => li.dataset.task)).toEqual([' ', 'x'])
    const boxes = [...el.querySelectorAll('input.task-list-item-checkbox')] as HTMLInputElement[]
    expect(boxes.map((b) => [b.dataset.line, b.checked])).toEqual([
      ['2', false],
      ['3', true]
    ])
    expect(items[0].textContent).toBe('open')
  })
  it('accepts cancelled and in-progress markers as checked', () => {
    const items = [...render('- [-] cancelled\n- [/] doing').querySelectorAll('li')]
    expect(items.map((li) => li.dataset.task)).toEqual(['-', '/'])
    expect(items.every((li) => li.classList.contains('is-checked'))).toBe(true)
  })
  it('offsets data-line by the frontmatter length', () => {
    const el = render('---\ntitle: x\n---\n- [ ] first\n  - [X] nested')
    const lines = [...el.querySelectorAll('input.task-list-item-checkbox')].map((b) => (b as HTMLElement).dataset.line)
    expect(lines).toEqual(['3', '4'])
  })
  it('leaves non-task list items alone', () => {
    const el = render('- plain\n- [link](x)')
    expect(el.querySelector('input')).toBeNull()
    expect(el.querySelector('.task-list-item')).toBeNull()
  })
})

describe('lib/markdown/render inline syntax', () => {
  it('renders tags as clickable tag links', () => {
    const a = render('a #project/sub here').querySelector('a.tag') as HTMLElement
    expect(a.dataset.tag).toBe('project/sub')
    expect(a.textContent).toBe('#project/sub')
  })
  it('does not render tags glued to words, numeric tags or headings', () => {
    const el = render('# Heading\n\nabc#def and #123')
    expect(el.querySelector('a.tag')).toBeNull()
    expect(el.querySelector('h1')!.textContent).toBe('Heading')
  })
  it('renders ==highlight== as mark', () => {
    expect(render('some ==marked== text').querySelector('mark')!.textContent).toBe('marked')
  })
  it('does not highlight empty or unclosed markers', () => {
    expect(render('a ==== b').querySelector('mark')).toBeNull()
    expect(render('a ==open').querySelector('mark')).toBeNull()
  })
  it('gives headings a slug id and data-heading', () => {
    const h = render('## Hello, World').querySelector('h2')!
    expect(h.id).toBe('hello-world')
    expect(h.dataset.heading).toBe('Hello, World')
  })
  it('adds data-line to top-level blocks including the frontmatter offset', () => {
    const el = render('---\na: 1\n---\n# H\n\npara')
    expect(el.querySelector('h1')!.dataset.line).toBe('3')
    expect(el.querySelector('p')!.dataset.line).toBe('5')
  })
})

describe('lib/markdown/render code blocks', () => {
  it('wraps fenced code in a code-block with lang, line and copy button', () => {
    const block = render('text\n\n```js\nconst a = 1\n```').querySelector('.code-block') as HTMLElement
    expect(block.dataset.lang).toBe('js')
    expect(block.dataset.line).toBe('2')
    expect(block.querySelector('.code-block-lang')!.textContent).toBe('js')
    expect(block.querySelector('.code-block-copy')).not.toBeNull()
    expect(block.querySelector('code')!.className).toBe('hljs language-js')
    expect(block.querySelector('code')!.textContent).toBe('const a = 1')
    expect(block.querySelector('.code-block-output')!.hasAttribute('hidden')).toBe(true)
  })
  it('adds a run button only for runnable languages when enabled', () => {
    const runButtons = (src: string, runnable?: boolean) => render(src, { runnable }).querySelectorAll('.code-block-run').length
    expect(runButtons('```python\nprint(1)\n```', true)).toBe(1)
    expect(runButtons('```Python\nprint(1)\n```', true)).toBe(1)
    expect(runButtons('```json\n{}\n```', true)).toBe(0)
    expect(runButtons('```\nplain\n```', true)).toBe(0)
    expect(runButtons('```python\nprint(1)\n```', false)).toBe(0)
    expect(runButtons('```python\nprint(1)\n```')).toBe(0)
  })
  it('uses only the first word of the info string as the language', () => {
    expect((render('```ts title="x"\nlet a\n```').querySelector('.code-block') as HTMLElement).dataset.lang).toBe('ts')
  })
  it('escapes code in unknown languages', () => {
    const code = render('```nolang\n<b>&</b>\n```').querySelector('code')!
    expect(code.textContent).toBe('<b>&</b>')
    expect(code.querySelector('b')).toBeNull()
  })
  it('offsets the code block line by the frontmatter', () => {
    expect((render('---\na: 1\n---\n```sh\nls\n```').querySelector('.code-block') as HTMLElement).dataset.line).toBe('3')
  })
  it('does not parse wikilinks or tags inside code', () => {
    const el = render('```\n[[Top]] #tag\n```\n\n`[[Top]] #tag`')
    expect(el.querySelector('a')).toBeNull()
  })
})

describe('lib/markdown/render frontmatter', () => {
  it('renders frontmatter as a properties block by default', () => {
    const el = render('---\ntitle: Hello\ntags: [a, b]\nempty:\n---\nbody')
    const rows = [...el.querySelectorAll('.frontmatter-properties .fm-row')]
    expect(rows.map((r) => r.querySelector('.fm-key')!.textContent)).toEqual(['title', 'tags', 'empty'])
    expect(rows[0].querySelector('.fm-value')!.textContent).toBe('Hello')
    expect([...rows[1].querySelectorAll('.fm-pill')].map((p) => p.textContent)).toEqual(['a', 'b'])
    expect(rows[2].querySelector('.fm-value')!.textContent).toBe('')
    expect(el.querySelector('p')!.textContent).toBe('body')
  })
  it('hides the properties block when showFrontmatter is false but still strips it', () => {
    const el = render('---\ntitle: Hello\n---\nbody', { showFrontmatter: false })
    expect(el.querySelector('.frontmatter-properties')).toBeNull()
    expect(el.textContent).not.toContain('title')
  })
  it('escapes frontmatter keys and values', () => {
    const el = document.createElement('div')
    el.innerHTML = renderFrontmatter({ '<k>': '<v>' })
    expect(el.querySelector('.fm-key')!.textContent).toBe('<k>')
    expect(el.querySelector('.fm-value')!.textContent).toBe('<v>')
  })
})

describe('lib/markdown/render extractSubpath', () => {
  const doc = ['# Title', 'intro', '## A', 'a text', '### A.1', 'deep', '## B', 'b text ^blk1', 'last line ^blk2  '].join('\n')

  it('returns the whole source for an empty subpath', () => {
    expect(extractSubpath(doc, '')).toBe(doc)
  })
  it('extracts a heading section up to the next heading of the same or higher level', () => {
    expect(extractSubpath(doc, '#A')).toBe('## A\na text\n### A.1\ndeep')
  })
  it('matches headings case-insensitively and runs to the end of the file', () => {
    expect(extractSubpath('# X\n## b\nrest', '#B')).toBe('## b\nrest')
  })
  it('returns an empty string for unknown headings or blocks', () => {
    expect(extractSubpath(doc, '#Nope')).toBe('')
    expect(extractSubpath(doc, '#^nope')).toBe('')
  })
  it('extracts a block by id without the marker', () => {
    expect(extractSubpath(doc, '#^blk1')).toBe('b text')
  })
  it('strips the block marker even with trailing whitespace', () => {
    expect(extractSubpath(doc, '#^blk2')).toBe('last line')
  })
  it('strips closing hashes but keeps a trailing hash that is part of the heading text', () => {
    expect(extractSubpath('## Title ##\nx\n## C#\ny', '#Title')).toBe('## Title ##\nx')
    expect(extractSubpath('## Title ##\nx\n## C#\ny', '#C#')).toBe('## C#\ny')
  })
  it('ignores comment lines inside code fences when finding section boundaries', () => {
    const src = '## Setup\n```bash\n# install deps\nnpm i\n```\nafter\n## Next'
    expect(extractSubpath(src, '#Setup')).toBe('## Setup\n```bash\n# install deps\nnpm i\n```\nafter')
    expect(extractSubpath(src, '#install deps')).toBe('')
  })
})
