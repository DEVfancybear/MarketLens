from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
CONNECTIONS = ROOT / "backend" / "execution" / "crates" / "execution-gateway" / "src" / "mt5_vm_connections.rs"
GATEWAY = ROOT / "backend" / "execution" / "crates" / "execution-gateway" / "src" / "main.rs"
MANAGED = ROOT / "backend" / "execution" / "crates" / "mt5-vm-agent" / "src" / "managed.rs"
PROCESS = ROOT / "backend" / "execution" / "crates" / "mt5-vm-agent" / "src" / "process.rs"
GO_CONNECTOR = ROOT / "backend" / "internal" / "execution" / "mt5_connector_handler.go"
GO_HANDLER = ROOT / "backend" / "internal" / "execution" / "handler.go"
GO_PHASE3_HARNESS = ROOT / "backend" / "cmd" / "mt5-phase3-harness" / "main.go"
GO_API = ROOT / "backend" / "cmd" / "api" / "main.go"
GO_CREDENTIAL = ROOT / "backend" / "internal" / "mt5credentials" / "wincred_windows.go"
GO_WINDOWS_STORE = ROOT / "backend" / "internal" / "mt5credentials" / "store_windows.go"
PRODUCTION_RUNNER = ROOT / "run-backend-production.ps1"
PRODUCTION_BUILD = ROOT / "build-production.ps1"
BACKEND_DEPLOY = ROOT / "tools" / "deploy-backend.ps1"
BACKEND_DEPLOY_VERIFY = ROOT / "tools" / "verify-backend-deploy.ps1"
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
BACKEND_ENV_EXAMPLE = ROOT / "backend" / ".env.example"
ROOT_ENV_EXAMPLE = ROOT / ".env.example"


