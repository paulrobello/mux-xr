export interface PicturePickerCallbacks {
  /** Resolves true once the picture is shown. */
  onFile(file: File): Promise<boolean>;
  onUrl(url: string): Promise<boolean>;
}

/** Appends the "Pictures" picker to the sidebar; a file dialog cannot open inside immersive XR. */
export function mountPicturePicker(
  sidebar: HTMLElement,
  callbacks: PicturePickerCallbacks,
): HTMLElement {
  const section = document.createElement('div');
  section.className = 'setup';
  section.dataset.pictures = '';
  section.innerHTML =
    '<label for="picture-url">Pictures</label>' +
    '<div class="endpoint-row"><input id="picture-url" type="url" placeholder="https://example.com/photo.jpg" autocomplete="url" data-picture-url aria-label="Image URL"><button type="button" class="connect-btn" data-action="add-picture-url" title="Add a picture frame from this URL">Add</button></div>' +
    '<div class="endpoint-row picture-pick-row"><button type="button" class="secondary" data-action="pick-picture-file" title="Choose an image file for a picture frame">Choose image…</button><input type="file" accept="image/*" data-picture-file hidden></div>' +
    '<p class="hint">Frames appear in XR; grab to place them. URLs must allow CORS.</p>';
  const url = section.querySelector('[data-picture-url]') as HTMLInputElement;
  const file = section.querySelector('[data-picture-file]') as HTMLInputElement;
  const add = section.querySelector('[data-action="add-picture-url"]') as HTMLButtonElement;
  const pick = section.querySelector('[data-action="pick-picture-file"]') as HTMLButtonElement;
  // One pick at a time from every entry point (Add, Enter, file); the buttons only show it.
  let working = false;
  const busy = async (work: () => Promise<boolean>): Promise<boolean> => {
    if (working) return false;
    working = true;
    add.disabled = true;
    pick.disabled = true;
    try {
      return await work();
    } finally {
      working = false;
      add.disabled = false;
      pick.disabled = false;
    }
  };
  const submitUrl = async (): Promise<void> => {
    const value = url.value.trim();
    if (value && !working && (await busy(() => callbacks.onUrl(value)))) url.value = '';
  };
  add.addEventListener('click', () => void submitUrl());
  url.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submitUrl();
  });
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (chosen) void busy(() => callbacks.onFile(chosen));
  });
  sidebar.appendChild(section);
  return section;
}
