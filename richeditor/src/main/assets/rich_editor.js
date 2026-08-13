/**
 * Copyright (C) 2017 Wasabeef
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Merged version:
 * - Keeps original rich_editor APIs
 * - Adds fixed-page pagination from rich_editor2
 * - Preserves table APIs and most legacy behavior
 */

var RE = {};

RE.CALLBACK_SCHEME = "re-callback://";
RE.STATE_SCHEME = "re-state://";

RE.container = document.getElementById("page-container");
RE.pageContentsCache = null;
RE.pagesCache = null;
RE.cachedHtml = null;
RE.cachedPagedHtml = null;
RE.lastCallbackHtml = null;
RE.lastStatePayload = null;
RE.selectionTimer = null;
RE.stateTimer = null;
RE.historyTimer = null;
RE.lastSelectionSignature = "";
RE.lastSelectionSaveAt = 0;

RE.selectionIsWholePage = false;
RE.selectionIsAcrossPages = false;


RE.currentSelection = {
    startContainer: 0,
    startOffset: 0,
    endContainer: 0,
    endOffset: 0
};

RE.savedSelection = null;
RE.isPaginating = false;
RE.inputTimer = null;
RE.placeholder = "";
RE.inputEnabled = true;
RE.composing = false;
RE.expandingSelection = false;
RE.lastKnownScrollY = 0;
RE.isRestoringScroll = false;

RE.historyLocked = false;
RE.undoStack = [];
RE.redoStack = [];
RE.historyMaxLength = 100;

// Tracks the earliest page index touched since the last repagination pass.
// Repagination only needs to rebuild from this page onward - everything
// before it is guaranteed to still be laid out correctly (pagination is a
// left-to-right streaming fill, so earlier pages never depend on later
// content). null/0 means "rebuild the whole document" (used for structural
// changes like font size, margins, undo/redo, etc).
RE.dirtyFromPageIndex = null;

RE.defaultDirection = "rtl";
RE.defaultTextAlign = "right";
RE.defaultPageMargins = {
    left: "72px",
    top: "96px",
    right: "72px",
    bottom: "96px"
};
RE.pageMargins = {
    left: RE.defaultPageMargins.left,
    top: RE.defaultPageMargins.top,
    right: RE.defaultPageMargins.right,
    bottom: RE.defaultPageMargins.bottom
};
RE.PAGE_MARGINS_PATTERN = /<!--\s*re-page-margins:([^>]*)-->/i;
RE.PAGE_BORDER_PATTERN = /<!--\s*re-page-border:([^>]*)-->/i;
RE.pageBorder = { style: "none", color: "#000000", width: 3 };
RE.fontAliases = {
    "IRANSANS": "iransans",
    "VAZIR": "Vazir",
    "SAHAR": "sahar",
    "BSAHAR": "sahar",
    "ASEMAN": "aseman",
    "BYEKAN": "BYekan",
    "BBADR": "BBadr",
    "BTITR": "BTitr",
    "SHABNAM": "Shabnam",
    "BNAZANIN": "BNazanin",
    "BMITRA": "BMitra",
    "SEGOEUI": "segoeui",
    "ROBOTO": "Roboto",
    "BESM": "besm"
};

RE.decode = function (contents) {
    if (!contents) return "";
    try {
        return decodeURIComponent(String(contents).replace(/\+/g, "%20"));
    } catch (e) {
        return contents;
    }
};

RE.encode = function (contents) {
    return encodeURI(contents || "");
};

RE.getPageContents = function () {
    if (!RE.pageContentsCache) {
        RE.pageContentsCache = Array.prototype.slice.call(RE.container.querySelectorAll(".re-page-content"));
    }
    return RE.pageContentsCache;
};

RE.getPages = function () {
    if (!RE.pagesCache) {
        RE.pagesCache = Array.prototype.slice.call(RE.container.querySelectorAll(".re-page"));
    }
    return RE.pagesCache;
};

RE.invalidatePageCache = function () {
    RE.pageContentsCache = null;
    RE.pagesCache = null;
};

RE.invalidateHtmlCache = function () {
    RE.cachedHtml = null;
    RE.cachedPagedHtml = null;
};

RE.invalidateCaches = function () {
    RE.invalidatePageCache();
    RE.invalidateHtmlCache();
};

RE.getFirstEditor = function () {
    var pages = RE.getPageContents();
    return pages.length ? pages[0] : null;
};

Object.defineProperty(RE, "editor", {
    get: function () {
        return RE.getFirstEditor();
    }
});

RE.getHistorySnapshot = function () {
    return {
        html: RE.getPagedHtml(),
        selection: RE.saveSelectionOffsets() || RE.savedSelection
    };
};

RE.cloneHistorySnapshot = function (snapshot) {
    return {
        html: snapshot && snapshot.html ? snapshot.html : "",
        selection: snapshot && snapshot.selection ? {
            start: snapshot.selection.start,
            end: snapshot.selection.end,
            collapsed: snapshot.selection.collapsed
        } : null
    };
};

RE.pushHistorySnapshot = function () {
    if (RE.historyLocked) return;

    var snapshot = RE.cloneHistorySnapshot(RE.getHistorySnapshot());
    var last = RE.undoStack.length ? RE.undoStack[RE.undoStack.length - 1] : null;

    if (last && last.html === snapshot.html) {
        last.selection = snapshot.selection;
        return;
    }

    RE.undoStack.push(snapshot);

    if (RE.undoStack.length > RE.historyMaxLength) {
        RE.undoStack.shift();
    }

    RE.redoStack = [];
};

RE.resetHistory = function () {
    RE.undoStack = [];
    RE.redoStack = [];
    RE.pushHistorySnapshot();
};

RE.scheduleHistorySnapshot = function () {
    if (RE.historyLocked) return;
    if (RE.historyTimer) clearTimeout(RE.historyTimer);

    RE.historyTimer = setTimeout(function () {
        RE.historyTimer = null;
        RE.pushHistorySnapshot();
    }, 450);
};

RE.flushHistorySnapshot = function () {
    if (RE.historyTimer) {
        clearTimeout(RE.historyTimer);
        RE.historyTimer = null;
        RE.pushHistorySnapshot();
    }
};

