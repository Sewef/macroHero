import { EditorView, basicSetup, minimalSetup } from "codemirror";
import { acceptCompletion, autocompletion, snippetCompletion } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
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
        Page: "readonly",
        Global: "readonly",
        Pages: "readonly",
        Event: "readonly",
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

const SCRIPT_HELPER_COMPLETIONS = [
  snippetCompletion("console.log(${value})", {
    label: "console.log",
    type: "function",
    detail: "(value)",
    info: completionInfo({
      signature: "console.log(value)",
      description: "Writes a diagnostic value to the browser console.",
      parameters: [["value", "Value or expression to inspect."]],
      example: "console.log(Page.hitPoints)",
      note: "Useful for debugging; it does not change the MacroHero state.",
    }),
  }),
];

const SCRIPT_NAMESPACE_DOCS = {
  GoogleSheets: "Reads cells and ranges from a configured Google Sheet.",
  Local: "Reads and writes values stored locally by MacroHero.",
  ConditionMarkers: "Reads and manages condition markers attached to tokens.",
  OwlTrackers: "Reads and updates OwlTrackers values attached to tokens.",
  TokenMetadata: "Observes raw metadata entries attached to Owlbear tokens.",
  StatBubbles: "Reads and updates Stat Bubbles, including health helpers.",
  ColoredRings: "Reads and manages colored rings around tokens.",
  JustDices: "Rolls dice through the Just Dices integration.",
  DicePlus: "Rolls advanced dice notation through Dice Plus.",
  PrettySordid: "Reads and manages initiative through Pretty Sordid.",
  Weather: "Reads and controls weather effects on a map.",
  Aurora: "Reads and controls Aurora lighting on a map.",
  Embers: "Builds and sends Embers visual-effect sequences.",
  Announcement: "Reads and controls the room announcement.",
  Auras: "Reads and manages token auras.",
  Token: "Finds, creates, and updates Owlbear Rodeo tokens.",
  Scene: "Provides helpers related to the current Owlbear scene.",
};

