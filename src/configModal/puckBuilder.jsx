import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Puck } from "@puckeditor/core";
import { EditorView, minimalSetup } from "codemirror";
import { autocompletion, snippetCompletion } from "@codemirror/autocomplete";
import { javascript, esLint } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { linter, lintGutter } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { parseMd, sanitizeHtml, MD_PATTERN } from "../ui/markdownUtils.js";
import "@puckeditor/core/puck.css";

console.info("[MacroHero Builder] Puck module loaded");

let root = null;

// Static Puck configuration data must stay above PUCK_CONFIG. Keeping these
// values grouped avoids runtime TDZ failures during dynamic import evaluation.
const BOOLEAN_OPTIONS = [
  { label: "No", value: "no" },
  { label: "Yes", value: "yes" },
];

const MATRIX_SHAPE_OPTIONS = [
  { label: "Square", value: "square" },
  { label: "Rectangle", value: "rectangle" },
];

const DIVIDER_STYLE_OPTIONS = [
  { label: "Default", value: "" },
  { label: "Solid", value: "solid" },
  { label: "Dashed", value: "dashed" },
  { label: "Dotted", value: "dotted" },
];

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

const SCRIPT_HELPER_COMPLETIONS = [
  snippetCompletion("await setValue(${varName}, ${value})", {
    label: "setValue",
    type: "function",
    detail: "(varName, value)",
    info: "Set a State variable and refresh dependent values.",
  }),
  snippetCompletion("await addValue(${varName}, ${delta})", {
    label: "addValue",
    type: "function",
    detail: "(varName, delta)",
    info: "Add a numeric delta to a State variable.",
  }),
  snippetCompletion("console.log(${value})", {
    label: "console.log",
    type: "function",
    detail: "(value)",
    info: "Write a value to the browser console.",
  }),
];

const SCRIPT_NAMESPACE_METHODS = {
  GoogleSheets: [
    methodCompletion("getValue", "(sheetId, sheetName, range)", "getValue(${sheetId}, ${sheetName}, ${range})"),
    methodCompletion("getValues", "(sheetId, sheetName, ranges)", "getValues(${sheetId}, ${sheetName}, ${ranges})"),
    methodCompletion("getRange", "(sheetId, sheetName, range)", "getRange(${sheetId}, ${sheetName}, ${range})"),
  ],
  Local: [
    methodCompletion("value", "(key, defaultValue)", "value(${key}, ${defaultValue})"),
    methodCompletion("set", "(key, value)", "set(${key}, ${value})"),
    methodCompletion("clear", "()", "clear()"),
    methodCompletion("keys", "()", "keys()"),
  ],
  ConditionMarkers: [
    methodCompletion("getConditions", "(tokenId)", "getConditions(${tokenId})"),
    methodCompletion("getValue", "(tokenId, conditionName)", "getValue(${tokenId}, ${conditionName})"),
    methodCompletion("hasCondition", "(tokenId, conditionName)", "hasCondition(${tokenId}, ${conditionName})"),
    methodCompletion("addCondition", "(tokenId, conditionName, options)", "addCondition(${tokenId}, ${conditionName}, ${options})"),
    methodCompletion("removeCondition", "(tokenId, conditionName)", "removeCondition(${tokenId}, ${conditionName})"),
    methodCompletion("toggleCondition", "(tokenId, conditionName)", "toggleCondition(${tokenId}, ${conditionName})"),
    methodCompletion("clearAllConditions", "(tokenId)", "clearAllConditions(${tokenId})"),
  ],
  OwlTrackers: [
    methodCompletion("getValue", "(tokenId, trackerName)", "getValue(${tokenId}, ${trackerName})"),
    methodCompletion("getMax", "(tokenId, trackerName)", "getMax(${tokenId}, ${trackerName})"),
    methodCompletion("setValue", "(tokenId, trackerName, value)", "setValue(${tokenId}, ${trackerName}, ${value})"),
    methodCompletion("addValue", "(tokenId, trackerName, delta)", "addValue(${tokenId}, ${trackerName}, ${delta})"),
    methodCompletion("addTracker", "(tokenId, trackerConfig)", "addTracker(${tokenId}, ${trackerConfig})"),
    methodCompletion("removeTracker", "(tokenId, trackerIdentifier)", "removeTracker(${tokenId}, ${trackerIdentifier})"),
  ],
  StatBubbles: [
    methodCompletion("getValue", "(tokenId, statName)", "getValue(${tokenId}, ${statName})"),
    methodCompletion("setValue", "(tokenId, statName, value)", "setValue(${tokenId}, ${statName}, ${value})"),
    methodCompletion("addValue", "(tokenId, statName, amount)", "addValue(${tokenId}, ${statName}, ${amount})"),
    methodCompletion("getAllStats", "(tokenId)", "getAllStats(${tokenId})"),
    methodCompletion("getHealthPercentage", "(tokenId)", "getHealthPercentage(${tokenId})"),
    methodCompletion("heal", "(tokenId, amount)", "heal(${tokenId}, ${amount})"),
    methodCompletion("damage", "(tokenId, amount)", "damage(${tokenId}, ${amount})"),
  ],
  ColoredRings: [
    methodCompletion("getRings", "(tokenId)", "getRings(${tokenId})"),
    methodCompletion("hasRing", "(tokenId, color)", "hasRing(${tokenId}, ${color})"),
    methodCompletion("addRing", "(tokenId, color)", "addRing(${tokenId}, ${color})"),
    methodCompletion("removeRing", "(tokenId, color)", "removeRing(${tokenId}, ${color})"),
  ],
  JustDices: [
    methodCompletion("roll", "(expression, hiddenOrOptions)", "roll(${expression}, ${hiddenOrOptions})"),
    methodCompletion("getRollObject", "(expression, hiddenOrOptions)", "getRollObject(${expression}, ${hiddenOrOptions})"),
    methodCompletion("rollSilent", "(expression, hidden)", "rollSilent(${expression}, ${hidden})"),
    methodCompletion("getRollObjectSilent", "(expression, hidden)", "getRollObjectSilent(${expression}, ${hidden})"),
  ],
  DicePlus: [
    methodCompletion("isReady", "(timeoutMs)", "isReady(${timeoutMs})"),
    methodCompletion("roll", "(diceNotation, options)", "roll(${diceNotation}, ${options})"),
    methodCompletion("rollTotal", "(diceNotation, options)", "rollTotal(${diceNotation}, ${options})"),
    methodCompletion("rollSecret", "(diceNotation, visibility, options)", "rollSecret(${diceNotation}, ${visibility}, ${options})"),
    methodCompletion("getRollObject", "(diceNotation, options)", "getRollObject(${diceNotation}, ${options})"),
  ],
  PrettySordid: [
    methodCompletion("hasInitiative", "(itemOrId)", "hasInitiative(${itemOrId})"),
    methodCompletion("getInitiative", "(itemOrId)", "getInitiative(${itemOrId})"),
    methodCompletion("isActiveTurn", "(itemOrId)", "isActiveTurn(${itemOrId})"),
    methodCompletion("setInitiative", "(itemOrId, count)", "setInitiative(${itemOrId}, ${count})"),
    methodCompletion("removeInitiative", "(itemOrId)", "removeInitiative(${itemOrId})"),
  ],
  Weather: [
    methodCompletion("setWeather", "(mapId, config)", "setWeather(${mapId}, ${config})"),
    methodCompletion("removeWeather", "(mapId)", "removeWeather(${mapId})"),
    methodCompletion("getWeather", "(mapId)", "getWeather(${mapId})"),
    methodCompletion("hasWeather", "(mapId)", "hasWeather(${mapId})"),
    methodCompletion("updateWeather", "(mapId, updates)", "updateWeather(${mapId}, ${updates})"),
  ],
  Aurora: [
    methodCompletion("setAurora", "(mapId, config)", "setAurora(${mapId}, ${config})"),
    methodCompletion("removeAurora", "(mapId)", "removeAurora(${mapId})"),
    methodCompletion("getAurora", "(mapId)", "getAurora(${mapId})"),
    methodCompletion("hasAurora", "(mapId)", "hasAurora(${mapId})"),
    methodCompletion("updateAurora", "(mapId, updates)", "updateAurora(${mapId}, ${updates})"),
    methodCompletion("getPresets", "()", "getPresets()"),
  ],
  Embers: [
    methodCompletion("sequence", "()", "sequence()"),
    methodCompletion("castProjectile", "(effectId, casterId, targetIds, config)", "castProjectile(${effectId}, ${casterId}, ${targetIds}, ${config})"),
    methodCompletion("castAOE", "(effectId, tokenIds, config)", "castAOE(${effectId}, ${tokenIds}, ${config})"),
    methodCompletion("castCone", "(effectId, casterId, targetId, config)", "castCone(${effectId}, ${casterId}, ${targetId}, ${config})"),
    methodCompletion("sendInstructions", "(instructions, options)", "sendInstructions(${instructions}, ${options})"),
  ],
  Announcement: [
    methodCompletion("setAnnouncement", "(content, active)", "setAnnouncement(${content}, ${active})"),
    methodCompletion("getAnnouncement", "()", "getAnnouncement()"),
    methodCompletion("removeAnnouncementMetadata", "()", "removeAnnouncementMetadata()"),
    methodCompletion("updateAnnouncement", "(updates)", "updateAnnouncement(${updates})"),
    methodCompletion("toggleAnnouncement", "()", "toggleAnnouncement()"),
    methodCompletion("showAnnouncement", "()", "showAnnouncement()"),
    methodCompletion("hideAnnouncement", "()", "hideAnnouncement()"),
    methodCompletion("updateContent", "(content)", "updateContent(${content})"),
  ],
  Auras: [
    methodCompletion("hasAura", "(itemId)", "hasAura(${itemId})"),
    methodCompletion("getAuras", "(itemId)", "getAuras(${itemId})"),
    methodCompletion("addAura", "(itemId, config)", "addAura(${itemId}, ${config})"),
    methodCompletion("removeAura", "(itemId)", "removeAura(${itemId})"),
  ],
  Token: [
    methodCompletion("getSelected", "()", "getSelected()"),
    methodCompletion("getSelectedAll", "()", "getSelectedAll()"),
    methodCompletion("getPosition", "(tokenId)", "getPosition(${tokenId})"),
    methodCompletion("getSize", "(tokenId)", "getSize(${tokenId})"),
    methodCompletion("getClosest", "(tokenId, filter)", "getClosest(${tokenId}, ${filter})"),
    methodCompletion("create", "(params)", "create(${params})"),
    methodCompletion("createMany", "(tokensParams)", "createMany(${tokensParams})"),
    methodCompletion("setVisible", "(itemIds, visible)", "setVisible(${itemIds}, ${visible})"),
    methodCompletion("setLocked", "(itemIds, locked)", "setLocked(${itemIds}, ${locked})"),
    methodCompletion("setImage", "(itemIds, url, mime)", "setImage(${itemIds}, ${url}, ${mime})"),
    methodCompletion("setName", "(itemIds, name)", "setName(${itemIds}, ${name})"),
    methodCompletion("setLabel", "(itemIds, label)", "setLabel(${itemIds}, ${label})"),
    methodCompletion("setLayer", "(itemIds, layer)", "setLayer(${itemIds}, ${layer})"),
    methodCompletion("setPosition", "(itemIds, position, gridPosition)", "setPosition(${itemIds}, ${position}, ${gridPosition})"),
    methodCompletion("setScale", "(itemIds, scale)", "setScale(${itemIds}, ${scale})"),
    methodCompletion("setRotation", "(itemIds, rotation)", "setRotation(${itemIds}, ${rotation})"),
    methodCompletion("setMetadata", "(itemIds, metadata)", "setMetadata(${itemIds}, ${metadata})"),
  ],
  Scene: [
    methodCompletion("getMapIdFromToken", "(tokenId)", "getMapIdFromToken(${tokenId})"),
  ],
};

