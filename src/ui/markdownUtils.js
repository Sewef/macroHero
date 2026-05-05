/**
 * Shared Markdown utilities (marked-based).
 * Used by TextComponent and tooltip rendering.
 *
 * Output is always sanitized with DOMPurify to prevent XSS, while still
 * allowing safe inline HTML (style, target, rel, etc.) expected by the UI.
 */

import { marked } from "marked";
import DOMPurify from "dompurify";

// DOMPurify config: allow safe inline HTML (links, spans, styles) but block scripts/iframes
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike',
    'code', 'pre', 'kbd', 'mark',
    'a', 'br', 'hr', 'p', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'div', 'blockquote',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'style', 'class'],
  ALLOW_DATA_ATTR: false,
};

// Open links in new tab
const renderer = new marked.Renderer();
renderer.link = ({ href, title, tokens }) => {
  const text = tokens.map(t => t.raw).join('');
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.setOptions({ breaks: true });

/**
 * Parse a Markdown string to sanitized HTML.
 * Single-paragraph output has the wrapping <p> stripped for inline feel.
 * Mixed Markdown + inline HTML is supported (marked passes HTML through,
 * DOMPurify removes anything unsafe).
 * @param {string} str
 * @returns {string} Safe HTML string
 */
export function parseMd(str) {
  const html = marked.parse(str, { renderer });
  const trimmed = html.trim();
  // Strip single <p>…</p> wrapper so short tooltips/labels stay inline
  const unwrapped =
    trimmed.startsWith('<p>') && trimmed.endsWith('</p>') && trimmed.indexOf('<p>', 3) === -1
      ? trimmed.slice(3, -4)
      : trimmed;
  return DOMPurify.sanitize(unwrapped, PURIFY_CONFIG);
}

/**
 * Sanitize a raw-HTML string (no Markdown parsing).
 * @param {string} str
 * @returns {string} Safe HTML string
 */
export function sanitizeHtml(str) {
  return DOMPurify.sanitize(str, PURIFY_CONFIG);
}

/**
 * Detect whether a string contains markdown patterns.
 * Check MD first — marked handles inline HTML natively, so MD+HTML goes through marked.
 * Only falls back to raw-HTML mode if there is no MD syntax at all.
 */
export const MD_PATTERN = /\*\*|__|\*[^\s]|_[^\s]|~~|`|\[[^\]]+\]\(|^#{1,6} |^[*-] |^-{3,}$/m;