const SCRIPT_METHOD_DOCS = {
  "GoogleSheets.getValue": "Returns one value from a sheet range.",
  "GoogleSheets.getValues": "Returns values for several sheet ranges.",
  "GoogleSheets.getRange": "Returns the complete data for a sheet range.",
  "Local.value": "Returns a locally stored value, or the supplied default when absent.",
  "Local.set": "Stores a value locally under the supplied key.",
  "Local.clear": "Removes all locally stored MacroHero values.",
  "Local.keys": "Returns the available local-storage keys.",
  "ConditionMarkers.getConditions": "Returns all conditions attached to a token.",
  "ConditionMarkers.getValue": "Returns the stored value of a named token condition.",
  "ConditionMarkers.hasCondition": "Checks whether a token has the named condition.",
  "ConditionMarkers.addCondition": "Adds or configures a condition on a token.",
  "ConditionMarkers.removeCondition": "Removes a named condition from a token.",
  "ConditionMarkers.toggleCondition": "Adds or removes a named condition depending on its current state.",
  "ConditionMarkers.clearAllConditions": "Removes every condition from a token.",
  "OwlTrackers.getValue": "Returns the current value of a named tracker.",
  "OwlTrackers.onChange": "Creates a hook source that watches a named tracker on one token.",
  "OwlTrackers.getMax": "Returns the maximum value of a named tracker.",
  "OwlTrackers.setValue": "Sets the current value of a named tracker.",
  "OwlTrackers.addValue": "Adds a positive or negative delta to a tracker.",
  "OwlTrackers.addTracker": "Creates a tracker on a token from a configuration object.",
  "OwlTrackers.removeTracker": "Removes a tracker by name or identifier.",
  "StatBubbles.getValue": "Returns the current value of a named stat.",
  "StatBubbles.setValue": "Sets the value of a named stat.",
  "StatBubbles.addValue": "Adds a positive or negative amount to a stat.",
  "StatBubbles.getAllStats": "Returns all Stat Bubbles attached to a token.",
  "StatBubbles.getHealthPercentage": "Returns the token health as a percentage.",
  "StatBubbles.heal": "Increases a token's health by the supplied amount.",
  "StatBubbles.damage": "Decreases a token's health by the supplied amount.",
  "ColoredRings.getRings": "Returns all colored rings attached to a token.",
  "ColoredRings.hasRing": "Checks whether a token has a ring of the supplied color.",
  "ColoredRings.addRing": "Adds a colored ring to a token.",
  "ColoredRings.removeRing": "Removes a colored ring from a token.",
  "JustDices.roll": "Rolls a dice expression and publishes the result.",
  "JustDices.getRollObject": "Rolls an expression and returns its complete roll data.",
  "JustDices.rollSilent": "Rolls an expression without publishing the normal result.",
  "JustDices.getRollObjectSilent": "Returns complete roll data without publishing the normal result.",
  "DicePlus.isReady": "Waits for Dice Plus to become available.",
  "DicePlus.roll": "Rolls Dice Plus notation with optional display settings.",
  "DicePlus.rollTotal": "Rolls notation and returns its numeric total.",
  "DicePlus.rollSecret": "Rolls notation using the supplied visibility mode.",
  "DicePlus.getRollObject": "Rolls notation and returns the complete Dice Plus result.",
  "PrettySordid.hasInitiative": "Checks whether an item is present in initiative.",
  "PrettySordid.getInitiative": "Returns the initiative value for an item.",
  "PrettySordid.isActiveTurn": "Checks whether an item currently has the active turn.",
  "PrettySordid.setInitiative": "Sets an item's initiative count.",
  "PrettySordid.removeInitiative": "Removes an item from initiative.",
  "Weather.setWeather": "Applies a complete weather configuration to a map.",
  "Weather.removeWeather": "Removes the weather effect from a map.",
  "Weather.getWeather": "Returns the current weather configuration for a map.",
  "Weather.hasWeather": "Checks whether a map has an active weather effect.",
  "Weather.updateWeather": "Updates selected properties of the current map weather.",
  "Aurora.setAurora": "Applies an Aurora configuration or preset to a map.",
  "Aurora.removeAurora": "Removes Aurora lighting from a map.",
  "Aurora.getAurora": "Returns the current Aurora configuration for a map.",
  "Aurora.hasAurora": "Checks whether a map has Aurora lighting.",
  "Aurora.updateAurora": "Updates selected properties of the current Aurora lighting.",
  "Aurora.getPresets": "Returns the available Aurora lighting presets.",
  "Embers.sequence": "Starts a fluent Embers effect sequence.",
  "Embers.castProjectile": "Casts a projectile effect from one token to one or more targets.",
  "Embers.castAOE": "Casts an area-of-effect animation on a group of tokens.",
  "Embers.castCone": "Casts a cone effect from a caster toward a target.",
  "Embers.sendInstructions": "Sends a complete list of Embers instructions.",
  "Announcement.setAnnouncement": "Sets the room announcement content and active state.",
  "Announcement.getAnnouncement": "Returns the current room announcement.",
  "Announcement.removeAnnouncementMetadata": "Removes the announcement data from the room.",
  "Announcement.updateAnnouncement": "Updates selected announcement properties.",
  "Announcement.toggleAnnouncement": "Toggles the announcement visibility.",
  "Announcement.showAnnouncement": "Makes the current announcement visible.",
  "Announcement.hideAnnouncement": "Hides the current announcement.",
  "Announcement.updateContent": "Replaces the current announcement content.",
  "Auras.hasAura": "Checks whether an item has at least one aura.",
  "Auras.getAuras": "Returns all auras attached to an item.",
  "Auras.addAura": "Adds an aura from a configuration object.",
  "Auras.removeAura": "Removes the aura attached to an item.",
  "Token.getSelected": "Returns the first selected token identifier.",
  "Token.getSelectedAll": "Returns all selected token identifiers.",
  "Token.getPosition": "Returns a token's scene position.",
  "Token.getSize": "Returns a token's dimensions.",
  "Token.getClosest": "Returns the closest token matching an optional filter.",
  "Token.create": "Creates one token from a parameter object.",
  "Token.createMany": "Creates several tokens from parameter objects.",
  "Token.setVisible": "Changes visibility for one or more items.",
  "Token.setLocked": "Changes the locked state for one or more items.",
  "Token.setImage": "Changes the image used by one or more items.",
  "Token.setName": "Changes the name of one or more items.",
  "Token.setLabel": "Changes the label of one or more items.",
  "Token.setLayer": "Moves one or more items to a scene layer.",
  "Token.setPosition": "Moves one or more items to a scene or grid position.",
  "Token.setScale": "Changes the scale of one or more items.",
  "Token.setRotation": "Changes the rotation of one or more items.",
  "Token.setMetadata": "Merges metadata into one or more items.",
  "Scene.getMapIdFromToken": "Returns the map identifier underneath the supplied token.",
  "TokenMetadata.onChange": "Creates a hook source that watches one metadata key on one token.",
};

