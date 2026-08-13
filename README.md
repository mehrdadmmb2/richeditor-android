# RichEditor for Android – Extended Edition

[![Android Arsenal](https://img.shields.io/badge/Android%20Arsenal-richeditor--android-brightgreen.svg?style=flat)](https://android-arsenal.com/details/1/1696)
[![License](https://img.shields.io/badge/license-Apache%202-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Download](https://api.bintray.com/packages/wasabeef/maven/richeditor-android/images/download.svg)](https://bintray.com/wasabeef/maven/richeditor-android/_latestVersion)

`RichEditor for Android` is a beautiful Rich Text `WYSIWYG Editor` for `Android`.

This **Extended Edition** adds powerful features including **automatic pagination**, **page margins & borders**, **advanced table operations**, **image resize handles**, **cross-page selection**, and much more – all implemented in the enhanced `rich_editor.js`.

- _Looking for iOS? Check out_ [cjwirth/RichEditorView](https://github.com/cjwirth/RichEditorView)

---

## Supported Functions

| Basic Formatting  | Paragraph & Lists | Colors & Sizes   | Page & Table               |
| ----------------- | ----------------- | ---------------- | -------------------------- |
| **Bold**          | Justify Left      | Text Color       | **Page Margins**           |
| **Italic**        | Justify Center    | Background Color | **Page Border**            |
| **Subscript**     | Justify Right     | Font Size        | **Page Direction**         |
| **Superscript**   | Blockquote        | **Font Name**    | **Automatic Pagination**   |
| **Strikethrough** | Heading 1–6       |                  | **Page Merge (Backspace)** |
| **Underline**     | Indent / Outdent  |                  | **Insert / Delete Table**  |
| **Undo / Redo**   | Unordered List    |                  | **Table Row / Column**     |
|                   | Ordered List      |                  | **Table Cell Styling**     |
|                   |                   |                  | **Image Resize Handles**   |

---

## ✨ New Features (Extended Edition)

### 📄 Pagination & Page Layout

Content is **automatically paginated** into separate `.re-page` containers. Page breaks occur at the optimal point to fit the available height, and pagination is **incremental** – typing on page 40 only repaginates from page 40 onward, making long documents extremely fast.

**Page Margins** – set individually for each side:

```javascript
editor.setPageMargins("72px", "96px", "72px", "96px");  // left, top, right, bottom
```

**Page Borders** – style, color, and width:

```javascript
editor.setPageBorder("solid", "#ff0000", 3);
editor.removePageBorder();
```

**Page Direction** – change the base writing direction:

```javascript
editor.setDir("rtl");   // or "ltr"
```

**Placeholder Text** – show a hint when the page is empty:

```javascript
editor.setPlaceholder("Write something…");
```

**Font Size (in points)** – applies to the current selection or entire page(s):

```javascript
editor.setFontSizePt(14);   // uses <span style="font-size:14pt">
```

**Font Name** – with built-in alias support (e.g., `IRANSANS`, `VAZIR`, `Shabnam`):

```javascript
editor.setFontName("IRANSANS");
```

**Background Image** – set a background image for all pages:

```javascript
editor.setBackgroundImage("url('https://example.com/bg.jpg')");
```

---

### 🧩 Cross-Page Selection & Global Styling

The editor intelligently detects when the selection **spans multiple pages** or covers an **entire page**. In these cases, formatting commands (bold, color, font size, font name, alignment, etc.) are automatically applied to **all selected pages** – perfect for styling an entire document section at once.

- `Ctrl+A` (or `Cmd+A`) selects **all content across all pages**.
- Formatting commands work seamlessly across page boundaries.

---

### 📊 Advanced Table Operations

A complete set of table manipulation tools is now available:

| Operation                   | Method                                        |
| --------------------------- | --------------------------------------------- |
| Insert table                | `editor.insertTable(rows, cols)`              |
| Insert row above            | `editor.insertTableRowAbove()`                |
| Insert row below            | `editor.insertTableRowBelow()`                |
| Insert column left          | `editor.insertTableColumnLeft()`              |
| Insert column right         | `editor.insertTableColumnRight()`             |
| Delete row                  | `editor.deleteTableRow()`                     |
| Delete column               | `editor.deleteTableColumn()`                  |
| Set cell background         | `editor.setTableCellBackgroundColor(color)`   |
| Set cell border color       | `editor.setTableCellBorderColor(color)`       |
| Set cell border width       | `editor.setTableCellBorderWidth(width)`       |
| Set cell text alignment     | `editor.setTableCellAlign("center")`          |
| Set cell vertical alignment | `editor.setTableCellVerticalAlign("middle")`  |
| Set row background          | `editor.setTableRowBackgroundColor(color)`    |
| Set row alignment           | `editor.setTableRowAlign("right")`            |
| Set column background       | `editor.setTableColumnBackgroundColor(color)` |
| Set column alignment        | `editor.setTableColumnAlign("center")`        |

These methods apply to the table cell that currently contains the cursor.

---

### 🖼️ Image Resize Handles

Clicking on any image inside the editor **displays resize handles** at its corners. Drag any handle to scale the image proportionally. The width is persisted in the HTML output.

- Resize handles appear automatically when an image is tapped/clicked.
- Resizing is live and triggers repagination so surrounding text reflows correctly.

---

### ↩️ Undo / Redo

The undo/redo system now uses **snapshots** of the entire paged HTML and selection state. Every keystroke or command is captured, and you can undo/redo across pagination boundaries.

- `Ctrl+Z` / `Cmd+Z` – Undo
- `Ctrl+Y` / `Cmd+Y` – Redo (or `Ctrl+Shift+Z` / `Cmd+Shift+Z`)

---

### 🧹 Clean Paste & Automatic Normalization

Pasted content is automatically **sanitized** – only safe HTML tags and attributes are preserved. The editor also normalizes the structure so that every block is a `<p>` and empty paragraphs become `<p><br></p>`, ensuring predictable pagination.

---

### 🛠️ Additional Utility Methods

| Method                                        | Description                              |
| --------------------------------------------- | ---------------------------------------- |
| `editor.getText()`                            | Returns plain text content of all pages  |
| `editor.setBaseTextColor(color)`              | Sets default text color for all pages    |
| `editor.setBaseFontSize(size)`                | Sets default font size for all pages     |
| `editor.setWidth(size)`                       | Sets the width of each page container    |
| `editor.setHeight(size)`                      | Sets the height of each page container   |
| `editor.setBackgroundColor(color)`            | Sets background color of the editor body |
| `editor.setPadding(left, top, right, bottom)` | Same as `setPageMargins`                 |
| `editor.setInputEnabled(boolean)`             | Enables/disables editing on all pages    |
| `editor.selectAll()`                          | Programmatically selects all content     |
| `editor.focus()`                              | Moves focus to the last page             |
| `editor.setDarkMode(boolean)`                 | Toggles dark-mode CSS class on the body  |

---

## How do I use it?

### Setup

```groovy
clone v2.0.0 branch
```

### Basic Editor Configuration (Java)

```java
RichEditor editor = (RichEditor) findViewById(R.id.editor);
editor.setEditorHeight(200);
editor.setEditorFontSize(22);
editor.setEditorFontColor(Color.RED);
editor.setPlaceholder("Write something…");

// Using extended features
editor.setPageMargins("72px", "96px", "72px", "96px");
editor.setPageBorder("solid", "#000000", 2);
editor.setDir("rtl");
```

### Calling JavaScript Methods Directly

All extended methods are exposed via the `RE` object in the JavaScript bridge. Call them from Android code using:

```java
editor.loadUrl("javascript:RE.insertTable(3, 4);");
editor.loadUrl("javascript:RE.setFontSizePt(16);");
editor.insertImage("https://example.com/photo.jpg", "My photo");
```

---

## Requirements

- Android 4.0+ (API level 14+)

---



## 🫶 Support This Project



If you find this project helpful and want to support its future development:

### ☕ Buy me a coffee (Crypto)

- **Tether (USDT, TRC20):** `TRzxqih3wSjPkb8EmrF7TzAvSquGhf1wwo`
- **ETH**: `0x43EC594eE36b9895E863DF234f7d393606537209` (✅)
- **Bitcoin (BTC):** `bc1qxk0h9rdpgnh7yyc59uxndkrr2ndjglwtv3z72j`

Or simply ⭐ **star this repo** — it helps a lot!





## Applications Using RichEditor for Android

Please [ping](mailto:dadadada.chop@gmail.com) me or send a pull request if you would like to be added here.

| Icon                                                         | Application                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| <img src="https://lh6.ggpht.com/6zKH_uQY1bxCwXL4DLo_uoFEOXdShi3BgmN6XRHlaJ-oA1svmq6y1PZkmO50nWQn2Lg=w300-rw" width="48" height="48" /> | [Ameba Ownd](https://play.google.com/store/apps/details?id=jp.co.cyberagent.madrid) |
| <img src="https://lh3.googleusercontent.com/st_DiIlM148vzG23ccujtBzx0tMeb7cDC5fDmLSERS-Nr8M_F-PTw4W_jWJsH9mO_b4=w300-rw" width="48" height="48" /> | [ScorePal](https://play.google.com/store/apps/details?id=com.hfd.scorepal) |

---

## Developed By

Daichi Furiya (Wasabeef) - <dadadada.chop@gmail.com>

<a href="https://twitter.com/wasabeef_jp">
<img alt="Follow me on Twitter"
src="https://raw.githubusercontent.com/wasabeef/art/master/twitter.png" width="75"/>
</a>

---

## Thanks

- Inspired by `ZSSRichTextEditor` from [nnhubbard](https://github.com/nnhubbard/ZSSRichTextEditor).

---

## License

    Copyright 2017 Wasabeef
    
    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at
    
       http://www.apache.org/licenses/LICENSE-2.0
    
    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
