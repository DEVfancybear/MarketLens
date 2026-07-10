package replay

import (
	"testing"
	"time"
)

func TestNewCleanerFailsSafeForInvalidRetention(t *testing.T) {
	cleaner := NewCleaner(&fakeStore{}, time.Hour, -time.Hour, 0)
	if cleaner.sessionRetention != 720*time.Hour {
		t.Fatalf("session retention = %s", cleaner.sessionRetention)
	}
	if cleaner.datasetRetention != 168*time.Hour {
		t.Fatalf("dataset retention = %s", cleaner.datasetRetention)
	}
}
