/** Shared DOM skeleton for native directory transitions and isolated Design previews. */
export function createDirectorySkeleton(): HTMLDivElement {
  const shell = document.createElement("div");
  shell.className = "popo-directory-transition-shell";
  const heading = document.createElement("div");
  heading.className = "popo-directory-transition-heading";
  const folder = document.createElement("span");
  folder.className = "popo-directory-transition-folder";
  folder.setAttribute("aria-hidden", "true");
  const label = document.createElement("strong");
  label.className = "popo-directory-transition-label";
  heading.append(folder, label);

  const toolbar = document.createElement("div");
  toolbar.className = "popo-directory-transition-toolbar";
  for (let index = 0; index < 5; index += 1) {
    const control = document.createElement("span");
    control.className = "popo-directory-transition-control";
    toolbar.append(control);
  }

  const rows = document.createElement("div");
  rows.className = "popo-directory-transition-rows";
  for (let index = 0; index < 7; index += 1) {
    const row = document.createElement("span");
    row.className = "popo-directory-transition-row";
    const icon = document.createElement("i");
    const line = document.createElement("i");
    row.append(icon, line);
    rows.append(row);
  }
  shell.append(heading, toolbar, rows);
  return shell;
}
