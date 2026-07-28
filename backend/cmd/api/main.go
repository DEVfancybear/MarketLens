package main

import (
	"context"
	"fmt"
	stdlog "log"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog/log"
	"github.com/smc-trading-terminal/backend/internal/alerts"
	"github.com/smc-trading-terminal/backend/internal/alertworker"
	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/config"
	"github.com/smc-trading-terminal/backend/internal/db"
	"github.com/smc-trading-terminal/backend/internal/db/gen"
	"github.com/smc-trading-terminal/backend/internal/drawings"
	"github.com/smc-trading-terminal/backend/internal/execution"
	"github.com/smc-trading-terminal/backend/internal/httpserver"
	"github.com/smc-trading-terminal/backend/internal/indicators"
	"github.com/smc-trading-terminal/backend/internal/journal"
	"github.com/smc-trading-terminal/backend/internal/layouts"
	"github.com/smc-trading-terminal/backend/internal/mt5stream"
	"github.com/smc-trading-terminal/backend/internal/pineruntime"
	"github.com/smc-trading-terminal/backend/internal/pinescripts"
	"github.com/smc-trading-terminal/backend/internal/replay"
	"github.com/smc-trading-terminal/backend/internal/settings"
	"github.com/smc-trading-terminal/backend/internal/simtrading"
	objectstorage "github.com/smc-trading-terminal/backend/internal/storage"
	"github.com/smc-trading-terminal/backend/internal/users"
	"github.com/smc-trading-terminal/backend/internal/watchlists"
	"github.com/smc-trading-terminal/backend/internal/workspace"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		stdlog.Fatalf("config error: %v", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	alertworker.New(alertworker.Config{
		Enabled: cfg.AlertEvaluatorEnabled, URL: cfg.AlertEvaluatorURL,
		Secret: cfg.PushWorkerSecret, Interval: cfg.AlertEvaluatorInterval,
		Timeout: cfg.AlertEvaluatorTimeout,
	}).Start(ctx)

	mt5Service := mt5stream.NewService(mt5stream.Config{
		Enabled:        cfg.MT5StreamAPIEnabled,
		BridgeURL:      cfg.MT5BridgeWSURL,
		DialTimeout:    cfg.MT5BridgeDialTimeout,
		ReadLimitBytes: cfg.MT5BridgeReadLimitBytes,
		ReconnectMin:   cfg.MT5BridgeReconnectMin,
		ReconnectMax:   cfg.MT5BridgeReconnectMax,
	})
	mt5Service.Start(ctx)
	mt5Handler := mt5stream.NewHandler(mt5Service)
	pineRuntimeHandler := pineruntime.NewHandler()

	// Connect to Postgres when a URL is configured. In local dev without a DB,
	// the server still boots and /health/ready reports the DB as unconfigured.
	var pool *db.Pool
	if cfg.DatabaseURL != "" {
		pool, err = db.New(ctx, cfg.DatabaseURL)
		if err != nil {
			stdlog.Fatalf("database error: %v", err)
		}
		defer pool.Close()
		log.Info().Msg("connected to database")
	} else {
		log.Warn().Msg("DATABASE_URL not set; starting without a database (readiness will report unconfigured)")
	}

	// Assemble the auth stack only when both a database and a Firebase service
	// account are available. Protected workspace routes use the same middleware
	// and stay unmounted when auth cannot be assembled.
	var authHandler *auth.Handler
	var settingsHandler *settings.Handler
	var watchlistsHandler *watchlists.Handler
	var drawingsHandler *drawings.Handler
	var indicatorsHandler *indicators.Handler
	var pineScriptsHandler *pinescripts.Handler
	var alertsHandler *alerts.Handler
	var layoutsHandler *layouts.Handler
	var workspaceHandler *workspace.Handler
	var replayHandler *replay.Handler
	var journalHandler *journal.Handler
	var simTradingHandler *simtrading.Handler
	var executionHandler *execution.Handler
	var pineScriptsStore *pinescripts.Repo
	var screenshotSigner objectstorage.Signer
	if cfg.ObjectStorageConfigured() {
		signer, storageErr := objectstorage.NewS3Signer(objectstorage.Config{
			Endpoint: cfg.ObjectStorageEndpoint, Bucket: cfg.ObjectStorageBucket,
			Region: cfg.ObjectStorageRegion, AccessKey: cfg.ObjectStorageAccessKey,
			SecretKey: cfg.ObjectStorageSecretKey, SessionToken: cfg.ObjectStorageSessionToken,
			PathStyle: cfg.ObjectStoragePathStyle,
		})
		if storageErr != nil {
			stdlog.Fatalf("object storage init error: %v", storageErr)
		}
		screenshotSigner = signer
	}
	if pool != nil {
		pineScriptsStore = pinescripts.NewRepo(pool.Pool)
		pineScriptsHandler = pinescripts.NewHandler(pineScriptsStore, nil)
	}
	switch {
	case pool == nil:
		log.Warn().Msg("protected api routes disabled: no database configured")
	case !cfg.FirebaseConfigured():
		log.Warn().Msg("protected api routes disabled: Firebase service account not configured")
	default:
		verifier, verr := auth.NewVerifier(ctx, cfg)
		if verr != nil {
			stdlog.Fatalf("auth init error: %v", verr)
		}
		tokens := auth.NewTokenService(cfg)
		sessions := auth.NewSessionService(auth.NewPgSessionStore(gen.New(pool.Pool)), cfg)
		svc := auth.NewService(verifier, users.NewRepo(pool.Pool), sessions, tokens)
		authHandler = auth.NewHandler(svc, tokens, cfg)

		requireAuth := auth.RequireAuth(tokens)
		requireActiveSession := auth.RequireActiveSession(sessions)
		settingsStore := settings.NewRepo(pool.Pool)
		secretBox, secretErr := settings.NewSecretBox(cfg.AuthJWTSecret)
		if secretErr != nil {
			stdlog.Fatalf("integration settings encryption init error: %v", secretErr)
		}
		settingsHandler = settings.NewHandler(settingsStore, requireAuth).
			WithIntegrations(
				settings.NewIntegrationRepo(pool.Pool), secretBox, cfg.PushWorkerSecret, cfg.ChartTimeZone,
			)
		watchlistsStore := watchlists.NewRepo(pool.Pool)
		watchlistsHandler = watchlists.NewHandler(watchlistsStore, requireAuth)
		drawingsStore := drawings.NewRepo(pool.Pool)
		drawingsHandler = drawings.NewHandler(drawingsStore, requireAuth)
		indicatorsStore := indicators.NewRepo(pool.Pool)
		indicatorsHandler = indicators.NewHandler(indicatorsStore, requireAuth)
		pineScriptsHandler = pinescripts.NewHandler(pineScriptsStore, requireAuth)
		alertsStore := alerts.NewRepo(pool.Pool)
		alertsHandler = alerts.NewHandler(alertsStore, requireAuth).WithWorkerTrigger(
			cfg.PushWorkerSecret, secretBox.VerifyDeliveryToken,
		)
		layoutsStore := layouts.NewRepo(pool.Pool)
		layoutsHandler = layouts.NewHandler(layoutsStore, requireAuth)
		workspaceHandler = workspace.NewHandler(settingsStore, watchlistsStore, drawingsStore, indicatorsStore, pineScriptsStore, alertsStore, layoutsStore, requireAuth)
		journalHandler = journal.NewHandler(journal.NewRepo(pool.Pool), screenshotSigner, requireAuth)
		simTradingHandler = simtrading.NewHandler(simtrading.NewRepo(pool.Pool), requireAuth)
		if cfg.ExecutionAdminToken != "" {
			executionClient, executionErr := execution.NewClient(
				cfg.ExecutionAdminURL,
				cfg.ExecutionAdminToken,
			)
			if executionErr != nil {
				stdlog.Fatalf("execution gateway client init error: %v", executionErr)
			}
			executionEAProxy, executionEAErr := execution.NewEAProxy(cfg.ExecutionEAURL)
			if executionEAErr != nil {
				stdlog.Fatalf("execution EA proxy init error: %v", executionEAErr)
			}
			executionHandler = execution.NewHandler(
				executionClient,
				requireAuth,
				requireActiveSession,
			).
				WithEAProxy(executionEAProxy)
		} else {
			log.Warn().Msg("execution API routes disabled: EXECUTION_ADMIN_TOKEN not configured")
		}
		if cfg.ReplayEngineEnabled {
			replayStore := replay.NewRepo(pool.Pool)
			replayService := replay.NewService(replayStore, mt5Service, cfg.ReplayMaxBars, cfg.ReplayMaxTracks)
			replayEngine := replay.NewEngine(replayStore, cfg.ReplayDisconnectGrace, cfg.ReplayActorLeaseTTL)
			if err := replayEngine.Start(ctx); err != nil {
				stdlog.Fatalf("replay engine init error: %v", err)
			}
			replayHandler = replay.NewHandler(replayService, requireAuth, replayEngine)
			replay.NewCleaner(replayStore, cfg.ReplayCleanupInterval, cfg.ReplaySessionRetention, cfg.ReplayDatasetRetention).Start(ctx)
			log.Info().Int("max_bars", cfg.ReplayMaxBars).Int("max_tracks", cfg.ReplayMaxTracks).Msg("backend replay Phase 5 enabled")
		}
		log.Info().Msg("protected api routes enabled")
	}

	srv := httpserver.New(
		cfg,
		pool,
		authHandler,
		settingsHandler,
		watchlistsHandler,
		drawingsHandler,
		indicatorsHandler,
		pineScriptsHandler,
		alertsHandler,
		layoutsHandler,
		workspaceHandler,
		journalHandler,
		simTradingHandler,
		executionHandler,
		replayHandler,
		mt5Handler,
		pineRuntimeHandler,
	)

	if err := srv.Start(ctx); err != nil {
		stdlog.Fatalf("server error: %v", err)
	}

	fmt.Println("shutdown complete")
}
