# Leaderboard Pluto Harness

Monthly LLM benchmark on the **Pluto `medium`** problem set. Each run picks N random
problems, prompts every configured model (timed), scores the generated Verilog with
the problem's own testbench via **iverilog**, and writes `results/results.json` for
your leaderboard to display.

- **Accuracy** = share of the picked problems whose generated module passes the testbench.
- **Speed** = average API latency (ms); tokens/sec too when the provider reports usage.

## Setup

1. **Node 18+** and **iverilog** (`iverilog`, `vvp`) on PATH.
2. **Clone Pluto** somewhere and set the path in `config.json` → `plutoRepo`:
   ```bash
   git clone https://github.com/scale-lab/Pluto.git ~/Documents/pluto
   ```
   (Keep the repo structure intact; the harness reads `problems/medium/<name>/`.)
3. **Keys**: `cp .env.example .env` and fill in the provider keys you want to test.
   A model whose key is missing is **skipped** (recorded N/A), not failed.
4. Edit `config.json` to adjust the model list, `problemsPerRun`, or the system prompt.

## Run

```bash
node src/index.js
```
Writes `results/results.json` (latest) and `results/results-YYYY-MM.json` (archive),
and prints a ranked summary. Set `LEADERBOARD_POST_URL` in `.env` to also POST the
results to your site's backend.

## Automate (monthly)

```bash
crontab -e
# 1st of each month at 04:00:
0 4 1 * * /Users/jeffreyhe/Documents/Leaderboard_pluto_harness/run-monthly.sh >> /Users/jeffreyhe/Documents/Leaderboard_pluto_harness/run.log 2>&1
```
`run-monthly.sh` `git pull`s the Pluto clone first, then runs the harness.


## Two modes: raw model vs. your agentic pipeline

Set `mode` in `config.json` (or override per run with `HARNESS_MODE=`):

- **`direct`** — one prompt → one raw model completion → score. Measures the model's
  own Verilog ability. Uses each model's top-level `provider`/`model`/`baseURL`/`keyEnv`.
- **`agentic`** — drives YOUR backend's Verifier→Builder pipeline per problem, with the
  Verifier's spec **auto-approved** (no human gate). Measures your product end-to-end.
  Uses each model's `flow` block (`provider`/`model`/`keyEnv`) and needs a running backend:
  set `HARNESS_BACKEND_URL` (or `config.backendUrl`), e.g. `http://localhost:3999`.
  Speed = total pipeline wall-clock (spec + build + internal verify/refix). Keys are
  forwarded to the backend per request (BYOK); DeepSeek is routed via OpenRouter because
  the backend has no native DeepSeek provider.

The auto-approve is just: call `/flow/start`, then immediately `/flow/approve` with
`approved:true` — no backend change required.

## What it measures / assumes

- **Single-shot**: one prompt → one generated module (a fair model ranking, not the
  full agentic pipeline). The prompt is the problem's `prompt.txt` + `config.systemPrompt`.
- **Scoring** (`src/score.js`): compiles `[generated module + the problem's .v/.sv files]`
  with `iverilog -g2012`, runs `vvp`, and reads the verdict. It recognizes Pluto's
  `Total mismatches: N out of M samples` line, plus generic PASS/FAIL markers.
  Non-compiling or non-running = fail (benchmark convention).
- **Collision handling**: any problem `.v` that defines the **same module name** as the
  generated one (e.g. a golden reference of the DUT) is dropped from the compile so the
  generated module is the one under test.

### Adjust to Pluto's exact layout
The scorer auto-discovers each problem's testbench + reference from the `.v/.sv` files in
the folder and guesses the testbench top (a module with `initial` + `$finish`, preferring
`tb`/`testbench` names). If a particular problem doesn't score correctly, inspect that
`problems/medium/<name>/` folder and tweak `findTbTop`/collision logic in `src/score.js`
(or switch to calling Pluto's own `core/eval/evaluator.py` — see below).

### Optional: use Pluto's own scorer instead
To match Pluto's methodology exactly, replace `scoreModule` with a subprocess call to
`core/eval/evaluator.py` in your Pluto clone (run it from the repo root so its imports/
paths resolve). Copy the invocation from `jobs/alpha/eval_gpt4omini.sh`.

## Files
```
config.json        models, Pluto path, N, system prompt   (no secrets)
.env               your API keys                            (gitignored)
src/index.js       orchestrator (pick problems → run → score → aggregate)
src/llm.js         multi-provider caller with timing
src/problems.js    discover + randomly pick problems
src/extract.js     pull Verilog out of a model reply
src/score.js       iverilog testbench scorer
src/results.js     aggregate + write results.json + optional POST
run-monthly.sh     cron entry (git pull Pluto, then run)
results/           results.json + monthly archives          (gitignored)
```
