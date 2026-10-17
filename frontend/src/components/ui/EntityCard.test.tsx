import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EntityCard } from "./EntityCard";

const ANA = { username: "ana", avatar_url: "https://media.example/ana.jpg" };
const BO = { username: "bo", avatar_url: "https://media.example/bo.jpg" };

describe("<EntityCard>", () => {
  it.each(["feed", "compact"] as const)(
    "%s card: the lead author is a picture and a name, a co-geolocator a picture alone",
    (variant) => {
      const props = {
        detailHref: "/events/e1",
        title: "Strike on the depot",
        author: ANA,
        coAuthors: [BO],
      };
      const { container } = render(
        variant === "feed" ? <EntityCard variant="feed" {...props} /> : <EntityCard {...props} />,
      );
      const lead = screen.getByRole("link", { name: "ana" });
      expect(lead).toHaveTextContent("ana");
      expect(lead).toHaveAttribute("href", "/profile/ana");
      const co = screen.getByRole("link", { name: "bo" });
      expect(co).toHaveAttribute("href", "/profile/bo");
      expect(co).toHaveTextContent("");
      const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
      expect(sources).toEqual(expect.arrayContaining([ANA.avatar_url, BO.avatar_url]));
    },
  );
});
