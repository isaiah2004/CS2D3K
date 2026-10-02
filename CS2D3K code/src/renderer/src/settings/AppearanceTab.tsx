import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw, Plus, Check, Moon, Sun, Monitor } from 'lucide-react'
import type { ThemeInfo } from '@shared/types'
import { useSettings, type BaseTheme } from '@/store/settings'
import { notice, promptText } from '@/store/ui'
import { BUILTIN_THEMES } from '@/theme/builtin'
import { applyTheme } from '@/theme/theme'
import { validateName } from '@/lib/path'
import { BoolSetting, SettingHeading, SettingItem, SliderSetting, TextSetting, Toggle } from './controls'

const ACCENTS = ['#8a5cf5', '#678fe0', '#2f9e8f', '#3fb950', '#e5a50a', '#f0883e', '#e5534b', '#d63384', '#a371f7', '#7d8590']

const THEME_TEMPLATE = (name: string): string => `/*
 * ${name} — a CS2D3K theme.
 * Override any design token from the app. Names match Obsidian's CSS variables,
 * so many Obsidian theme snippets work as-is. Changes apply live on save.
 */

body.theme-dark {
  --color-base-00: #1a1b26;  /* editor background */
  --color-base-10: #1f2030;
  --color-base-20: #16161e;  /* sidebars */
  --color-base-25: #24283b;
  --color-base-30: #2f334d;  /* borders */
  --color-base-35: #3b4261;
  --color-base-40: #545c7e;
  --color-base-50: #737aa2;
  --color-base-60: #8f96bd;
  --color-base-70: #a9b1d6;  /* muted text */
  --color-base-100: #c0caf5; /* normal text */

  --code-keyword: #bb9af7;
  --code-string: #9ece6a;
  --code-number: #ff9e64;
  --code-function: #7aa2f7;
  --code-type: #2ac3de;
  --code-comment: #565f89;
}

body.theme-light {
  /* light mode overrides */
}

/* Any other CSS works too, e.g.:
.markdown-rendered h1 { letter-spacing: -0.02em; }
*/
`

const SNIPPET_TEMPLATE = `/* A CSS snippet. Enable it in Settings → Appearance → CSS snippets. */

.markdown-rendered h1,
.cm-header-1 {
  /* color: var(--text-accent); */
}
`

