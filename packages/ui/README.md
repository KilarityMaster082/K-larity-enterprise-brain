# @klarity/ui

> Owner task: EB-91 UI design system and component library (brand: EB-90)

The K!larity design system, shared by `apps/web` (the Brain) and `apps/admin` (the operator console).

- `brand/`: logo assets extracted from the master logo (`logo-original.png`). Brand orange `#fd5910` and ink `#030303` are sampled from it.
- `src/styles/tokens.css`: every colour, size and radius. Components read tokens and never raw colours.
- `src/styles/*.css`: base, components, shell and data layers. Apps import `@klarity/ui/styles.css` once.
- `src/components`: Logo, Icon, Button, Badge, Card, PageHeader, EmptyState, Skeleton, Field, Tabs, Sheet, Toast, ShellFrame.
- `src/data`: Money, KpiTile, DataTable, BarChart, Meter, Timeline, Stepper. Every number component can show its source and drill down to evidence.

Rules:
- WCAG 2.1 AA in light and dark. `tests/contrast.test.ts` fails the build if a text/background pair drops below 4.5:1.
- Indian formats: ₹ lakh/crore, with the exact value on hover; dates in IST.
- No runtime dependencies beyond React.

Run the tests with `pnpm --filter @klarity/ui test`.
