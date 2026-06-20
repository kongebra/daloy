"use client"

import * as React from "react"
import { MoonIcon, MoonStarsIcon, SunIcon } from "@phosphor-icons/react"
import { useTheme } from "next-themes"

import { THEMES, getNextTheme } from "@/components/theme-provider"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const THEME_LABELS: Record<(typeof THEMES)[number], string> = {
  light: "Light",
  dark: "Dark",
  dim: "Dim",
}

const THEME_ICONS = {
  light: SunIcon,
  dark: MoonStarsIcon,
  dim: MoonIcon,
} satisfies Record<(typeof THEMES)[number], React.ComponentType<{ className?: string }>>

function subscribeToHydration(onStoreChange: () => void) {
  queueMicrotask(onStoreChange)
  return () => {}
}

function getHydratedSnapshot() {
  return true
}

function getServerSnapshot() {
  return false
}

/**
 * Compact single-button theme switcher.
 *
 * Renders one icon button that cycles `light → dark → dim → light` on each
 * click (matching the `d` keyboard hotkey), swapping its icon to reflect the
 * active theme so it takes the space of a single nav icon instead of a
 * three-segment toggle. Falls back to the `dark` icon until hydrated to avoid
 * an SSR/client mismatch, and exposes the current and next theme through
 * `aria-label` for assistive tech.
 *
 * @returns The theme switcher button element.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const hydrated = React.useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerSnapshot)

  const activeTheme = hydrated && theme && theme in THEME_LABELS ? (theme as (typeof THEMES)[number]) : "dark"
  const nextTheme = getNextTheme(activeTheme)
  const ActiveIcon = THEME_ICONS[activeTheme]

  return (
    <button
      type="button"
      aria-label={`Theme: ${THEME_LABELS[activeTheme]}. Switch to ${THEME_LABELS[nextTheme]}.`}
      title={`Theme: ${THEME_LABELS[activeTheme]} (click to switch, saved on this device)`}
      onClick={() => setTheme(nextTheme)}
      className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-muted-foreground hover:text-foreground")}
    >
      <ActiveIcon
        key={activeTheme}
        className="size-4 motion-safe:animate-in motion-safe:spin-in-90 motion-safe:fade-in-0 motion-safe:duration-300"
      />
    </button>
  )
}