function swatch(css: string, mode: 'dark' | 'light'): { bg: string; side: string; fg: string; accent: string } | null {
  const block = new RegExp(`body\\.theme-${mode}\\s*\\{([\\s\\S]*?)\\}`).exec(css)?.[1]
  if (!block) return null
  const get = (v: string): string | undefined => new RegExp(`--${v}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim()
  return {
    bg: get('color-base-00') ?? (mode === 'dark' ? '#1e1e1e' : '#fff'),
    side: get('color-base-20') ?? (mode === 'dark' ? '#262626' : '#f6f6f6'),
    fg: get('color-base-100') ?? (mode === 'dark' ? '#dadada' : '#222'),
    accent: get('code-keyword') ?? get('code-function') ?? '#8a5cf5'
  }
}

function ThemeCard({ name, label, css, active, mode, onClick }: { name: string; label: string; css: string; active: boolean; mode: 'dark' | 'light'; onClick: () => void }) {
  const sw = swatch(css, mode) ?? swatch(css, mode === 'dark' ? 'light' : 'dark')
  const def = mode === 'dark' ? { bg: '#1e1e1e', side: '#262626', fg: '#dadada', accent: '#8a5cf5' } : { bg: '#ffffff', side: '#f6f6f6', fg: '#222222', accent: '#8a5cf5' }
  const c = name ? (sw ?? def) : def
  return (
    <div className={`theme-card${active ? ' is-active' : ''}`} onClick={onClick} title={label}>
      <div className="theme-preview" style={{ background: c.bg }}>
        <div className="tp-side" style={{ background: c.side }} />
        <div className="tp-lines">
          <div style={{ background: c.fg, width: '70%' }} />
          <div style={{ background: c.accent, width: '45%' }} />
          <div style={{ background: c.fg, width: '60%', opacity: 0.5 }} />
          <div style={{ background: c.fg, width: '35%', opacity: 0.5 }} />
        </div>
      </div>
      <div className="theme-card-name">
        {active && <Check size={13} />} {label}
      </div>
    </div>
  )
}

export default function AppearanceTab() {
  const s = useSettings((st) => st.settings)
  const set = useSettings.getState().set
  const [themes, setThemes] = useState<ThemeInfo[]>([])
  const [themeCss, setThemeCss] = useState<Record<string, string>>({})
  const [snippets, setSnippets] = useState<ThemeInfo[]>([])
  const mode = s.baseTheme === 'light' || (s.baseTheme === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark'

  const reload = async (): Promise<void> => {
    const [t, sn] = await Promise.all([window.api.config.listThemes(), window.api.config.listSnippets()])
    setThemes(t)
    setSnippets(sn)
    const css: Record<string, string> = {}
    for (const th of t) css[th.name] = await window.api.config.readCss(th.path).catch(() => '')
    setThemeCss(css)
  }
  useEffect(() => {
    void reload()
    return window.api.config.onCssChange(() => void reload())
  }, [])

  const createTheme = async (): Promise<void> => {
    const name = await promptText({ title: 'New theme', message: 'Theme name', placeholder: 'My theme', validate: validateName })
    if (!name) return
    try {
      await window.api.fs.writeText(`.cs2d3k/themes/${name}.css`, THEME_TEMPLATE(name))
      await reload()
      set('theme', name)
      notice(`Created .cs2d3k/themes/${name}.css — edit it and changes apply live`, 'success', 6000)
    } catch (e) {
      notice(`Could not create theme: ${(e as Error).message}`, 'error')
    }
  }

  const createSnippet = async (): Promise<void> => {
    const name = await promptText({ title: 'New CSS snippet', message: 'Snippet name', placeholder: 'my-tweaks', validate: validateName })
    if (!name) return
    await window.api.fs.writeText(`.cs2d3k/snippets/${name}.css`, SNIPPET_TEMPLATE)
    await reload()
    set('enabledSnippets', [...s.enabledSnippets, name])
  }

  const modeBtn = (m: BaseTheme, icon: React.ReactNode, label: string): React.ReactNode => (
    <button className={`segmented-btn${s.baseTheme === m ? ' is-active' : ''}`} onClick={() => set('baseTheme', m)}>
      {icon} {label}
    </button>
  )

  return (
    <>
      <SettingHeading>Base color scheme</SettingHeading>
      <SettingItem name="Base color scheme" desc="Choose the default color scheme. Themes can provide both a dark and a light variant.">
        <div className="segmented">
          {modeBtn('dark', <Moon size={13} />, 'Dark')}
          {modeBtn('light', <Sun size={13} />, 'Light')}
          {modeBtn('system', <Monitor size={13} />, 'System')}
        </div>
      </SettingItem>
      <SettingItem name="Accent color" desc="Used for links, active items, buttons and the cursor.">
        <div className="accent-row">
          {ACCENTS.map((c) => (
            <button key={c} className={`accent-dot${s.accentColor.toLowerCase() === c ? ' is-active' : ''}`} style={{ background: c }} onClick={() => set('accentColor', c)} aria-label={c} />
          ))}
          <input type="color" className="accent-picker" value={s.accentColor} onChange={(e) => set('accentColor', e.target.value)} title="Custom color" />
        </div>
      </SettingItem>

      <SettingHeading>Themes</SettingHeading>
      <div className="theme-grid">
        <ThemeCard name="" label="Default" css="" active={s.theme === ''} mode={mode} onClick={() => set('theme', '')} />
        {BUILTIN_THEMES.map((t) => (
          <ThemeCard key={t.name} name={t.name} label={t.name} css={t.css} active={s.theme === `builtin:${t.name}`} mode={mode} onClick={() => set('theme', `builtin:${t.name}`)} />
        ))}
        {themes.map((t) => (
          <ThemeCard key={t.path} name={t.name} label={t.name} css={themeCss[t.name] ?? ''} active={s.theme === t.name} mode={mode} onClick={() => set('theme', t.name)} />
        ))}
        <div className="theme-card theme-card-new" onClick={() => void createTheme()}>
          <div className="theme-preview">
            <Plus size={22} />
          </div>
          <div className="theme-card-name">New theme…</div>
        </div>
      </div>
      <SettingItem name="Vault themes" desc={<>Themes are CSS files in <code>.cs2d3k/themes</code> (a <code>.css</code> file or a folder with <code>theme.css</code>).</>}>
        <button className="clickable-icon" title="Reload themes" onClick={() => void reload().then(() => applyTheme())}>
          <RefreshCw size={16} />
        </button>
        <button className="clickable-icon" title="Open themes folder" onClick={() => void window.api.config.openFolder('themes')}>
          <FolderOpen size={16} />
        </button>
      </SettingItem>

      <SettingHeading>Font</SettingHeading>
      <TextSetting k="interfaceFont" name="Interface font" desc="Font used for the user interface." placeholder="System default" />
      <TextSetting k="textFont" name="Text font" desc="Font used in notes (editing and reading)." placeholder="System default" />
      <TextSetting k="monoFont" name="Monospace font" desc="Font for code blocks, code editors and the terminal." placeholder="Cascadia Code, JetBrains Mono…" />
      <SliderSetting k="uiFontSize" name="Interface font size" min={11} max={18} unit="px" />
      <SliderSetting k="editorFontSize" name="Note font size" min={10} max={30} unit="px" />

      <SettingHeading>Interface</SettingHeading>
      <BoolSetting k="showInlineTitle" name="Show inline title" desc="Display the file name as an editable title at the top of the note." />
      <BoolSetting k="showRibbon" name="Show ribbon" desc="Display the vertical toolbar on the left side of the window." />
      <BoolSetting k="showStatusBar" name="Show status bar" />

      <SettingHeading>CSS snippets</SettingHeading>
      <SettingItem name="CSS snippets" desc={<>Snippets are stored in <code>.cs2d3k/snippets</code> and applied on top of the theme.</>}>
        <button className="clickable-icon" title="Reload snippets" onClick={() => void reload().then(() => applyTheme())}>
          <RefreshCw size={16} />
        </button>
        <button className="clickable-icon" title="Open snippets folder" onClick={() => void window.api.config.openFolder('snippets')}>
          <FolderOpen size={16} />
        </button>
        <button className="clickable-icon" title="New snippet" onClick={() => void createSnippet()}>
          <Plus size={16} />
        </button>
      </SettingItem>
      {snippets.length === 0 && <div className="setting-note">No snippets yet.</div>}
      {snippets.map((sn) => (
        <SettingItem key={sn.path} name={sn.name} desc={sn.path}>
          <Toggle
            value={s.enabledSnippets.includes(sn.name)}
            label={sn.name}
            onChange={(v) => set('enabledSnippets', v ? [...s.enabledSnippets, sn.name] : s.enabledSnippets.filter((x) => x !== sn.name))}
          />
        </SettingItem>
      ))}
    </>
  )
}
