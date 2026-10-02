// Regression tests from the robustness audit (QUALITY.md): raw HTML in notes must not be able to run code,
// navigate the app window or fake a "Run" button.
import { beforeAll, describe, expect, it } from 'vitest'
import { loadTestVault } from '../../../helpers/vault'
import { renderMarkdown, sanitizeHtml, RUN_TOKEN } from '@/lib/markdown/render'

const render = (src: string, runnable = false): HTMLElement => {
  const el = document.createElement('div')
  el.innerHTML = renderMarkdown(src, { sourcePath: 'Note.md', runnable })
  return el
}

beforeAll(async () => {
  await loadTestVault({ 'Note.md': '', 'Other.md': '' })
})

describe('lib/markdown/render raw HTML sanitizing', () => {
  it('drops scripts, event handlers and srcdoc frames', () => {
    const el = render(
      [
        '<script>window.pwned = 1</script>',
        '<img src="x.png" onerror="window.pwned = 1">',
        '<iframe srcdoc="<script src=\'vault://local/x.js\'></script>"></iframe>',
        '<svg><script>window.pwned = 1</script></svg>',
        '<object data="vault://local/x.html"></object><embed src="vault://local/x.html">'
      ].join('\n\n')
    )
    expect(el.querySelector('script, object, embed, iframe')).toBeNull()
    expect(el.querySelector('img')!.hasAttribute('onerror')).toBe(false)
    expect(el.innerHTML).not.toMatch(/onerror|srcdoc/i)
  })

  it('drops meta refresh / base tags that could navigate or retarget the app window', () => {
    const el = render('<meta http-equiv="refresh" content="0;url=file:///C:/evil.html">\n\n<base href="file:///C:/">\n\ntext')
    expect(el.querySelector('meta, base')).toBeNull()
    expect(el.textContent).toContain('text')
  })

  it('removes javascript:, file: and data:text URLs (also with obfuscating whitespace)', () => {
    const el = render(
      '<a id="a" href="javascript:alert(1)">a</a> <a id="b" href="file:///C:/evil.html">b</a> ' +
        '<a id="c" href="java&#9;script:alert(1)">c</a> <a id="d" href="data:text/html,<b>x</b>">d</a> ' +
        '<form id="f" action="file:///x"><button formaction="javascript:1">go</button></form>'
    )
    for (const id of ['a', 'b', 'c', 'd']) expect(el.querySelector(`#${id}`)!.hasAttribute('href'), id).toBe(false)
    expect(el.querySelector('form')!.hasAttribute('action')).toBe(false)
    expect(el.querySelector('button')!.hasAttribute('formaction')).toBe(false)
  })

  it('keeps harmless HTML, https embeds (sandboxed) and data: images', () => {
    const el = render(
      '<details><summary>More</summary><b style="color:red">bold</b></details>\n\n' +
        '<iframe src="https://www.youtube.com/embed/x"></iframe>\n\n' +
        '<img src="data:image/png;base64,AAAA"> <a href="https://example.com">web</a>'
    )
    expect(el.querySelector('details b')!.getAttribute('style')).toBe('color:red')
    const frame = el.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe('https://www.youtube.com/embed/x')
    expect(frame.getAttribute('sandbox')).not.toMatch(/allow-top-navigation/)
    expect(el.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(el.querySelector('a')!.getAttribute('href')).toBe('https://example.com')
  })

  it('leaves normal markdown output alone (links, tasks, callouts)', () => {
    const src = '- [ ] task\n\n> [!note] Title\n> body\n\n[[Other]] <b>x</b>'
    const el = render(src)
    expect(el.querySelector('input.task-list-item-checkbox')).not.toBeNull()
    expect(el.querySelector('.callout .callout-title')).not.toBeNull()
    expect(el.querySelector('a.internal-link')!.getAttribute('data-href')).toBe('Other')
  })

  it('sanitizeHtml is idempotent on clean output', () => {
    const html = '<p>hi <a href="https://x.y">x</a></p>'
    expect(sanitizeHtml(html)).toBe(html)
  })
})

describe('lib/markdown/render run buttons', () => {
  it('only buttons rendered for real code fences carry the run token', () => {
    const fake = '<div class="code-block" data-lang="bat"><code hidden>calc</code><button class="code-block-run" data-run="guess">Open docs</button></div>'
    const el = render('```js\nconsole.log(1)\n```\n\n' + fake, true)
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.code-block-run')]
    expect(buttons).toHaveLength(2)
    expect(buttons[0].dataset.run).toBe(RUN_TOKEN)
    expect(buttons[1].dataset.run).not.toBe(RUN_TOKEN)
  })
})
