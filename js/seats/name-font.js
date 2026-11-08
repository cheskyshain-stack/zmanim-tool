export const SEATS_NAME_FONT = 'Noto Sans';
export const SEATS_HEBREW_NAME_FONT = 'Noto Sans Hebrew';

export function seatsNameHasHebrew(name) {
  return /[\u0590-\u05ff]/.test(name);
}

let seatsNameFonts;
export function seatsWaitForNameFonts() {
  if (!seatsNameFonts) seatsNameFonts = Promise.all([
    document.fonts.load('700 13px "' + SEATS_NAME_FONT + '"', 'Yosef Cohen'),
    document.fonts.load('700 13px "' + SEATS_HEBREW_NAME_FONT + '"', 'משה כהן'),
  ]).catch(() => {});
  return seatsNameFonts;
}
