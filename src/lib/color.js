/**
 * MUJI / Kenya Hara-inspired terminal palette — src/lib/color.js
 *
 * Emptiness (空) · Plainness (素) · Natural tones · Low contrast
 * Warm earth colors that feel like paper, wood, stone.
 * All modules use this for consistent, quiet terminal output.
 */

export const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  italic:  "\x1b[3m",

  // MUJI-inspired warm earth palette
  accent:  "\x1b[38;5;144m",  // warm taupe (#9b8c78)
  green:   "\x1b[38;5;108m",  // muted sage (#7a8b6f)
  yellow:  "\x1b[38;5;179m",  // muted gold (#c4a86a)
  red:     "\x1b[38;5;174m",  // muted rose (#b8847c)
  blue:    "\x1b[38;5;102m",  // warm gray-blue
  gray:    "\x1b[38;5;244m",  // warm mid gray (#8c8276)
  silver:  "\x1b[38;5;250m",  // warm light gray (#b8b0a4)
  white:   "\x1b[38;5;255m",  // off-white

  // MUJI-inspired semantic aliases
  warmPaper: "\x1b[38;5;250m",  // background feeling
  earth:     "\x1b[38;5;144m",  // warm taupe accent
  sage:      "\x1b[38;5;108m",  // muted sage for "ok" states
  gold:      "\x1b[38;5;179m",  // muted gold for "warn" states
  rose:      "\x1b[38;5;174m",  // muted rose for "error" states
  warmGray:  "\x1b[38;5;244m",  // secondary text
  stone:     "\x1b[38;5;102m",  // neutral structural color
};

/**
 * Apply an ANSI code to text. Respects NO_COLOR and non-TTY.
 */
export function color(code, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return code + text + C.reset;
}

/** Short alias */
export function c(code, text) {
  return color(code, text);
}