RE.loadHtmlIntoContainer = function (html) {
    RE.container.innerHTML = "";
    RE.invalidateCaches();

    if (/<div[^>]+class=["'][^"']*\bre-page\b/i.test(html)) {
        RE.container.innerHTML = html;
        RE.invalidateCaches();
        var existing = RE.getPageContents();
        for (var i = 0; i < existing.length; i++) {
            existing[i].contentEditable = String(RE.inputEnabled);
            existing[i].setAttribute("placeholder", RE.placeholder || "");
            RE.applyPageDefaults(existing[i]);
        }
        RE.applyPageBorder();
    } else {
        RE.createPage(html || "<p><br></p>");
    }
};

RE.applyHistorySnapshot = function (snapshot) {
    if (!snapshot) return false;

    RE.historyLocked = true;

    if (RE.inputTimer) {
        clearTimeout(RE.inputTimer);
        RE.inputTimer = null;
    }
    if (RE.historyTimer) {
        clearTimeout(RE.historyTimer);
        RE.historyTimer = null;
    }
    if (RE.stateTimer) {
        clearTimeout(RE.stateTimer);
        RE.stateTimer = null;
    }

    try {
        RE.loadHtmlIntoContainer(snapshot.html || "");
        RE.paginate();

        if (snapshot.selection) {
            RE.restoreSelectionOffsets(snapshot.selection);
            RE.savedSelection = snapshot.selection;
            RE.backuprange();
        }

        RE.callback();
        setTimeout(RE.enabledEditingItems, 60);
    } finally {
        RE.historyLocked = false;
    }

    return true;
};

RE.normalizeFontName = function (fontName) {
    fontName = String(fontName || "").replace(/['"]/g, "").trim();
    if (!fontName) return "";
    return RE.fontAliases[fontName.toUpperCase()] || fontName;
};

RE.applyPageDefaults = function (content) {
    if (!content) return;
    if (!content.style.direction) content.style.direction = RE.defaultDirection;
    if (!content.style.textAlign) content.style.textAlign = RE.defaultTextAlign;
};

RE.normalizePageMarginValue = function (value, fallback) {
    value = String(value || "").trim();
    if (/^\d+(\.\d+)?$/.test(value)) return value + "px";
    if (/^\d+(\.\d+)?px$/i.test(value)) return value;
    return fallback;
};

RE.applyPageMargins = function (left, top, right, bottom, schedule) {
    RE.pageMargins.left = RE.normalizePageMarginValue(left, RE.defaultPageMargins.left);
    RE.pageMargins.top = RE.normalizePageMarginValue(top, RE.defaultPageMargins.top);
    RE.pageMargins.right = RE.normalizePageMarginValue(right, RE.defaultPageMargins.right);
    RE.pageMargins.bottom = RE.normalizePageMarginValue(bottom, RE.defaultPageMargins.bottom);

    var rootStyle = document.documentElement.style;
    rootStyle.setProperty("--re-page-margin-left", RE.pageMargins.left);
    rootStyle.setProperty("--re-page-margin-top", RE.pageMargins.top);
    rootStyle.setProperty("--re-page-margin-right", RE.pageMargins.right);
    rootStyle.setProperty("--re-page-margin-bottom", RE.pageMargins.bottom);

    RE.invalidateHtmlCache();
    if (schedule) {
        RE.markDirtyFromPage(null);
        RE.schedulePaginateAndCallback();
    }
};

RE.parsePageMargins = function (value) {
    var margins = {};
    var parts = String(value || "").split(";");
    for (var i = 0; i < parts.length; i++) {
        var pair = parts[i].split("=");
        if (pair.length !== 2) continue;
        margins[pair[0].trim()] = pair[1].trim();
    }

    if (!margins.left || !margins.top || !margins.right || !margins.bottom) return null;
    return margins;
};

RE.extractPageMarginsFromHtml = function (html) {
    var match = RE.PAGE_MARGINS_PATTERN.exec(html || "");
    return {
        html: String(html || "").replace(RE.PAGE_MARGINS_PATTERN, ""),
        margins: match ? RE.parsePageMargins(match[1]) : null
    };
};

RE.getPageMarginsComment = function () {
    return "<!--re-page-margins:left=" + RE.pageMargins.left +
        ";top=" + RE.pageMargins.top +
        ";right=" + RE.pageMargins.right +
        ";bottom=" + RE.pageMargins.bottom + "-->";
};

RE.parsePageBorder = function (value) {
    var parts = {};
    var tokens = String(value || "").split(";");
    for (var i = 0; i < tokens.length; i++) {
        var pair = tokens[i].split("=");
        if (pair.length !== 2) continue;
        parts[pair[0].trim()] = pair[1].trim();
    }
    if (!parts.style || parts.style === "none") return null;
    return {
        style: parts.style,
        color: parts.color || "#000000",
        width: parseInt(parts.width, 10) || 3
    };
};

RE.extractPageBorderFromHtml = function (html) {
    var match = RE.PAGE_BORDER_PATTERN.exec(html || "");
    return {
        html: String(html || "").replace(RE.PAGE_BORDER_PATTERN, ""),
        border: match ? RE.parsePageBorder(match[1]) : null
    };
};

RE.getPageBorderComment = function () {
    if (RE.pageBorder.style === "none") return "";
    return "<!--re-page-border:style=" + RE.pageBorder.style +
        ";color=" + RE.pageBorder.color +
        ";width=" + RE.pageBorder.width + "-->";
};

RE.applyPageBorderToElement = function (pageEl) {
    if (!pageEl) return;
    if (RE.pageBorder.style && RE.pageBorder.style !== "none") {
        pageEl.setAttribute("data-pb-style", RE.pageBorder.style);
        pageEl.style.setProperty("--pb-color", RE.pageBorder.color);
        pageEl.style.setProperty("--pb-width", RE.pageBorder.width + "px");
    } else {
        pageEl.removeAttribute("data-pb-style");
        pageEl.style.removeProperty("--pb-color");
        pageEl.style.removeProperty("--pb-width");
    }
};

RE.applyPageBorder = function () {
    var pages = RE.getPages();
    for (var i = 0; i < pages.length; i++) {
        RE.applyPageBorderToElement(pages[i]);
    }
};

RE.setPageBorder = function (style, color, width) {
    RE.pageBorder.style = style || "none";
    RE.pageBorder.color = color || "#000000";
    RE.pageBorder.width = parseInt(width, 10) || 3;
    RE.applyPageBorder();
    RE.invalidateHtmlCache();
    RE.schedulePaginateAndCallback();
};

RE.removePageBorder = function () {
    RE.pageBorder.style = "none";
    RE.applyPageBorder();
    RE.invalidateHtmlCache();
    RE.schedulePaginateAndCallback();
};

RE.createPage = function (html) {
    var page = document.createElement("div");
    page.className = "re-page";

    var content = document.createElement("div");
    content.className = "re-page-content";
    content.contentEditable = String(RE.inputEnabled);
    content.spellcheck = false;
    content.setAttribute("placeholder", RE.placeholder || "");
    RE.applyPageDefaults(content);

    if (typeof html === "string") {
        content.innerHTML = html;
    }

    page.appendChild(content);
    RE.container.appendChild(page);
    RE.invalidateCaches();
    RE.applyPageBorderToElement(page);
    return content;
};

RE.ensureAtLeastOnePage = function () {
    if (RE.getPageContents().length === 0) {
        RE.createPage("<p><br></p>");
    }
};

RE.closestPageContent = function (node) {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    return node && node.closest ? node.closest(".re-page-content") : null;
};

RE.isEditorNode = function (node) {
    return !!RE.closestPageContent(node);
};

RE.pageIndexOfNode = function (node) {
    var page = RE.closestPageContent(node);
    if (!page) return null;
    var pages = RE.getPageContents();
    var idx = pages.indexOf(page);
    return idx >= 0 ? idx : null;
};

// Records that content from `pageIndex` onward may have changed and needs
// repagination. Keeps the minimum across multiple marks so a burst of edits
// touching different pages before the debounce fires still repaginates from
// the earliest one. Passing null/non-number forces a full repagination.
RE.markDirtyFromPage = function (pageIndex) {
    if (typeof pageIndex !== "number" || pageIndex < 0) {
        RE.dirtyFromPageIndex = 0;
        return;
    }
    if (typeof RE.dirtyFromPageIndex !== "number" || pageIndex < RE.dirtyFromPageIndex) {
        RE.dirtyFromPageIndex = pageIndex;
    }
};

RE.markDirtyFromSelection = function () {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        RE.markDirtyFromPage(RE.pageIndexOfNode(sel.getRangeAt(0).startContainer));
    } else {
        RE.markDirtyFromPage(null);
    }
};

RE.markDirtyFromPreviousPage = function (node) {
    var pageIndex = RE.pageIndexOfNode(node);
    if (typeof pageIndex !== "number") {
        RE.markDirtyFromPage(null);
        return;
    }
    RE.markDirtyFromPage(Math.max(0, pageIndex - 1));
};

RE.isAtomicNode = function (node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    var tag = node.tagName.toLowerCase();
    return tag === "img" ||
        tag === "br" ||
        tag === "hr" ||
        tag === "input" ||
        tag === "video" ||
        tag === "audio" ||
        tag === "iframe" ||
        tag === "canvas" ||
        tag === "svg";
};

RE.isHtmlEffectivelyEmpty = function (html) {
    if (!html) return true;
    var cleaned = String(html)
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<br\s*\/?>/gi, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, "")
        .toLowerCase();

    cleaned = cleaned
        .replace(/<p><\/p>/gi, "")
        .replace(/<div><\/div>/gi, "")
        .replace(/<span><\/span>/gi, "")
        .replace(/<font><\/font>/gi, "");

    return cleaned === "";
};

RE.isContentEmpty = function (content) {
    if (!content) return true;
    var text = (content.innerText || "").replace(/\u00a0/g, " ").trim();
    if (text.length > 0) return false;
    if (content.querySelector("img, table, video, audio, input, iframe, canvas, svg, hr")) return false;
    return RE.isHtmlEffectivelyEmpty(content.innerHTML);
};

RE.BLOCK_TAGS = {
    P: 1, DIV: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    UL: 1, OL: 1, LI: 1, TABLE: 1, BLOCKQUOTE: 1,
    TR: 1, TD: 1, TH: 1, THEAD: 1, TBODY: 1, TFOOT: 1, HR: 1
};

// A <div> whose direct children include any block-level element can't be
// safely renamed to <p> (a <p> may only hold inline content), so it needs
// to be unwrapped instead. A <div> with only text/inline children is safe
// to rename to <p>.
RE.containsBlockElement = function (el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    for (var i = 0; i < el.children.length; i++) {
        if (RE.BLOCK_TAGS[el.children[i].tagName]) return true;
    }
    return false;
};

// A block is "empty" for normalization purposes if it has no visible text
// and no embedded content. Caret/font-size markers are deliberately
// excluded from this check so an in-progress caret placeholder is never
// wiped out mid-pagination.
RE.isEmptyBlockNode = function (el) {
    if (!el) return true;
    if (el.querySelector && el.querySelector(
        "img, table, video, audio, input, iframe, canvas, svg, hr, [data-re-caret-marker], [data-re-fs-caret]"
    )) return false;
    var text = (el.textContent || "").replace(/\u00a0/g, " ");
    return text.trim().length === 0;
};

// Normalizes the direct children of a page's content so pagination always
// works with a predictable <p>-based structure:
// - bare text nodes get wrapped in <p>
// - inline-only <div>s become <p>s
// - <div>s that hold block-level content are unwrapped (children promoted)
// - empty <p>/<div> blocks collapse to <p><br></p> so page height is kept
// Unwrapping a div can expose new direct children that themselves need
// normalizing (e.g. a <div><div>text</div></div>), so this runs in passes
// until nothing changes.
RE.normalizePage = function (content) {
    if (!content) return;

    var guard = 0;
    var changed = true;

    while (changed && guard < 50) {
        changed = false;
        guard++;

        var nodes = Array.prototype.slice.call(content.childNodes);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (!node.parentNode || node.parentNode !== content) continue;

            if (node.nodeType === Node.TEXT_NODE) {
                if (node.nodeValue.trim().length > 0) {
                    var p = document.createElement("p");
                    p.appendChild(document.createTextNode(node.nodeValue));
                    content.replaceChild(p, node);
                } else {
                    content.removeChild(node);
                }
                changed = true;
                continue;
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
                content.removeChild(node);
                changed = true;
                continue;
            }

            if (node.tagName === "DIV") {
                if (RE.containsBlockElement(node)) {
                    while (node.firstChild) {
                        content.insertBefore(node.firstChild, node);
                    }
                    content.removeChild(node);
                } else {
                    var replacement = document.createElement("p");
                    if (node.getAttribute("style")) replacement.setAttribute("style", node.getAttribute("style"));
                    if (node.className) replacement.className = node.className;
                    while (node.firstChild) replacement.appendChild(node.firstChild);
                    content.replaceChild(replacement, node);
                }
                changed = true;
                continue;
            }

            if (node.tagName === "P" && RE.isEmptyBlockNode(node)) {
                node.innerHTML = "<br>";
            }
        }
    }

    if (RE.isContentEmpty(content)) {
        content.innerHTML = "<p><br></p>";
    }
};

RE.hasRealContent = function (content) {
    if (!content) return false;
    if (RE.isContentEmpty(content)) return false;
    if (content.childNodes.length === 1) {
        var only = content.firstChild;
        if (only.nodeType === Node.ELEMENT_NODE && RE.isHtmlEffectivelyEmpty(only.innerHTML)) return false;
    }
    return true;
};

RE.isOverflow = function (content) {
    if (!content) return false;
    return content.scrollHeight > content.clientHeight + 1;
};

RE.unitLength = function (node) {
    if (!node) return 0;
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.length;
    if (RE.isAtomicNode(node)) return 1;

    var total = 0;
    for (var i = 0; i < node.childNodes.length; i++) {
        total += RE.unitLength(node.childNodes[i]);
    }
    return total;
};

RE.getUnitOffsetInRoot = function (root, container, offset) {
    if (!root || !container) return 0;

    var total = 0;
    var found = false;

    function walk(node) {
        if (!node || found) return;

        if (node === container) {
            if (node.nodeType === Node.TEXT_NODE) {
                total += Math.max(0, Math.min(offset, node.nodeValue.length));
            } else {
                var max = Math.max(0, Math.min(offset, node.childNodes.length));
                for (var i = 0; i < max; i++) {
                    total += RE.unitLength(node.childNodes[i]);
                }
            }

            found = true;
            return;
        }

        if (node.nodeType === Node.TEXT_NODE || RE.isAtomicNode(node)) {
            total += RE.unitLength(node);
            return;
        }

        for (var j = 0; j < node.childNodes.length; j++) {
            walk(node.childNodes[j]);
            if (found) return;
        }
    }

    walk(root);
    return total;
};

RE.isSelectionAcrossMultiplePages = function (range) {
    if (!range) return false;

    var startPage = RE.closestPageContent(range.startContainer);
    var endPage = RE.closestPageContent(range.endContainer);

    return !!startPage && !!endPage && startPage !== endPage;
};

RE.tryExpandNativePageSelectAll = function () {
    if (RE.expandingSelection) return;

    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    var range = sel.getRangeAt(0);

    if (RE.isSelectionAcrossMultiplePages(range)) {
        RE.backuprange();
        return;
    }

    if (!RE.isEditorNode(range.startContainer)) return;

    RE.expandNativePageSelectAll(sel);
};

RE.scheduleExpandNativePageSelectAll = function () {
    if (RE.expandingSelection) return;

    setTimeout(RE.tryExpandNativePageSelectAll, 0);
    setTimeout(RE.tryExpandNativePageSelectAll, 60);
    setTimeout(RE.tryExpandNativePageSelectAll, 180);
};

RE.cloneByUnits = function (node, start, end, counter) {
    if (!node) return null;

    if (node.nodeType === Node.TEXT_NODE) {
        var text = node.nodeValue;
        var nodeStart = counter.value;
        var nodeEnd = counter.value + text.length;
        counter.value = nodeEnd;

        if (end <= nodeStart || start >= nodeEnd) return null;
        return document.createTextNode(text.substring(
            Math.max(start, nodeStart) - nodeStart,
            Math.min(end, nodeEnd) - nodeStart
        ));
    }

    if (RE.isAtomicNode(node)) {
        var atomicStart = counter.value;
        var atomicEnd = counter.value + 1;
        counter.value = atomicEnd;
        return end <= atomicStart || start >= atomicEnd ? null : node.cloneNode(true);
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
        var clone = node.cloneNode(false);
        for (var i = 0; i < node.childNodes.length; i++) {
            var child = RE.cloneByUnits(node.childNodes[i], start, end, counter);
            if (child) clone.appendChild(child);
        }
        return clone.childNodes.length ? clone : null;
    }

    return null;
};

