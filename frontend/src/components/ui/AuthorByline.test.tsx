import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthorByline } from "./AuthorByline";

describe("<AuthorByline>", () => {
  it("prints the Vidit username without @ and links the profile", () => {
    const { container } = render(<AuthorByline author={{ username: "ana" }} />);
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute("href", "/profile/ana");
    expect(container.textContent).toBe("by ana");
  });

  it("drops the prefix and the link on request", () => {
    const { container } = render(
      <AuthorByline author={{ username: "ana" }} prefix={false} link={false} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("ana");
  });

  it("sets co-authors beside the lead, each a picture and a linked name", () => {
    const { container } = render(
      <AuthorByline
        author={{ username: "ana" }}
        coAuthors={[{ username: "bo" }, { username: "cy" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "cy" })).toHaveAttribute("href", "/profile/cy");
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(3);
    const separators = [...container.querySelectorAll(".sr-only")].map((s) => s.textContent);
    expect(separators).toEqual([", ", " and "]);
    container.querySelectorAll(".sr-only, [aria-hidden='true']").forEach((node) => node.remove());
    expect(container.textContent).toBe("by anabocy");
  });

  it("shows co-authors as pictures alone with coAuthorsAs avatars, each named and linked", () => {
    const { container } = render(
      <AuthorByline
        author={{ username: "ana", avatar_url: "https://media.example/ana.jpg" }}
        coAuthors={[{ username: "bo", avatar_url: "https://media.example/bo.jpg" }]}
        coAuthorsAs="avatars"
        avatar
      />,
    );
    expect(screen.getByRole("link", { name: "ana" })).toHaveTextContent("ana");
    const bo = screen.getByRole("link", { name: "bo" });
    expect(bo).toHaveAttribute("href", "/profile/bo");
    expect(bo).toHaveTextContent("");
    expect(container.querySelector("img[src='https://media.example/bo.jpg']")).not.toBeNull();
  });
});
