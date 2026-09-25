import { stageRepositoryMutation } from "@harnessme/core";
import { syncHarness } from "@harnessme/renderers";

/** Commit a fact edit, its generated integrations, and optional follow-up records together. */
export async function updateHarness<T>(
  root: string,
  mutate: (stagedRoot: string) => Promise<T>,
  afterSync?: (stagedRoot: string) => Promise<void>,
): Promise<T> {
  return stageRepositoryMutation(root, async (stagedRoot) => {
    const result = await mutate(stagedRoot);
    await syncHarness(stagedRoot, undefined, { staged: false });
    await afterSync?.(stagedRoot);
    return result;
  });
}
