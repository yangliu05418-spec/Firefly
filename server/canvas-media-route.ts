import type express from "express";
import type { CanvasAsset } from "./db.js";

type CanvasMediaRouteDependencies = {
  readCanvasAsset: (assetId: string) => CanvasAsset | null;
  signedObjectUrl: (objectKey: string, options: { fileName: string }) => string | Promise<string>;
  cacheControl: string;
};

const routeParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

export const createCanvasMediaHandler = (dependencies: CanvasMediaRouteDependencies): express.RequestHandler =>
  async (req, res, next) => {
    try {
      const user = res.locals.user as { id: string } | undefined;
      const asset = dependencies.readCanvasAsset(routeParam(req.params.assetId));
      if (!user || !asset || asset.ownerId !== user.id) return res.status(404).json({ error: "画布素材不存在" });
      if (asset.status === "copying") return res.status(425).json({ error: "素材正在迁移到长期存储，请稍后重试" });
      if (asset.status === "failed") return res.status(425).json({ error: "素材迁移失败，请删除节点后重新插入" });
      res.setHeader("Cache-Control", dependencies.cacheControl);
      res.setHeader("Vary", "Cookie");
      return res.redirect(302, await dependencies.signedObjectUrl(asset.objectKey, { fileName: asset.fileName }));
    } catch (error) {
      next(error);
    }
  };
