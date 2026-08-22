import { useEffect, useState } from "react";
import { api } from "./api";
import { createSharedImageModelCatalogLoader, loadImageModelCatalogCacheFirst, type ImageModelCatalog } from "./image-model-catalog";

const sharedCatalog = createSharedImageModelCatalogLoader(() => api.get<ImageModelCatalog>("/api/image-models"));

export function useImageModelCatalog() {
  const [catalog, setCatalog] = useState<ImageModelCatalog | undefined>(() => sharedCatalog.peek());
  const [loading, setLoading] = useState(!catalog);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!sharedCatalog.peek()) setLoading(true);
      void loadImageModelCatalogCacheFirst({
        loadFresh: sharedCatalog.load,
        onCached: (cached) => {
          if (!active) return;
          setCatalog(cached);
          setLoading(false);
        },
      }).then((result) => {
        if (!active) return;
        setCatalog(result.catalog);
        setError("");
      }).catch(() => {
        if (active) setError("图片模型目录暂时不可用，网络恢复后会自动重试");
      }).finally(() => { if (active) setLoading(false); });
    };
    load();
    window.addEventListener("online", load);
    return () => { active = false; window.removeEventListener("online", load); };
  }, []);

  return { catalog, loading, error };
}
