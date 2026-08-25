// The Revision 8 test-only command verifies migration 0042 inside one isolated
// database on an already-running loopback PostgreSQL 17 service. It exists for
// the repository gauntlet only; production startup and migration paths do not
// invoke it.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	"github.com/marketlens/backend/migrations"
)

const (
	adminURLEnv = "MT5_R8_POSTGRES_ADMIN_URL"
	runTokenEnv = "MT5_R8_RUN_TOKEN"
)

var (
	runTokenPattern     = regexp.MustCompile(`^[0-9a-f]{32}$`)
	databaseNamePattern = regexp.MustCompile(`^marketlens_r8_[0-9a-f]{32}$`)
)

type options struct {
	repoRoot            string
	jsonOutput          string
	negativeControl     bool
	runRustManagedTests bool
}

type report struct {
	Gate               string `json:"gate"`
	Status             string `json:"status"`
	NegativeControl    bool   `json:"negative_control"`
	RustManagedTests   bool   `json:"rust_managed_tests"`
	ServerMajor        int    `json:"server_major"`
	DatabaseNameSHA256 string `json:"database_name_sha256"`
	DatabaseCreated    bool   `json:"database_created"`
	DatabaseRemoved    bool   `json:"database_removed"`
	StartedAtUTC       string `json:"started_at_utc"`
	CompletedAtUTC     string `json:"completed_at_utc"`
	SanitizedError     string `json:"sanitized_error,omitempty"`
}

func realMain(arguments []string) int {
	flags := flag.NewFlagSet("mt5-migration-gate", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	var configured options
	flags.StringVar(&configured.repoRoot, "repo-root", "", "absolute repository root")
	flags.StringVar(&configured.jsonOutput, "json-output", "", "sanitized JSON report below .artifacts")
	flags.BoolVar(&configured.negativeControl, "negative-control", false, "prove the SQL checker rejects known-bad input")
	flags.BoolVar(&configured.runRustManagedTests, "run-rust-managed-tests", false, "run ignored Rust database tests")
	if err := flags.Parse(arguments); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "mt5-migration-gate: positional arguments are forbidden")
		return 2
	}

	admin, parseErr := parseAdminURL(os.Getenv(adminURLEnv))
	startedAt := time.Now().UTC()
	result := report{
		Gate:             "mt5-migration-0042-service-sandbox",
		Status:           "FAIL",
		NegativeControl:  configured.negativeControl,
		RustManagedTests: configured.runRustManagedTests,
		ServerMajor:      17,
		StartedAtUTC:     startedAt.Format(time.RFC3339Nano),
	}
	if parseErr != nil {
		result.SanitizedError = parseErr.Error()
		_ = writeReport(configured, result)
		fmt.Fprintln(os.Stderr, "mt5-migration-gate: invalid loopback admin credential contract")
		return 1
	}

	databaseName, nameErr := revision8DatabaseName(os.Getenv(runTokenEnv))
	if nameErr != nil {
		result.SanitizedError = nameErr.Error()
		_ = writeReport(configured, result)
		fmt.Fprintln(os.Stderr, "mt5-migration-gate: invalid run token")
		return 1
	}
	digest := sha256.Sum256([]byte(databaseName))
	result.DatabaseNameSHA256 = hex.EncodeToString(digest[:])

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	defer cancel()
	created, removed, runErr := run(ctx, configured, admin, databaseName)
	result.DatabaseCreated = created
	result.DatabaseRemoved = removed
	result.CompletedAtUTC = time.Now().UTC().Format(time.RFC3339Nano)
	if runErr == nil {
		result.Status = "PASS"
	} else {
		result.SanitizedError = sanitizeDiagnostic(runErr.Error(), admin)
	}
	if reportErr := writeReport(configured, result); reportErr != nil {
		fmt.Fprintln(os.Stderr, "mt5-migration-gate: sanitized report write failed")
		return 1
	}
	if runErr != nil {
		fmt.Fprintln(os.Stderr, "mt5-migration-gate:", sanitizeDiagnostic(runErr.Error(), admin))
		return 1
	}

	fmt.Println("SERVICE_SANDBOX_DATABASE_ABSENT=PASS")
	if configured.runRustManagedTests {
		fmt.Println("RUST_MANAGED_DATABASE_TESTS=PASS")
	}
	fmt.Println("PASS migration 0042 PostgreSQL service sandbox up/down/up, recovery, and behavior gate.")
	return 0
}

