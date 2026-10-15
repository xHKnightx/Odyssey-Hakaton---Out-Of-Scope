# PYTHIA documentation

This directory is the entry point for project documentation. The root [`README.md`](../README.md) remains the quick-start guide for running the application.

## Architecture

- [`ARCHITECTURE.md`](./Architecture/ARCHITECTURE.md) — current, verified architecture of the application implemented in the `anastasia/local` branch. Start here to understand the runtime, Oracle request flow, hybrid search, privacy boundary, and current limitations.
- [`PYTHIA-architecture-and-logic.md`](./Architecture/PYTHIA-architecture-and-logic.md) — broader target architecture. It includes planned components that are not necessarily present in the current MVP.
- [`PYTHIA-gamification-framework.md`](./Architecture/PYTHIA-gamification-framework.md) — product rules and data model for laurels, levels, and contribution rewards.

## Setup

- [`ORACLE-LLM-SETUP.md`](./Setup/ORACLE-LLM-SETUP.md) — configuration and diagnostics for the SecondStack-compatible chat and embedding APIs.
- [`GOOGLE-SETUP.md`](./Setup/GOOGLE-SETUP.md) — optional Google Calendar and Gmail OAuth setup.

## Implementation plans

- [`EXPERTISE-IMPLEMENTATION-PLAN.md`](./Plans/EXPERTISE-IMPLEMENTATION-PLAN.md) — Expertise directory gap audit and implementation log.
- [`GAMIFICATION-IMPLEMENTATION-PLAN.md`](./Plans/GAMIFICATION-IMPLEMENTATION-PLAN.md) — gamification implementation audit and rollout notes.
- [`PANTHEON-IMPLEMENTATION-PLAN.md`](./Plans/PANTHEON-IMPLEMENTATION-PLAN.md) — Pantheon mockup comparison and implementation log.

## Reference material

Files under [`Reference`](./Reference/) are preserved source materials rather than descriptions of the verified current implementation:

- [`PYTHIA for SecondStack (1).html`](<./Reference/PYTHIA for SecondStack (1).html>) — original interactive mockup/reference page.
- [`PYTHIA архитектура и модель данных (черновик) (1).md`](<./Reference/PYTHIA архитектура и модель данных (черновик) (1).md>) — historical architecture and data-model draft.

When documentation disagrees, treat `Architecture/ARCHITECTURE.md` as the source of truth for what works in the current branch and `Architecture/PYTHIA-architecture-and-logic.md` as the intended future direction.
