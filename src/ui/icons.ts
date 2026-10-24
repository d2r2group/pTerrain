// Feather-style line icons (24 × 24, drawn in the text color) for the header's buttons, the
// substance panel's buttons and the footer.

export const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
export const SUN =
  '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4' +
  'M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>';
export const EYE =
  '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
export const EYE_OFF =
  '<path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9' +
  "M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2" +
  'M1 1l22 22"/>';

/** A lowercase italic i in a circle: About. */
export const INFO = '<circle cx="12" cy="12" r="10"/><path d="M12.8 11l-1.5 6M13.6 7.6h.01"/>';

/** The GitHub mark, as a Feather-style line drawing. */
export const GITHUB =
  '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.4 6.4-1.5 6.4-7' +
  "A5.4 5.4 0 0 0 20 4.8 5.1 5.1 0 0 0 19.9 1S18.7.6 16 2.5a13.4 13.4 0 0 0-7 0C6.3.6 5.1 1 5.1 1" +
  'A5.1 5.1 0 0 0 5 4.8a5.4 5.4 0 0 0-1.5 3.8c0 5.4 3.3 6.6 6.4 7A3.4 3.4 0 0 0 9 18.1V22"/>';

/** A globe, for a link to a website. */
export const GLOBE =
  '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10' +
  ' 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>';

/** A check mark: Share once the link is copied. */
export const CHECK = '<path d="M20 6 9 17l-5-5"/>';
/** An arrow out of a tray: Import, which reads a file in. */
export const UPLOAD = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>';
/** An arrow into a tray: Export, which saves a file. */
export const DOWNLOAD =
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>';
/** Three linked nodes: Share. */
export const SHARE =
  '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>' +
  '<path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>';

/** Path data of the up/down chevrons on the cut handle's 11 px knob, centered on (0, 0). */
export const HANDLE_GRIP = "M-3.5,-1.5L0,-5L3.5,-1.5M-3.5,1.5L0,5L3.5,1.5";

/** An icon as SVG markup, hidden from screen readers, `size` CSS px square. */
export function icon(body: string, size = 18): string {
  return (
    `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ` +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round">${body}</svg>`
  );
}
