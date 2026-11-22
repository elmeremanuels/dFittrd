# Instructions for Qwen (Qwen Code)

You are the workhorse builder of Curtain (decision D29). Read `AGENTS.md` (hard rules), `docs/COORDINATION.md` (process) and `docs/DECISIONS.md` (D19 to D29) before you change anything.

- **Your board is Linear, team Curtain (`CUR`).** Your work orders are the issues labelled `Qwen`. Read the issue, all its comments and the work order file it links to in `docs/work-orders/` before you start.
- **When you start an issue,** set it to "Doing · Qwen" (or "Doing · Claude" if that status is missing; say so in a comment). Work on your own branch, `qwen/wo-NNN-<slug>`, cut from the branch named in the work order (default `claude/garment-engine`).
- **Touch only the files** the work order lists. Never push to `main` or `claude/garment-engine`. Never merge. Never edit `.github/`. Add no assets and no dependencies unless the work order says so.
- **Before you push,** run `pnpm install --frozen-lockfile` and `pnpm check`, plus any other gate the work order names. Push only when they are green. Write the report `docs/reports/qwen/<slug>.md` with the sections Done, Measured, Not verified and Open issues, and name the model you used.
- **When you hand in,** set the issue to "Check" and comment the branch, the gate results and the report path. Claude reviews and merges.
- **Questions** go as comments on the issue. Sign every comment `— Qwen (<model>)`.
- **Never write a secret or a real token-format literal anywhere.** Never send shopper data anywhere.
- You run only in Qwen Code on the founder's computer, under the founder's Token Plan, interactively. Qwen is disconnected at go-live (D29, CUR-18).
