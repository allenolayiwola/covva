/** Attach server validation to controls in server-rendered form children. Returns cleanup for the next result. */
export function showFieldErrors(form: HTMLFormElement, errors: Record<string, string[]>, prefix: string): () => void {
  const cleanup: (() => void)[] = [];
  for (const [name, messages] of Object.entries(errors)) {
    if (!messages.length) continue;
    // Nested Zod paths may refer to a JSON editor (e.g. value.limit).
    const controls = Array.from(form.elements).filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)
      && element.type !== "hidden" && (element.name === name || element.name === name.split(".")[0]),
    );
    if (!controls.length) continue; // Form-level and hidden-field errors remain in the summary.
    const message = document.createElement("p");
    message.id = `${prefix}-${encodeURIComponent(name)}`;
    message.className = "mt-1.5 text-xs text-danger";
    message.textContent = messages.join(" ");
    controls.at(-1)!.insertAdjacentElement("afterend", message);
    for (const control of controls) {
      const invalid = control.getAttribute("aria-invalid");
      const describedBy = control.getAttribute("aria-describedby");
      control.setAttribute("aria-invalid", "true");
      control.setAttribute("aria-describedby", [describedBy, message.id].filter(Boolean).join(" "));
      cleanup.push(() => {
        if (invalid === null) control.removeAttribute("aria-invalid"); else control.setAttribute("aria-invalid", invalid);
        if (describedBy === null) control.removeAttribute("aria-describedby"); else control.setAttribute("aria-describedby", describedBy);
      });
    }
    cleanup.push(() => message.remove());
  }
  return () => cleanup.reverse().forEach((fn) => fn());
}
