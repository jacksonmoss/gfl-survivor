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

export type SettingsProfileInput = RegisterProfileInput & {
  displayName?: string | null;
};

// Settings (#126) asks for the same first/last name as signup, so the two stay
// in lockstep — but unlike signup it also keeps displayName directly editable,
// because a user may have set a handle ("JDog") that has nothing to do with
// their first name and editing a last name must not clobber it. An explicit
// displayName wins; blank falls back to the signup derivation (first name, else
// username), so the required column is never left empty.
export function deriveSettingsProfile(input: SettingsProfileInput): {
  displayName: string;
  realName: string | null;
} {
  const derived = deriveProfileNames(input);
  const explicit = (input.displayName ?? "").trim();
  return {
    displayName: explicit || derived.displayName,
    realName: derived.realName,
  };
}

// Inverse of the realName half of deriveProfileNames, for populating the
// settings form from what's stored. `realName` is one column, so the split is a
// convention rather than a fact: everything before the first space is the first
// name, the rest is the last name ("Mary Jo Van Der Berg" → "Mary" + "Jo Van
// Der Berg"). Ambiguous, but *round-trip safe* — re-joining always reproduces
// the stored (whitespace-normalized) name, so loading and saving the form
// unchanged never rewrites it. That's why we derive on load instead of adding
// firstName/lastName columns: a migration would have to make this exact guess
// once and freeze it, while here realName stays the single source of truth.
export function splitRealName(realName?: string | null): {
  firstName: string;
  lastName: string;
} {
  const normalized = (realName ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return { firstName: "", lastName: "" };
  const boundary = normalized.indexOf(" ");
  if (boundary === -1) return { firstName: normalized, lastName: "" };
  return {
    firstName: normalized.slice(0, boundary),
    lastName: normalized.slice(boundary + 1),
  };
}