func parseAdminURL(raw string) (*url.URL, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, errors.New("admin URL is missing")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("admin URL is malformed")
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return nil, errors.New("admin URL scheme is not PostgreSQL")
	}
	if parsed.Hostname() != "127.0.0.1" || parsed.Port() != "5432" {
		return nil, errors.New("admin URL is not the exact loopback service endpoint")
	}
	if parsed.Path != "/postgres" {
		return nil, errors.New("admin URL does not target the maintenance database")
	}
	if parsed.User == nil || parsed.User.Username() != "postgres" {
		return nil, errors.New("admin URL does not use the exact maintenance role")
	}
	password, present := parsed.User.Password()
	if !present || password == "" {
		return nil, errors.New("admin URL has no password")
	}
	if parsed.Fragment != "" {
		return nil, errors.New("admin URL fragment is forbidden")
	}
	return parsed, nil
}

func revision8DatabaseName(token string) (string, error) {
	if !runTokenPattern.MatchString(token) {
		return "", errors.New("run token is not exact lowercase hex")
	}
	return "marketlens_r8_" + token, nil
}

func validateDropTarget(target, currentDatabase string) error {
	if !databaseNamePattern.MatchString(target) {
		return errors.New("database cleanup target violates the exact Revision 8 grammar")
	}
	if target == currentDatabase || target == "postgres" {
		return errors.New("database cleanup target is the active maintenance database")
	}
	return nil
}

func targetDatabaseURL(admin *url.URL, databaseName string) (string, error) {
	if err := validateDropTarget(databaseName, "postgres"); err != nil {
		return "", err
	}
	copyURL := *admin
	copyURL.Path = "/" + databaseName
	copyURL.RawPath = ""
	return copyURL.String(), nil
}

func sanitizeDiagnostic(message string, admin *url.URL) string {
	if admin == nil {
		return message
	}
	sanitized := strings.ReplaceAll(message, admin.String(), "<redacted-postgres-url>")
	if admin.User != nil {
		sanitized = strings.ReplaceAll(
			sanitized,
			admin.User.String(),
			"<redacted-postgres-userinfo>",
		)
		if password, present := admin.User.Password(); present && password != "" {
			sanitized = strings.ReplaceAll(sanitized, password, "<redacted-password>")
		}
	}
	return sanitized
}

func writeReport(configured options, value report) error {
	if configured.repoRoot == "" || configured.jsonOutput == "" {
		return errors.New("repo root and JSON output are required")
	}
	repoRoot, err := filepath.Abs(configured.repoRoot)
	if err != nil {
		return err
	}
	output, err := filepath.Abs(configured.jsonOutput)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(repoRoot, output)
	if err != nil || relative == "." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) ||
		!strings.HasPrefix(relative, ".artifacts"+string(filepath.Separator)) {
		return errors.New("JSON output is outside the repository artifact root")
	}
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(output), 0o700); err != nil {
		return err
	}
	return os.WriteFile(output, append(encoded, '\n'), 0o600)
}

