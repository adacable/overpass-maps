import { browser } from '#imports';
import type { Bounds } from './mercator.ts';

// popup -> content script
export interface GetViewRequest {
  type: 'getView';
}
export type GetViewResponse =
  | { ok: true; bounds: Bounds; center: { lat: number; lng: number } }
  | { ok: false; error: string };

/** Ask the Google Maps tab where it's looking; undefined if no content script answers. */
export function requestView(tabId: number): Promise<GetViewResponse | undefined> {
  return browser.tabs.sendMessage(tabId, { type: 'getView' } satisfies GetViewRequest);
}

// popup -> background
export interface RunQueryRequest {
  type: 'runQuery';
  query: string;
}
export interface CancelQueryRequest {
  type: 'cancelQuery';
}
export type BackgroundRequest = RunQueryRequest | CancelQueryRequest;

export function sendToBackground(req: BackgroundRequest): Promise<unknown> {
  return browser.runtime.sendMessage(req);
}