RE.isWordChar = function (ch) {
    return /[0-9A-Za-z\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(ch);
};

RE.isSplitBoundaryChar = function (ch) {
    return /\s/.test(ch) || /[\u200c\u200d\u060C\u061B\u061F.,;:!?()[\]{}'\u0022\u00AB\u00BB<>\/\\|-]/.test(ch);
};

RE.findSafeSplitOffset = function (node, splitOffset) {
    var best = splitOffset;
    var maxBacktrack = 80;

    function walk(current, counter) {
        if (!current) return false;

        if (current.nodeType === Node.TEXT_NODE) {
            var text = current.nodeValue || "";
            var nodeStart = counter.value;
            var nodeEnd = nodeStart + text.length;
            counter.value = nodeEnd;

            if (splitOffset <= nodeStart || splitOffset >= nodeEnd) return false;

            var localOffset = splitOffset - nodeStart;
            var before = text.charAt(localOffset - 1);
            var after = text.charAt(localOffset);

            if (!RE.isWordChar(before) || !RE.isWordChar(after)) return true;

            for (var i = localOffset - 1; i >= 0; i--) {
                if (!RE.isSplitBoundaryChar(text.charAt(i))) continue;

                var candidate = nodeStart + i + 1;
                if (candidate > 0 && splitOffset - candidate <= maxBacktrack) {
                    best = candidate;
                }
                return true;
            }

            return true;
        }

        if (RE.isAtomicNode(current)) {
            counter.value += 1;
            return false;
        }

        if (current.nodeType === Node.ELEMENT_NODE) {
            for (var i = 0; i < current.childNodes.length; i++) {
                if (walk(current.childNodes[i], counter)) return true;
            }
        }

        return false;
    }

    walk(node, { value: 0 });
    return best;
};

// When a paragraph containing a manual line break (<br>) gets split by
// splitNodeToFit exactly at that break, the <br> itself can end up as the
// very first node of the "second" (continuation) fragment. Left alone,
// that renders as a forced blank line at the top of the paragraph's
// continuation on the next page - the "extra Enter" users see after a
// paragraph flows across a page boundary. These helpers drop a leading/
// trailing <br> that sits right at the split seam, without ever emptying
// the fragment out entirely (guarded by the unitLength() > 1 check).
RE.stripLeadingBr = function (el) {
    if (!el || RE.unitLength(el) <= 1) return;
    var node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node.firstChild) {
        var first = node.firstChild;
        if (first.nodeType === Node.TEXT_NODE) {
            if (first.nodeValue === "") { node.removeChild(first); continue; }
            return;
        }
        if (first.nodeType === Node.ELEMENT_NODE && first.tagName === "BR") {
            first.parentNode.removeChild(first);
            return;
        }
        if (first.nodeType === Node.ELEMENT_NODE) {
            node = first;
            continue;
        }
        return;
    }
};

RE.stripTrailingBr = function (el) {
    if (!el || RE.unitLength(el) <= 1) return;
    var node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node.lastChild) {
        var last = node.lastChild;
        if (last.nodeType === Node.TEXT_NODE) {
            if (last.nodeValue === "") { node.removeChild(last); continue; }
            return;
        }
        if (last.nodeType === Node.ELEMENT_NODE && last.tagName === "BR") {
            last.parentNode.removeChild(last);
            return;
        }
        if (last.nodeType === Node.ELEMENT_NODE) {
            node = last;
            continue;
        }
        return;
    }
};

RE.splitNodeToFit = function (content, node) {
    var len = RE.unitLength(node);
    if (len <= 1) return null;

    var original = node;
    var low = 1;
    var high = len - 1;
    var best = 0;

    while (low <= high) {
        var mid = Math.floor((low + high) / 2);
        var counter = { value: 0 };
        var firstPart = RE.cloneByUnits(original, 0, mid, counter);

        if (!firstPart) {
            high = mid - 1;
            continue;
        }

        content.replaceChild(firstPart, original);

        if (!RE.isOverflow(content)) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }

        content.replaceChild(original, firstPart);
    }

    if (best <= 0) return null;

    best = RE.findSafeSplitOffset(original, best);
    if (best <= 0 || best >= len) return null;

    var c1 = { value: 0 };
    var first = RE.cloneByUnits(original, 0, best, c1);
    var c2 = { value: 0 };
    var second = RE.cloneByUnits(original, best, len, c2);

    if (!first || !second) return null;

    RE.stripTrailingBr(first);
    RE.stripLeadingBr(second);

    content.replaceChild(first, original);
    return second;
};

RE.splitTableToFit = function (content, table) {
    var tbody = table.querySelector("tbody");
    var rowParent = tbody || table;
    var rows = Array.prototype.slice.call(rowParent.querySelectorAll(":scope > tr"));
    if (rows.length <= 1) return null;

    var thead = table.querySelector("thead");
    var savedRows = rows.slice();
    var low = 1;
    var high = rows.length - 1;
    var best = 0;

    while (low <= high) {
        var mid = Math.floor((low + high) / 2);

        while (rowParent.children.length > mid) {
            rowParent.removeChild(rowParent.lastChild);
        }

        if (!RE.isOverflow(content)) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }

        for (var i = mid; i < savedRows.length; i++) {
            rowParent.appendChild(savedRows[i]);
        }
    }

    if (best <= 0) return null;

    var newTable = table.cloneNode(false);
    if (thead) {
        newTable.appendChild(thead.cloneNode(true));
    }
    var newTbody = tbody ? document.createElement("tbody") : null;
    if (newTbody) newTable.appendChild(newTbody);
    var newParent = newTbody || newTable;

    for (var j = best; j < savedRows.length; j++) {
        newParent.appendChild(savedRows[j]);
    }

    while (rowParent.children.length > best) {
        rowParent.removeChild(rowParent.lastChild);
    }

    for (var k = 0; k < best; k++) {
        rowParent.appendChild(savedRows[k]);
    }

    return newTable;
};

// Extracts content nodes only from pages[startIndex..end], leaving earlier
// pages completely untouched in the DOM. This is what lets repagination stay
// cheap on long documents: an edit on page 40 of a 40-page document no
// longer requires tearing down and re-measuring pages 1-39.
RE.extractContentNodesFrom = function (startIndex) {
    var queue = [];
    var pages = RE.getPageContents();

    for (var i = startIndex; i < pages.length; i++) {
        while (pages[i].firstChild) {
            queue.push(pages[i].removeChild(pages[i].firstChild));
        }
    }

    return queue.filter(function (node) {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.trim().length > 0;
        return node.nodeType === Node.ELEMENT_NODE;
    });
};

RE.extractAllContentNodes = function () {
    return RE.extractContentNodesFrom(0);
};

// Removes .re-page elements from startIndex onward, leaving earlier pages
// (and their layout/measurements) completely alone.
RE.removePagesFrom = function (startIndex) {
    var pages = RE.getPages();
    for (var i = pages.length - 1; i >= startIndex; i--) {
        if (pages[i].parentNode) pages[i].parentNode.removeChild(pages[i]);
    }
    RE.invalidateCaches();
};

RE.clearPages = function () {
    RE.container.innerHTML = "";
    RE.invalidateCaches();
};

RE.appendPage = function () {
    return RE.createPage("");
};

RE.getGlobalTextOffset = function (container, offset) {
    var pages = RE.getPageContents();
    if (!pages.length) return 0;

    var range = document.createRange();
    try {
        range.setStart(pages[0], 0);
        range.setEnd(container, offset);
        return range.toString().length;
    } catch (e) {
        return 0;
    }
};

RE.saveSelectionOffsets = function () {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    var range = sel.getRangeAt(0);
    if (!RE.isEditorNode(range.startContainer)) return null;

    return {
        start: RE.getGlobalTextOffset(range.startContainer, range.startOffset),
        end: RE.getGlobalTextOffset(range.endContainer, range.endOffset),
        collapsed: range.collapsed
    };
};

RE.findTextPositionByOffset = function (offset) {
    var pages = RE.getPageContents();
    var count = 0;

    for (var p = 0; p < pages.length; p++) {
        var walker = document.createTreeWalker(pages[p], NodeFilter.SHOW_TEXT, null, false);
        var node;
        while ((node = walker.nextNode())) {
            var len = node.nodeValue.length;
            if (count + len >= offset) {
                return { node: node, offset: Math.max(0, offset - count) };
            }
            count += len;
        }
    }

    var last = pages[pages.length - 1];
    return last ? { node: last, offset: last.childNodes.length } : null;
};

RE.restoreSelectionOffsets = function (saved) {
    if (!saved) return;

    var start = RE.findTextPositionByOffset(saved.start);
    var end = RE.findTextPositionByOffset(saved.end);
    if (!start || !end) return;

    try {
        var range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);

        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        var page = RE.closestPageContent(start.node);
        if (page) page.focus();
    } catch (e) {
        RE.focus();
    }
};

RE.backuprange = function () {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && RE.isEditorNode(sel.getRangeAt(0).startContainer)) {
        var range = sel.getRangeAt(0);
        var signature = String(range.startOffset) + ":" + String(range.endOffset) + ":" +
            String(range.collapsed) + ":" + String(range.startContainer === range.endContainer);

        if (signature === RE.lastSelectionSignature &&
            RE.currentSelection.startContainer === range.startContainer &&
            RE.currentSelection.endContainer === range.endContainer) {
            return;
        }

        RE.lastSelectionSignature = signature;
        RE.currentSelection = {
            startContainer: range.startContainer,
            startOffset: range.startOffset,
            endContainer: range.endContainer,
            endOffset: range.endOffset
        };

        var now = Date.now ? Date.now() : new Date().getTime();
        if (now - RE.lastSelectionSaveAt > 120) {
            RE.savedSelection = RE.saveSelectionOffsets();
            RE.lastSelectionSaveAt = now;
        } else {
            if (RE.selectionTimer) clearTimeout(RE.selectionTimer);
            RE.selectionTimer = setTimeout(function () {
                RE.savedSelection = RE.saveSelectionOffsets();
                RE.lastSelectionSaveAt = Date.now ? Date.now() : new Date().getTime();
                RE.selectionTimer = null;
            }, 140);
        }
    }
};

RE.restorerange = function () {
    if (RE.currentSelection && RE.currentSelection.startContainer) {
        try {
            var selection = window.getSelection();
            selection.removeAllRanges();
            var range = document.createRange();
            range.setStart(RE.currentSelection.startContainer, RE.currentSelection.startOffset);
            range.setEnd(RE.currentSelection.endContainer, RE.currentSelection.endOffset);
            selection.addRange(range);
            return;
        } catch (e) {
            // fallback
        }
    }
    RE.restoreSelectionOffsets(RE.savedSelection);
};

RE.scrollSelectionIntoView = function () {
    setTimeout(function () {
        if (RE.isRestoringScroll) return;
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;

        var range = sel.getRangeAt(0).cloneRange();
        var rect = range.getClientRects().length ? range.getClientRects()[0] : null;
        if (!rect) return;

        var margin = 80;
        if (rect.bottom > window.innerHeight - margin) {
            window.scrollBy(0, rect.bottom - window.innerHeight + margin);
        } else if (rect.top < margin) {
            window.scrollBy(0, rect.top - margin);
        }
    }, 0);
};

RE.restoreScrollPosition = function (scrollY) {
    RE.isRestoringScroll = true;
    window.scrollTo(window.pageXOffset || document.documentElement.scrollLeft || 0, scrollY);
    setTimeout(function () {
        RE.isRestoringScroll = false;
    }, 80);
};

RE.insertCaretMarker = function () {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;

    var range = sel.getRangeAt(0);
    if (!range.collapsed || !RE.isEditorNode(range.startContainer)) return false;

    RE.removeCaretMarkers();

    var marker = document.createElement("span");
    marker.setAttribute("data-re-caret-marker", "true");
    marker.style.cssText = "display:inline-block;width:0;height:0;overflow:hidden;line-height:0;";

    range.insertNode(marker);

    range.setStartAfter(marker);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    return true;
};

RE.removeCaretMarkers = function () {
    var markers = document.querySelectorAll("[data-re-caret-marker]");
    for (var i = 0; i < markers.length; i++) {
        if (markers[i].parentNode) markers[i].parentNode.removeChild(markers[i]);
    }
};

RE.restoreCaretMarker = function () {
    var marker = document.querySelector("[data-re-caret-marker]");
    if (!marker) return false;

    var parent = marker.parentNode;
    var page = RE.closestPageContent(marker);
    if (!parent || !page) {
        RE.removeCaretMarkers();
        return false;
    }

    var range = document.createRange();
    range.setStartBefore(marker);
    range.collapse(true);

    parent.removeChild(marker);

    var isFsCaretSpan = parent.getAttribute && parent.getAttribute("data-re-fs-caret") === "true";
    if (parent !== page && parent.nodeType === Node.ELEMENT_NODE && parent.childNodes.length === 0 && !isFsCaretSpan) {
        parent.appendChild(document.createElement("br"));
    }

    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    page.focus();
    RE.backuprange();
    return true;
};

// True only if there is absolutely nothing before the caret anywhere in
// this page - not just "no text in this text node", but no preceding
// sibling/ancestor content at all. Walking the firstChild chain with an
// offset check is what excludes "an earlier empty paragraph exists" from
// counting as page-start: in that case normal in-page Backspace should
// run first and remove that empty paragraph before we ever try to merge
// across the page boundary.
RE.isCaretAtPageStart = function (content, range) {
    if (!content || !range || !range.collapsed) return false;

    var node = range.startContainer;
    if (range.startOffset !== 0) return false;

    while (node !== content) {
        var parent = node.parentNode;
        if (!parent) return false;
        if (parent.firstChild !== node) return false;
        node = parent;
    }
    return true;
};

