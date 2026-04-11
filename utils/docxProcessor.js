/**
 * docxProcessor.js
 * Core document formatting engine.
 *
 * A DOCX file is a ZIP archive containing XML files. This module:
 *   1. Unzips the DOCX buffer using JSZip
 *   2. Parses word/document.xml with @xmldom/xmldom (a real DOM parser)
 *   3. Applies all semantic formatting rules in a single pass
 *   4. Re-serialises the DOM back to XML and returns the updated DOCX buffer
 */

'use strict';

const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

// The main WordprocessingML namespace used throughout OOXML documents
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Font applied during standardisation (can be overridden via env var)
const DEFAULT_FONT = process.env.DEFAULT_FONT || 'Calibri';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply all formatting rules to a DOCX buffer and return the result.
 * @param {Buffer} buffer  Raw bytes of the input .docx file
 * @returns {Promise<Buffer>} Raw bytes of the formatted .docx file
 */
async function processDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('Invalid DOCX file: word/document.xml not found.');
  }

  // Format the main document body
  const docXml = await docFile.async('string');
  zip.file('word/document.xml', applyFormattingRules(docXml));

  // Standardise fonts in the styles part (if present)
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    const stylesXml = await stylesFile.async('string');
    zip.file('word/styles.xml', standardizeFontsInStyles(stylesXml));
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

// ─── Document-level processing ────────────────────────────────────────────────

/**
 * Parse document XML, apply rules, and serialise back to a string.
 */
function applyFormattingRules(xmlContent) {
  try {
    const parser = new DOMParser({
      // Suppress non-fatal XML warnings; re-throw only fatal parse errors
      onError: (level, message) => {
        if (level === 'fatalError') {
          throw new Error(`XML fatal error: ${message}`);
        }
      }
    });

    const doc = parser.parseFromString(xmlContent, 'application/xml');

    const bodies = doc.getElementsByTagNameNS(W_NS, 'body');
    if (bodies.length === 0) return xmlContent;
    const body = bodies[0];

    // Rules applied in order
    removeExtraEmptyParagraphs(body);
    applyHeadingRules(doc, body);
    standardizeFontsInDocument(doc, body);

    return new XMLSerializer().serializeToString(doc);
  } catch (err) {
    // If something goes wrong, return the original so the download still works
    console.error('applyFormattingRules error:', err.message);
    return xmlContent;
  }
}

// ─── Rule: Remove consecutive empty paragraphs ────────────────────────────────

/**
 * Strip surplus blank paragraphs, keeping at most one between content blocks.
 */
function removeExtraEmptyParagraphs(body) {
  // Snapshot the child list so we can safely remove while iterating
  const children = Array.from(body.childNodes);
  let consecutiveEmpty = 0;

  for (const node of children) {
    if (node.nodeType !== 1 /* ELEMENT_NODE */) continue;

    if (node.localName !== 'p') {
      // Tables, sectPr, etc. break any empty-paragraph run
      consecutiveEmpty = 0;
      continue;
    }

    if (isEmptyParagraph(node)) {
      consecutiveEmpty++;
      if (consecutiveEmpty > 1) {
        body.removeChild(node);
      }
    } else {
      consecutiveEmpty = 0;
    }
  }
}

/**
 * A paragraph is considered empty when it carries no visible text, images,
 * or hyperlinks (it may still have paragraph-property elements).
 */
function isEmptyParagraph(p) {
  // Any run (<w:r>) with a non-blank text node counts as content
  const runs = p.getElementsByTagNameNS(W_NS, 'r');
  for (let i = 0; i < runs.length; i++) {
    const textNodes = runs[i].getElementsByTagNameNS(W_NS, 't');
    for (let j = 0; j < textNodes.length; j++) {
      if (textNodes[j].textContent && textNodes[j].textContent.trim()) {
        return false;
      }
    }
  }

  if (p.getElementsByTagNameNS(W_NS, 'hyperlink').length > 0) return false;
  if (p.getElementsByTagNameNS(W_NS, 'drawing').length > 0) return false;

  return true;
}

// ─── Rules: Heading hierarchy + Max-1-H1-per-page ────────────────────────────

/**
 * Single-pass over all top-level paragraphs applying:
 *   • Heading hierarchy enforcement (no level-skipping downward)
 *   • Maximum one H1 per logical page (inserts pageBreakBefore on extras)
 */
function applyHeadingRules(doc, body) {
  const children = Array.from(body.childNodes);
  let prevHeadingLevel = 0;
  let seenH1OnCurrentPage = false;

  for (const node of children) {
    if (node.nodeType !== 1) continue;

    // A page break inside a paragraph resets the H1 counter for the new page
    if (node.localName === 'p' && hasPageBreak(node)) {
      seenH1OnCurrentPage = false;
    }

    if (node.localName !== 'p') continue;

    let level = getHeadingLevel(node);
    if (level === 0) continue; // Not a heading – skip

    // ── Rule 1: fix level jumps (e.g. H1 → H3 becomes H1 → H2) ──────────────
    if (prevHeadingLevel > 0 && level > prevHeadingLevel + 1) {
      level = prevHeadingLevel + 1;
      setHeadingLevel(node, level);
    }

    prevHeadingLevel = level;

    // ── Rule 2: max one H1 per page ──────────────────────────────────────────
    if (level === 1) {
      if (seenH1OnCurrentPage) {
        // Push this H1 to the next page by adding pageBreakBefore
        addPageBreakBefore(doc, node);
        // The break itself acts as the page separator, reset for this new page
      }
      seenH1OnCurrentPage = true;
    }
  }
}

