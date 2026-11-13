/**
 * Text Component
 * Renders text/content blocks with auto-detected formatting:
 *
 *  • Plain text  → textContent (safe, escaped)
 *  • Markdown    → marked → DOMPurify → innerHTML  (detected automatically)
 *  • HTML        → DOMPurify → innerHTML  (when string contains '<' and no MD)
 *
 * ${varName} expressions are substituted before parsing, and re-evaluated live.
 */

import { UIComponent } from "./UIComponent.js";
import { parseMd, sanitizeHtml, MD_PATTERN } from "./markdownUtils.js";

// ── Substitute ${varName} in a string ────────────────────────────────────────
function substituteVars(str, resolved, page, globalValues, config) {
  if (!str.includes('${')) return str;
  const Global = Object.fromEntries(
    Object.keys(globalValues || {}).map(name => [name, globalValues[name]])
  );
  const Page = Object.fromEntries(
    Object.keys(page?.variables || {}).map(name => [name, page?._resolved?.[name] ?? resolved[name]])
  );
  const Pages = Object.fromEntries((config?.pages || []).map((candidate, pageIndex) => [
    candidate.id || `page_${pageIndex + 1}`,
    Object.fromEntries(Object.keys(candidate.variables || {}).map(name => [name, candidate?._resolved?.[name]])),
  ]));
  return str.replace(/\$\{([^{}]+)\}/g, (placeholder, expression) => {
    try {
      const value = new Function('Page', 'Global', 'Pages', `return (${expression})`)(Page, Global, Pages);
      return value === null || value === undefined ? '' : String(value);
    } catch {
      return placeholder;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export class TextComponent extends UIComponent {
  render() {
    const el = this.createElement("div", "mh-layout-text");
    const raw = this.item.content ?? this.item.text ?? "";
    const hasExpr = raw.includes('${');

    // MD first — marked handles inline HTML natively (mixed MD+HTML works)
    const isMd   = MD_PATTERN.test(raw);
    const isHtml = !isMd && raw.includes('<');

    if (!isHtml && !isMd) {
      // ── Plain text ──────────────────────────────────────────────────────────
      if (!this.services.evaluateAndSetElementText(el, this.item, this.page)) {
        el.textContent = raw;
      }
      return el;
    }

    // ── HTML or Markdown path ───────────────────────────────────────────────
    const toHtml = (str) => isMd ? parseMd(str) : sanitizeHtml(str);

    const getResolved = () => ({
      ...this.services.globalVariables,
      ...(this.page?._resolved || {}),
    });

    const setContent = (resolved) => {
      el.innerHTML = toHtml(substituteVars(raw, resolved, this.page, this.services.globalVariables, this.services.config));
    };

    setContent(getResolved());

    if (hasExpr) {
      this.services.renderedExpressionElements.push({
        element: el,
        item: this.item,
        page: this.page,
        updateFn: (resolvedVars) => setContent(resolvedVars),
      });
    }

    return el;
  }
}