// Each .re-page-content is its own contenteditable region, so pressing
// Backspace at the very start of one can never reach into the previous
// page on its own - the browser has nothing to delete and just no-ops.
// This simulates what Word-style pagination should do: treat the page
// break as a soft, automatic break rather than real content. It moves all
// of the current page's nodes onto the end of the previous page (undoing
// the automatic break), places the caret exactly at the seam, and lets a
// real execCommand("delete") perform the actual character/paragraph
// merge there - the same thing Backspace would do if the two pages were
// one continuous editable region. Repagination afterwards re-flows the
// merged content back across pages from that point on.
RE.mergeCurrentPageIntoPrevious = function (currentContent) {
    var pages = RE.getPageContents();
    var idx = pages.indexOf(currentContent);
    if (idx <= 0) return false;

    var prevContent = pages[idx - 1];
    if (!prevContent) return false;

    var joinMarker = document.createElement("span");
    joinMarker.setAttribute("data-re-join-marker", "true");
    prevContent.appendChild(joinMarker);

    while (currentContent.firstChild) {
        prevContent.appendChild(currentContent.firstChild);
    }

    var pageEl = currentContent.closest ? currentContent.closest(".re-page") : currentContent.parentNode;
    if (pageEl && pageEl.parentNode) pageEl.parentNode.removeChild(pageEl);

    var joinOffset = Array.prototype.indexOf.call(prevContent.childNodes, joinMarker);
    prevContent.removeChild(joinMarker);

    RE.invalidateCaches();
    RE.invalidateHtmlCache();

    try {
        var range = document.createRange();
        range.setStart(prevContent, Math.max(0, joinOffset));
        range.collapse(true);

        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        prevContent.focus();

        document.execCommand("delete", false, null);
    } catch (e) {}

    RE.backuprange();
    RE.markDirtyFromPage(idx - 1);
    RE.schedulePaginateAndCallback();
    return true;
};

RE.paginate = function (fromPageIndex) {
    if (RE.isPaginating || RE.composing) return;
    RE.isPaginating = true;
    RE.clearImageResize();
    RE.invalidateHtmlCache();

    var scrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    var saved = RE.saveSelectionOffsets() || RE.savedSelection;
    var markerInserted = RE.insertCaretMarker();

    try {
        RE.ensureAtLeastOnePage();

        // Only rebuild from the earliest page that actually changed. Pages
        // before it are left untouched in the DOM (no removal, no
        // measurement), which is what keeps typing fast on long documents:
        // pagination fills pages strictly left-to-right, so an edit on page
        // N can never change how pages before N were laid out.
        var existingPages = RE.getPageContents();
        var startIndex = 0;
        if (typeof fromPageIndex === "number" && fromPageIndex > 0 && fromPageIndex < existingPages.length) {
            startIndex = fromPageIndex;
        }

        var queue = RE.extractContentNodesFrom(startIndex);
        RE.removePagesFrom(startIndex);

        if (!queue.length) {
            if (startIndex === 0) {
                RE.createPage("<p><br></p>");
            } else {
                RE.ensureAtLeastOnePage();
            }
            if (!RE.restoreCaretMarker()) RE.restoreSelectionOffsets(saved);
            return;
        }

        var current = RE.appendPage();
        var guard = 0;

        while (queue.length && guard < 10000) {
            guard++;
            var node = queue.shift();
            current.appendChild(node);

            if (!RE.isOverflow(current)) continue;

            var remainder = null;
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "TABLE") {
                remainder = RE.splitTableToFit(current, node);
            }
            if (!remainder) {
                remainder = RE.splitNodeToFit(current, node);
            }
            if (remainder) {
                queue.unshift(remainder);
                current = RE.appendPage();
                continue;
            }

            current.removeChild(node);

            if (RE.hasRealContent(current)) {
                current = RE.appendPage();
                queue.unshift(node);
                continue;
            }

            current.appendChild(node);
            if (RE.isOverflow(current) && node.nodeType === Node.ELEMENT_NODE) {
                node.style.maxHeight = current.clientHeight + "px";
                node.style.maxWidth = "100%";
                node.style.height = "auto";
            }
            current = RE.appendPage();
        }

        var pages = RE.getPageContents();
        for (var i = pages.length - 1; i >= startIndex; i--) {
            RE.normalizePage(pages[i]);
            if (pages.length > 1 && RE.isContentEmpty(pages[i])) {
                pages[i].parentNode.removeChild(pages[i]);
                pages.splice(i, 1);
            }
        }

        RE.ensureAtLeastOnePage();
        if (!RE.restoreCaretMarker()) RE.restoreSelectionOffsets(saved);
        RE.restoreScrollPosition(scrollY);
        RE.scrollSelectionIntoView();
    } finally {
        RE.removeCaretMarkers();
        RE.invalidateCaches();
        RE.dirtyFromPageIndex = null;
        RE.isPaginating = false;
    }
};

RE.schedulePaginateAndCallback = function () {
    if (RE.inputTimer) clearTimeout(RE.inputTimer);

    RE.inputTimer = setTimeout(function () {
        RE.inputTimer = null;
        RE.paginate(RE.dirtyFromPageIndex);
        RE.scheduleHistorySnapshot();
        RE.callback();
    }, 80);
};

RE.callback = function () {
    var html = RE.getHtml();
    if (html === RE.lastCallbackHtml) return;
    RE.lastCallbackHtml = html;

    if (window.REBridge && typeof window.REBridge.callback === "function") {
        try {
            window.REBridge.callback(html);
            return;
        } catch (e) {}
    }

    window.location.href = RE.CALLBACK_SCHEME + RE.encode(html);
};

RE.setHtml = function (contents) {
    RE.clearAllImageResizeWrappers();
    var html = RE.decode(contents);

    var marginsData = RE.extractPageMarginsFromHtml(html);
    html = marginsData.html;
    if (marginsData.margins) {
        RE.applyPageMargins(
            marginsData.margins.left,
            marginsData.margins.top,
            marginsData.margins.right,
            marginsData.margins.bottom,
            false
        );
    } else {
        RE.applyPageMargins(
            RE.defaultPageMargins.left,
            RE.defaultPageMargins.top,
            RE.defaultPageMargins.right,
            RE.defaultPageMargins.bottom,
            false
        );
    }

    var borderData = RE.extractPageBorderFromHtml(html);
    html = borderData.html;
    if (borderData.border) {
        RE.pageBorder = borderData.border;
    }

    RE.loadHtmlIntoContainer(html);
    RE.applyPageBorder();
    RE.lastCallbackHtml = null;
    RE.paginate();
    RE.resetHistory();
};

RE.getHtml = function () {

    RE.clearAllImageResizeWrappers();

    if (RE.cachedHtml !== null) return RE.cachedHtml;

    var pages = RE.getPageContents();
    var result = [];

    result.push(RE.getPageMarginsComment());

    var borderComment = RE.getPageBorderComment();
    if (borderComment) result.push(borderComment);

    for (var i = 0; i < pages.length; i++) {
        if (!RE.isContentEmpty(pages[i])) result.push(pages[i].innerHTML);
    }

    RE.cachedHtml = result.join("");
    return RE.cachedHtml;
};


RE.clearAllImageResizeWrappers = function () {
    var wrappers = document.querySelectorAll(".re-img-resize-wrapper");
    for (var i = 0; i < wrappers.length; i++) {
        var wrapper = wrappers[i];
        var img = wrapper.querySelector("img");
        if (!img || !wrapper.parentNode) continue;

        var w = wrapper.offsetWidth;
        img.style.width = w + "px";
        img.style.height = "auto";
        wrapper.parentNode.replaceChild(img, wrapper);
    }

    var images = document.querySelectorAll("img[data-re-needs-load-pagination], img[data-re-load-watched]");
    for (var j = 0; j < images.length; j++) {
        images[j].removeAttribute("data-re-needs-load-pagination");
        images[j].removeAttribute("data-re-load-watched");
    }

    RE.activeResizeWrapper = null;
    RE.isResizing = false;
    RE.resizeHandle = null;
    RE.resizeImg = null;
    RE.invalidateHtmlCache();
};

RE.getPagedHtml = function () {
    if (RE.cachedPagedHtml !== null) return RE.cachedPagedHtml;
    RE.cachedPagedHtml = RE.container.innerHTML;
    return RE.cachedPagedHtml;
};

RE.getText = function () {
    var pages = RE.getPageContents();
    var text = [];
    for (var i = 0; i < pages.length; i++) text.push(pages[i].innerText || "");
    return text.join("\n");
};

RE.setBaseTextColor = function (color) {
    var pages = RE.getPageContents();
    for (var i = 0; i < pages.length; i++) {
        pages[i].style.color = color;
    }
};

RE.setBaseFontSize = function (size) {
    var pages = RE.getPageContents();
    for (var i = 0; i < pages.length; i++) {
        pages[i].style.fontSize = size;
    }
    RE.schedulePaginateAndCallback();
};

RE.setPadding = function (left, top, right, bottom) {
    RE.applyPageMargins(left, top, right, bottom, true);
};

RE.setPageMargins = function (left, top, right, bottom) {
    RE.applyPageMargins(left, top, right, bottom, true);
};

RE.setBackgroundColor = function (color) {
    document.body.style.backgroundColor = color;
};

RE.setBackgroundImage = function (image) {
    var pages = RE.getPages();
    for (var i = 0; i < pages.length; i++) {
        pages[i].style.backgroundImage = image;
        pages[i].style.backgroundSize = "cover";
        pages[i].style.backgroundRepeat = "no-repeat";
        pages[i].style.backgroundPosition = "center center";
    }
};

RE.setWidth = function (size) {
    var pages = RE.getPages();
    for (var i = 0; i < pages.length; i++) {
        pages[i].style.minWidth = size;
    }
    RE.schedulePaginateAndCallback();
};

RE.setHeight = function (size) {
    var pages = RE.getPages();
    for (var i = 0; i < pages.length; i++) {
        pages[i].style.height = size;
    }
    RE.schedulePaginateAndCallback();
};

RE.setDir = function (dir) {
    var pages = RE.getPageContents();
    for (var i = 0; i < pages.length; i++) {
        pages[i].style.direction = dir;
    }
};

RE.removeMEditor = function () {
    if (document.body) {
        document.body.removeAttribute("id");
    }
};

RE.setTextAlign = function (align) {
    var pages = RE.getPageContents();
    for (var i = 0; i < pages.length; i++) {
        pages[i].style.textAlign = align;
    }
};

RE.setVerticalAlign = function (align) {
    var pages = RE.getPageContents();
    for (var i = 0; i < pages.length; i++) {
        pages[i].style.verticalAlign = align;
    }
};

RE.setPlaceholder = function (placeholder) {
    RE.placeholder = placeholder || "";
    var pages = RE.getPageContents();
    for (var i = 0; i < pages.length; i++) {
        pages[i].setAttribute("placeholder", RE.placeholder);
    }
};

RE.setInputEnabled = function (inputEnabled) {
    RE.inputEnabled = !!inputEnabled;
    var pages = RE.getPageContents();
    for (var i = 0; i < pages.length; i++) {
        pages[i].contentEditable = String(RE.inputEnabled);
    }
};

RE.undo = function () {
    if (RE.inputTimer) {
        clearTimeout(RE.inputTimer);
        RE.inputTimer = null;
        RE.paginate();
    }
    RE.flushHistorySnapshot();

    var current = RE.cloneHistorySnapshot(RE.getHistorySnapshot());
    var last = RE.undoStack.length ? RE.undoStack[RE.undoStack.length - 1] : null;

    if (!last || last.html !== current.html) {
        RE.undoStack.push(current);
        if (RE.undoStack.length > RE.historyMaxLength) RE.undoStack.shift();
    }

    if (RE.undoStack.length <= 1) return false;

    var item = RE.undoStack.pop();
    RE.redoStack.push(item);

    var target = RE.undoStack[RE.undoStack.length - 1];
    return RE.applyHistorySnapshot(target);
};

RE.redo = function () {
    if (RE.inputTimer) {
        clearTimeout(RE.inputTimer);
        RE.inputTimer = null;
        RE.paginate();
    }
    RE.flushHistorySnapshot();

    if (!RE.redoStack.length) return false;

    var target = RE.redoStack.pop();
    RE.undoStack.push(RE.cloneHistorySnapshot(target));

    if (RE.undoStack.length > RE.historyMaxLength) {
        RE.undoStack.shift();
    }

    return RE.applyHistorySnapshot(target);
};

