# Security Policy

## What this project is

A static single-page app. It runs entirely in the browser, talks to no server, authenticates against nothing, and stores nothing except, at present, the theme preference in `localStorage`. YAML you paste or upload is parsed locally and never leaves the machine.

This shapes the threat model: there is no remote attack surface, no credential handling and no data exfiltration path.

## Supported Versions

This project ships from `main`. There are no container images and no release pipeline attached to it (the upstream Docker and CI/CD files were removed — see [docs/ROADMAP.md](docs/ROADMAP.md)).

## Reporting a Vulnerability

Open a **private** GitHub Security Advisory for this repository — do not open a public issue for a vulnerability. Include:

- The commit SHA or the exact upstream `npm` dependencies involved.
- Steps to reproduce, ideally as a minimal YAML payload in a file.
- Impact: what an attacker with the payload can actually achieve in the victim's browser.
- A suggested fix, if you have one.

Please avoid a weaponized PoC. A minimal YAML that demonstrates the behavior is enough.

Expected acknowledgement: within 5 business days.

## In scope

- Code in this repository.
- Third-party dependencies as shipped in `package-lock.json`.

## Out of scope

- Findings only reproducible against forks or modified builds.
- Memory pressure or a large paste — this is a browser tool, so bring your own limits.
- Anything requiring a server component. There is none.

## Notes on parsing untrusted YAML

`js-yaml` is used with `forceQuotes: true` on output so values cannot be reinterpreted as booleans or dates on round-trip. Inputs are loaded with the default schema, and only documents whose `kind` is a supported policy type are parsed into the model — anything else raises `PolicyParseError` and is shown to the user rather than acted on.
