# Product And Engineering Priorities

## Primary User

The default user is a nontechnical Discord community operator who wants to self-host a holder-verification and rewards bot as easily and cheaply as possible. Design for someone who has never used a terminal, Docker, Git, or a server. A technically sophisticated operator may clone and customize the repository, but that person is not the default audience for product decisions.

## Non-Negotiable Operability

- The recommended path must be hosted, one-click, and usable without installing local software.
- Ask only for credentials or consent that an external platform truly requires. Automate everything else.
- Provision databases, apply migrations, configure endpoints, register commands, schedule jobs, and perform upgrades automatically.
- Do not turn implementation details into user steps. Manual command registration, copying callback URLs, editing files, and routine CLI commands are product defects unless the external platform makes them unavoidable.
- Keep ordinary setup short, linear, and written in plain language. Hide custom chains, provider overrides, diagnostics, and developer controls under clearly separated advanced settings.
- Ship useful free defaults. Paid providers and higher-volume infrastructure must remain optional and replaceable.
- Prefer safe automatic behavior, idempotent retries, status checks, and actionable recovery over documentation that asks the operator to repair internal state.
- Never require recurring maintenance from a normal operator. Upgrades should preserve data and synchronize configuration automatically.

## Feature Acceptance Gate

Before considering a feature complete, verify the full nontechnical journey:

1. Can a community deploy it from a browser without Docker, Git, Node.js, or a terminal?
2. Is every step that can be automated actually automated?
3. Are unavoidable credentials explained by where to find them, rather than by internal API terminology?
4. Does the default work on free or very low-cost infrastructure for a small community?
5. Are advanced controls out of the ordinary path?
6. Are failures recoverable through automatic retry or a simple on-screen action?

If any answer is no, the feature is not finished for the primary audience.
