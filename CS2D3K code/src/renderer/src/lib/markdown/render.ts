/* eslint-disable @typescript-eslint/no-explicit-any */
// Markdown -> HTML renderer used by reading view, canvas cards, embeds and hover previews.
import MarkdownItCtor, { type MarkdownIt, type StateInline, type StateCore, type Token } from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import { escapeHtml } from '../util'
import { splitLinkText, parseFrontmatter, slugifyHeading } from '../mdparse'
import { resolveLink } from '@/store/metadata'
import { RUNNABLE_LANGS } from '../filetypes'

export interface RenderOptions {
  /** vault path of the document (for link resolution) */
  sourcePath: string
  /** show frontmatter as a properties block */
  showFrontmatter?: boolean
  /** add run buttons to runnable code blocks */
  runnable?: boolean
}

// ------------------------------------------------------------- plugins

function wikilinkPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'wikilink', (state: StateInline, silent: boolean) => {
    const src = state.src
    let pos = state.pos
    const embed = src.charCodeAt(pos) === 0x21 /* ! */
    if (embed) pos++
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false
    const end = src.indexOf(']]', pos + 2)
    if (end < 0) return false
    const inner = src.slice(pos + 2, end)
    if (!inner || inner.includes('\n') || inner.includes('[[')) return false
    if (!silent) {
      const tok = state.push(embed ? 'wiki_embed' : 'wikilink', '', 0)
      tok.content = inner
    }
    state.pos = end + 2
    return true
  })
  md.renderer.rules.wikilink = (tokens, idx, _o, env: any) => {
    const raw = tokens[idx].content
    const { link, subpath, display } = splitLinkText(raw)
    const target = link ? resolveLink(link, env.sourcePath) : env.sourcePath
    const text = display ?? (link ? link + (subpath ? ' > ' + subpath.slice(1) : '') : subpath?.slice(1) ?? raw)
    const cls = target ? 'internal-link' : 'internal-link is-unresolved'
    return `<a class="${cls}" data-href="${escapeHtml(link + (subpath ?? ''))}" href="#">${escapeHtml(text)}</a>`
  }
  md.renderer.rules.wiki_embed = (tokens, idx) => {
    const raw = tokens[idx].content
    const { link, subpath, display } = splitLinkText(raw)
    return `<span class="internal-embed" data-src="${escapeHtml(link + (subpath ?? ''))}" data-alt="${escapeHtml(display ?? '')}"></span>`
  }
}

function highlightPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('emphasis', 'mark', (state: StateInline, silent: boolean) => {
    const src = state.src
    const pos = state.pos
    if (src.charCodeAt(pos) !== 0x3d || src.charCodeAt(pos + 1) !== 0x3d) return false
    const end = src.indexOf('==', pos + 2)
    if (end < 0 || end === pos + 2) return false
    if (!silent) {
      state.push('mark_open', 'mark', 1)
      const t = state.push('text', '', 0)
      t.content = src.slice(pos + 2, end)
      state.push('mark_close', 'mark', -1)
    }
    state.pos = end + 2
    return true
  })
}

function tagPlugin(md: MarkdownIt): void {
  md.inline.ruler.push('tag', (state: StateInline, silent: boolean) => {
    const pos = state.pos
    if (state.src.charCodeAt(pos) !== 0x23 /* # */) return false
    const prev = pos > 0 ? state.src[pos - 1] : ' '
    if (!/[\s(,;]/.test(prev)) return false
    const m = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(state.src.slice(pos))
    if (!m) return false
    if (!silent) {
      const t = state.push('tag', '', 0)
      t.content = m[1]
    }
    state.pos += m[0].length
    return true
  })
  md.renderer.rules.tag = (tokens, idx) => {
    const t = escapeHtml(tokens[idx].content)
    return `<a href="#" class="tag" data-tag="${t}">#${t}</a>`
  }
}

/** Turn "- [ ] x" list items into checkboxes; data-line lets the view toggle the source. */
function taskPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'tasks', (state: StateCore) => {
    const tokens = state.tokens
    for (let i = 2; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
      const m = /^\[([ xX\-/])\]\s/.exec(t.content)
      if (!m) continue
      const li = tokens[i - 2]
      const checked = m[1] !== ' '
      li.attrJoin('class', 'task-list-item' + (checked ? ' is-checked' : ''))
      li.attrSet('data-task', m[1])
      const first = t.children?.[0]
      if (first && first.type === 'text') first.content = first.content.replace(/^\[[ xX\-/]\]\s/, '')
      const cb = new state.Token('html_inline', '', 0)
      const line = li.map ? li.map[0] + ((state.env as { lineOffset?: number }).lineOffset ?? 0) : -1
      cb.content = `<input type="checkbox" class="task-list-item-checkbox" data-line="${line}"${checked ? ' checked' : ''}>`
      t.children?.unshift(cb)
    }
  })
}

