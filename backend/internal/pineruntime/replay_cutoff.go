package pineruntime

import (
	"errors"
	"sort"
)

const maxReplayCutoff int64 = 253402300799

var errInvalidReplayCutoff = errors.New("replayCutoff must be a Unix timestamp in seconds between 1 and 253402300799")

// normalizeIndicatorRuntimeRequest applies the optional replay boundary before
// a source is resolved. This keeps catalog, saved, and user-source indicators
// on the same historical input window.
func normalizeIndicatorRuntimeRequest(request IndicatorRuntimeRequest) (IndicatorRuntimeRequest, error) {
	if request.ReplayCutoff == nil {
		return request, nil
	}
	if err := validateReplayCutoff(request.ReplayCutoff); err != nil {
		return IndicatorRuntimeRequest{}, err
	}
	request.Candles = candlesThroughReplayCutoff(
		normalizeRuntimeCandles(request.Candles),
		*request.ReplayCutoff,
	)
	return request, nil
}

func candlesThroughReplayCutoff(candles []Candle, cutoff int64) []Candle {
	if len(candles) == 0 {
		return []Candle{}
	}
	last := sort.Search(len(candles), func(index int) bool {
		return candles[index].Time > cutoff
	})
	if last == len(candles) {
		return candles
	}
	return candles[:last]
}

// clampIndicatorResultToReplay removes future primitives and clips a segment
// crossing the replay boundary. A box/line that started before the boundary
// therefore remains visible up to the selected candle, while a primitive that
// only forms in the future disappears completely.
func clampIndicatorResultToReplay(result IndicatorResult, cutoff int64) IndicatorResult {
	series := make([]IndicatorSeries, 0, len(result.Series))
	for _, item := range result.Series {
		item.Data = clipLinePointsToReplay(item.Data, cutoff, replaySeriesCanInterpolate(item.Type))
		if len(item.Data) == 0 {
			continue
		}
		extendToVisibleRange := false
		item.ExtendToVisibleRange = &extendToVisibleRange
		series = append(series, item)
	}
	labels := make([]IndicatorOverlayLabel, 0, len(result.Labels))
	for _, label := range result.Labels {
		if label.Time != nil && *label.Time > cutoff {
			continue
		}
		labels = append(labels, label)
	}
	result.Series = series
	result.Labels = labels
	return result
}

func replaySeriesCanInterpolate(seriesType string) bool {
	switch seriesType {
	case "histogram":
		return false
	default:
		// The runtime currently emits line, baselineFill, and empty-type
		// series. Treat unknown future types as continuous by default so a
		// newly registered indicator receives the same replay safety.
		return true
	}
}

func clipLinePointsToReplay(data []LinePoint, cutoff int64, interpolate bool) []LinePoint {
	if len(data) == 0 {
		return []LinePoint{}
	}
	points := append([]LinePoint(nil), data...)
	sort.SliceStable(points, func(left, right int) bool {
		return points[left].Time < points[right].Time
	})
	out := make([]LinePoint, 0, len(points))
	for _, point := range points {
		if point.Time <= cutoff {
			out = append(out, point)
			continue
		}
		if interpolate && len(out) > 0 && out[len(out)-1].Time < cutoff {
			previous := out[len(out)-1]
			out = append(out, replayBoundaryPoint(previous, point, cutoff))
		}
		break
	}
	return out
}

func replayBoundaryPoint(previous, next LinePoint, cutoff int64) LinePoint {
	point := next
	point.Time = cutoff
	if previous.Color != nil {
		point.Color = previous.Color
	}
	if next.Time == previous.Time {
		point.Value = previous.Value
		return point
	}
	ratio := float64(cutoff-previous.Time) / float64(next.Time-previous.Time)
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	point.Value = previous.Value + (next.Value-previous.Value)*ratio
	return point
}

func validateReplayCutoff(cutoff *int64) error {
	if cutoff != nil && (*cutoff <= 0 || *cutoff > maxReplayCutoff) {
		return errInvalidReplayCutoff
	}
	return nil
}
