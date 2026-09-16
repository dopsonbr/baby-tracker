import { readFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { createDatabase } from "./db.js"
const directory = fileURLToPath(new URL("../migrations/", import.meta.url))
const files = (await readdir(directory))
  .filter((file) => file.endsWith(".sql"))
  .sort()
await createDatabase().transaction(async (sql) => {
  await sql.query("SELECT pg_advisory_xact_lock(729440916)")
  await sql.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
  )
  for (const name of files) {
    const migration = await readFile(`${directory}/${name}`, "utf8")
    const checksum = createHash("sha256").update(migration).digest("hex")
    const { rows } = await sql.query(
      "SELECT checksum FROM schema_migrations WHERE name=$1",
      [name]
    )
    if (rows[0]) {
      if (rows[0].checksum !== checksum)
        throw new Error(`Applied migration was modified: ${name}`)
      continue
    }
    await sql.query(migration)
    await sql.query(
      "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
      [name, checksum]
    )
    console.log(`Applied ${name}`)
  }
})