const SCRIPT_NAMESPACE_COMPLETIONS = Object.keys(SCRIPT_NAMESPACE_METHODS)
  .sort((left, right) => left.localeCompare(right))
  .map(label => ({
    label,
    type: "namespace",
    detail: "MacroHero API",
    info: "Type a dot to access available methods.",
  }));

let jsLintSourcePromise = null;

const COMPONENT_TYPE_MAP = {
  button: "Button",
  value: "Value",
  input: "Input",
  counter: "Counter",
  checkbox: "Checkbox",
  toggle: "Toggle",
  dropdown: "Dropdown",
  title: "Title",
  text: "TextBlock",
  divider: "Divider",
  row: "Row",
  stack: "Stack",
  matrix: "Matrix",
  matrixbutton: "MatrixButton",
};

const PUCK_TYPE_MAP = Object.fromEntries(
  Object.entries(COMPONENT_TYPE_MAP).map(([macroType, puckType]) => [
    puckType,
    macroType === "matrixbutton" ? "matrixButton" : macroType,
  ])
);

const COMPONENT_NAMES = Object.values(COMPONENT_TYPE_MAP);
const NON_MATRIX_BUTTON_COMPONENTS = COMPONENT_NAMES.filter(name => name !== "MatrixButton");

const MARKDOWN_FIELD = {
  type: "custom",
  render: props => <CodeField {...props} language="markdown" minRows={3} />,
};

const COLOR_FIELD = {
  type: "custom",
  render: props => <ColorField {...props} />,
};

const DEFAULT_PERMISSIONS = {
  drag: true,
  duplicate: true,
  delete: true,
  edit: true,
  insert: true,
  publish: false,
};

const EDITOR_VIEWPORT_HEIGHT = 2400;
const BUILDER_VIEWPORTS = [
  { width: "100%", height: EDITOR_VIEWPORT_HEIGHT, icon: "FullWidth", label: "Editor" },
];

const LAYOUT_CATEGORIES = {
  display: { title: "Display", components: ["Title", "TextBlock", "Value", "Divider"] },
  inputs: { title: "Inputs", components: ["Input", "Counter", "Checkbox", "Toggle", "Dropdown"] },
  actions: { title: "Actions", components: ["Button", "MatrixButton"] },
  layout: { title: "Layout", components: ["Row", "Stack", "Matrix"] },
};

const VARIABLE_CATEGORIES = {
  variables: { title: "Page Variables", components: ["PageStateVariable", "PageComputedVariable"] },
};

const EMPTY_COMPLETION_GROUPS = [];
const SIDEBAR_PLUGIN_PAGES = "macrohero-pages";
const SIDEBAR_PLUGIN_GLOBAL_CONFIG = "macrohero-global-config";
const SIDEBAR_PLUGIN_PAGE_CONFIG = "macrohero-page-config";