RE.afterCommand = function () {
    RE.backuprange();
    RE.markDirtyFromSelection();
    RE.schedulePaginateAndCallback();
    setTimeout(RE.enabledEditingItems, 60);
};

RE.applyExecToAllPagesIfGlobal = function(command, value) {
    if (!RE.selectionIsAcrossPages && !RE.selectionIsWholePage) return false;
    RE.restorerange();
    var saved = RE.saveSelectionOffsets();
    var sel = window.getSelection();
    var pages = RE.getPageContents();
    for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        if (RE.isContentEmpty(page)) continue;
        var range = document.createRange();
        range.selectNodeContents(page);
        sel.removeAllRanges();
        sel.addRange(range);
        try {
            document.execCommand(command, false, value);
        } catch (e) {}
    }
    if (saved) RE.restoreSelectionOffsets(saved);
    else RE.selectAll();
    RE.backuprange();
    RE.markDirtyFromPage(0);
    RE.schedulePaginateAndCallback();
    setTimeout(RE.enabledEditingItems, 60);
    return true;
};

RE.exec = function (command, value) {
    var globalCommands = {
        "bold": true, "italic": true, "underline": true, "strikeThrough": true,
        "subscript": true, "superscript": true,
        "foreColor": true, "hiliteColor": true,
        "fontSize": true, "fontName": true,
        "removeFormat": true
    };
    if (globalCommands[command] && RE.applyExecToAllPagesIfGlobal(command, value || null)) {
        return;
    }
    RE.restorerange();
    try {
        document.execCommand(command, false, value || null);
    } catch (e) {}
    RE.afterCommand();
};

RE.setBold = function () { RE.exec("bold"); };
RE.setItalic = function () { RE.exec("italic"); };
RE.setSubscript = function () { RE.exec("subscript"); };
RE.setSuperscript = function () { RE.exec("superscript"); };
RE.setStrikeThrough = function () { RE.exec("strikeThrough"); };
RE.setUnderline = function () { RE.exec("underline"); };
RE.setBullets = function () { RE.exec("insertUnorderedList"); };
RE.setNumbers = function () { RE.exec("insertOrderedList"); };
RE.setFontSize = function (fontSize) { RE.exec("fontSize", fontSize); };
RE.setHeading = function (heading) { RE.exec("formatBlock", "<h" + heading + ">"); };
RE.setIndent = function () { RE.exec("indent"); };
RE.setOutdent = function () { RE.exec("outdent"); };
RE.setJustifyLeft = function () { RE.exec("justifyLeft"); };
RE.setJustifyCenter = function () { RE.exec("justifyCenter"); };
RE.setJustifyRight = function () { RE.exec("justifyRight"); };
RE.setBlockquote = function () { RE.exec("formatBlock", "<blockquote>"); };
RE.removeFormat = function () { RE.exec("removeFormat"); };

RE.setTextColor = function (color) {
    if (RE.selectionIsAcrossPages || RE.selectionIsWholePage) {
        RE.restorerange();
        var saved = RE.saveSelectionOffsets();
        var sel = window.getSelection();
        var pages = RE.getPageContents();
        for (var i = 0; i < pages.length; i++) {
            var page = pages[i];
            if (RE.isContentEmpty(page)) continue;
            var range = document.createRange();
            range.selectNodeContents(page);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand("styleWithCSS", false, true);
            document.execCommand("foreColor", false, color);
            document.execCommand("styleWithCSS", false, false);
        }
        if (saved) RE.restoreSelectionOffsets(saved);
        else RE.selectAll();
        RE.backuprange();
        RE.markDirtyFromPage(0);
        RE.schedulePaginateAndCallback();
        setTimeout(RE.enabledEditingItems, 60);
        return;
    }
    RE.restorerange();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("foreColor", false, color);
    document.execCommand("styleWithCSS", false, false);
    RE.afterCommand();
};

RE.setTextBackgroundColor = function (color) {
    if (RE.selectionIsAcrossPages || RE.selectionIsWholePage) {
        RE.restorerange();
        var saved = RE.saveSelectionOffsets();
        var sel = window.getSelection();
        var pages = RE.getPageContents();
        for (var i = 0; i < pages.length; i++) {
            var page = pages[i];
            if (RE.isContentEmpty(page)) continue;
            var range = document.createRange();
            range.selectNodeContents(page);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand("styleWithCSS", false, true);
            document.execCommand("hiliteColor", false, color);
            document.execCommand("styleWithCSS", false, false);
        }
        if (saved) RE.restoreSelectionOffsets(saved);
        else RE.selectAll();
        RE.backuprange();
        RE.markDirtyFromPage(0);
        RE.schedulePaginateAndCallback();
        setTimeout(RE.enabledEditingItems, 60);
        return;
    }
    RE.restorerange();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("hiliteColor", false, color);
    document.execCommand("styleWithCSS", false, false);
    RE.afterCommand();
};

RE.applyInlineStyleToSelection = function (styles, command, value) {
    RE.restorerange();

    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    var range = selection.getRangeAt(0);
    if (!RE.isEditorNode(range.commonAncestorContainer)) return false;

    if (RE.selectionIsAcrossPages || RE.selectionIsWholePage) {
        var saved = RE.saveSelectionOffsets();
        var pages = RE.getPageContents();
        for (var i = 0; i < pages.length; i++) {
            var page = pages[i];
            if (RE.isContentEmpty(page)) continue;
            var pageRange = document.createRange();
            pageRange.selectNodeContents(page);
            selection.removeAllRanges();
            selection.addRange(pageRange);

            try {
                var span = document.createElement("span");
                for (var key in styles) {
                    if (styles.hasOwnProperty(key)) span.style[key] = styles[key];
                }
                span.appendChild(pageRange.extractContents());
                pageRange.insertNode(span);

                selection.removeAllRanges();
                var newRange = document.createRange();
                newRange.selectNodeContents(span);
                selection.addRange(newRange);
            } catch (e2) {
                try {
                    document.execCommand("styleWithCSS", false, true);
                    document.execCommand(command, false, value);
                    document.execCommand("styleWithCSS", false, false);
                } catch (e3) {}
            }
        }
        if (saved) RE.restoreSelectionOffsets(saved);
        else RE.selectAll();
        RE.backuprange();
        RE.markDirtyFromPage(0);
        RE.schedulePaginateAndCallback();
        setTimeout(RE.enabledEditingItems, 60);
        return true;
    }

    if (range.collapsed) {
        try {
            document.execCommand("styleWithCSS", false, true);
            document.execCommand(command, false, value);
            document.execCommand("styleWithCSS", false, false);
            RE.afterCommand();
            return true;
        } catch (e1) {
            return false;
        }
    }

    try {
        var span = document.createElement("span");
        for (var key in styles) {
            if (styles.hasOwnProperty(key)) span.style[key] = styles[key];
        }

        span.appendChild(range.extractContents());
        range.insertNode(span);

        selection.removeAllRanges();
        var newRange = document.createRange();
        newRange.selectNodeContents(span);
        selection.addRange(newRange);

        RE.afterCommand();
        return true;
    } catch (e2) {
        try {
            document.execCommand("styleWithCSS", false, true);
            document.execCommand(command, false, value);
            document.execCommand("styleWithCSS", false, false);
            RE.afterCommand();
            return true;
        } catch (e3) {
            return false;
        }
    }
};

/* ---------- اصلاح‌شده: اعمال سایز متن (font size) ----------
   پیاده‌سازی جدید سایز را مستقیم با Range روی گره‌های متن اعمال می‌کند؛
   بنابراین هم چند کلمه/چند پاراگراف درست کار می‌کند و هم تغییر سایز
   روی متنی که قبلاً سایز خورده، همیشه نتیجه می‌دهد (اسپن جدید همیشه
   داخلی‌ترین لایه است و سایز تازه بر سایزهای قبلی غلبه می‌کند). */

// اسپن‌های خالیِ جای caret از اجرای قبلی را پاک می‌کند
RE.removeEmptyFontSizeSpans = function () {
    var sel = window.getSelection();
    var caretIn = null;
    if (sel && sel.rangeCount > 0) {
        var n = sel.getRangeAt(0).startContainer;
        caretIn = n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
    }
    var spans = RE.container.querySelectorAll('span[data-re-fs-caret]');
    for (var i = spans.length - 1; i >= 0; i--) {
        var s = spans[i];
        // اسپنی که caret داخلش است را دست نزن (قرار است استفاده شود)
        if (caretIn && (s === caretIn || (s.contains && s.contains(caretIn)))) continue;
        var empty = !s.textContent &&
            !s.querySelector("img, input, table, video, audio, iframe, canvas, svg, hr");
        if (empty) {
            // کاملاً حذف شود (اگر <br> جعلی هم داخلش باشد، با خودش می‌رود)
            if (s.parentNode) s.parentNode.removeChild(s);
        } else {
            s.removeAttribute("data-re-fs-caret");
        }
    }
};

RE.rangeIntersectsNode = function (range, node) {
    try {
        if (typeof range.intersectsNode === "function") {
            return range.intersectsNode(node);
        }
    } catch (e) {}
    try {
        return range.isPointInRange(node, 0) ||
               range.isPointInRange(node, node.nodeValue.length);
    } catch (e2) {}
    return true;
};

RE.applyFontSizeToRange = function (range, fontSizePt) {
    var sizeValue = fontSizePt + "pt";
    var root = range.commonAncestorContainer;
    var wrappers = [];

    function wrapPiece(piece) {
        if (!piece || !piece.parentNode) return;
        var span = document.createElement("span");
        span.style.fontSize = sizeValue;
        piece.parentNode.insertBefore(span, piece);
        span.appendChild(piece);
        wrappers.push(span);
    }

    if (root.nodeType === Node.TEXT_NODE) {
        if (range.startOffset === range.endOffset) return wrappers;
        var node = root;
        if (range.endOffset < node.nodeValue.length) node.splitText(range.endOffset);
        if (range.startOffset > 0) node = node.splitText(range.startOffset);
        wrapPiece(node);
    } else {
        var textNodes = [];
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        var tn;
        while ((tn = walker.nextNode())) {
            if (!tn.nodeValue.length) continue;
                        if (!tn.nodeValue.trim() && tn.parentNode &&
                            tn.parentNode.classList && tn.parentNode.classList.contains("re-page-content")) continue;
            if (tn === range.startContainer && range.startOffset >= tn.nodeValue.length) continue;
            if (tn === range.endContainer && range.endOffset <= 0) continue;
            if (!RE.rangeIntersectsNode(range, tn)) continue;
            textNodes.push(tn);
        }
        for (var i = 0; i < textNodes.length; i++) {
            var piece = textNodes[i];
            if (piece === range.endContainer && range.endOffset < piece.nodeValue.length) {
                piece.splitText(range.endOffset);
            }
            if (piece === range.startContainer && range.startOffset > 0) {
                piece = piece.splitText(range.startOffset);
            }
            wrapPiece(piece);
        }
    }

    if (wrappers.length) {

        RE.cleanupFontSizeAroundWrappers(wrappers);




        var liveWrappers = [];
        for (var w = 0; w < wrappers.length; w++) {
            if (!RE.removeIfEmptySpan(wrappers[w])) liveWrappers.push(wrappers[w]);
        }
        for (var w2 = 0; w2 < liveWrappers.length; w2++) {
            RE.mergeAdjacentFontSizeSpans(liveWrappers[w2]);
        }
        liveWrappers = liveWrappers.filter(function (s) { return !!s.parentNode; });

        if (liveWrappers.length) {
            var changedPage = RE.closestPageContent(liveWrappers[0]);
            if (changedPage) RE.normalizePage(changedPage);
        }

        var sel = window.getSelection();
        if (sel && liveWrappers.length) {
            var r2 = document.createRange();
            r2.setStartBefore(liveWrappers[0]);
            r2.setEndAfter(liveWrappers[liveWrappers.length - 1]);
            sel.removeAllRanges();
            sel.addRange(r2);
        }
    }
    return wrappers;
};



