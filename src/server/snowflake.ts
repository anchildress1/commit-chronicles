import snowflake from 'snowflake-sdk';
import type { Config } from './config.js';
import type { ReadRepoResult } from './card/types.js';

/**
 * The one call this service makes into the warehouse.
 *
 * `READ_REPO` ingests on a cold repo, runs the detector, calls Cortex once, and returns the
 * card payload. Cloud Run computes no analysis, so there is deliberately nothing else here.
 */
export interface SnowflakeClient {
  readRepo(owner: string, repo: string): Promise<ReadRepoResult>;
  close(): Promise<void>;
}

snowflake.configure({ logLevel: 'WARN' });

export function createSnowflakeClient(config: Config): SnowflakeClient {
  const { snowflake: sf } = config;

  const pool = snowflake.createPool(
    {
      account: sf.account,
      username: sf.username,
      // PATs are role-locked at creation and authenticate as a token, not a password.
      authenticator: 'PROGRAMMATIC_ACCESS_TOKEN',
      token: sf.token,
      warehouse: sf.warehouse,
      database: sf.database,
      schema: sf.schema,
      role: sf.role,
      clientSessionKeepAlive: false,
    },
    { max: 4, min: 0 },
  );

  return {
    async readRepo(owner, repo) {
      const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        void pool.use(
          async (connection) =>
            new Promise<void>((settle) => {
              connection.execute({
                sqlText: 'CALL READ_REPO(?, ?)',
                binds: [owner, repo],
                complete: (error, _statement, result) => {
                  if (error) reject(error);
                  else resolve((result ?? []) as Record<string, unknown>[]);
                  settle();
                },
              });
            }),
        );
      });

      const value = rows[0]?.['READ_REPO'];
      if (value === undefined || value === null) {
        throw new Error(`READ_REPO returned no payload for ${owner}/${repo}`);
      }

      // The driver hands back VARIANT as a JSON string unless the column is typed.
      const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
      return parsed as ReadRepoResult;
    },

    async close() {
      await pool.drain();
      await pool.clear();
    },
  };
}
