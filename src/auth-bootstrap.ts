import type { SessionUser } from "./types";

type SessionResponse = { authenticated: boolean; user?: SessionUser };

export const sessionBootstrapCanRetry = (error: unknown) => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" && (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500);
};

/** Establishes the browser's private-media boundary before authenticated UI renders. */
export async function bootstrapSession(options: {
  load: () => Promise<SessionResponse>;
  activateMediaScope: (userId: string) => Promise<void>;
  deactivateMediaScope: () => Promise<void>;
  wait?: (ms: number) => Promise<void>;
}) {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await options.load();
      const user = response.authenticated && response.user ? response.user : null;
      if (user) await options.activateMediaScope(user.id);
      else await options.deactivateMediaScope();
      return user;
    } catch (error) {
      if (attempt === 2 || !sessionBootstrapCanRetry(error)) throw error;
      await wait(attempt === 0 ? 500 : 1500);
    }
  }
  return null;
}
