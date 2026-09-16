import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { createDatabase } from "./db.js"
import { importLegacy, LegacyImportConflict } from "./import-legacy.js"

try {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      target: { type: "string" },
      apply: { type: "boolean", default: false },
    },
    strict: true,
  })
  if (
    !values.file ||
    (values.target !== "development" && values.target !== "production")
  )
    throw new Error(
      "Usage: import-legacy-cli.ts --file <private-payload.json> --target development|production [--apply]"
    )
  const payload: unknown = JSON.parse(await readFile(values.file, "utf8"))
  const summary = await importLegacy(createDatabase(), payload, {
    target: values.target,
    apply: values.apply,
  })
  console.log(JSON.stringify(summary, null, 2))
} catch (error) {
  // Do not print driver errors, input values, credentials, or raw private records.
  console.error(
    error instanceof LegacyImportConflict
      ? error.message
      : "Import failed. Check arguments, payload validation, database connection and migrations. No partial import is committed; an uncertain connection failure can be reconciled by rerunning the same payload."
  )
  process.exitCode = 1
}
