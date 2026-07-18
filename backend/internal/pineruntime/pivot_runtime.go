package pineruntime

// runtimePivot is the backend's common pivot representation. index is the
// candle that owns the swing; confirmation is the candle where the right-side
// window has completed and the value becomes observable to a no-lookahead
// runtime.
type runtimePivot struct {
	index        int
	confirmation int
	value        float64
}

// detectRuntimePivots implements the common Pine ta.pivothigh()/ta.pivotlow()
// comparison policy. Keeping the formation and confirmation indexes together
// prevents vector and stateful execution paths from drifting apart.
func detectRuntimePivots(values []float64, left, right int, kind string) []runtimePivot {
	pivots := []runtimePivot{}
	if len(values) == 0 || left < 1 || right < 1 || len(values) < left+right+1 {
		return pivots
	}
	for index := left; index+right < len(values); index++ {
		center := values[index]
		isPivot := usable(center)
		for offset := 1; isPivot && offset <= left; offset++ {
			neighbor := values[index-offset]
			if !usable(neighbor) {
				isPivot = false
				break
			}
			if kind == "high" {
				isPivot = neighbor < center
			} else {
				isPivot = neighbor > center
			}
		}
		for offset := 1; isPivot && offset <= right; offset++ {
			neighbor := values[index+offset]
			if !usable(neighbor) {
				isPivot = false
				break
			}
			if kind == "high" {
				isPivot = neighbor < center
			} else {
				isPivot = neighbor > center
			}
		}
		if isPivot {
			pivots = append(pivots, runtimePivot{
				index:        index,
				confirmation: index + right,
				value:        center,
			})
		}
	}
	return pivots
}
