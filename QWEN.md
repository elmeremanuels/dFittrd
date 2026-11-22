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

## How the founder steers you from Linear

The founder tells you what to do on the board, not in the chat. Check Linear at the start of a session and again after
every issue you hand in.

1. **"Qwen · nu" label.** An issue with this label is the founder saying "pick this one up now". Take it before
   anything else, even if it is not labelled `Qwen`. Remove the label when you start, and set the issue to
   "Doing · Qwen" (or "Doing · Claude" if that status is missing).
2. **A comment that starts with `Qwen:`** on any issue is an instruction from the founder, for example
   `Qwen: pak dit op` or `Qwen: stop, wacht op Claude`. Only comments without an agent signature count: a comment that
   ends in `— Claude` or `— Google (…)` is not the founder. Answer under the comment, signed `— Qwen (<model>)`.
3. **Otherwise,** take the next issue labelled `Qwen` with status "To-do": highest priority first, then oldest.
4. **Never** take an issue labelled `Wacht op founder`, or one whose work order file is missing. Comment on it and ask
   instead.

You only run while the founder has a Qwen Code session open. Linear cannot start you.

### Start prompt (the founder pastes this into Qwen Code)

> Lees QWEN.md op branch claude/garment-engine. Kijk in Linear, team CUR, welke issue je nu moet doen volgens
> "How the founder steers you from Linear", en voer die uit. Kijk na elke ingeleverde issue opnieuw in Linear. Stop
> als er niets meer voor je klaarstaat.
