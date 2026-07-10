package replay

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
)

type Cleaner struct {
	store                                        SessionStore
	interval, sessionRetention, datasetRetention time.Duration
	batch                                        int32
}

func NewCleaner(store SessionStore, interval, sessionRetention, datasetRetention time.Duration) *Cleaner {
	// Invalid retention must fail safe. A negative value would move the cutoff
	// into the future and could delete newly closed sessions immediately.
	if sessionRetention <= 0 {
		sessionRetention = 720 * time.Hour
	}
	if datasetRetention <= 0 {
		datasetRetention = 168 * time.Hour
	}
	return &Cleaner{store: store, interval: interval, sessionRetention: sessionRetention, datasetRetention: datasetRetention, batch: 100}
}

func (c *Cleaner) Start(ctx context.Context) {
	if c.interval <= 0 {
		return
	}
	go func() {
		ticker := time.NewTicker(c.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				result, err := c.store.Cleanup(ctx, now.Add(-c.sessionRetention), now.Add(-c.datasetRetention), c.batch)
				if err != nil {
					log.Error().Err(err).Msg("replay cleanup failed")
					continue
				}
				if result.Sessions+result.Datasets > 0 {
					log.Info().Int64("sessions", result.Sessions).Int64("datasets", result.Datasets).Msg("replay cleanup complete")
				}
			}
		}
	}()
}
