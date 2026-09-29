// Owner task: EB-91 UI design system — inline stroke icons (no icon-library dependency).
import type { SVGProps } from "react";

const PATHS = {
  ask: ["M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z", "M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"],
  projects: ["M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"],
  finance: ["M7 5h10", "M7 9.5h10", "M7 5c4 0 6 1.5 6 4.5S11 14 7 14l7 6"],
  decisions: ["M9 12l2 2 4-4", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"],
  documents: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 13h6", "M9 17h6"],
  approvals: ["M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z", "M4 13h4l1.5 2.5h5L16 13h4"],
  executive: ["M4 19h16", "M7 16v-5", "M12 16V6", "M17 16v-8"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  ],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  send: ["M5 12h13", "M12 5l7 7-7 7"],
  arrowRight: ["M5 12h14", "M13 6l6 6-6 6"],
  arrowLeft: ["M19 12H5", "M11 6l-6 6 6 6"],
  chevronDown: ["M6 9l6 6 6-6"],
  chevronRight: ["M9 6l6 6-6 6"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  checkCircle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M8.5 12.5l2.5 2.5 4.5-5"],
  xCircle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.5 9.5l5 5", "M14.5 9.5l-5 5"],
  thumbUp: ["M7 11v9H4v-9z", "M7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"],
  thumbDown: ["M7 13V4H4v9z", "M7 13l4 8a2 2 0 0 0 2-2v-4h5.5a2 2 0 0 0 2-2.3l-1.2-7A2 2 0 0 0 17.3 4H7"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  sun: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"],
  logout: ["M15 17l5-5-5-5", "M20 12H9", "M12 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7"],
  mail: ["M4 6h16v12H4z", "M4 7l8 6 8-6"],
  chat: ["M4 5h16v11H9l-5 4z"],
  sheet: ["M4 4h16v16H4z", "M4 10h16", "M4 15h16", "M10 4v16"],
  drawing: ["M4 20L20 4", "M4 4h7v7H4z", "M13 13h7v7h-7z"],
  alert: ["M12 3l9.5 17h-19z", "M12 10v4", "M12 17.5v.01"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v5", "M12 7.5v.01"],
  question: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7", "M12 16.5v.01"],
  database: ["M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z", "M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
  shield: ["M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"],
  lock: ["M6 11h12v10H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-3.5-3.5"],
  plus: ["M12 5v14", "M5 12h14"],
  edit: ["M4 20h4L19 9l-4-4L4 16z", "M13.5 6.5l4 4"],
  users: ["M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1", "M16 3.2a4 4 0 0 1 0 7.6", "M18 14a6 6 0 0 1 4 5.7V21"],
  plug: ["M9 3v5", "M15 3v5", "M6 8h12v3a6 6 0 0 1-12 0z", "M12 17v4"],
  refresh: ["M20 11a8 8 0 0 0-14.8-4.2L4 8", "M4 4v4h4", "M4 13a8 8 0 0 0 14.8 4.2L20 16", "M20 20v-4h-4"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  calendar: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4"],
  flag: ["M5 21V4", "M5 4h11l-2 4 2 4H5"],
  trendUp: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
  trendDown: ["M3 7l6 6 4-4 8 8", "M15 17h6v-6"],
  eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  download: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"],
  building: ["M4 21V5l8-2v18", "M12 8h8v13", "M7 8h2", "M7 12h2", "M7 16h2", "M15 12h2", "M15 16h2", "M2 21h20"],
  layers: ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5", "M3 17.5l9 5 9-5"],
  pulse: ["M3 12h4l3-7 4 14 3-7h4"],
  audit: ["M9 4h6", "M9 3h6v3H9z", "M6 5h3", "M15 5h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1", "M9 12l2 2 4-4"],
  mask: ["M3 8c3-2 15-2 18 0 0 6-3 9-6 9-1.5 0-2-1.5-3-1.5S10.5 17 9 17c-3 0-6-3-6-9z", "M8 11h2", "M14 11h2"],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
