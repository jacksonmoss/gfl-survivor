import { describe, it, expect } from "vitest";
import { deriveProfileNames, deriveSettingsProfile, splitRealName } from "@/lib/register";

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

describe("splitRealName", () => {
  it("splits at the first space — first word is the first name", () => {
    expect(splitRealName("Jackson Moss")).toEqual({ firstName: "Jackson", lastName: "Moss" });
  });

  it("keeps everything after the first space as the last name", () => {
    expect(splitRealName("Mary Jo Van Der Berg")).toEqual({
      firstName: "Mary",
      lastName: "Jo Van Der Berg",
    });
  });

  it("treats a single word as the first name", () => {
    expect(splitRealName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });

  it("returns blanks for null/empty/whitespace-only", () => {
    const blank = { firstName: "", lastName: "" };
    expect(splitRealName(null)).toEqual(blank);
    expect(splitRealName(undefined)).toEqual(blank);
    expect(splitRealName("")).toEqual(blank);
    expect(splitRealName("   ")).toEqual(blank);
  });

  it("normalizes runs of whitespace", () => {
    expect(splitRealName("  Sara   Kim  ")).toEqual({ firstName: "Sara", lastName: "Kim" });
  });

  // The whole point of splitting on load instead of storing the halves: loading
  // the form and saving it unchanged must never rewrite the stored name.
  it("round-trips through deriveProfileNames", () => {
    for (const stored of ["Jackson Moss", "Mary Jo Van Der Berg", "Cher"]) {
      const { firstName, lastName } = splitRealName(stored);
      expect(deriveProfileNames({ firstName, lastName, username: "irrelevant" }).realName).toBe(
        stored
      );
    }
  });
});

describe("deriveSettingsProfile", () => {
  it("keeps an explicit display name while rebuilding realName from first/last", () => {
    expect(
      deriveSettingsProfile({
        firstName: "Jackson",
        lastName: "Moss",
        displayName: "JDog",
        username: "jdog",
      })
    ).toEqual({ displayName: "JDog", realName: "Jackson Moss" });
  });

  it("falls back to the first name when the display name is cleared", () => {
    expect(
      deriveSettingsProfile({
        firstName: "Jackson",
        lastName: "Moss",
        displayName: "   ",
        username: "jdog",
      })
    ).toEqual({ displayName: "Jackson", realName: "Jackson Moss" });
  });

  it("falls back to the username when both display and first name are blank", () => {
    expect(
      deriveSettingsProfile({ firstName: "", lastName: "", displayName: "", username: "zeke99" })
    ).toEqual({ displayName: "zeke99", realName: null });
  });

  it("clears realName when both name parts are cleared", () => {
    expect(
      deriveSettingsProfile({ firstName: "", lastName: "", displayName: "Zeke", username: "zeke99" })
    ).toEqual({ displayName: "Zeke", realName: null });
  });

  it("trims the display name", () => {
    expect(
      deriveSettingsProfile({ firstName: "Sara", lastName: "Kim", displayName: "  Sara K  ", username: "sara_k" })
    ).toEqual({ displayName: "Sara K", realName: "Sara Kim" });
  });

  it("matches signup's derivation when no display name is given", () => {
    const input = { firstName: "Mike", lastName: "Thompson", username: "mike_t" };
    expect(deriveSettingsProfile(input)).toEqual(deriveProfileNames(input));
  });
});
