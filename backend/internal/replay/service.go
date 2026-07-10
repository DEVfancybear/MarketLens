package replay

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
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
	Bars(context.Context, string, string, string, string) (RevealedBarsSnapshot, error)
	Close(context.Context, string, string) (SessionSnapshot, error)
	Report(context.Context, string, string) (ReplayReport, error)
	Fork(context.Context, string, string, time.Time) (SessionSnapshot, error)
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
		return SessionSnapshot{}, fmt.Errorf("%w: Phase 3 supports single_chart mode only", ErrBadRequest)
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
	if input.Speed == 0 {
		input.Speed = 1
	}
	if !finite(input.Speed) || input.Speed <= 0 || input.Speed > 100 {
		return SessionSnapshot{}, fmt.Errorf("%w: speed must be between 0 and 100", ErrBadRequest)
	}
	if len(input.Tracks) != 1 || input.Tracks[0].Slot != 0 {
		return SessionSnapshot{}, fmt.Errorf("%w: Phase 3 requires exactly one track in slot 0", ErrBadRequest)
	}
	track := input.Tracks[0]
	track.Symbol = strings.ToUpper(strings.TrimSpace(track.Symbol))
	tf, chartInterval, ok := normalizeTimeframe(track.ChartTimeframe)
	if track.Symbol == "" || !ok {
		return SessionSnapshot{}, fmt.Errorf("%w: valid symbol and chartTimeframe are required", ErrBadRequest)
	}
	if !catalogHasSymbol(s.history.Snapshot(), track.Symbol) {
		return SessionSnapshot{}, fmt.Errorf("%w: unsupported symbol %s", ErrBadRequest, track.Symbol)
	}
	if input.EndTime != nil && input.EndTime.Before(input.Start.Time) {
		return SessionSnapshot{}, fmt.Errorf("%w: endTime precedes start time", ErrBadRequest)
	}
	sourceTimeframe, sourceInterval := phase3SourceTimeframe(tf)
	replayInterval, err := resolveReplayInterval(input.ReplayInterval, tf, chartInterval, sourceInterval)
	if err != nil {
		return SessionSnapshot{}, err
	}

	// Put the requested point around 70%% through the immutable window, leaving
	// both historical context and future rows without exposing them to the client.
	before := input.Start.Time.Unix() + int64(float64(s.maxBars*sourceInterval)*0.30)
	history := s.history.History(ctx, track.Symbol, sourceTimeframe, s.maxBars, before, false)
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
	availableEnd := bars[len(bars)-1].Time.Add(time.Duration(sourceInterval) * time.Second)
	if input.Start.Time.Before(bars[0].Time) || !input.Start.Time.Before(availableEnd) {
		return SessionSnapshot{}, &DataUnavailableError{FirstAvailable: bars[0].Time, LastAvailable: availableEnd}
	}
	if input.EndTime != nil && input.EndTime.After(availableEnd) {
		return SessionSnapshot{}, &DataUnavailableError{FirstAvailable: bars[0].Time, LastAvailable: availableEnd}
	}
	cursor, selected, ok := barAtOrBefore(bars, input.Start.Time.UTC())
	if !ok {
		return SessionSnapshot{}, &DataUnavailableError{FirstAvailable: bars[0].Time, LastAvailable: availableEnd}
	}
	meta, _ := json.Marshal(map[string]any{"source": history.Source, "lastError": history.LastError})
	initialRows := make([]sourceBar, cursor+1)
	for i := range initialRows {
		bar := bars[i]
		initialRows[i] = sourceBar{Seq: int64(i), Time: bar.Time, IntervalSeconds: sourceInterval,
			Open: bar.Open, High: bar.High, Low: bar.Low, Close: bar.Close, Volume: bar.Volume}
	}
	_, initialAggregate, err := aggregateRevealedBars(tf, initialRows)
	if err != nil {
		return SessionSnapshot{}, err
	}
	preparedTrack := PreparedTrack{
		Slot: 0, Symbol: track.Symbol, Provider: "mt5", ChartTimeframe: tf,
		SourceTimeframe: sourceTimeframe, IntervalSeconds: sourceInterval, RequestedStart: input.Start.Time.UTC(), CursorSeq: cursor,
		VisibleThrough: selected, Checksum: datasetChecksum("mt5", track.Symbol, sourceTimeframe, sourceInterval, bars),
		SnapshotAt: history.UpdatedAt.UTC(), SourceMeta: meta, AggregateState: marshalAggregateState(initialAggregate), Bars: bars,
	}
	if preparedTrack.SnapshotAt.IsZero() {
		preparedTrack.SnapshotAt = time.Now().UTC()
	}
	preparedTrading, err := validateTradingInput(input.Trading)
	if err != nil {
		return SessionSnapshot{}, err
	}
	config, _ := json.Marshal(map[string]any{
		"phase": 4, "requestedStartTime": input.Start.Time.UTC(), "calendar": "UTC",
		"barPathModel": "conservative_ohlc", "tradingEnabled": preparedTrading != nil,
	})
	return s.store.Prepare(ctx, userID, PreparedSession{
		Mode: input.Mode, Speed: input.Speed, ReplayIntervalSeconds: replayInterval,
		StartTime: selected, EndTime: input.EndTime, Config: config, Tracks: []PreparedTrack{preparedTrack}, Trading: preparedTrading,
	})
}