// ─── Heading helper utilities ─────────────────────────────────────────────────

/**
 * Return the numeric heading level of a paragraph (0 = not a heading).
 * Recognises styles like "Heading1", "Heading 1", "heading1", etc.
 */
function getHeadingLevel(p) {
  const pPrs = p.getElementsByTagNameNS(W_NS, 'pPr');
  if (pPrs.length === 0) return 0;

  const pStyles = pPrs[0].getElementsByTagNameNS(W_NS, 'pStyle');
  if (pStyles.length === 0) return 0;

  const val = pStyles[0].getAttribute('w:val') || '';
  const match = val.match(/^Heading\s*(\d+)$/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Change the pStyle value of a heading paragraph to the given level.
 */
function setHeadingLevel(p, level) {
  const pPrs = p.getElementsByTagNameNS(W_NS, 'pPr');
  if (pPrs.length === 0) return;

  const pStyles = pPrs[0].getElementsByTagNameNS(W_NS, 'pStyle');
  if (pStyles.length === 0) return;

  pStyles[0].setAttribute('w:val', `Heading${level}`);

  // Keep outlineLvl in sync if present (0-based: H1 → 0, H2 → 1, …)
  const outlines = pPrs[0].getElementsByTagNameNS(W_NS, 'outlineLvl');
  if (outlines.length > 0) {
    outlines[0].setAttribute('w:val', String(level - 1));
  }
}

/**
 * Return true when the paragraph explicitly triggers a page break.
 * Checks both <w:br w:type="page"/> inside runs and the pageBreakBefore
 * paragraph property.
 */
function hasPageBreak(p) {
  const brs = p.getElementsByTagNameNS(W_NS, 'br');
  for (let i = 0; i < brs.length; i++) {
    if (brs[i].getAttribute('w:type') === 'page') return true;
  }

  const pPrs = p.getElementsByTagNameNS(W_NS, 'pPr');
  if (pPrs.length > 0) {
    const pbbs = pPrs[0].getElementsByTagNameNS(W_NS, 'pageBreakBefore');
    if (pbbs.length > 0) {
      const val = pbbs[0].getAttribute('w:val');
      // Attribute absent (default=true), or explicitly "true"/"1"
      if (val !== 'false' && val !== '0') return true;
    }
  }

  return false;
}

/**
 * Add a pageBreakBefore property to a paragraph so it starts on a fresh page.
 */
function addPageBreakBefore(doc, p) {
  let pPr;
  const pPrs = p.getElementsByTagNameNS(W_NS, 'pPr');

  if (pPrs.length > 0) {
    pPr = pPrs[0];
  } else {
    pPr = doc.createElementNS(W_NS, 'w:pPr');
    p.insertBefore(pPr, p.firstChild);
  }

  // Only add if not already present
  if (pPr.getElementsByTagNameNS(W_NS, 'pageBreakBefore').length === 0) {
    pPr.appendChild(doc.createElementNS(W_NS, 'w:pageBreakBefore'));
  }
}

// ─── Rule: Font standardisation ───────────────────────────────────────────────

/**
 * Force Calibri font on all text runs in the document body.
 * This ensures direct run formatting (w:rFonts) doesn't override styles.
 */
function standardizeFontsInDocument(doc, body) {
  const runs = body.getElementsByTagNameNS(W_NS, 'r');
  
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    let rPr = null;
    
    // Find or create w:rPr (run properties)
    const rPrs = run.getElementsByTagNameNS(W_NS, 'rPr');
    if (rPrs.length > 0) {
      rPr = rPrs[0];
    } else {
      rPr = doc.createElementNS(W_NS, 'w:rPr');
      // Insert rPr as first child of run
      run.insertBefore(rPr, run.firstChild);
    }
    
    // Find w:rFonts element
    const rFontsList = rPr.getElementsByTagNameNS(W_NS, 'rFonts');
    let rFonts = null;
    
    if (rFontsList.length > 0) {
      rFonts = rFontsList[0];
    } else {
      rFonts = doc.createElementNS(W_NS, 'w:rFonts');
      rPr.insertBefore(rFonts, rPr.firstChild);
    }
    
    // Set both w:ascii and w:hAnsi to Calibri
    rFonts.setAttribute('w:ascii', DEFAULT_FONT);
    rFonts.setAttribute('w:hAnsi', DEFAULT_FONT);
  }
}

/**
 * Replace all Western-script font names in styles.xml with Calibri.
 * Uses targeted regex rather than full DOM re-parse to avoid any namespace
 * round-trip issues in the styles document.
 *
 * Only w:ascii and w:hAnsi are touched; w:eastAsia and w:cs are left alone
 * so CJK / complex-script rendering is not broken.
 */
function standardizeFontsInStyles(stylesXml) {
  return stylesXml
    .replace(/w:ascii="[^"]+"/g, `w:ascii="${DEFAULT_FONT}"`)
    .replace(/w:hAnsi="[^"]+"/g, `w:hAnsi="${DEFAULT_FONT}"`);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { processDocx };
