import { describe, expect, it } from "vitest";
import { localiseText } from "./map";

describe("library methods in Australian terms", () => {
  it("converts inches and US words", () => {
    expect(localiseText("Cut into ½ inch slices")).toBe("Cut into 1 cm slices");
    expect(localiseText("a 9-inch tin, 2-3 inches deep")).toBe("a 23 cm tin, 5–8 cm deep");
    expect(localiseText("Sift the all-purpose flour with the baking soda")).toBe("Sift the plain flour with the bicarb soda");
    expect(localiseText("Top with cilantro and scallions")).toBe("Top with coriander and spring onion");
  });
});