func run(ctx context.Context, configured options, adminURL *url.URL, databaseName string) (created, removed bool, resultErr error) {
	adminConfig, err := pgx.ParseConfig(adminURL.String())
	if err != nil {
		return false, false, errors.New("admin connection configuration is invalid")
	}
	adminConfig.ConnectTimeout = 10 * time.Second
	admin, err := pgx.ConnectConfig(ctx, adminConfig)
	if err != nil {
		return false, false, fmt.Errorf("admin connection failed: %w", err)
	}
	defer admin.Close(context.Background())

	if err := attestServer(ctx, admin); err != nil {
		return false, false, err
	}
	exists, err := databaseExists(ctx, admin, databaseName)
	if err != nil {
		return false, false, err
	}
	if exists {
		return false, false, errors.New("generated sandbox database already exists")
	}

	identifier := pgx.Identifier{databaseName}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+identifier+" TEMPLATE template0 ENCODING 'UTF8'"); err != nil {
		return false, false, fmt.Errorf("sandbox database creation failed: %w", err)
	}
	created = true

	defer func() {
		cleanupErr := cleanupDatabase(context.Background(), admin, databaseName)
		if cleanupErr == nil {
			removed = true
		}
		resultErr = errors.Join(resultErr, cleanupErr)
	}()

	targetURL, err := targetDatabaseURL(adminURL, databaseName)
	if err != nil {
		return created, false, err
	}
	if err := executeMigrationScenario(ctx, configured, targetURL); err != nil {
		return created, false, err
	}
	return created, false, nil
}

func attestServer(ctx context.Context, admin *pgx.Conn) error {
	var user, database string
	var version int
	var recovery bool
	var port int
	err := admin.QueryRow(ctx, `
		SELECT current_user, current_database(),
		       current_setting('server_version_num')::integer,
		       pg_is_in_recovery(), inet_server_port()
	`).Scan(&user, &database, &version, &recovery, &port)
	if err != nil {
		return fmt.Errorf("server attestation query failed: %w", err)
	}
	if user != "postgres" || database != "postgres" || version < 170000 || version >= 180000 || recovery || port != 5432 {
		return errors.New("server attestation did not match PostgreSQL 17 loopback maintenance contract")
	}
	return nil
}

func databaseExists(ctx context.Context, admin *pgx.Conn, databaseName string) (bool, error) {
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", databaseName).Scan(&exists); err != nil {
		return false, fmt.Errorf("database absence query failed: %w", err)
	}
	return exists, nil
}

func cleanupDatabase(ctx context.Context, admin *pgx.Conn, databaseName string) error {
	if err := validateDropTarget(databaseName, "postgres"); err != nil {
		return err
	}
	cleanupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if _, err := admin.Exec(cleanupCtx, `
		SELECT pg_terminate_backend(pid)
		FROM pg_stat_activity
		WHERE datname = $1 AND pid <> pg_backend_pid()
	`, databaseName); err != nil {
		return fmt.Errorf("sandbox connection termination failed: %w", err)
	}
	identifier := pgx.Identifier{databaseName}.Sanitize()
	if _, err := admin.Exec(cleanupCtx, "DROP DATABASE "+identifier); err != nil {
		return fmt.Errorf("sandbox database drop failed: %w", err)
	}
	exists, err := databaseExists(cleanupCtx, admin, databaseName)
	if err != nil {
		return err
	}
	if exists {
		return errors.New("sandbox database remained after exact cleanup")
	}
	return nil
}

