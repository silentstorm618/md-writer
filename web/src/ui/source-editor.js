/**
 * Markdown 源码编辑器（CodeMirror 6）+ 同步预览。
 */
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, placeholder, highlightSpecialChars,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';

/**
 * 深色配色取自实际界面：底 #101010、强调 #7ba6f8、
 * 边框 #262a31。保证与 index.html 的 [data-theme=dark] 一致。
 */
export const LIGHT = {
  base: '#1f2328', heading: '#0b3d91', link: '#0969da', strong: '#1f2328',
  em: '#59636e', code: '#b91c1c', quote: '#57606a', meta: '#8b949e',
  bg: '#ffffff', sel: '#b6d7ff', cursor: '#1f2328', gutter: '#8b949e', active: '#f6f8fa',
};

export const DARK = {
  base: '#e6e6e6', heading: '#7ba6f8', link: '#7ba6f8', strong: '#ffffff',
  em: '#a8b0bb', code: '#f0a875', quote: '#979ea7', meta: '#6b7280',
  bg: '#101010', sel: '#2f4176', cursor: '#e6e6e6', gutter: '#6b7280', active: '#16181d',
};

function buildHighlightStyle(dark) {
  const c = dark ? DARK : LIGHT;
  return HighlightStyle.define([
    { tag: t.heading1, color: c.heading, fontSize: '1.45em', fontWeight: '700' },
    { tag: t.heading2, color: c.heading, fontSize: '1.28em', fontWeight: '700' },
    { tag: t.heading3, color: c.heading, fontSize: '1.14em', fontWeight: '700' },
    { tag: [t.heading4, t.heading5, t.heading6], color: c.heading, fontWeight: '600' },
    { tag: t.strong, fontWeight: '700', color: c.strong },
    { tag: t.emphasis, fontStyle: 'italic', color: c.em },
    { tag: t.strikethrough, textDecoration: 'line-through', color: c.meta },
    { tag: [t.link, t.url], color: c.link, textDecoration: 'underline' },
    { tag: t.monospace, color: c.code, fontFamily: 'var(--mono)' },
    { tag: t.quote, color: c.quote, fontStyle: 'italic' },
    { tag: [t.comment, t.meta], color: c.meta },
    { tag: [t.processingInstruction, t.annotation], color: c.meta },
    { tag: t.keyword, color: dark ? '#ff7b72' : '#cf222e' },
    { tag: [t.string, t.special(t.string)], color: dark ? '#a5d6ff' : '#0a3069' },
    { tag: [t.number, t.bool, t.null], color: dark ? '#79c0ff' : '#0550ae' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: dark ? '#d2a8ff' : '#8250df' },
    { tag: t.propertyName, color: dark ? '#ffa657' : '#953800' },
    { tag: [t.typeName, t.className], color: dark ? '#ffa657' : '#6639ba' },
    { tag: t.tagName, color: dark ? '#7ee787' : '#116329' },
  ]);
}

function buildTheme(dark) {
  const c = dark ? DARK : LIGHT;
  return EditorView.theme(
    {
      '&': { color: c.base, backgroundColor: c.bg, height: '100%', fontSize: 'var(--editor-font-size, 14px)' },
      '.cm-content': { caretColor: c.cursor, padding: '18px 0 40vh', fontFamily: 'var(--mono)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.cursor },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: c.sel + ' !important' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: c.sel },
      '.cm-gutters': { backgroundColor: c.bg, color: c.gutter, border: 'none', borderRight: '1px solid ' + (dark ? '#262a31' : '#eaeef2') },
      '.cm-activeLineGutter': { backgroundColor: c.active, color: c.base },
      '.cm-activeLine': { backgroundColor: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' },
      '.cm-matchingBracket': { backgroundColor: c.sel, outline: 'none' },
      '.cm-tooltip': { backgroundColor: c.bg, border: '1px solid ' + c.active, color: c.base },
      '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: c.sel, color: c.base },
    },
    { dark }
  );
}

export function createSourceEditor(host, opts = {}) {
  const { onChange = () => {} } = opts;

  const darkCompartment = new Compartment();

  const state = EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [markdown({ codeLanguages: languages })] }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(buildHighlightStyle(false), { fallback: true }),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
      EditorView.lineWrapping,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      darkCompartment.of(buildTheme(false)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown 源码' }),
      placeholder('在这里写 Markdown…'),
    ],
  });

  let view;
  try {
    view = new EditorView({ state, parent: host });
  } catch (e) {
    // 极端情况下（布局引擎异常）不应让整个应用起不来：
    // 退化成一个可编辑的 textarea，源码编辑依然可用。
    console.warn('[md-writer] CodeMirror 初始化失败，退化为 textarea', e);
    const ta = document.createElement('textarea');
    ta.style.cssText = 'width:100%;height:100%;border:0;padding:18px;font-family:var(--mono);' +
      'font-size:var(--editor-font-size,14px);background:transparent;color:inherit;resize:none;';
    ta.value = state.doc.toString();
    ta.addEventListener('input', () => onChange(ta.value));
    host.appendChild(ta);
    view = {
      state: { doc: { toString: () => ta.value, length: ta.value.length } },
      dispatch: () => {},
      focus: () => ta.focus(),
    };
    return {
      view, el: host,
      getValue: () => ta.value,
      setValue: (v) => { if (v !== ta.value) { ta.value = v; onChange(v); } },
      setTheme: () => {},
      focus: () => ta.focus(),
      isDirty: () => false,
      fallback: true,
    };
  }

  let suppress = false;
  let lastExternal = '';

  return {
    view,
    el: host,
    getValue: () => view.state.doc.toString(),
    setValue(md) {
      if (md === view.state.doc.toString()) return;
      suppress = true;
      lastExternal = md;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: md },
        selection: { anchor: Math.min(view.state.selection.main.anchor, md.length) },
      });
      suppress = false;
    },
    setTheme(dark) {
      view.dispatch({
        effects: darkCompartment.reconfigure([
          buildTheme(dark),
          syntaxHighlighting(buildHighlightStyle(dark), { fallback: true }),
        ]),
      });
    },
    focus: () => view.focus(),
    undo: () => { view.dispatch({ effects: history({}).effects?.length ? [] : [] }); view.focus(); },
    isDirty: () => view.state.doc.toString() !== lastExternal,
    /** 卸载 CodeMirror 视图，释放底层 listener；fallback textarea 路径无需清理 */
    destroy() {
      try { view.destroy?.(); } catch { /* 兜底 */ }
    },
  };
}