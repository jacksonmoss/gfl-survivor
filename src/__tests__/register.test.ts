import { describe, it, expect } from "vitest";
import { deriveProfileNames } from "@/lib/register";

describe("deriveProfileNames", () => {
  it("uses the first name as displayName and 'First Last' as realName", () => {
    expect(
      deriveProfileNames({ firstName: "Jackson", lastName: "Moss", username: "jdog" })
    ).toEqual({ displayName: "Jackson", realName: "Jackson Moss" });
  });

  it("falls back to username for displayName when no first name is given", () => {
    expect(
      deriveProfileNames({ firstName: "", lastName: "", username: "zeke99" })
    ).toEqual({ displayName: "zeke99", realName: null });
  });

  it("treats missing/null names as blank (only username required)", () => {
    expect(deriveProfileNames({ username: "lucky13" })).toEqual({
      displayName: "lucky13",
      realName: null,
    });
    expect(
      deriveProfileNames({ firstName: null, lastName: null, username: "ace_v" })
    ).toEqual({ displayName: "ace_v", realName: null });
  });

  it("uses first name only for realName when last name is blank", () => {
    expect(
      deriveProfileNames({ firstName: "Sara", lastName: "", username: "sara_k" })
    ).toEqual({ displayName: "Sara", realName: "Sara" });
  });

  it("still builds realName from a last name when the first name is blank", () => {
    expect(
      deriveProfileNames({ firstName: "", lastName: "Burke", username: "tommy_b" })
    ).toEqual({ displayName: "tommy_b", realName: "Burke" });
  });

  it("trims surrounding whitespace on every field", () => {
    expect(
      deriveProfileNames({ firstName: "  Mike ", lastName: " Thompson ", username: "  mike_t  " })
    ).toEqual({ displayName: "Mike", realName: "Mike Thompson" });
  });
});
