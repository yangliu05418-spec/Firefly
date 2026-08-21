import { createContext, useContext, type ReactNode } from "react";

const AssetCacheUserContext = createContext("");

export function AssetCacheScope({ userId, children }: { userId: string; children: ReactNode }) {
  return <AssetCacheUserContext.Provider value={userId}>{children}</AssetCacheUserContext.Provider>;
}

export function useAssetCacheUserId() {
  const userId = useContext(AssetCacheUserContext);
  if (!userId) throw new Error("Asset cache used outside an authenticated scope");
  return userId;
}
