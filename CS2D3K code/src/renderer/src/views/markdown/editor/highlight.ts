// Syntax highlighting for the markdown editor. Markdown constructs get classes (styled in
// markdownView.css); nested code languages use the theme's --code-* variables.
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { mdTags } from './syntax'

export const markdownHighlightStyle = HighlightStyle.define([
  // markdown
  { tag: t.heading, class: 'cm-header' },
  { tag: t.strong, class: 'cm-strong' },
  { tag: t.emphasis, class: 'cm-em' },
  { tag: t.strikethrough, class: 'cm-strikethrough' },
  { tag: t.processingInstruction, class: 'cm-formatting' },
  { tag: t.link, class: 'cm-link' },
  { tag: mdTags.wikilink, class: 'cm-link cm-wikilink' },
  { tag: mdTags.embed, class: 'cm-link cm-embed' },
  { tag: t.url, class: 'cm-url' },
  { tag: mdTags.highlight, class: 'cm-highlight' },
  { tag: mdTags.hashtag, class: 'cm-hashtag' },
  { tag: mdTags.frontmatter, class: 'cm-frontmatter' },
  { tag: t.monospace, class: 'cm-mono' },
  { tag: t.quote, class: 'cm-quote' },
  { tag: t.contentSeparator, class: 'cm-hr' },
  { tag: t.labelName, class: 'cm-code-info' },
  { tag: t.escape, class: 'cm-formatting' },

  // code (fenced blocks with nested languages)
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.self], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.inserted], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.unit], color: 'var(--code-number)' },
  { tag: t.atom, class: 'cm-atom' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--code-type)' },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: 'var(--code-property)' },
  { tag: [t.operator, t.derefOperator, t.compareOperator, t.arithmeticOperator, t.logicOperator], color: 'var(--code-operator)' },
  { tag: [t.tagName, t.deleted], color: 'var(--code-tag)' },
  { tag: [t.meta, t.annotation, t.documentMeta], color: 'var(--text-faint)' },
  { tag: t.invalid, color: 'var(--text-error)' }
])
