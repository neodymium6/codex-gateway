import { captureSessionEpoch } from "@/utils/session-epoch";
import {
  requestActivateThreadSnapshot,
  type ThreadSnapshotActivationInput,
  type ThreadSnapshotMessage,
} from "./transport";

interface ThreadSnapshotStrategy<Result> {
  input: ThreadSnapshotActivationInput;
  setLoading?: (loading: boolean) => void;
  accept: (snapshot: ThreadSnapshotMessage) => boolean;
  commit: (snapshot: ThreadSnapshotMessage) => Result | Promise<Result>;
  discard?: (snapshot: ThreadSnapshotMessage) => void;
  fail: (error: unknown) => void;
  rethrow?: boolean;
}

/**
 * Runs the one authoritative thread.activate transaction. View-specific code supplies only its
 * acceptance and commit policy; session invalidation, loading ownership, failure handling, and
 * late-result disposal stay identical across selection, preview, refresh, and gap recovery.
 */
export async function coordinateThreadSnapshot<Result>(
  strategy: ThreadSnapshotStrategy<Result>,
): Promise<Result | undefined> {
  const sessionIsCurrent = captureSessionEpoch();
  strategy.setLoading?.(true);
  try {
    const snapshot = await requestActivateThreadSnapshot(strategy.input);
    if (!sessionIsCurrent() || !strategy.accept(snapshot)) {
      if (sessionIsCurrent()) strategy.discard?.(snapshot);
      return undefined;
    }
    return await strategy.commit(snapshot);
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return undefined;
    strategy.fail(error);
    if (strategy.rethrow === true) throw error;
    return undefined;
  } finally {
    if (sessionIsCurrent()) strategy.setLoading?.(false);
  }
}
