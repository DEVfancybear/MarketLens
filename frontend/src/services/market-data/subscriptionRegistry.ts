export class SymbolSubscriptionRegistry {
  private readonly keysBySymbol = new Map<string, Set<string>>();

  add(symbol: string, key: string): boolean {
    const keys = this.keysBySymbol.get(symbol) ?? new Set<string>();
    if (keys.has(key)) return false;
    keys.add(key);
    this.keysBySymbol.set(symbol, keys);
    return true;
  }

  has(symbol: string): boolean {
    return this.keysBySymbol.has(symbol);
  }

  remove(symbol: string, key: string): boolean {
    const keys = this.keysBySymbol.get(symbol);
    if (!keys) return false;
    keys.delete(key);
    if (keys.size > 0) return true;
    this.keysBySymbol.delete(symbol);
    return false;
  }
}
