package replay

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/smc-trading-terminal/backend/internal/mt5stream"
)

type fakeHistory struct {
	snapshot          mt5stream.Snapshot
	result            mt5stream.HistorySnapshot
	symbol, timeframe string
	limit             int
	before            int64
}

func (f *fakeHistory) Snapshot() mt5stream.Snapshot { return f.snapshot }
func (f *fakeHistory) History(_ context.Context, symbol, timeframe string, limit int, before int64, _ bool) mt5stream.HistorySnapshot {
	f.symbol = symbol
	f.timeframe = timeframe
	f.limit = limit
	f.before = before
	return f.result
}

type fakeStore struct {
	prepared PreparedSession
	snapshot SessionSnapshot
}

func (f *fakeStore) Prepare(_ context.Context, _ string, value PreparedSession) (SessionSnapshot, error) {
	f.prepared = value
	return f.snapshot, nil
}
func (f *fakeStore) Get(context.Context, string, string) (SessionSnapshot, error) {
	return f.snapshot, nil
}
func (f *fakeStore) Close(context.Context, string, string) (SessionSnapshot, error) {
	return f.snapshot, nil
}
func (f *fakeStore) Cleanup(context.Context, time.Time, time.Time, int32) (CleanupResult, error) {
	return CleanupResult{}, nil
}

func TestServiceCreatePinsPausedSingleChartDataset(t *testing.T) {
	start := time.Unix(1_700_000_060, 0).UTC()
	history := &fakeHistory{
		snapshot: mt5stream.Snapshot{Symbols: []mt5stream.Symbol{{Name: "EURUSD"}}},
		result: mt5stream.HistorySnapshot{Source: "mt5", UpdatedAt: start, Candles: []mt5stream.Candle{
			{Time: start.Add(-time.Minute).Unix(), Open: 1, High: 2, Low: .5, Close: 1.2, Volume: 10},
			{Time: start.Unix(), Open: 1.2, High: 2, Low: 1, Close: 1.5, Volume: 11},
			{Time: start.Add(time.Minute).Unix(), Open: 1.5, High: 2, Low: 1, Close: 1.8, Volume: 12},
		}},
	}
	store := &fakeStore{snapshot: SessionSnapshot{Status: "paused"}}
	service := NewService(store, history, 100)
	got, err := service.Create(context.Background(), "user", CreateSessionInput{Start: StartInput{Kind: "time", Time: start}, Tracks: []TrackInput{{Slot: 0, Symbol: "eurusd", ChartTimeframe: "1m"}}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "paused" || history.symbol != "EURUSD" || history.timeframe != "1m" || history.limit != 100 {
		t.Fatalf("unexpected create result/history call: %#v %#v", got, history)
	}
	if store.prepared.StartTime != start || len(store.prepared.Tracks) != 1 || len(store.prepared.Tracks[0].Checksum) != 64 {
		t.Fatalf("unexpected prepared session: %#v", store.prepared)
	}
}

func TestServiceCreateSelectsTheRevealedBarAtOrBeforeRequestedTime(t *testing.T) {
	first := time.Unix(1_700_000_040, 0).UTC()
	requested := first.Add(59 * time.Second)
	history := &fakeHistory{result: mt5stream.HistorySnapshot{Candles: []mt5stream.Candle{
		{Time: first.Unix(), Open: 1, High: 2, Low: .5, Close: 1.2, Volume: 10},
		{Time: first.Add(time.Minute).Unix(), Open: 1.2, High: 2, Low: 1, Close: 1.5, Volume: 11},
	}}}
	store := &fakeStore{snapshot: SessionSnapshot{Status: "paused"}}
	_, err := NewService(store, history, 100).Create(context.Background(), "user", CreateSessionInput{
		Start:  StartInput{Kind: "time", Time: requested},
		Tracks: []TrackInput{{Slot: 0, Symbol: "EURUSD", ChartTimeframe: "1m"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if store.prepared.StartTime != first || store.prepared.Tracks[0].CursorSeq != 0 {
		t.Fatalf("selected future candle: %#v", store.prepared)
	}
}

func TestServiceCreateRejectsEndOutsidePreparedDataset(t *testing.T) {
	first := time.Unix(1_700_000_040, 0).UTC()
	history := &fakeHistory{result: mt5stream.HistorySnapshot{Candles: []mt5stream.Candle{
		{Time: first.Unix(), Open: 1, High: 2, Low: .5, Close: 1.2, Volume: 10},
	}}}
	end := first.Add(2 * time.Minute)
	_, err := NewService(&fakeStore{}, history, 100).Create(context.Background(), "user", CreateSessionInput{
		Start:   StartInput{Kind: "time", Time: first},
		EndTime: &end,
		Tracks:  []TrackInput{{Slot: 0, Symbol: "EURUSD", ChartTimeframe: "1m"}},
	})
	if !errors.Is(err, ErrDataUnavailable) {
		t.Fatalf("expected unavailable endTime, got %v", err)
	}
}

func TestServiceCreateRejectsUnsupportedCatalogSymbol(t *testing.T) {
	history := &fakeHistory{snapshot: mt5stream.Snapshot{Symbols: []mt5stream.Symbol{{Name: "EURUSD"}}}}
	_, err := NewService(&fakeStore{}, history, 10).Create(context.Background(), "user", CreateSessionInput{Start: StartInput{Kind: "time", Time: time.Now()}, Tracks: []TrackInput{{Slot: 0, Symbol: "BTCUSD", ChartTimeframe: "1m"}}})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request, got %v", err)
	}
}

func TestServiceCreateReportsProviderFailure(t *testing.T) {
	history := &fakeHistory{result: mt5stream.HistorySnapshot{LastError: "bridge unavailable"}}
	_, err := NewService(&fakeStore{}, history, 10).Create(context.Background(), "user", CreateSessionInput{Start: StartInput{Kind: "time", Time: time.Now()}, Tracks: []TrackInput{{Slot: 0, Symbol: "EURUSD", ChartTimeframe: "1m"}}})
	if !errors.Is(err, ErrDatasetPreparation) {
		t.Fatalf("expected dataset preparation failure, got %v", err)
	}
}

func TestServiceCreateReportsUnavailableDataWithoutProviderError(t *testing.T) {
	history := &fakeHistory{result: mt5stream.HistorySnapshot{Candles: []mt5stream.Candle{}}}
	_, err := NewService(&fakeStore{}, history, 10).Create(context.Background(), "user", CreateSessionInput{Start: StartInput{Kind: "time", Time: time.Now()}, Tracks: []TrackInput{{Slot: 0, Symbol: "EURUSD", ChartTimeframe: "1m"}}})
	if !errors.Is(err, ErrDataUnavailable) {
		t.Fatalf("expected unavailable data, got %v", err)
	}
}
