import { CloudTasksClient } from '@google-cloud/tasks';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { RepoSlug } from '../shared/slug.js';

// Generation must outlive the tab and cost nothing while idle. Detached work would need
// --no-cpu-throttling, which bills instance time. A queued task runs inside a request, so
// CPU is billed only while working and the service still scales to zero.
export interface TaskQueue {
  enqueue(slug: RepoSlug): Promise<void>;
}

/** Queue admission failed and reconciliation proved that no task exists. */
export class TaskNotCreatedError extends Error {
  constructor(override readonly cause: unknown) {
    super('cloud task was not created', { cause });
    this.name = 'TaskNotCreatedError';
  }
}

/**
 * What an error says about whether the task exists.
 *
 * Both alphabets have to be read. The client speaks gRPC by default, but it falls back to
 * REST — and there the same refusals arrive as HTTP status codes. Reading only gRPC would see
 * a 409 (the task is already there) as merely ambiguous and strand the repo on `generating`.
 */
const CREATED = new Set([6, 409]);
const NOT_CREATED = new Set([3, 5, 7, 9, 16, 400, 401, 403, 404, 412]);
const CREATE_ATTEMPTS = 3;
const BACKOFF_MS = 250;

/** Retrying a transient refusal in the same microsecond just fails three times instead of one. */
const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Verifies that a worker request really came from our queue, not from the open internet. */
export interface TaskAuthenticator {
  verify(authorizationHeader: string | undefined): Promise<boolean>;
}

/**
 * A queue backed by Cloud Tasks, which calls the worker back with an OIDC token.
 *
 * @throws {Error} When Cloud Tasks is not configured.
 */
export function createCloudTasksQueue(
  config: Config,
  client = new CloudTasksClient(),
  taskId: () => string = randomUUID,
  sleep: (ms: number) => Promise<void> = wait,
): TaskQueue {
  const tasks = config.tasks;
  if (!tasks) {
    throw new Error('cloud tasks is not configured');
  }

  const parent = client.queuePath(tasks.project, tasks.location, tasks.queue);

  return {
    async enqueue(slug) {
      const name = client.taskPath(tasks.project, tasks.location, tasks.queue, taskId());
      const request = {
        parent,
        task: {
          name,
          httpRequest: {
            httpMethod: 'POST' as const,
            url: `${tasks.workerUrl}/internal/generate`,
            headers: { 'content-type': 'application/json' },
            body: Buffer.from(JSON.stringify({ repo: slug.slug })).toString('base64'),
            oidcToken: {
              serviceAccountEmail: tasks.invokerServiceAccount,
              audience: tasks.workerUrl,
            },
          },
          dispatchDeadline: { seconds: 900 },
        },
      };

      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
        try {
          await client.createTask(request);
          return;
        } catch (error) {
          const status = statusOf(error);
          if (status !== undefined && CREATED.has(status)) return;
          if (status !== undefined && NOT_CREATED.has(status)) {
            throw new TaskNotCreatedError(error);
          }
          if (attempt === CREATE_ATTEMPTS - 1) throw error;

          // The task name makes retries idempotent: a committed first attempt answers
          // ALREADY_EXISTS instead of creating duplicate paid work.
          await sleep(BACKOFF_MS * 2 ** attempt);
        }
      }
    },
  };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'number' ? error.code : undefined;
}

/**
 * Verifies the OIDC token on a worker request against the invoker service account.
 *
 * @returns An authenticator that refuses everything when no queue is configured.
 */
export function createTaskAuthenticator(config: Config): TaskAuthenticator {
  const tasks = config.tasks;
  const client = new OAuth2Client();

  return {
    async verify(authorizationHeader) {
      if (!tasks) return false;

      const token = authorizationHeader?.match(/^Bearer (.+)$/i)?.[1];
      if (!token) return false;

      try {
        const ticket = await client.verifyIdToken({
          idToken: token,
          audience: tasks.workerUrl,
        });
        const payload = ticket.getPayload();
        return payload?.email === tasks.invokerServiceAccount && payload.email_verified === true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * A queue that just runs the job in-process, for a laptop with no Cloud Tasks.
 *
 * Production always goes through the real queue, so work survives the browser tab.
 */
export function createInlineQueue(run: (slug: RepoSlug) => Promise<void>): TaskQueue {
  return {
    enqueue(slug) {
      void run(slug);
      return Promise.resolve();
    },
  };
}
