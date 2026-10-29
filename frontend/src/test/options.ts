import { fireEvent, screen } from "@testing-library/react";

/** Picks `option` in the `<OptionSearch>` or `<ItemSearch>` named `field`: focus lists the
 *  options, a click picks one. */
export function pickOption(field: string | RegExp | HTMLElement, option: string | RegExp) {
  const input = field instanceof HTMLElement ? field : screen.getByRole("combobox", { name: field });
  fireEvent.focus(input);
  fireEvent.click(screen.getByRole("option", { name: option }));
}
