# SAMA 2.0 User Guide

Version: 2026-11-25
Audience: field service engineers, diagnostic assistants, internal testers

Chinese version: [使用说明.md](使用说明.md).

---

## 1. What SAMA Is

SAMA 2.0 is a fault-diagnosis assistant for CNC grinding machines and machine tools.

Describe the following:

- Machine family or model
- Fault symptom
- Idle or during grinding
- Cold or warm machine
- Alarm number, if any
- Repairs already attempted

SAMA will:

1. Decide whether the case is simple, missing information, or complex;
2. Generate multiple candidate diagnostic plans in parallel;
3. Search the local knowledge base and historical cases, then score each plan;
4. Select one primary direction and provide troubleshooting steps, evidence and citations.

The output is a **direction to be verified**. It is not an on-site maintenance instruction and does not replace safety confirmation or the manufacturer's manual.

---

## 2. Repository Layout

```
SAMA/
├─ README.md
├─ 使用说明.md
├─ USER-GUIDE.md
└─ sama2.0/
   ├─ server.mjs          web server and API
   ├─ graph.mjs           main diagnosis pipeline
   ├─ public/             front-end pages
   ├─ sama-sqlite/        SQLite database adapter
   ├─ scripts/            term-graph build, database preparation
   ├─ tests/              database tests
   └─ data/               database files (not tracked by Git)
```

The database file is not uploaded with the repository and must be obtained separately.

---

## 3. Requirements

### Option A: run from source

- Windows 10/11 x64
- Node.js **22.13 or newer**
- At least 3 GB of free disk space (the database is about 1.5 GB)

### Option B: use the provided source archive

The archive already contains:

- `runtime\node.exe` (Node 22)
- `sama2.0\node_modules` (runtime dependencies)

You do not need to install Node, and you do not need to run `npm install`.

---

## 4. First Start

### 4.1 Place the database

This repository does not include the database; you must import it yourself. The easiest path is to put the file at:

```
sama2.0/data/sama_full.sqlite
```