/** > [!type] Title  callouts */
function calloutPlugin(md: MarkdownIt): void {
  md.core.ruler.after('tasks', 'callouts', (state: StateCore) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue
      const inline = tokens[i + 2]
      if (!inline || inline.type !== 'inline') continue
      const m = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)/.exec(inline.content)
      if (!m) continue
      const type = m[1].toLowerCase()
      const fold = m[2]
      const firstLineEnd = inline.content.indexOf('\n')
      const title = (firstLineEnd >= 0 ? m[3].split('\n')[0] : m[3]).trim() || type.charAt(0).toUpperCase() + type.slice(1)
      const rest = firstLineEnd >= 0 ? inline.content.slice(firstLineEnd + 1) : ''
      tokens[i].attrJoin('class', `callout${fold === '-' ? ' is-collapsed' : ''}`)
      tokens[i].attrSet('data-callout', type)
      if (fold) tokens[i].attrSet('data-callout-fold', fold)
      // replace first paragraph content with the remainder, and inject a title
      const titleTok = new state.Token('html_block', '', 0)
      titleTok.content = `<div class="callout-title"><span class="callout-icon"></span><span class="callout-title-inner">${md.renderInline(title, state.env)}</span>${fold ? '<span class="callout-fold"></span>' : ''}</div><div class="callout-content">`
      if (rest.trim()) {
        inline.content = rest
        inline.children = []
        md.inline.parse(rest, md, state.env, inline.children)
        tokens.splice(i + 1, 0, titleTok)
      } else {
        // remove the empty paragraph (open, inline, close)
        tokens.splice(i + 1, 3, titleTok)
      }
      // find matching blockquote_close and add closing div for callout-content
      let depth = 0
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'blockquote_open') depth++
        if (tokens[j].type === 'blockquote_close') {
          if (depth === 0) {
            const close = new state.Token('html_block', '', 0)
            close.content = '</div>'
            tokens.splice(j, 0, close)
            break
          }
          depth--
        }
      }
    }
  })
}

/** data-line attributes on block tokens for scroll sync / click-to-source */
function sourceLinePlugin(md: MarkdownIt): void {
  md.core.ruler.push('source_lines', (state: StateCore) => {
    const offset = (state.env as { lineOffset?: number }).lineOffset ?? 0
    for (const t of state.tokens) {
      if (t.map && t.nesting === 1 && t.level === 0) t.attrSet('data-line', String(t.map[0] + offset))
    }
  })
}

function headingIdPlugin(md: MarkdownIt): void {
  md.core.ruler.push('heading_ids', (state: StateCore) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'heading_open') {
        const inline = tokens[i + 1]
        tokens[i].attrSet('data-heading', inline.content)
        tokens[i].attrSet('id', slugifyHeading(inline.content))
      }
    }
  })
}

// ------------------------------------------------------------- sanitizing
// Notes may contain raw HTML (html: true, like Obsidian). The CSP already blocks inline scripts / handlers;
// this removes what could still run code or navigate the app window (a vault can come from anyone).

/** Random per session: only run buttons rendered from real code fences carry it (raw HTML can't fake one). */
export const RUN_TOKEN = Math.random().toString(36).slice(2, 12)

const DROP_TAGS = new Set(['script', 'object', 'embed', 'meta', 'base', 'link', 'frame', 'frameset', 'portal'])
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background'])
const UNSAFE_URL = /^\s*(javascript|vbscript|file|data(?!:image\/(png|gif|jpe?g|webp|bmp|avif);))\s*:/i

/** Strip scripts, event handlers, srcdoc / non-https frames and javascript:/file: URLs from rendered HTML. */
export function sanitizeHtml(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  for (const el of [...tpl.content.querySelectorAll('*')]) {
    const tag = el.localName.toLowerCase()
    if (DROP_TAGS.has(tag)) {
      el.remove()
      continue
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc' || (URL_ATTRS.has(name) && UNSAFE_URL.test(attr.value.replace(/[\u0000-\u0020]/g, '')))) el.removeAttribute(attr.name)
    }
    if (tag === 'iframe') {
      if (!/^https:/i.test(el.getAttribute('src') ?? '')) el.remove()
      else el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation')
    }
  }
  return tpl.innerHTML
}

// ------------------------------------------------------------- instance

function highlight(code: string, lang: string): string {
  const l = (lang || '').toLowerCase()
  try {
    if (l && hljs.getLanguage(l)) return hljs.highlight(code, { language: l, ignoreIllegals: true }).value
  } catch {
    /* fall through */
  }
  return escapeHtml(code)
}

const md: MarkdownIt = new MarkdownItCtor({ html: true, linkify: true, breaks: true, typographer: false })
md.use(wikilinkPlugin).use(highlightPlugin).use(tagPlugin).use(taskPlugin).use(calloutPlugin).use(headingIdPlugin).use(sourceLinePlugin)
md.linkify.set({ fuzzyLink: false })

