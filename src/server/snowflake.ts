import snowflake from 'snowflake-sdk';
import type { Config } from './config.js';
import type { CardPayload, ReadRepoResult } from './card/types.js';

/**
 * The one call this service makes into the warehouse.
 *
 * `READ_REPO` ingests on a cold repo, runs the detector, calls Cortex once, and returns the
 * card payload. Cloud Run computes no analysis, so there is deliberately nothing else here.
 */
export interface SnowflakeClient {
  readRepo(owner: string, repo: string): Promise<ReadRepoResult>;
  /**
   * The card this repo already has, read straight back out of CARDS.
   *
   * Spends nothing: the words were written and paid for once, so a renderer change never
   * costs a second Cortex call.
   *
   * @returns Null when the repo has no card yet.
   */
  fetchCard(owner: string, repo: string): Promise<CardPayload | null>;
  /** Every repo that already has a card. */
  listCards(): Promise<{ owner: string; repo: string }[]>;
  close(): Promise<void>;
}

snowflake.configure({ logLevel: 'WARN' });

/**
 * Run one statement on a borrowed connection.
 *
 * The driver is callback-based, so this is where the promise is made. Lifted out of the pool
 * callback rather than nested inside it: the two concerns are the statement and the borrowing,
 * and only the statement lives here.
 */
function runStatement(
  connection: snowflake.Connection,
  sqlText: string,
  binds: string[],
): Promise<Record<string, unknown>[]> {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete: (error, _statement, result) => {
        if (error) reject(error);
        else resolve((result ?? []) as Record<string, unknown>[]);
      },
    });
  });
}

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

  // A connection that cannot be acquired, or a pool that is draining, rejects out of `use`
  // and never reaches the statement at all. Returning its promise is what propagates that:
  // swallowed, it would leave the caller hanging and the repo stuck on `generating` until
  // the task deadline.
  const query = async (sqlText: string, binds: string[]): Promise<Record<string, unknown>[]> =>
    pool.use(async (connection) => runStatement(connection, sqlText, binds));

  // The driver hands back VARIANT as a JSON string unless the column is typed.
  const variant = (value: unknown): unknown =>
    typeof value === 'string' ? JSON.parse(value) : value;

  return {
    async readRepo(owner, repo) {
      const rows = await query('CALL READ_REPO(?, ?)', [owner, repo]);

      const value = rows[0]?.['READ_REPO'];
      if (value === undefined || value === null) {
        throw new Error(`READ_REPO returned no payload for ${owner}/${repo}`);
      }

      return variant(value) as ReadRepoResult;
    },

    async fetchCard(owner, repo) {
      const rows = await query(
        'SELECT PAYLOAD FROM CARD_PAYLOAD WHERE REPO_OWNER = ? AND REPO_NAME = ?',
        [owner, repo],
      );

      const value = rows[0]?.['PAYLOAD'];
      return value === undefined || value === null ? null : (variant(value) as CardPayload);
    },

    async listCards() {
      const rows = await query(
        'SELECT REPO_OWNER, REPO_NAME FROM CARDS ORDER BY REPO_OWNER, REPO_NAME',
        [],
      );

      return rows.map((row) => ({
        owner: String(row['REPO_OWNER']),
        repo: String(row['REPO_NAME']),
      }));
    },

    async close() {
      await pool.drain();
      await pool.clear();
    },
  };
}
