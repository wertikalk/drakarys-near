import React from "react";

export const TEAMS = {
  A: { name: "Emberfall" },
  B: { name: "Tidewater" },
};

// Same purple/ink as the on-pitch dots, so the tables read as the same kits.
// `ink` is the contrasting tone used for numbers and crest glyphs.
export const JERSEY = {
  A: {
    light: { fill: "rgb(96, 80, 220)", ink: "#140c28" },
    dark: { fill: "rgb(96, 80, 220)", ink: "#140c28" },
  },
  B: {
    light: { fill: "#ffffff", ink: "#140c28" },
    dark: { fill: "#ffffff", ink: "#140c28" },
  },
  keeper: { fill: "#8b8296", ink: "#140c28" },
};

export const Jersey = ({ fill, ink = "#140c28", number }) => (
  <svg
    className="jersey"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M8.6 3 3.4 5.6 5.6 10l1.8-.9V21h9.2V9.1l1.8.9 2.2-4.4L15.4 3c-.5 1.3-1.9 2.3-3.4 2.3S9.1 4.3 8.6 3z"
      fill={fill}
      stroke="rgba(20, 12, 40, 0.35)"
      strokeWidth="1"
    />
    <text
      x="12"
      y="16.8"
      textAnchor="middle"
      fontSize="7"
      fontWeight="700"
      fill={ink}
    >
      {number}
    </text>
  </svg>
);

// Shield badge per team: Emberfall carries a flame, Tidewater carries waves
export const Crest = ({ team, fill, ink = "#140c28", className, ...rest }) => (
  <svg
    className={`crest${className ? ` ${className}` : ""}`}
    viewBox="0 0 48 56"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path
      d="M24 2 44 9v20c0 13-9 22-20 25C13 51 4 42 4 29V9Z"
      fill={fill}
      stroke={team === "B" ? "#140c28" : "rgba(20, 12, 40, 0.35)"}
      strokeWidth={team === "B" ? 3.5 : 1.5}
      strokeLinejoin="round"
      paintOrder="stroke"
    />
    {team === "A" ? (
      <>
        <path
          d="M24 14c6 7 10 11 10 17a10 10 0 1 1-20 0c0-6 4-10 10-17Z"
          fill={ink}
        />
        <path
          d="M24 28c3 3.5 5 5.5 5 8.5a5 5 0 1 1-10 0c0-3 2-5 5-8.5Z"
          fill={fill}
        />
      </>
    ) : (
      <>
        {/* white foam band across the lower third of the shield */}
        <path
          d="M5 38 Q12 33 19 37 T33.5 37 T43 38 C43 44 34 50 24 53 C14 50 5 44 5 38 Z"
          fill="#f4f4f6"
        />
        <g fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round">
          <path d="M14 22q5-5 10 0t10 0" />
          <path d="M14 29q5-5 10 0t10 0" />
          <path d="M14 36q5-5 10 0t10 0" />
        </g>
      </>
    )}
  </svg>
);
