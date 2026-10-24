// The overlays, Model Details and About: a modal <dialog> with a heading, a × button and a body
// that scrolls on its own.

/**
 * A dialog that `opener` opens, with the class `name` and the heading `title`, appended to
 * `container`. `onOpen` runs on the body just before each opening. Esc, the × button and a click
 * on the backdrop close it, and focus returns to `opener`.
 */
export function createOverlay(
  container: HTMLElement,
  opener: HTMLButtonElement,
  name: string,
  title: string,
  body: string,
  onOpen?: (body: HTMLElement) => void,
): HTMLDialogElement {
  opener.setAttribute("aria-haspopup", "dialog");
  const dialog = document.createElement("dialog");
  dialog.className = `overlay ${name}`;
  dialog.setAttribute("aria-labelledby", `${name}-title`);
  dialog.innerHTML =
    `<div class="dialog-head"><h2 id="${name}-title">${title}</h2>` +
    '<button type="button" class="dialog-close" aria-label="Close" title="Close (Esc)">×</button></div>' +
    `<div class="dialog-body">${body}</div>`;
  const close = dialog.querySelector<HTMLButtonElement>(".dialog-close")!;
  const bodyElement = dialog.querySelector<HTMLElement>(".dialog-body")!;

  opener.addEventListener("click", () => {
    onOpen?.(bodyElement);
    dialog.showModal();
  });
  close.addEventListener("click", () => dialog.close());
  // The dialog has no padding of its own, so a click on it rather than on its contents is a
  // click on the backdrop. The press must start there too: a text selection dragged out of the
  // body also ends in a click on the dialog.
  let pressedBackdrop = false;
  dialog.addEventListener("pointerdown", (event) => (pressedBackdrop = event.target === dialog));
  dialog.addEventListener("click", (event) => {
    if (pressedBackdrop && event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => opener.focus());

  container.append(dialog);
  return dialog;
}
