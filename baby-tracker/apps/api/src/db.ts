import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless"
import ws from "ws"
import { required } from "./config.js"
export interface QueryResult {
  rows: Record<string, unknown>[]
}
export interface SqlClient {
  query(sql: string, values?: unknown[]): Promise<QueryResult>
}
export interface Database {
  transaction<T>(work: (sql: SqlClient) => Promise<T>): Promise<T>
}
neonConfig.webSocketConstructor = ws
export function createDatabase(): Database {
  // Each request owns its pool, closing sockets before returning from a Function.
  return {
    async transaction<T>(work: (sql: SqlClient) => Promise<T>): Promise<T> {
      const pool = new Pool({
        connectionString: required("DATABASE_URL"),
        max: 1,
        connectionTimeoutMillis: 10000,
      })
      let client: PoolClient | undefined
      try {
        client = await pool.connect()
        await client.query("BEGIN")
        const result = await work(client as SqlClient)
        await client.query("COMMIT")
        return result
      } catch (error) {
        // A failed COMMIT can leave its outcome uncertain; request receipts make retries safe.
        if (client) await client.query("ROLLBACK").catch(() => undefined)
        throw error
      } finally {
        client?.release()
        await pool.end()
      }
    },
  }
}
