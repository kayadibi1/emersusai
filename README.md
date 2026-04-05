# emersus ai Waitlist

Static waitlist website for a science-based AI chatbot focused on fitness, exercise, nutrition, and supplements.

## Files

- `docs/index.html` is the GitHub Pages source of truth.
- `docs/styles.css` contains the custom font, gradient, and interaction styles.
- `docs/script.js` handles the rotating prompt text and waitlist form submission.
- The root `index.html`, `styles.css`, and `script.js` mirror the `docs/` files for local preview convenience.

## Deploy on GitHub Pages

1. Push this repository to GitHub.
2. In the repository settings, open `Pages`.
3. Set the source to deploy from your default branch.
4. Choose the `/docs` folder.
5. The site will serve `docs/index.html`.

## Collect waitlist emails

GitHub Pages does not provide a backend for storing form submissions. To collect emails, use a form service such as Formspree, Basin, or Getform.

1. Create a form endpoint with your provider.
2. Open `docs/index.html`.
3. Add the endpoint URL to each `data-form-endpoint` attribute on the forms marked with `data-waitlist-form`.

Example:

```html
<form
  class="group flex max-w-md flex-col gap-0 sm:flex-row"
  data-form-endpoint="https://formspree.io/f/your-form-id"
  data-waitlist-form
  id="waitlist-form"
  method="post"
  novalidate
>
```

## Local preview

You can preview locally with any static server. For example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Emersus recommendation API

The repository now includes `POST /api/emersus/recommendation`, a coded Emersus workflow that:

- merges request profile context with the user's Supabase profile when available
- consults the Emersus knowledge database in Supabase when configured
- falls back to fresh web search through the OpenAI Responses API
- returns structured recommendations for training, nutrition, and mental performance
- includes sources, recency-aware ranking, and a confidence score

Expected request shape:

```json
{
  "question": "Build me a 3 day hypertrophy plan with zone 2 cardio.",
  "userId": "supabase:USER_UUID",
  "profile": {
    "goal": "gain muscle while keeping conditioning",
    "experience_level": "intermediate",
    "dietary_preferences": "high protein",
    "injuries_limitations": "none",
    "equipment_access": "full gym",
    "available_days_per_week": "4",
    "available_minutes_per_session": "75",
    "sleep_stress_context": "moderate work stress"
  }
}
```

## PubMed bulk import

The repository now includes a bulk importer at [scripts/import-pubmed.js](C:\Users\Sidar\Desktop\New folder\scripts\import-pubmed.js). It:

- reads a local `.json` or `.jsonl` PubMed export
- upserts rows into `public.pubmed_articles`
- rebuilds `public.evidence_chunks` for the imported PMIDs
- logs ingest metadata into `public.pubmed_ingest_files` when that table is available

Accepted input shapes:

```json
[
  {
    "pmid": "1000000002",
    "title": "Creatine monohydrate and hypertrophy",
    "abstract": "Full abstract text here.",
    "doi": "10.1000/example",
    "pmcid": "PMC123456",
    "journal": "Sports Medicine",
    "publication_date": "2024-05-10",
    "publication_year": "2024",
    "publication_types": ["Systematic Review"],
    "mesh_terms": ["Creatine", "Resistance Training"]
  }
]
```

or JSONL with one JSON object per line using the same fields.

### Import steps

1. Put your PubMed export file somewhere inside the project, for example:
   `C:\Users\Sidar\Desktop\New folder\data\pubmed-seed.jsonl`
2. Open PowerShell.
3. Change into the project folder:

```powershell
cd "C:\Users\Sidar\Desktop\New folder"
```

4. Run a dry run first:

```powershell
npm run import:pubmed -- --input="data\pubmed-seed.jsonl" --dry-run
```

5. If the counts look right, run the real import:

```powershell
npm run import:pubmed -- --input="data\pubmed-seed.jsonl"
```

6. After the import finishes, generate embeddings:

```powershell
npm run embed:evidence
```

7. Test retrieval:

```powershell
npm run test:retrieval
```

## PMC full-text export

The repository now also includes [scripts/fetch-pmc-fulltext.js](C:\Users\Sidar\Desktop\New folder\scripts\fetch-pmc-fulltext.js). It:

- searches PubMed by query
- maps PubMed IDs to PMC full-text IDs
- fetches PMC XML full text
- saves raw XML files locally
- writes importer-ready JSONL output
- hard-caps requests below the NCBI limit by default at `8 requests/second`

### Full-text fetch steps

1. Open PowerShell.
2. Change into the project folder:

```powershell
cd "C:\Users\Sidar\Desktop\New folder"
```

3. Run a dry run first:

```powershell
npm run fetch:pmc -- --query="creatine AND resistance training" --max-results=20 --dry-run
```

4. Run the real export:

```powershell
npm run fetch:pmc -- --query="creatine AND resistance training" --max-results=20 --output="data\pmc-fulltext.jsonl" --raw-dir="data\pmc-raw"
```

5. Import the generated JSONL into Supabase:

```powershell
npm run import:pubmed -- --input="data\pmc-fulltext.jsonl"
```

6. Generate embeddings:

```powershell
npm run embed:evidence
```

7. Test retrieval:

```powershell
npm run test:retrieval
```
