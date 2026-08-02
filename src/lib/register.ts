// Pure helpers for name-based signup (#112 variant). The register form asks for
// a first name, last name, and username, but only the username + password are
// required. First/last are optional and fold into the existing
// displayName/realName columns, so the data model is unchanged and login stays
// keyed on `username`. Extracted here so the derivation is unit-tested rather
// than living inline in the route.

export type RegisterProfileInput = {
  firstName?: string | null;
  lastName?: string | null;
  username: string;
};

// Map the (optional) first/last name + username onto the two name columns:
//   - displayName (required): the handle shown around the app. Prefer the first
//     name; fall back to the username so it's never blank.
//   - realName (optional): the full "First Last", or null when neither is given.
export function deriveProfileNames(input: RegisterProfileInput): {
  displayName: string;
  realName: string | null;
} {
  const first = (input.firstName ?? "").trim();
  const last = (input.lastName ?? "").trim();
  const username = input.username.trim();
  const full = [first, last].filter(Boolean).join(" ");
  return {
    displayName: first || username,
    realName: full || null,
  };
}
