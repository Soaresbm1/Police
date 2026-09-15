/**
 * Whether the page can make progress right now. The shared Unity build runs with runInBackground off, so the engine
 * stops updating as soon as the page is hidden or loses focus; a wall-clock deadline that assumes Unity is running
 * has to stop with it, or a player who glances at another window gets a false load failure.
 */
export interface PageActivityPort {
  isActive(): boolean;
  /** The listener runs whenever activity may have changed. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export const browserPageActivity: PageActivityPort = {
  isActive: () => typeof document === "undefined" || (!document.hidden && document.hasFocus()),
  subscribe(listener) {
    if (typeof document === "undefined" || typeof window === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    window.addEventListener("focus", listener);
    window.addEventListener("blur", listener);
    return () => {
      document.removeEventListener("visibilitychange", listener);
      window.removeEventListener("focus", listener);
      window.removeEventListener("blur", listener);
    };
  },
};