function createPuckConfig(variableGroups, builderMode) {
  const readableVariableField = createVariableField(variableGroups, "all");
  const stateVariableField = createVariableField(variableGroups, "state");
  const commandFields = createCommandFields(variableGroups);
  const updateField = createUpdateField(variableGroups);

  return {
    categories: builderMode === "variables" ? VARIABLE_CATEGORIES : LAYOUT_CATEGORIES,
    root: {
      fields: {
        pageLabel: { type: "text", label: "Page label" },
        pageId: { type: "text", label: "Page id" },
      },
      render: ({ children, pageLabel, pageId }) => (
        <PageRootPreview
          label={pageLabel}
          pageId={pageId}
        >
          {children}
        </PageRootPreview>
      ),
    },
    components: {
    PageStateVariable: {
      label: "State Variable",
      fields: {
        variableName: { type: "text", label: "Name" },
        defaultText: { type: "text", label: "Default value" },
        min: { type: "number", label: "Min" },
        max: { type: "number", label: "Max" },
      },
      defaultProps: { variableName: "newState", defaultText: "" },
      render: ({ variableName, defaultText, min, max }) => (
        <VariableObjectPreview
          kind="state"
          name={variableName || "newState"}
          primaryLabel="default"
          primaryValue={defaultText}
          min={min}
          max={max}
        />
      ),
    },
    PageComputedVariable: {
      label: "Computed Variable",
      fields: {
        variableName: { type: "text", label: "Name" },
        expression: createScriptCodeField(variableGroups, { label: "Expression", minRows: 3 }),
        min: { type: "number", label: "Min" },
        max: { type: "number", label: "Max" },
      },
      defaultProps: { variableName: "newComputed", expression: "" },
      render: ({ variableName, expression, min, max }) => (
        <VariableObjectPreview
          kind="computed"
          name={variableName || "newComputed"}
          primaryLabel="eval"
          primaryValue={expression}
          min={min}
          max={max}
        />
      ),
    },
    Row: {
      label: "Row",
      fields: {
        children: { type: "slot", allow: NON_MATRIX_BUTTON_COMPONENTS },
      },
      render: ({ children }) => <ContainerBlock type="row" label="Row" slot={children} />,
    },
    Stack: {
      label: "Stack",
      fields: {
        borderFlag: { type: "radio", label: "Border", options: BOOLEAN_OPTIONS },
        color: { ...COLOR_FIELD, label: "Color" },
        children: { type: "slot", allow: NON_MATRIX_BUTTON_COMPONENTS },
      },
      render: ({ children, borderFlag, color }) => (
        <ContainerBlock
          type="stack"
          label="Stack"
          slot={children}
          border={borderFlag === "yes"}
          color={color}
        />
      ),
    },
    Matrix: {
      label: "Matrix",
      fields: {
        columns: { type: "number", min: 1, max: 12 },
        buttonSize: { type: "text" },
        gap: { type: "text" },
        buttonShape: { type: "select", options: MATRIX_SHAPE_OPTIONS },
        borderFlag: { type: "radio", label: "Border", options: BOOLEAN_OPTIONS },
        color: { ...COLOR_FIELD, label: "Color" },
        children: { type: "slot", allow: ["MatrixButton"] },
      },
      render: ({ children, columns, borderFlag, color }) => (
        <ContainerBlock
          type="matrix"
          label={`Matrix - ${columns || 4} columns`}
          slot={children}
          border={borderFlag === "yes"}
          color={color}
        />
      ),
    },
    Button: {
      label: "Button",
      fields: {
        label: { type: "text" },
        tooltip: { ...MARKDOWN_FIELD, label: "Tooltip" },
        color: { ...COLOR_FIELD, label: "Color" },
        ...commandFields,
      },
      defaultProps: { label: "Button", onclickText: "" },
      render: ({ label, tooltip }) => (
        <ButtonPreview label={label || "Button"} tooltip={tooltip} />
      ),
    },
    MatrixButton: {
      label: "Matrix Button",
      fields: {
        label: { type: "text" },
        icon: { type: "text" },
        tooltip: { ...MARKDOWN_FIELD, label: "Tooltip" },
        color: { ...COLOR_FIELD, label: "Color" },
        borderColor: { ...COLOR_FIELD, label: "Border color" },
        ...commandFields,
      },
      defaultProps: { label: "", icon: "", onclickText: "" },
      render: ({ label, icon, tooltip }) => (
        <MatrixButtonPreview label={label} icon={icon} tooltip={tooltip} />
      ),
    },
    Value: {
      label: "Value",
      fields: {
        var: readableVariableField,
        label: { type: "text" },
      },
      render: ({ label, var: variable }) => (
        <ValuePreview label={label || "Value"} variable={variable} />
      ),
    },
    Input: {
      label: "Input",
      fields: {
        var: stateVariableField,
        label: { type: "text" },
        placeholder: { type: "text" },
        ...updateField,
      },
      render: ({ label, var: variable }) => (
        <ControlPreview type="input" label={label || "Input"} variable={variable} />
      ),
    },
    Counter: {
      label: "Counter",
      fields: {
        var: stateVariableField,
        label: { type: "text" },
        step: { type: "number" },
        color: { ...COLOR_FIELD, label: "Color" },
        ...updateField,
      },
      defaultProps: { step: 1 },
      render: ({ label, var: variable }) => (
        <ControlPreview type="counter" label={label || "Counter"} variable={variable} />
      ),
    },
    Checkbox: {
      label: "Checkbox",
      fields: {
        var: stateVariableField,
        label: { type: "text" },
        color: { ...COLOR_FIELD, label: "Color" },
        ...updateField,
      },
      render: ({ label, var: variable }) => (
        <ControlPreview type="checkbox" label={label || "Checkbox"} variable={variable} />
      ),
    },
    Toggle: {
      label: "Toggle",
      fields: {
        var: stateVariableField,
        label: { type: "text" },
        color: { ...COLOR_FIELD, label: "Color" },
        ...updateField,
      },
      render: ({ label, var: variable }) => (
        <TogglePreview label={label || "Toggle"} variable={variable} />
      ),
    },
    Dropdown: {
      label: "Dropdown",
      fields: {
        var: stateVariableField,
        label: { type: "text" },
        optionsText: { type: "textarea", label: "Options" },
        ...updateField,
      },
      render: ({ label, var: variable }) => (
        <ControlPreview type="dropdown" label={label || "Dropdown"} variable={variable} />
      ),
    },
    Title: {
      label: "Title",
      fields: {
        text: { type: "text" },
        color: { ...COLOR_FIELD, label: "Color" },
      },
      defaultProps: { text: "Title" },
      render: ({ text, color }) => <TitlePreview text={text || "Title"} color={color} />,
    },
    TextBlock: {
      label: "Text",
      fields: {
        text: { ...MARKDOWN_FIELD, label: "Text" },
      },
      defaultProps: { text: "" },
      render: ({ text }) => (
        <TextPreview text={text || "Markdown text"} />
      ),
    },
    Divider: {
      label: "Divider",
      fields: {
        height: { type: "text" },
        margin: { type: "text" },
        style: { type: "select", options: DIVIDER_STYLE_OPTIONS },
        color: { ...COLOR_FIELD, label: "Color" },
      },
      render: ({ color }) => <DividerPreview color={color} />,
    },
    },
  };
}

function createVariableField(variableGroups, mode) {
  return {
    type: "custom",
    label: mode === "state" ? "Bind to State" : "Read variable",
    render: props => <VariableSelectField {...props} groups={variableGroups} mode={mode} />,
  };
}

function createScriptCodeField(variableGroups, { label, minRows = 4 } = {}) {
  return {
    type: "custom",
    ...(label ? { label } : {}),
    render: props => (
      <CodeField
        {...props}
        language="javascript"
        minRows={minRows}
        completionGroups={variableGroups}
      />
    ),
  };
}

