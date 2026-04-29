
import { parentPort } from 'worker_threads';

let pipeline: any = null;

async function init() {
  const { pipeline: createPipeline } = await import('@xenova/transformers');
  pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  parentPort?.postMessage({ type: 'ready' });
}

parentPort?.on('message', async (msg: any) => {
  if (msg.type === 'embed') {
    const { nodeId, text } = msg;
    try {
      if (!pipeline) await init();
      const output = await pipeline(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data as Float32Array);
      parentPort?.postMessage({ type: 'embedding', nodeId, embedding });
    } catch (err: any) {
      parentPort?.postMessage({ type: 'embedding', nodeId, error: err.message });
    }
  }

  if (msg.type === 'embed-text') {
    const { requestId, text } = msg;
    try {
      if (!pipeline) await init();
      const output = await pipeline(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data as Float32Array);
      parentPort?.postMessage({ type: 'text-embedding', requestId, embedding });
    } catch (err: any) {
      parentPort?.postMessage({ type: 'text-embedding', requestId, error: err.message });
    }
  }
});

init().catch((err) => {
  console.error('[EmbeddingWorker] Init failed:', err);
  parentPort?.postMessage({ type: 'ready' }); 
});
