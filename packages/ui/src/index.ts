// Owner task: EB-91 UI design system — public API of @klarity/ui.
export { Icon, type IconName } from "./components/Icon";
export { Logo, LogoMark } from "./components/Logo";
export { Badge, buttonClass, Card, EmptyState, Kbd, PageHeader, Skeleton, type ButtonVariant, type Tone } from "./components/primitives";
export { Modal, Segmented, Sheet, TabPanel, Tabs, ToastProvider, useToast } from "./components/interactive";
export { ShellFrame } from "./components/ShellFrame";
export { BarChart, KpiTile, Meter, Money, SourceTag, Stepper, Timeline, type BarDatum, type TimelineItem } from "./data/components";
export { DataTable, type Column } from "./data/DataTable";
export {
  formatDate,
  formatDateTime,
  formatINR,
  formatINRCompact,
  formatINRShort,
  formatLakhNumber,
  formatNumber,
  formatPercent,
  formatRelative,
  initials,
} from "./data/format";

// Enterprise Brain kit (54-screen handoff)
export {
  Avatar,
  AvatarStack,
  Bento,
  BentoHead,
  Dot,
  Grid,
  Highlighted,
  LiveCard,
  Metric,
  Mono,
  OriginTag,
  Pill,
  PillButton,
  PillLink,
  Row,
  ScreenCrumb,
  Stack,
  type BentoProps,
  type BentoTone,
  type PillTone,
} from "./eb/kit";
export {
  BarRow,
  Columns,
  LineChart,
  ProgressTrack,
  Sparkline,
  StripedPlaceholder,
  Waveform,
  WedgeChart,
  linePath,
  sectorPath,
  sparkPath,
  wedgeGeometry,
  type ColumnDatum,
  type FillTone,
  type Wedge,
} from "./eb/charts";
export { NodeGraph, type GraphNode } from "./eb/graph";
export { EbShell, type LauncherGroup, type PeriodOption, type RailItem } from "./eb/EbShell";
