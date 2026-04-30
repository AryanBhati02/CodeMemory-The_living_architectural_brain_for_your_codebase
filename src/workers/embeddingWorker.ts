
import { parentPort } from 'worker_threads';

type WorkerRequest =
  | { type: 'embed'; nodeId: string; text: string }
  | { type: 'embed-text'; requestId: string; text: string };

interface PipelineOutput { data: Float32Array }
type PipelineFn = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<PipelineOutput>;

let pipeline: PipelineFn | null = null;

async function init() {
  const { pipeline: createPipeline } = await import('@xenova/transformers');
  pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as PipelineFn;
  parentPort?.postMessage({ type: 'ready' });
}

parentPort?.on('message', async (msg: WorkerRequest) => {
  if (msg.type === 'embed') {
    const { nodeId, text } = msg;
    try {
      if (!pipeline) await init();
      const output = await pipeline!(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);
      parentPort?.postMessage({ type: 'embedding', nodeId, embedding });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      parentPort?.postMessage({ type: 'embedding', nodeId, error: message });
    }
  }

  if (msg.type === 'embed-text') {
    const { requestId, text } = msg;
    try {
      if (!pipeline) await init();
      const output = await pipeline!(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);
      parentPort?.postMessage({ type: 'text-embedding', requestId, embedding });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      parentPort?.postMessage({ type: 'text-embedding', requestId, error: message });
    }
  }
});

init().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  parentPort?.postMessage({ type: 'ready', error: message });
});
