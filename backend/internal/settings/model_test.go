package settings

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestApplyPatchDeepMergesSections(t *testing.T) {
	base := Document{
		UI:            raw(`{"theme":"dark","panels":{"bottom":true,"height":320}}`),
		SMC:           raw(`{}`),
		Chart:         raw(`{}`),
		Notifications: raw(`{}`),
	}
	patchUI := raw(`{"panels":{"height":180},"density":"compact"}`)

	got, err := ApplyPatch(base, Patch{UI: &patchUI})
	if err != nil {
		t.Fatalf("ApplyPatch: %v", err)
	}

	ui := object(t, got.UI)
	if ui["theme"] != "dark" {
		t.Fatalf("theme should be preserved, got %v", ui["theme"])
	}
	if ui["density"] != "compact" {
		t.Fatalf("density should be added, got %v", ui["density"])
	}
	panels, ok := ui["panels"].(map[string]any)
	if !ok {
		t.Fatalf("panels should be an object, got %T", ui["panels"])
	}
	if panels["bottom"] != true {
		t.Fatalf("nested boolean should be preserved, got %v", panels["bottom"])
	}
	if panels["height"] != float64(180) {
		t.Fatalf("nested height should be replaced, got %v", panels["height"])
	}
}

func TestApplyPatchRejectsNonObjectSections(t *testing.T) {
	patchUI := raw(`["bad"]`)
	_, err := ApplyPatch(EmptyDocument(), Patch{UI: &patchUI})
	if !errors.Is(err, ErrBadPatch) {
		t.Fatalf("want ErrBadPatch, got %v", err)
	}
}

func TestApplyPatchStoresEmojiPickerStateInChartSettings(t *testing.T) {
	base := EmptyDocument()
	patchChart := raw(`{
		"drawingToolPreferences": {
			"version": 1,
			"toolDefaults": {"emoji": {"text": "🐂📈", "fontSize": 36}},
			"emojiSelection": {"kind": "sticker", "value": "🐂📈"},
			"emojiRecents": [
				{"kind": "sticker", "value": "🐂📈"},
				{"kind": "emoji", "value": "😊"}
			]
		}
	}`)

	got, err := ApplyPatch(base, Patch{Chart: &patchChart})
	if err != nil {
		t.Fatalf("ApplyPatch: %v", err)
	}

	chart := object(t, got.Chart)
	preferences, ok := chart["drawingToolPreferences"].(map[string]any)
	if !ok {
		t.Fatalf("drawingToolPreferences should be an object, got %T", chart["drawingToolPreferences"])
	}
	selection, ok := preferences["emojiSelection"].(map[string]any)
	if !ok || selection["kind"] != "sticker" || selection["value"] != "🐂📈" {
		t.Fatalf("emoji selection should survive backend merge, got %#v", preferences["emojiSelection"])
	}
	recents, ok := preferences["emojiRecents"].([]any)
	if !ok || len(recents) != 2 {
		t.Fatalf("emoji recents should survive backend merge, got %#v", preferences["emojiRecents"])
	}
	defaults, ok := preferences["toolDefaults"].(map[string]any)
	if !ok {
		t.Fatalf("toolDefaults should be an object, got %T", preferences["toolDefaults"])
	}
	emoji, ok := defaults["emoji"].(map[string]any)
	if !ok || emoji["text"] != "🐂📈" || emoji["fontSize"] != float64(36) {
		t.Fatalf("emoji defaults should survive backend merge, got %#v", defaults["emoji"])
	}
}

