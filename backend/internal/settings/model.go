package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

var (
	ErrBadPatch = errors.New("settings: bad patch")
	emptyJSON   = json.RawMessage(`{}`)

	defaultUIJSON    = json.RawMessage(`{"theme":"dark","panels":{"right":320,"bottom":240,"left":52},"bottomTab":"replay","rightOpen":true,"rightPanelTab":"watchlist","bottomOpen":false,"fullscreen":false,"alertCenterOpen":false,"gridVisible":true}`)
	defaultSMCJSON   = json.RawMessage(`{"structure":false,"fvg":false,"orderBlocks":false,"liquidity":false,"displacement":false,"sessions":false,"killzones":false,"swings":false}`)
	defaultChartJSON = json.RawMessage(`{"timeZone":"exchange","drawingSyncMode":"global","drawingToolPreferences":{"version":1,"keepDrawing":false,"magnetEnabled":false,"magnetMode":"weak","toolDefaults":{}}}`)
)

const chartFavoriteTimeframesKey = "favoriteTimeframes"

var defaultFavoriteTimeframes = []string{"1m", "5m", "15m"}

var favoriteTimeframeOrder = map[string]int{
	"1m":  0,
	"3m":  1,
	"5m":  2,
	"15m": 3,
	"30m": 4,
	"1H":  5,
	"2H":  6,
	"4H":  7,
	"1D":  8,
	"1W":  9,
	"1M":  10,
}

// Document is the complete persisted settings payload returned by the settings API.
type Document struct {
	UI            json.RawMessage `json:"ui"`
	SMC           json.RawMessage `json:"smc"`
	Chart         json.RawMessage `json:"chart"`
	Notifications json.RawMessage `json:"notifications"`
}

// Patch is a partial settings update. Nil means "section not touched".
type Patch struct {
	UI            *json.RawMessage
	SMC           *json.RawMessage
	Chart         *json.RawMessage
	Notifications *json.RawMessage
}

// FavoriteTimeframes is the chart toolbar's ordered set of starred intervals.
// It deliberately lives in the existing chart settings document so it shares
// the same user ownership and cross-device persistence as other preferences.
type FavoriteTimeframes struct {
	Timeframes []string `json:"timeframes"`
}

type FavoriteTimeframesWrite struct {
	Timeframes []string `json:"timeframes"`
}

func EmptyDocument() Document {
	return Document{
		UI:            cloneRaw(defaultUIJSON),
		SMC:           cloneRaw(defaultSMCJSON),
		Chart:         cloneRaw(defaultChartJSON),
		Notifications: cloneRaw(emptyJSON),
	}
}

func NormalizeDocument(doc Document) Document {
	return Document{
		UI:            normalizeSectionWithDefaults(doc.UI, defaultUIJSON),
		SMC:           normalizeSectionWithDefaults(doc.SMC, defaultSMCJSON),
		Chart:         normalizeSectionWithDefaults(doc.Chart, defaultChartJSON),
		Notifications: normalizeSection(doc.Notifications),
	}
}

func ApplyPatch(base Document, patch Patch) (Document, error) {
	base = NormalizeDocument(base)
	var err error

	if patch.UI != nil {
		base.UI, err = mergeJSONObjects(base.UI, *patch.UI)
		if err != nil {
			return Document{}, err
		}
	}
	if patch.SMC != nil {
		base.SMC, err = mergeJSONObjects(base.SMC, *patch.SMC)
		if err != nil {
			return Document{}, err
		}
	}
	if patch.Chart != nil {
		base.Chart, err = mergeJSONObjects(base.Chart, *patch.Chart)
		if err != nil {
			return Document{}, err
		}
	}
	if patch.Notifications != nil {
		base.Notifications, err = mergeJSONObjects(base.Notifications, *patch.Notifications)
		if err != nil {
			return Document{}, err
		}
	}
	return base, nil
}

