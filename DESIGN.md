---

version: beta
name: Aegis Sentinel

description: A tactical intelligence design system built for geospatial monitoring, infrastructure observability, critical event response, and high-density operational dashboards. Designed around situational awareness, rapid signal detection, and engineering-grade information hierarchy.

colors:
primary: "#00575c"
on-primary: "#fcfcfc"

secondary: "#5e3a00"
on-secondary: "#fcfcfc"

accent: "#154f84"
on-accent: "#fcfcfc"

background: "#f7fdfd"
foreground: "#020202"

surface: "#f2f8f8"
on-surface: "#020202"

muted: "#e0e8e8"
muted-foreground: "#020202"

border: "#e8ecec"

focus: "#0d9297"

success: "#1c989d"
warning: "#a77e39"
danger: "#7b131e"

telemetry-1: "#1c989d"
telemetry-2: "#528ac4"
telemetry-3: "#e700ac"
telemetry-4: "#fa0013"

typography:

display-xl:
fontFamily: "Space Grotesk, sans-serif"
fontWeight: 700
fontSize: "96px"
lineHeight: 0.95

display-lg:
fontFamily: "Space Grotesk, sans-serif"
fontWeight: 700
fontSize: "72px"
lineHeight: 1.0

headline-lg:
fontFamily: "Inter, sans-serif"
fontWeight: 600
fontSize: "40px"
lineHeight: 1.1

headline-md:
fontFamily: "Inter, sans-serif"
fontWeight: 600
fontSize: "24px"
lineHeight: 1.2

body-md:
fontFamily: "Inter, sans-serif"
fontWeight: 400
fontSize: "16px"
lineHeight: 1.55

body-sm:
fontFamily: "Inter, sans-serif"
fontWeight: 400
fontSize: "14px"
lineHeight: 1.45

label-sm:
fontFamily: "IBM Plex Mono, monospace"
fontWeight: 500
fontSize: "11px"
lineHeight: 1.2
letterSpacing: "0.12em"
textTransform: "uppercase"

telemetry-value:
fontFamily: "JetBrains Mono, monospace"
fontWeight: 600
fontSize: "28px"
lineHeight: 1.0

rounded:
sm: "4px"
md: "6px"
lg: "8px"
xl: "12px"

spacing:
xs: "4px"
sm: "8px"
md: "16px"
lg: "24px"
xl: "32px"
2xl: "48px"

border:
default: "1px solid #e8ecec"
active: "2px solid #0d9297"

components:

command-panel:
backgroundColor: "{colors.surface}"
border: "1px solid {colors.border}"
rounded: "{rounded.lg}"
padding: "24px"

telemetry-card:
backgroundColor: "{colors.surface}"
border-left: "4px solid {colors.primary}"
padding: "20px"

critical-alert:
backgroundColor: "{colors.surface}"
border-left: "4px solid {colors.danger}"
padding: "20px"

metric-card:
backgroundColor: "{colors.surface}"
padding: "20px"
rounded: "{rounded.md}"

button-primary:
backgroundColor: "{colors.primary}"
textColor: "{colors.on-primary}"
rounded: "{rounded.md}"
padding: "12px 18px"

button-secondary:
backgroundColor: "{colors.accent}"
textColor: "{colors.on-accent}"

map-overlay:
backgroundColor: "rgba(255,255,255,0.92)"
border: "1px solid {colors.border}"
backdropBlur: "12px"

---

# Overview

Aegis Sentinel is an operational design language engineered for mission-critical systems.

The design prioritizes:

* high-density information display
* telemetry visibility
* event prioritization
* geospatial intelligence
* observability
* operational decision making

This system was designed for software that monitors reality in real time.

It is not decorative.

It is functional.

---

# Design Philosophy

The interface should feel like a command center.

Every element must answer one question:

"Does this help the operator make a decision faster?"

Visual noise is forbidden.

Decoration is forbidden.

Function determines form.

The interface must communicate:

* urgency
* reliability
* precision
* technical credibility

---

# Core Visual DNA

Inspired by:

* aerospace telemetry systems
* satellite monitoring interfaces
* infrastructure dashboards
* distributed systems observability
* control room interfaces