func executeMigrationScenario(ctx context.Context, configured options, targetURL string) error {
	connectionConfig, err := pgx.ParseConfig(targetURL)
	if err != nil {
		return errors.New("target connection configuration is invalid")
	}
	connectionConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	target, err := pgx.ConnectConfig(ctx, connectionConfig)
	if err != nil {
		return fmt.Errorf("target connection failed: %w", err)
	}
	defer target.Close(context.Background())

	source, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("migration source initialization failed: %w", err)
	}
	migrator, err := migrate.NewWithSourceInstance("iofs", source, toPGX5URL(targetURL))
	if err != nil {
		return fmt.Errorf("migration runner initialization failed: %w", err)
	}
	defer migrator.Close()

	if err := migrator.Steps(41); err != nil {
		return fmt.Errorf("migrate up 41 failed: %w", err)
	}
	if err := assertMigrationVersion(ctx, target, 41, false); err != nil {
		return err
	}
	if err := executeFixture(ctx, target, configured.repoRoot, "seed_pre_up.sql"); err != nil {
		return err
	}
	if err := migrator.Steps(1); err != nil {
		return fmt.Errorf("first migrate up 0042 failed: %w", err)
	}
	if err := assertMigrationVersion(ctx, target, 42, false); err != nil {
		return err
	}
	if err := executeFixture(ctx, target, configured.repoRoot, "assert_up.sql"); err != nil {
		return err
	}

	if configured.negativeControl {
		_, knownBadErr := target.Exec(ctx, "DO $negative_control$ BEGIN RAISE EXCEPTION 'KNOWN_BAD_0042_CHECKER_INPUT'; END $negative_control$;")
		if knownBadErr == nil || !strings.Contains(knownBadErr.Error(), "KNOWN_BAD_0042_CHECKER_INPUT") {
			return errors.New("negative control unexpectedly passed or failed for the wrong reason")
		}
		return errors.New("KNOWN_BAD_0042_CHECKER_INPUT")
	}

	if err := migrator.Steps(-1); err != nil {
		return fmt.Errorf("migrate down 0042 failed: %w", err)
	}
	if err := assertMigrationVersion(ctx, target, 41, false); err != nil {
		return err
	}
	if err := executeFixture(ctx, target, configured.repoRoot, "assert_down.sql"); err != nil {
		return err
	}
	if err := migrator.Steps(1); err != nil {
		return fmt.Errorf("second migrate up 0042 failed: %w", err)
	}
	if err := assertMigrationVersion(ctx, target, 42, false); err != nil {
		return err
	}
	if err := executeFixture(ctx, target, configured.repoRoot, "assert_up.sql"); err != nil {
		return err
	}
	if err := executeFixture(ctx, target, configured.repoRoot, "assert_runtime_invariants.sql"); err != nil {
		return err
	}

	if err := migrator.Steps(-1); err != nil {
		return fmt.Errorf("pre-obstruction migrate down failed: %w", err)
	}
	if err := assertMigrationVersion(ctx, target, 41, false); err != nil {
		return err
	}
	if _, err := target.Exec(ctx, "ALTER TABLE execution_mt5_vm_workers ADD COLUMN worker_substrate integer"); err != nil {
		return fmt.Errorf("disposable obstruction creation failed: %w", err)
	}
	obstructionErr := migrator.Steps(1)
	if obstructionErr == nil || !strings.Contains(obstructionErr.Error(), "worker_substrate") || !strings.Contains(obstructionErr.Error(), "already exists") {
		return errors.New("obstructed migration did not fail for the exact expected reason")
	}
	if err := assertMigrationVersion(ctx, target, 42, true); err != nil {
		return err
	}
	if _, err := target.Exec(ctx, "ALTER TABLE execution_mt5_vm_workers DROP COLUMN worker_substrate"); err != nil {
		return fmt.Errorf("disposable obstruction removal failed: %w", err)
	}
	if err := migrator.Force(41); err != nil {
		return fmt.Errorf("migration force 41 failed: %w", err)
	}
	if err := assertMigrationVersion(ctx, target, 41, false); err != nil {
		return err
	}
	if err := migrator.Steps(1); err != nil {
		return fmt.Errorf("recovery migrate up 0042 failed: %w", err)
	}
	if err := assertMigrationVersion(ctx, target, 42, false); err != nil {
		return err
	}
	if err := executeFixture(ctx, target, configured.repoRoot, "assert_up.sql"); err != nil {
		return err
	}

	if configured.runRustManagedTests {
		if err := runRustManagedTests(ctx, configured.repoRoot, targetURL); err != nil {
			return err
		}
	}
	return nil
}

func executeFixture(ctx context.Context, target *pgx.Conn, repoRoot, name string) error {
	path := filepath.Join(repoRoot, "backend", "migrations", "testdata", "0042", name)
	contents, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("migration fixture %s could not be read: %w", name, err)
	}
	if len(contents) == 0 {
		return fmt.Errorf("migration fixture %s is empty", name)
	}
	if _, err := target.Exec(ctx, string(contents)); err != nil {
		return fmt.Errorf("migration fixture %s failed: %w", name, err)
	}
	return nil
}

