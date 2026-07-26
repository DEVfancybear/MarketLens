import type {
  ExecutionAccountInstrumentsWire,
  ExecutionInstrumentWire,
} from "@/services/api/resources/executionApi";
import type { Mt5SymbolInfo } from "@/types/mt5";

/**
 * Projects broker-neutral execution metadata into the legacy MT5 calculator
 * contract. The durable Rust registry remains the source of truth.
 */
export function projectExecutionInstrumentsToMt5Symbols(
  registry: ExecutionAccountInstrumentsWire,
  observedAt = Date.now(),
): Record<string, Mt5SymbolInfo> {
  const instrumentsByVenue = new Map(
    registry.instruments.map((instrument) => [
      normalizeSymbol(instrument.venueSymbol),
      instrument,
    ]),
  );
  const projected = new Map<string, Mt5SymbolInfo>();

  for (const instrument of registry.instruments) {
    const info = projectInstrument(
      instrument.canonicalSymbol,
      instrument,
      observedAt,
    );
    if (info) projected.set(normalizeSymbol(info.chartSymbol), info);
  }

  for (const mapping of registry.mappings) {
    const instrument = instrumentsByVenue.get(
      normalizeSymbol(mapping.venueSymbol),
    );
    if (!instrument) continue;
    const info = projectInstrument(
      mapping.canonicalSymbol,
      instrument,
      observedAt,
    );
    if (info) projected.set(normalizeSymbol(info.chartSymbol), info);
  }

  return Object.fromEntries(projected);
}

function projectInstrument(
  chartSymbol: string,
  instrument: ExecutionInstrumentWire,
  observedAt: number,
): Mt5SymbolInfo | null {
  const lotStep = positiveNumber(instrument.quantityStep);
  const minLot = positiveNumber(instrument.minQuantity);
  const maxLot = positiveNumber(instrument.maxQuantity);
  const priceTick = positiveNumber(instrument.priceTick);
  if (
    !chartSymbol.trim() ||
    !instrument.venueSymbol.trim() ||
    lotStep == null ||
    minLot == null ||
    maxLot == null ||
    maxLot < minLot ||
    priceTick == null
  ) {
    return null;
  }

  const tickValue = positiveNumber(instrument.tickValuePerQuantity);
  const minStopDistance = nonNegativeNumber(instrument.minStopDistance);
  return {
    chartSymbol: chartSymbol.trim(),
    brokerSymbol: instrument.venueSymbol.trim(),
    digits: decimalPlaces(instrument.priceTick),
    point: priceTick,
    lotStep,
    minLot,
    maxLot,
    brokerMaxLot: maxLot,
    tickSize: priceTick,
    ...(tickValue == null
      ? {}
      : {
          tickValue,
          tickValueLoss: tickValue,
          tickValueProfit: tickValue,
        }),
    ...(minStopDistance == null ? {} : { minStopDistance }),
    tradeMode: instrument.tradeAllowed ? "full" : "disabled",
    updatedAt: observedAt,
  };
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function positiveNumber(value: string | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: string | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function decimalPlaces(value: string): number {
  const normalized = value.trim().toLowerCase();
  const [coefficient, exponentText] = normalized.split("e");
  const fractionLength = coefficient?.split(".")[1]?.length ?? 0;
  const exponent = exponentText == null ? 0 : Number(exponentText);
  return Number.isFinite(exponent)
    ? Math.max(0, fractionLength - exponent)
    : fractionLength;
}
