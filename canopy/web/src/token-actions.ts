// Settings token actions — the DOM-free controller behind main.ts's dispatch
// cases (mintToken / revokeToken) and the Settings-entry token load. Extracted
// from main.ts so the wiring is unit-testable (test/token-actions.test.ts):
// the audit found exactly this action shipped inert (`case "revokeToken":
// return;`), and main.ts — a module-scope DOM shell — can't be imported by
// tests to catch a regression like that. Deps are injected, mirroring how the
// worker injects fetchImpl/summarizer.
import type { AppState } from "./render";
import type { McpTokenMeta } from "./api";

export interface TokenActionDeps {
  listMyTokens(): Promise<McpTokenMeta[]>;
  mintMcpToken(): Promise<{ token: string }>;
  revokeMcpToken(id: number): Promise<unknown>;
  /** e instanceof Unauthorized — kept a predicate so this module stays api-free. */
  isUnauthorized(e: unknown): boolean;
  /** The user-facing message for e (ApiError.message), or null for a generic one. */
  errorMessage(e: unknown): string | null;
  flash(msg: string): void;
  rerender(): void;
}

function bounceToLogin(state: AppState, deps: TokenActionDeps): void {
  state.view = "auth";
  state.authStep = "login";
  deps.rerender();
}

/** Always refetched on Settings entry — the list is tiny, and staleness (a token
 *  minted or revoked elsewhere) is exactly what the screen exists to show. */
export async function loadMyTokens(state: AppState, deps: TokenActionDeps): Promise<void> {
  state.myTokens = { status: "loading", data: state.myTokens.data };
  deps.rerender();
  try {
    state.myTokens = { status: "ok", data: await deps.listMyTokens() };
  } catch (e) {
    if (deps.isUnauthorized(e)) return bounceToLogin(state, deps);
    // Keep prior data and record the error — render must never show a failed
    // fetch as the authoritative "no tokens" empty state.
    state.myTokens = { status: "error", data: state.myTokens.data, error: deps.errorMessage(e) ?? "Could not load tokens" };
  }
  deps.rerender();
}

export async function mintToken(state: AppState, deps: TokenActionDeps): Promise<void> {
  try {
    const { token } = await deps.mintMcpToken();
    state.revealedToken = token;
    state.tokenCopied = false;
  } catch (e) {
    if (deps.isUnauthorized(e)) return bounceToLogin(state, deps);
    deps.flash(deps.errorMessage(e) ?? "Could not mint token");
    return;
  }
  await loadMyTokens(state, deps);
}

export async function revokeToken(state: AppState, deps: TokenActionDeps, arg: string | null): Promise<void> {
  if (!arg) return;
  const id = Number(arg);
  if (!Number.isInteger(id)) return;
  try {
    await deps.revokeMcpToken(id);
  } catch (e) {
    if (deps.isUnauthorized(e)) return bounceToLogin(state, deps);
    deps.flash(deps.errorMessage(e) ?? "Could not revoke token");
    return;
  }
  deps.flash("Token revoked — effective immediately");
  await loadMyTokens(state, deps);
}
