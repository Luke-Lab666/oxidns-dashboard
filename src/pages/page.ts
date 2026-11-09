export interface Page {
  title: string;
  /** Render into root; return an optional cleanup function. */
  mount(root: HTMLElement, params: URLSearchParams): void | (() => void);
}
