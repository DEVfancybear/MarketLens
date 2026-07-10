package replaycontract

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

type fixtureBar struct {
	Symbol string  `json:"symbol"`
	Seq    int64   `json:"seq"`
	Time   int64   `json:"time"`
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume float64 `json:"volume"`
}

type expectedPartialBar struct {
	Time     int64   `json:"time"`
	Open     float64 `json:"open"`
	High     float64 `json:"high"`
	Low      float64 `json:"low"`
	Close    float64 `json:"close"`
	Volume   float64 `json:"volume"`
	Complete bool    `json:"complete"`
}

type fixtureOrder struct {
	ClientOrderID string  `json:"clientOrderId"`
	Symbol        string  `json:"symbol"`
	Side          string  `json:"side"`
	Type          string  `json:"type"`
	Entry         float64 `json:"entry"`
}

type replayFixtures struct {
	SchemaVersion  int    `json:"schemaVersion"`
	TimeUnit       string `json:"timeUnit"`
	SelectionCases []struct {
		Name                    string  `json:"name"`
		Candles                 []int64 `json:"candles"`
		RequestedTime           int64   `json:"requestedTime"`
		ExpectedNearestIndex    int     `json:"expectedNearestIndex"`
		ExpectedAtOrBeforeIndex int     `json:"expectedAtOrBeforeIndex"`
	} `json:"selectionCases"`
	KnownGaps struct {
		PartialMTF struct {
			Symbol               string             `json:"symbol"`
			ChartIntervalSeconds int64              `json:"chartIntervalSeconds"`
			RevealedThrough      int64              `json:"revealedThrough"`
			SourceFinalBar       fixtureBar         `json:"sourceFinalBar"`
			RevealedBaseBars     []fixtureBar       `json:"revealedBaseBars"`
			ExpectedPartialBar   expectedPartialBar `json:"expectedPartialBar"`
		} `json:"partialMtf"`
		SkippedTradeFill struct {
			Symbol       string       `json:"symbol"`
			Order        fixtureOrder `json:"order"`
			RevealedBars []fixtureBar `json:"revealedBars"`
			ExpectedFill struct {
				Seq   int64   `json:"seq"`
				Price float64 `json:"price"`
			} `json:"expectedFill"`
		} `json:"skippedTradeFill"`
		RewindWithOpenPosition struct {
			LastProcessedSeq int64  `json:"lastProcessedSeq"`
			RequestedSeq     int64  `json:"requestedSeq"`
			HasTrades        bool   `json:"hasTrades"`
			ExpectedError    string `json:"expectedError"`
		} `json:"rewindWithOpenPosition"`
		CrossSymbolFill struct {
			MarketSymbol                    string         `json:"marketSymbol"`
			Orders                          []fixtureOrder `json:"orders"`
			Bar                             fixtureBar     `json:"bar"`
			ExpectedTriggeredClientOrderIDs []string       `json:"expectedTriggeredClientOrderIds"`
		} `json:"crossSymbolFill"`
		HiddenTabResume struct {
			PlayingBeforeDisconnect bool    `json:"playingBeforeDisconnect"`
			ElapsedWallTimeMS       int64   `json:"elapsedWallTimeMs"`
			Speed                   float64 `json:"speed"`
			ExpectedStatus          string  `json:"expectedStatus"`
			ExpectedSteps           int     `json:"expectedSteps"`
			ExpectedPauseReason     string  `json:"expectedPauseReason"`
		} `json:"hiddenTabResume"`
		UnavailableTimeframe struct {
			SavedTime      int64   `json:"savedTime"`
			CurrentCursor  int     `json:"currentCursor"`
			NewCandleTimes []int64 `json:"newCandleTimes"`
			ExpectedError  string  `json:"expectedError"`
			ExpectedCursor int     `json:"expectedCursor"`
		} `json:"unavailableTimeframe"`
	} `json:"knownGaps"`
}

func loadFixtures(t *testing.T) replayFixtures {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve fixture test path")
	}
	path := filepath.Clean(filepath.Join(
		filepath.Dir(file), "..", "..", "..", "testdata", "replay", "contracts.v1.json",
	))
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open replay contract fixture: %v", err)
	}
	defer f.Close()

	var fixtures replayFixtures
	decoder := json.NewDecoder(f)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fixtures); err != nil {
		t.Fatalf("decode replay contract fixture: %v", err)
	}
	return fixtures
}

func atOrBefore(times []int64, target int64) int {
	lo, hi, answer := 0, len(times)-1, -1
	for lo <= hi {
		mid := (lo + hi) / 2
		if times[mid] <= target {
			answer = mid
			lo = mid + 1
		} else {
			hi = mid - 1
		}
	}
	return answer
}

func nearest(times []int64, target int64) int {
	if len(times) == 0 {
		return -1
	}
	before := atOrBefore(times, target)
	if before < 0 {
		return 0
	}
	if before >= len(times)-1 {
		return len(times) - 1
	}
	after := before + 1
	if target-times[before] <= times[after]-target {
		return before
	}
	return after
}

