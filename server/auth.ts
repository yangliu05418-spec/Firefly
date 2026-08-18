import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Redis } from "ioredis";
import { config } from "./config.js";
import { users, type User } from "./db.js";

const COOKIE = "firefly_session";
const sessionKey = (hash: string) => `auth:session:${hash}`;
const userSessionsKey = (userId: string) => `auth:user-sessions:${userId}`;
const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("base64url");
const cookieOptions = { httpOnly: true, secure: config.origin.startsWith("https://"), sameSite: "lax" as const, maxAge: config.sessionTtlSeconds * 1000, path: "/" };

export type SessionUser = Pick<User, "id" | "email" | "name" | "avatarUrl">;
export const publicUser = (user: User): SessionUser => ({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl });

export const createSession = async (redis: Redis, user: User, res: Response) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  await redis.multi()
    .set(sessionKey(hash), user.id, "EX", config.sessionTtlSeconds)
    .sadd(userSessionsKey(user.id), hash)
    .expire(userSessionsKey(user.id), config.sessionTtlSeconds)
    .exec();
  res.cookie(COOKIE, token, cookieOptions);
};

export const getSessionUser = async (redis: Redis, req: Request, res?: Response) => {
  const token = req.cookies?.[COOKIE];
  if (typeof token !== "string" || !token) return null;
  const hash = tokenHash(token);
  const userId = await redis.get(sessionKey(hash));
  if (!userId) return null;
  const user = users.findById(userId);
  if (user?.status !== "active") return null;
  if (res) {
    await redis.multi()
      .expire(sessionKey(hash), config.sessionTtlSeconds)
      .expire(userSessionsKey(user.id), config.sessionTtlSeconds)
      .exec();
    res.cookie(COOKIE, token, cookieOptions);
  }
  return user;
};

export const clearSession = async (redis: Redis, req: Request, res: Response) => {
  const token = req.cookies?.[COOKIE];
  if (typeof token === "string" && token) {
    const hash = tokenHash(token);
    const userId = await redis.get(sessionKey(hash));
    await redis.del(sessionKey(hash));
    if (userId) await redis.srem(userSessionsKey(userId), hash);
  }
  res.clearCookie(COOKIE, { path: "/" });
};

export const revokeUserSessions = async (redis: Redis, userId: string) => {
  const key = userSessionsKey(userId);
  const hashes = await redis.smembers(key);
  if (hashes.length) await redis.del(...hashes.map(sessionKey));
  await redis.del(key);
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getSessionUser(req.app.locals.redis as Redis, req, res);
    if (!user) return res.status(401).json({ error: "请使用企业飞书账号登录" });
    res.locals.user = user;
    next();
  } catch (error) { next(error); }
};