md.renderer.rules.fence = (tokens: Token[], idx: number, _opts, env: any) => {
  const t = tokens[idx]
  const lang = t.info.trim().split(/\s+/)[0] ?? ''
  const line = (t.map?.[0] ?? 0) + (env.lineOffset ?? 0)
  const runnable = env.runnable && RUNNABLE_LANGS.has(lang.toLowerCase())
  const body = highlight(t.content.replace(/\n$/, ''), lang)
  return (
    `<div class="code-block" data-lang="${escapeHtml(lang)}" data-line="${line}">` +
    `<div class="code-block-header"><span class="code-block-lang">${escapeHtml(lang)}</span>` +
    `<span class="code-block-actions">${runnable ? `<button class="code-block-run" title="Run code" data-run="${RUN_TOKEN}">▶ Run</button>` : ''}<button class="code-block-copy" title="Copy">Copy</button></span></div>` +
    `<pre><code class="hljs language-${escapeHtml(lang)}">${body}</code></pre>` +
    `<div class="code-block-output" hidden></div></div>`
  )
}

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env: any, self) => {
  const t = tokens[idx]
  const href = String(t.attrGet('href') ?? '')
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    t.attrJoin('class', 'external-link')
    t.attrSet('target', '_blank')
    t.attrSet('rel', 'noopener')
  } else if (href && !href.startsWith('#')) {
    let dec = href
    try {
      dec = decodeURIComponent(href)
    } catch {
      /* keep */
    }
    const { link } = splitLinkText(dec)
    t.attrJoin('class', resolveLink(link, env.sourcePath) ? 'internal-link' : 'internal-link is-unresolved')
    t.attrSet('data-href', dec)
    t.attrSet('href', '#')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const defaultImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, idx, options, env: any, self) => {
  const t = tokens[idx]
  const src = String(t.attrGet('src') ?? '')
  if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    let dec = src
    try {
      dec = decodeURIComponent(src)
    } catch {
      /* keep */
    }
    const target = resolveLink(dec, env.sourcePath)
    if (target) t.attrSet('src', window.api.fs.resourceUrl(target))
  }
  return defaultImage(tokens, idx, options, env, self)
}

/** Properties block HTML for parsed frontmatter (also used by the editor's live preview). */
export function renderFrontmatter(data: Record<string, unknown>): string {
  const rows = Object.entries(data)
    .map(([k, v]) => {
      const val = Array.isArray(v)
        ? v.map((x) => `<span class="fm-pill">${escapeHtml(String(x))}</span>`).join(' ')
        : escapeHtml(v === null ? '' : String(v))
      return `<div class="fm-row"><div class="fm-key">${escapeHtml(k)}</div><div class="fm-value">${val}</div></div>`
    })
    .join('')
  return `<div class="frontmatter-properties"><div class="fm-title">Properties</div>${rows}</div>`
}

/** Render a full markdown document to HTML. */
export function renderMarkdown(src: string, opts: RenderOptions): string {
  const fm = parseFrontmatter(src)
  let body = src
  let pre = ''
  let lineOffset = 0
  if (fm.data) {
    body = src.slice(fm.endOffset)
    lineOffset = fm.endLine + 1
    if (opts.showFrontmatter !== false && Object.keys(fm.data).length) pre = renderFrontmatter(fm.data)
  }
  const env = { sourcePath: opts.sourcePath, runnable: opts.runnable, lineOffset }
  const html = pre + md.render(body, env)
  // raw HTML needs a '<' in the source
  return src.includes('<') ? sanitizeHtml(html) : html
}

/** Extract the section under a heading ("#Heading") or block ("#^id") from markdown source. */
export function extractSubpath(src: string, subpath: string): string {
  if (!subpath) return src
  const lines = src.split(/\r?\n/)
  if (subpath.startsWith('#^')) {
    const id = subpath.slice(2)
    const line = lines.find((l) => l.trimEnd().endsWith(`^${id}`))
    return line ? line.trimEnd().replace(new RegExp(`\\s*\\^${id}$`), '') : ''
  }
  const want = subpath.replace(/^#/, '').trim().toLowerCase()
  let start = -1
  let level = 0
  let fence = ''
  for (let i = 0; i < lines.length; i++) {
    // skip fenced code so "# comments" inside it aren't taken for headings
    const f = /^\s*(```+|~~~+)/.exec(lines[i])
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = ''
      continue
    }
    if (fence) continue
    const m = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(lines[i])
    if (!m) continue
    if (start < 0 && m[2].trim().toLowerCase() === want) {
      start = i
      level = m[1].length
    } else if (start >= 0 && m[1].length <= level) {
      return lines.slice(start, i).join('\n')
    }
  }
  return start >= 0 ? lines.slice(start).join('\n') : ''
}

export { md as markdownIt }