func TestEmptyDocumentUsesCollapsedBottomAndDisabledSMC(t *testing.T) {
	doc := EmptyDocument()

	ui := object(t, doc.UI)
	if ui["bottomOpen"] != false {
		t.Fatalf("bottom panel should default closed, got %v", ui["bottomOpen"])
	}
	if ui["rightPanelTab"] != "watchlist" || ui["gridVisible"] != true {
		t.Fatalf("UI preferences should have stable defaults, got %#v", ui)
	}

	smc := object(t, doc.SMC)
	for key, value := range smc {
		if value != false {
			t.Fatalf("SMC setting %s should default false, got %v", key, value)
		}
	}

	chart := object(t, doc.Chart)
	if chart["symbol"] != "EURUSD" || chart["timeZone"] != "exchange" || chart["drawingSyncMode"] != "chart-only" || chart["drawingSyncModeVersion"] != float64(2) {
		t.Fatalf("chart preferences should have stable defaults, got %#v", chart)
	}
	drawing, ok := chart["drawingToolPreferences"].(map[string]any)
	if !ok || drawing["magnetEnabled"] != false || drawing["magnetMode"] != "weak" {
		t.Fatalf("drawing preferences should have stable defaults, got %#v", chart)
	}
	selection, ok := drawing["emojiSelection"].(map[string]any)
	if !ok || selection["kind"] != "emoji" || selection["value"] != "😊" {
		t.Fatalf("drawing preferences should include a stable emoji selection, got %#v", drawing)
	}
	recents, ok := drawing["emojiRecents"].([]any)
	if !ok || len(recents) != 0 {
		t.Fatalf("drawing preferences should start with no emoji recents, got %#v", drawing)
	}
	defaults, ok := drawing["toolDefaults"].(map[string]any)
	if !ok {
		t.Fatalf("drawing preferences should include tool defaults, got %#v", drawing)
	}
	emoji, ok := defaults["emoji"].(map[string]any)
	if !ok || emoji["text"] != "😊" || emoji["fontSize"] != float64(32) {
		t.Fatalf("drawing preferences should include emoji creation defaults, got %#v", drawing)
	}
}

func TestNormalizeDocumentBackfillsDefaultWorkspaceState(t *testing.T) {
	doc := NormalizeDocument(Document{
		UI:            raw(`{}`),
		SMC:           raw(`{"liquidity":true}`),
		Chart:         raw(`{}`),
		Notifications: raw(`{}`),
	})

	ui := object(t, doc.UI)
	if ui["bottomOpen"] != false {
		t.Fatalf("bottom panel should be backfilled closed, got %v", ui["bottomOpen"])
	}

	smc := object(t, doc.SMC)
	if smc["liquidity"] != true {
		t.Fatalf("explicit remote SMC setting should be preserved, got %v", smc["liquidity"])
	}
	if smc["structure"] != false || smc["sessions"] != false {
		t.Fatalf("missing SMC settings should backfill false, got %#v", smc)
	}

	chart := object(t, doc.Chart)
	if chart["symbol"] != "EURUSD" || chart["timeZone"] != "exchange" || chart["drawingSyncMode"] != "chart-only" || chart["drawingSyncModeVersion"] != float64(2) {
		t.Fatalf("missing chart settings should be backfilled, got %#v", chart)
	}
}

func TestFavoriteTimeframesFromDocumentPreservesExplicitEmptyList(t *testing.T) {
	missing := FavoriteTimeframesFromDocument(EmptyDocument())
	if got, want := len(missing.Timeframes), 3; got != want {
		t.Fatalf("missing favorites length = %d, want %d", got, want)
	}

	empty := FavoriteTimeframesFromDocument(Document{Chart: raw(`{"favoriteTimeframes":[]}`)})
	if len(empty.Timeframes) != 0 {
		t.Fatalf("explicit empty favorites should be preserved, got %#v", empty.Timeframes)
	}
}

func TestFavoriteTimeframesPatchNormalizesAndValidates(t *testing.T) {
	patch, err := FavoriteTimeframesPatch([]string{"1H", "1m", "5m", "1m"})
	if err != nil {
		t.Fatalf("FavoriteTimeframesPatch: %v", err)
	}
	doc, err := ApplyPatch(Document{Chart: raw(`{"style":"bars"}`)}, patch)
	if err != nil {
		t.Fatalf("ApplyPatch: %v", err)
	}
	got := FavoriteTimeframesFromDocument(doc)
	if want := []string{"1m", "5m", "1H"}; len(got.Timeframes) != len(want) {
		t.Fatalf("favorites = %#v, want %#v", got.Timeframes, want)
	}
	if _, err := FavoriteTimeframesPatch([]string{"10m"}); !errors.Is(err, ErrBadPatch) {
		t.Fatalf("unsupported timeframe error = %v, want ErrBadPatch", err)
	}
}

func raw(s string) json.RawMessage {
	return json.RawMessage(s)
}

func object(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal object: %v", err)
	}
	return out
}
