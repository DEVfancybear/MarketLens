package simtrading

import (
	"encoding/json"
	"math"
	"testing"
	"time"
)

func TestNormalizePositionLifecycle(t *testing.T) {
	closeTime := time.Now().UTC()
	valid := PositionWrite{ClientID: "pos-1", Symbol: "EURUSD", Side: "long", Type: "market", Status: "closed", Entry: 1.1, Quantity: 2, Remaining: 0, RiskAmount: 100, Fills: json.RawMessage(`[{"time":1,"price":1.1,"quantity":2,"kind":"open"}]`), CloseTime: &closeTime}
	if _, err := normalizePosition(valid); err != nil { t.Fatalf("valid position: %v", err) }
	valid.Remaining = 1
	if _, err := normalizePosition(valid); err == nil { t.Fatal("closed position with remainder must fail") }
	valid.Remaining, valid.Entry = 0, math.Inf(1)
	if _, err := normalizePosition(valid); err == nil { t.Fatal("infinite entry must fail") }
}

func TestAnalyticsMatchesClientDefinitions(t *testing.T) {
	t1, t2, t3 := time.Unix(100, 0), time.Unix(200, 0), time.Unix(300, 0)
	positions := []Position{
		{RealizedPnL: 200, RiskAmount: 100, CloseTime: &t1},
		{RealizedPnL: -100, RiskAmount: 100, CloseTime: &t2},
		{RealizedPnL: 0, RiskAmount: 50, CloseTime: &t3},
	}
	r := computeAnalytics(Account{StartingEquity: 10_000}, positions)
	if r.Summary.TotalTrades != 3 || r.Summary.Wins != 1 || r.Summary.Losses != 1 || r.Summary.Breakeven != 1 { t.Fatalf("counts: %+v", r.Summary) }
	if math.Abs(r.Summary.WinRate-100.0/3.0) > 1e-9 || r.Summary.ProfitFactor != 2 || r.Summary.NetPnL != 100 { t.Fatalf("summary: %+v", r.Summary) }
	if r.Summary.MaxDrawdown != -100 || len(r.Equity) != 3 || r.Equity[2].Equity != 10_100 { t.Fatalf("curve: %+v summary=%+v", r.Equity, r.Summary) }
	if r.Distribution[5].Count != 1 || r.Distribution[1].Count != 1 || r.Distribution[3].Count != 1 { t.Fatalf("distribution: %+v", r.Distribution) }
}
