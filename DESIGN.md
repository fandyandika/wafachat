---
name: "Wafachat Operational Ledger"
description: "A calm, role-adaptive operations ledger for WhatsApp commerce."
colors:
  paper: "oklch(0.975 0.012 88)"
  raised-paper: "oklch(0.995 0.006 88)"
  ink: "oklch(0.22 0.025 258)"
  ledger-ink: "oklch(0.18 0.035 258)"
  violet-carbon: "oklch(0.50 0.20 285)"
  warm-white: "oklch(0.985 0.004 88)"
  violet-wash: "oklch(0.93 0.035 285)"
  violet-wash-ink: "oklch(0.36 0.14 282)"
  muted-paper: "oklch(0.945 0.012 88)"
  muted-ink: "oklch(0.47 0.025 258)"
  secondary-paper: "oklch(0.94 0.015 88)"
  rule: "oklch(0.78 0.025 88)"
  border: "oklch(0.84 0.018 88)"
  lead: "oklch(0.55 0.16 252)"
  lead-soft: "oklch(0.95 0.03 252)"
  positive: "oklch(0.56 0.13 162)"
  positive-soft: "oklch(0.95 0.04 162)"
  negative: "oklch(0.58 0.22 27)"
  negative-soft: "oklch(0.95 0.04 27)"
  achievement-gold: "oklch(0.72 0.13 85)"
  achievement-gold-soft: "oklch(0.95 0.05 85)"
  achievement-gold-ink: "oklch(0.42 0.09 75)"
typography:
  headline:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  metric:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.025em"
    fontFeature: "tabular-nums"
  body:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "normal"
  label:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.12em"
rounded:
  sm: "0.5rem"
  md: "0.625rem"
  lg: "0.75rem"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
components:
  ledger-section:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0"
  ledger-section-header:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.ledger-ink}"
    padding: "0.75rem 1rem"
    height: "3.5rem"
  ledger-metric:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.ledger-ink}"
    typography: "{typography.metric}"
    padding: "1rem"
  status-positive:
    backgroundColor: "{colors.positive-soft}"
    textColor: "{colors.positive}"
    rounded: "{rounded.sm}"
    padding: "0 0.5rem"
    height: "1.75rem"
  button-primary:
    backgroundColor: "{colors.violet-carbon}"
    textColor: "{colors.warm-white}"
    rounded: "{rounded.md}"
    padding: "0 0.625rem"
    height: "2.75rem"
  navigation-active:
    backgroundColor: "{colors.secondary-paper}"
    textColor: "{colors.ledger-ink}"
    padding: "0 1.5rem"
    height: "2.75rem"
---

# Design System: Wafachat Operational Ledger

## Overview

**Creative North Star: "The Operational Daybook"**

Wafachat uses a modern shift-ledger visual world: warm working paper, blue-black ink, ruled data bands, and restrained violet carbon-copy marks. The interface is calm and exact rather than decorative. Hierarchy comes from placement, shared baselines, borders, and number scale—not a field of floating cards.

The implemented shell is shared, but the dashboard changes composition by role. Owner screens support scanning and intervention; CS screens put the next action and personal progress first. Product branding remains Wafachat, while organization and role appear as operational context.

**Key Characteristics:**

- Warm, nearly flat paper surfaces with strong ink hierarchy.
- Ruled bands and compact status stamps as the recurring signature.
- Asymmetric owner composition and action-first CS composition.
- Tabular operational numbers and concise Indonesian labels.
- Violet used sparingly; semantic colors always carry text or structural cues.

### Phase boundary

This document records the implemented **Phase 1 foundation, shared panel shell, and role-adaptive Dashboard**. Global tokens now affect the application shell, but Performance, Laporan, Queen, Follow-up, Settings, and route-specific mobile recomposition are not documented as migrated ledger surfaces until their later rollout phases are implemented. Do not infer new workflows, metrics, polling, permissions, or backend behavior from this visual system.

## Colors

The palette pairs warm paper neutrals with cool ink and one controlled violet accent. Token values in the frontmatter are normative.

### Primary

- **Violet Carbon:** selected navigation, primary actions, focus rings, and limited Wafachat brand emphasis.

### Secondary

- **Lead Blue:** lead-specific data when the label or structure also communicates meaning.

### Tertiary

- **Operational Green / Alert Red / Achievement Gold:** positive state, destructive or failed state, and earned Queen context respectively. Their soft companions are badge and alert fills; gold is reserved for genuine achievement or warning context already implemented.

### Neutral

- **Working Paper:** page background.
- **Raised Paper:** shell, ledger section, popover, and mobile-navigation surface.
- **Blue-Black Ink / Ledger Ink:** body structure and the strongest headings or figures.
- **Ledger Rule:** primary dividers in the shell, context bars, sections, rows, and metric matrix.
- **Muted Paper / Muted Ink:** subdued fills and secondary explanations.

**The One Carbon Rule.** Violet marks selection, action, or focus; it does not wash entire analytical regions.

**The Label-and-Color Rule.** Positive, warning, and negative states retain a readable label, border, icon, or layout cue; color is never the only signal.

## Typography

