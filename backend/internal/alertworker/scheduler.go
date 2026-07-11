package alertworker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
)

type Config struct {
	Enabled  bool
	URL      string
	Secret   string
	Interval time.Duration
	Timeout  time.Duration
}

type Scheduler struct {
	cfg    Config
	client *http.Client
}

func New(cfg Config) *Scheduler {
	if cfg.Interval <= 0 {
		cfg.Interval = 15 * time.Second
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}
	return &Scheduler{cfg: cfg, client: &http.Client{Timeout: cfg.Timeout}}
}

func (s *Scheduler) Start(ctx context.Context) {
	if s == nil || !s.cfg.Enabled || s.cfg.URL == "" {
		return
	}
	go func() {
		log.Info().Str("url", s.cfg.URL).Dur("interval", s.cfg.Interval).Msg("backend alert evaluator scheduler started")
		s.runAndLog(ctx)
		ticker := time.NewTicker(s.cfg.Interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runAndLog(ctx)
			}
		}
	}()
}

func (s *Scheduler) runAndLog(ctx context.Context) {
	if err := s.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Warn().Err(err).Msg("backend alert evaluator tick failed")
	}
}

func (s *Scheduler) RunOnce(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.URL, nil)
	if err != nil {
		return err
	}
	if s.cfg.Secret != "" {
		req.Header.Set("x-push-worker-secret", s.cfg.Secret)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("evaluator returned HTTP %d", resp.StatusCode)
	}
	return nil
}
