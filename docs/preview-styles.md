# Preview styles and PDF output

Use **Preview style** in the editor toolbar to choose Asciidoctor, Git Docs, or
Space Cubics. Selection changes only your view and is remembered in your
browser across documents. Other collaborators can choose different styles;
the source, undo history, document URL, and `.adoc` export stay unchanged.
Storage-disabled browsers can still select a style for their open tab.

Asciidoctor preserves the original preview’s untagged HTML language context
in preview and print, because adding `lang` can change Japanese font fallback.
Additional styles propagate the document’s language.
Asciidoctor uses the original stylesheet’s font stacks and fallback behavior:
serif body text, sans-serif headings, and monospace code. Space Cubics adapts
sc-pdf-builder's body colors, spacing, tables, and code treatment.
Git Docs adapts the document area at <https://git-scm.com/docs/git-diff>,
including its declared Latin font stacks. Space Cubics and Git Docs explicitly name Japanese
sans-serif fallbacks before the generic family: IPAGothic, IPAexGothic,
Noto Sans CJK JP, Hiragino Kaku Gothic ProN, Yu Gothic, and Meiryo.
IPAGothic matched the original preview's Japanese glyphs in the inspected
Chromium environment. Fonts come from the device; none are downloaded.
Heading sizes use relative proportions rather than exact PDF point sizes.

## Add a style to your deployment

Each additional style is one CSS file in `app/src/preview/styles/`. The normal
Vite build discovers these files automatically; no TypeScript registration or
manifest is needed. Styles are sorted by filename after Asciidoctor.

```sh
cp app/src/preview/styles/git-docs.css app/src/preview/styles/company-guide.css
# Edit company-guide.css, then:
npm run build
npm start
```

The selector will include **Company Guide**. Use a lowercase hyphenated filename
starting with a letter (digits are allowed); `default.css` is reserved. Keep
the filename stable because it is the saved preference ID. Removing a file
and redeploying makes existing selections of that style fall back to Asciidoctor.
Keep the file in your deployment checkout/configuration, not in generated
`app/dist` output. Deploy the rebuilt assets using the existing
[Node](deployment-node.md) or [Cloudflare](deployment-cloudflare.md) workflow.

CSS files are imported as text and applied only in the preview and print
iframes, after the unchanged `app/src/preview/asciidoctor.css` baseline and
shared `app/src/preview/fonts.css` fallback rules. Those fallback rules apply
only to additional styles; selecting Asciidoctor clears them. Only
one additional stylesheet is active at a time. Use ordinary selectors; no
style-ID prefix is required, so copied samples work under another filename.
The shared font rules expose `--font-japanese`, `--font-prose`,
`--font-headings`, and `--font-code`; Git Docs demonstrates overriding the
Latin stacks while retaining the common Japanese fallback.

The iframe wrapper is `body.article > #content`. Asciidoctor supplies headings,
`.paragraph`, `.listingblock`, `.literalblock`, `.admonitionblock`,
`table.tableblock`, `.imageblock`, and `#toc`. Style `table.tableblock` rather
than every table, since admonitions and callout lists also use table markup.
Use `strong` for semantic bold and preserve source-defined heading text.
Source-anchor IDs are generated and must not be used as styling hooks.

Keep screen and `@media print` / `@page` rules in the same file. Use data URLs
for decorative images when necessary. Raw CSS imports do not rewrite relative
asset URLs, and the preview uses an `about:srcdoc` base for internal links.
External stylesheets (`@import`) are blocked by the preview CSP. No font
bundling, browser upload UI, or user-supplied scripts are involved.

For a first exercise, copy a sample, change `--accent` and heading margins,
rebuild, and compare the preview and print output. The fixture at
`e2e/fixtures/styles.adoc` covers prose, Japanese bold, lists, a description
list, tables, code, and all five admonitions.

## Print / Save as PDF

Click **Print / Save as PDF** to prepare a snapshot of the current source and
selected style, then open the browser print dialog. Choose its PDF destination
to save a file. This is not a silent PDF download API. Later edits and style
changes do not alter the snapshot being printed. Failed or timed-out image
loads show an error instead of silently printing an incomplete document.
Printing is disabled until the document first synchronizes. After that, it
remains available for local edits while offline.

For the sample styles use A4, 100% scale, background graphics enabled, and the
browser's own headers/footers disabled. Space Cubics specifies the builder's
18/16/20/18 mm body margins. Its CSS also requests page X/Y in the bottom-right
margin; rendering of page-margin boxes depends on the browser. Chromium is
the initial reference engine. Both samples print tables, code, and relative
heading hierarchy using the same styling as the preview, with print-specific
layout adjustments.

Cover pages, running chapter headers, and identical pagination to the Ruby
builder are not implemented. Different fonts and layout engines affect line
breaks and page counts. The supplied PDFs under `ai-context/` are local visual
references, not bundled assets. Full-document equivalence also requires
separate support for PDF-only extensions, mathematical rendering, and resource
handling. The first version targets similar body styling, not full PDF parity.

## Style provenance

- Space Cubics is adapted from `sc-pdf-builder/themes/sc-docs-theme.yml` at
  commit `9ec588495a878fa89ecc2a0897c26d834e8d6933`. Inline-code red is darker for
  small-text contrast, sizes are relative, and its font families are omitted.
- Git Docs is an original CSS adaptation of the rendered Git documentation
  page inspected on 2026-09-09. It does not copy the site's CSS or assets.
  Smaller headings (h3–h6) use a darker red for normal-text contrast.
  Body/headings declare `Adelle, "Roboto Slab", "DejaVu Serif", Georgia,
"Times New Roman", sans-serif`; code and definition terms use
  `Courier, monospace`. The shared Japanese fallback names are inserted before
  each generic family. No Git branding or navigation is included.
