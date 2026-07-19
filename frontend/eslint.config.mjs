import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    rules: {
      "@next/next/no-img-element": "off",
      "react-hooks/exhaustive-deps": "warn",
      // Next 16 enables React compiler migration rules that were not part of
      // this repository's previous lint contract. Keep the dependency patched
      // without turning an unrelated security update into an 87-file refactor.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/static-components": "off",
    },
  },
  {
    files: ["src/components/replay/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/store/chartStore",
              importNames: ["candlesAtom"],
              message: "Replay UI receives candidate coordinates as props; it must not own full chart history.",
            },
            {
              name: "@/services/market-data/HistoricalDataService",
              message: "Active Replay history is loaded by the backend dataset service.",
            },
            {
              name: "@/services/tradeEngine",
              message: "Replay orders and fills are owned by the backend ledger.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