const SCRIPT_NAMESPACE_SIGNATURES = {
  GoogleSheets: {
    getValue: ["sheetId", "sheetName", "range"],
    getValues: ["sheetId", "sheetName", "ranges"],
    getRange: ["sheetId", "sheetName", "range"],
  },
  Local: {
    value: ["key", "defaultValue"],
    set: ["key", "value"],
    clear: [],
    keys: [],
  },
  ConditionMarkers: {
    getConditions: ["tokenId"],
    getValue: ["tokenId", "conditionName"],
    hasCondition: ["tokenId", "conditionName"],
    addCondition: ["tokenId", "conditionName", "options"],
    removeCondition: ["tokenId", "conditionName"],
    toggleCondition: ["tokenId", "conditionName"],
    clearAllConditions: ["tokenId"],
  },
  OwlTrackers: {
    onChange: ["tokenId", "trackerName"],
    getValue: ["tokenId", "trackerName"],
    getMax: ["tokenId", "trackerName"],
    setValue: ["tokenId", "trackerName", "value"],
    addValue: ["tokenId", "trackerName", "delta"],
    addTracker: ["tokenId", "trackerConfig"],
    removeTracker: ["tokenId", "trackerIdentifier"],
  },
  StatBubbles: {
    getValue: ["tokenId", "statName"],
    setValue: ["tokenId", "statName", "value"],
    addValue: ["tokenId", "statName", "amount"],
    getAllStats: ["tokenId"],
    getHealthPercentage: ["tokenId"],
    heal: ["tokenId", "amount"],
    damage: ["tokenId", "amount"],
  },
  ColoredRings: {
    getRings: ["tokenId"],
    hasRing: ["tokenId", "color"],
    addRing: ["tokenId", "color"],
    removeRing: ["tokenId", "color"],
  },
  JustDices: {
    roll: ["expression", "hiddenOrOptions"],
    getRollObject: ["expression", "hiddenOrOptions"],
    rollSilent: ["expression", "hidden"],
    getRollObjectSilent: ["expression", "hidden"],
  },
  DicePlus: {
    isReady: ["timeoutMs"],
    roll: ["diceNotation", "options"],
    rollTotal: ["diceNotation", "options"],
    rollSecret: ["diceNotation", "visibility", "options"],
    getRollObject: ["diceNotation", "options"],
  },
  PrettySordid: {
    hasInitiative: ["itemOrId"],
    getInitiative: ["itemOrId"],
    isActiveTurn: ["itemOrId"],
    setInitiative: ["itemOrId", "count"],
    removeInitiative: ["itemOrId"],
  },
  Weather: {
    setWeather: ["mapId", "config"],
    removeWeather: ["mapId"],
    getWeather: ["mapId"],
    hasWeather: ["mapId"],
    updateWeather: ["mapId", "updates"],
  },
  Aurora: {
    setAurora: ["mapId", "config"],
    removeAurora: ["mapId"],
    getAurora: ["mapId"],
    hasAurora: ["mapId"],
    updateAurora: ["mapId", "updates"],
    getPresets: [],
  },
  Embers: {
    sequence: [],
    castProjectile: ["effectId", "casterId", "targetIds", "config"],
    castAOE: ["effectId", "tokenIds", "config"],
    castCone: ["effectId", "casterId", "targetId", "config"],
    sendInstructions: ["instructions", "options"],
  },
  Announcement: {
    setAnnouncement: ["content", "active"],
    getAnnouncement: [],
    removeAnnouncementMetadata: [],
    updateAnnouncement: ["updates"],
    toggleAnnouncement: [],
    showAnnouncement: [],
    hideAnnouncement: [],
    updateContent: ["content"],
  },
  Auras: {
    hasAura: ["itemId"],
    getAuras: ["itemId"],
    addAura: ["itemId", "config"],
    removeAura: ["itemId"],
  },
  Token: {
    getSelected: [],
    getSelectedAll: [],
    getPosition: ["tokenId"],
    getSize: ["tokenId"],
    getClosest: ["tokenId", "filter"],
    create: ["params"],
    createMany: ["tokensParams"],
    setVisible: ["itemIds", "visible"],
    setLocked: ["itemIds", "locked"],
    setImage: ["itemIds", "url", "mime"],
    setName: ["itemIds", "name"],
    setLabel: ["itemIds", "label"],
    setLayer: ["itemIds", "layer"],
    setPosition: ["itemIds", "position", "gridPosition"],
    setScale: ["itemIds", "scale"],
    setRotation: ["itemIds", "rotation"],
    setMetadata: ["itemIds", "metadata"],
  },
  Scene: {
    getMapIdFromToken: ["tokenId"],
  },
  TokenMetadata: {
    onChange: ["tokenId", "metadataKey"],
  },
};

