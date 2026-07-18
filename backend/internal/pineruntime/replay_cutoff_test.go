package pineruntime

import "testing"

func TestClampIndicatorResultToReplayClipsContinuousSeriesAndLabels(t *testing.T) {
	extendToVisibleRange := true
	pastLabelTime := int64(120)
	futureLabelTime := int64(180)
	result := clampIndicatorResultToReplay(IndicatorResult{
		ID: "common-replay",
		Series: []IndicatorSeries{
			{
				Key:                  "line",
				Type:                 "line",
				ExtendToVisibleRange: &extendToVisibleRange,
				Data: []LinePoint{
					{Time: 100, Value: 10},
					{Time: 200, Value: 20},
				},
			},
		},
		Labels: []IndicatorOverlayLabel{
			{Key: "past", Time: &pastLabelTime},
			{Key: "future", Time: &futureLabelTime},
			{Key: "price-only"},
		},
	}, 150)

	if len(result.Series) != 1 || len(result.Series[0].Data) != 2 {
		t.Fatalf("clipped series = %+v", result.Series)
	}
	boundary := result.Series[0].Data[1]
	if boundary.Time != 150 || boundary.Value != 15 {
		t.Fatalf("interpolated boundary = %+v", boundary)
	}
	if result.Series[0].ExtendToVisibleRange == nil || *result.Series[0].ExtendToVisibleRange {
		t.Fatalf("replay series still extends through viewport: %+v", result.Series[0])
	}
	if len(result.Labels) != 2 || result.Labels[0].Key != "past" || result.Labels[1].Key != "price-only" {
		t.Fatalf("clipped labels = %+v", result.Labels)
	}
}
