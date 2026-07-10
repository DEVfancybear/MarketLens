import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "@next/next/no-img-element": "off",
      "react-hooks/exhaustive-deps": "warn",
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
