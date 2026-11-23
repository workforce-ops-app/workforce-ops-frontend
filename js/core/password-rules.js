// The password rules, as the backend applies them (backend app/auth/passwords.py), so a
// form can say what is wrong before sending. The server checks again and has the last
// word: a company may ask for a longer minimum, and it also refuses common passwords and
// ones containing the company's name or your own name or email name, which this page does
// not check.

/** The platform's shortest password. Long passphrases are welcome. */
export const MIN_LENGTH = 15;

/** The longest password accepted. */
export const MAX_LENGTH = 128;

/** The rules in plain words, shown next to every new-password field. */
export const RULES_TEXT =
  `At least ${MIN_LENGTH} characters (your workplace may ask for more), at most ` +
  `${MAX_LENGTH}. A few ordinary words in a row make a good, memorable password. ` +
  "Common passwords, and ones containing your name or your workplace's, are refused.";

/**
 * What is wrong with a new password and its repeat, or null when the page sees nothing
 * wrong. Characters are counted one per Unicode code point, as the server counts them.
 * @param {string} password exactly as typed
 * @param {string} repeat the second entry
 * @returns {string | null}
 */
export function passwordProblem(password, repeat) {
  const length = [...password].length;
  if (length < MIN_LENGTH) return `The password needs at least ${MIN_LENGTH} characters.`;
  if (length > MAX_LENGTH) return `The password can have at most ${MAX_LENGTH} characters.`;
  if (password !== repeat) return "The two passwords are not the same.";
  return null;
}