// FavoriteTimeframesFromDocument extracts a safe, canonical favorite list.
// Older rows do not have the chart field yet, so they receive the UI defaults.
// An explicit empty array remains empty and means the user has unstarred every
// interval.
func FavoriteTimeframesFromDocument(doc Document) FavoriteTimeframes {
	var chart map[string]json.RawMessage
	if err := json.Unmarshal(normalizeSection(doc.Chart), &chart); err != nil {
		return FavoriteTimeframes{Timeframes: cloneStrings(defaultFavoriteTimeframes)}
	}

	raw, ok := chart[chartFavoriteTimeframesKey]
	if !ok {
		return FavoriteTimeframes{Timeframes: cloneStrings(defaultFavoriteTimeframes)}
	}

	var values []string
	if err := json.Unmarshal(raw, &values); err != nil || values == nil {
		return FavoriteTimeframes{Timeframes: cloneStrings(defaultFavoriteTimeframes)}
	}

	normalized, err := normalizeFavoriteTimeframes(values)
	if err != nil {
		return FavoriteTimeframes{Timeframes: cloneStrings(defaultFavoriteTimeframes)}
	}
	return FavoriteTimeframes{Timeframes: normalized}
}

// FavoriteTimeframesPatch validates and serializes an update without replacing
// unrelated chart settings such as style or scale preferences.
func FavoriteTimeframesPatch(values []string) (Patch, error) {
	normalized, err := normalizeFavoriteTimeframes(values)
	if err != nil {
		return Patch{}, err
	}
	raw, err := json.Marshal(map[string]any{
		chartFavoriteTimeframesKey: normalized,
	})
	if err != nil {
		return Patch{}, fmt.Errorf("%w: marshal favorite timeframes: %v", ErrBadPatch, err)
	}
	chart := json.RawMessage(raw)
	return Patch{Chart: &chart}, nil
}

func normalizeFavoriteTimeframes(values []string) ([]string, error) {
	if values == nil {
		return nil, fmt.Errorf("%w: timeframes is required", ErrBadPatch)
	}

	seen := make(map[string]struct{}, len(values))
	for _, timeframe := range values {
		if _, ok := favoriteTimeframeOrder[timeframe]; !ok {
			return nil, fmt.Errorf("%w: unsupported timeframe %q", ErrBadPatch, timeframe)
		}
		seen[timeframe] = struct{}{}
	}

	normalized := make([]string, 0, len(seen))
	for timeframe := range seen {
		normalized = append(normalized, timeframe)
	}
	sort.Slice(normalized, func(i, j int) bool {
		return favoriteTimeframeOrder[normalized[i]] < favoriteTimeframeOrder[normalized[j]]
	})
	return normalized, nil
}

func cloneStrings(values []string) []string {
	out := make([]string, len(values))
	copy(out, values)
	return out
}

func normalizeSection(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return cloneRaw(emptyJSON)
	}
	return cloneRaw(raw)
}

func normalizeSectionWithDefaults(raw json.RawMessage, defaults json.RawMessage) json.RawMessage {
	raw = normalizeSection(raw)
	merged, err := mergeJSONObjects(defaults, raw)
	if err != nil {
		return cloneRaw(defaults)
	}
	return merged
}

func cloneRaw(raw json.RawMessage) json.RawMessage {
	out := make(json.RawMessage, len(raw))
	copy(out, raw)
	return out
}

func mergeJSONObjects(baseRaw, patchRaw json.RawMessage) (json.RawMessage, error) {
	baseMap, err := rawObject(baseRaw)
	if err != nil {
		return nil, err
	}
	patchMap, err := rawObject(patchRaw)
	if err != nil {
		return nil, err
	}
	merged := deepMerge(baseMap, patchMap)
	out, err := json.Marshal(merged)
	if err != nil {
		return nil, fmt.Errorf("%w: marshal merged settings: %v", ErrBadPatch, err)
	}
	return json.RawMessage(out), nil
}

func rawObject(raw json.RawMessage) (map[string]any, error) {
	raw = normalizeSection(raw)
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, fmt.Errorf("%w: invalid JSON object", ErrBadPatch)
	}
	if obj == nil {
		return nil, fmt.Errorf("%w: section must be a JSON object", ErrBadPatch)
	}
	return obj, nil
}

func deepMerge(base, patch map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(patch))
	for k, v := range base {
		out[k] = v
	}
	for k, patchValue := range patch {
		if patchObj, ok := patchValue.(map[string]any); ok {
			if baseObj, ok := out[k].(map[string]any); ok {
				out[k] = deepMerge(baseObj, patchObj)
				continue
			}
		}
		out[k] = patchValue
	}
	return out
}
