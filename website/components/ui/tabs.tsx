"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

/**
 * Root container for a set of tabs. Thin wrapper over Base UI's
 * `Tabs.Root` that applies the project's default vertical layout.
 *
 * @param props - Base UI {@link TabsPrimitive.Root.Props}; use `value` /
 *   `onValueChange` for a controlled tab set, or `defaultValue` for an
 *   uncontrolled one.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

/**
 * The horizontal strip that holds the {@link TabsTrigger} buttons.
 *
 * @param props - Base UI {@link TabsPrimitive.List.Props}.
 */
function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * A single clickable tab. Base UI marks the selected tab with `data-active`,
 * which drives the raised/active styling below.
 *
 * @param props - Base UI {@link TabsPrimitive.Tab.Props}; `value` ties the
 *   trigger to the {@link TabsContent} panel with the matching `value`.
 */
function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-full flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-active:bg-background data-active:text-foreground data-active:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * The panel revealed when its sibling {@link TabsTrigger} (matching `value`)
 * is active.
 *
 * @param props - Base UI {@link TabsPrimitive.Panel.Props}; `value` must match
 *   a {@link TabsTrigger}.
 */
function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
