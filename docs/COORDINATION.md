# Coordination: how work is handed out, built, checked and merged

Every builder reads this page and `AGENTS.md` before starting a work order. The coordinator (a Claude Code session)
owns this process. The founder owns the decisions.

## Roles

| Who | Does | Does not |
|---|---|---|
| Founder | Makes the decisions, approves every production deploy, reviews the look | — |
| Coordinator (Claude) | Writes work orders, assigns them, reviews, merges into `claude/garment-engine`, runs the gates, prepares `main` merges, reports to the founder in Dutch | Large builds of its own |
| Builder (Claude session or Google agent) | Carries out one work order on its own branch | Merge, push to `main` or `claude/garment-engine`, edit `.github/`, paid calls, add assets |
| Reviewer | Tries to break one finished work order, especially its tests. Is never the builder of that order, and preferably from the other vendor | Fix the work itself |

## Branches

- `main` is production. **Nothing reaches `main` without the coordinator's check**:
  - all gates green on the exact commit;
  - every work order in it reviewed;
  - `OPEN-ISSUES.md` updated.
  The merge is a PR from `claude/garment-engine`. A production deploy also needs the founder's approval.
- `claude/garment-engine` is the integration branch. Only the coordinator merges into it.
- Work branches:
  - Claude builders use `claude/wo-NNN-<slug>`.
  - Google builders use `google/wo-NNN-<slug>`.
  - Both are cut from `claude/garment-engine`.
- A builder may open a PR from its work branch **into `claude/garment-engine`**, never into `main`.

## A work order

Work orders live in `docs/work-orders/WO-NNN-<slug>.md`. **The board is Linear, team Curtain (`CUR`).** Claude reaches it through the claude.ai Linear connector and Google through the Linear MCP server in Antigravity. Each work order has one Linear issue, and `docs/work-orders/BOARD.md` maps the two.

How to use Linear:
- **The issue status is the lane.** A builder sets its issue to the doing status when it starts. When it hands in, it sets the issue to review ("Check") and puts the branch or PR link on the issue.
- **Questions go in comments**, either on the work order's issue or on CUR-17 (Overleg) for general matters. A question for the founder also gets the label `Wacht op founder`.
- **Sign every comment.** All agents post through the founder's Linear account, so every comment ends with `— Claude` or `— Google (<model>)`.
- **Before starting, a builder reads the comments on its issue.** Answers come there.

Each order has:

1. **Goal:** one sentence.
2. **Files:** the files the builder may change. Two open orders never share a file. If they would, they run one after
   the other.
3. **Done when:** measurable, with at least one test that fails on the old code. A builder that cannot make such a
   test says so in the report.
4. **Gates:**
   - `pnpm install --frozen-lockfile`
   - `pnpm check`
   - plus whatever the order names, such as `pnpm demo:e2e`, `DEMO_SKIRT=pom pnpm demo:e2e`, or pictures in
     `docs/screens/<vendor>/<slug>/`
5. **Report:** `docs/reports/<vendor>/<slug>.md` with the sections *Done*, *Measured*, *Not verified* and *Open issues*.
   New open issues go in `OPEN-ISSUES.md` with the next free OI number, and the Counts line is updated.
6. **Model tier:** `full` or `light` (see below).

## The round

1. **Assign.**
   - Claude: the coordinator starts a session with the order.
   - Google: the founder hands the order's path to the agent, or the agent picks it from the board.
   Either way the board says who has it.
2. **Build.** The builder commits often on its own branch. It pushes only after green gates and a filled-in report.
3. **Hand in.** The builder marks the order `review` on the board, in its own branch, and opens the PR or says it is
   done.
4. **Review.** The coordinator starts a reviewer. The reviewer reports findings. The builder, or a new order, fixes them.
5. **Merge.** The coordinator merges into `claude/garment-engine`, runs the gates again on the merge and pushes. The
   order becomes `done`.
6. **Report.** After each round the coordinator reports in Dutch, with pictures, and lists what waits on the founder.

## Limits and model tiers

- **At most three builders at once**, across both vendors. Finishing three is worth more than starting six.
- **Both vendors have a 5-hour usage window.**
  - A Claude session that hits the limit is resumed in the same session after the reset. It is never restarted from
    scratch.
  - When the Google agent's credits run out, it drops to a lighter model.
- **`light` tier work** may be done by a lighter model (Google's light model or Haiku): docs, tests for existing code,
  small mechanical fixes, picture runs, licence and link checks.
- **`full` tier work** must not be done on a light model: geometry, the fit engine, cloth, the viewer, privacy paths,
  merges. If a builder falls back to a light model mid-order, it stops, commits, writes in the report which model did
  what, and waits.
- Every report names the model or models that did the work. The coordinator reviews light-model work more strictly.

## Rules for every builder

- The hard rules in `AGENTS.md` and decisions D19 to D28 in `docs/DECISIONS.md` apply.
- Never write a literal in a real token format. Never add a secret, a shop photo or a raw download.
- Only commercially usable licences, recorded in `docs/LICENSES.md` before an asset is used.
  - Not allowed: SMPL, SMPL-X, FLAME, STAR, CC BY-NC, NVIDIA SCL, or asset stores (D25, D26).
  - Not allowed: BlendKit "Royalty Free" assets in the shipped app, because the browser can extract them.
- No amend, rebase or force-push on a shared branch. Never edit `.github/`.
- Report honestly: what was not run or not measured goes under *Not verified*.
