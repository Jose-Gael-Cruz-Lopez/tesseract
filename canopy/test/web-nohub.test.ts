/**
 * Issue #9 review — the web client half of the flat cutover. With no active hub
 * (activeRepo === null, the boot state) the SPA must not offer repo-scoped
 * destinations whose reads and actions all require /r/:owner/:repo now:
 *
 *  • render(): the sidebar hides Workspace/Knowledge/Triage nav and offers the
 *    hub-list ("Repos") instead; chrome (Settings, Get Started) stays reachable.
 *  • api scoped(): every hub-scoped read/mutation rejects with "Select a repo
 *    first" BEFORE any fetch — there is no flat fallback path left to hit.
 *
 * Fail-when-broken: re-adding the flat fallback in scoped() makes the rejection
 * assertions fail; re-exposing the nav without a hub makes the render assertions
 * fail. All tests are pure (no D1, no network — the rejects fire pre-fetch).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, initialState } from "../web/src/render";
import {
  setActiveRepo, ApiError,
  listDocs, getRoadmap, listStagedProposals,
  promoteDoc, ratifyAdr, completeMilestone, discardTriage, assignTriage,
} from "../web/src/api";

const REPO_NAV_ACTS = ["goMyWork", "goRoadmap", "goFeed", "goDocs", "goSearch", "goReview", "goMaintenance"];

function appState(activeRepo: string | null) {
  const s = initialState();
  s.view = "app";
  s.activeRepo = activeRepo;
  s.screen = "hubs";
  return s;
}

describe("sidebar without an active hub", () => {
  it("hides every repo-scoped destination and offers the hub-list instead", () => {
    const html = render(appState(null));
    for (const act of REPO_NAV_ACTS) {
      expect(html, `${act} must not render while no repo is selected`).not.toContain(`data-act="${act}"`);
    }
    expect(html).toContain('data-act="goHubs"');
    // Chrome stays reachable — never an escape-proof state.
    expect(html).toContain('data-act="goSettings"');
    expect(html).toContain('data-act="goGuide"');
  });

  it("shows the full nav once a hub is active", () => {
    const html = render(appState("octo/hub"));
    for (const act of REPO_NAV_ACTS) {
      expect(html, `${act} must render inside a hub`).toContain(`data-act="${act}"`);
    }
    expect(html).not.toContain('data-act="goHubs"');
  });
});

describe("api scoped(): no flat fallback", () => {
  beforeEach(() => setActiveRepo(null));
  afterEach(() => setActiveRepo(null)); // module-level state — never leak into other files

  it("hub-scoped reads reject before any fetch while no repo is selected", async () => {
    await expect(listDocs()).rejects.toThrow("Select a repo first");
    await expect(getRoadmap()).rejects.toThrow("Select a repo first");
    await expect(listStagedProposals()).rejects.toThrow("Select a repo first");
  });

  it("mutations reject before any fetch while no repo is selected (no flat 404 round-trip)", async () => {
    await expect(promoteDoc("slug", 1)).rejects.toThrow("Select a repo first");
    await expect(ratifyAdr(1)).rejects.toThrow("Select a repo first");
    await expect(completeMilestone(1)).rejects.toThrow("Select a repo first");
    await expect(discardTriage(1)).rejects.toThrow("Select a repo first");
    await expect(assignTriage(1, { type: "doc" })).rejects.toThrow("Select a repo first");
    await expect(promoteDoc("slug", 1)).rejects.toBeInstanceOf(ApiError);
  });
});
