import "vanilla-jsoneditor/themes/jse-theme-dark.css";
import { createJSONEditor, createAjvValidator, Mode } from "vanilla-jsoneditor";
import { MACRO_HERO_CONFIG_JSON_SCHEMA } from "../configJsonSchema.js";
import { formatConfig } from "./utils.js";

let editor = null;
let textarea = null;
let statusEl = null;
let lastContent = { text: "" };
let syncing = false;

const validator = createAjvValidator({
  schema: MACRO_HERO_CONFIG_JSON_SCHEMA,
});

export function ensureRawJsonEditor() {
  if (editor) return editor;

  const target = document.getElementById("jsonEditorHost");
  textarea = document.getElementById("cfgArea");
  statusEl = document.getElementById("jsonEditorStatus");
  if (!target || !textarea) return null;

  lastContent = contentFromText(textarea.value);
  editor = createJSONEditor({
    target,
    props: {
      content: lastContent,
      mode: Mode.text,
      mainMenuBar: true,
      navigationBar: true,
      statusBar: true,
      validator,
      onChange: (updatedContent, _previousContent, status) => {
        lastContent = updatedContent;
        if (!syncing) textarea.value = textFromContent(updatedContent);
        renderStatus(status?.contentErrors);
      },
      onError: error => {
        renderStatus(error?.message || "JSON editor error.");
      },
    },
  });

  return editor;
}

export function syncRawJsonEditorFromTextarea() {
  const instance = ensureRawJsonEditor();
  if (!instance || !textarea) return;

  const nextContent = contentFromText(textarea.value);
  if (textFromContent(nextContent) === textFromContent(lastContent)) return;

  syncing = true;
  lastContent = nextContent;
  instance.set(nextContent);
  syncing = false;
}

export function getRawJsonText() {
  if (!editor) return textarea?.value || document.getElementById("cfgArea")?.value || "";
  const content = editor.get();
  return textFromContent(content);
}

export function setRawJsonValue(value) {
  textarea = textarea || document.getElementById("cfgArea");
  if (textarea) textarea.value = value;
  if (editor) syncRawJsonEditorFromTextarea();
}

function contentFromText(text) {
  try {
    return { json: JSON.parse(text) };
  } catch {
    return { text: text || "" };
  }
}

function textFromContent(content) {
  if (!content) return "";
  if ("text" in content) return content.text || "";
  return formatConfig(content.json);
}

function renderStatus(contentErrors) {
  if (!statusEl) return;
  if (!contentErrors || (Array.isArray(contentErrors) && contentErrors.length === 0)) {
    statusEl.textContent = "JSON valide.";
    statusEl.className = "json-editor-status ok";
    return;
  }

  const message = Array.isArray(contentErrors)
    ? `${contentErrors.length} erreur(s) de validation.`
    : contentErrors.message || "JSON invalide.";
  statusEl.textContent = message;
  statusEl.className = "json-editor-status error";
}
