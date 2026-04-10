import fs from "node:fs/promises";
import path from "node:path";
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_ABSTRACT_CHUNK_SIZE = 1200;
const ARTICLE_TABLE = "pubmed_articles";
const CHUNK_TABLE = "evidence_chunks";
const INGEST_TABLE = "pubmed_ingest_files";
const ARTICLE_COLUMNS = new Set([
  "pmid",
  "doi",
  "pmcid",
  "title",
  "abstract",
  "full_text",
  "has_full_text",
  "content_source",
  "authors",
  "journal",
  "publication_date",
  "publication_year",
  "publication_types",
  "mesh_terms",
  "is_deleted",
]);
const CHUNK_COLUMNS = new Set([
  "pmid",
  "chunk_type",
  "content",
  "metadata",
  "embedding",
]);
const INGEST_COLUMNS = new Set([
  "file_name",
  "filename",
  "source_path",
  "status",
  "article_count",
  "chunk_count",
  "error_message",
  "metadata",
  "completed_at",
  "updated_at",
]);

function parseArgs(argv) {
  const args = {
    input: "",
    batchSize: DEFAULT_BATCH_SIZE,
    abstractChunkSize: DEFAULT_ABSTRACT_CHUNK_SIZE,
    dryRun: false,
  };

  for (const rawArg of argv) {
    if (rawArg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    const [key, ...rest] = rawArg.split("=");
    const value = rest.join("=");

    if (key === "--input") {
      args.input = value;
    } else if (key === "--batch-size") {
      args.batchSize = Number(value || DEFAULT_BATCH_SIZE);
    } else if (key === "--abstract-chunk-size") {
      args.abstractChunkSize = Number(value || DEFAULT_ABSTRACT_CHUNK_SIZE);
    }
  }

  return args;
}

function normalizeText(value, maxLength = 20000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeArray(value, maxItems = 25) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item, 200))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeArray(parsed, maxItems);
      } catch (_error) {
        return trimmed
          .split(/[;|,]/)
          .map((item) => normalizeText(item, 200))
          .filter(Boolean)
          .slice(0, maxItems);
      }
    }

    return trimmed
      .split(/[;|,]/)
      .map((item) => normalizeText(item, 200))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  return [];
}

function normalizeAuthors(value, maxItems = 20) {
  return [...new Set(normalizeArray(value, maxItems).map((item) => normalizeText(item, 160)).filter(Boolean))];
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }

    const text = normalizeText(value);
    if (text) {
      return value;
    }
  }

  return "";
}

function inferPublicationYear(publicationDate, rawYear) {
  const year = normalizeText(rawYear, 4);
  if (year && /^\d{4}$/.test(year)) {
    return year;
  }

  const normalizedDate = normalizeText(publicationDate, 20);
  const match = normalizedDate.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  const normalizedMonth = Math.min(Math.max(month, 1), 12);

  if ([1, 3, 5, 7, 8, 10, 12].includes(normalizedMonth)) {
    return 31;
  }

  if ([4, 6, 9, 11].includes(normalizedMonth)) {
    return 30;
  }

  return isLeapYear(year) ? 29 : 28;
}

