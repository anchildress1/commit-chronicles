import { CloudTasksClient } from '@google-cloud/tasks';
import { OAuth2Client } from 'google-auth-library';
import type { Config } from './config.js';
import type { RepoSlug } from '../shared/slug.js';

// Generation must outlive the tab and cost nothing while idle. Detached work would need
// --no-cpu-throttling, which bills instance time. A queued task runs inside a request, so
// CPU is billed only while working and the service still scales to zero.
export interface TaskQueue {
  enqueue(slug: RepoSlug): Promise<void>;
}

/** Verifies that a worker request really came from our queue, not from the open internet. */
export interface TaskAuthenticator {
  verify(authorizationHeader: string | undefined): Promise<boolean>;
}

export function createCloudTasksQueue(config: Config): TaskQueue {
  const tasks = config.tasks;
  if (!tasks) {
    throw new Error('cloud tasks is not configured');
  }

  const client = new CloudTasksClient();
  const parent = client.queuePath(tasks.project, tasks.location, tasks.queue);

  return {
    async enqueue(slug) {
      await client.createTask({
        parent,
        task: {
          httpRequest: {
            httpMethod: 'POST',
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
      });
    },
  };
}

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

/** Local dev only: no queue exists on a laptop. Production always goes through Cloud Tasks. */
export function createInlineQueue(run: (slug: RepoSlug) => Promise<void>): TaskQueue {
  return {
    enqueue(slug) {
      void run(slug);
      return Promise.resolve();
    },
  };
}