RE.removeIfEmptySpan = function (span) {
    if (!span || !span.parentNode || span.tagName !== "SPAN") return false;
    var hasText = (span.textContent || "").length > 0;
    var hasAtomic = span.querySelector && span.querySelector("img, table, video, audio, input, iframe, canvas, svg, hr");
    if (hasText || hasAtomic) return false;
    while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
    span.parentNode.removeChild(span);
    return true;
};



RE.mergeAdjacentFontSizeSpans = function (span) {
    if (!span || !span.parentNode || span.tagName !== "SPAN") return;

    var next = span.nextSibling;
    if (next && next.nodeType === Node.ELEMENT_NODE && next.tagName === "SPAN" &&
        next.getAttribute("style") === span.getAttribute("style") &&
        next.className === span.className) {
        while (next.firstChild) span.appendChild(next.firstChild);
        next.parentNode.removeChild(next);
    }

    var prev = span.previousSibling;
    if (prev && prev.nodeType === Node.ELEMENT_NODE && prev.tagName === "SPAN" &&
        prev.getAttribute("style") === span.getAttribute("style") &&
        prev.className === span.className) {
        while (span.firstChild) prev.appendChild(span.firstChild);
        span.parentNode.removeChild(span);
    }
};

RE.setFontSizePt = function (fontSizePt) {
    fontSizePt = parseInt(fontSizePt, 10);
    if (!fontSizePt || fontSizePt <= 0) return;

    var isGlobal = RE.selectionIsAcrossPages || RE.selectionIsWholePage;
    RE.removeEmptyFontSizeSpans();
    RE.restorerange();

    var sel = window.getSelection();
    if (!sel) return;

    var saved = RE.saveSelectionOffsets();
    var collapsedAtCaret = false;

    if (isGlobal) {

        var pages = RE.getPageContents();
        for (var i = 0; i < pages.length; i++) {
            var page = pages[i];
            if (RE.isContentEmpty(page)) continue;
            var pageRange = document.createRange();
            pageRange.selectNodeContents(page);
            RE.applyFontSizeToRange(pageRange, fontSizePt);
        }
    } else {
        if (!sel.rangeCount) RE.focus();
        var range = sel.getRangeAt(0);
        if (!RE.isEditorNode(range.commonAncestorContainer)) return;

               if (range.collapsed) {
                   collapsedAtCaret = true;

                   var caretEl = range.startContainer.nodeType === Node.TEXT_NODE ?
                       range.startContainer.parentElement : range.startContainer;
                   var existingCaretSpan = null;
                   while (caretEl && caretEl !== RE.container) {
                       if (caretEl.nodeType === Node.ELEMENT_NODE &&
                           caretEl.tagName === "SPAN" &&
                           caretEl.getAttribute("data-re-fs-caret") === "true") {
                           existingCaretSpan = caretEl;
                           break;
                       }
                       caretEl = caretEl.parentNode;
                   }
                   if (existingCaretSpan) {
                       existingCaretSpan.style.fontSize = fontSizePt + "pt";
                   } else {
                       var caretSpan = document.createElement("span");
                       caretSpan.style.fontSize = fontSizePt + "pt";
                       caretSpan.setAttribute("data-re-fs-caret", "true");
                       range.insertNode(caretSpan);
                       var caretRange = document.createRange();
                       caretRange.setStart(caretSpan, 0);
                       caretRange.collapse(true);
                       sel.removeAllRanges();
                       sel.addRange(caretRange);
                   }
               } else {
                   RE.applyFontSizeToRange(range, fontSizePt);
               }
    }

    if (!collapsedAtCaret) {
        if (saved) RE.restoreSelectionOffsets(saved);
        else if (isGlobal) RE.selectAll();
    }
    RE.backuprange();
    RE.markDirtyFromPage(0);
    RE.schedulePaginateAndCallback();
    setTimeout(RE.enabledEditingItems, 60);
};



RE.stripFontSizeFromElement = function (el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    var tag = el.tagName;
    if (tag === "FONT") {
        if (!el.hasAttribute("size")) return;
        el.removeAttribute("size");
    } else if (el.style && el.style.fontSize) {
        el.style.removeProperty("font-size");
        if (!el.getAttribute("style")) el.removeAttribute("style");
    } else {
        return;
    }

       var parent = el.parentNode;
       var parentIsPage = parent && parent.classList && parent.classList.contains("re-page-content");
       if ((tag === "SPAN" || tag === "FONT") && el.attributes.length === 0 && parent && !parentIsPage) {
           while (el.firstChild) parent.insertBefore(el.firstChild, el);
           parent.removeChild(el);
       }
};


RE.isFullyCoveredByWrappers = function (el, wrappers) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.length) continue;
        var covered = false;
        for (var i = 0; i < wrappers.length; i++) {
            if (wrappers[i].contains(node)) { covered = true; break; }
        }
        if (!covered) return false;
    }
    return true;
};

RE.cleanupFontSizeAroundWrappers = function (wrappers) {
    var i, j;


    for (i = 0; i < wrappers.length; i++) {
        var inner = wrappers[i].querySelectorAll('[style*="font-size"], font[size]');
        for (j = inner.length - 1; j >= 0; j--) {
            RE.stripFontSizeFromElement(inner[j]);
        }
    }



    for (i = 0; i < wrappers.length; i++) {
        var page = RE.closestPageContent(wrappers[i]);
        var anc = wrappers[i].parentNode;
        while (anc && anc !== page && anc !== RE.container && anc.nodeType === Node.ELEMENT_NODE) {
            var next = anc.parentNode;
            var hasOldSize = (anc.tagName === "FONT" && anc.hasAttribute("size")) ||
                             (anc.style && anc.style.fontSize);
            if (hasOldSize && RE.isFullyCoveredByWrappers(anc, wrappers)) {
                RE.stripFontSizeFromElement(anc);
            }
            anc = next;
        }
    }
};


RE.insertImage = function (url, alt) {
    var html = '<img width="80%" src="' + url + '" alt="' + alt + '" data-re-needs-load-pagination="true" /><p><br></p>';
    RE.insertHTML(html);
    RE.watchPendingImages();
};

RE.insertHTML = function (html) {
    RE.restorerange();
    document.execCommand("insertHTML", false, html);

    // Normalize right away so any stray <div>/text nodes the browser's
    // insertHTML left behind (rather than the <p>-based structure
    // pagination expects) are cleaned up immediately, not just whenever
    // the debounced paginate cycle eventually runs.
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        var page = RE.closestPageContent(sel.getRangeAt(0).startContainer);
        if (page) RE.normalizePage(page);
    }

    RE.afterCommand();
};

RE.insertLink = function (url, title) {
    RE.restorerange();
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.toString().length === 0) {
        document.execCommand("insertHTML", false, "<a href='" + url + "'>" + title + "</a>");
    } else {
        try {
            var el = document.createElement("a");
            el.setAttribute("href", url);
            el.setAttribute("title", title);

            var range = sel.getRangeAt(0).cloneRange();
            range.surroundContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (e) {
            document.execCommand("createLink", false, url);
        }
    }
    RE.afterCommand();
};

RE.setTodo = function (text) {
    var html = '<input type="checkbox" name="' + text + '" value="' + text + '"/> &nbsp;';
    document.execCommand("insertHTML", false, html);
    RE.afterCommand();
};

RE.prepareInsert = function () {
    RE.backuprange();
};

RE.focus = function () {
    RE.ensureAtLeastOnePage();
    var pages = RE.getPageContents();
    var last = pages[pages.length - 1];
    last.focus();

    var range = document.createRange();
    range.selectNodeContents(last);
    range.collapse(false);

    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    RE.backuprange();
};

RE.blurFocus = function () {
    var pages = RE.getPageContents();
    for (var i = 0; i < pages.length; i++) pages[i].blur();
};

