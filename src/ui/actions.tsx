import { createContext, useContext } from "react";

/** Runtime adapters are supplied only at entry points. Shared UI has no Chrome dependency. */
export interface UiActions {
  send: <T extends object = Record<string, never>>(
    message: Record<string, unknown>,
  ) => Promise<T>;
  currentPopoTabId: () => Promise<number | null>;
  copyText: (text: string) => Promise<void>;
  ensureWorker: (url: string) => void;
}
const Actions = createContext<UiActions | null>(null);
export const UiActionsProvider = Actions.Provider;
export function useUiActions(): UiActions {
  const actions = useContext(Actions);
  if (!actions)
    throw new Error("POPO UI requires an explicit runtime or demo adapter");
  return actions;
}
