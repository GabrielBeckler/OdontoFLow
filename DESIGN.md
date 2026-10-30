---
name: OdontoFlow
description: Professional Workspace para cadastro e acompanhamento local de ordens de serviço odontológicas.
colors:
  green-main: "#399271"
  green-deep: "#236D54"
  green-soft: "#EAF3EF"
  green-gray: "#9AA59F"
  canvas: "#F7F8F7"
  surface: "#FFFFFF"
  ink: "#252D29"
  text-secondary: "#5D6963"
  border-subtle: "#E2E8E4"
  status-progress-bg: "#EEF3F5"
  status-progress-text: "#526875"
  status-finalized-bg: "#EAF3EF"
  status-finalized-text: "#236D54"
  status-return-bg: "#FBF2E3"
  status-return-text: "#7A551C"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.green-deep}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    height: "38px"
  status-progress:
    backgroundColor: "{colors.status-progress-bg}"
    textColor: "{colors.status-progress-text}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "4px 8px"
  status-finalized:
    backgroundColor: "{colors.status-finalized-bg}"
    textColor: "{colors.status-finalized-text}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "4px 8px"
  status-return:
    backgroundColor: "{colors.status-return-bg}"
    textColor: "{colors.status-return-text}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "4px 8px"
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "38px"
  metric-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "16px"
  navigation-selected:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.green-deep}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  data-table:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "12px"
  filter-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "12px 0"
---

# Design System: OdontoFlow

## Overview

**Creative North Star: “OdontoFlow — Professional Workspace”**

The interface is a dependable workbench for a dental design technician: the person should be able to locate an OS, understand its state, and move between its details and production records without interpreting decoration. The chosen direction keeps the existing green recognition while using a quieter, more controlled palette and a consistent typographic and spacing system.

This is the target visual system for the incremental redesign; it is not yet implemented in the application. The exact core colors and direction name come from the user's specification. The supporting status pairs and numeric typography, spacing, and radius scales make that brief actionable; they are documented design proposals, not code changes, and should be checked in the first approved implementation. The current shell, data, workflows, Portuguese labels, dark theme, and existing logo assets remain evidence and functional constraints. The SVG mark is preserved for now; its current teal/navy values differ from the new UI palette and should be reconciled only in a separately reviewed brand-asset step.

**Key Characteristics:**
- Professional and functional, with a moderate presence of green.
- Neutral surfaces and restrained borders; use grouping only when information belongs together.
- Status color communicates meaning consistently across tables, kanban, notifications, and dashboard.
- Icons support labels; they do not become decorative tiles.
- Dense information remains readable at the desktop window's supported sizes.

## Colors

The palette keeps green as the identity color and reserves saturated or semantic color for actions and state. `#399271` against white has a 3.8:1 contrast ratio, so normal-size white text must not sit on that green; use `#236D54` for filled primary actions with white text. The proposed status text/background pairs below exceed 4.5:1 contrast and should be verified again against rendered controls.

### Primary
- **Odonto Green** (`#399271`): brand accents, selected indicators, chart emphasis, and focus treatment on light surfaces.
- **Deep Green** (`#236D54`): strong actions and readable text on the soft green surface; white text on this fill measures 6.2:1.
- **Soft Green** (`#EAF3EF`): selected navigation and quiet grouping behind green labels.

### Neutral
- **Paper** (`#F7F8F7`): application canvas.
- **White Surface** (`#FFFFFF`): work areas, inputs, tables, and dialogs.
- **Ink** (`#252D29`): primary text; 14.1:1 against white.
- **Secondary Ink** (`#5D6963`): secondary text; 5.7:1 against white.
- **Sage** (`#9AA59F`): subtle rules and non-text details, not small text on white.
- **Quiet Border** (`#E2E8E4`): fine separators that do not compete with content.

### Semantic status colors
- **Em andamento:** blue-gray (`#526875` on `#EEF3F5`, 5.2:1).
- **Finalizado:** green (`#236D54` on `#EAF3EF`, 5.5:1).
- **Retorno:** amber (`#7A551C` on `#FBF2E3`, 6.0:1).
- Status meaning must not depend on color alone; retain the written label and a consistent indicator shape.

**The One Green Rule.** Green identifies the product and important actions; do not flood whole screens with it or add unrelated colors to metric icons and chart series.

## Typography

- **Display Font:** Inter (fallback: `system-ui`, sans-serif).
- **Body Font:** Inter (fallback: `system-ui`, sans-serif).
- **Label/Mono Font:** Inter for labels; use the system monospace stack only for literal technical values.

**Character:** compact, neutral and highly legible. Use weight and spacing to establish hierarchy rather than many unrelated sizes or decorative type. The current stylesheet names Inter but does not bundle a font file; verify font availability on Windows during implementation and keep the fallback readable offline.

### Hierarchy
- **Page title** (600, 24px, 1.25): primary heading for the current workspace area.
- **Section title** (600, 16px, 1.4): table, panel, and dialog section headings.
- **Body** (400, 14px, 1.5): OS details, table content, and explanatory copy.
- **Label** (500, 12px, 1.4): field labels, status badges, and control labels.
- **Metric** (600, 24–28px): numeric values, with consistent alignment and no ornamental type treatment.

**The Readable Label Rule.** Avoid the current 8–10px text treatment for essential labels and table content; reserve smaller text for nonessential chart ticks only when the data remains understandable.

