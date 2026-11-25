# SAMA 2.0 · CNC Machine Tool Fault Diagnosis Agent

**English** | [中文](README.zh.md)

SAMA 2.0 is a fault-diagnosis agent for CNC grinding machines and machine tools. Given the machine model, operating condition, thermal state, symptom or alarm code, it searches a local knowledge base and historical cases, generates multiple candidate plans, scores and ranks them with a Judge, and returns a **direction to be verified**, along with troubleshooting steps and cited sources.

It is not a general-purpose chatbot. It is a diagnostic pipeline with input gating, retrieval, multi-lane sampling, scoring and grounding checks.

> **Database declaration (read before use)**
>
> This repository **ships without any machine-tool knowledge data**. To use SAMA properly you **must import and supplement your own database**.
> Without a database the software can only read six short demo notes under `knowledge/`, so retrieval and diagnostic capability are very limited.
> See the [Database Declaration](#database-declaration) and [Section 7 of the user guide](USER-GUIDE.md#7-importing-the-database-step-by-step) for how to import it.

---

## Features

### Input Recognition

Diagnostic information is extracted automatically from a plain description, in Chinese or English.

- Recognizes machine families and models such as STUDER, Takahashi and MIKROSA, plus cylindrical, internal, centerless and surface grinders and machining centers.
- Recognizes symptoms: heat, vibration, abnormal noise, accuracy or surface finish problems, stick-slip, oil leaks, tool-change faults, start-up faults and alarms.
- Recognizes operating conditions: idle or during grinding, cold or warm machine.
- Recognizes constraints: no downtime allowed, no spare parts, no measuring instruments, no disassembly allowed. These influence the recommended plan instead of being ignored.

### Question Routing

Not every question goes through the same pipeline.

- Concept, principle and selection questions are answered directly without running a full diagnosis.
- Fault-troubleshooting questions start the full pipeline.
- Uncertain cases get an extra check, so simple questions are not over-processed.

### Follow-Up Questions

- If machine, symptom, idle/grinding, or cold/warm state is missing, SAMA asks for it and explains why it matters.
- Each item is asked at most twice; after that it continues with clearly marked assumptions instead of stalling.
- When supplementing, you only type the missing detail, not the whole question again.

### Multi-Plan Diagnosis

- Complex faults produce several diagnostic plans from different angles instead of a single answer.
- Each plan retrieves material and reasons independently, so the plans do not all think alike.
- If a plan times out or gets stuck partway, it still converges into a usable result instead of wasting the whole run.

### Scoring and Recommendation

- Every plan is scored on accuracy, safety, field feasibility, completeness and brevity.
- SAMA selects a primary plan and also returns the runner-up, so the site can choose again based on practical conditions.
- If scoring fails, it is marked honestly as "not scored" rather than inventing numbers.
- A separate safety spot check focuses on energy isolation, wheel guarding, and preventing live or pressurized work.

### Accuracy Review

- The recommended plan gets a second review covering accuracy, credibility, and the reasoning behind mechanism, concrete measures and expression of uncertainty.
- The review is appended to the answer so you can judge how much to trust the plan.

### Fact Checking

This is SAMA's most important safeguard.

- Specific values such as pressure, clearance, torque and dimensions must actually appear in the material retrieved for this run; otherwise they are explicitly marked "cannot be stated as fact".
- Citation IDs must genuinely come from this run's retrieval results; fabricated citations are removed.
- When no matching local machine case exists, SAMA says so clearly — that the direction is only a candidate drawn from nearby documents — instead of padding out a generic checklist.
- Values the user never mentioned are not invented; only readings present in the user's own text are accepted.

### Knowledge Retrieval

- A built-in local knowledge base covering curated entries, source material and historical cases, each with its scope, review status and limitations.
- Retrieval follows associations between terms to find material that is relevant but not worded the same way.
- Machine-family maintenance notes and measuring-point templates help identify where to look.
- When local material is insufficient, optional web search can supplement it, and web results must be marked as coming from the internet and requiring verification for the specific machine.
- The knowledge base is opened read-only; the model is never allowed to compose its own SQL.

### Interface and API

- Chinese and English, with the UI, follow-up questions, plans and scoring tables switching together; English mode paraphrases material while keeping citation IDs.
- A diagnosis inspector shows the decision basis, recognized information, plan scores and execution process.
- The last 12 questions are saved locally and can be reused with one click.
- Toggles for web fallback, forced multi-plan mode, detail display, and light/dark theme.
- Available both as a web app and from the command line, with an HTTP API for other programs.
- The API key is stored only in the browser; the server never writes it to disk or logs, so it is not exposed.

---

## Results

With only a limited amount of imported data (mainly mechanical engineering books and maintenance cases), SAMA 2.0 performs as follows:

| Question type | Accuracy of cause diagnosis and repair plans |
|---|---|
| Questions already covered by the database | **above 90%** |
| Questions not covered by the database | **35%–45%** |

- **Covered questions**: relevant entries are retrieved accurately, and the cause diagnosis plus repair plan can generally be used as a reference directly.
- **Uncovered questions**: the system still retrieves existing material, integrates scattered information and reasons over it, producing a usable direction and repair plan instead of simply answering "not found".
- **The gap between the two shows the value of data**: the more complete the database, the larger the share of uncovered questions that can be handled through reasoning.

> These figures come from internal testing under the current limited corpus. They will change with database size, material quality and machine-model coverage, and do not constitute any performance commitment.

---

## Quick Start

```sh
cd sama2.0
npm ci
npm start
```

Open <http://127.0.0.1:3920/> and enter your API key under Settings.

### Database

The database is a local SQLite file and is **not distributed with this repository**; you must import it yourself. The quickest way is to place it at `sama2.0/data/sama_full.sqlite`. See the [Database Declaration](#database-declaration) below, and [Section 7 of the user guide](USER-GUIDE.md#7-importing-the-database-step-by-step) for the complete steps.

### Requirements

- Node.js **22.13 or newer**
- At least 3 GB of free disk space (the database is about 1.5 GB)
- A model service compatible with the OpenAI API

---

## Database Declaration

**This repository contains no database and ships without any machine-tool knowledge data.** Before use you must prepare, import and supplement your own SQLite knowledge base; otherwise SAMA can only read the six short demo notes under `knowledge/`, and retrieval and diagnostic quality drop noticeably.

- **You must import and supplement it yourself**: the database is not distributed with the code. Ask the maintainer, or use the database file distributed inside your team. Adding new material and correcting entries is also the user's responsibility.
- **File form**: a single local SQLite file, usually named `sama_full.sqlite`, about 1.4 GB. It is not a remote service, and not MySQL or PostgreSQL.
- **How to import**: place it at `sama2.0/data/sama_full.sqlite`, or point to it with the `SAMA2_SQLITE_PATH` environment variable, or edit `sama-database.json`. Priority is: environment variable → configuration file → default location.
- **Full tutorial**: see [Section 7 of the user guide](USER-GUIDE.md#7-importing-the-database-step-by-step), covering split-archive restore, connection verification, material modes and switching databases.
- **No arbitrary database files**: an unrelated SQLite file will not work; it must satisfy this project's data-structure version requirements (the version markers in `release_meta`).
- **Read-only use**: the database is opened read-only; the program never modifies your data.
- **Never commit the database**: database files must not be committed to Git; `sama2.0/data/` is already in `.gitignore`.

> We do not distribute database content with the repository and make no guarantee about its completeness, accuracy or suitability. Values, brands and parameters in the database are historical references only and must not be used directly as machine-specific parameters.

---

## Structure

The main diagnosis pipeline is a LangGraph state graph; each lane runs its own graph.

```
sama2.0/
├─ server.mjs        web server and API
├─ graph.mjs         main diagnosis pipeline
├─ public/           front end
├─ sama-sqlite/      SQLite adapter
├─ scripts/          term-graph build, database preparation
└─ tests/            database tests
```

---

## Documentation

- [USER-GUIDE.md](USER-GUIDE.md) — full user guide (English)
- [使用说明.md](使用说明.md) — full user guide (Chinese)

---

## Disclaimer

**Please read this before use.**

1. **Not a professional maintenance instruction.** SAMA outputs diagnostic directions and troubleshooting suggestions to be verified. It is not a maintenance work order and must not be used directly as an on-site operating procedure.
2. **Human confirmation is required.** All conclusions must be independently judged by qualified maintenance personnel, taking into account the actual site conditions, equipment state and the manufacturer's manual. Before removing a spindle or grinding wheel, or performing any work under pressure or live power, isolate energy and confirm site safety.
3. **Data is for reference only.** Values, oil brands, clearances, torques and process parameters in the knowledge base are historical references and must not be used directly as machine-specific parameters. Equipment of a different batch or wear state may require completely different values.
4. **Cases are not validation.** Historical cases may involve unknown models, or models that are merely similar rather than identical. They must not be treated as validated procedures for the same model.
5. **Review is incomplete.** Professional review is not yet complete in this version. Content requiring verification is marked as such and should not be used as the basis for a final decision.
6. **Data completeness.** Original PDFs, LADs and images are not distributed with the database. Stored original file paths are source metadata only and may not be openable on another computer.
7. **Model output is uncertain.** Large language models can produce errors, omissions, or plausible but incorrect reasoning. Passing grounding checks does not rule out error.
8. **Limitation of liability.** Any direct or indirect consequences of using this software, including equipment damage, personal injury and production loss, are borne by the user. The authors and contributors provide no warranty, express or implied.
9. **Data compliance.** Users are responsible for ensuring that input content contains no classified information, personal information, or copyrighted material they are not entitled to use.
10. **Key security.** Keep your API key safe. Do not commit it to Git or share it with unrelated parties.

---

## License and Data Boundaries

- The code is intended for internal diagnostic assistance only.
- Database content is drawn from public machine-tool material and historical cases; professional review is incomplete.
- The database, evaluation reports and historical experiment material are not distributed with this repository.
