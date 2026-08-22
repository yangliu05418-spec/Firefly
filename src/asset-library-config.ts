import type { LibraryGroup } from "./types";

/**
 * The browser-visible group is a Firefly product namespace, not a provider
 * resource id. Keeping this deterministic fallback client-side lets uploads
 * start immediately while the control-plane request refreshes in the
 * background. The server remains authoritative and resolves it to the actual
 * provider group before registration.
 */
export const defaultAssetLibraryGroup: LibraryGroup = {
  Id: "group-firefly-auto-references",
  Name: "我的素材",
  Description: "仅当前用户可见",
};

export const assetLibraryGroupsOrDefault = (groups?: readonly LibraryGroup[]) =>
  groups?.length ? [...groups] : [defaultAssetLibraryGroup];
