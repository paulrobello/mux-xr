/**
 * Leaves a trace for an error the caller recovers from. `console.debug` stays hidden in default
 * browser consoles and shows in the Quest remote inspector. Pass only a static scope and the
 * error: never clipboard contents, request bodies, secrets or paths.
 */
export const reportSwallowed = (scope: string, error: unknown): void => {
  console.debug(`[mux-xr] ${scope}`, error);
};

/** Server code logs the error class only, because messages can carry file paths. */
export const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'unknown';

/** A `.catch` handler that reports the error and resolves to `fallback`. */
export const swallowTo =
  <T>(scope: string, fallback: T) =>
  (error: unknown): T => {
    reportSwallowed(scope, error);
    return fallback;
  };
