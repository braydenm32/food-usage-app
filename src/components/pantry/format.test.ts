import { describe, expect, it } from "vitest";
import { formatQuantity } from "./format";

describe("formatQuantity", () => {
  it("folds 1000 g and up into kg, 1000 ml and up into L", () => {
    expect(formatQuantity(1000, "g")).toBe("1 kg");
    expect(formatQuantity(1250, "g")).toBe("1.25 kg");
    expect(formatQuantity(2500, "ml")).toBe("2.5 L");
    expect(formatQuantity(999, "g")).toBe("999 g");
    expect(formatQuantity(250, "ml")).toBe("250 ml");
  });

  it("keeps other units", () => {
    expect(formatQuantity(2, "item")).toBe("×2");
    expect(formatQuantity(1.5, "L")).toBe("1½ L");
    expect(formatQuantity(2, "tin")).toBe("2 tins");
  });
});