const SCRIPT_NAMESPACE_METHODS = Object.fromEntries(
  Object.entries(SCRIPT_NAMESPACE_SIGNATURES).map(([namespace, methods]) => [
    namespace,
    Object.entries(methods).map(([label, args]) => methodCompletion(namespace, label, args)),
  ]),
);

const SCRIPT_NAMESPACE_COMPLETIONS = [
  ...Object.keys(SCRIPT_NAMESPACE_METHODS).sort().map(label => ({
    label,
    type: "namespace",
    detail: "MacroHero API",
    info: completionInfo({
      signature: label,
      description: SCRIPT_NAMESPACE_DOCS[label],
      note: "Type a dot after the namespace to list its available methods.",
    }),
  })),
  {
    label: "Owlbear",
    type: "namespace",
    detail: "Owlbear Rodeo SDK",
    info: completionInfo({
      signature: "Owlbear",
      description: "Full Owlbear Rodeo SDK proxy exposed to MacroHero scripts.",
      note: "Use the official Owlbear SDK object paths after this namespace.",
    }),
  },
];

const EVENT_PROPERTY_DOCS = {
  type: "Observer event type, for example OwlTrackers.onChange.",
  integration: "Name of the integration that produced the event.",
  hookId: "ID of the page event currently executing.",
  pageId: "ID of the page that owns the event.",
  tokenId: "ID of the observed Owlbear token.",
  token: "Latest Owlbear token snapshot, or null when it no longer exists.",
  metadataKey: "Metadata key watched by the observer.",
  change: "Change kind: created, updated, or removed.",
  previousValue: "Value selected before the metadata change.",
  value: "Value selected after the metadata change.",
  timestamp: "Event creation time in milliseconds since Unix epoch.",
  trackerName: "Name of the OwlTrackers tracker selected by the observer.",
  previousTracker: "Complete tracker snapshot before the change.",
  tracker: "Complete tracker snapshot after the change.",
  previousMax: "Previous OwlTrackers maximum value.",
  max: "Current OwlTrackers maximum value.",
  delta: "Numeric difference between the new and previous tracker values, or null.",
};