See [Section 7 Importing the Database](#7-importing-the-database-step-by-step) for full details (three ways to connect, split-archive restore, verification and switching databases).

If the `data` folder does not exist, create it.

You may also keep it anywhere else and set the path before starting:

```powershell
$env:SAMA2_SQLITE_PATH='D:\SAMA\SAMA-DB-20261122\sama_full.sqlite'
```

### 4.2 Start from source

```powershell
cd sama2.0
npm ci
npm start
```

If no database parts are present, `npm ci` skips automatic restore and does not fail.

### 4.3 Start from the archive

After extracting, double-click in the root folder:

```
start.bat
```

Or manually:

```powershell
cd sama2.0
..\runtime\node.exe server.mjs
```

### 4.4 Open the page

Open in a browser:

```
http://127.0.0.1:3920/
```

If the port is in use:

```powershell
$env:SAMA2_PORT='3921'
npm start
```

Then open `http://127.0.0.1:3921/`.

---

## 5. Configure the API Key

SAMA calls a large language model to generate plans. On first use, fill in the **Settings** panel at the bottom right of the page:

- API Key
- Base URL (default `https://api.deepseek.com`)
- Model (default `deepseek-chat`)
- Judge model (optional, defaults to the same model)
- Max steps (default 8)

Settings are stored only in the browser's `localStorage` and are never uploaded to Git.

You may also create:

```
sama2.0/settings.json
```

See `sama2.0/settings.example.json` for the format. Never commit your own key.

---

## 6. How to Ask

### 6.1 Recommended phrasing

Include these five elements when possible:

```
machine model/family + symptom + idle or grinding + cold or warm + alarm code / repairs already tried
```

Examples:

```
Takahashi cylindrical grinder, during grinding, warm machine, spindle heating and vibrating, slight abnormal noise even when idle.
```

```
STUDER cylindrical grinder, grinding a slender shaft, warm machine, chatter marks on the workpiece surface. Wheel and bearings already replaced, no improvement.
```

```
FANUC machining center, tool magazine stops mid-way during tool change, tool does not reach position, no alarm.
```

### 6.2 When information is incomplete

If the model, symptom, operating condition or thermal state is missing, SAMA enters "needs more information":

- The original question is kept;
- Simply type the missing detail in the input box;
- There is no need to repeat the whole question.

### 6.3 Page features

| Feature | Description |
|---|---|
| `详情` / Detail | Show or hide the diagnosis process |
| `EN / 中文` | Switch UI and answer language |
| `联网兜底` / Web fallback | Allow web search when local material is insufficient |
| `强制五路` / Force five lanes | Skip simple-case routing and always run five lanes |
| Inspector panel | Route, evidence, candidate plans, scores and flow |
| Candidate plans | Best plan plus a runner-up for comparison |
| Scoring table | Accuracy, safety, feasibility, completeness, brevity |

### 6.4 Language switching

Use `EN / 中文` in the top right:

- The static UI, examples, settings and inspector all switch together;
- In English mode, plans, follow-up questions, scoring tables and audit appendices are in English;
- English mode does not quote Chinese source text verbatim; it paraphrases in English and preserves citation IDs;
- The choice is stored in the browser.

You can also pin the default language with an environment variable:

```powershell
$env:SAMA2_LANGUAGE='en'
```

---

## 7. Importing the Database (step by step)

> **Important**: this repository does **not** include the database. SAMA needs a local SQLite knowledge base to diagnose properly.
> Without it the page still opens, but only a few sample notes under `knowledge/` are available, so retrieval and diagnostic quality drop noticeably.

### 7.1 Obtain the database file

The database is a **single local SQLite file**, usually named `sama_full.sqlite`, about 1.4 GB in size.

- It is not an HTTP service, and not MySQL or PostgreSQL.
- It is not distributed with the code repository; ask the maintainer or use the file distributed inside your team.
- If you received a split archive (several `part-000.gzpart` files plus a `manifest.json`), skip to 7.5.

After obtaining it, confirm the size looks right:

```powershell
Get-Item 'D:\SAMA\sama_full.sqlite' | Select-Object Name, @{n='GB';e={[math]::Round($_.Length/1GB,2)}}
```

### 7.2 Option 1: default location (easiest)

Create a `data` folder under `sama2.0/` and put the file inside:

```
sama2.0/
└─ data/
   └─ sama_full.sqlite
```

```powershell
New-Item -ItemType Directory -Force sama2.0\data
Copy-Item 'D:\SAMA\sama_full.sqlite' 'sama2.0\data\sama_full.sqlite'
```

Then just start the service; no configuration changes are needed:

```powershell
cd sama2.0
npm start
```

### 7.3 Option 2: environment variable

If the database lives on another drive or a shared folder, set the path before starting:

```powershell
$env:SAMA2_SQLITE_PATH='D:\SAMA\SAMA-DB-20261122\sama_full.sqlite'
cd sama2.0
npm start
```

Note: this only applies to the **current terminal window**. Closing the window or opening another terminal requires setting it again.

To make it permanent for the current Windows user:

```powershell
[Environment]::SetEnvironmentVariable('SAMA2_SQLITE_PATH','D:\SAMA\SAMA-DB-20261122\sama_full.sqlite','User')
```

Reopen the terminal afterwards for it to take effect.

### 7.4 Option 3: configuration file

Edit `sama2.0/sama-database.json`:

```json
{
  "enabled": true,
  "dbPath": "data/sama_full.sqlite",
  "mode": "reference"
}
```

Fields:

| Field | Description |
|---|---|
| `enabled` | Set to `false` to skip the database entirely and fall back to the Markdown notes under `knowledge/` |
| `dbPath` | Path relative to `sama2.0/`, or an absolute path |
| `mode` | Material usage mode, see 7.7 |

Resolution order, highest priority first:

**`SAMA2_SQLITE_PATH` environment variable → `dbPath` in `sama-database.json` → default `data/sama_full.sqlite`**

### 7.5 If you received a split archive

Some distributions ship as compressed parts:

```
database-pack/
├─ manifest.json
├─ part-000.gzpart
├─ part-001.gzpart
└─ ...
```

**Approach A: automatic restore**

Place the whole `database-pack` folder under `sama2.0/`, then run:

```powershell
cd sama2.0
npm run setup:db
```

`npm ci` also attempts the restore automatically during installation.

The restore does three things:

1. Verifies the SHA-256 of every part;
2. Decompresses and merges the parts into `data/sama_full.sqlite`;
3. Verifies the total size and fingerprint of the database.

Only when all three pass is the restore considered successful. Any failure cleans up the partial file and reports an error, so no corrupted file is left behind.

**Approach B: skip the restore**

If you do not want the install script to touch the database:

```powershell
$env:SAMA2_SKIP_DB_PREPARE='1'
npm ci
```

**Note**: if `data/sama_full.sqlite` already exists with a different fingerprint, the script **refuses to overwrite** it and keeps your file. To switch databases, back up and move the old file away first.

### 7.6 Confirm the database is actually connected

First, check the terminal after startup for any database-related errors.

Second, ask a specific question in the page, then look at the evidence citations in the diagnosis inspector:

- Seeing `sqlite_curated:number`, `sqlite_fragment:number` or `sqlite_case:number` → **the database is connected**.
- Only seeing citations like `knowledge/xxx.md#0-700` → the system is still using Markdown notes, so **the database is not connected**.

You can also check the file directly:

```powershell
Test-Path sama2.0\data\sama_full.sqlite
```

### 7.7 Choosing a material mode

`mode` controls what level of material can be retrieved:

| Mode | Description |
|---|---|
| `reference` | Default. Source reference, including fragments whose professional review is not yet complete |
| `reviewed` | Only reviewed pilot entries; unreviewed source text is not returned |
| `production` | Requires completed professional review and production approval |
| `catalog` | Source browsing, including proprietary material such as circuits and LADs, but explicitly not approved for maintenance work |

For everyday diagnosis, keep `reference`.

### 7.8 Database version requirements

SAMA only accepts database structures it was built against, and checks two version markers:

```
release_meta.full_archive_version = '1'
release_meta.direct_adapter_version = '1'
```

Dropping in an arbitrary SQLite file **will not work**; startup reports "full archive version not supported" or "direct adapter version not supported".

If you genuinely need a different backend (MySQL, PostgreSQL, HTTP service), adapt these two files:

```
sama2.0/sama-sqlite/connection.mjs
sama2.0/sama-sqlite/library.mjs
```

### 7.9 Rebuilding the term graph after switching databases

The term co-occurrence graph is not distributed with the repository and is rebuilt automatically on first start with a new database.

If the page reports a mismatch between the graph and the database, rebuild manually:

```powershell
cd sama2.0
npm run build:graph
```

To force a rebuild:

```powershell
$env:SAMA2_GRAPH_REBUILD='1'
npm start
```

### 7.10 Notes

- Never commit the database file to Git; `sama2.0/data/` is already in `.gitignore`.
- The database is opened **read-only**; SAMA never modifies your data.
- Do not put the database in a cloud-sync folder; it may be locked during startup or read as an incomplete file.
- Before switching to a new database version, back up the old one, then replace it as in 7.2 or 7.5.
- We make no guarantee about the completeness, accuracy or suitability of the database content.

---

## 8. API

### 8.1 Request

```http
POST http://127.0.0.1:3920/api/ask
Content-Type: application/json
```

Body:

```json
{
  "userText": "STUDER cylindrical grinder, during grinding, warm machine, spindle heating and vibrating",
  "language": "en",
  "apiKey": "sk-...",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "maxStep": 8,
  "allowWeb": false,
  "forceMultiAgent": false
}
```

`language` accepts `zh` or `en`.

### 8.2 PowerShell example

```powershell
$body = @{
  userText = 'STUDER cylindrical grinder, during grinding, warm machine, spindle vibration, no alarm'
  language = 'en'
  apiKey   = 'sk-...'
  baseUrl  = 'https://api.deepseek.com'
  model    = 'deepseek-chat'
  maxStep  = 8
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri 'http://127.0.0.1:3920/api/ask' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body
```

### 8.3 Response

Main fields:

| Field | Description |
|---|---|
| `ok` | Whether the request succeeded |
| `route` | `simple` / `need_info` / `complex` / `no_plan` |
| `answer` | Final answer in Markdown |
| `plans` | Candidate plans from each lane |
| `judge` | Scores and ranking |
| `accuracy` | Accuracy audit of the winning plan |
| `facts` | Extracted model, symptom and operating condition |
| `questions` | Follow-up questions |
| `session` | Session object to pass back with follow-up input |

### 8.4 Health check

```http
GET http://127.0.0.1:3920/api/health
```

Returns service status, whether an API key is configured, and the current model name. It does **not** return database status; verify the database as described in 7.6.

---

## 9. Troubleshooting

### The page loads but no material is retrieved

The database is not connected. Import it as described in Section 7, then check:

```powershell
Test-Path sama2.0\data\sama_full.sqlite
```

Or confirm that `SAMA2_SQLITE_PATH` points to the correct file.

### "Please set an API key in Settings"

Enter the key under Settings, or deploy with server-side configuration.

### Port already in use

```powershell
$env:SAMA2_PORT='3921'
npm start
```

### `npm ci` reports missing database parts

Expected. The repository no longer ships the database through Git, so the install skips restore. Set `SAMA2_SQLITE_PATH` instead.

### The answer says "no deliverable plan"

Usually a model API failure, an invalid key, or a timeout. Check the key, base URL and model name in Settings.

### English questions are routed to "needs more information"

Make sure you are on the current version, which supports English model, symptom, condition and thermal-state recognition. Hard-refresh old pages with `Ctrl+F5`.

### Term graph fingerprint mismatch

```powershell
cd sama2.0
npm run build:graph
```

---

## 10. Safety and Limits

- SAMA provides directions to be verified, not maintenance work orders;
- Before removing a spindle or grinding wheel, or performing work under pressure or live power, isolate energy and confirm site safety;
- Values, oil brands, clearances and torques in the database are historical references only and must not be used directly as machine-specific parameters;
- Historical cases may have unknown machine models and must not be treated as validated procedures for the same model;
- Content without completed professional review is marked as pending verification;
- Never commit an API key to Git or share it with unrelated parties.

---

## 11. Stopping the Service

Press `Ctrl+C` in the window that started the service.

If you launched it with `start.bat`, close the command window.

---

## 12. Version and Support

This repository keeps the SAMA source code only. The database, evaluation reports and historical experiment material are not distributed here.

Check Section 9 first. If the problem persists, provide:

- A screenshot of the page error
- The last 20 lines of terminal logs
- The output of `GET /api/health`
- Whether you run from source or from an archive
