package replay

import (
	"testing"
	"time"
)

func TestProgressiveAggregationNeverUsesFutureOHLC(t *testing.T) {
	start := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	rows := []sourceBar{
		{Seq: 0, Time: start, IntervalSeconds: 60, Open: 10, High: 12, Low: 9, Close: 11, Volume: 1},
		{Seq: 1, Time: start.Add(time.Minute), IntervalSeconds: 60, Open: 11, High: 20, Low: 8, Close: 15, Volume: 2},
	}
	state, first, err := aggregateSourceBars(newAggregateState(), "15m", rows[:1])
	if err != nil {
		t.Fatal(err)
	}
	if got := first[len(first)-1]; got.High != 12 || got.Low != 9 || got.Close != 11 || got.Complete {
		t.Fatalf("first partial leaked future data: %#v", got)
	}
	_, second, err := aggregateSourceBars(state, "15m", rows[1:])
	if err != nil {
		t.Fatal(err)
	}
	if got := second[len(second)-1]; got.High != 20 || got.Low != 8 || got.Close != 15 || got.Volume != 3 || got.Complete {
		t.Fatalf("second partial is wrong: %#v", got)
	}
}

func TestIntradayAggregateCompletesAtBucketBoundary(t *testing.T) {
	start := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	rows := make([]sourceBar, 15)
	for i := range rows {
		rows[i] = sourceBar{Seq: int64(i), Time: start.Add(time.Duration(i) * time.Minute), IntervalSeconds: 60,
			Open: 1, High: float64(i + 2), Low: 0, Close: float64(i + 1), Volume: 1}
	}
	bars, state, err := aggregateRevealedBars("15m", rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(bars) != 1 || !bars[0].Complete || bars[0].Close != 15 || bars[0].Volume != 15 || state.LastSourceSeq != 14 {
		t.Fatalf("aggregate=%#v state=%#v", bars, state)
	}
}

func TestCalendarBucketsUseMondayAndMonthBoundaries(t *testing.T) {
	friday := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	weekStart, weekEnd, err := replayBucket(friday, "1W")
	if err != nil {
		t.Fatal(err)
	}
	if weekStart.Weekday() != time.Monday || weekEnd.Sub(weekStart) != 7*24*time.Hour {
		t.Fatalf("week bucket=%s..%s", weekStart, weekEnd)
	}
	monthStart, monthEnd, err := replayBucket(friday, "1M")
	if err != nil {
		t.Fatal(err)
	}
	if monthStart.Day() != 1 || monthEnd.Month() != time.June || monthEnd.Day() != 1 {
		t.Fatalf("month bucket=%s..%s", monthStart, monthEnd)
	}
}