function createCommandFields(variableGroups) {
  return {
    onclickText: createScriptCodeField(variableGroups, { label: "onclick", minRows: 5 }),
    onrightclickText: createScriptCodeField(variableGroups, { label: "onrightclick", minRows: 4 }),
  };
}

function createUpdateField(variableGroups) {
  return {
    onupdateText: createScriptCodeField(variableGroups, { label: "onupdate", minRows: 4 }),
  };
}

export function mountPuckBuilder({ target, getConfig, setConfig }) {
  if (!target) {
    console.error("[MacroHero Builder] Missing Puck host element");
    return;
  }

  console.info("[MacroHero Builder] Mounting Puck builder", getConfigSummary(getConfig));

  if (!root) root = createRoot(target);
  root.render(
    <BuilderErrorBoundary>
      <MacroHeroPuckBuilder getConfig={getConfig} setConfig={setConfig} />
    </BuilderErrorBoundary>
  );
}

export function refreshPuckBuilder({ getConfig, setConfig }) {
  const target = document.getElementById("puckBuilderHost");
  if (!target) {
    console.error("[MacroHero Builder] Cannot refresh: host element is missing");
    return;
  }
  if (!root) {
    mountPuckBuilder({ target, getConfig, setConfig });
    return;
  }

  console.info("[MacroHero Builder] Refreshing Puck builder", getConfigSummary(getConfig));

  root.render(
    <BuilderErrorBoundary>
      <MacroHeroPuckBuilder getConfig={getConfig} setConfig={setConfig} />
    </BuilderErrorBoundary>
  );
}

class BuilderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[MacroHero Builder] React render failed", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="puck-empty-state error">
          <strong>Puck builder failed to render.</strong>
          <small>{this.state.error.message}</small>
        </div>
      );
    }

    return this.props.children;
  }
}

function MacroHeroPuckBuilder({ getConfig, setConfig }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [builderMode, setBuilderMode] = useState("layout");
  const [version, setVersion] = useState(0);
  const [activeSidebarPlugin, setActiveSidebarPlugin] = useState(null);
  const config = getConfig() || {};
  const pages = Array.isArray(config.pages) ? config.pages : [];
  const activePage = pages[pageIndex] || pages[0] || null;
  const safePageIndex = activePage ? Math.max(0, pages.indexOf(activePage)) : 0;
  const variableGroups = useMemo(
    () => getVariableGroups(config, activePage),
    [config, activePage]
  );
  const puckConfig = useMemo(
    () => createPuckConfig(variableGroups, builderMode),
    [builderMode, variableGroups]
  );

  useEffect(() => {
    if (pageIndex >= pages.length) setPageIndex(Math.max(0, pages.length - 1));
  }, [pageIndex, pages.length]);

  useEffect(() => {
    console.info("[MacroHero Builder] Active page", {
      index: safePageIndex,
      id: activePage?.id || null,
      label: activePage?.label || null,
      layoutItems: activePage?.layout?.length || 0,
    });
  }, [activePage, safePageIndex]);

  const puckData = useMemo(
    () => pageToPuckData(activePage, builderMode),
    [activePage, builderMode, version]
  );

  const updateConfig = useCallback(recipe => {
    const nextConfig = structuredCloneSafe(getConfig() || {});
    recipe(nextConfig);
    setConfig(nextConfig);
    setVersion(value => value + 1);
  }, [getConfig, setConfig]);
  const rememberSidebarPlugin = useCallback(pluginName => {
    setActiveSidebarPlugin(pluginName);
  }, []);
  const builderPlugins = useMemo(
    () => [
      {
        name: SIDEBAR_PLUGIN_PAGES,
        label: "Pages",
        render: () => (
          <PagesPlugin
            pages={pages}
            safePageIndex={safePageIndex}
            setPageIndex={setPageIndex}
            updateConfig={updateConfig}
            reload={() => setVersion(value => value + 1)}
            rememberSidebarPlugin={rememberSidebarPlugin}
          />
        ),
        mobilePanelHeight: "min-content",
      },
      {
        name: SIDEBAR_PLUGIN_GLOBAL_CONFIG,
        label: "Global Config",
        render: () => (
          <GlobalConfigPlugin
            config={config}
            updateConfig={updateConfig}
            variableGroups={variableGroups.filter(group => group.scope === "global")}
            safePageIndex={safePageIndex}
            rememberSidebarPlugin={rememberSidebarPlugin}
          />
        ),
        mobilePanelHeight: "min-content",
      },
      {
        name: SIDEBAR_PLUGIN_PAGE_CONFIG,
        label: "Page Config",
        render: () => (
          <PageConfigPlugin
            activePage={activePage}
            safePageIndex={safePageIndex}
            updateConfig={updateConfig}
            rememberSidebarPlugin={rememberSidebarPlugin}
          />
        ),
        mobilePanelHeight: "min-content",
      },
    ],
    [activePage, config, pages, rememberSidebarPlugin, safePageIndex, updateConfig, variableGroups]
  );

  if (!activePage) {
    return (
      <div className="puck-empty-state">
        <button type="button" onClick={() => updateConfig(next => {
          if (!Array.isArray(next.pages)) next.pages = [];
          next.pages.push(defaultPage(next.pages.length));
          setPageIndex(0);
        })}>Create first page</button>
      </div>
    );
  }

  return (
    <div className="puck-builder-shell">
      <Puck
        key={`${safePageIndex}:${builderMode}:${version}`}
        config={puckConfig}
        data={puckData}
        onChange={data => {
          const nextConfig = structuredCloneSafe(getConfig() || {});
          if (!nextConfig.pages?.[safePageIndex]) return;
          applyRootPropsToPage(nextConfig.pages[safePageIndex], data?.root, safePageIndex);
          if (builderMode === "variables") {
            applyPuckVariablesToPage(nextConfig.pages[safePageIndex], data);
          } else {
            nextConfig.pages[safePageIndex].layout = puckDataToLayout(data);
          }
          setConfig(nextConfig);
        }}
        permissions={DEFAULT_PERMISSIONS}
        plugins={builderPlugins}
        iframe={{ enabled: false }}
        viewports={BUILDER_VIEWPORTS}
        ui={{
          viewports: {
            current: BUILDER_VIEWPORTS[0],
            controlsVisible: false,
            options: BUILDER_VIEWPORTS,
          },
          ...(activeSidebarPlugin ? {
            plugin: { current: activeSidebarPlugin },
            leftSideBarVisible: true,
          } : {}),
        }}
        onAction={(action, nextState) => {
          const currentPlugin = nextState?.ui?.plugin?.current || nextState?.state?.ui?.plugin?.current;
          if (currentPlugin) setActiveSidebarPlugin(currentPlugin);
        }}
        height="100%"
        headerTitle={`MacroHero - ${activePage.label || activePage.id || "Page"} - ${builderMode === "variables" ? "Variables" : "Layout"}`}
        renderHeaderActions={() => (
          <BuilderHeaderControls
            pages={pages}
            safePageIndex={safePageIndex}
            setPageIndex={setPageIndex}
            builderMode={builderMode}
            setBuilderMode={setBuilderMode}
          />
        )}
      />
    </div>
  );
}

function BuilderHeaderControls({ pages, safePageIndex, setPageIndex, builderMode, setBuilderMode }) {
  return (
    <div className="puck-header-controls">
      <select
        aria-label="Current page"
        value={safePageIndex}
        onChange={event => setPageIndex(Number(event.target.value))}
      >
        {pages.map((page, index) => (
          <option key={page.id || index} value={index}>
            {page.label || page.id || `Page ${index + 1}`}
          </option>
        ))}
      </select>
      <div className="puck-header-mode-switch" role="group" aria-label="Builder mode">
        <button type="button" className={builderMode === "layout" ? "active" : ""} onClick={() => setBuilderMode("layout")}>Layout</button>
        <button type="button" className={builderMode === "variables" ? "active" : ""} onClick={() => setBuilderMode("variables")}>Variables</button>
      </div>
    </div>
  );
}

