package replay

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

const aggregateStateVersion = 1

// ReplayBar is a chart candle built only from source rows already revealed by
// the session cursor. It is safe to send to the browser.
type ReplayBar struct {
	Time     time.Time `json:"time"`
	Open     float64   `json:"open"`
	High     float64   `json:"high"`
	Low      float64   `json:"low"`
	Close    float64   `json:"close"`
	Volume   float64   `json:"volume"`
	Complete bool      `json:"complete"`
}

type sourceBar struct {
	Seq             int64
	Time            time.Time
	IntervalSeconds int
	Open            float64
	High            float64
	Low             float64
	Close           float64
	Volume          float64
}

type aggregateState struct {
	Version       int        `json:"version"`
	LastSourceSeq int64      `json:"lastSourceSeq"`
	Current       *ReplayBar `json:"current,omitempty"`
}

func newAggregateState() aggregateState {
	return aggregateState{Version: aggregateStateVersion, LastSourceSeq: -1}
}

func parseAggregateState(raw []byte) (aggregateState, error) {
	if len(raw) == 0 || string(raw) == "{}" {
		return newAggregateState(), nil
	}
	var state aggregateState
	if err := json.Unmarshal(raw, &state); err != nil {
		return aggregateState{}, fmt.Errorf("replay: decode aggregate state: %w", err)
	}
	if state.Version != aggregateStateVersion {
		return aggregateState{}, fmt.Errorf("replay: unsupported aggregate state version %d", state.Version)
	}
	return state, nil
}

func marshalAggregateState(state aggregateState) []byte {
	payload, _ := json.Marshal(state)
	return payload
}

// aggregateSourceBars advances an existing aggregate and returns every upsert
// in source order. A bucket may be emitted once more with complete=true when a
// later source row proves that the bucket has closed.
func aggregateSourceBars(state aggregateState, chartTimeframe string, rows []sourceBar) (aggregateState, []ReplayBar, error) {
	upserts := make([]ReplayBar, 0, len(rows)+1)
	for _, row := range rows {
		if row.Seq <= state.LastSourceSeq {
			return aggregateState{}, nil, fmt.Errorf("replay: source sequence %d is not after %d", row.Seq, state.LastSourceSeq)
		}
		bucketStart, bucketEnd, err := replayBucket(row.Time, chartTimeframe)
		if err != nil {
			return aggregateState{}, nil, err
		}
		if state.Current == nil || !state.Current.Time.Equal(bucketStart) {
			if state.Current != nil && !state.Current.Complete {
				completed := *state.Current
				completed.Complete = true
				state.Current = &completed
				upserts = append(upserts, completed)
			}
			state.Current = &ReplayBar{
				Time: bucketStart, Open: row.Open, High: row.High, Low: row.Low,
				Close: row.Close, Volume: row.Volume,
			}
		} else {
			current := *state.Current
			if row.High > current.High {
				current.High = row.High
			}
			if row.Low < current.Low {
				current.Low = row.Low
			}
			current.Close = row.Close
			current.Volume += row.Volume
			state.Current = &current
		}
		if !row.Time.Add(time.Duration(row.IntervalSeconds) * time.Second).Before(bucketEnd) {
			current := *state.Current
			current.Complete = true
			state.Current = &current
		}
		state.LastSourceSeq = row.Seq
		upserts = append(upserts, *state.Current)
	}
	return state, upserts, nil
}

func aggregateRevealedBars(chartTimeframe string, rows []sourceBar) ([]ReplayBar, aggregateState, error) {
	state, upserts, err := aggregateSourceBars(newAggregateState(), chartTimeframe, rows)
	if err != nil {
		return nil, aggregateState{}, err
	}
	latest := make(map[int64]ReplayBar, len(upserts))
	for _, bar := range upserts {
		latest[bar.Time.Unix()] = bar
	}
	bars := make([]ReplayBar, 0, len(latest))
	for _, bar := range latest {
		bars = append(bars, bar)
	}
	sort.Slice(bars, func(i, j int) bool { return bars[i].Time.Before(bars[j].Time) })
	return bars, state, nil
}

// coalesceBarUpserts keeps the final state of each chart bucket touched by one
// atomic command. Every source row is still processed in order; only redundant
// UI repaint events are removed.
func coalesceBarUpserts(upserts []ReplayBar) []ReplayBar {
	latest := make(map[int64]ReplayBar, len(upserts))
	for _, bar := range upserts {
		latest[bar.Time.Unix()] = bar
	}
	out := make([]ReplayBar, 0, len(latest))
	for _, bar := range latest {
		out = append(out, bar)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time.Before(out[j].Time) })
	return out
}

// replayBucket uses UTC as the MT5 calendar boundary for Phase 3. Intraday
// buckets are fixed-width; day/week/month use calendar boundaries.
func replayBucket(value time.Time, timeframe string) (time.Time, time.Time, error) {
	value = value.UTC()
	normalized, seconds, ok := normalizeTimeframe(timeframe)
	if !ok {
		return time.Time{}, time.Time{}, fmt.Errorf("%w: unsupported chart timeframe %q", ErrBadRequest, timeframe)
	}
	switch normalized {
	case "1D":
		start := time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
		return start, start.AddDate(0, 0, 1), nil
	case "1W":
		day := time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
		daysFromMonday := (int(day.Weekday()) + 6) % 7
		start := day.AddDate(0, 0, -daysFromMonday)
		return start, start.AddDate(0, 0, 7), nil
	case "1M":
		start := time.Date(value.Year(), value.Month(), 1, 0, 0, 0, 0, time.UTC)
		return start, start.AddDate(0, 1, 0), nil
	default:
		unix := value.Unix()
		start := time.Unix(unix-(unix%int64(seconds)), 0).UTC()
		return start, start.Add(time.Duration(seconds) * time.Second), nil
	}
}
