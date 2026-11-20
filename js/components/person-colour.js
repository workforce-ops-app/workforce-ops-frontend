// Each person's own colour on the department calendar (workforce-ops-app/workforce-ops-frontend#82),
// so a manager can follow one person through a busy week at a glance.
//
// The colour is picked from the person's employee ID, never stored anywhere: the same ID
// always gives the same colour, on every visit and on every computer, with nothing to save
// or keep in step. Two people can still end up with the same colour (there are more people
// than colours), which is fine because the colour is never the only signal: every block
// also shows the person's name.
//
// The colours themselves are a fixed list in the stylesheet (css/components/person-colour.css,
// with the values in css/base/base.css). This file only chooses a number from 0 to 11 and
// turns it into one of those class names, so no text from the server can ever become a
// colour or a style.

/** How many colours the palette has (css/components/person-colour.css has one class each). */
export const PERSON_COLOURS = 12;

/**
 * Which colour of the palette a person gets: a number from 0 to PERSON_COLOURS - 1.
 *
 * It uses a simple, well-known string hash (FNV-1a, 32 bits): start from a fixed number,
 * then for every character mix the character in (XOR) and stir (multiply by a fixed
 * prime). Similar IDs give very different numbers, so people spread over the whole
 * palette instead of bunching up on a few colours. The remainder after dividing by the
 * number of colours picks the colour.
 * @param {string} employeeId the server's ID for the person
 * @returns {number}
 */
export function personColourIndex(employeeId) {
  // The FNV-1a starting value ("offset basis").
  let hash = 0x811c9dc5;
  for (const character of employeeId) {
    // XOR mixes the character's code into the hash.
    hash ^= character.codePointAt(0) ?? 0;
    // Math.imul multiplies as 32-bit integers (plain * would lose precision on numbers
    // this big), and >>> 0 keeps the result a positive 32-bit number.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % PERSON_COLOURS;
}

/**
 * The class that gives an element a person's colour, e.g. "person-colour-4". The class
 * sets two custom properties, --person-tint (the light background) and --person-edge (the
 * strong edge), which the calendar's blocks use.
 * @param {string} employeeId
 * @returns {string}
 */
export function personColourClass(employeeId) {
  return `person-colour-${personColourIndex(employeeId)}`;
}
