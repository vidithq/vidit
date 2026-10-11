import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { htmlText, proofHasImage, renderProof } from "./proof";

function renderHtml(html: string | null, gateImages?: boolean) {
  return render(<div>{renderProof(html, { gateImages })}</div>).container;
}

describe("renderProof", () => {
  it("renders nothing for a missing or empty body", () => {
    expect(renderProof(null)).toBeNull();
    expect(renderProof("")).toBeNull();
  });

  it("renders paragraphs with their marks", () => {
    const container = renderHtml(
      "<p><strong>bold</strong><em>italic</em><s>struck</s><code>mono</code></p>",
    );
    expect(container.querySelector("p strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
    expect(container.querySelector("s")).toHaveTextContent("struck");
    expect(container.querySelector("code")).toHaveTextContent("mono");
    expect(container.querySelector("code")).toHaveClass("text-orange-300");
  });

  it("opens a safe link in a new tab with the user-content rel", () => {
    const container = renderHtml('<p><a href="https://example.com/post">source</a></p>');
    const a = container.querySelector("a");
    expect(a).toHaveAttribute("href", "https://example.com/post");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
  });

  it("drops the attributes a stored link carries besides href", () => {
    const container = renderHtml(
      '<p><a href="https://example.com/" target="_self" onclick="alert(1)" class="x">s</a></p>',
    );
    const a = container.querySelector("a")!;
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).not.toHaveAttribute("onclick");
    expect(a).not.toHaveClass("x");
  });

  it.each([
    ["no href", "<a>orphan</a>"],
    ["a javascript: href", '<a href="javascript:alert(1)">orphan</a>'],
    ["a data: href", '<a href="data:text/html,&lt;script&gt;">orphan</a>'],
    ["a relative href", '<a href="/x">orphan</a>'],
    ["a mailto: href", '<a href="mailto:a@b.c">orphan</a>'],
  ])("renders the text of a link with %s, without the anchor", (_, link) => {
    const container = renderHtml(`<p>${link}</p>`);
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("orphan");
  });

  it("renders h2 and h3, and only the text of other headings", () => {
    const container = renderHtml("<h1>one</h1><h2>two</h2><h3>three</h3><h4>four</h4>");
    expect(container.querySelector("h2")).toHaveTextContent("two");
    expect(container.querySelector("h3")).toHaveTextContent("three");
    expect(container.querySelector("h1, h4")).toBeNull();
    expect(container).toHaveTextContent("one");
    expect(container).toHaveTextContent("four");
  });

  it("renders lists, quotes, code blocks, rules and line breaks", () => {
    const container = renderHtml(
      "<ul><li><p>li</p></li></ul><ol><li>first</li></ol><blockquote>quoted</blockquote>" +
        "<pre><code>const a = 1;\nb</code></pre><hr><p>line<br>break</p>",
    );
    expect(container.querySelector("ul li")).toHaveTextContent("li");
    expect(container.querySelector("ol li")).toHaveTextContent("first");
    expect(container.querySelector("blockquote")).toHaveTextContent("quoted");
    expect(container.querySelector("pre code")).toHaveTextContent("const a = 1;");
    expect(container.querySelector("pre code")).not.toHaveClass("text-orange-300");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("p br")).not.toBeNull();
  });

  it("renders only the text of a tag outside the allowlist", () => {
    const container = renderHtml(
      '<div><span style="color:red">safe</span><iframe src="https://evil.com"></iframe></div>',
    );
    expect(container.firstElementChild!.innerHTML).toBe("safe");
  });

  it("renders an image with lazy loading and no-referrer, skipping one without a src", () => {
    const container = renderHtml('<img src="/media/proof/p.jpg" alt="ruins"><img>');
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute("src", "/media/proof/p.jpg");
    expect(imgs[0]).toHaveAttribute("alt", "ruins");
    expect(imgs[0]).toHaveAttribute("loading", "lazy");
    expect(imgs[0]).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("lifts an image out of paragraph markup", () => {
    const container = renderHtml('<p>see <img src="/media/proof/p.jpg"></p>');
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("div img")).not.toBeNull();
  });

  it("puts a graphic proof's images behind the age gate", () => {
    renderHtml('<img src="/media/proof/p.jpg">', true);
    expect(screen.getByRole("button", { name: /show/i })).toBeInTheDocument();
  });

  it("renders any https:// image src when no media host is pinned", () => {
    const container = renderHtml('<img src="https://d10w3bld05vsky.cloudfront.net/p.jpg">');
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("renders the http://localhost dev-storage image src", () => {
    const container = renderHtml('<img src="http://localhost:8000/local-storage/p.jpg">');
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it.each([
    ["a javascript: src", "javascript:alert(1)"],
    ["a data: src", "data:image/svg+xml,&lt;svg onload=alert(1)&gt;"],
    ["a protocol-relative (//host) src", "//attacker.example/pixel.gif"],
    ["a backslash protocol-relative (/\\host) src", "/\\attacker.example/pixel.gif"],
    ["a tab-obfuscated protocol-relative src", "/\t/attacker.example/pixel.gif"],
    ["a placeholder:// src", "placeholder://shot.jpg"],
  ])("drops an image with %s", (_, src) => {
    expect(renderHtml(`<img src="${src}">`).querySelectorAll("img")).toHaveLength(0);
  });
});

describe("image host pinning (NEXT_PUBLIC_MEDIA_HOST)", () => {
  // The build's media host is the client's copy of the backend CDN pin
  // (`sanitize._safe_image_src`): a foreign https host is a tracking pixel, not evidence.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_HOST", "cdn.example.net");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders an image served by the pinned host", () => {
    const container = renderHtml('<img src="https://cdn.example.net/proof/p.jpg">');
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("drops an image served by any other https host", () => {
    const container = renderHtml('<img src="https://attacker.example/pixel.gif">');
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("still renders a relative src", () => {
    const container = renderHtml('<img src="/media/proof/p.jpg">');
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("drops the local-storage dev src, which a pinned build never mints", () => {
    const container = renderHtml('<img src="http://localhost:8000/local-storage/p.jpg">');
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("proofHasImage", () => {
  it("is false for a missing or text-only proof", () => {
    expect(proofHasImage(null)).toBe(false);
    expect(proofHasImage("<p>just words</p>")).toBe(false);
  });

  it("is true for a top-level image", () => {
    expect(proofHasImage('<p>see:</p><img src="https://x/y.jpg">')).toBe(true);
  });

  it("is false for an image carrying no src", () => {
    // The server counts srcs, not tags (`sanitize.extract_image_srcs`), so a srcless image must
    // not clear the proof-image floor.
    expect(proofHasImage("<img>")).toBe(false);
  });

  it("counts a placeholder src, which is an image about to upload", () => {
    expect(proofHasImage('<img src="placeholder://shot.jpg">')).toBe(true);
  });

  it("finds an image nested inside another tag", () => {
    expect(proofHasImage('<blockquote><img src="https://x/y.jpg"></blockquote>')).toBe(true);
  });

  it("ignores an img tag spelled out as text", () => {
    expect(proofHasImage("<p>&lt;img src=&quot;https://x/y.jpg&quot;&gt;</p>")).toBe(false);
  });
});

describe("htmlText", () => {
  // The projection the description counter measures and the backend caps (`sanitize.html_text`).

  it("joins paragraphs with one newline", () => {
    expect(htmlText("<p>First.</p><p>Second.</p>")).toBe("First.\nSecond.");
  });

  // Same inputs and outputs as the backend's `html_text` cases.
  it("breaks at newlines in text, drops blank lines and U+FFFC", () => {
    expect(htmlText("<p>a\n\nb</p>")).toBe("a\nb");
    expect(htmlText("<pre><code>x\n  y\n\nz</code></pre>")).toBe("x\ny\nz");
    expect(htmlText("<p>a<br>b</p><ul><li><p>c</p></li></ul>")).toBe("a\nb\nc");
    expect(htmlText("<p>￼</p><p>d &amp; e</p>")).toBe("d & e");
  });

  it("concatenates the runs of one paragraph, marks and links included", () => {
    expect(
      htmlText('<p>Strikes on <strong>Kupiansk</strong> in <a href="https://x.com">March</a>.</p>'),
    ).toBe("Strikes on Kupiansk in March.");
  });

  it("decodes entities", () => {
    expect(htmlText("<p>Fish &amp; chips &lt;3 &quot;q&quot; &#39;a&#39; caf&eacute;</p>")).toBe(
      "Fish & chips <3 \"q\" 'a' café",
    );
  });

  it("gives each list item its own line, nested lists included", () => {
    expect(htmlText("<ul><li><p>One</p><ul><li>Inner</li></ul></li><li>Two</li></ul>")).toBe(
      "One\nInner\nTwo",
    );
  });

  it("breaks a line at a heading, a blockquote, a code block and a <br>", () => {
    expect(
      htmlText(
        "<h2>Kupiansk</h2><h3>Rail</h3><blockquote>Quoted.</blockquote>" +
          "<pre><code>x = 1</code></pre><p>Before<br>After</p>",
      ),
    ).toBe("Kupiansk\nRail\nQuoted.\nx = 1\nBefore\nAfter");
  });

  it("drops blank lines and strips each line", () => {
    expect(htmlText("<p></p><p>  Spaced  </p><p>   </p><hr><p>End</p>")).toBe("Spaced\nEnd");
  });

  it("reads an empty body, and a missing one, as no text", () => {
    expect(htmlText("")).toBe("");
    expect(htmlText("<p></p>")).toBe("");
    expect(htmlText(null)).toBe("");
  });

  it("gives an image no text of its own", () => {
    expect(htmlText('<img src="https://x/y.jpg" alt="ruins"><p>Caption</p>')).toBe("Caption");
  });
});
