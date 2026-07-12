import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/server/config.js';
import { createCloudTasksQueue, TaskNotCreatedError } from '../../src/server/queue.js';
import { parseSlug } from '../../src/shared/slug.js';

const CONFIG = {
  tasks: {
    project: 'project',
    location: 'location',
    queue: 'queue',
    workerUrl: 'https://worker.example',
    invokerServiceAccount: 'tasks@example.iam.gserviceaccount.com',
  },
} as Config;

class RpcError extends Error {
  constructor(readonly code: number) {
    super(`rpc ${String(code)}`);
  }
}

interface TaskRequest {
  parent: string;
  task: {
    name: string;
    httpRequest: {
      httpMethod: string;
      url: string;
      headers: Record<string, string>;
      body: string;
      oidcToken: { serviceAccountEmail: string; audience: string };
    };
    dispatchDeadline: { seconds: number };
  };
}

/** Records the backoff instead of serving it, so the suite does not sleep through it. */
function clock() {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

function client(outcomes: (Error | undefined)[] = []) {
  const created: TaskRequest[] = [];
  let attempt = 0;
  return {
    created,
    queuePath: () => 'queues/queue',
    taskPath: () => 'queues/queue/tasks/job-id',
    createTask: (request: TaskRequest) => {
      created.push(request);
      const outcome = outcomes[attempt];
      attempt += 1;
      return outcome ? Promise.reject(outcome) : Promise.resolve();
    },
  };
}

describe('createCloudTasksQueue', () => {
  it('creates a named OIDC task with the complete worker request', async () => {
    const fake = client();
    const queue = createCloudTasksQueue(CONFIG, fake as never, () => 'job-id', clock().sleep);

    await queue.enqueue(parseSlug('atlas/pipeline'));

    expect(fake.created).toEqual([
      {
        parent: 'queues/queue',
        task: {
          name: 'queues/queue/tasks/job-id',
          httpRequest: {
            httpMethod: 'POST',
            url: 'https://worker.example/internal/generate',
            headers: { 'content-type': 'application/json' },
            body: Buffer.from(JSON.stringify({ repo: 'atlas/pipeline' })).toString('base64'),
            oidcToken: {
              serviceAccountEmail: 'tasks@example.iam.gserviceaccount.com',
              audience: 'https://worker.example',
            },
          },
          dispatchDeadline: { seconds: 900 },
        },
      },
    ]);
  });

  it('retries an ambiguous create with the same task name', async () => {
    const fake = client([new RpcError(4), undefined]);
    const queue = createCloudTasksQueue(CONFIG, fake as never, () => 'job-id', clock().sleep);

    await expect(queue.enqueue(parseSlug('atlas/pipeline'))).resolves.toBeUndefined();
    expect(fake.created.map((request) => request.task.name)).toEqual([
      'queues/queue/tasks/job-id',
      'queues/queue/tasks/job-id',
    ]);
  });

  it('accepts already-exists as proof that an earlier attempt committed', async () => {
    const queue = createCloudTasksQueue(
      CONFIG,
      client([new RpcError(4), new RpcError(6)]) as never,
      () => 'job-id',
      clock().sleep,
    );

    await expect(queue.enqueue(parseSlug('atlas/pipeline'))).resolves.toBeUndefined();
  });

  it('reads an HTTP 409 as the same proof, because the client can speak REST', async () => {
    // The gRPC code for "it is already there" is 6; over REST the very same answer arrives as
    // 409. Reading only one alphabet strands the repo on a task that exists.
    const queue = createCloudTasksQueue(
      CONFIG,
      client([new RpcError(409)]) as never,
      () => 'job-id',
      clock().sleep,
    );

    await expect(queue.enqueue(parseSlug('atlas/pipeline'))).resolves.toBeUndefined();
  });

  it('reads an HTTP refusal as definitive, so admission is rolled back', async () => {
    const queue = createCloudTasksQueue(
      CONFIG,
      client([new RpcError(403)]) as never,
      () => 'job-id',
      clock().sleep,
    );

    await expect(queue.enqueue(parseSlug('atlas/pipeline'))).rejects.toBeInstanceOf(
      TaskNotCreatedError,
    );
  });

  it('backs off between attempts rather than failing three times in one microsecond', async () => {
    const ticks = clock();
    const fake = client([new RpcError(14), new RpcError(14), undefined]);
    const queue = createCloudTasksQueue(CONFIG, fake as never, () => 'job-id', ticks.sleep);

    await queue.enqueue(parseSlug('atlas/pipeline'));

    expect(ticks.delays).toEqual([250, 500]);
  });

  it('reports a definitive create refusal so admission can be rolled back', async () => {
    const queue = createCloudTasksQueue(
      CONFIG,
      client([new RpcError(5)]) as never,
      () => 'job-id',
      clock().sleep,
    );

    await expect(queue.enqueue(parseSlug('atlas/pipeline'))).rejects.toBeInstanceOf(
      TaskNotCreatedError,
    );
  });

  it('surfaces an ambiguous failure after three idempotent attempts', async () => {
    const fake = client([new RpcError(14), new RpcError(14), new RpcError(14)]);
    const queue = createCloudTasksQueue(CONFIG, fake as never, () => 'job-id', clock().sleep);

    await expect(queue.enqueue(parseSlug('atlas/pipeline'))).rejects.toThrow('rpc 14');
    expect(fake.created).toHaveLength(3);
    expect(new Set(fake.created.map((request) => request.task.name))).toEqual(
      new Set(['queues/queue/tasks/job-id']),
    );
  });
});