function PagesPlugin({ pages, safePageIndex, setPageIndex, updateConfig, reload, rememberSidebarPlugin }) {
  const rememberPages = () => rememberSidebarPlugin(SIDEBAR_PLUGIN_PAGES);

  return (
    <div className="puck-config-plugin" onPointerDownCapture={rememberPages} onFocusCapture={rememberPages}>
      <section className="puck-config-section">
        <h3>Pages <span>{pages.length}</span></h3>
        <div className="puck-page-switcher">
          {pages.map((page, index) => (
            <button
              key={page.id || index}
              type="button"
              className={`puck-page-switcher-item${index === safePageIndex ? " active" : ""}`}
              onClick={() => {
                rememberPages();
                setPageIndex(index);
              }}
            >
              <strong>{page.label || page.id || `Page ${index + 1}`}</strong>
              <small>{page.id || `page-${index + 1}`}</small>
            </button>
          ))}
        </div>
        <div className="puck-config-actions">
          <button type="button" onClick={() => {
            rememberPages();
            updateConfig(next => {
              if (!Array.isArray(next.pages)) next.pages = [];
              next.pages.push(defaultPage(next.pages.length));
              setPageIndex(next.pages.length - 1);
            });
          }}>Add page</button>
          <button type="button" disabled={pages.length <= 1} onClick={() => {
            rememberPages();
            updateConfig(next => {
              next.pages.splice(safePageIndex, 1);
              setPageIndex(Math.max(0, safePageIndex - 1));
            });
          }}>Delete</button>
          <button type="button" onClick={() => {
            rememberPages();
            reload();
          }}>Reload</button>
        </div>
      </section>
    </div>
  );
}

function GlobalConfigPlugin({ config, updateConfig, variableGroups, safePageIndex, rememberSidebarPlugin }) {
  const rememberGlobalConfig = () => rememberSidebarPlugin(SIDEBAR_PLUGIN_GLOBAL_CONFIG);

  return (
    <div className="puck-config-plugin" onPointerDownCapture={rememberGlobalConfig} onFocusCapture={rememberGlobalConfig}>
      <section className="puck-config-section">
        <h3>Global Settings</h3>
        <label>
          Title
          <input type="text" value={config.global?.title || ""} onChange={event => updateConfig(next => {
            if (!next.global) next.global = {};
            next.global.title = event.target.value;
          })} />
        </label>
        <div className="puck-config-row">
          <label>
            Width
            <input type="number" value={config.global?.width || 600} onChange={event => updateConfig(next => {
              if (!next.global) next.global = {};
              next.global.width = Number(event.target.value) || 600;
            })} />
          </label>
          <label>
            Height
            <input type="number" value={config.global?.height || 600} onChange={event => updateConfig(next => {
              if (!next.global) next.global = {};
              next.global.height = Number(event.target.value) || 600;
            })} />
          </label>
        </div>
      </section>

      <VariableEditorPlugin
        groups={variableGroups}
        safePageIndex={safePageIndex}
        updateConfig={updateConfig}
      />
    </div>
  );
}

function PageConfigPlugin({
  activePage,
  safePageIndex,
  updateConfig,
  rememberSidebarPlugin,
}) {
  const rememberPageConfig = () => rememberSidebarPlugin(SIDEBAR_PLUGIN_PAGE_CONFIG);

  return (
    <div className="puck-config-plugin" onPointerDownCapture={rememberPageConfig} onFocusCapture={rememberPageConfig}>
      <section className="puck-config-section">
        <h3>Page Settings</h3>
        <label>
          Label
          <input type="text" value={activePage.label || ""} onChange={event => updateConfig(next => {
            next.pages[safePageIndex].label = event.target.value;
          })} />
        </label>
        <label>
          ID
          <input type="text" value={activePage.id || ""} onChange={event => updateConfig(next => {
            next.pages[safePageIndex].id = slugify(event.target.value, `page-${safePageIndex + 1}`);
          })} />
        </label>
      </section>
    </div>
  );
}

function VariableEditorPlugin({ groups, safePageIndex, updateConfig }) {
  const [selection, setSelection] = useState(null);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section className="puck-config-section">
      <h3>Variables <span>{total}</span></h3>
      <div className="puck-variable-stack">
        {groups.map(group => (
          <VariableBucket
            key={group.id}
            group={group}
            onAdd={() => setSelection({ scope: group.scope, kind: group.kind, name: "" })}
            onEdit={name => setSelection({ scope: group.scope, kind: group.kind, name })}
          />
        ))}
      </div>

      {selection ? (
        <VariableEditor
          key={`${selection.scope}:${selection.kind}:${selection.name || "new"}`}
          selection={selection}
          groups={groups}
          safePageIndex={safePageIndex}
          onCancel={() => setSelection(null)}
          onSave={(nextName, entry) => {
            updateConfig(next => {
              const scope = getConfigScope(next, selection.scope, safePageIndex);
              if (!scope.state) scope.state = {};
              if (!scope.computed) scope.computed = {};
              if (selection.name && selection.name !== nextName) {
                delete scope[selection.kind][selection.name];
              }
              scope[selection.kind][nextName] = entry;
            });
            setSelection({ ...selection, name: nextName });
          }}
          onDelete={() => {
            if (!selection.name) {
              setSelection(null);
              return;
            }
            updateConfig(next => {
              const scope = getConfigScope(next, selection.scope, safePageIndex);
              if (scope?.[selection.kind]) delete scope[selection.kind][selection.name];
            });
            setSelection(null);
          }}
        />
      ) : null}
    </section>
  );
}

