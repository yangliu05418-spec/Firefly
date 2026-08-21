import type { CreationSession, ImageResultBundle, ModelCapability, Task } from "./types";

export type StudioBootstrapReaders = {
  readModels: () => Promise<ModelCapability[]>;
  readTasks: () => Promise<Task[]>;
  readImages: () => Promise<ImageResultBundle[]>;
  readSessions: () => Promise<CreationSession[]>;
  createSession: () => Promise<CreationSession>;
};

export type StudioBootstrapResult = {
  models: ModelCapability[];
  tasks: Task[];
  images: ImageResultBundle[];
  sessions: CreationSession[];
  degraded: boolean;
};

const reason = (result: PromiseRejectedResult) => result.reason instanceof Error ? result.reason : new Error("创作台暂时无法载入");

/**
 * Models and sessions are required to create safely. Historical video and image
 * snapshots are independent: one unavailable history must not take down Studio.
 */
export const loadStudioBootstrap = async (readers: StudioBootstrapReaders): Promise<StudioBootstrapResult> => {
  const [models, tasks, images, sessions] = await Promise.allSettled([
    readers.readModels(), readers.readTasks(), readers.readImages(), readers.readSessions(),
  ]);
  if (models.status === "rejected") throw reason(models);
  if (sessions.status === "rejected") throw reason(sessions);
  const availableSessions = sessions.value.length ? sessions.value : [await readers.createSession()];
  return {
    models: models.value,
    tasks: tasks.status === "fulfilled" ? tasks.value : [],
    images: images.status === "fulfilled" ? images.value : [],
    sessions: availableSessions,
    degraded: tasks.status === "rejected" || images.status === "rejected",
  };
};
