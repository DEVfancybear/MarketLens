from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
GATE = REPOSITORY_ROOT / "tools" / "verify-migration-0042-disposable.ps1"
SQL_ROOT = Path(__file__).resolve().parent / "testdata" / "0042"


class Migration0042DisposableGateContractTests(unittest.TestCase):
    def test_revision_9_imports_only_the_dpapi_credential_file_and_zeros_plaintext(self) -> None:
        source = GATE.read_text(encoding="utf-8")
        service_prelude = source.split("function Get-Revision8ServiceSandbox", 1)[1].split(
            "function Invoke-Revision8ServiceSandbox", 1
        )[0]
        for required in (
            "MT5_R9_POSTGRES_CREDENTIAL_FILE",
            "Import-Clixml",
            "Assert-Revision9CredentialFile",
            "Assert-Revision9CredentialAcl",
            "SecureStringToBSTR",
            "ZeroFreeBSTR",
            "$escapedPassword = [Uri]::EscapeDataString($password)",
            "credential-*.clixml",
        ):
            with self.subTest(required=required):
                self.assertIn(required, service_prelude)
        for forbidden in (
            "backendRoot",
            "environmentPath",
            "databaseLines",
            "sourceUri",
            "DATABASE_URL",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, service_prelude)

        validator = source.split("function Assert-Revision9CredentialFile", 1)[1].split(
            "try {", 1
        )[0]
        for required in (
            "^credential-[0-9a-f]{32}\\.clixml$",
            "AreAccessRulesProtected",
            "GetOwner([Security.Principal.SecurityIdentifier])",
            "S-1-5-18",
            "AccessControlType",
            "FileSystemRights",
            "IsInherited",
            '<SS N="Password">',
        ):
            with self.subTest(required=required):
                self.assertIn(required, validator)

    def test_revision_8_service_sandbox_never_launches_postgres_clients(self) -> None:
        source = GATE.read_text(encoding="utf-8")
        self.assertIn("[switch]$UseExistingLoopbackService", source)
        self.assertIn("postgresql-x64-17", source)
        self.assertIn("MT5_R8_POSTGRES_ADMIN_URL", source)
        self.assertIn("MT5_R8_RUN_TOKEN", source)
        self.assertIn("./cmd/mt5-migration-gate", source)
        self.assertIn("SERVICE_SANDBOX_DATABASE_ABSENT=PASS", source)

        service_block = source.split("if ($UseExistingLoopbackService)", 1)[1].split(
            "LEGACY_DISPOSABLE_CLUSTER", 1
        )[0]
        for forbidden in (
            "postgres.exe",
            "initdb.exe",
            "pg_ctl.exe",
            "pg_isready.exe",
            "psql.exe",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, service_block)

    def test_gate_is_loopback_only_local_and_fail_closed(self) -> None:
        self.assertTrue(GATE.is_file(), f"missing disposable migration gate: {GATE}")
        source = GATE.read_text(encoding="utf-8")

        for required in (
            r"PostgreSQL\17\bin",
            "127.0.0.1",
            "New-LoopbackPort",
            ".artifacts",
            "${databaseName}?sslmode=disable",
            "System.Diagnostics.ProcessStartInfo",
            "WorkingDirectory = (Get-Location).ProviderPath",
            "ReadToEndAsync",
            "WaitForExit",
            "native output:",
            "Assert-MigrationVersion",
            "Invoke-MigrationExpectedFailure",
            "NegativeControl",
            "up",
            "down",
            "force",
        ):
            self.assertIn(required, source)

        for forbidden in (
            "Invoke-WebRequest",
            "curl.exe",
            "get.enterprisedb.com",
            "MT5_PHASE4_DATABASE_URL",
            "AllowProduction",
            "@(& $File",
        ):
            self.assertNotIn(forbidden, source)

    def test_gate_can_run_the_ignored_rust_database_suite_inside_the_same_cluster(self) -> None:
        source = GATE.read_text(encoding="utf-8")
        self.assertIn("[switch]$RunRustManagedTests", source)
        self.assertIn("MT5_MANAGED_TEST_DATABASE_URL", source)
        self.assertIn("rust-managed-database-tests", source)
        self.assertIn("RUST_MANAGED_DATABASE_TESTS=PASS", source)

    def test_sql_assertions_cover_the_revision_15_database_invariants(self) -> None:
        expected = {
            "seed_pre_up.sql": (
                "broker-a.example",
                "execution_mt5_vm_account_state",
            ),
            "assert_up.sql": (
                "credentials_required",
                "execution_mt5_vm_accounts_active_identity_idx",
                "pending_reserved_at",
                "disconnect_requested_revision",
                "execution_fence_mt5_managed_disconnect",
                "normalized_server = ''",
                "observed_server = ''",
            ),
            "assert_down.sql": (
                "normalized_server = 'redacted'",
                "observed_server = 'redacted'",
                "worker_substrate",
            ),
            "assert_runtime_invariants.sql": (
                "execution_mt5_vm_credential_grants",
                "execution_advance_mt5_managed_readiness",
                "last_poll_at",
                "DELIVERY_OUTCOME_UNKNOWN",
                "first_consume_count",
                "second_consume_count",
            ),
        }

        for name, required in expected.items():
            path = SQL_ROOT / name
            self.assertTrue(path.is_file(), f"missing migration fixture: {path}")
            source = path.read_text(encoding="utf-8")
            for token in required:
                self.assertIn(token, source, f"{name} must exercise {token}")

        migration = (REPOSITORY_ROOT / "backend" / "migrations" / "0042_mt5_managed_ea_bootstrap.up.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE FUNCTION execution_advance_mt5_managed_readiness", migration)


if __name__ == "__main__":
    unittest.main()