function VariableBucket({ group, onAdd, onEdit }) {
  return (
    <div className={`puck-variable-bucket puck-variable-${group.kind}`}>
      <div className="puck-variable-bucket-head">
        <span>{group.label}</span>
        <button type="button" onClick={onAdd}>Add</button>
      </div>
      {group.items.length ? (
        <div className="puck-variable-list">
          {group.items.map(item => (
            <button key={item.name} type="button" className="puck-variable-item" title={item.description} onClick={() => onEdit(item.name)}>
              <code>{item.name}</code>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="puck-variable-empty">None</div>
      )}
    </div>
  );
}

function VariableEditor({ selection, groups, safePageIndex, onCancel, onSave, onDelete }) {
  const group = groups.find(item => item.scope === selection.scope && item.kind === selection.kind);
  const existing = group?.items.find(item => item.name === selection.name);
  const [name, setName] = useState(selection.name || "");
  const [primary, setPrimary] = useState(existing?.rawPrimary || "");
  const [min, setMin] = useState(existing?.rawMin ?? "");
  const [max, setMax] = useState(existing?.rawMax ?? "");
  const existingNames = new Set((group?.items || []).map(item => item.name).filter(itemName => itemName !== selection.name));
  const isComputed = selection.kind === "computed";

  const save = () => {
    const nextName = name.trim();
    if (!nextName) {
      alert("Variable name is required.");
      return;
    }
    if (existingNames.has(nextName)) {
      alert(`Variable "${nextName}" already exists.`);
      return;
    }
    if (isComputed && !primary.trim()) {
      alert("Expression is required.");
      return;
    }

    const entry = isComputed
      ? buildComputedEntry(primary, min, max)
      : buildStateEntry(primary, min, max);
    onSave(nextName, entry);
  };

  return (
    <div className="puck-variable-editor">
      <h4>{selection.name ? `Edit ${selection.name}` : `Add ${selection.kind}`}</h4>
      <label>
        Name
        <input type="text" value={name} disabled={Boolean(selection.name)} onChange={event => setName(event.target.value)} />
      </label>
      <label>
        {isComputed ? "Expression" : "Default value"}
        {isComputed ? (
          <textarea value={primary} rows={4} onChange={event => setPrimary(event.target.value)} />
        ) : (
          <input type="text" value={primary} onChange={event => setPrimary(event.target.value)} />
        )}
      </label>
      <div className="puck-config-row">
        <label>
          Min
          <input type="number" value={min} onChange={event => setMin(event.target.value)} />
        </label>
        <label>
          Max
          <input type="number" value={max} onChange={event => setMax(event.target.value)} />
        </label>
      </div>
      <div className="puck-config-actions">
        <button type="button" onClick={save}>Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
        {selection.name ? <button type="button" onClick={onDelete}>Delete</button> : null}
      </div>
    </div>
  );
}

function VariableSelectField({ id, value, onChange, readOnly, field, name, groups, mode }) {
  const visibleGroups = groups
    .filter(group => mode !== "state" || group.kind === "state")
    .filter(group => group.items.length > 0);
  const options = visibleGroups.flatMap(group => group.items.map(item => item.name));
  const hasUnknownValue = value && !options.includes(value);
  const label = field?.label || formatFieldLabel(name || id);

  return (
    <div className="puck-variable-field">
      <CustomFieldLabel htmlFor={id} kind="variable">{label}</CustomFieldLabel>
      <select
        id={id}
        value={value || ""}
        disabled={readOnly}
        onChange={event => onChange(event.target.value)}
      >
        <option value="">{mode === "state" ? "Select state..." : "Select variable..."}</option>
        {visibleGroups.map(group => (
          <optgroup key={group.id} label={group.label}>
            {group.items.map(item => (
              <option key={`${group.id}:${item.name}`} value={item.name}>
                {item.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {hasUnknownValue ? (
        <small className="puck-variable-warning">
          "{value}" is not in {mode === "state" ? "available State variables" : "available variables"}.
        </small>
      ) : null}
      {mode === "state" ? (
        <small className="puck-variable-help">Inputs, counters, toggles, checkboxes and dropdowns can only write to State.</small>
      ) : null}
    </div>
  );
}

function ContainerBlock({ type, label, slot, border, color }) {
  return (
    <section
      className={`mh-preview-container mh-preview-${type}`}
      style={{ borderColor: color || undefined }}
      aria-label={label}
      data-bordered={border ? "true" : undefined}
    >
      <div className="mh-preview-container-head">
        <strong>{label}</strong>
      </div>
      <div className="mh-preview-slot">
        {typeof slot === "function" ? slot({ className: "mh-preview-dropzone", minEmptyHeight: 44 }) : null}
      </div>
    </section>
  );
}

function PageRootPreview({ label, pageId, children }) {
  return (
    <main className="mh-preview-page-root">
      <header className="mh-preview-page-head">
        <div>
          <strong>{label || "Untitled page"}</strong>
          <span>{pageId || "page-id"}</span>
        </div>
        <div className="mh-preview-page-vars">
          <span>Page variables</span>
        </div>
      </header>
      <div className="mh-preview-page-content">
        {children}
      </div>
    </main>
  );
}

function VariableObjectPreview({ kind, name, primaryLabel, primaryValue, min, max }) {
  const hasMin = min !== "" && min !== null && min !== undefined;
  const hasMax = max !== "" && max !== null && max !== undefined;

  return (
    <div className={`mh-preview-widget mh-preview-variable mh-preview-variable-${kind}`}>
      <div className="mh-preview-variable-head">
        <strong>{name}</strong>
        <span>{kind}</span>
      </div>
      <div className="mh-preview-variable-body">
        <code>{primaryLabel}: {String(primaryValue ?? "").trim() || "(empty)"}</code>
        {(hasMin || hasMax) ? (
          <small>
            {hasMin ? `min ${min}` : ""}
            {hasMin && hasMax ? " | " : ""}
            {hasMax ? `max ${max}` : ""}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function LeafBlock({ type, title, detail }) {
  const htmlDetail = renderMarkdownInline(detail);

  return (
    <div className={`mh-preview-card mh-preview-${type}`}>
      <span className="mh-preview-kind">{type}</span>
      <div className="mh-preview-card-body">
        <strong>{title}</strong>
        {htmlDetail ? <small className="mh-preview-markdown" dangerouslySetInnerHTML={{ __html: htmlDetail }} /> : null}
      </div>
    </div>
  );
}

function PreviewBlock({ type, label, title, children }) {
  return (
    <div className={`mh-preview-widget mh-preview-block mh-preview-${type}`} aria-label={label} title={title || undefined}>
      <div className="mh-preview-block-head">
        <strong>{label}</strong>
      </div>
      <div className="mh-preview-block-content">
        {children}
      </div>
    </div>
  );
}

function ButtonPreview({ label, tooltip }) {
  const tooltipText = getTooltipTitle(tooltip);

  return (
    <PreviewBlock type="button" label="Button" title={tooltipText}>
      <div className="mh-preview-button-face">
        <button type="button">{label}</button>
      </div>
    </PreviewBlock>
  );
}

function MatrixButtonPreview({ label, icon, tooltip }) {
  const tooltipText = getTooltipTitle(tooltip);

  return (
    <PreviewBlock type="matrix-button" label="Matrix button" title={tooltipText}>
      <div className="mh-preview-matrix-face">
        {icon ? <span className="mh-preview-matrix-icon">{icon}</span> : null}
        {label ? <span className="mh-preview-matrix-label">{label}</span> : null}
        {!icon && !label ? <span className="mh-preview-matrix-label muted">Matrix button</span> : null}
      </div>
    </PreviewBlock>
  );
}

function ValuePreview({ label, variable }) {
  return (
    <PreviewBlock type="value" label="Value">
      <div className="mh-preview-value">
        <span>{label}</span>
        <strong>{variable ? `{${variable}}` : "0"}</strong>
      </div>
    </PreviewBlock>
  );
}

function ControlPreview({ type, label, variable }) {
  return (
    <PreviewBlock type={type} label={controlTypeLabel(type)}>
      <div className={`mh-preview-control mh-preview-control-${type}`}>
        <span className="mh-preview-control-label">{label}</span>
        <span className="mh-preview-control-surface">
          {type === "counter" ? <><button type="button">-</button><strong>0</strong><button type="button">+</button></> : null}
          {type === "checkbox" ? <span className="mh-preview-check" /> : null}
          {type === "dropdown" ? <span className="mh-preview-select">Select</span> : null}
          {type === "input" ? <span className="mh-preview-input">Text</span> : null}
        </span>
        <small>{variable ? `{${variable}}` : "No state binding"}</small>
      </div>
    </PreviewBlock>
  );
}

function TogglePreview({ label, variable }) {
  return (
    <PreviewBlock type="toggle" label="Toggle">
      <div className="mh-preview-toggle-card">
        <div className="mh-preview-toggle-main">
          <span className="mh-preview-toggle-label">{label}</span>
          <code className={variable ? "" : "muted"}>
            {variable ? `{${variable}}` : "No binding"}
          </code>
          <span className="mh-preview-toggle-switch" aria-hidden="true">
            <span className="mh-preview-toggle-thumb" />
          </span>
        </div>
      </div>
    </PreviewBlock>
  );
}

function controlTypeLabel(type) {
  return {
    input: "Input",
    counter: "Counter",
    checkbox: "Checkbox",
    toggle: "Toggle",
    dropdown: "Dropdown",
  }[type] || "Control";
}

function TitlePreview({ text, color }) {
  return (
    <PreviewBlock type="title" label="Title">
      <div className="mh-preview-title-content" style={{ color: color || undefined }}>
        {text}
      </div>
    </PreviewBlock>
  );
}

function TextPreview({ text }) {
  return (
    <PreviewBlock type="text" label="Text">
      <div
        className="mh-preview-text-content"
        dangerouslySetInnerHTML={{ __html: renderMarkdownBlock(text) }}
      />
    </PreviewBlock>
  );
}

function DividerPreview({ color }) {
  return (
    <PreviewBlock type="divider" label="Divider">
      <div className="mh-preview-divider-content">
        <span style={{ borderTopColor: color || undefined }} />
      </div>
    </PreviewBlock>
  );
}

function ColorField({ id, value, onChange, readOnly, field, name }) {
  const label = field?.label || formatFieldLabel(name || id);
  const textId = `${id || name || "color"}-text`;
  const pickerId = `${id || name || "color"}-picker`;
  const normalized = normalizeColorForPicker(value);

  return (
    <div className="puck-color-field">
      <CustomFieldLabel htmlFor={textId} kind="color">{label}</CustomFieldLabel>
      <div className="puck-color-field-row">
        <input
          id={textId}
          type="text"
          value={value || ""}
          disabled={readOnly}
          placeholder="#4f46e5, red, var(--accent)"
          onChange={event => onChange(event.target.value)}
        />
        <input
          id={pickerId}
          type="color"
          value={normalized}
          disabled={readOnly}
          title={`Pick ${label}`}
          onChange={event => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

function CodeField({ id, value, onChange, readOnly, field, name, language = "javascript", minRows = 4, completionGroups = EMPTY_COMPLETION_GROUPS }) {
  const hostRef = React.useRef(null);
  const viewRef = React.useRef(null);
  const valueRef = React.useRef(value || "");
  const onChangeRef = React.useRef(onChange);
  const label = field?.label || formatFieldLabel(name || id);
  const editorId = `${id || name || "code"}-editor`;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const view = new EditorView({
      doc: valueRef.current,
      parent: hostRef.current,
      extensions: [
        minimalSetup,
        oneDark,
        codeFieldTheme,
        EditorView.lineWrapping,
        lintGutter(),
        ...codeLanguageExtensions(language, completionGroups),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return;
          const nextValue = update.state.doc.toString();
          valueRef.current = nextValue;
          onChangeRef.current(nextValue);
        }),
      ],
    });

    view.dom.classList.add("puck-code-editor", `puck-code-editor-${language}`);
    view.dom.style.setProperty("--puck-code-min-height", `${Math.max(72, minRows * 19 + 18)}px`);
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [language, minRows, readOnly]);

  useEffect(() => {
    const nextValue = value || "";
    const view = viewRef.current;
    valueRef.current = nextValue;
    if (!view || view.state.doc.toString() === nextValue) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: nextValue } });
  }, [value]);

  return (
    <div className="puck-code-field">
      <CustomFieldLabel htmlFor={editorId} kind={language === "markdown" ? "markdown" : "code"}>
        {label}
      </CustomFieldLabel>
      <div id={editorId} ref={hostRef} />
    </div>
  );
}

function CustomFieldLabel({ htmlFor, kind = "field", children }) {
  return (
    <label className={`puck-custom-field-label puck-custom-field-label-${kind}`} htmlFor={htmlFor}>
      <span className="puck-custom-field-label-icon" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

function formatFieldLabel(value) {
  return String(value || "Field")
    .replace(/Text$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

function normalizeColorForPicker(value) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.slice(1).split("").map(char => char + char).join("")}`;
  }
  return "#4f46e5";
}

function getTooltipTitle(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_#[\]()!>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

const codeFieldTheme = EditorView.theme({
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
    minHeight: "var(--puck-code-min-height, 96px)",
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
}, { dark: true });

function codeLanguageExtensions(language, completionGroups = []) {
  if (language === "markdown") return [markdown(), linter(markdownFenceLinter)];
  const javascriptSupport = javascript();
  return [
    javascriptSupport,
    javascriptSupport.language.data.of({
      autocomplete: createScriptCompletionSource(completionGroups),
    }),
    autocompletion(),
    linter(safeJsLintSource),
  ];
}

function createScriptCompletionSource(variableGroups = []) {
  const rootOptions = [
    ...SCRIPT_HELPER_COMPLETIONS,
    ...SCRIPT_NAMESPACE_COMPLETIONS,
    ...createVariableCompletions(variableGroups),
  ];

  return context => {
    const property = context.matchBefore(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/);
    if (property) {
      const [namespace] = property.text.split(".");
      const methods = SCRIPT_NAMESPACE_METHODS[namespace];
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

function createVariableCompletions(variableGroups = []) {
  const seen = new Set();
  const completions = [];

  for (const group of variableGroups) {
    for (const item of group.items || []) {
      if (!isJsIdentifier(item.name) || seen.has(item.name)) continue;
      seen.add(item.name);
      completions.push({
        label: item.name,
        type: "variable",
        detail: `${group.label} variable`,
        info: item.description || "Resolved variable available in this script.",
      });
    }
  }

  return completions;
}

function isJsIdentifier(value) {
  return /^[A-Za-z_$][\w$]*$/.test(String(value || ""));
}

function methodCompletion(label, detail, template, info = "MacroHero script helper.") {
  return snippetCompletion(template, {
    label,
    type: "function",
    detail,
    info,
  });
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

function pageToPuckData(page, builderMode) {
  return {
    root: { props: pageToRootProps(page) },
    content: builderMode === "variables"
      ? pageVariablesToPuckContent(page)
      : (page?.layout || []).map((item, index) => layoutItemToPuck(item, [index])).filter(Boolean),
  };
}

function pageToRootProps(page) {
  return {
    title: page?.label || "MacroHero page layout",
    pageLabel: page?.label || "",
    pageId: page?.id || "",
  };
}

function applyRootPropsToPage(page, root, pageIndex) {
  const props = root?.props || root || {};
  if (!page || !props) return;

  if ("pageLabel" in props) page.label = String(props.pageLabel || "");
  if ("pageId" in props) page.id = slugify(props.pageId, `page-${pageIndex + 1}`);
}

function pageVariablesToPuckContent(page = {}) {
  return [
    ...variableEntries(page.state, "state").map((item, index) => ({
      type: "PageStateVariable",
      props: {
        id: `mh-page-state-${index}-${slugify(item.name, "state")}`,
        variableName: item.name,
        defaultText: item.rawPrimary,
        min: item.rawMin,
        max: item.rawMax,
      },
    })),
    ...variableEntries(page.computed, "computed").map((item, index) => ({
      type: "PageComputedVariable",
      props: {
        id: `mh-page-computed-${index}-${slugify(item.name, "computed")}`,
        variableName: item.name,
        expression: item.rawPrimary,
        min: item.rawMin,
        max: item.rawMax,
      },
    })),
  ];
}

function applyPuckVariablesToPage(page, data) {
  const state = {};
  const computed = {};

  for (const item of data?.content || []) {
    const props = item?.props || {};
    const name = String(props.variableName || "").trim();
    if (!name) continue;

    if (item.type === "PageStateVariable") {
      state[name] = buildStateEntry(props.defaultText, props.min, props.max);
    } else if (item.type === "PageComputedVariable") {
      const expression = String(props.expression || "").trim();
      computed[name] = buildComputedEntry(expression, props.min, props.max);
    }
  }

  page.state = state;
  page.computed = computed;
}

function layoutItemToPuck(item, path) {
  const macroType = (item?.type || "button").toLowerCase();
  const puckType = COMPONENT_TYPE_MAP[macroType] || "Button";
  const props = macroElementToPuckProps(item || {}, path);
  return { type: puckType, props };
}

function macroElementToPuckProps(item, path) {
  const props = {
    ...item,
    id: item.id || `mh-${(item.type || "element").toLowerCase()}-${path.join("-")}`,
  };

  props.borderFlag = item.border ? "yes" : "no";
  props.onclickText = commandsToText(item.onclick);
  props.onrightclickText = commandsToText(item.onrightclick);
  props.onupdateText = commandsToText(item.onupdate);
  props.optionsText = optionsToText(item.options);

  delete props.type;
  delete props.onclick;
  delete props.onrightclick;
  delete props.onupdate;
  delete props.options;
  delete props.border;

  if (Array.isArray(item.children)) {
    props.children = item.children
      .map((child, index) => layoutItemToPuck(child, [...path, index]))
      .filter(Boolean);
  }

  return props;
}

function puckDataToLayout(data) {
  return (data?.content || [])
    .map(puckItemToLayout)
    .filter(Boolean);
}

function puckItemToLayout(item) {
  const type = PUCK_TYPE_MAP[item?.type] || "button";
  const props = { ...(item?.props || {}) };
  const children = Array.isArray(props.children) ? props.children.map(puckItemToLayout).filter(Boolean) : undefined;
  const element = { type };

  for (const [key, value] of Object.entries(props)) {
    if (key === "id" || key === "children" || key === "borderFlag") continue;
    if (key.endsWith("Text")) continue;
    if (value === "" || value === undefined || value === false) continue;
    element[key] = value;
  }

  const onclick = textToCommands(props.onclickText);
  const onrightclick = textToCommands(props.onrightclickText);
  const onupdate = textToCommands(props.onupdateText);
  if (onclick.length) element.onclick = onclick;
  if (onrightclick.length) element.onrightclick = onrightclick;
  if (onupdate.length) element.onupdate = onupdate;

  if (type === "dropdown") {
    element.options = textToOptions(props.optionsText);
  }

  if (props.borderFlag === "yes") {
    element.border = true;
  }

  if (children && ["row", "stack", "matrix"].includes(type)) {
    element.children = children;
  }

  return element;
}

function commandsToText(commands) {
  return Array.isArray(commands) ? commands.join("\n") : "";
}

function textToCommands(text) {
  return String(text || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

function optionsToText(options = []) {
  return (options || [])
    .map(option => typeof option === "string" ? option : `${option.label || ""} | ${option.value || ""}`)
    .join("\n");
}

function textToOptions(text) {
  return String(text || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      if (!line.includes(" | ")) return line;
      const [label, value] = line.split(" | ");
      return { label: label.trim(), value: value.trim() };
    });
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function defaultPage(index) {
  const pageNumber = index + 1;
  return {
    label: `Page ${pageNumber}`,
    id: `page-${pageNumber}`,
    state: {},
    computed: {},
    layout: [],
  };
}

function slugify(value, fallback) {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function renderMarkdownInline(value) {
  if (!value) return "";
  const text = String(value);
  if (MD_PATTERN.test(text)) return parseMd(text);
  if (text.includes("<")) return sanitizeHtml(text);
  return escapeHtml(text);
}

function renderMarkdownBlock(value) {
  if (!value) return "";
  const text = String(value);
  if (MD_PATTERN.test(text) || text.includes("\n")) return parseMd(text);
  if (text.includes("<")) return sanitizeHtml(text);
  return escapeHtml(text);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getVariableGroups(config = {}, page = {}) {
  return [
    {
      id: "global-state",
      label: "Global State",
      scope: "global",
      kind: "state",
      items: variableEntries(config.global?.state, "state"),
    },
    {
      id: "page-state",
      label: "Page State",
      scope: "page",
      kind: "state",
      items: variableEntries(page?.state, "state"),
    },
    {
      id: "global-computed",
      label: "Global Computed",
      scope: "global",
      kind: "computed",
      items: variableEntries(config.global?.computed, "computed"),
    },
    {
      id: "page-computed",
      label: "Page Computed",
      scope: "page",
      kind: "computed",
      items: variableEntries(page?.computed, "computed"),
    },
  ];
}

function variableEntries(entries = {}, kind) {
  return Object.entries(entries || {})
    .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
    .map(([name, entry]) => ({
      name,
      rawPrimary: kind === "state" ? statePrimaryValue(entry) : computedPrimaryValue(entry),
      rawMin: entry && typeof entry === "object" && !Array.isArray(entry) ? entry.min ?? "" : "",
      rawMax: entry && typeof entry === "object" && !Array.isArray(entry) ? entry.max ?? "" : "",
      description: kind === "state" ? stateDescription(entry) : computedDescription(entry),
    }));
}

function statePrimaryValue(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    return "default" in entry ? formatValueForInput(entry.default) : "";
  }
  return formatValueForInput(entry);
}

function computedPrimaryValue(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    return "eval" in entry ? String(entry.eval || "") : "";
  }
  return String(entry || "");
}

function stateDescription(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const parts = [];
    if ("default" in entry) parts.push(`default: ${formatValue(entry.default)}`);
    if ("min" in entry) parts.push(`min: ${entry.min}`);
    if ("max" in entry) parts.push(`max: ${entry.max}`);
    return parts.length ? parts.join(" | ") : "state";
  }

  return `default: ${formatValue(entry)}`;
}

function computedDescription(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const expr = "eval" in entry ? entry.eval : JSON.stringify(entry);
    return `eval: ${String(expr || "").trim() || "(empty)"}`;
  }

  return `eval: ${String(entry || "").trim() || "(empty)"}`;
}

function formatValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value || '""';
  return JSON.stringify(value);
}

function formatValueForInput(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function buildStateEntry(defaultText, minText, maxText) {
  const entry = { default: parseLooseValue(defaultText) };
  assignOptionalNumber(entry, "min", minText);
  assignOptionalNumber(entry, "max", maxText);
  return entry;
}

function buildComputedEntry(expression, minText, maxText) {
  const entry = { eval: expression.trim() };
  assignOptionalNumber(entry, "min", minText);
  assignOptionalNumber(entry, "max", maxText);
  return Object.keys(entry).length === 1 ? entry.eval : entry;
}

function assignOptionalNumber(target, key, value) {
  if (value === "" || value === null || value === undefined) return;
  const number = Number(value);
  if (Number.isFinite(number)) target[key] = number;
}

function parseLooseValue(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getConfigScope(config, scope, pageIndex) {
  if (scope === "global") {
    if (!config.global) config.global = {};
    return config.global;
  }
  if (!Array.isArray(config.pages)) config.pages = [];
  if (!config.pages[pageIndex]) config.pages[pageIndex] = defaultPage(pageIndex);
  return config.pages[pageIndex];
}

function getConfigSummary(getConfig) {
  try {
    const config = getConfig?.() || {};
    const pages = Array.isArray(config.pages) ? config.pages : [];
    return {
      hasConfig: Boolean(config),
      pages: pages.length,
      title: config.global?.title || null,
    };
  } catch (error) {
    console.error("[MacroHero Builder] Failed to read config summary", error);
    return { hasConfig: false, pages: 0, title: null };
  }
}
