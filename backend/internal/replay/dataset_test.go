package replay

import (
	"testing"
	"time"

	"github.com/smc-trading-terminal/backend/internal/mt5stream"
)

func TestNormalizeCandlesSortsAndDeduplicatesDeterministically(t *testing.T) {
	candles := []mt5stream.Candle{
		{Time: 120, Open: 2, High: 3, Low: 1, Close: 2.5, Volume: 8},
		{Time: 60, Open: 1, High: 2, Low: .5, Close: 1.5, Volume: 4},
		{Time: 120, Open: 2, High: 4, Low: 1, Close: 3, Volume: 9},
	}
	bars, err := normalizeCandles(candles)
	if err != nil {
		t.Fatal(err)
	}
	if len(bars) != 2 || bars[0].Time.Unix() != 60 || bars[1].High != 4 {
		t.Fatalf("unexpected normalized bars: %#v", bars)
	}
	checksum := datasetChecksum("mt5", "EURUSD", "1m", 60, bars)
	if len(checksum) != 64 {
		t.Fatalf("checksum length = %d", len(checksum))
	}
	barsAgain, _ := normalizeCandles(candles)
	if checksum != datasetChecksum("mt5", "EURUSD", "1m", 60, barsAgain) {
		t.Fatal("checksum is not deterministic")
	}
}

func TestNormalizeCandlesRejectsInvalidOHLC(t *testing.T) {
	_, err := normalizeCandles([]mt5stream.Candle{{Time: 60, Open: 2, High: 1, Low: .5, Close: 1.5}})
	if err == nil {
		t.Fatal("expected invalid OHLC error")
	}
}

func TestBarAtOrBeforeNeverSelectsAFutureBar(t *testing.T) {
	bars := []Bar{{Time: time.Unix(60, 0)}, {Time: time.Unix(120, 0)}}
	seq, selected, ok := barAtOrBefore(bars, time.Unix(119, 0))
	if !ok || seq != 0 || selected.Unix() != 60 {
		t.Fatalf("got seq=%d time=%v ok=%v", seq, selected, ok)
	}
}

func TestBarAtOrBeforeRejectsTimeBeforeDataset(t *testing.T) {
	bars := []Bar{{Time: time.Unix(60, 0)}}
	if _, _, ok := barAtOrBefore(bars, time.Unix(59, 0)); ok {
		t.Fatal("expected a time before the dataset to be unavailable")
	}
}
