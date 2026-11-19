import type { Phase } from '../game/stateMachine';
import type { Run } from './ranking';

export type SkybreakMessage =
  | { type: 'run-started'; runId: string }
  | { type: 'stage'; runId: string; phase: Phase }
  | { type: 'run-finished'; run: Run }
  | { type: 'run-ended'; runId: string }
  | { type: 'board-changed' }
  | { type: 'status-request' };

export function skybreakChannel(receive: (message: SkybreakMessage) => void) {
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('skybreak');
  channel?.addEventListener('message', (event: MessageEvent<SkybreakMessage>) => receive(event.data));
  return {
    send: (message: SkybreakMessage) => channel?.postMessage(message),
    close: () => channel?.close(),
  };
}