func aggregate(bars []fixtureBar) expectedPartialBar {
	result := expectedPartialBar{
		Time: bars[0].Time, Open: bars[0].Open, High: bars[0].High,
		Low: bars[0].Low, Close: bars[0].Close, Complete: false,
	}
	for _, bar := range bars {
		if bar.High > result.High {
			result.High = bar.High
		}
		if bar.Low < result.Low {
			result.Low = bar.Low
		}
		result.Close = bar.Close
		result.Volume += bar.Volume
	}
	return result
}

func orderTriggered(order fixtureOrder, bar fixtureBar) bool {
	switch {
	case order.Type == "stop" && order.Side == "long":
		return bar.High >= order.Entry
	case order.Type == "stop" && order.Side == "short":
		return bar.Low <= order.Entry
	case order.Type == "limit" && order.Side == "long":
		return bar.Low <= order.Entry
	case order.Type == "limit" && order.Side == "short":
		return bar.High >= order.Entry
	default:
		return false
	}
}

func TestSharedReplaySelectionContracts(t *testing.T) {
	fixtures := loadFixtures(t)
	if fixtures.SchemaVersion != 1 || fixtures.TimeUnit != "unix_seconds" {
		t.Fatalf("unexpected fixture contract version: %d %q", fixtures.SchemaVersion, fixtures.TimeUnit)
	}
	for _, tc := range fixtures.SelectionCases {
		t.Run(tc.Name, func(t *testing.T) {
			if got := nearest(tc.Candles, tc.RequestedTime); got != tc.ExpectedNearestIndex {
				t.Fatalf("nearest index = %d, want %d", got, tc.ExpectedNearestIndex)
			}
			if got := atOrBefore(tc.Candles, tc.RequestedTime); got != tc.ExpectedAtOrBeforeIndex {
				t.Fatalf("at-or-before index = %d, want %d", got, tc.ExpectedAtOrBeforeIndex)
			}
		})
	}
}

func TestSharedReplayKnownGapTargets(t *testing.T) {
	fixtures := loadFixtures(t)

	t.Run("partial MTF uses revealed base bars", func(t *testing.T) {
		fixture := fixtures.KnownGaps.PartialMTF
		if got := aggregate(fixture.RevealedBaseBars); !reflect.DeepEqual(got, fixture.ExpectedPartialBar) {
			t.Fatalf("partial aggregate = %+v, want %+v", got, fixture.ExpectedPartialBar)
		}
	})

	t.Run("every revealed bar is scanned for fills", func(t *testing.T) {
		fixture := fixtures.KnownGaps.SkippedTradeFill
		var fillSeq int64 = -1
		for _, bar := range fixture.RevealedBars {
			if orderTriggered(fixture.Order, bar) {
				fillSeq = bar.Seq
				break
			}
		}
		if fillSeq != fixture.ExpectedFill.Seq {
			t.Fatalf("fill sequence = %d, want %d", fillSeq, fixture.ExpectedFill.Seq)
		}
	})

	t.Run("rewind with trades requires fork", func(t *testing.T) {
		fixture := fixtures.KnownGaps.RewindWithOpenPosition
		got := ""
		if fixture.HasTrades && fixture.RequestedSeq < fixture.LastProcessedSeq {
			got = "rewind_requires_fork"
		}
		if got != fixture.ExpectedError {
			t.Fatalf("rewind result = %q, want %q", got, fixture.ExpectedError)
		}
	})

	t.Run("orders are scoped to market symbol", func(t *testing.T) {
		fixture := fixtures.KnownGaps.CrossSymbolFill
		triggered := make([]string, 0)
		for _, order := range fixture.Orders {
			if order.Symbol == fixture.MarketSymbol && orderTriggered(order, fixture.Bar) {
				triggered = append(triggered, order.ClientOrderID)
			}
		}
		if !reflect.DeepEqual(triggered, fixture.ExpectedTriggeredClientOrderIDs) {
			t.Fatalf("triggered orders = %v, want %v", triggered, fixture.ExpectedTriggeredClientOrderIDs)
		}
	})

	t.Run("disconnect resumes paused without wall-time catch-up", func(t *testing.T) {
		fixture := fixtures.KnownGaps.HiddenTabResume
		if fixture.ExpectedStatus != "paused" || fixture.ExpectedSteps != 0 || fixture.ExpectedPauseReason != "no_subscribers" {
			t.Fatalf("invalid disconnect target: %+v", fixture)
		}
	})

	t.Run("unavailable timeframe preserves cursor and returns error", func(t *testing.T) {
		fixture := fixtures.KnownGaps.UnavailableTimeframe
		if got := atOrBefore(fixture.NewCandleTimes, fixture.SavedTime); got != -1 {
			t.Fatalf("mapping unexpectedly available at index %d", got)
		}
		if fixture.ExpectedError != "data_point_unavailable" || fixture.ExpectedCursor != fixture.CurrentCursor {
			t.Fatalf("invalid unavailable mapping target: %+v", fixture)
		}
	})
}
