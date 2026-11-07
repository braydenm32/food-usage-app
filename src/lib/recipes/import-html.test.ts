import { describe, expect, it } from "vitest";
import { ldJsonBlocks, MAX_HTML_CHARS, pageText, recipeFromHtml, stripTags } from "./import";

describe("HTML scanning stays fast on hostile pages", () => {
  const hostile = [
    "<nav>".repeat(100_000),
    "<script ".repeat(100_000),
    "<script>".repeat(100_000),
    `<script type="application/ld+json">`.repeat(50_000),
    "<p".repeat(100_000),
    "<".repeat(500_000),
    "<div class='a".repeat(50_000),
    "<style><nav><form>".repeat(50_000),
    "</".repeat(200_000),
    `${"<nav>".repeat(50_000)}</nav>`,
  ];

  it.each(hostile.map((h, i) => [i, h] as const))("input %i finishes quickly", (_, html) => {
    const start = performance.now();
    pageText(html);
    recipeFromHtml(html);
    ldJsonBlocks(html);
    stripTags(html);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("cuts very long pages before parsing", () => {
    const big = `${"x".repeat(MAX_HTML_CHARS)}<script type="application/ld+json">{"@type":"Recipe","name":"Late","recipeIngredient":["1 egg"]}</script>`;
    expect(recipeFromHtml(big)).toBeNull();
  });
});

describe("pageText", () => {
  it("drops scripts, styles and navigation and keeps lines", () => {
    const html = `<html><head><style>p{}</style><script>var x = "<p>no</p>";</script></head><body>
      <NAV><a>Home</a></NAV><header>Site</header>
      <h1>Pumpkin soup</h1><p>Serves 4 &amp; more</p><ul><li>1 kg pumpkin</li><li>1 L stock</li></ul>
      <footer>© 2026</footer></body></html>`;
    expect(pageText(html).split("\n")).toEqual(["Pumpkin soup", "Serves 4 & more", "1 kg pumpkin", "1 L stock"]);
  });

  it("folds newlines inside a paragraph", () => {
    expect(pageText("<p>Line one\nstill one</p><p>two</p>")).toBe("Line one still one\ntwo");
  });

  it("keeps text after a block that is never closed", () => {
    expect(pageText("<p>Before<nav>after</p>")).toBe("Before after");
  });
});

describe("ldJsonBlocks and stripTags", () => {
  it("finds ld+json blocks in any case and quoting", () => {
    const html = `<SCRIPT type=application/ld+json>{"a":1}</SCRIPT><script>skip()</script><script type='application/ld+json' id=x>[2]</script>`;
    expect(ldJsonBlocks(html)).toEqual(['{"a":1}', "[2]"]);
  });

  it("strips tags but leaves stray brackets", () => {
    expect(stripTags("a <b>bold</b> < c")).toBe("a  bold  < c");
    expect(stripTags("1 <> 2")).toBe("1 <> 2");
  });
});
