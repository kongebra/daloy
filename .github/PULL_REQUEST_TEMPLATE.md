# Pull request

> [!IMPORTANT]
> **DaloyJS only accepts pull requests from `daloyjs` GitHub organization
> members and explicit repository collaborators.** See
> [CONTRIBUTING.md](https://github.com/daloyjs/daloy/blob/main/CONTRIBUTING.md)
> for the reasoning. External PRs are closed automatically by a workflow - this
> is policy, not a judgment on your change. Please file an Issue describing the
> problem instead; that is the most useful signal for the maintainers.

If you are an invited collaborator, delete this banner and describe your
change below.

## Summary

<!-- What changed and why. -->

## Checklist

See [CODE_REVIEW.md](https://github.com/daloyjs/daloy/blob/main/CODE_REVIEW.md)
for the full reviewer checklist. The boxes below are the minimum bar
for a PR to be considered ready for review.

### Quality gates

- [ ] `pnpm typecheck`
- [ ] `pnpm test` (or `pnpm coverage` for release-bound changes)
- [ ] Tests cover the new behaviour (happy + unhappy paths)
- [ ] Docs / `website/` updated if user-visible behaviour changed
- [ ] README "Status" table updated if a capability changed

### Security review (only the boxes that apply)

- [ ] New / changed inputs are validated with a Zod schema at the boundary
- [ ] No new `JSON.parse` on untrusted input (use `safeJsonParse`)
- [ ] No new `===` / `!==` on secret material (use `timingSafeEqual` helpers)
- [ ] Any new log statement is safe under `redactRecord()` in `src/logger.ts`
- [ ] No new runtime dependency, lifecycle script, or network call in build scripts
- [ ] Touched files in `src/security.ts`, `src/jwt.ts`, `src/hashing.ts`, `src/cookie.ts`, `src/jwk.ts`, `src/fetch-guard.ts`, `src/ip-restriction.ts`, `src/rate-limit-redis.ts`, `src/load-shedding.ts`, `src/multipart.ts`, `src/router.ts`, or `src/app.ts` have been re-read line by line
- [ ] `SECURITY.md` updated if the change has security implications

### Release coordination (only for release PRs)

- [ ] `@daloyjs/core` and `create-daloy` versions / template pins / fallback constants bumped together per the "Release Coordination" section of [AGENTS.md](https://github.com/daloyjs/daloy/blob/main/AGENTS.md)