**Display, Body, and Label Font:** Plus Jakarta Sans, with a generic sans-serif fallback.

**Character:** A single compact UI family keeps the ledger contemporary and operational. Weight and scale establish hierarchy; decorative display type is intentionally absent.

### Hierarchy

- **Route headline:** semibold and tight, `1.25rem` on mobile and `1.5rem` from the medium breakpoint.
- **Section title:** semibold at the base size, paired with an optional muted explanation.
- **Metric:** semibold `1.5rem`, tight tracking, and tabular numerals.
- **Body:** mostly `0.875rem`; supporting descriptions may step down to `0.75rem`.
- **Ledger label:** semibold `0.75rem`, uppercase, with `0.12em` tracking for short metric labels only.

**The Aligned Number Rule.** Counts, currency, percentages, ranks, dates, and times use tabular numerals so columns remain stable while values update.

**The Sentence-Case Rule.** Operational copy stays concise and sentence case; uppercase is reserved for short ledger labels, not headings or actions.

## Layout

The shell uses a `15rem` desktop sidebar and a fluid content canvas capped at `1440px`. Page padding is `1rem` on mobile and `1.5rem` on desktop; dashboard sections use a consistent `1rem` gap. The sticky top bar carries one route title plus organization and role context. On mobile, an opaque fixed bottom navigation includes safe-area padding, while page content reserves bottom space.

Ledger metrics move from one column to two at `640px` and three at `1280px`. At the extra-large breakpoint, Owner Home uses an asymmetric `fluid + 20rem` grid: the business matrix holds the broad field while attention occupies the narrow operational rail; Top CS and Top Product become two columns at `1024px`. CS Home remains vertically action-first: shift context, Follow-up queue, personal progress, then Queen context.

**The Shared-Baseline Rule.** Related KPIs belong in one ruled matrix; do not wrap each number in an independent card.

## Elevation & Depth

Phase 1 ledger surfaces are flat at rest. Depth comes from warm tonal layering, ledger rules, sticky positioning, and bounded section backgrounds; Dashboard and shell primitives do not use drop shadows. Existing shadow utilities may remain for legacy or overlay surfaces, but they are not the organizing language of the ledger.

**The Flat-by-Default Rule.** Add elevation only when interaction or overlay behavior requires it; a static information group gets a rule or surface shift first.

## Shapes

The form language is gently compact: large grouped sections use the shared `0.75rem` radius, controls use `0.625rem`, and stamps use `0.5rem`. Internal metric cells remain square to preserve continuous ruled bands. Borders are one-pixel ledger dividers rather than ornamental outlines.

**The Continuous-Band Rule.** Round the outer information group, not every row or metric within it.

## Components

### Operational context bar

A full-width raised-paper band with horizontal ledger rules. It names the active view or shift, states the time definition and update time, and holds only actions that affect the current snapshot.

### Ledger section and metric matrix

The section is a rounded, bordered information group with a minimum `3.5rem` header. Metric cells have a minimum height of `7rem`, `1rem` padding (`1.25rem` on desktop), shared right/bottom rules, a compact label, a dominant tabular value, and one explanatory line.

### Status stamp

A compact bordered label with a minimum height of `1.75rem`. Neutral, positive, warning, and negative variants combine words with semantic border, fill, and text color. Stamps report state; they are not decorative badges.

### Actions and navigation

Primary actions use Violet Carbon; outline and quiet actions retain the paper surface and gain muted fill on hover. Interactive controls are at least `44px` on mobile, expose a visible violet focus ring, disable while the same refresh is pending, and avoid motion when reduced motion is requested. Desktop active navigation adds a ruled secondary-paper band; mobile active navigation combines violet text with a violet-wash icon field and `aria-current="page"`.

### Loading, refresh, error, and empty states

First load uses skeletons shaped like the eventual ruled composition. Refresh keeps prior valid data visible and marks the initiating control. Errors identify the affected source or action, use an alert role where implemented, and offer retry when possible. Empty rankings use quiet explanatory text; attention uses a labelled operational stamp.

### Role-adaptive dashboard composition

- **Owner:** context bar; business matrix plus a narrower attention rail; then Top CS and Top Product diagnostics. Duplicate-order attention opens a focused detail sheet.
- **CS:** shift context; the largest next-work section with H+1/H+2/H+3 queue and direct Follow-up link; scoped personal progress; then a secondary Queen link.

## Do's and Don'ts

### Do:

- **Do** preserve the ruled band plus stamped status as the recognizable ledger signature.
- **Do** state the exact operating period, especially the `16:00–16:00` CS window, beside the data it governs.
- **Do** preserve role permissions, server-side CS scoping, bounded/manual data loading, and direct next actions.
- **Do** keep keyboard focus visible, semantic headings ordered, mobile targets at least `44px`, and mobile navigation clear of safe areas.

### Don't:

- **Don't** turn every KPI, row, or label into a floating rounded card.
- **Don't** use violet or semantic colors as decoration, or rely on color alone.
- **Don't** add decorative animation, continuously moving metrics, polling, or presentation-only queries.
- **Don't** claim later-phase routes follow this composition until those routes are actually migrated and verified.
