package httpserver

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/smc-trading-terminal/backend/internal/config"
	"github.com/smc-trading-terminal/backend/internal/health"
	"github.com/smc-trading-terminal/backend/internal/middleware"
)

type Server struct {
	cfg    config.Config
	server *http.Server
}

func New(cfg config.Config) *Server {
	mux := http.NewServeMux()

	health.RegisterRoutes(mux)

	wrapped := middleware.Logging(mux)

	return &Server{
		cfg: cfg,
		server: &http.Server{
			Addr:         fmt.Sprintf(":%d", cfg.Port),
			Handler:      wrapped,
			ReadTimeout:  10 * time.Second,
			WriteTimeout: 30 * time.Second,
			IdleTimeout:  60 * time.Second,
		},
	}
}

func (s *Server) Start(ctx context.Context) error {
	errCh := make(chan error, 1)

	go func() {
		log.Info().Int("port", s.cfg.Port).Str("env", s.cfg.Env).Msg("starting HTTP server")
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		log.Info().Msg("shutting down server...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return s.server.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}
