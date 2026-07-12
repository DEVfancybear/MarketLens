export interface DrawingLoadToken {
  symbol: string;
  generation: number;
}

/** Rejects responses superseded by a newer request, including same-symbol reloads. */
export class DrawingLoadGuard {
  private generation = 0;

  begin(symbol: string): DrawingLoadToken {
    return { symbol, generation: ++this.generation };
  }

  isCurrent(token: DrawingLoadToken, activeSymbol: string): boolean {
    return token.generation === this.generation && token.symbol === activeSymbol;
  }

  cancel(): void {
    this.generation++;
  }
}
