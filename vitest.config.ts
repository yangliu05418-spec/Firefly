import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["server/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx", "contract-tests/**/*.test.ts"], exclude: ["dist-server/**", "node_modules/**"] } });
