import * as React from "react";

import { cn } from "@/lib/utils";

type LogoMarkProps = React.SVGProps<SVGSVGElement> & {
  /** Optional accessible label. Pass an empty string to mark the SVG decorative. */
  title?: string;
};

/**
 * `LogoMark` is the square wave-only DaloyJS icon. It mirrors the three sky-blue
 * sine curves used in the wordmark, favicon, OG image, and the CLI welcome
 * banner. Use it inside buttons, badges, and the site header.
 */
export function LogoMark({
  className,
  title = "DaloyJS",
  ...props
}: LogoMarkProps) {
  const ariaProps = title
    ? { role: "img" as const, "aria-label": title }
    : { "aria-hidden": true as const };
  return (
    <svg
      viewBox="0 0 72 72"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-sky-500", className)}
      {...ariaProps}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M 10 22 C 28 6 44 38 62 22"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.45}
      />
      <path
        d="M 10 36 C 28 20 44 52 62 36"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d="M 10 50 C 28 34 44 66 62 50"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.7}
      />
    </svg>
  );
}

/**
 * `LogoLockup` is the horizontal `wave + "DaloyJS"` wordmark used in the
 * footer, OG image, and marketing pages. The "Daloy" portion uses
 * `currentColor` so the logo inherits the surrounding text color; the `JS`
 * suffix and waves stay sky-blue to keep the brand recognizable on light and
 * dark backgrounds.
 */
export function LogoLockup({
  className,
  title = "DaloyJS",
  ...props
}: LogoMarkProps) {
  const ariaProps = title
    ? { role: "img" as const, "aria-label": title }
    : { "aria-hidden": true as const };
  return (
    <svg
      viewBox="0 0 280 72"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-foreground", className)}
      {...ariaProps}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <g className="text-sky-500">
        <path
          d="M 14 22 C 33 8 51 36 68 22"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={0.45}
        />
        <path
          d="M 14 36 C 33 22 51 50 68 36"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <path
          d="M 14 50 C 33 36 51 64 68 50"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={0.7}
        />
      </g>
      <text
        x={84}
        y={46}
        fontFamily="inherit"
        fontSize={28}
        fontWeight={700}
        letterSpacing={-0.8}
      >
        <tspan fill="currentColor">Daloy</tspan>
        <tspan className="fill-sky-500">JS</tspan>
      </text>
    </svg>
  );
}