function buildSafeIsoDate(yearRaw, monthRaw, dayRaw) {
  const year = Number(yearRaw);
  if (!Number.isInteger(year) || year < 1800 || year > 2200) {
    return "";
  }

  let month = Number(monthRaw);
  let day = Number(dayRaw);

  if (!Number.isInteger(month) || month <= 0) {
    month = 1;
  }

  if (!Number.isInteger(day) || day <= 0) {
    day = 1;
  }

  if (month > 12 && day <= 12) {
    [month, day] = [day, month];
  }

  month = Math.min(Math.max(month, 1), 12);
  const maxDay = daysInMonth(year, month);

  if (day > maxDay && day <= 12 && month <= 12) {
    const swappedMonth = day;
    const swappedDay = month;
    if (swappedMonth >= 1 && swappedMonth <= 12) {
      const swappedMaxDay = daysInMonth(year, swappedMonth);
      if (swappedDay >= 1 && swappedDay <= swappedMaxDay) {
        month = swappedMonth;
        day = swappedDay;
      } else {
        day = maxDay;
      }
    } else {
      day = maxDay;
    }
  } else {
    day = Math.min(Math.max(day, 1), maxDay);
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizePublicationDate(rawDate, fallbackYear = "") {
  const value = normalizeText(rawDate, 40);

  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return buildSafeIsoDate(year, month, day);
  }

  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-");
    return buildSafeIsoDate(year, month, 1);
  }

  if (/^\d{4}$/.test(value)) {
    return buildSafeIsoDate(value, 1, 1);
  }

  const normalized = value.replace(/\//g, "-");
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
    const [year, month, day] = normalized.split("-");
    return buildSafeIsoDate(year, month, day);
  }

  if (fallbackYear && /^\d{4}$/.test(fallbackYear)) {
    return `${fallbackYear}-01-01`;
  }

  return "";
}

function normalizeRecord(rawRecord) {
  const pmid = normalizeText(
    firstNonEmpty(rawRecord.pmid, rawRecord.PMID, rawRecord.uid),
    32
  );
  const title = normalizeText(
    firstNonEmpty(
      rawRecord.title,
      rawRecord.Title,
      rawRecord.article_title,
      rawRecord.ArticleTitle
    ),
    1000
  );
  const abstractText = normalizeText(
    firstNonEmpty(
      rawRecord.abstract,
      rawRecord.Abstract,
      rawRecord.abstract_text,
      rawRecord.abstractText,
      rawRecord.AbstractText,
      Array.isArray(rawRecord.abstracts) ? rawRecord.abstracts.join(" ") : ""
    ),
    20000
  );
  const fullText = normalizeText(
    firstNonEmpty(
      rawRecord.full_text,
      rawRecord.fullText,
      rawRecord.body_text,
      rawRecord.body,
      rawRecord.article_body
    ),
    120000
  );
  const journal = normalizeText(
    firstNonEmpty(
      rawRecord.journal,
      rawRecord.Journal,
      rawRecord.journal_title,
      rawRecord.fulljournalname
    ),
    300
  );
  const publicationDate = normalizeText(
    firstNonEmpty(
      rawRecord.publication_date,
      rawRecord.PublicationDate,
      rawRecord.pubdate,
      rawRecord.date
    ),
    40
  );
  const publicationYear = inferPublicationYear(
    publicationDate,
    firstNonEmpty(
      rawRecord.publication_year,
      rawRecord.PublicationYear,
      rawRecord.pub_year,
      rawRecord.year
    )
  );
  const normalizedPublicationDate = normalizePublicationDate(
    publicationDate,
    publicationYear
  );

  return {
    pmid,
    doi: normalizeText(firstNonEmpty(rawRecord.doi, rawRecord.DOI), 160),
    pmcid: normalizeText(firstNonEmpty(rawRecord.pmcid, rawRecord.PMCID), 40),
    title,
    abstract: abstractText,
    full_text: fullText,
    authors: normalizeAuthors(
      firstNonEmpty(
        rawRecord.authors,
        rawRecord.Authors,
        rawRecord.author_names,
        rawRecord.authorNames
      ),
      20
    ),
    journal,
    publication_date: normalizedPublicationDate,
    publication_year: publicationYear,
    publication_types: normalizeArray(
      firstNonEmpty(
        rawRecord.publication_types,
        rawRecord.PublicationTypes,
        rawRecord.publicationTypeList
      ),
      15
    ),
    mesh_terms: normalizeArray(
      firstNonEmpty(rawRecord.mesh_terms, rawRecord.MeshTerms, rawRecord.mesh),
      25
    ),
    is_deleted: false,
  };
}

