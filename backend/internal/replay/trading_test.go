package replay

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/smc-trading-terminal/backend/internal/db/gen"
)

type activeStateRow struct{ active bool }

func (r activeStateRow) Scan(dest ...any) error {
	*(dest[0].(*bool)) = r.active
	return nil
}

type activeStateDB struct {
	active     bool
	rowQueries int
	otherCalls int
}

func (db *activeStateDB) QueryRow(context.Context, string, ...any) pgx.Row {
	db.rowQueries++
	return activeStateRow{active: db.active}
}

func (db *activeStateDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	db.otherCalls++
	return nil, nil
}

func (db *activeStateDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	db.otherCalls++
	return pgconn.CommandTag{}, nil
}

func tradingBar(open, high, low, close float64) gen.ReplayDatasetBar {
	return gen.ReplayDatasetBar{Seq: 7, OpenTime: timestamp(time.Unix(1_700_000_000, 0)),
		Open: numeric(open), High: numeric(high), Low: numeric(low), Close: numeric(close)}
}

func TestReplayLimitAndStopGapRules(t *testing.T) {
	limit := 100.0
	price, ok := triggerPrice(ledgerOrder{Side: "buy", Type: "limit", Limit: &limit}, tradingBar(98, 101, 97, 100))
	if !ok || price != 98 {
		t.Fatalf("buy limit gap should fill at executable open: price=%v ok=%v", price, ok)
	}
	stop := 105.0
	price, ok = triggerPrice(ledgerOrder{Side: "buy", Type: "stop", Stop: &stop}, tradingBar(107, 109, 106, 108))
	if !ok || price != 107 {
		t.Fatalf("buy stop gap should fill at executable open: price=%v ok=%v", price, ok)
	}
}

func TestReplayConservativePathOrdersBracketHits(t *testing.T) {
	sl, tp := 95.0, 105.0
	long := ledgerPosition{ID: pgtype.UUID{Valid: true}, Net: 1, SL: &sl, TP: &tp}
	price, kind, ok := bracketPrice(long, tradingBar(100, 106, 94, 101))
	if !ok || kind != "stop_loss" || price != sl {
		t.Fatalf("bullish path must visit low before high: price=%v kind=%s ok=%v", price, kind, ok)
	}
	price, kind, ok = bracketPrice(long, tradingBar(100, 106, 94, 99))
	if !ok || kind != "take_profit" || price != tp {
		t.Fatalf("bearish path must visit high before low: price=%v kind=%s ok=%v", price, kind, ok)
	}
}

func TestReplayBracketMustBeOnCorrectSideOfEntry(t *testing.T) {
	longStop, longTarget := 99.0, 101.0
	if !validBracket("buy", 100, &longStop, &longTarget) {
		t.Fatal("valid long bracket rejected")
	}
	if validBracket("sell", 100, &longStop, &longTarget) {
		t.Fatal("invalid short bracket accepted")
	}
}

func TestReplayTradingInputDefaultsAndValidation(t *testing.T) {
	got, err := validateTradingInput(&TradingInput{Enabled: true})
	if err != nil || got.StartingEquity != 10000 || got.BaseCurrency != "USD" {
		t.Fatalf("defaults=%#v err=%v", got, err)
	}
	if _, err := validateTradingInput(&TradingInput{Enabled: true, StartingEquity: "invalid"}); err == nil {
		t.Fatal("expected invalid starting equity to fail")
	}
}

func TestReplayPerUnitCommissionIsAuditable(t *testing.T) {
	got, err := commissionFromModel([]byte(`{"kind":"per_unit","value":"0.25"}`), 4)
	if err != nil || got != 1 {
		t.Fatalf("commission=%v err=%v", got, err)
	}
}

func TestReplayBatchSkipsPerBarLedgerQueriesWithoutOrdersOrPositions(t *testing.T) {
	db := &activeStateDB{}
	ledger := &ledgerRuntime{db: db, sessionID: pgtype.UUID{Valid: true}}
	rows := make([]gen.ReplayDatasetBar, 150)
	track := &gen.ListReplayTracksForSessionForUpdateRow{ID: pgtype.UUID{Valid: true}}
	drafts, err := ledger.processRows(context.Background(), track, rows)
	if err != nil || len(drafts) != 0 {
		t.Fatalf("drafts=%#v err=%v", drafts, err)
	}
	if db.rowQueries != 1 || db.otherCalls != 0 {
		t.Fatalf("row queries=%d other calls=%d", db.rowQueries, db.otherCalls)
	}
}

func TestReplayReportDerivesMultipleClosedTradesFromFillLedger(t *testing.T) {
	state, closed, _ := applyReportFill(reportPositionState{}, "buy", 100, 1, 1)
	if closed {
		t.Fatal("entry must not count as a closed trade")
	}
	state, closed, pnl := applyReportFill(state, "sell", 110, 1, 1)
	if !closed || pnl != 8 {
		t.Fatalf("first close: state=%#v closed=%t pnl=%v", state, closed, pnl)
	}
	state, _, _ = applyReportFill(state, "sell", 105, 2, 0)
	_, closed, pnl = applyReportFill(state, "buy", 100, 2, 0)
	if !closed || pnl != 10 {
		t.Fatalf("second close: closed=%t pnl=%v", closed, pnl)
	}
}
