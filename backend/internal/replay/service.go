package replay

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/smc-trading-terminal/backend/internal/mt5stream"
)

type HistorySource interface {
	Snapshot() mt5stream.Snapshot
	History(context.Context, string, string, int, int64, bool) mt5stream.HistorySnapshot
}

type SessionStore interface {
	Prepare(context.Context, string, PreparedSession) (SessionSnapshot, error)
	Get(context.Context, string, string) (SessionSnapshot, error)
	Close(context.Context, string, string) (SessionSnapshot, error)
	Cleanup(context.Context, time.Time, time.Time, int32) (CleanupResult, error)
}

type Service struct {
	store   SessionStore
	history HistorySource
	maxBars int
}

func NewService(store SessionStore, history HistorySource, maxBars int) *Service {
	if maxBars <= 0 || maxBars > 5000 {
		maxBars = 5000
	}
	return &Service{store: store, history: history, maxBars: maxBars}
}

func (s *Service) Create(ctx context.Context, userID string, input CreateSessionInput) (SessionSnapshot, error) {
	if input.Mode == "" {
		input.Mode = "single_chart"
	}
	if input.Mode != "single_chart" {
		return SessionSnapshot{}, fmt.Errorf("%w: Phase 1 supports single_chart mode only", ErrBadRequest)
	}
	if input.Start.Kind == "" {
		input.Start.Kind = "time"
	}
	if input.Start.Kind != "time" || input.Start.Time.IsZero() {
		return SessionSnapshot{}, fmt.Errorf("%w: start.kind=time and start.time are required", ErrBadRequest)
	}
	if input.ReplayInterval == "" {
		input.ReplayInterval = "auto"
	}
	if input.ReplayInterval != "auto" {
		return SessionSnapshot{}, fmt.Errorf("%w: Phase 1 supports replayInterval=auto only", ErrBadRequest)
	}
	if input.Speed == 0 {
		input.Speed = 1
	}
	if !finite(input.Speed) || input.Speed <= 0 || input.Speed > 100 {
		return SessionSnapshot{}, fmt.Errorf("%w: speed must be between 0 and 100", ErrBadRequest)
	}
	if len(input.Tracks) != 1 || input.Tracks[0].Slot != 0 {
		return SessionSnapshot{}, fmt.Errorf("%w: Phase 1 requires exactly one track in slot 0", ErrBadRequest)
	}
	track := input.Tracks[0]
	track.Symbol = strings.ToUpper(strings.TrimSpace(track.Symbol))
	tf, interval, ok := normalizeTimeframe(track.ChartTimeframe)
	if track.Symbol == "" || !ok {
		return SessionSnapshot{}, fmt.Errorf("%w: valid symbol and chartTimeframe are required", ErrBadRequest)
	}
	if !catalogHasSymbol(s.history.Snapshot(), track.Symbol) {
		return SessionSnapshot{}, fmt.Errorf("%w: unsupported symbol %s", ErrBadRequest, track.Symbol)
	}
	if input.EndTime != nil && input.EndTime.Before(input.Start.Time) {
		return SessionSnapshot{}, fmt.Errorf("%w: endTime precedes start time", ErrBadRequest)
	}

	// Put the requested point around 70%% through the immutable window, leaving
	// both historical context and future rows without exposing them to the client.
	before := input.Start.Time.Unix() + int64(float64(s.maxBars*interval)*0.30)
	history := s.history.History(ctx, track.Symbol, tf, s.maxBars, before, false)
	bars, err := normalizeCandles(history.Candles)
	if err != nil {
		return SessionSnapshot{}, err
	}
	if len(bars) == 0 {
		if history.LastError != "" {
			return SessionSnapshot{}, fmt.Errorf("%w: %s", ErrDatasetPreparation, history.LastError)
		}
		return SessionSnapshot{}, fmt.Errorf("%w: no candles returned for the requested time", ErrDataUnavailable)
	}
	availableEnd := bars[len(bars)-1].Time.Add(time.Duration(interval) * time.Second)
	if input.Start.Time.Before(bars[0].Time) || !input.Start.Time.Before(availableEnd) {
		return SessionSnapshot{}, fmt.Errorf("%w: requested time is outside the prepared history window", ErrDataUnavailable)
	}
	if input.EndTime != nil && input.EndTime.After(availableEnd) {
		return SessionSnapshot{}, fmt.Errorf("%w: endTime is outside the prepared history window", ErrDataUnavailable)
	}
	cursor, selected, ok := barAtOrBefore(bars, input.Start.Time.UTC())
	if !ok {
		return SessionSnapshot{}, fmt.Errorf("%w: requested time precedes the first prepared candle", ErrDataUnavailable)
	}
	meta, _ := json.Marshal(map[string]any{"source": history.Source, "lastError": history.LastError})
	preparedTrack := PreparedTrack{
		Slot: 0, Symbol: track.Symbol, Provider: "mt5", ChartTimeframe: tf,
		IntervalSeconds: interval, RequestedStart: input.Start.Time.UTC(), CursorSeq: cursor,
		VisibleThrough: selected, Checksum: datasetChecksum("mt5", track.Symbol, tf, interval, bars),
		SnapshotAt: history.UpdatedAt.UTC(), SourceMeta: meta, Bars: bars,
	}
	if preparedTrack.SnapshotAt.IsZero() {
		preparedTrack.SnapshotAt = time.Now().UTC()
	}
	config, _ := json.Marshal(map[string]any{"phase": 1, "requestedStartTime": input.Start.Time.UTC()})
	return s.store.Prepare(ctx, userID, PreparedSession{
		Mode: input.Mode, Speed: input.Speed, ReplayIntervalSeconds: interval,
		StartTime: selected, EndTime: input.EndTime, Config: config, Tracks: []PreparedTrack{preparedTrack},
	})
}

func (s *Service) Get(ctx context.Context, userID, sessionID string) (SessionSnapshot, error) {
	return s.store.Get(ctx, userID, sessionID)
}
func (s *Service) Close(ctx context.Context, userID, sessionID string) (SessionSnapshot, error) {
	return s.store.Close(ctx, userID, sessionID)
}

func catalogHasSymbol(snapshot mt5stream.Snapshot, symbol string) bool {
	// During bridge warm-up an empty catalog is not evidence that a symbol is invalid.
	if len(snapshot.Symbols) == 0 && len(snapshot.StreamSymbols) == 0 {
		return true
	}
	for _, item := range snapshot.Symbols {
		if strings.EqualFold(item.Name, symbol) {
			return true
		}
	}
	for _, item := range snapshot.StreamSymbols {
		if strings.EqualFold(item, symbol) {
			return true
		}
	}
	return false
}
