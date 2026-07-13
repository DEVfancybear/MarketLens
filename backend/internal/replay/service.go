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
	store     SessionStore
	history   HistorySource
	maxBars   int
	maxTracks int
}

type normalizedTrackInput struct {
	input           TrackInput
	chartSeconds    int
	sourceTimeframe string
	sourceSeconds   int
}

const (
	replayHistoryGapProbe    = 48 * time.Hour
	replayHistoryMaxAttempts = 3
	replayHistoryFutureShare = 0.30
)

func NewService(store SessionStore, history HistorySource, maxBars int, configuredMaxTracks ...int) *Service {
	if maxBars <= 0 || maxBars > 5000 {
		maxBars = 5000
	}
	maxTracks := 4
	if len(configuredMaxTracks) > 0 && configuredMaxTracks[0] > 0 && configuredMaxTracks[0] <= 4 {
		maxTracks = configuredMaxTracks[0]
	}
	return &Service{store: store, history: history, maxBars: maxBars, maxTracks: maxTracks}
}

func (s *Service) Create(ctx context.Context, userID string, input CreateSessionInput) (SessionSnapshot, error) {
	if input.Mode == "" {
		input.Mode = "single_chart"
	}
	if input.Mode != "single_chart" && input.Mode != "all_charts" {
		return SessionSnapshot{}, fmt.Errorf("%w: mode must be single_chart or all_charts", ErrBadRequest)
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
	trackCount := len(input.Tracks)
	if trackCount < 1 || trackCount > s.maxTracks {
		return SessionSnapshot{}, fmt.Errorf("%w: tracks must contain between 1 and %d entries", ErrBadRequest, s.maxTracks)
	}
	if input.Mode == "single_chart" && trackCount != 1 {
		return SessionSnapshot{}, fmt.Errorf("%w: single_chart mode requires exactly one track", ErrBadRequest)
	}
	if input.Mode == "all_charts" && trackCount < 2 {
		return SessionSnapshot{}, fmt.Errorf("%w: all_charts mode requires at least two tracks", ErrBadRequest)
	}
	if input.EndTime != nil && input.EndTime.Before(input.Start.Time) {
		return SessionSnapshot{}, fmt.Errorf("%w: endTime precedes start time", ErrBadRequest)
	}

	normalized := make([]normalizedTrackInput, 0, trackCount)
	catalog := s.history.Snapshot()
	for i, raw := range input.Tracks {
		if raw.Slot != i {
			return SessionSnapshot{}, fmt.Errorf("%w: track slots must be unique and contiguous from 0", ErrBadRequest)
		}
		raw.Symbol = strings.ToUpper(strings.TrimSpace(raw.Symbol))
		tf, chartSeconds, ok := normalizeTimeframe(raw.ChartTimeframe)
		if raw.Symbol == "" || !ok {
			return SessionSnapshot{}, fmt.Errorf("%w: valid symbol and chartTimeframe are required for slot %d", ErrBadRequest, raw.Slot)
		}
		if !catalogHasSymbol(catalog, raw.Symbol) {
			return SessionSnapshot{}, fmt.Errorf("%w: unsupported symbol %s", ErrBadRequest, raw.Symbol)
		}
		raw.ChartTimeframe = tf
		sourceTimeframe, sourceSeconds := phase3SourceTimeframe(tf)
		normalized = append(normalized, normalizedTrackInput{input: raw, chartSeconds: chartSeconds, sourceTimeframe: sourceTimeframe, sourceSeconds: sourceSeconds})
	}
	replayInterval, err := resolveReplayIntervalForTracks(input.ReplayInterval, normalized)
	if err != nil {
		return SessionSnapshot{}, err
	}

	preparedTracks := make([]PreparedTrack, 0, trackCount)
	sharedStart := input.Start.Time.UTC()
	calendars := make([]map[string]any, 0, trackCount)
	for i, track := range normalized {
		selectionTime := sharedStart
		if i == 0 {
			selectionTime = input.Start.Time.UTC()
		}
		history, bars, normalizeErr := s.replayHistoryWindow(
			ctx,
			track.input.Symbol,
			track.sourceTimeframe,
			track.sourceSeconds,
			replayInterval,
			selectionTime,
		)
		if normalizeErr != nil {
			return SessionSnapshot{}, normalizeErr
		}
		if len(bars) == 0 {
			if history.LastError != "" {
				return SessionSnapshot{}, fmt.Errorf("%w: slot %d: %s", ErrDatasetPreparation, track.input.Slot, history.LastError)
			}
			return SessionSnapshot{}, fmt.Errorf("%w: no candles returned for slot %d", ErrDataUnavailable, track.input.Slot)
		}
		availableEnd := bars[len(bars)-1].Time.Add(time.Duration(track.sourceSeconds) * time.Second)
		if selectionTime.Before(bars[0].Time) || !selectionTime.Before(availableEnd) {
			return SessionSnapshot{}, &DataUnavailableError{FirstAvailable: bars[0].Time, LastAvailable: availableEnd}
		}
		if input.EndTime != nil && input.EndTime.After(availableEnd) {
			return SessionSnapshot{}, &DataUnavailableError{FirstAvailable: bars[0].Time, LastAvailable: availableEnd}
		}
		cursor, selected, found := barAtOrBefore(bars, selectionTime)
		if !found {
			return SessionSnapshot{}, &DataUnavailableError{FirstAvailable: bars[0].Time, LastAvailable: availableEnd}
		}
		if i == 0 {
			sharedStart = selected
		}
		calendar := marketCalendarFor("mt5", track.input.Symbol)
		meta, _ := json.Marshal(map[string]any{"source": history.Source, "lastError": history.LastError, "marketCalendar": calendar})
		initialRows := make([]sourceBar, cursor+1)
		for rowIndex := range initialRows {
			bar := bars[rowIndex]
			initialRows[rowIndex] = sourceBar{Seq: int64(rowIndex), Time: bar.Time, IntervalSeconds: track.sourceSeconds,
				Open: bar.Open, High: bar.High, Low: bar.Low, Close: bar.Close, Volume: bar.Volume}
		}
		_, initialAggregate, aggregateErr := aggregateRevealedBars(track.input.ChartTimeframe, initialRows)
		if aggregateErr != nil {
			return SessionSnapshot{}, aggregateErr
		}
		prepared := PreparedTrack{
			Slot: track.input.Slot, Symbol: track.input.Symbol, Provider: "mt5", MarketCalendar: calendar,
			ChartTimeframe: track.input.ChartTimeframe, SourceTimeframe: track.sourceTimeframe, IntervalSeconds: track.sourceSeconds,
			RequestedStart: selectionTime, CursorSeq: cursor, VisibleThrough: selected,
			Checksum:   datasetChecksum("mt5", track.input.Symbol, track.sourceTimeframe, track.sourceSeconds, bars),
			SnapshotAt: history.UpdatedAt.UTC(), SourceMeta: meta, AggregateState: marshalAggregateState(initialAggregate), Bars: bars,
		}
		if prepared.SnapshotAt.IsZero() {
			prepared.SnapshotAt = time.Now().UTC()
		}
		preparedTracks = append(preparedTracks, prepared)
		calendars = append(calendars, map[string]any{"slot": track.input.Slot, "calendar": calendar})
	}
	preparedTrading, err := validateTradingInput(input.Trading)
	if err != nil {
		return SessionSnapshot{}, err
	}
	config, _ := json.Marshal(map[string]any{
		"phase": 5, "requestedStartTime": input.Start.Time.UTC(), "marketCalendars": calendars,
		"barPathModel": "conservative_ohlc", "tradingEnabled": preparedTrading != nil,
	})
	return s.store.Prepare(ctx, userID, PreparedSession{
		Mode: input.Mode, Speed: input.Speed, ReplayIntervalSeconds: replayInterval,
		StartTime: sharedStart, EndTime: input.EndTime, Config: config, Tracks: preparedTracks, Trading: preparedTrading,
	})
}

// replayHistoryWindow keeps the original 70/30 history/future split for normal
// sessions, but probes farther forward when a sparse market calendar leaves the
// selected row at the end of the first page. This is data-driven rather than a
// hard-coded Forex weekend rule, so holidays, broker sessions, and 24/7 symbols
// retain their own provider calendar.
func (s *Service) replayHistoryWindow(
	ctx context.Context,
	symbol string,
	sourceTimeframe string,
	sourceSeconds int,
	replayInterval int,
	selectionTime time.Time,
) (mt5stream.HistorySnapshot, []Bar, error) {
	lookaheadSeconds := max(int64(float64(s.maxBars*sourceSeconds)*replayHistoryFutureShare), int64(sourceSeconds))
	before := selectionTime.UTC().Unix() + lookaheadSeconds
	minimumFutureRows := max(1, (replayInterval+sourceSeconds-1)/sourceSeconds)
	latestUsefulBefore := time.Now().UTC().Add(time.Duration(sourceSeconds) * time.Second).Unix()

	var history mt5stream.HistorySnapshot
	var bars []Bar
	for attempt := 0; attempt < replayHistoryMaxAttempts; attempt++ {
		history = s.history.History(ctx, symbol, sourceTimeframe, s.maxBars, before, false)
		var err error
		bars, err = normalizeCandles(history.Candles)
		if err != nil || len(bars) == 0 {
			return history, bars, err
		}

		cursor, _, found := barAtOrBefore(bars, selectionTime)
		if !found || selectionTime.Before(bars[0].Time) {
			break
		}
		// A row count alone cannot prove that the requested future window is
		// covered. For example, a Friday 23:30 selection can still have one full
		// 15m interval of M1 rows before the close while the page ends inside the
		// weekend. Keep probing until the returned tail reaches the requested
		// boundary. coverageEnd already includes the selected source candle's
		// duration, so adding another interval here would hide daily/weekend gaps.
		coverageTarget := time.Unix(min(before, latestUsefulBefore), 0).UTC()
		coverageEnd := bars[len(bars)-1].Time.Add(time.Duration(sourceSeconds) * time.Second)
		coversRequestedBoundary := !coverageEnd.Before(coverageTarget)
		if len(bars)-int(cursor)-1 >= minimumFutureRows && coversRequestedBoundary {
			break
		}
		if attempt+1 >= replayHistoryMaxAttempts || before >= latestUsefulBefore {
			break
		}

		probeSeconds := int64(replayHistoryGapProbe/time.Second) << attempt
		nextBefore := min(before+probeSeconds, latestUsefulBefore)
		if nextBefore <= before {
			break
		}
		before = nextBefore
	}

	// Never persist a session whose selected row is already the dataset tail.
	// The extra probe rows above are a buffer for normal interval playback, but
	// one real future source row is the hard invariant needed to keep Play/Next
	// usable across sparse calendars (weekends, holidays, and broker closures).
	if cursor, _, found := barAtOrBefore(bars, selectionTime); found && cursor >= int64(len(bars)-1) {
		if history.LastError != "" {
			return history, bars, fmt.Errorf("%w: %s", ErrDatasetPreparation, history.LastError)
		}
		return history, bars, &DataUnavailableError{
			FirstAvailable: bars[0].Time,
			LastAvailable:  bars[len(bars)-1].Time.Add(time.Duration(sourceSeconds) * time.Second),
		}
	}
	return history, bars, nil
}

func resolveReplayIntervalForTracks(requested string, tracks []normalizedTrackInput) (int, error) {
	requested = strings.TrimSpace(requested)
	if requested != "" && !strings.EqualFold(requested, "auto") {
		var resolved int
		for _, track := range tracks {
			interval, err := resolveReplayInterval(requested, track.input.ChartTimeframe, track.chartSeconds, track.sourceSeconds)
			if err != nil {
				return 0, err
			}
			if resolved != 0 && resolved != interval {
				return 0, fmt.Errorf("%w: %q does not resolve consistently across tracks", ErrUnsupportedReplayInterval, requested)
			}
			resolved = interval
		}
		return resolved, nil
	}

	// Match TradingView's Auto policy: one chart uses its chart interval, while
	// synchronized layouts use the largest interval shared by every track.
	// Calendar months intentionally synchronize at one day.
	candidates := []int{86400, 14400, 7200, 3600, 1800, 900, 300, 180, 60}
	for _, candidate := range candidates {
		valid := true
		for _, track := range tracks {
			if candidate < track.sourceSeconds || (track.input.ChartTimeframe == "1M" && candidate != 86400) ||
				(track.input.ChartTimeframe != "1M" && track.chartSeconds%candidate != 0) {
				valid = false
				break
			}
		}
		if valid {
			return candidate, nil
		}
	}
	return 0, fmt.Errorf("%w: tracks do not share a replay interval", ErrUnsupportedReplayInterval)
}

func marketCalendarFor(provider, symbol string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "mt5" {
		return "mt5:" + strings.ToUpper(strings.TrimSpace(symbol)) + ":UTC"
	}
	return provider + ":UTC"
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