const EVENT_PROPERTY_COMPLETIONS = Object.entries(EVENT_PROPERTY_DOCS).map(([label, description]) => ({
  label,
  type: "property",
  detail: "Hook event field",
  info: completionInfo({
    signature: `Event.${label}`,
    description,
    note: "Event is read-only and only exists while a hook condition or command is executing.",
  }),
}));

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
  ".cm-tooltip-autocomplete > ul": {
    maxWidth: "min(520px, 72vw)",
  },
  ".cm-completionInfo": {
    maxWidth: "420px",
  },
  ".mh-completion-doc": {
    padding: "10px 12px",
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    fontSize: "var(--font-xs)",
    lineHeight: "1.45",
  },
  ".mh-completion-signature": {
    display: "block",
    marginBottom: "7px",
    color: "var(--accent2)",
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
    whiteSpace: "pre-wrap",
  },
  ".mh-completion-description": {
    margin: "0 0 8px",
  },
  ".mh-completion-parameters": {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    gap: "4px 10px",
    margin: "8px 0",
  },
  ".mh-completion-parameters dt": {
    color: "var(--accent2)",
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
  },
  ".mh-completion-parameters dd": {
    margin: "0",
    color: "var(--text2)",
  },
  ".mh-completion-example, .mh-completion-note": {
    margin: "8px 0 0",
    color: "var(--text2)",
  },
  ".mh-completion-example code": {
    color: "var(--success, #7dd3a7)",
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
  },
  ".cm-diagnostic": {
    padding: "3px 6px",
  },
  ".cm-diagnosticText": {
    fontSize: "var(--font-xs)",
  },
}, { dark: true });