RE.enabledEditingItems = function () {
    var items = [];
    try {
        if (document.queryCommandState("bold")) items.push("bold");
        if (document.queryCommandState("italic")) items.push("italic");
        if (document.queryCommandState("subscript")) items.push("subscript");
        if (document.queryCommandState("superscript")) items.push("superscript");
        if (document.queryCommandState("strikeThrough")) items.push("strikeThrough");
        if (document.queryCommandState("underline")) items.push("underline");
        if (document.queryCommandState("insertOrderedList")) items.push("orderedList");
        if (document.queryCommandState("insertUnorderedList")) items.push("unorderedList");
        if (document.queryCommandState("justifyCenter")) items.push("justifyCenter");
        if (document.queryCommandState("justifyFull")) items.push("justifyFull");
        if (document.queryCommandState("justifyLeft")) items.push("justifyLeft");
        if (document.queryCommandState("justifyRight")) items.push("justifyRight");
        if (document.queryCommandState("insertHorizontalRule")) items.push("horizontalRule");

        var fontName = document.queryCommandValue("fontName");
        if (fontName) {
            fontName = fontName.replace(/['"]/g, "");
            items.push("fontName:" + fontName);
        }

        var formatBlock = document.queryCommandValue("formatBlock");
        if (formatBlock && formatBlock.length > 0) items.push(formatBlock);
    } catch (e) {}

    var payload = items.join(",");
    if (payload === RE.lastStatePayload) return;
    RE.lastStatePayload = payload;

    if (window.REBridge && typeof window.REBridge.stateCheck === "function") {
        try {
            window.REBridge.stateCheck(payload);
            return;
        } catch (e) {}
    }

    window.location.href = RE.STATE_SCHEME + RE.encode(payload);
};

RE.scheduleEnabledEditingItems = function (delay) {
    if (RE.stateTimer) clearTimeout(RE.stateTimer);
    RE.stateTimer = setTimeout(function () {
        RE.stateTimer = null;
        RE.enabledEditingItems();
    }, typeof delay === "number" ? delay : 40);
};

RE.insertTable = function (rows, cols) {
    RE.restorerange();
    var tableHtml = '<table border="1" style="border-collapse: collapse; width: 100%;">';
    for (var i = 0; i < rows; i++) {
        tableHtml += "<tr>";
        for (var j = 0; j < cols; j++) {
            tableHtml += '<td style="padding: 8px; border: 1px solid #000;">&nbsp;</td>';
        }
        tableHtml += "</tr>";
    }
    tableHtml += "</table><p><br></p>";
    RE.insertHTML(tableHtml);
};

RE.insertTableRowAbove = function () {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var row = cell.parentElement;
    var newRow = row.cloneNode(true);
    var cells = newRow.getElementsByTagName("td");
    for (var i = 0; i < cells.length; i++) {
        cells[i].innerHTML = "&nbsp;";
    }
    row.parentElement.insertBefore(newRow, row);
    RE.schedulePaginateAndCallback();
    return true;
};

RE.insertTableRowBelow = function () {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var row = cell.parentElement;
    var newRow = row.cloneNode(true);
    var cells = newRow.getElementsByTagName("td");
    for (var i = 0; i < cells.length; i++) {
        cells[i].innerHTML = "&nbsp;";
    }
    row.parentElement.insertBefore(newRow, row.nextSibling);
    RE.schedulePaginateAndCallback();
    return true;
};

RE.insertTableColumnLeft = function () {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var cellIndex = cell.cellIndex;
    var table = RE.getParentTable(cell);
    var rows = table.getElementsByTagName("tr");

    for (var i = 0; i < rows.length; i++) {
        var newCell = document.createElement("td");
        newCell.innerHTML = "&nbsp;";
        newCell.style.padding = "8px";
        newCell.style.border = "1px solid #000";
        rows[i].insertBefore(newCell, rows[i].cells[cellIndex]);
    }
    RE.schedulePaginateAndCallback();
    return true;
};

RE.insertTableColumnRight = function () {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var cellIndex = cell.cellIndex;
    var table = RE.getParentTable(cell);
    var rows = table.getElementsByTagName("tr");

    for (var i = 0; i < rows.length; i++) {
        var newCell = document.createElement("td");
        newCell.innerHTML = "&nbsp;";
        newCell.style.padding = "8px";
        newCell.style.border = "1px solid #000";
        rows[i].insertBefore(newCell, rows[i].cells[cellIndex].nextSibling);
    }
    RE.schedulePaginateAndCallback();
    return true;
};

RE.deleteTableRow = function () {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var row = cell.parentElement;
    var table = RE.getParentTable(cell);

    if (table.rows.length === 1) {
        table.parentElement.removeChild(table);
    } else {
        row.parentElement.removeChild(row);
    }
    RE.schedulePaginateAndCallback();
    return true;
};

RE.deleteTableColumn = function () {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var cellIndex = cell.cellIndex;
    var table = RE.getParentTable(cell);
    var rows = table.getElementsByTagName("tr");

    if (rows[0].cells.length === 1) {
        table.parentElement.removeChild(table);
        RE.schedulePaginateAndCallback();
        return true;
    }

    for (var i = 0; i < rows.length; i++) {
        rows[i].deleteCell(cellIndex);
    }
    RE.schedulePaginateAndCallback();
    return true;
};

RE.setTableCellBackgroundColor = function (color) {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;
    cell.style.backgroundColor = color;
    return true;
};

RE.setTableCellBorderColor = function (color) {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;
    cell.style.borderColor = color;
    return true;
};

RE.setTableCellBorderWidth = function (width) {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;
    cell.style.borderWidth = width + "px";
    return true;
};

RE.setTableCellAlign = function (align) {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;
    cell.style.textAlign = align;
    return true;
};

RE.setTableCellVerticalAlign = function (align) {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;
    cell.style.verticalAlign = align;
    return true;
};

RE.setTableRowBackgroundColor = function (color) {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var row = cell.parentElement;
    var cells = row.getElementsByTagName("td");
    for (var i = 0; i < cells.length; i++) {
        cells[i].style.backgroundColor = color;
    }
    return true;
};

RE.setTableRowAlign = function (align) {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var row = cell.parentElement;
    var cells = row.getElementsByTagName("td");
    for (var i = 0; i < cells.length; i++) {
        cells[i].style.textAlign = align;
    }
    return true;
};

RE.setTableColumnBackgroundColor = function (color) {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var cellIndex = cell.cellIndex;
    var table = RE.getParentTable(cell);
    var rows = table.getElementsByTagName("tr");

    for (var i = 0; i < rows.length; i++) {
        rows[i].cells[cellIndex].style.backgroundColor = color;
    }
    return true;
};

RE.setTableColumnAlign = function (align) {
    var cell = RE.getSelectedTableCell();
    if (!cell) return false;

    var cellIndex = cell.cellIndex;
    var table = RE.getParentTable(cell);
    var rows = table.getElementsByTagName("tr");

    for (var i = 0; i < rows.length; i++) {
        rows[i].cells[cellIndex].style.textAlign = align;
    }
    return true;
};

RE.getSelectedTableCell = function () {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    var node = selection.getRangeAt(0).startContainer;
    while (node && node.nodeName !== "TD" && node.nodeName !== "TH") {
        node = node.parentElement;
    }
    return node;
};

RE.getParentTable = function (element) {
    while (element && element.nodeName !== "TABLE") {
        element = element.parentElement;
    }
    return element;
};

RE.isInsideTable = function () {
    return RE.getSelectedTableCell() !== null;
};

RE.setImageWidth = function (widthPx) {
    if (RE.activeResizeWrapper) {
        RE.activeResizeWrapper.style.width = widthPx + "px";
        RE.invalidateHtmlCache();
        RE.markDirtyFromPreviousPage(RE.activeResizeWrapper);
        RE.schedulePaginateAndCallback();
    }
};

RE.hasSelection = function () {
    var sel = window.getSelection();
    return sel && sel.rangeCount > 0 && sel.toString().length > 0;
};

RE.selectAll = function () {
    RE.ensureAtLeastOnePage();

    var pages = RE.getPageContents();
    if (!pages.length) return;

    var firstPage = pages[0];
    var lastPage = pages[pages.length - 1];

    if (!firstPage || !lastPage) return;

    RE.expandingSelection = true;

    try {
        try {
            firstPage.focus({ preventScroll: true });
        } catch (e1) {
            try {
                firstPage.focus();
            } catch (e2) {}
        }

        var selection = window.getSelection();
        if (!selection) return;

        selection.removeAllRanges();

        try {
            if (selection.setBaseAndExtent) {
                selection.setBaseAndExtent(
                    firstPage,
                    0,
                    lastPage,
                    lastPage.childNodes.length
                );
            } else {
                var range = document.createRange();
                range.setStart(firstPage, 0);
                range.setEnd(lastPage, lastPage.childNodes.length);
                selection.addRange(range);
            }
        } catch (e3) {
            var fallbackRange = document.createRange();
            fallbackRange.setStart(firstPage, 0);
            fallbackRange.setEnd(lastPage, lastPage.childNodes.length);

            selection.removeAllRanges();
            selection.addRange(fallbackRange);
        }

        RE.backuprange();
        RE.scheduleEnabledEditingItems(0);
    } finally {
        setTimeout(function () {
            RE.expandingSelection = false;
        }, 120);
    }
};

RE.isWholePageSelected = function (range, page) {
    if (!range || !page) return false;

    if (!page.contains(range.startContainer) || !page.contains(range.endContainer)) {
        return false;
    }

    var totalLength = RE.unitLength(page);
    if (totalLength <= 0) return false;

    var startOffset = RE.getUnitOffsetInRoot(page, range.startContainer, range.startOffset);
    var endOffset = RE.getUnitOffsetInRoot(page, range.endContainer, range.endOffset);

    if (startOffset < 0) startOffset = 0;
    if (endOffset < 0) endOffset = 0;

    return startOffset <= 0 && endOffset >= totalLength;
};

RE.expandNativePageSelectAll = function (sel) {
    if (!sel || sel.rangeCount === 0) return;
    if (RE.getPageContents().length < 2) return;
    if (RE.expandingSelection) return;

    var range = sel.getRangeAt(0);

    // A collapsed caret can never satisfy "the whole page is selected"
    // (isWholePageSelected already requires the page to be non-empty), so
    // bail out before the expensive full-page unitLength() walk below. This
    // is the common case on every keystroke/caret-move in a multi-page
    // document, so skipping it here matters a lot for typing performance.
    if (range.collapsed) return;

    if (RE.isSelectionAcrossMultiplePages(range)) {
        RE.backuprange();
        return;
    }

    var page = RE.closestPageContent(range.startContainer);
    if (!page) return;

    if (!RE.isWholePageSelected(range, page)) return;

    RE.selectAll();
};

RE.setDirection = function (direction) {
    RE.restorerange();
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    var range = selection.getRangeAt(0);
    var el = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ?
        range.commonAncestorContainer :
        range.commonAncestorContainer.parentElement;
    var page = RE.closestPageContent(el);

    while (el && el !== page) {
        var display = window.getComputedStyle(el).display;
        if (display === "block" || /^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/i.test(el.tagName)) break;
        el = el.parentElement;
    }

    if (!el || el === page) {
        document.execCommand("formatBlock", false, "<p>");
        selection = window.getSelection();
        if (selection.rangeCount > 0) {
            el = selection.getRangeAt(0).startContainer;
            el = el.nodeType === Node.ELEMENT_NODE ? el : el.parentElement;
        }
    }

    if (el) {
        el.style.direction = direction;
        el.style.textAlign = direction === "rtl" ? "right" : "left";
    }
    RE.afterCommand();
};

RE.setFontName = function (fontName) {
    fontName = RE.normalizeFontName(fontName);
    if (!fontName) return;

    if (RE.selectionIsAcrossPages || RE.selectionIsWholePage) {
        RE.restorerange();
        var saved = RE.saveSelectionOffsets();

        var sel = window.getSelection();
        var pages = RE.getPageContents();
        for (var i = 0; i < pages.length; i++) {
            var range = document.createRange();
            range.selectNodeContents(pages[i]);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand("fontName", false, fontName);
        }

        if (saved) {
            RE.restoreSelectionOffsets(saved);
        } else {
            RE.selectAll();
        }
        RE.backuprange();
        RE.markDirtyFromPage(0);
        RE.schedulePaginateAndCallback();
        setTimeout(RE.enabledEditingItems, 60);
        return;
    }

    RE.applyInlineStyleToSelection(
        { fontFamily: fontName },
        "fontName",
        fontName
    );
};

RE.setDarkMode = function (enabled) {
    if (enabled) {
        document.body.classList.add("dark-mode");
    } else {
        document.body.classList.remove("dark-mode");
    }
};

RE.watchPendingImages = function () {
    var images = RE.container.querySelectorAll("img[data-re-needs-load-pagination]");

    for (var i = 0; i < images.length; i++) {
        (function (img) {
            if (img.getAttribute("data-re-load-watched") === "true") return;
            img.setAttribute("data-re-load-watched", "true");

            function repaginateImage() {
                img.removeAttribute("data-re-needs-load-pagination");
                img.removeAttribute("data-re-load-watched");
                RE.markDirtyFromPreviousPage(img);
                RE.schedulePaginateAndCallback();
            }

            if (img.complete && img.naturalWidth > 0) {
                setTimeout(repaginateImage, 0);
                return;
            }

            img.addEventListener("load", repaginateImage, { once: true });
            img.addEventListener("error", function () {
                img.removeAttribute("data-re-needs-load-pagination");
                img.removeAttribute("data-re-load-watched");
            }, { once: true });
        })(images[i]);
    }
};

RE.isCaretAtPageEnd = function () {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;

    var range = sel.getRangeAt(0);
    var page = RE.closestPageContent(range.startContainer);
    if (!page) return false;
    if (RE.isOverflow(page)) return true;

    var caret = range.cloneRange();
    caret.collapse(true);
    var rect = caret.getClientRects().length ? caret.getClientRects()[0] : null;
    var pageRect = page.getBoundingClientRect();

    return !!rect && rect.bottom >= pageRect.bottom - 12;
};

RE.isAtPageEnd = RE.isCaretAtPageEnd;
RE.forcePaginate = RE.paginate;

RE.activeResizeWrapper = null;
RE.resizeStartX = 0;
RE.resizeStartY = 0;
RE.resizeStartW = 0;
RE.resizeStartH = 0;
RE.resizeHandle = null;
RE.resizeImg = null;
RE.resizeAspect = 1;
RE.isResizing = false;

RE.clearImageResize = function () {
    if (RE.activeResizeWrapper) {
        var img = RE.activeResizeWrapper.querySelector("img");
        if (img) {
            var w = RE.activeResizeWrapper.offsetWidth;
            img.style.width = w + "px";
            img.style.height = "auto";
            if (RE.activeResizeWrapper.parentNode) {
                RE.activeResizeWrapper.parentNode.replaceChild(img, RE.activeResizeWrapper);
            }
        }
        RE.activeResizeWrapper = null;
    }
    RE.invalidateHtmlCache();
};

RE.showImageResizeHandles = function (img) {
    if (RE.activeResizeWrapper && RE.activeResizeWrapper.contains(img)) return;



    var existingWrapper = null;
    if (img.closest) {
        existingWrapper = img.closest(".re-img-resize-wrapper");
    } else if (img.parentNode && img.parentNode.classList && img.parentNode.classList.contains("re-img-resize-wrapper")) {
        existingWrapper = img.parentNode;
    }


    if (existingWrapper && existingWrapper.parentNode) {
        existingWrapper.parentNode.replaceChild(img, existingWrapper);
    }


    RE.clearImageResize();

    var wrapper = document.createElement("div");
    wrapper.className = "re-img-resize-wrapper";
    wrapper.style.width = img.offsetWidth + "px";

    var parent = img.parentNode;
    parent.insertBefore(wrapper, img);
    wrapper.appendChild(img);

    img.style.width = "100%";
    img.style.height = "auto";

    var positions = ["tl", "tr", "bl", "br"];
    for (var i = 0; i < positions.length; i++) {
        var handle = document.createElement("div");
        handle.className = "re-img-resize-handle re-img-resize-handle-" + positions[i];
        handle.setAttribute("data-handle", positions[i]);
        wrapper.appendChild(handle);
    }

    RE.activeResizeWrapper = wrapper;
    RE.invalidateHtmlCache();
};

RE.onImageResizeStart = function (e) {
    var handle = e.target;
    if (!handle.classList || !handle.classList.contains("re-img-resize-handle")) return;

    e.preventDefault();
    e.stopPropagation();

    var wrapper = handle.parentElement;
    if (!wrapper) return;

    var img = wrapper.querySelector("img");
    if (!img) return;

    RE.isResizing = true;
    RE.resizeHandle = handle;
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    RE.resizeStartX = clientX;
    RE.resizeStartY = clientY;
    RE.resizeStartW = wrapper.offsetWidth;
    RE.resizeStartH = wrapper.offsetHeight;
    RE.resizeImg = img;
    RE.resizeAspect = RE.resizeStartW / (img.offsetHeight || 1);

    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
};

RE.onImageResizeMove = function (e) {
    if (!RE.isResizing || !RE.resizeHandle) return;
    e.preventDefault();

    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    var dx = clientX - RE.resizeStartX;
    var dy = clientY - RE.resizeStartY;
    var handlePos = RE.resizeHandle.getAttribute("data-handle");

    var newW = RE.resizeStartW;

    if (handlePos === "br") {
        newW = RE.resizeStartW + dx;
    } else if (handlePos === "bl") {
        newW = RE.resizeStartW - dx;
    } else if (handlePos === "tr") {
        newW = RE.resizeStartW + dx;
    } else if (handlePos === "tl") {
        newW = RE.resizeStartW - dx;
    }

    if (newW < 40) newW = 40;
    var maxW = RE.activeResizeWrapper ? RE.activeResizeWrapper.parentElement.clientWidth : 800;
    if (newW > maxW) newW = maxW;

    if (RE.activeResizeWrapper) {
        RE.activeResizeWrapper.style.width = newW + "px";
    }
};

RE.onImageResizeEnd = function (e) {
    if (!RE.isResizing) return;
    RE.isResizing = false;
    var wrapper = RE.activeResizeWrapper;
    RE.resizeHandle = null;
    RE.resizeImg = null;
    RE.invalidateHtmlCache();
    RE.markDirtyFromPreviousPage(wrapper);
    RE.schedulePaginateAndCallback();
};

document.addEventListener("mousedown", function (e) {
    if (e.target.classList && e.target.classList.contains("re-img-resize-handle")) {
        RE.onImageResizeStart(e);
        return;
    }

    if (e.target.tagName === "IMG" && RE.isEditorNode(e.target)) {
        setTimeout(function () { RE.showImageResizeHandles(e.target); }, 10);
        return;
    }

    if (RE.activeResizeWrapper &&
        !RE.activeResizeWrapper.contains(e.target)) {
        RE.clearImageResize();
    }
}, true);

document.addEventListener("touchstart", function (e) {
    if (e.target.classList && e.target.classList.contains("re-img-resize-handle")) {
        RE.onImageResizeStart(e);
        return;
    }

    if (e.target.tagName === "IMG" && RE.isEditorNode(e.target)) {
        setTimeout(function () { RE.showImageResizeHandles(e.target); }, 10);
        return;
    }

    if (RE.activeResizeWrapper &&
        !RE.activeResizeWrapper.contains(e.target)) {
        RE.clearImageResize();
    }
}, true);

document.addEventListener("mousemove", function (e) {
    RE.onImageResizeMove(e);
}, true);

document.addEventListener("touchmove", function (e) {
    if (RE.isResizing) RE.onImageResizeMove(e);
}, { passive: false, capture: true });

document.addEventListener("mouseup", function (e) {
    RE.onImageResizeEnd(e);
}, true);

document.addEventListener("touchend", function (e) {
    RE.onImageResizeEnd(e);
}, true);

document.addEventListener("selectionchange", function () {
    var sel = window.getSelection();
    RE.selectionIsWholePage = false;
    RE.selectionIsAcrossPages = false;
    if (sel && sel.rangeCount > 0 && RE.isEditorNode(sel.getRangeAt(0).startContainer)) {
        RE.tryExpandNativePageSelectAll();
        RE.backuprange();

        var range = sel.getRangeAt(0);
        if (RE.isSelectionAcrossMultiplePages(range)) {
            RE.selectionIsAcrossPages = true;
        } else {
            var page = RE.closestPageContent(range.startContainer);
            if (page && RE.isWholePageSelected(range, page)) {
                RE.selectionIsWholePage = true;
            }
        }
    }
});

RE.container.addEventListener("compositionstart", function () {
    RE.composing = true;
});

RE.container.addEventListener("compositionend", function (e) {
    RE.composing = false;
    RE.markDirtyFromPage(RE.pageIndexOfNode(e.target));
    RE.schedulePaginateAndCallback();
});

RE.container.addEventListener("input", function (e) {
    if (!RE.isEditorNode(e.target)) return;
    RE.invalidateHtmlCache();
    RE.markDirtyFromPage(RE.pageIndexOfNode(e.target));
    RE.schedulePaginateAndCallback();
});

RE.container.addEventListener("keydown", function (e) {
    if (!RE.isEditorNode(e.target)) return;

    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A" || e.keyCode === 65)) {
        e.preventDefault();
        RE.selectAll();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z" || e.keyCode === 90)) {
        e.preventDefault();
        RE.undo();
        return;
    }

    if (
        ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y" || e.keyCode === 89)) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "z" || e.key === "Z" || e.keyCode === 90))
    ) {
        e.preventDefault();
        RE.redo();
        return;
    }

    // Plain Enter: force document.execCommand("insertParagraph") instead of
    // relying on the browser's default handling, which can insert a bare
    // <div> rather than a <p>. Those stray <div>s are exactly what left
    // mismatched blocks for normalizePage to clean up later and showed up
    // as extra/misplaced line breaks once the page reflowed. Shift+Enter
    // (line break within the same paragraph) is left to default behavior.
    if (
        (e.key === "Enter" || e.keyCode === 13) &&
        !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
    ) {
        e.preventDefault();
        RE.markDirtyFromSelection();
        try {
            if (!document.execCommand("insertParagraph")) {
                document.execCommand("insertHTML", false, "<p><br></p>");
            }
        } catch (err) {
            try {
                document.execCommand("insertHTML", false, "<p><br></p>");
            } catch (err2) {}
        }
        setTimeout(RE.schedulePaginateAndCallback, 80);
        return;
    }

    // Backspace at the very start of a page: merge it into the previous
    // page and let a real delete happen at the seam (see
    // mergeCurrentPageIntoPrevious for why this can't just be left to the
    // browser).
    if (e.key === "Backspace" || e.keyCode === 8) {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && sel.getRangeAt(0).collapsed) {
            var range = sel.getRangeAt(0);
            var pageContent = RE.closestPageContent(range.startContainer);
            var pageIndex = RE.pageIndexOfNode(range.startContainer);

            if (pageContent && typeof pageIndex === "number" && pageIndex > 0 &&
                RE.isCaretAtPageStart(pageContent, range)) {
                e.preventDefault();
                RE.mergeCurrentPageIntoPrevious(pageContent);
                setTimeout(RE.enabledEditingItems, 60);
                return;
            }
        }
    }

    if (
        e.key === "Enter" || e.keyCode === 13 ||
        e.key === "Backspace" || e.keyCode === 8 ||
        e.key === "Delete" || e.keyCode === 46
    ) {
        RE.markDirtyFromPage(RE.pageIndexOfNode(e.target));
        setTimeout(RE.schedulePaginateAndCallback, 80);
    }
});