func validateTradingInput(input *TradingInput) (*PreparedTrading, error) {
	if input == nil || !input.Enabled {
		return nil, nil
	}
	equity := 10000.0
	if strings.TrimSpace(input.StartingEquity) != "" {
		var err error
		equity, err = strconv.ParseFloat(input.StartingEquity, 64)
		if err != nil || !finite(equity) || equity <= 0 || equity > 1e12 {
			return nil, fmt.Errorf("%w: trading.startingEquity must be between 0 and 1000000000000", ErrBadRequest)
		}
	}
	currency := strings.ToUpper(strings.TrimSpace(input.BaseCurrency))
	if currency == "" {
		currency = "USD"
	}
	if len(currency) != 3 {
		return nil, fmt.Errorf("%w: trading.baseCurrency must be a three-letter currency", ErrBadRequest)
	}
	path := strings.TrimSpace(input.BarPathModel)
	if path != "" && path != "conservative_ohlc" {
		return nil, fmt.Errorf("%w: unsupported trading.barPathModel", ErrBadRequest)
	}
	commission := normalizedPayload(input.Commission)
	var model map[string]any
	if err := json.Unmarshal(commission, &model); err != nil {
		return nil, fmt.Errorf("%w: invalid trading.commission", ErrBadRequest)
	}
	if len(model) > 0 {
		kind, _ := model["kind"].(string)
		valueText, _ := model["value"].(string)
		value, valueErr := strconv.ParseFloat(valueText, 64)
		if kind != "per_unit" || valueErr != nil || !finite(value) || value < 0 {
			return nil, fmt.Errorf("%w: trading.commission must be a non-negative per_unit model", ErrBadRequest)
		}
	}
	return &PreparedTrading{StartingEquity: equity, BaseCurrency: currency, Commission: commission}, nil
}

func (s *Service) Get(ctx context.Context, userID, sessionID string) (SessionSnapshot, error) {
	return s.store.Get(ctx, userID, sessionID)
}
func (s *Service) Bars(ctx context.Context, userID, sessionID, trackID, timeframe string) (RevealedBarsSnapshot, error) {
	return s.store.Bars(ctx, userID, sessionID, trackID, timeframe)
}
func (s *Service) Close(ctx context.Context, userID, sessionID string) (SessionSnapshot, error) {
	return s.store.Close(ctx, userID, sessionID)
}
func (s *Service) Report(ctx context.Context, userID, sessionID string) (ReplayReport, error) {
	return s.store.Report(ctx, userID, sessionID)
}
func (s *Service) Fork(ctx context.Context, userID, sessionID string, target time.Time) (SessionSnapshot, error) {
	if target.IsZero() {
		return SessionSnapshot{}, fmt.Errorf("%w: fork time is required", ErrBadRequest)
	}
	return s.store.Fork(ctx, userID, sessionID, target.UTC())
}

func phase3SourceTimeframe(chartTimeframe string) (string, int) {
	_, seconds, _ := normalizeTimeframe(chartTimeframe)
	if seconds >= 86400 {
		return "1D", 86400
	}
	return "1m", 60
}

func resolveReplayInterval(requested, chartTimeframe string, chartSeconds, sourceSeconds int) (int, error) {
	requested = strings.TrimSpace(requested)
	if requested == "" || strings.EqualFold(requested, "auto") {
		if chartTimeframe == "1W" || chartTimeframe == "1M" {
			return 86400, nil
		}
		return chartSeconds, nil
	}
	_, interval, ok := normalizeTimeframe(requested)
	if !ok || interval < sourceSeconds || (chartTimeframe != "1M" && chartSeconds%interval != 0) {
		return 0, fmt.Errorf("%w: %q cannot build %s from %ds source rows", ErrUnsupportedReplayInterval, requested, chartTimeframe, sourceSeconds)
	}
	if chartTimeframe == "1M" && interval != 86400 {
		return 0, fmt.Errorf("%w: monthly charts currently require 1D", ErrUnsupportedReplayInterval)
	}
	return interval, nil
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
