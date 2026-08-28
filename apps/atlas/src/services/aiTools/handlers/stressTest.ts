import type { CallerContext } from '../policy';
import type { ToolResult } from '../types';
import { createStressTestProjectFixture } from './stressTest/createFixture';

export async function handleCreateStressTestProjectFixture(
  args: Record<string, unknown>,
  callerContext: CallerContext = 'internal'
): Promise<ToolResult> {
  return createStressTestProjectFixture(args, callerContext);
}
