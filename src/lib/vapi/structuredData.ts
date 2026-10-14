// Structured call data from a Vapi end-of-call-report.
//
// Two sources exist and both are live: the legacy `analysisPlan` delivers
// `message.analysis.structuredData` (a flat object), while the dashboard's
// newer "Structured Outputs" arrive as `message.artifact.structuredOutputs`
// — an object keyed by structured-output id whose values look like
// `{ name, result }`. `result` is an object for multi-field outputs and a
// bare scalar for single-field ones.
//
// We flatten both into the one flat record the webhook (and the stored
// `ContactCall.analysis` JSON) has always expected. Everything here is
// defensive: Vapi payload shapes drift, and a webhook that throws gets
// retried forever.

type StructuredSource = {
  analysis?: { structuredData?: unknown };
  artifact?: { structuredOutputs?: unknown };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Flatten Vapi's Structured Outputs map into a single record.
 * Object results are shallow-merged in entry order; scalar and array results
 * are stored under the entry's `name` (falling back to its id). Later entries
 * win on key conflict.
 */
function flattenStructuredOutputs(raw: unknown): Record<string, unknown> {
  const outputs = asRecord(raw);
  if (!outputs) return {};

  const merged: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(outputs)) {
    const output = asRecord(entry);
    if (!output) continue;
    const result = output["result"];
    if (result === undefined) continue;

    const resultRecord = asRecord(result);
    if (resultRecord) {
      Object.assign(merged, resultRecord);
      continue;
    }
    const name = typeof output["name"] === "string" && output["name"] ? output["name"] : id;
    merged[name] = result;
  }
  return merged;
}

/**
 * Structured data for a call, read from either Vapi source.
 * The legacy `analysis.structuredData` wins on conflict; keys it does not
 * define are filled in from Structured Outputs. Returns null when neither
 * source yields any usable key.
 */
export function extractStructuredData(
  message: StructuredSource | null | undefined
): Record<string, unknown> | null {
  const source = asRecord(message);
  if (!source) return null;

  const legacy = asRecord(asRecord(source["analysis"])?.["structuredData"]) ?? {};
  const fromOutputs = flattenStructuredOutputs(asRecord(source["artifact"])?.["structuredOutputs"]);

  const merged = { ...fromOutputs, ...legacy };
  return Object.keys(merged).length > 0 ? merged : null;
}
