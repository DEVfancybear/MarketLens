package watchlists

import "testing"

func TestNormalizeSortKeyAllowsManualOrder(t *testing.T) {
	got, ok := normalizeSortKey("manual")
	if !ok || got != "manual" {
		t.Fatalf("normalizeSortKey(manual) = %q, %v", got, ok)
	}
}

func TestNormalizeSortKeyRejectsUnknownOrder(t *testing.T) {
	if got, ok := normalizeSortKey("custom"); ok || got != "" {
		t.Fatalf("normalizeSortKey(custom) = %q, %v", got, ok)
	}
}
