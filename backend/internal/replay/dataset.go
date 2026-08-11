package replay

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/marketlens/backend/internal/mt5stream"
)

var timeframeSeconds = map[string]int{
	"1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
	"1H": 3600, "2H": 7200, "4H": 14400, "1D": 86400,
	"1W": 604800, "1M": 2592000,
}

func normalizeTimeframe(value string) (string, int, bool) {
	switch strings.TrimSpace(value) {
	case "1h":
		value = "1H"
	case "2h":
		value = "2H"
	case "4h":
		value = "4H"
	case "1d":
		value = "1D"
	case "1w":
		value = "1W"
	case "1mo":
		value = "1M"
	}
	seconds, ok := timeframeSeconds[value]
	return value, seconds, ok
}

func normalizeCandles(candles []mt5stream.Candle) ([]Bar, error) {
	byTime := make(map[int64]Bar, len(candles))
	for _, c := range candles {
		if c.Time <= 0 || !finite(c.Open) || !finite(c.High) || !finite(c.Low) ||
			!finite(c.Close) || !finite(c.Volume) || c.Volume < 0 ||
			c.High < c.Open || c.High < c.Close || c.High < c.Low ||
			c.Low > c.Open || c.Low > c.Close {
			return nil, fmt.Errorf("%w: invalid OHLCV candle at unix time %d", ErrDatasetPreparation, c.Time)
		}
		byTime[c.Time] = Bar{Time: time.Unix(c.Time, 0).UTC(), Open: c.Open, High: c.High, Low: c.Low, Close: c.Close, Volume: c.Volume}
	}
	out := make([]Bar, 0, len(byTime))
	for _, bar := range byTime {
		out = append(out, bar)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time.Before(out[j].Time) })
	return out, nil
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func datasetChecksum(provider, symbol, timeframe string, interval int, bars []Bar) string {
	h := sha256.New()
	h.Write([]byte(provider))
	h.Write([]byte{0})
	h.Write([]byte(symbol))
	h.Write([]byte{0})
	h.Write([]byte(timeframe))
	h.Write([]byte{0})
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(interval))
	h.Write(buf[:])
	for _, bar := range bars {
		binary.BigEndian.PutUint64(buf[:], uint64(bar.Time.Unix()))
		h.Write(buf[:])
		for _, v := range []float64{bar.Open, bar.High, bar.Low, bar.Close, bar.Volume} {
			binary.BigEndian.PutUint64(buf[:], math.Float64bits(v))
			h.Write(buf[:])
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}

// barAtOrBefore resolves a requested market time without ever selecting a
// future candle. This is intentionally different from nearest-neighbor
// selection: replay must not move forward just because the next open is closer.
func barAtOrBefore(bars []Bar, target time.Time) (int64, time.Time, bool) {
	if len(bars) == 0 {
		return 0, time.Time{}, false
	}
	i := sort.Search(len(bars), func(i int) bool { return bars[i].Time.After(target) }) - 1
	if i < 0 {
		return 0, time.Time{}, false
	}
	return int64(i), bars[i].Time, true
}