func assertMigrationVersion(ctx context.Context, target *pgx.Conn, expected uint, dirty bool) error {
	var version uint
	var actualDirty bool
	if err := target.QueryRow(ctx, "SELECT version, dirty FROM schema_migrations").Scan(&version, &actualDirty); err != nil {
		return fmt.Errorf("migration version query failed: %w", err)
	}
	if version != expected || actualDirty != dirty {
		return fmt.Errorf("migration version mismatch: expected %d:%t got %d:%t", expected, dirty, version, actualDirty)
	}
	return nil
}

func runRustManagedTests(ctx context.Context, repoRoot, targetURL string) error {
	executionRoot := filepath.Join(repoRoot, "backend", "execution")
	command := exec.CommandContext(ctx, "cargo.exe",
		"test", "--locked",
		"-p", "execution-gateway", "-p", "mt5-vm-agent",
		"--bin", "execution-gateway",
		"managed_database", "--", "--ignored", "--test-threads=1",
	)
	command.Dir = executionRoot
	command.Env = replaceEnvironment(os.Environ(), "MT5_MANAGED_TEST_DATABASE_URL", targetURL)
	output, err := command.CombinedOutput()
	text := string(output)
	if err != nil {
		return fmt.Errorf("ignored Rust managed-database tests failed: %w: %s", err, tail(text, 12000))
	}
	matched, regexErr := regexp.MatchString(`test result: ok\. [1-9][0-9]* passed; 0 failed;`, text)
	if regexErr != nil || !matched {
		return errors.New("ignored Rust managed-database tests executed no passing test")
	}
	return nil
}

func replaceEnvironment(environment []string, key, value string) []string {
	prefix := key + "="
	result := make([]string, 0, len(environment)+1)
	for _, entry := range environment {
		if !strings.HasPrefix(strings.ToUpper(entry), strings.ToUpper(prefix)) {
			result = append(result, entry)
		}
	}
	return append(result, prefix+value)
}

func tail(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[len(value)-limit:]
}

func toPGX5URL(value string) string {
	for _, prefix := range []string{"postgres://", "postgresql://"} {
		if strings.HasPrefix(value, prefix) {
			return "pgx5://" + strings.TrimPrefix(value, prefix)
		}
	}
	return value
}

func TestRevision8ServiceGate(t *testing.T) {
	if os.Getenv("MT5_R8_EXECUTE") != "1" {
		t.Skip("Revision 8 service sandbox is invoked explicitly by the PowerShell gauntlet")
	}
	arguments := []string{
		"--repo-root", os.Getenv("MT5_R8_REPO_ROOT"),
		"--json-output", os.Getenv("MT5_R8_JSON_OUTPUT"),
	}
	negative := os.Getenv("MT5_R8_NEGATIVE_CONTROL") == "1"
	if negative {
		arguments = append(arguments, "--negative-control")
	}
	if os.Getenv("MT5_R8_RUN_RUST") == "1" {
		arguments = append(arguments, "--run-rust-managed-tests")
	}
	code := realMain(arguments)
	if negative {
		if code == 0 {
			t.Fatal("Revision 8 known-bad database control unexpectedly passed")
		}
		t.Fatal("KNOWN_BAD_0042_CHECKER_INPUT")
	}
	if code != 0 {
		t.Fatalf("Revision 8 service sandbox exited %d", code)
	}
}

func testAdminURL(scheme, username, password, host, database string) string {
	value := &url.URL{
		Scheme:   scheme,
		Host:     host,
		Path:     "/" + database,
		RawQuery: "sslmode=disable",
	}
	if password == "" {
		value.User = url.User(username)
	} else {
		value.User = url.UserPassword(username, password)
	}
	return value.String()
}

