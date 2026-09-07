// Thin wrapper around the render worker. Keeps request ids, progress callbacks and
// cancellation in one place so the components can just await a promise.

import type {
  BenchmarkDoneMessage,
  PreviewDoneMessage,
  ProgressMessage,
  RenderDoneMessage,
  WorkerRequest,
  WorkerResponse,
} from '../worker/protocol'

type Pending = {
  resolve: (value: never) => void
  reject: (error: Error) => void
  onProgress?: (message: ProgressMessage) => void
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

export class RenderWorker {
  private worker: Worker
  private pending = new Map<number, Pending>()
  private nextId = 1

  constructor() {
    this.worker = new Worker(new URL('../worker/index.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      const entry = this.pending.get(message.id)
      if (!entry) return
      if (message.type === 'progress') {
        entry.onProgress?.(message)
        return
      }
      this.pending.delete(message.id)
      if (message.type === 'error') {
        entry.reject(message.cancelled ? new CancelledError() : new Error(message.message))
      } else {
        entry.resolve(message as never)
      }
    }
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'The render worker crashed.')
      for (const [, entry] of this.pending) entry.reject(error)
      this.pending.clear()
    }
  }

  private send<T>(
    request: Omit<WorkerRequest, 'id'> & { id?: number },
    onProgress?: (message: ProgressMessage) => void,
    transfer: Transferable[] = [],
  ): { id: number; result: Promise<T> } {
    const id = this.nextId++
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: never) => void,
        reject,
        onProgress,
      })
      this.worker.postMessage({ ...request, id }, transfer)
    })
    return { id, result }
  }

  render(
    request: Omit<Extract<WorkerRequest, { type: 'render' }>, 'id'>,
    onProgress: (message: ProgressMessage) => void,
  ) {
    return this.send<RenderDoneMessage>(request, onProgress, [request.pixels])
  }

  preview(
    request: Omit<Extract<WorkerRequest, { type: 'preview' }>, 'id'>,
    onProgress?: (message: ProgressMessage) => void,
  ) {
    return this.send<PreviewDoneMessage>(request, onProgress, [request.pixels])
  }

  benchmark(request: Omit<Extract<WorkerRequest, { type: 'benchmark' }>, 'id'>) {
    return this.send<BenchmarkDoneMessage>(request)
  }

  cancel(id: number): void {
    this.worker.postMessage({ type: 'cancel', id })
  }

  terminate(): void {
    this.worker.terminate()
  }
}
