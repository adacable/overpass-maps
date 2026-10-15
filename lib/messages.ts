import type { Bounds } from './mercator.ts';

// popup -> content script
export interface GetViewRequest {
  type: 'getView';
}
export type GetViewResponse =
  | { ok: true; bounds: Bounds; center: { lat: number; lng: number } }
  | { ok: false; error: string };

// popup -> background
export interface RunQueryRequest {
  type: 'runQuery';
  query: string;
}
export interface CancelQueryRequest {
  type: 'cancelQuery';
}
export type BackgroundRequest = RunQueryRequest | CancelQueryRequest;
