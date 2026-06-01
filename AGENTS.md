# AGENTS.md — MonkeMask

Cross-tool contract for agents working in this repo (Claude Code, Codex CLI,
Cursor, anything that reads `AGENTS.md`).

## What this is

MonkeMask covers faces in a photo with monkes. Primary mode (`--match`) recognizes
who each person is and uses **their** SMB monke; unrecognized faces get the generic
**MonkeDAO DAOJones**. Built for MonkeDAO local ambassadors with little to no
photo-editing skill.

## Running it for the user

There is a Claude Code skill at `.claude/skills/monkemask/SKILL.md` — read it for
the full contract. The short version:

```bash
uv venv --python 3.12 && uv pip install -e ".[dev]"   # one-time
uv run monkepic "<photo-or-folder>" --match           # each person -> their monke
```

Output is written next to the input as `<name>-monked.png`.

**Always verify the result by opening the output image.** Coverage is not
guaranteed 100% on hard photos — if a face is uncovered, lower `--min-confidence`
and re-run, or tell the user it needs manual cover. Never claim success you did not
visually verify.

## Hard rules

- **Privacy first.** Everything runs locally/offline. Never upload the user's
  photos or face crops to any external service.
- `Photos/`, `OurMonke/`, `faces/`, `output/`, generated `*-monked.*` are
  gitignored — never commit real faces or personal data.
- Follow TDD for code changes (RED → GREEN → REFACTOR). The suite is `uv run
  pytest`; the real-model smoke tests are marked `smoke` (deselect in CI with
  `-m "not smoke"`).
- Lint with `uv run ruff check src tests` before committing.

## Specs

- `docs/specs/monkepic.md` — Phase 1 (detection + compositing core).
- `docs/specs/monkepic-phase3-matching.md` — identity matching.
- `docs/specs/monkemask-web.md` — local/self-hosted web UI (in progress).
