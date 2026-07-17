import {
  getIndicatorRuntimeDefinition,
  listIndicatorRuntimeCatalog,
  type IndicatorRuntimeDefinition,
} from "@/services/api/resources/indicatorRuntimeApi";
import { indicatorRuntimeHash } from "@/services/indicatorRuntimePolicy";

export {
  defaultIndicatorInputs,
  defaultIndicatorStyles,
  indicatorConfigFromDefinition,
  indicatorInputsFromConfig,
  indicatorStyleFieldKey,
  indicatorStylesFromConfig,
} from "@/services/indicatorDefinitionModel";

let catalogPromise: Promise<IndicatorRuntimeDefinition[]> | null = null;
const definitionPromises = new Map<string, Promise<IndicatorRuntimeDefinition>>();

function definitionKey(request: { indicatorType?: string; sourceCode?: string }): string {
  const source = request.sourceCode?.trim() ?? "";
  return source
    ? `source:${request.indicatorType ?? ""}:${indicatorRuntimeHash(source)}`
    : `catalog:${request.indicatorType ?? ""}`;
}

export function loadIndicatorCatalog(): Promise<IndicatorRuntimeDefinition[]> {
  catalogPromise ??= listIndicatorRuntimeCatalog()
    .then((definitions) => {
      for (const definition of definitions) {
        definitionPromises.set(
          definitionKey({ indicatorType: definition.type }),
          Promise.resolve(definition),
        );
      }
      return definitions;
    })
    .catch((error) => {
      catalogPromise = null;
      throw error;
    });
  return catalogPromise;
}

export function loadIndicatorDefinition(request: {
  indicatorType?: string;
  sourceCode?: string;
}): Promise<IndicatorRuntimeDefinition> {
  const key = definitionKey(request);
  let promise = definitionPromises.get(key);
  if (!promise) {
    promise = getIndicatorRuntimeDefinition(request).catch((error) => {
      definitionPromises.delete(key);
      throw error;
    });
    definitionPromises.set(key, promise);
  }
  return promise;
}