## Layout

Use a desktop workspace shell with stable primary navigation, a page header, and a clear work region. The current application has a 248px sidebar, a 100px top bar, 38px page insets, a 1540px content maximum, and a 1024×680 minimum window; preserve these as the layout baseline until an incremental screen change is approved. Keep the OS list and production views information-dense, with filters attached to the content they scope and tables allowed to scroll horizontally rather than compressing essential values.

Use the spacing tokens from 4px to 32px: 4/8px for tight control internals, 12/16px within groups, and 24/32px between sections. Do not add filler widgets to empty space. The app is desktop-first; retain the existing dark-theme capability and validate its palette and contrast when implementing the redesign. Exact dark-theme mappings remain an implementation decision.

## Elevation & Depth

Default to flat surfaces separated by background tone, fine borders, and spacing. Avoid large or persistent shadows. A restrained shadow may distinguish a modal or transient popover from the workspace; focus must be communicated with a visible outline, not shadow alone.

**The Flat-At-Rest Rule.** Cards and panels should not look raised when they are simply containers. Reserve elevation for overlays and transient interaction states.

## Shapes

Use a restrained radius scale: 6px for controls, 8px for grouped work surfaces, and 12px for dialogs. Keep borders thin and consistent. Status badges may be fully rounded because they are compact state labels; do not apply pill shapes to every control. Lucide icons remain unboxed line icons, generally 17–20px, with consistent stroke and neutral or semantic color only when it clarifies meaning.

## Components

Prefer existing functional components and refine their styling before introducing new abstractions. Current equivalents and their intended role:

- **AppSidebar:** currently inline in `src/App.tsx`; persistent navigation, selected state, and local-database indicator.
- **AppHeader / PageHeader:** the current `.topbar`, breadcrumb, period control, and page title are inline in `src/App.tsx`; maintain clear title/action hierarchy.
- **MetricCard:** reuse `src/components/Metric.tsx`; remove decorative colored icon tiles and keep the value, label, and period description aligned.
- **DataTable:** reuse `src/components/OrderTable.tsx`; keep readable headers, row hierarchy, status labels, and accessible horizontal overflow.
- **StatusBadge:** reuse `.status-pill` styling as the semantic source for order table, kanban, and notification states; apply the three approved status color pairs consistently.
- **FilterBar:** filters are currently assembled in `src/pages/ordens-servico/OrdensPage.tsx`; align field heights, labels, and spacing before extracting a shared component.
- **AppDialog:** dialogs are assembled in `src/App.tsx`; preserve their existing responsibilities and behavior while aligning overlay, header, field, and action styles.
- **EmptyState / FormField:** current empty states and fields are CSS/markup patterns rather than shared components; standardize their visual treatment before creating reusable wrappers.

### Buttons
- **Primary:** deep-green fill with white label; use for the main action in a page or dialog.
- **Secondary:** white or canvas surface with a quiet border and ink text.
- **Tertiary:** text or icon action with a clear hover and focus-visible state.
- **Destructive:** semantic red reserved for irreversible or destructive actions; keep it separate from status colors.
- Keep controls near 38px high, use the 6px radius, and provide visible keyboard focus.

### Status badges
- Keep the written status visible alongside a small consistent marker.
- Use the same three color pairs in tables, kanban cards, notifications, and summaries.
- Do not use amber for “Em andamento”; reserve amber for “Retorno”.

### Cards, tables, inputs, and navigation
- **Cards / containers:** white surface, subtle border, 8px radius, 16px internal spacing; use only for related content.
- **Tables:** clear row dividers, readable 12–14px text, aligned numeric values, no rainbow status treatment, and preserved scroll behavior.
- **Inputs:** white surface, quiet border, 6px radius, 38px control height, and deep-green focus outline with offset.
- **Navigation:** persistent and easy to scan; selected item uses soft green and deep-green text. Do not put a colored square behind every navigation icon.
- **Empty states:** concise, explain the current scope, and offer a relevant action only when one exists.

## Do's and Don'ts

### Do:
- **Do** use the exact core palette in this document and keep state colors consistent across all surfaces.
- **Do** use `#236D54` when a small white label sits on a filled primary button; `#399271` does not provide sufficient normal-text contrast with white.
- **Do** use Inter consistently, a small number of weights, and the documented type hierarchy.
- **Do** retain Portuguese product terminology, existing OS workflows, the current logo files, and the dark-theme capability during an incremental redesign.
- **Do** use spacing, alignment, and contrast to group information before adding a card or shadow.
- **Do** keep Lucide icons linear, mostly monochrome, and 17–20px unless a platform constraint requires otherwise.
- **Do** keep “OS cadastradas”, “trabalhos registrados”, and “ocorrências de retorno” visually distinct as different measures.

### Don't:
- **Don't** alter database behavior, Rust commands, service logic, or working OS/backup functionality as part of a visual change.
- **Don't** use a generic grid of identical cards for every dashboard section or add widgets merely to fill space.
- **Don't** wrap every icon in a colored tile, use a rotating rainbow palette without meaning, or use decorative star/greeting treatments as a substitute for hierarchy.
- **Don't** use large green fields, exaggerated shadows, excessive radii, or motion that delays access to information.
- **Don't** use 8–10px type for essential labels, table headers, or supporting instructions.
- **Don't** recolor or redraw the existing SVG brand assets until their legacy teal/navy palette has been reviewed against this system.
