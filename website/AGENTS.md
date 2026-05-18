This is the marketing and documentation website for Daloy, a Next.js 16 + React 19 app using Tailwind v4 and shadcn/ui.

Use pnpm for package management and all scripts.

## Commands

Use these package scripts from `package.json`:

- `pnpm dev` — `next dev`
- `pnpm build` — `next build`
- `pnpm start` — `next start`
- `pnpm lint` — `eslint`
- `pnpm format` — `prettier --write "**/*.{ts,tsx}"`
- `pnpm typecheck` — `tsc --noEmit`

Run `pnpm lint` and `pnpm typecheck` before finishing code changes when relevant.

## Repo notes

- Docs navigation, sitemap entries, and search discovery are manually maintained. When changing docs routes, check [components/docs-sidebar.tsx](components/docs-sidebar.tsx), [components/docs-nav.ts](components/docs-nav.ts), [app/sitemap.ts](app/sitemap.ts), and [lib/docs-search.ts](lib/docs-search.ts).
- Database docs split SQL ORMs (`/docs/orm`) from ODMs (`/docs/odm`); Supabase is treated as a platform client, not an ORM.

## Skills

Skills are on-demand workflow docs. Read only the matching `SKILL.md` when its trigger applies.

- [.agents/skills/deploy-to-vercel/SKILL.md](.agents/skills/deploy-to-vercel/SKILL.md) — deploying this app to Vercel.
- [.agents/skills/vercel-cli-with-tokens/SKILL.md](.agents/skills/vercel-cli-with-tokens/SKILL.md) — non-interactive Vercel CLI with access tokens.
- [.agents/skills/shadcn/SKILL.md](.agents/skills/shadcn/SKILL.md) — adding, composing, or debugging shadcn/ui components.
- [.agents/skills/vercel-composition-patterns/SKILL.md](.agents/skills/vercel-composition-patterns/SKILL.md) — React composition patterns (compound components, avoiding boolean prop sprawl).
- [.agents/skills/vercel-react-best-practices/SKILL.md](.agents/skills/vercel-react-best-practices/SKILL.md) — React/Next.js performance guidelines.
- [.agents/skills/vercel-react-view-transitions/SKILL.md](.agents/skills/vercel-react-view-transitions/SKILL.md) — React View Transition API for route/element animations.
- [.agents/skills/vercel-react-native-skills/SKILL.md](.agents/skills/vercel-react-native-skills/SKILL.md) — React Native / Expo guidance (rarely relevant here).
- [.agents/skills/web-design-guidelines/SKILL.md](.agents/skills/web-design-guidelines/SKILL.md) — UI / accessibility / UX review checklist.