function splitAbstractIntoChunks(abstractText, maxLength) {
  const normalized = normalizeText(abstractText, 30000);
  if (!normalized) {
    return [];
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return [normalized.slice(0, maxLength)];
  }

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    const candidate = `${current} ${sentence}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = sentence;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.slice(0, 12);
}

function buildEvidenceChunks(record, abstractChunkSize) {
  const chunks = [];

  if (record.title) {
    chunks.push({
      pmid: record.pmid,
      chunk_type: "title",
      content: record.title,
      metadata: {
        source: "pubmed_import",
        field: "title",
      },
    });
  }

  const abstractChunks = splitAbstractIntoChunks(
    record.abstract,
    abstractChunkSize
  );

  for (let index = 0; index < abstractChunks.length; index += 1) {
    chunks.push({
      pmid: record.pmid,
      chunk_type: "abstract",
      content: abstractChunks[index],
      metadata: {
        source: "pubmed_import",
        field: "abstract",
      },
    });
  }

  const fullTextChunks = splitAbstractIntoChunks(
    record.full_text,
    abstractChunkSize
  );

  for (let index = 0; index < fullTextChunks.length; index += 1) {
    chunks.push({
      pmid: record.pmid,
      chunk_type: "full_text",
      content: fullTextChunks[index],
      metadata: {
        source: "pubmed_import",
        field: "full_text",
      },
    });
  }

  return chunks;
}

async function readInputRecords(inputPath) {
  const absolutePath = path.resolve(process.cwd(), inputPath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const extension = path.extname(absolutePath).toLowerCase();

  if (extension === ".jsonl" || extension === ".ndjson") {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error(
            `Invalid JSONL on line ${index + 1}: ${error.message}`
          );
        }
      });
  }

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed?.articles)) {
    return parsed.articles;
  }

  throw new Error(
    "Input file must be a JSON array, an object with an articles array, or a JSONL file."
  );
}

function pickColumns(source, columnSet) {
  const output = {};

  for (const [key, value] of Object.entries(source)) {
    if (!columnSet.has(key)) {
      continue;
    }

    output[key] = value;
  }

  return output;
}

function extractMissingColumnFromErrorMessage(message) {
  const text = String(message || "");
  const match = text.match(/Could not find the '([^']+)' column/i);
  return match ? match[1] : "";
}

async function withSchemaCacheRetry({ label, columnSet, action }) {
  let attempts = 0;

  while (attempts < 12) {
    try {
      return await action();
    } catch (error) {
      const missingColumn = extractMissingColumnFromErrorMessage(error.message);

      if (!missingColumn || !columnSet.has(missingColumn)) {
        throw error;
      }

      columnSet.delete(missingColumn);
      console.warn(
        `Warning: ${label} does not support column '${missingColumn}'. Retrying without it.`
      );
      attempts += 1;
    }
  }

  throw new Error(`Exceeded schema retry limit for ${label}.`);
}

function validateRequiredColumns(columnSet, requiredColumns, tableName) {
  const missing = requiredColumns.filter((column) => !columnSet.has(column));

  if (missing.length > 0) {
    throw new Error(
      `${tableName} is missing required columns: ${missing.join(", ")}`
    );
  }
}

async function upsertArticleBatch(records, articleColumns) {
  const supabaseAdmin = await getSupabaseAdmin();
  await withSchemaCacheRetry({
    label: ARTICLE_TABLE,
    columnSet: articleColumns,
    action: async () => {
      const rows = records.map((record) =>
        pickColumns(
          {
            has_full_text: Boolean(normalizeText(record.full_text, 10)),
            content_source: normalizeText(record.full_text, 10)
              ? "full_text"
              : "abstract_only",
            pmid: record.pmid,
            doi: record.doi,
            pmcid: record.pmcid,
            title: record.title,
            abstract: record.abstract,
            full_text: record.full_text,
            authors: record.authors,
            journal: record.journal,
            publication_date: record.publication_date || null,
            publication_year: record.publication_year || null,
            publication_types: record.publication_types,
            mesh_terms: record.mesh_terms,
            is_deleted: false,
          },
          articleColumns
        )
      );

      const { error } = await supabaseAdmin
        .from(ARTICLE_TABLE)
        .upsert(rows, { onConflict: "pmid" });

      if (error) {
        throw new Error(`Article upsert failed: ${error.message}`);
      }
    },
  });
}

async function deleteOldChunks(pmids) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { error: deleteError } = await supabaseAdmin
    .from(CHUNK_TABLE)
    .delete()
    .in("pmid", pmids);

  if (deleteError) {
    throw new Error(`Chunk cleanup failed: ${deleteError.message}`);
  }
}

async function insertChunkBatch(records, chunkColumns, abstractChunkSize) {
  let insertedCount = 0;

  await withSchemaCacheRetry({
    label: CHUNK_TABLE,
    columnSet: chunkColumns,
    action: async () => {
      const rows = records.flatMap((record) =>
        buildEvidenceChunks(record, abstractChunkSize).map((chunk) =>
          pickColumns(
            {
              pmid: chunk.pmid,
              chunk_type: chunk.chunk_type,
              content: chunk.content,
              metadata: chunk.metadata,
              embedding: null,
            },
            chunkColumns
          )
        )
      );

      if (rows.length === 0) {
        insertedCount = 0;
        return;
      }

      const { error: insertError } = await supabaseAdmin
        .from(CHUNK_TABLE)
        .insert(rows);

      if (insertError) {
        throw new Error(`Chunk insert failed: ${insertError.message}`);
      }

      insertedCount = rows.length;
    },
  });

  return insertedCount;
}

async function logIngestIfAvailable({
  inputPath,
  status,
  articleCount,
  chunkCount,
  ingestColumns,
  errorMessage,
}) {
  const supabaseAdmin = await getSupabaseAdmin();
  if (ingestColumns.size === 0) {
    return;
  }

  const metadata = {
    source: "scripts/import-pubmed.js",
    imported_at: new Date().toISOString(),
  };

  try {
    await withSchemaCacheRetry({
      label: INGEST_TABLE,
      columnSet: ingestColumns,
      action: async () => {
        const row = pickColumns(
          {
            file_name: path.basename(inputPath),
            filename: path.basename(inputPath),
            source_path: path.resolve(process.cwd(), inputPath),
            status,
            article_count: articleCount,
            chunk_count: chunkCount,
            error_message: errorMessage || null,
            metadata,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          ingestColumns
        );

        if (Object.keys(row).length === 0) {
          return;
        }

        const { error } = await supabaseAdmin.from(INGEST_TABLE).insert(row);
        if (error) {
          throw new Error(`Ingest log insert failed: ${error.message}`);
        }
      },
    });
  } catch (error) {
    console.warn(`Warning: ingest log skipped: ${error.message}`);
  }
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  node scripts/import-pubmed.js --input=PATH_TO_JSON_OR_JSONL [--batch-size=100] [--abstract-chunk-size=1200] [--dry-run]"
  );
}

let cachedSupabaseAdmin = null;

async function getSupabaseAdmin() {
  if (cachedSupabaseAdmin) {
    return cachedSupabaseAdmin;
  }

  const module = await import("../api/lib/clients.js");
  if (!module.supabaseAdmin) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  cachedSupabaseAdmin = module.supabaseAdmin;
  return cachedSupabaseAdmin;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input) {
    printUsage();
    throw new Error("Missing required --input argument.");
  }

  const rawRecords = await readInputRecords(args.input);
  const normalizedRecords = rawRecords
    .map(normalizeRecord)
    .filter((record) => record.pmid && record.title);

  if (normalizedRecords.length === 0) {
    throw new Error("No valid PubMed records were found in the input file.");
  }

  const uniqueRecords = [...new Map(normalizedRecords.map((record) => [record.pmid, record])).values()];
  const estimatedChunkCount = uniqueRecords.reduce(
    (total, record) =>
      total + buildEvidenceChunks(record, args.abstractChunkSize).length,
    0
  );

  console.log(`Parsed ${rawRecords.length} raw records.`);
  console.log(`Prepared ${uniqueRecords.length} unique article records.`);
  console.log(`Prepared ${estimatedChunkCount} evidence chunks.`);

  if (args.dryRun) {
    console.log("Dry run complete. No database changes were made.");
    return;
  }

  const articleColumns = ARTICLE_COLUMNS;
  validateRequiredColumns(articleColumns, ["pmid", "title"], ARTICLE_TABLE);

  const chunkColumns = CHUNK_COLUMNS;
  validateRequiredColumns(
    chunkColumns,
    ["pmid", "chunk_type", "content"],
    CHUNK_TABLE
  );

  const ingestColumns = INGEST_COLUMNS;

  let importedArticles = 0;
  let importedChunks = 0;
  const dbTimings = { upsertMs: 0, chunkDeleteMs: 0, chunkInsertMs: 0, batches: 0 };
  const importStartedAt = Date.now();

  try {
    for (let index = 0; index < uniqueRecords.length; index += args.batchSize) {
      const batch = uniqueRecords.slice(index, index + args.batchSize);
      const pmids = batch.map((record) => record.pmid);

      // Upsert articles and delete old chunks in parallel (independent tables).
      // Chunk insert must wait for the delete to finish.
      const upsertStart = Date.now();
      await Promise.all([
        upsertArticleBatch(batch, articleColumns),
        deleteOldChunks(pmids),
      ]);
      const upsertMs = Date.now() - upsertStart;
      dbTimings.upsertMs += upsertMs;

      const chunkStart = Date.now();
      const chunkCount = await insertChunkBatch(
        batch,
        chunkColumns,
        args.abstractChunkSize
      );
      const chunkMs = Date.now() - chunkStart;
      dbTimings.chunkDeleteMs += chunkMs;
      dbTimings.batches += 1;

      importedArticles += batch.length;
      importedChunks += chunkCount;

      const avgUpsertMs = Math.round(dbTimings.upsertMs / dbTimings.batches);
      const avgChunkMs = Math.round(dbTimings.chunkDeleteMs / dbTimings.batches);

      console.log(
        `  ${importedArticles}/${uniqueRecords.length} articles, ${importedChunks} chunks | batch: upsert+delete ${upsertMs}ms, insert ${chunkMs}ms | avg: upsert+delete ${avgUpsertMs}ms, insert ${avgChunkMs}ms`
      );
    }

    await logIngestIfAvailable({
      inputPath: args.input,
      status: "completed",
      articleCount: importedArticles,
      chunkCount: importedChunks,
      ingestColumns,
      errorMessage: "",
    });
  } catch (error) {
    await logIngestIfAvailable({
      inputPath: args.input,
      status: "failed",
      articleCount: importedArticles,
      chunkCount: importedChunks,
      ingestColumns,
      errorMessage: error.message,
    });
    throw error;
  }

  const totalImportMs = Date.now() - importStartedAt;
  const totalDbMs = dbTimings.upsertMs + dbTimings.chunkDeleteMs;
  console.log("");
  console.log("Import complete.");
  console.log(`  Articles upserted: ${importedArticles}`);
  console.log(`  Chunks inserted:   ${importedChunks}`);
  console.log(`  Total time:        ${(totalImportMs / 1000).toFixed(1)}s`);
  console.log(`  DB write time:     ${(totalDbMs / 1000).toFixed(1)}s (${((totalDbMs / totalImportMs) * 100).toFixed(0)}% of total)`);
  console.log(`  Avg upsert/batch:  ${dbTimings.batches > 0 ? Math.round(dbTimings.upsertMs / dbTimings.batches) : 0}ms`);
  console.log(`  Avg chunks/batch:  ${dbTimings.batches > 0 ? Math.round(dbTimings.chunkDeleteMs / dbTimings.batches) : 0}ms`);
  console.log("Next step: run node scripts/embed-evidence.js");
}

main().catch((error) => {
  console.error("IMPORT ERROR:");
  console.error(error);
  process.exit(1);
});