class ManagedSafetySourceContracts(unittest.TestCase):
    def test_every_production_build_path_supplies_the_managed_worker_binary(self) -> None:
        workflow = CI_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            "cargo build --release --locked -p execution-gateway -p mt5-vm-agent",
            workflow,
        )
        self.assertIn(
            "Copy-Item execution/target/release/mt5-vm-agent.exe stage/bin/ -Force",
            workflow,
        )
        self.assertIn("'mt5-vm-agent.exe'", workflow)

        build = PRODUCTION_BUILD.read_text(encoding="utf-8")
        self.assertIn(
            '$builtAgent = Join-Path $backendDir "execution\\target\\release\\mt5-vm-agent.exe"',
            build,
        )
        self.assertIn("Test-Path -LiteralPath $builtAgent -PathType Leaf", build)

        deploy = BACKEND_DEPLOY.read_text(encoding="utf-8")
        self.assertIn('"mt5-vm-agent.exe"', deploy)
        verifier = BACKEND_DEPLOY_VERIFY.read_text(encoding="utf-8")
        self.assertIn("'mt5-vm-agent.exe'", verifier)
        self.assertIn("expected 6 packaged files", verifier)

    def test_deploy_verifier_allows_only_runner_security_wiring_not_worker_lifecycle(self) -> None:
        verifier = BACKEND_DEPLOY_VERIFY.read_text(encoding="utf-8")
        self.assertNotIn(
            "run-backend-production.ps1 was modified; the deploy path must delegate to it unchanged.",
            verifier,
        )
        self.assertIn("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", verifier)
        self.assertIn("unapproved managed-worker lifecycle in production runner", verifier)
        self.assertIn("runner security wiring valid; worker lifecycle remains separate", verifier)

    def test_environment_templates_use_local_windows_credential_manager(self) -> None:
        backend = BACKEND_ENV_EXAMPLE.read_text(encoding="utf-8")
        root = ROOT_ENV_EXAMPLE.read_text(encoding="utf-8")
        for source in (backend, root):
            self.assertEqual(1, source.count("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE="))
            self.assertNotIn("MT5_VAULT_", source)
            self.assertIn("Windows Credential Manager", source)

    def test_managed_connector_requires_a_successful_credential_store_probe(self) -> None:
        source = GO_HANDLER.read_text(encoding="utf-8")
        probe = "storeErr = store.Probe(probeContext)"
        reject = (
            "if storeErr != nil {\n"
            "\t\treturn errManagedMT5CredentialStoreUnavailable"
        )
        wire = "handler.WithMT5CredentialStore(store, identitySecret)"
        enable = "capability.EnableMT5Connector()"
        for value in (probe, reject, wire, enable):
            self.assertEqual(1, source.count(value))
        self.assertLess(source.index(probe), source.index(reject))
        self.assertLess(source.index(reject), source.index(wire))
        self.assertLess(source.index(wire), source.index(enable))

    def test_windows_credential_store_uses_only_local_wincred_apis(self) -> None:
        native = GO_CREDENTIAL.read_text(encoding="utf-8")
        store = GO_WINDOWS_STORE.read_text(encoding="utf-8")
        for api in ("CredWriteW", "CredReadW", "CredDeleteW", "CredEnumerateW"):
            self.assertEqual(1, native.count(api))
        self.assertIn('"MarketLens:MT5:"', store)
        self.assertIn('"MarketLens:MT5:test:"', store)
        self.assertFalse((ROOT / "backend" / "internal" / "mt5vault").exists())
        for source in (GO_API, GO_PHASE3_HARNESS, GO_CONNECTOR):
            self.assertNotIn("internal/mt5vault", source.read_text(encoding="utf-8"))

    def test_deploy_preflights_identity_key_before_artifact_or_migration_mutation(self) -> None:
        source = BACKEND_DEPLOY.read_text(encoding="utf-8")
        read_key = (
            '$identityKeyFile = Get-BackendEnvValue -Name '
            '"EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE" -EnvFilePath $backendEnv'
        )
        self.assertEqual(1, source.count(read_key))
        self.assertIn("identity HMAC key file must be an absolute path", source)
        self.assertIn("identity HMAC key file must be a small non-link file", source)
        self.assertLess(source.index(read_key), source.index("# --- Acquire"))
        self.assertLess(source.index(read_key), source.index("# --- Migrate"))

    def test_production_runner_exports_the_stable_identity_key_file(self) -> None:
        source = PRODUCTION_RUNNER.read_text(encoding="utf-8")
        read_key = (
            '$executionMt5IdentityHmacKeyFile = Get-BackendEnvValue '
            '"EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE"'
        )
        export_key = (
            '$env:EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE = '
            '$executionMt5IdentityHmacKeyFile'
        )
        self.assertEqual(1, source.count(read_key))
        self.assertEqual(1, source.count(export_key))
        self.assertLess(source.index(read_key), source.index(export_key))
        self.assertLess(source.index(export_key), source.index("Starting production Rust execution gateway"))

    def test_phase3_harness_uses_an_independent_identity_key_file(self) -> None:
        source = GO_PHASE3_HARNESS.read_text(encoding="utf-8")
        self.assertIn("MT5IdentityHMACKeyFile", source)
        self.assertIn("readConfigWithEnvironment(reader, os.Setenv)", source)
        self.assertIn(
            'setEnvironment("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", cfg.MT5IdentityHMACKeyFile)', source
        )
        handler_source = GO_HANDLER.read_text(encoding="utf-8")
        self.assertIn("ReadMT5IdentityHMACKey", handler_source)
        self.assertNotIn("identitySecret := adminToken", source)

    def test_connect_uses_authenticated_owner(self) -> None:
        source = GO_CONNECTOR.read_text(encoding="utf-8")
        self.assertEqual(1, source.count("ownerID := authenticatedUserID(c)"))
        self.assertIn(
            "OwnerID: ownerID, AccountID: accountID, Label: strings.TrimSpace(request.Label),",
            source,
        )

    def test_password_does_not_cross_the_gateway_boundary(self) -> None:
        source = GO_CONNECTOR.read_text(encoding="utf-8")
        safe_reservation = (
            "OwnerID: ownerID, AccountID: accountID, Label: strings.TrimSpace(request.Label),"
        )
        self.assertEqual(1, source.count(safe_reservation))
        self.assertNotIn("OwnerID: credential.Password", source)

    def test_credential_grant_requires_issued_state(self) -> None:
        source = CONNECTIONS.read_text(encoding="utf-8").split("#[cfg(test)]\nmod tests", 1)[0]
        self.assertEqual(1, source.count("credential_grant.status = 'issued'"))
        self.assertIn("SET status = 'consumed', consumed_at = now()", source)

    def test_slot_assignment_requires_matching_lease_generation(self) -> None:
        source = MANAGED.read_text(encoding="utf-8")
        self.assertEqual(1, source.count("assignment.lease_generation == lease_generation"))

    def test_bootstrap_pipe_requires_exact_pid_and_path(self) -> None:
        source = PROCESS.read_text(encoding="utf-8").split("#[cfg(test)]\nmod tests", 1)[0]
        self.assertEqual(
            1,
            source.count(
                "client_pid != 0 && client_pid == expected_terminal_pid && process_path_matches"
            ),
        )
        pid_check = source.index(
            "bootstrap_client_is_authorized(client_pid, expected_terminal_pid, client_path_matches)"
        )
        pid_enforcement = source.index(
            "ensure_driver_condition(client_authorized, EA_BOOTSTRAP_CLIENT_REJECTED)"
        )
        self.assertLess(pid_check, pid_enforcement)
        self.assertLess(pid_enforcement, source.index("WriteFile("))

    def test_dirty_runtime_cleanup_precedes_slot_release(self) -> None:
        source = PROCESS.read_text(encoding="utf-8")
        start = source.index(
            "    fn stop(&mut self, account_id: &str, lease_generation: u64) -> Result<(), DriverError> {"
        )
        end = source.index("\n}\n\nfn wait_for_terminal_exit", start)
        source = source[start:end]
        cleanup = "cleanup_runtime_assignment(&self.config, account_id, &runtime.layout)?;"
        release = "self.runtimes.remove(account_id);"
        self.assertEqual(1, source.count(cleanup))
        self.assertLess(source.index(cleanup), source.index(release))

    def test_unknown_delivery_outcome_is_not_expired_or_resent(self) -> None:
        source = GATEWAY.read_text(encoding="utf-8").split("#[cfg(test)]\nmod tests", 1)[0]
        predicate = "reject_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'"
        self.assertEqual(
            3,
            source.count(predicate),
        )
        expiry = source[source.index("WITH expired AS (") : source.index("audited AS (", source.index("WITH expired AS ("))]
        delivery = source[source.rindex("WITH candidates AS (") : source.index("FOR UPDATE SKIP LOCKED", source.rindex("WITH candidates AS ("))]
        self.assertEqual(2, expiry.count(predicate))
        self.assertEqual(1, delivery.count(predicate))


if __name__ == "__main__":
    unittest.main()
