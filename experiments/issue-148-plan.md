# Issue 148 implementation plan

- [x] Read the parent issue, all four child issues, every comment, and PR 149 reviews/conversation.
- [x] Check the prepared branch, clean working tree, contributing rules, and recent merged PRs.
- [x] Record every requirement, alternative solutions, primary-source research, and acceptance criteria in the case study.
- [x] Reproduce #146 and #147 with the existing diagnostic and new automated regression tests before changing production code.
- [x] Fix identity conflicts throughout reconciliation, including transitive groups, learned aliases, external namespaces, explicit unit attributes, persistence, and search.
- [x] Fix source chronology throughout normalization, variants, availability, and price history; cover both batch orders, edits, incremental writes, and legitimate reopening reposts.
- [x] Investigate #143 resources and available protected inputs; profile real clink with full-body records, preserve readback verification and durable progress, and explicitly report any unavailable acceptance inputs.
- [x] Verify #122 registry/configuration/release state and actual release-mode preflight; preserve real publishing acceptance and document unavailable owner credentials.
- [x] Download completed failing CI logs, verify timestamps/SHA, and address each actual failure with evidence.
- [x] Add patch changesets, run focused regressions and all repository checks/tests, and commit useful atomic changes.
- [x] Merge current origin/main if necessary, push only issue-148-c588090f6214, review the complete PR diff, and update PR 149 with all closing references and truthful unresolved acceptance limits.
- [ ] Wait for all current-commit CI checks, investigate failures, verify a clean working tree, and mark PR 149 ready.
- [x] Investigate the fresh `da99d76` Node/Bun CI failures: preserve each job log, identify exact errors/lines, reproduce, fix the missing-clink fixtures and synchronized warning assertion, and rerun local checks.
- [ ] Verify the replacement CI run on the final code SHA passes all operating systems, required real clink, Docker, security, links, and packaging.

Private source bodies, sessions, contacts, and tokens must stay out of committed evidence. Raw logs stay in ignored ci-logs or the task's temporary research directory. Bounded profiling uses finite inputs and an explicit Node heap limit. This environment has no registry secrets/variables, published releases, or clink executable at initial inspection; dependency/bootstrap work is needed before reproduction.
