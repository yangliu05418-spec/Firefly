import type { SessionUser } from "./types";

type SessionResponse = { authenticated: boolean; user?: SessionUser };

/** Establishes the browser's private-media boundary before authenticated UI renders. */
export async function bootstrapSession(options: {
  load: () => Promise<SessionResponse>;
  activateMediaScope: (userId: string) => Promise<void>;
  deactivateMediaScope: () => Promise<void>;
}) {
  const response = await options.load();
  const user = response.authenticated && response.user ? response.user : null;
  if (user) await options.activateMediaScope(user.id);
  else await options.deactivateMediaScope();
  return user;
}