func TestParseAdminURLAcceptsOnlyExactLoopbackMaintenanceConnection(t *testing.T) {
	valid := testAdminURL(
		"postgresql", "postgres", "local-secret", "127.0.0.1:5432", "postgres",
	)
	parsed, err := parseAdminURL(valid)
	if err != nil {
		t.Fatalf("parseAdminURL(valid): %v", err)
	}
	if parsed.Hostname() != "127.0.0.1" || parsed.Port() != "5432" || parsed.Path != "/postgres" {
		t.Fatalf("unexpected validated URL shape: host=%q port=%q path=%q", parsed.Hostname(), parsed.Port(), parsed.Path)
	}

	for name, raw := range map[string]string{
		"remote":       testAdminURL("postgresql", "postgres", "secret", "db.example:5432", "postgres"),
		"localhost":    testAdminURL("postgresql", "postgres", "secret", "localhost:5432", "postgres"),
		"wrong port":   testAdminURL("postgresql", "postgres", "secret", "127.0.0.1:55432", "postgres"),
		"wrong role":   testAdminURL("postgresql", "marketlens", "secret", "127.0.0.1:5432", "postgres"),
		"no password":  testAdminURL("postgresql", "postgres", "", "127.0.0.1:5432", "postgres"),
		"wrong db":     testAdminURL("postgresql", "postgres", "secret", "127.0.0.1:5432", "marketlens"),
		"wrong scheme": testAdminURL("https", "postgres", "secret", "127.0.0.1:5432", "postgres"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseAdminURL(raw); err == nil {
				t.Fatalf("parseAdminURL(%s) unexpectedly passed", name)
			}
		})
	}
}

func TestRevision8DatabaseNameAndDropTargetAreExact(t *testing.T) {
	token := "0123456789abcdef0123456789abcdef"
	name, err := revision8DatabaseName(token)
	if err != nil {
		t.Fatalf("revision8DatabaseName(valid): %v", err)
	}
	if name != "marketlens_r8_"+token {
		t.Fatalf("unexpected database name %q", name)
	}
	if err := validateDropTarget(name, "postgres"); err != nil {
		t.Fatalf("validateDropTarget(valid): %v", err)
	}

	for _, unsafe := range []string{
		"postgres",
		"marketlens",
		"marketlens_r8_0123",
		"marketlens_r8_0123456789abcdef0123456789abcdeg",
		"marketlens_r8_0123456789abcdef0123456789abcdef_extra",
	} {
		if err := validateDropTarget(unsafe, "postgres"); err == nil {
			t.Fatalf("unsafe drop target %q unexpectedly passed", unsafe)
		}
	}
	if _, err := revision8DatabaseName("not-a-token"); err == nil {
		t.Fatal("invalid run token unexpectedly passed")
	}
}

func TestTargetURLAndErrorsNeverExposeCredential(t *testing.T) {
	raw := testAdminURL(
		"postgresql", "postgres", "local-secret", "127.0.0.1:5432", "postgres",
	)
	admin, err := parseAdminURL(raw)
	if err != nil {
		t.Fatal(err)
	}
	target, err := targetDatabaseURL(admin, "marketlens_r8_0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sanitizeDiagnostic("connect failed: "+target, admin), "local-secret") {
		t.Fatal("sanitized diagnostic exposed the password")
	}
	if strings.Contains(sanitizeDiagnostic("connect failed: "+target, admin), target) {
		t.Fatal("sanitized diagnostic exposed the full target URL")
	}

	reservedPassword := "p@ss:%/word"
	reservedAdmin := &url.URL{
		Scheme: "postgresql",
		Host:   "127.0.0.1:5432",
		Path:   "/postgres",
		User:   url.UserPassword("postgres", reservedPassword),
	}
	reservedTarget, err := targetDatabaseURL(
		reservedAdmin,
		"marketlens_r8_0123456789abcdef0123456789abcdef",
	)
	if err != nil {
		t.Fatal(err)
	}
	reservedDiagnostic := sanitizeDiagnostic("connect failed: "+reservedTarget, reservedAdmin)
	if strings.Contains(reservedDiagnostic, reservedAdmin.User.String()) {
		t.Fatal("sanitized diagnostic exposed URL-encoded PostgreSQL userinfo")
	}
}
