import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { ACTION_ICONS, Button } from "./Button";

const SRC = path.resolve(__dirname, "../..");

// A disclosure's chevron turns with its state, so it carries no action icon.
const EXEMPT = new Set(["components/ui/Disclosure.tsx"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".tsx") && !full.endsWith(".test.tsx") ? [full] : [];
  });
}

/** Every text `<Button>` with no `action`, and every text link styled by `buttonClasses` with no
 *  `<ActionIcon>`, as `file:line`. */
function textButtonsWithoutIcon(): string[] {
  const misses: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    if (EXEMPT.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes("<Button") && !text.includes("buttonClasses(")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        const opening = node.openingElement;
        const attrs = opening.attributes.properties.filter(ts.isJsxAttribute);
        const has = (name: string) => attrs.some((a) => a.name.getText(sf) === name);
        const styled = attrs.find(
          (a) => a.name.getText(sf) === "className" && a.getText(sf).includes("buttonClasses("),
        );
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        if (opening.tagName.getText(sf) === "Button" && !has("icon") && !has("action")) {
          misses.push(`${rel}:${line}`);
        } else if (
          styled &&
          !/icon: true/.test(styled.getText(sf)) &&
          !node.getText(sf).includes("<ActionIcon")
        ) {
          misses.push(`${rel}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return misses;
}

describe("<Button action>", () => {
  it("leads the label with the action's icon", () => {
    const { container } = render(<Button action="approve">Approve</Button>);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(container.querySelector("button > svg")).toHaveClass("lucide-stamp");
  });

  it("holds one icon per action", () => {
    const icons = Object.values(ACTION_ICONS);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("is named on every text button of the app", () => {
    expect(textButtonsWithoutIcon()).toEqual([]);
  });
});
