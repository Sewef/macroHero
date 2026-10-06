import { EditorView, minimalSetup } from "codemirror";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { formatValidationErrors, validateConfigShape } from "../configValidation.js";

let editor = null;
let textarea = null;
let statusEl = null;
let syncing = false;

export function ensureRawJsonEditor() {
  if (editor) return editor;

  const target = document.getElementById("jsonEditorHost");
  textarea = document.getElementById("cfgArea");
  statusEl = document.getElementById("jsonEditorStatus");
  if (!target || !textarea) return null;

  target.replaceChildren();
  target.classList.add("mh-code-editor", "mh-code-editor-json");

  const extensions = [
    minimalSetup,
    json(),
    lintGutter(),
    linter(jsonParseLinter()),
    EditorView.lineWrapping,
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      const text = update.state.doc.toString();
      if (!syncing) textarea.value = text;
      renderStatus(text);
    }),
  ];

  if (document.documentElement.classList.contains("mh-dark")) {
    extensions.push(oneDark);
  }

  editor = new EditorView({
    doc: textarea.value,
    extensions,
    parent: target,
  });
  renderStatus(textarea.value);
  return editor;
}

export function syncRawJsonEditorFromTextarea() {
  const instance = ensureRawJsonEditor();
  if (!instance || !textarea) return;

  const nextText = textarea.value || "";
  const currentText = instance.state.doc.toString();
  if (nextText === currentText) return;

  syncing = true;
  instance.dispatch({ changes: { from: 0, to: currentText.length, insert: nextText } });
  syncing = false;
  renderStatus(nextText);
}

export function getRawJsonText() {
  return editor?.state.doc.toString()
    ?? textarea?.value
    ?? document.getElementById("cfgArea")?.value
    ?? "";
}

export function setRawJsonValue(value) {
  textarea = textarea || document.getElementById("cfgArea");
  if (textarea) textarea.value = value;
  if (editor) syncRawJsonEditorFromTextarea();
}

function renderStatus(text) {
  if (!statusEl) return;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    statusEl.textContent = error?.message || "JSON invalide.";
    statusEl.className = "json-editor-status error";
    return;
  }

  const validation = validateConfigShape(parsed);
  if (!validation.valid) {
    statusEl.textContent = formatValidationErrors(validation.errors);
    statusEl.className = "json-editor-status error";
    return;
  }

  statusEl.textContent = "JSON valide.";
  statusEl.className = "json-editor-status ok";
}
