# AI-FDE Shipyard

**Engineering research and stress testing for a Palantir-inspired AI/data workflow.**

This repository studies how a data/AI workflow can move beyond “LLM-generated configuration” into a system with deterministic execution, validation, human review, auditability, and measurable failure modes.

It is a research and prototyping archive — **not a Palantir clone and not a production platform**.

## Research Question

A recurring problem in AI-assisted data engineering is that the workflow may look intelligent while the underlying transformations are still only declarations.

This project asks:

> How can an LLM-assisted workflow remain flexible at the reasoning layer while keeping data transformations, validation, state transitions, and execution deterministic and auditable?

## What Is Here

The repository contains two generations of workflow experiments plus design and evaluation material:

- [`palantir-aip-workflow/`](palantir-aip-workflow/) — an earlier AIP-inspired workflow prototype
- [`palantir-like-workflow/`](palantir-like-workflow/) — a more explicit reconstruction of Palantir-like engineering principles
- [Engineering design spec](spec/2026-08-05-paip-engineering-design.md)
- [Capability test report](docs/2026-08-07-paip-capability-test-report.md)
- [Palantir comparison](docs/2026-08-07-paip-vs-palantir-comparison.md)
- [Failure root-cause analysis](docs/2026-08-08-paip-failure-root-cause-analysis.md)

> Most detailed documents are currently written in Chinese. This README is the English landing page.

## Core Architecture Idea

The design separates three layers:

```text
Skill / reasoning layer
        ↓
Semantic rule IR
        ↓
Deterministic execution + validation + audit
```

The key principle is:

> **Let the model reason about what should happen; let deterministic tools decide what actually happens to data.**

The rule representation acts as a semantic intermediate representation (IR). A deterministic reference implementation provides an execution anchor that can later be compared with alternative backends.

## Engineering Principles

The experiments converge on several principles:

- **Deterministic logic should stay outside the prompt.**
- **AI proposals should pass through review before becoming executable state.**
- **Validation must happen before execution.**
- **Execution should produce materialised output, not just configuration files.**
- **Failures should stop the pipeline without advancing state.**
- **Audit events are part of the runtime contract, not an afterthought.**
- **A replaceable backend needs a stable semantic IR and differential tests.**

## Capability Test

A full capability test used a fixed-seed, 64-table company dataset to exercise all workflow skills and engine tools.

Verified behaviours included:

- validation across **64 tables, 16 transforms, and 20 merge rules**
- **56 materialised outputs** and **36 audit events**
- idempotent repeated execution
- rejection of an invalid column with unchanged output
- chained date cleaning across **5,992 dirty values**
- cross-source merge output and mapping generation
- state-machine and audit consistency

See the [capability test report](docs/2026-08-07-paip-capability-test-report.md).

## A Useful Failure

One of the most valuable findings was not a pass.

A date-cleaning rule produced correctly formatted output while silently swapping month and day. The pipeline looked clean, but the value semantics were wrong.

That failure led to an important design lesson:

> **Format validation is not value validation.**

The test suite was extended with replay-based value checks, and the broader design was revised to treat output-quality evaluation as a first-class concern.

This is representative of how the project is used: not to showcase a polished framework, but to expose weak assumptions and turn them into engineering constraints.

## What the Comparison Revealed

The Palantir comparison highlighted several gaps in the early design:

- evaluation loops were treated as optional rather than core
- deterministic-first design was too absolute for LLM-native execution
- validation focused more on input structure than downstream output effects
- semantic grounding, Action semantics, and model-replacement loops were incomplete

These findings became the basis for subsequent iteration priorities.

## Related Research

- **[palantir-deep-dive](https://github.com/MonsMare/palantir-deep-dive)** — broader research on Foundry, Ontology, AIP, governance, and decision-system architecture
- **[Enterprise-Semantic-Infrastructure-Research](https://github.com/MonsMare/Enterprise-Semantic-Infrastructure-Research)** — evidence-first Knowledge Runtime research

## Why This Repository Exists

This repository is part of a broader research method:

**Study the system → extract the engineering principle → build a smaller testable version → stress it → study the failure → revise the principle.**

That loop is more important here than feature completeness.

---

**Research focus:** AI Engineering Methodology · Enterprise AI · Deterministic Execution · Evaluation · Governance
