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