export function enhanceCodeEditors(root = document, options = {}) {
  const textareas = root.matches?.("textarea[data-editor-lang]")
    ? [root]
    : Array.from(root.querySelectorAll?.("textarea[data-editor-lang]") || []);

  textareas.forEach(textarea => {
    if (editorViews.has(textarea)) return;
    const view = createEditor(textarea, options);
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

function createEditor(textarea, options = {}) {
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
      ...languageExtensions(language, options),
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
  if (language === "js" || language === "javascript") {
    const help = document.createElement("small");
    help.className = "code-editor-help";
    help.textContent = "Ctrl+Space: suggestions · Tab: insert selection · ↑/↓: browse · Esc: close";
    view.dom.after(help);
  }
  return view;
}

function languageExtensions(language, options = {}) {
  if (language === "json") return [json(), linter(jsonParseLinter())];
  if (language === "js" || language === "javascript") {
    const javascriptSupport = javascript();
    return [
      javascriptSupport,
      javascriptSupport.language.data.of({
        autocomplete: createScriptCompletionSource(options.variables || []),
      }),
      Prec.high(keymap.of([{ key: "Tab", run: acceptCompletion }])),
      autocompletion({ activateOnTyping: true, selectOnOpen: true, maxRenderedOptions: 80 }),
      linter(safeJsLintSource),
    ];
  }
  if (language === "md" || language === "markdown") return [markdown(), linter(markdownFenceLinter)];
  return [];
}

function createScriptCompletionSource(variables = []) {
  const variableOptions = variables
    .map(variable => typeof variable === "string" ? { name: variable } : variable)
    .filter(variable => isJsIdentifier(variable?.name))
    .map(variable => ({
      label: variable.name,
      type: "variable",
      detail: variable.detail || "MacroHero variable",
      scope: variable.scope || "Page",
      pageKey: variable.pageKey,
      info: completionInfo({
        signature: variable.scope === "Pages"
          ? `Pages.${variable.pageKey}.${variable.name}`
          : `${variable.scope || "Page"}.${variable.name}`,
        description: variable.info || "Resolved MacroHero variable available in this script.",
        note: variable.detail || "The value is resolved from its declared MacroHero scope.",
      }),
    }));
  const scopedVariableOptions = {
    Page: variableOptions.filter(variable => variable.scope === "Page"),
    Global: variableOptions.filter(variable => variable.scope === "Global"),
  };
  const pagesVariableOptions = variableOptions
    .filter(variable => variable.scope === "Pages")
    .reduce((groups, variable) => {
      if (!groups[variable.pageKey]) groups[variable.pageKey] = [];
      groups[variable.pageKey].push(variable);
      return groups;
    }, {});
  const pageNamespaceOptions = Object.keys(pagesVariableOptions).sort().map(pageKey => ({
    label: pageKey,
    type: "namespace",
    detail: variables.find(variable => variable.pageKey === pageKey)?.pageLabel || "Page variables",
    info: completionInfo({
      signature: `Pages.${pageKey}`,
      description: `State and computed variables declared by the ${pageKey} page.`,
      note: "State variables are writable; computed variables are read-only.",
    }),
  }));
  const rootOptions = [
    ...SCRIPT_HELPER_COMPLETIONS,
    ...["Page", "Global", "Pages", "Event"].map(label => ({
      label,
      type: "namespace",
      detail: label === "Event"
        ? "Current hook event"
        : label === "Page"
        ? "Current page variables"
        : (label === "Pages" ? "Variables from every page" : "Global variables"),
      info: completionInfo({
        signature: label,
        description: label === "Event"
          ? "Read-only payload supplied while an event hook is executing."
          : label === "Page"
          ? "State and computed variables belonging to the current page. Computed values are read-only."
          : (label === "Pages"
            ? "Access variables from any page through its Page ID."
            : "State and computed variables shared by every page. Computed values are read-only."),
        note: label === "Event"
          ? "Available in hook conditions and commands only."
          : label === "Pages"
          ? "Use Pages.pageId.variableName."
          : "Type a dot to list the variables available in this scope.",
      }),
    })),
    ...SCRIPT_NAMESPACE_COMPLETIONS,
  ];

  return context => {
    const nestedProperty = context.matchBefore(/Pages\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/);
    if (nestedProperty) {
      const pageKey = nestedProperty.text.split(".")[1];
      const options = pagesVariableOptions[pageKey];
      if (!options) return null;
      return {
        from: nestedProperty.from + `Pages.${pageKey}.`.length,
        options,
        validFor: /^[\w$]*$/,
      };
    }

    const property = context.matchBefore(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/);
    if (property) {
      const [namespace] = property.text.split(".");
      const methods = namespace === "Pages"
        ? pageNamespaceOptions
        : (namespace === "Event"
          ? EVENT_PROPERTY_COMPLETIONS
          : (SCRIPT_NAMESPACE_METHODS[namespace] || scopedVariableOptions[namespace]));
      if (!methods) return null;
      return {
        from: property.from + namespace.length + 1,
        options: methods,
        validFor: /^[\w$]*$/,
      };
    }

    const word = context.matchBefore(/[A-Za-z_$][\w$]*$/);
    if (!word && !context.explicit) return null;
    return {
      from: word ? word.from : context.pos,
      options: rootOptions,
      validFor: /^[\w$]*$/,
    };
  };
}

function methodCompletion(namespace, label, args) {
  const placeholders = args.map(arg => `\${${arg}}`).join(", ");
  return snippetCompletion(`${label}(${placeholders})`, {
    label,
    type: "function",
    detail: `(${args.join(", ")})`,
    info: completionInfo({
      signature: label === "onChange"
        ? `${namespace}.${label}(${args.join(", ")})`
        : `await ${namespace}.${label}(${args.join(", ")})`,
      description: SCRIPT_METHOD_DOCS[`${namespace}.${label}`] || `${label} operation provided by the ${namespace} integration.`,
      parameters: args.map(arg => [arg, parameterDescription(arg)]),
      example: label === "onChange"
        ? (namespace === "OwlTrackers"
          ? 'OwlTrackers.onChange(Page.token, "HP")'
          : 'TokenMetadata.onChange(Page.token, "com.example/status")')
        : "",
      note: label === "onChange"
        ? "Use this descriptor in a page event Watch field; it does not subscribe when called from a command."
        : "Integration calls may be asynchronous; use await when you need the returned value or completion.",
    }),
  });
}

function completionInfo({ signature, description, parameters = [], example = "", note = "" }) {
  return () => {
    const root = document.createElement("section");
    root.className = "mh-completion-doc";

    const signatureNode = document.createElement("code");
    signatureNode.className = "mh-completion-signature";
    signatureNode.textContent = signature;
    root.append(signatureNode);

    if (description) {
      const paragraph = document.createElement("p");
      paragraph.className = "mh-completion-description";
      paragraph.textContent = description;
      root.append(paragraph);
    }

    if (parameters.length) {
      const list = document.createElement("dl");
      list.className = "mh-completion-parameters";
      parameters.forEach(([name, text]) => {
        const term = document.createElement("dt");
        term.textContent = name;
        const definition = document.createElement("dd");
        definition.textContent = text;
        list.append(term, definition);
      });
      root.append(list);
    }

    if (example) {
      const exampleNode = document.createElement("p");
      exampleNode.className = "mh-completion-example";
      exampleNode.append("Example: ");
      const code = document.createElement("code");
      code.textContent = example;
      exampleNode.append(code);
      root.append(exampleNode);
    }

    if (note) {
      const noteNode = document.createElement("p");
      noteNode.className = "mh-completion-note";
      noteNode.textContent = note;
      root.append(noteNode);
    }

    return { dom: root };
  };
}

function parameterDescription(name) {
  const exact = {
    active: "Whether the feature should be active.",
    amount: "Numeric amount to apply.",
    color: "CSS/HTML color value.",
    config: "Configuration object for this operation.",
    count: "Numeric initiative value.",
    defaultValue: "Value returned when the key does not exist.",
    delta: "Positive or negative numeric change.",
    diceNotation: "Dice expression such as '1d20+5'.",
    expression: "Dice expression such as '2d6+3'.",
    filter: "Optional predicate or filter configuration.",
    gridPosition: "Optional grid-relative position.",
    hidden: "Whether the result should be hidden.",
    hiddenOrOptions: "Hidden flag or advanced roll options.",
    instructions: "Array of Embers effect instructions.",
    itemId: "Owlbear item identifier.",
    itemIds: "Array of Owlbear item identifiers.",
    itemOrId: "Owlbear item object or its identifier.",
    key: "Local-storage key.",
    mapId: "Identifier of the target map.",
    metadataKey: "Complete metadata namespace key to observe.",
    mime: "Image MIME type.",
    options: "Optional settings object.",
    params: "Token creation parameters.",
    range: "A1-style sheet range.",
    ranges: "Array of A1-style sheet ranges.",
    sheetId: "Google Sheet identifier.",
    sheetName: "Name of the sheet tab.",
    targetId: "Identifier of the target token.",
    targetIds: "Array of target token identifiers.",
    timeoutMs: "Maximum wait time in milliseconds.",
    tokenId: "Identifier of the target token.",
    tokenIds: "Array of token identifiers.",
    trackerName: "Exact OwlTrackers tracker name, for example 'HP'.",
    tokensParams: "Array of token creation parameter objects.",
    updates: "Object containing only the properties to update.",
    value: "Value to store or apply.",
    visibility: "Roll visibility mode.",
  };
  if (exact[name]) return exact[name];
  if (/Name$/.test(name)) return "Name used by the integration.";
  if (/Id$/.test(name)) return "Owlbear item identifier.";
  if (/Ids$/.test(name)) return "Array of Owlbear item identifiers.";
  return "Value passed to this operation.";
}

function isJsIdentifier(value) {
  return /^[A-Za-z_$][\w$]*$/.test(String(value || ""));
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
