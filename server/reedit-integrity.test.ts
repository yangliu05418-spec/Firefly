import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserStore } from "./db.js";
import { migrateDatabase } from "./migrations.js";
import { runReeditIntegrityCheck } from "./reedit-integrity.js";

describe("production re-edit integrity smoke", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));
  const createStore = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-reedit-integrity-"));
    directories.push(directory);
    const target = path.join(directory, "firefly.db");
    migrateDatabase(target);
    return new UserStore(target);
  };

  it("allows a fresh database for container readiness but requires real data for the deploy CLI", () => {
    const store = createStore();
    expect(runReeditIntegrityCheck(store, 7)).toEqual([]);
    expect(() => runReeditIntegrityCheck(store, 7, true)).toThrow("no terminal production task");
    store.close();
  });

  it("fails readiness when an internal marker reaches a persisted provider prompt", () => {
    const store = createStore();
    const now = Date.now();
    const owner = store.upsertFromFeishu({ openId: "ou-integrity", unionId: "on-integrity", tenantKey: "tenant", email: "integrity@dokuai.tv", name: "Integrity", avatarUrl: "" });
    store.saveTask({ id: "task-marker", ownerId: owner.id, visibility: "private", status: "failed", mediaStatus: "none", mediaRevision: 0, prompt: "safe", model: "dreamina-seedance-2-5-260628", mode: "omni", ratio: "16:9", resolution: "720p", duration: 4, createdAt: now, updatedAt: now });
    store.createCreationSnapshot({
      snapshot: { sourceType: "video", sourceId: "task-marker", ownerId: owner.id, editorPrompt: "safe", providerPrompt: "[[firefly-ref:leaked]]", parameters: {}, bindingVersion: 1, recoveryQuality: "exact", createdAt: now, updatedAt: now },
      references: [],
    });
    expect(() => runReeditIntegrityCheck(store, 7)).toThrow("internal reference marker");
    store.close();
  });
});