RE.container.addEventListener("paste", handlePaste);

RE.container.addEventListener("keyup", function (e) {
    if (!RE.isEditorNode(e.target)) return;
    RE.scheduleEnabledEditingItems();
});

RE.container.addEventListener("click", function (e) {
    if (!RE.isEditorNode(e.target)) return;
    RE.scheduleEnabledEditingItems();
});

RE.container.addEventListener("mouseup", function (e) {
    if (!RE.isEditorNode(e.target)) return;

    RE.backuprange();
    RE.scheduleEnabledEditingItems();
    RE.scheduleExpandNativePageSelectAll();
});

RE.container.addEventListener("touchend", function (e) {
    if (!RE.isEditorNode(e.target)) return;

    setTimeout(function () {
        RE.backuprange();
        RE.scheduleEnabledEditingItems();
        RE.scheduleExpandNativePageSelectAll();
    }, 0);
});

document.addEventListener("DOMContentLoaded", function () {
    RE.ensureAtLeastOnePage();
    RE.paginate();
    RE.resetHistory();
});

if (document.readyState === "interactive" || document.readyState === "complete") {
    setTimeout(function () {
        RE.ensureAtLeastOnePage();
        RE.paginate();
        RE.resetHistory();
    }, 0);
}


function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function plainTextToHtml(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var html = [];
    var paragraph = [];

    function flushParagraph() {
        if (!paragraph.length) {
            html.push("<p><br></p>");
        } else {
            html.push("<p>" + paragraph.join("<br>") + "</p>");
        }
        paragraph = [];
    }

    for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "") {
            flushParagraph();
        } else {
            paragraph.push(escapeHtml(lines[i]));
        }
    }

    if (paragraph.length || !html.length) flushParagraph();
    return html.join("");
}

function cleanStyleAttribute(el) {
    var allowed = [
        "font-weight",
        "font-style",
        "text-decoration",
        "color",
        "background-color",
        "font-size",
        "font-family",
        "direction",
        "text-align"
    ];
    var style = el.getAttribute("style");
    var cleaned = [];

    if (!style) return;

    var rules = style.split(";");
    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        var index = rule.indexOf(":");
        if (index === -1) continue;

        var name = rule.slice(0, index).trim().toLowerCase();
        var value = rule.slice(index + 1).trim();

        if (allowed.indexOf(name) === -1) continue;
        if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) continue;

        cleaned.push(name + ":" + value);
    }

    if (cleaned.length) {
        el.setAttribute("style", cleaned.join(";"));
    } else {
        el.removeAttribute("style");
    }
}

function cleanPaste(node) {
    var allowed = {
        B: true,
        STRONG: true,
        I: true,
        EM: true,
        U: true,
        SPAN: true,
        BR: true,
        DIV: true,
        P: true,
        UL: true,
        OL: true,
        LI: true,
        BLOCKQUOTE: true,
        IMG: true,
        TABLE: true,
        TBODY: true,
        THEAD: true,
        TFOOT: true,
        TR: true,
        TD: true,
        TH: true
    };

    var children = Array.prototype.slice.call(node.children || []);
    for (var i = 0; i < children.length; i++) {
        var el = children[i];

        cleanPaste(el);

        if (!allowed[el.tagName]) {
            while (el.firstChild) {
                el.parentNode.insertBefore(el.firstChild, el);
            }
            el.parentNode.removeChild(el);
            continue;
        }

        for (var a = el.attributes.length - 1; a >= 0; a--) {
            var attrName = el.attributes[a].name.toLowerCase();
            if (attrName !== "style" && attrName !== "src" && attrName !== "alt" && attrName !== "colspan" && attrName !== "rowspan") {
                el.removeAttribute(el.attributes[a].name);
            }
        }

        cleanStyleAttribute(el);

        if (el.tagName === "IMG") {
            var src = el.getAttribute("src") || "";
            if (!/^(data:image\/|file:|content:|https?:)/i.test(src)) {
                el.parentNode.removeChild(el);
            } else {
                el.style.maxWidth = "100%";
                el.style.height = "auto";
                el.setAttribute("data-re-needs-load-pagination", "true");
            }
        }
    }
}

function handlePaste(e) {
    if (!RE.isEditorNode(e.target)) return;

    e.preventDefault();
    RE.restorerange();

    var data = e.clipboardData || window.clipboardData;
    var html = data ? data.getData("text/html") : "";
    var text = data ? data.getData("text/plain") : "";

    if (html) {
        var div = document.createElement("div");
        div.innerHTML = html;
        cleanPaste(div);
        document.execCommand("insertHTML", false, div.innerHTML || plainTextToHtml(text));
    } else {
        document.execCommand("insertHTML", false, plainTextToHtml(text));
    }

    RE.watchPendingImages();
    RE.afterCommand();
}

(function () {
    var viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!viewportMeta) return;

    var defaultContent = viewportMeta.getAttribute('content');
    var lockedContent  = 'width=980, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';

    RE.container.addEventListener('focusin', function (e) {
        if (e.target.closest && e.target.closest('.re-page-content')) {
            viewportMeta.setAttribute('content', lockedContent);
        }
    });

    RE.container.addEventListener('focusout', function (e) {
        if (e.target.closest && e.target.closest('.re-page-content')) {
            setTimeout(function () {
                var active = document.activeElement;
                if (!active || !active.closest || !active.closest('.re-page-content')) {
                    viewportMeta.setAttribute('content', defaultContent);
                }
            }, 50);
        }
    });
})();

