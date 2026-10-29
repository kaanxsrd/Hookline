/**
 * Awaits a mutation inside a form action without letting a rejection escape:
 * a thrown error in a React action unmounts the form into the error boundary.
 * The failure is already shown through the mutation's `error` state, so the
 * caller only needs to know whether it succeeded.
 */
export async function attempt<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch {
    return undefined;
  }
}
