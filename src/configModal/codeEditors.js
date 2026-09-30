import { EditorView, basicSetup, minimalSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { javascript, esLint } from "@codemirror/lang-javascript";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";

const editorViews = new WeakMap();
let jsLintSourcePromise = null;

const JS_LINT_CONFIG = [
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        Math: "readonly",
        JSON: "readonly",
        Date: "readonly",
        Promise: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      "no-cond-assign": ["error", "always"],
      "no-constant-condition": "warn",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-obj-calls": "error",
      "no-redeclare": "warn",
      "no-self-assign": "warn",
      "no-sparse-arrays": "error",
      "no-unexpected-multiline": "error",
      "no-unreachable": "error",
      "no-unused-labels": "warn",
    },
  },
];

const macroHeroTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--control)",
    color: "var(--text)",
    border: "1px solid var(--border2)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-sm)",
  },
  "&.cm-focused": {
    outline: "none",
    borderColor: "var(--accent)",
    boxShadow: "var(--focus-ring)",
  },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
    lineHeight: "1.45",
  },
  ".cm-content": {
    minHeight: "var(--cm-min-height, 120px)",
    padding: "8px 0",
  },
  ".cm-line": {
    padding: "0 10px",
  },
  ".cm-gutters": {
    backgroundColor: "color-mix(in srgb, var(--control) 82%, black)",
    color: "var(--text3)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(126, 163, 255, 0.09)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(126, 163, 255, 0.11)",
    color: "var(--text)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(126, 163, 255, 0.35)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--surface2)",
    border: "1px solid var(--border2)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text)",
    boxShadow: "var(--shadow-md)",
  },
  ".cm-diagnostic": {
    padding: "3px 6px",
  },
  ".cm-diagnosticText": {
    fontSize: "var(--font-xs)",
  },
}, { dark: true });

export function enhanceCodeEditors(root = document) {
  const textareas = root.matches?.("textarea[data-editor-lang]")
    ? [root]
    : Array.from(root.querySelectorAll?.("textarea[data-editor-lang]") || []);

  textareas.forEach(textarea => {
    if (editorViews.has(textarea)) return;
    const view = createEditor(textarea);
    editorViews.set(textarea, view);
  });
}

export function syncCodeEditor(target) {
  const textarea = typeof target === "string" ? document.getElementById(target) : target;
  if (!textarea) return;
  const view = editorViews.get(textarea);
  if (!view) return;

  const nextValue = textarea.value || "";
  const currentValue = view.state.doc.toString();
  if (nextValue === currentValue) return;

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: nextValue },
  });
}

function createEditor(textarea) {
  const language = String(textarea.dataset.editorLang || "").toLowerCase();
  const rows = Math.max(3, Number(textarea.getAttribute("rows")) || (language === "json" ? 22 : 5));
  const minHeight = Math.min(560, Math.max(92, rows * 19 + 18));

  textarea.classList.add("code-editor-source");

  const view = new EditorView({
    doc: textarea.value || "",
    extensions: [
      language === "json" ? basicSetup : minimalSetup,
      oneDark,
      macroHeroTheme,
      EditorView.lineWrapping,
      lintGutter(),
      ...languageExtensions(language),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        textarea.value = update.state.doc.toString();
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }),
      EditorView.domEventHandlers({
        blur: () => textarea.dispatchEvent(new Event("change", { bubbles: true })),
      }),
    ],
  });

  view.dom.classList.add("mh-code-editor", `mh-code-editor-${language || "plain"}`);
  view.dom.style.setProperty("--cm-min-height", `${minHeight}px`);
  textarea.after(view.dom);
  return view;
}

function languageExtensions(language) {
  if (language === "json") return [json(), linter(jsonParseLinter())];
  if (language === "js" || language === "javascript") return [javascript(), linter(safeJsLintSource)];
  if (language === "md" || language === "markdown") return [markdown(), linter(markdownFenceLinter)];
  return [];
}

async function safeJsLintSource(view) {
  try {
    const jsLintSource = await getJsLintSource();
    return jsLintSource(view);
  } catch (error) {
    return [{
      from: 0,
      to: 0,
      severity: "error",
      source: "eslint",
      message: error?.message || "Unable to validate JavaScript.",
    }];
  }
}

function getJsLintSource() {
  if (!jsLintSourcePromise) {
    jsLintSourcePromise = import("eslint-linter-browserify")
      .then(({ Linter }) => esLint(new Linter(), JS_LINT_CONFIG));
  }
  return jsLintSourcePromise;
}

function markdownFenceLinter(view) {
  const doc = view.state.doc;
  let openFence = null;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const match = line.text.match(/^\s*(`{3,}|~{3,})/);
    if (!match) continue;

    const marker = match[1];
    if (!openFence) {
      openFence = { line, marker };
      continue;
    }

    const sameMarker = marker[0] === openFence.marker[0] && marker.length >= openFence.marker.length;
    if (sameMarker) openFence = null;
  }

  if (!openFence) return [];
  return [{
    from: openFence.line.from,
    to: openFence.line.to,
    severity: "warning",
    source: "markdown",
    message: "Code fence is not closed.",
  }];
}
