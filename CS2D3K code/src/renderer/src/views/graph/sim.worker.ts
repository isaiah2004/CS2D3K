// Web Worker running the graph's force simulation off the main thread (see sim.ts for the protocol).
import { SimHost, type SimIn, type SimOut } from './sim'

const scope = self as unknown as { postMessage(msg: SimOut, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<SimIn>) => void) | null }
const host = new SimHost((msg, transfer) => scope.postMessage(msg, transfer ?? []))
scope.onmessage = (e) => host.handle(e.data)
