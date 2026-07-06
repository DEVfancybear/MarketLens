// Package migrations embeds the SQL migration files so the migrate runner works
// from any working directory and cross-platform (no file:// path handling).
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
