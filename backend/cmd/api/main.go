package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/smc-trading-terminal/backend/internal/config"
	"github.com/smc-trading-terminal/backend/internal/httpserver"
)

func main() {
	cfg := config.Load()

	srv := httpserver.New(cfg)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := srv.Start(ctx); err != nil {
		log.Fatalf("server error: %v", err)
	}

	fmt.Println("shutdown complete")
}