Visual language:

* dense information
* modular panels
* structured grids
* immediate signal recognition
* high contrast alerts
* minimal animation

---

# Layout Principles

Use grid-first design.

Primary structure:

* global dashboard
* left telemetry panel
* central map/canvas
* right contextual intelligence panel
* bottom event stream

Spacing should communicate hierarchy.

Never use decoration for hierarchy.

---

# Color Semantics

Teal = system health

Blue = infrastructure and telemetry

Amber = warnings

Red = critical failures

Neutral gray = contextual information

White surface = readability layer

Every color must communicate state.

Never decorative usage.

---

# Component Rules

Allowed components:

* telemetry cards
* map overlays
* alert banners
* event timelines
* command panels
* severity indicators
* geospatial widgets
* metric dashboards
* infrastructure status badges

Forbidden patterns:

* neumorphism
* glassmorphism excess
* decorative gradients
* floating cards without hierarchy
* unnecessary animation
* rounded playful UI

---

# Interaction Philosophy

Interaction must be immediate.

Feedback must be explicit.

Animations should never exceed 150ms.

Hover states are subtle.

Critical alerts should override normal hierarchy.

Keyboard navigation is mandatory.

Accessibility must comply with WCAG AA minimum.

---

# Typography Rules

Space Grotesk:

Used for major headings.

Inter:

Used for all UI content.

JetBrains Mono / IBM Plex Mono:

Used for:

* telemetry
* logs
* timestamps
* system metrics
* IDs
* technical metadata

Monospace is part of identity.

---

# Iconography

Three icon sources, each with a fixed role. No paid libraries, no proprietary
assets, no ad-hoc custom SVGs.

* **Font Awesome Free (solid)** — utility actions and shell chrome:
  header buttons, view switcher, layer toggles, close buttons.
* **Material Symbols Outlined** — component-level iconography where a modern,
  design-system look is required: refresh, empty states, metric affordances.
* **Emoji** — functional signal only: map/globe markers and
  `CONTENT_TYPE_META` (immediate recognition is the point). Never decorative.

`public/icons/brand.svg` is the single sanctioned custom SVG (brand mark,
Aegis palette). `icon.svg` is its PWA-icon counterpart.

Rules:

* Icon-only buttons MUST keep `aria-label`.
* Icons inherit color from the button (`currentColor`) — never hardcode.
* New icons come from the two libraries above; creating SVGs requires a
  documented reason.

---

# Dark Mode Variant

The system supports a dark color scheme. Light is the default; dark is opt-in
(user toggle, persisted) with `prefers-color-scheme` as the initial hint.

Dark mode redefines ONLY the neutral/surface tokens and the colors that lose
contrast on dark surfaces. Accent, telemetry and success/info colors are shared
between modes.

```yaml
dark:
  background: "#0a1010"
  surface:    "#101919"
  muted:      "#1a2626"
  border:     "#223030"

  foreground:       "#f2f8f8"
  muted-foreground: "#f2f8f8"   # use alpha for secondary/tertiary text

  primary: "#0d9297"   # primary #00575c is illegible on dark; focus teal takes its role
  warning: "#c79a52"   # lightened from #a77e39
  danger:  "#d4434f"   # lightened from #7b131e

  # unchanged: on-primary #fcfcfc, accent #154f84, focus #0d9297,
  #            success #1c989d, telemetry-1..4
```

Rules:

* Dark mode is a token swap, never a separate stylesheet.
* Components must not branch on the scheme — they consume tokens only.
* Canvas/WebGL surfaces (map, globe) mirror the same values: ocean = background,
  land = muted (slight tint allowed for cartographic distinction), grid/borders =
  foreground at low alpha.
* Type/severity colors must pass WCAG AA contrast on BOTH `surface` values
  (`#f2f8f8` and `#101919`).

---

# Non Negotiable Rules

Never design for aesthetics first.

Never hide operational data.

Never prioritize whitespace over information density.

Never use decorative effects.

Never create components that do not communicate state.

Never sacrifice clarity for beauty.

Operational clarity is beauty.