# Repository working agreement

These instructions apply to every human contributor and coding agent working in this repository.

## Branch and merge-request workflow

- Work only in the contributor's personal local branch, for example `anastasia/local` or the corresponding branch owned by another contributor.
- Never commit or push directly to `dev` or `main`.
- Push the personal branch to `origin`, then open a merge request with `dev` as the target branch.
- Before opening or updating a merge request, fetch the latest remote state and integrate `origin/dev` into the personal branch. Resolve conflicts in the personal branch.
- Keep commits focused and reviewable. Do not mix unrelated refactors, generated files, or another contributor's unfinished work into a change.
- Do not rewrite shared branch history unless the branch owner explicitly approves it.
- If `origin/dev` does not exist, report that as a blocker to the repository maintainer. Do not silently target `main` or create a replacement integration branch.

## Documentation structure

The root [`README.md`](./README.md) is the short project overview and local run guide. The documentation index is [`Documentation/README.md`](./Documentation/README.md).

- [`Documentation/Architecture/ARCHITECTURE.md`](./Documentation/Architecture/ARCHITECTURE.md) is the source of truth for the currently implemented and verified system.
- [`Documentation/Architecture/PYTHIA-architecture-and-logic.md`](./Documentation/Architecture/PYTHIA-architecture-and-logic.md) describes the broader target architecture and may contain planned work.
- `Documentation/Architecture/` contains architecture and product-system rules.
- `Documentation/Setup/` contains integration and environment setup guides.
- `Documentation/Plans/` contains implementation plans, gap audits, and implementation logs.
- `Documentation/Reference/` contains historical drafts, mockups, and other source material. Do not present reference files as current implementation.

Keep the documentation synchronized in the same commit as the code change:

- Update the current architecture when changing API routes, data flow, database schema, search or ranking logic, external integrations, privacy boundaries, fallbacks, or runtime configuration.
- Update the relevant setup guide and `.env.example` when configuration variables or setup steps change. Never put real keys or tokens in documentation or tracked files.
- Update the relevant implementation plan when completing, postponing, or materially changing planned functionality.
- Update the root README when the prerequisites, launch command, or user-visible feature summary changes.
- Add every new documentation file to `Documentation/README.md` and place it in the appropriate subdirectory.
- Prefer links over duplicated explanations. When two documents disagree, the current architecture document controls for implemented behavior.

## Local development and verification

- Use Node.js 22.13 or newer.
- Start the application with `npm start` or use `npm run dev` while developing.
- Run `npm test` before committing. Add or update tests for behavior changes where practical.
- Run `git diff --check` and review `git status` before committing and before pushing.
- Verify affected user flows locally at `http://localhost:3000`, especially when changing UI, API responses, Oracle retrieval, or integrations.
- Do not claim an integration works from code inspection alone. Distinguish verified live behavior, local fallback behavior, and planned behavior in both code reviews and documentation.

## Data, secrets, and generated state

- Never commit `.env`, `.env.local`, API keys, OAuth tokens, credentials, or personal data.
- Keep safe placeholders and variable descriptions in `.env.example`.
- Do not commit the local SQLite database or other contents of `data/`.
- Employee names stay local in Oracle retrieval. Preserve the privacy boundary documented in the current architecture unless a reviewed design explicitly changes it.
- Preserve user work and unrelated local changes. Do not delete, reset, or overwrite files merely to obtain a clean working tree.

## Definition of done

A change is ready for a merge request only when:

1. The requested behavior is implemented in the contributor's personal branch.
2. Relevant tests pass and the affected flow has been checked at an appropriate level.
3. Documentation, setup examples, and implementation plans are synchronized with the code.
4. No secrets, local databases, or unrelated changes are included.
5. The branch is pushed to `origin` and the merge request targets `dev`.
