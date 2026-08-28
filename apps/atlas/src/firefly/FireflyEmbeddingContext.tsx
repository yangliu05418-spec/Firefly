import { createContext, useContext, type ReactNode } from 'react';

export interface FireflyEmbeddingValue {
  user: { id?: string; name: string; email: string; avatarUrl?: string };
  projectId: string;
  capabilities: { agent: boolean; generate: boolean };
  getLeaseToken?: () => string | null;
  onBackToProjects: () => void | Promise<void>;
}

const FireflyEmbeddingContext = createContext<FireflyEmbeddingValue | undefined>(undefined);

export function FireflyEmbeddingProvider({ value, children }: { value?: FireflyEmbeddingValue; children: ReactNode }) {
  return <FireflyEmbeddingContext.Provider value={value}>{children}</FireflyEmbeddingContext.Provider>;
}

export const useFireflyEmbedding = () => useContext(FireflyEmbeddingContext);
