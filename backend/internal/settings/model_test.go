package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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

func TestChartTaskTabsValidationAndRoundTrip(t *testing.T) {
	doc := validChartTaskTabsDocument(4)
	if err := ValidateChartTaskTabsDocument(doc); err != nil {
		t.Fatalf("ValidateChartTaskTabsDocument: %v", err)
	}

	base := EmptyDocument()
	base.Chart = raw(`{"style":"candles","workspaceLayout":{"version":1}}`)
	next, saved, err := ApplyChartTaskTabsWrite(base, ChartTaskTabsWrite{
		ExpectedRevision: 0,
		Document:         doc,
	})
	if err != nil {
		t.Fatalf("ApplyChartTaskTabsWrite: %v", err)
	}
	if saved.Revision != 1 {
		t.Fatalf("saved revision = %d, want 1", saved.Revision)
	}
	if got := ChartTaskTabsFromDocument(next); got.Revision != 1 || got.ActiveTaskID != "task-1" || len(got.Tasks) != 2 {
		t.Fatalf("round trip = %#v", got)
	}
	chart := object(t, next.Chart)
	if chart["style"] != "candles" || chart["workspaceLayout"] == nil {
		t.Fatalf("task tabs write replaced unrelated chart settings: %#v", chart)
	}
}

func TestChartTaskTabsRejectsStaleRevision(t *testing.T) {
	base, _, err := ApplyChartTaskTabsWrite(EmptyDocument(), ChartTaskTabsWrite{
		ExpectedRevision: 0,
		Document:         validChartTaskTabsDocument(0),
	})
	if err != nil {
		t.Fatalf("seed task tabs: %v", err)
	}
	before := string(base.Chart)
	_, _, err = ApplyChartTaskTabsWrite(base, ChartTaskTabsWrite{
		ExpectedRevision: 0,
		Document:         validChartTaskTabsDocument(0),
	})
	if !errors.Is(err, ErrChartTaskTabsConflict) {
		t.Fatalf("stale write error = %v, want ErrChartTaskTabsConflict", err)
	}
	if string(base.Chart) != before {
		t.Fatalf("stale write mutated the input document")
	}
}

func TestChartTaskTabsRejectsInvalidDocuments(t *testing.T) {
	valid := validChartTaskTabsDocument(0)
	tests := []struct {
		name string
		edit func(*ChartTaskTabsDocument)
	}{
		{"unsupported version", func(doc *ChartTaskTabsDocument) { doc.Version = 2 }},
		{"negative revision", func(doc *ChartTaskTabsDocument) { doc.Revision = -1 }},
		{"zero tasks", func(doc *ChartTaskTabsDocument) { doc.Tasks = nil }},
		{"thirteen tasks", func(doc *ChartTaskTabsDocument) {
			doc.Tasks = make([]ChartTask, 13)
			for index := range doc.Tasks {
				doc.Tasks[index] = chartTask(fmt.Sprintf("task-%d", index), fmt.Sprintf("scope-%d", index))
			}
			doc.ActiveTaskID = doc.Tasks[0].ID
		}},
		{"duplicate task id", func(doc *ChartTaskTabsDocument) { doc.Tasks[1].ID = doc.Tasks[0].ID }},
		{"duplicate context id", func(doc *ChartTaskTabsDocument) { doc.Tasks[1].DrawingContextID = doc.Tasks[0].DrawingContextID }},
		{"missing active task", func(doc *ChartTaskTabsDocument) { doc.ActiveTaskID = "missing" }},
		{"empty task id", func(doc *ChartTaskTabsDocument) { doc.Tasks[0].ID = " " }},
		{"empty active layout id", func(doc *ChartTaskTabsDocument) {
			empty := ""
			doc.Tasks[0].ActiveLayoutID = &empty
		}},
		{"invalid workspace", func(doc *ChartTaskTabsDocument) { doc.Tasks[0].Workspace = raw(`[]`) }},
		{"oversized document", func(doc *ChartTaskTabsDocument) {
			doc.Tasks[0].Workspace = raw(`{"padding":"` + strings.Repeat("x", 512*1024) + `"}`)
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			doc := cloneChartTaskTabsDocument(t, valid)
			tc.edit(&doc)
			if err := ValidateChartTaskTabsDocument(doc); !errors.Is(err, ErrBadPatch) {
				t.Fatalf("error = %v, want ErrBadPatch", err)
			}
		})
	}
}

func TestChartTaskTabsGeneratedDocumentsRespectBounds(t *testing.T) {
	for count := 1; count <= 12; count++ {
		doc := ChartTaskTabsDocument{Version: 1, ActiveTaskID: "task-0", Tasks: make([]ChartTask, count)}
		for index := range doc.Tasks {
			doc.Tasks[index] = chartTask(fmt.Sprintf("task-%d", index), fmt.Sprintf("scope-%d", index))
		}
		if err := ValidateChartTaskTabsDocument(doc); err != nil {
			t.Fatalf("count %d should validate: %v", count, err)
		}
	}
}

func validChartTaskTabsDocument(revision int64) ChartTaskTabsDocument {
	return ChartTaskTabsDocument{
		Version:      1,
		Revision:     revision,
		ActiveTaskID: "task-1",
		Tasks: []ChartTask{
			chartTask("task-1", "scope-1"),
			chartTask("task-2", "scope-2"),
		},
	}
}

func chartTask(id, contextID string) ChartTask {
	return ChartTask{
		ID:               id,
		DrawingContextID: contextID,
		Workspace:        raw(`{"version":1,"chartLayoutPreset":"single","chartPanes":[]}`),
	}
}

func cloneChartTaskTabsDocument(t *testing.T, input ChartTaskTabsDocument) ChartTaskTabsDocument {
	t.Helper()
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal task tabs: %v", err)
	}
	var out ChartTaskTabsDocument
	if err := json.Unmarshal(encoded, &out); err != nil {
		t.Fatalf("unmarshal task tabs: %v", err)
	}
	return out
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
