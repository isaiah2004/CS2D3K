// Builds a Monaco theme from the app's resolved CSS palette so the editor matches every app theme.
import type { editor } from 'monaco-editor'
import { cssVar, themePalette } from '@/theme/theme'

export const MONACO_THEME = 'cs2d3k'

/** "#rrggbb" (drops any alpha) */
function solid(c: string): string {
  return c.length > 7 ? c.slice(0, 7) : c
}

/** "#rrggbb" + alpha (0..1), multiplying any alpha already present */
export function withAlpha(c: string, a: number): string {
  const base = c.length > 7 ? parseInt(c.slice(7, 9), 16) / 255 : 1
  const v = Math.round(Math.max(0, Math.min(1, base * a)) * 255)
  return solid(c) + v.toString(16).padStart(2, '0')
}

/** token rule color: "rrggbb" */
function tok(c: string): string {
  return solid(c).slice(1)
}

/** Resolved monospace font stack from the app's --font-monospace. */
export function monoFontFamily(): string {
  return cssVar('--font-monospace') || "Consolas, 'Courier New', monospace"
}

export function buildMonacoTheme(p: Record<string, string> = themePalette()): editor.IStandaloneThemeData {
  const dark = p.mode !== 'light'
  const bg = solid(p['background-primary'])
  const bgAlt = solid(p['background-secondary'])
  const border = p['background-modifier-border']
  const hover = p['background-modifier-hover']
  const fg = p['code-normal'] || p['text-normal']
  const accent = solid(p['interactive-accent'])
  const muted = p['text-muted']
  const faint = p['text-faint']
  const sel = p['text-selection']

  const rules: editor.ITokenThemeRule[] = [
    { token: '', foreground: tok(fg), background: tok(bg) },
    { token: 'comment', foreground: tok(p['code-comment']), fontStyle: 'italic' },
    { token: 'comment.doc', foreground: tok(p['code-comment']), fontStyle: 'italic' },
    { token: 'keyword', foreground: tok(p['code-keyword']) },
    { token: 'keyword.flow', foreground: tok(p['code-keyword']) },
    { token: 'keyword.control', foreground: tok(p['code-keyword']) },
    { token: 'storage', foreground: tok(p['code-keyword']) },
    { token: 'string', foreground: tok(p['code-string']) },
    { token: 'string.escape', foreground: tok(p['code-operator']) },
    { token: 'string.value.json', foreground: tok(p['code-string']) },
    { token: 'attribute.value', foreground: tok(p['code-string']) },
    { token: 'regexp', foreground: tok(p['code-tag']) },
    { token: 'number', foreground: tok(p['code-number']) },
    { token: 'number.hex', foreground: tok(p['code-number']) },
    { token: 'number.float', foreground: tok(p['code-number']) },
    { token: 'constant', foreground: tok(p['code-number']) },
    { token: 'keyword.json', foreground: tok(p['code-number']) },
    { token: 'type', foreground: tok(p['code-type']) },
    { token: 'type.identifier', foreground: tok(p['code-type']) },
    { token: 'namespace', foreground: tok(p['code-type']) },
    { token: 'class', foreground: tok(p['code-type']) },
    { token: 'function', foreground: tok(p['code-function']) },
    { token: 'predefined', foreground: tok(p['code-function']) },
    { token: 'support.function', foreground: tok(p['code-function']) },
    { token: 'identifier', foreground: tok(fg) },
    { token: 'variable', foreground: tok(p['code-property']) },
    { token: 'variable.predefined', foreground: tok(p['code-property']) },
    { token: 'variable.parameter', foreground: tok(p['code-property']) },
    { token: 'key', foreground: tok(p['code-property']) },
    { token: 'string.key.json', foreground: tok(p['code-property']) },
    { token: 'attribute.name', foreground: tok(p['code-property']) },
    { token: 'property', foreground: tok(p['code-property']) },
    { token: 'operator', foreground: tok(p['code-operator']) },
    { token: 'operators', foreground: tok(p['code-operator']) },
    { token: 'delimiter', foreground: tok(muted) },
    { token: 'delimiter.bracket', foreground: tok(muted) },
    { token: 'tag', foreground: tok(p['code-tag']) },
    { token: 'metatag', foreground: tok(p['code-tag']) },
    { token: 'annotation', foreground: tok(p['code-tag']) },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'header', foreground: tok(p['code-keyword']), fontStyle: 'bold' },
    { token: 'invalid', foreground: tok(p['color-red']) }
  ]

  const colors: editor.IColors = {
    foreground: solid(fg),
    focusBorder: withAlpha(accent, 0.6),
    'widget.shadow': dark ? '#00000066' : '#00000026',
    'editor.background': bg,
    'editor.foreground': solid(fg),
    'editor.lineHighlightBackground': withAlpha(hover, hover.length > 7 ? 0.8 : 0.5),
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': sel,
    'editor.inactiveSelectionBackground': withAlpha(sel, 0.55),
    'editor.selectionHighlightBackground': withAlpha(sel, 0.45),
    'editor.wordHighlightBackground': withAlpha(sel, 0.4),
    'editor.wordHighlightStrongBackground': withAlpha(sel, 0.55),
    'editor.findMatchBackground': withAlpha(p['color-yellow'], 0.45),
    'editor.findMatchHighlightBackground': withAlpha(p['color-yellow'], 0.22),
    'editor.findRangeHighlightBackground': withAlpha(accent, 0.08),
    'editor.rangeHighlightBackground': withAlpha(accent, 0.1),
    'editor.hoverHighlightBackground': withAlpha(accent, 0.12),
    'editorCursor.foreground': accent,
    'editorLineNumber.foreground': solid(faint),
    'editorLineNumber.activeForeground': solid(muted),
    'editorGutter.background': bg,
    'editorIndentGuide.background1': withAlpha(border, 0.8),
    'editorIndentGuide.activeBackground1': solid(faint),
    'editorWhitespace.foreground': withAlpha(faint, 0.5),
    'editorRuler.foreground': withAlpha(border, 0.8),
    'editorBracketMatch.background': withAlpha(accent, 0.15),
    'editorBracketMatch.border': withAlpha(accent, 0.6),
    'editorBracketHighlight.foreground1': solid(p['code-keyword']),
    'editorBracketHighlight.foreground2': solid(p['code-function']),
    'editorBracketHighlight.foreground3': solid(p['code-type']),
    'editorBracketHighlight.foreground4': solid(p['code-property']),
    'editorBracketHighlight.foreground5': solid(p['code-operator']),
    'editorBracketHighlight.foreground6': solid(p['code-tag']),
    'editorCodeLens.foreground': solid(faint),
    'editorLink.activeForeground': solid(p['text-accent']),
    'editorOverviewRuler.border': '#00000000',
    'editorOverviewRuler.background': bg,
    'editorError.foreground': solid(p['color-red']),
    'editorWarning.foreground': solid(p['color-yellow']),
    'editorInfo.foreground': solid(p['color-blue']),
    'editorStickyScroll.background': bg,
    'editorStickyScroll.shadow': dark ? '#00000055' : '#00000020',
    'editorStickyScrollHover.background': hover,
    'editorWidget.background': bgAlt,
    'editorWidget.foreground': solid(p['text-normal']),
    'editorWidget.border': solid(border),
    'editorHoverWidget.background': bgAlt,
    'editorHoverWidget.border': solid(border),
    'editorSuggestWidget.background': bgAlt,
    'editorSuggestWidget.border': solid(border),
    'editorSuggestWidget.foreground': solid(p['text-normal']),
    'editorSuggestWidget.selectedBackground': withAlpha(accent, 0.25),
    'editorSuggestWidget.highlightForeground': accent,
    'editorSuggestWidget.focusHighlightForeground': accent,
    'list.hoverBackground': hover,
    'list.activeSelectionBackground': withAlpha(accent, 0.25),
    'list.activeSelectionForeground': solid(p['text-normal']),
    'list.inactiveSelectionBackground': withAlpha(accent, 0.15),
    'list.focusBackground': withAlpha(accent, 0.25),
    'list.highlightForeground': accent,
    'quickInput.background': bgAlt,
    'quickInput.foreground': solid(p['text-normal']),
    'quickInputList.focusBackground': withAlpha(accent, 0.25),
    'pickerGroup.foreground': accent,
    'input.background': solid(p['background-primary-alt']),
    'input.foreground': solid(p['text-normal']),
    'input.border': solid(border),
    'input.placeholderForeground': solid(faint),
    'inputOption.activeBorder': accent,
    'inputOption.activeBackground': withAlpha(accent, 0.25),
    'button.background': accent,
    'button.foreground': '#ffffff',
    'badge.background': accent,
    'badge.foreground': '#ffffff',
    'menu.background': bgAlt,
    'menu.foreground': solid(p['text-normal']),
    'menu.border': solid(border),
    'menu.selectionBackground': hover,
    'menu.selectionForeground': solid(p['text-normal']),
    'menu.separatorBackground': solid(border),
    'peekView.border': accent,
    'peekViewEditor.background': solid(p['background-primary-alt']),
    'peekViewResult.background': bgAlt,
    'peekViewTitle.background': bgAlt,
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': withAlpha(solid(faint), 0.3),
    'scrollbarSlider.hoverBackground': withAlpha(solid(faint), 0.5),
    'scrollbarSlider.activeBackground': withAlpha(solid(faint), 0.65),
    'minimap.background': bg,
    'minimapSlider.background': withAlpha(solid(faint), 0.15),
    'minimapSlider.hoverBackground': withAlpha(solid(faint), 0.25),
    'minimapSlider.activeBackground': withAlpha(solid(faint), 0.35)
  }

  return { base: dark ? 'vs-dark' : 'vs', inherit: true, rules, colors }
}
