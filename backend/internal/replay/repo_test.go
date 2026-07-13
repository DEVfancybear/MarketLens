package replay

import (
	"errors"
	"testing"
	"time"
)

func TestResolveForkTargetClampsVisiblePartialFirstBucket(t *testing.T) {
	target := time.Date(2026, 7, 8, 8, 0, 0, 0, time.UTC)
	first := target.Add(12 * time.Minute)
	last := time.Date(2026, 7, 13, 2, 45, 0, 0, time.UTC)

	resolved, err := resolveForkTarget(target, last, []forkTrackWindow{
		{FirstAvailable: first, ChartTimeframe: "15m"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !resolved.Equal(first) {
		t.Fatalf("resolved target=%s want first source row=%s", resolved, first)
	}
}

func TestResolveForkTargetRejectsTargetOutsideFirstBucket(t *testing.T) {
	first := time.Date(2026, 7, 8, 8, 12, 0, 0, time.UTC)
	target := time.Date(2026, 7, 8, 7, 59, 0, 0, time.UTC)
	last := time.Date(2026, 7, 13, 2, 45, 0, 0, time.UTC)

	_, err := resolveForkTarget(target, last, []forkTrackWindow{
		{FirstAvailable: first, ChartTimeframe: "15m"},
	})
	if !errors.Is(err, ErrDataUnavailable) {
		t.Fatalf("error=%v want ErrDataUnavailable", err)
	}
}

func TestResolveForkTargetRequiresEveryTrackToCoverSelectedBucket(t *testing.T) {
	target := time.Date(2026, 7, 8, 8, 0, 0, 0, time.UTC)
	last := time.Date(2026, 7, 13, 2, 45, 0, 0, time.UTC)

	_, err := resolveForkTarget(target, last, []forkTrackWindow{
		{FirstAvailable: target.Add(12 * time.Minute), ChartTimeframe: "15m"},
		{FirstAvailable: target.Add(65 * time.Minute), ChartTimeframe: "1H"},
	})
	if !errors.Is(err, ErrDataUnavailable) {
		t.Fatalf("error=%v want ErrDataUnavailable for uncovered synchronized track", err)
	}
}
