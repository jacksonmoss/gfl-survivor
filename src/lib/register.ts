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

// Server-enforced caps on the free-text identity fields (#137). Nothing bounded
// them before: a 10k-character display name went straight into an unbounded
// TEXT column and then onto the leaderboard, wrecking the table for everyone.
// Sized to fit the leaderboard/navbar at mobile width, not to the column type.
// Only enforced on *write* — existing rows may be longer, so there's
// deliberately no DB constraint (a migration would fail on them).
export const NAME_FIELD_LIMITS = {
  username: 32,
  firstName: 64,
  lastName: 64,
  displayName: 48,
} as const;

type NameField = keyof typeof NAME_FIELD_LIMITS;

const FIELD_LABELS: Record<NameField, string> = {
  username: "Username",
  firstName: "First name",
  lastName: "Last name",
  displayName: "Display name",
};

export type FieldValidationResult =
  | { ok: true }
  | { ok: false; field: NameField; error: string };

// Validates whatever identity fields a request actually carries — the register
// route posts username/first/last, the settings profile form posts
// first/last/display, and the settings password form posts none of them. Fields
// left `undefined` are skipped, so "absent" and "cleared" stay distinguishable
// (a blank first name is a legitimate way to clear it).
//
// Lengths are measured after trimming, matching what the derivations store.
export function validateNameFields(input: {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
}): FieldValidationResult {
  for (const field of Object.keys(NAME_FIELD_LIMITS) as NameField[]) {
    const raw = input[field];
    if (raw === undefined || raw === null) continue;

    const value = String(raw).trim();

    // Username is the login identifier, so it can't be whitespace-only — that
    // trims to "" and would otherwise fall through to the required-field check
    // (or, in settings, silently become the displayName fallback).
    if (field === "username" && value === "") {
      return { ok: false, field, error: "Username can't be blank" };
    }

    if (value.length > NAME_FIELD_LIMITS[field]) {
      return {
        ok: false,
        field,
        error: `${FIELD_LABELS[field]} must be ${NAME_FIELD_LIMITS[field]} characters or less`,
      };
    }
  }

  return { ok: true };
}

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
