from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
BRIDGE = Path(__file__).resolve().parent
PROCESS_HELPER = BRIDGE / "Mt5VmProcess.ps1"
SAVE_CREDENTIAL = BRIDGE / "Save-MT5VmPhase0Credential.ps1"


@unittest.skipUnless(sys.platform == "win32", "PowerShell contracts are Windows-only")
class PowerShellProcessContractTests(unittest.TestCase):
    def test_shared_helper_round_trips_generated_unicode_json_without_bom(self) -> None:
        rng = random.Random(20260821)
        alphabet = "abcXYZ019 tiếng-Việt 😀 漢字\x00\n\t"
        generated = [
            "".join(rng.choice(alphabet) for _ in range(rng.randrange(0, 80)))
            for _ in range(32)
        ]
        payload = json.dumps(
            {
                "ascii": "strict-json",
                "vietnamese": "tài khoản thử nghiệm",
                "non_bmp": "😀",
                "generated": generated,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )

        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            payload_path = temp_root / "payload.json"
            sink_path = temp_root / "sink.py"
            payload_path.write_text(payload, encoding="utf-8")
            sink_path.write_text(
                "import json, sys\n"
                "raw = sys.stdin.buffer.read()\n"
                "print(json.dumps({\"has_bom\": raw.startswith(b'\\xef\\xbb\\xbf'), "
                "\"decoded\": raw.decode('utf-8')}, separators=(',', ':')))\n",
                encoding="utf-8",
            )

            command = (
                "$ErrorActionPreference='Stop';"
                "[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);"
                ". $env:MT5_PROCESS_HELPER;"
                "$payload=[IO.File]::ReadAllText($env:MT5_PAYLOAD_PATH,"
                "(New-Object Text.UTF8Encoding($false)));"
                "$startInfo=New-Object Diagnostics.ProcessStartInfo;"
                "$startInfo.FileName=$env:MT5_PYTHON;"
                "$startInfo.Arguments='\"'+$env:MT5_SINK+'\"';"
                "$startInfo.UseShellExecute=$false;"
                "$startInfo.CreateNoWindow=$true;"
                "$startInfo.RedirectStandardInput=$true;"
                "$startInfo.RedirectStandardOutput=$true;"
                "$startInfo.RedirectStandardError=$true;"
                "$process=New-Object Diagnostics.Process;"
                "$process.StartInfo=$startInfo;"
                "$beforeEncoding=[Console]::InputEncoding;"
                "$before=[pscustomobject]@{"
                "code_page=$beforeEncoding.CodePage;web_name=$beforeEncoding.WebName;"
                "encoding_name=$beforeEncoding.EncodingName;"
                "preamble=([BitConverter]::ToString($beforeEncoding.GetPreamble()))};"
                "$started=Start-MT5VmProcessWithUtf8NoBomStandardInput "
                "-Process $process;"
                "$afterEncoding=[Console]::InputEncoding;"
                "$after=[pscustomobject]@{"
                "code_page=$afterEncoding.CodePage;web_name=$afterEncoding.WebName;"
                "encoding_name=$afterEncoding.EncodingName;"
                "preamble=([BitConverter]::ToString($afterEncoding.GetPreamble()))};"
                "if(-not $started){throw 'child start failed'};"
                "$process.StandardInput.Write($payload);"
                "$process.StandardInput.Close();"
                "$stdout=$process.StandardOutput.ReadToEnd();"
                "$stderr=$process.StandardError.ReadToEnd();"
                "$process.WaitForExit();"
                "if($process.ExitCode -ne 0){throw $stderr};"
                "$child=$stdout|ConvertFrom-Json;"
                "[pscustomobject]@{before=$before;after=$after;child=$child}|"
                "ConvertTo-Json -Compress -Depth 5"
            )
            completed = subprocess.run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    command,
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
                env={
                    **os.environ,
                    "MT5_PROCESS_HELPER": str(PROCESS_HELPER),
                    "MT5_PAYLOAD_PATH": str(payload_path),
                    "MT5_PYTHON": sys.executable,
                    "MT5_SINK": str(sink_path),
                },
            )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(observed["before"], observed["after"])
        self.assertFalse(observed["child"]["has_bom"])
        self.assertEqual(payload, observed["child"]["decoded"])

    def test_shared_helper_restores_input_encoding_when_start_throws(self) -> None:
        command = (
            "$ErrorActionPreference='Stop';"
            ". $env:MT5_PROCESS_HELPER;"
            "$null=Get-Command Start-MT5VmProcessWithUtf8NoBomStandardInput "
            "-ErrorAction Stop;"
            "$startInfo=New-Object Diagnostics.ProcessStartInfo;"
            "$startInfo.FileName='Z:\\missing-mt5-vm-child.exe';"
            "$startInfo.UseShellExecute=$false;"
            "$startInfo.RedirectStandardInput=$true;"
            "$process=New-Object Diagnostics.Process;"
            "$process.StartInfo=$startInfo;"
            "$beforeEncoding=[Console]::InputEncoding;"
            "$before=[pscustomobject]@{"
            "code_page=$beforeEncoding.CodePage;web_name=$beforeEncoding.WebName;"
            "encoding_name=$beforeEncoding.EncodingName;"
            "preamble=([BitConverter]::ToString($beforeEncoding.GetPreamble()))};"
            "$caught=@();"
            "try {"
            "$null=Start-MT5VmProcessWithUtf8NoBomStandardInput -Process $process"
            "} catch {"
            "$candidate=$_.Exception;"
            "while($null -ne $candidate){"
            "$caught+=,$candidate.GetType().FullName;"
            "$candidate=$candidate.InnerException}};"
            "$afterEncoding=[Console]::InputEncoding;"
            "$after=[pscustomobject]@{"
            "code_page=$afterEncoding.CodePage;web_name=$afterEncoding.WebName;"
            "encoding_name=$afterEncoding.EncodingName;"
            "preamble=([BitConverter]::ToString($afterEncoding.GetPreamble()))};"
            "[pscustomobject]@{caught=$caught;before=$before;after=$after}|"
            "ConvertTo-Json -Compress"
        )
        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
            env={**os.environ, "MT5_PROCESS_HELPER": str(PROCESS_HELPER)},
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertIn("System.ComponentModel.Win32Exception", observed["caught"])
        self.assertEqual(observed["before"], observed["after"])

    def test_every_redirected_stdin_launch_uses_helper_before_start(self) -> None:
        expected_sites = {
            "Invoke-MT5VmPhase0.ps1": 1,
            "Invoke-MT5VmPhase1.ps1": 2,
            "Invoke-MT5VmPhase1TwoAccount.ps1": 1,
        }
        observed_sites = 0
        for name, expected_count in expected_sites.items():
            lines = (BRIDGE / name).read_text(encoding="utf-8").splitlines()
            redirect_lines = [
                index
                for index, line in enumerate(lines)
                if "$startInfo.RedirectStandardInput = $true" in line
            ]
            self.assertEqual(expected_count, len(redirect_lines), name)
            observed_sites += len(redirect_lines)
            for redirect_line in redirect_lines:
                try:
                    write_line = next(
                        index
                        for index in range(redirect_line + 1, len(lines))
                        if "$process.StandardInput.Write" in lines[index]
                    )
                except StopIteration as error:
                    self.fail(f"{name}:{redirect_line + 1} has no stdin write: {error}")
                launch_block = "\n".join(lines[redirect_line : write_line + 1])
                self.assertIn(
                    "Start-MT5VmProcessWithUtf8NoBomStandardInput -Process $process",
                    launch_block,
                    f"{name}:{redirect_line + 1} does not configure no-BOM stdin",
                )
                self.assertNotIn("$process.Start()", launch_block, name)
        self.assertEqual(4, observed_sites)


@unittest.skipUnless(sys.platform == "win32", "Credential ACL contracts are Windows-only")
class CredentialAclContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.credential_root = Path(os.environ["LOCALAPPDATA"]) / "MarketLens"
        self.alias = f"acl-test-{uuid.uuid4().hex[:12]}"
        self.credential_path = (
            self.credential_root / f"mt5-vm-phase0-{self.alias}.dpapi.json"
        )

    def tearDown(self) -> None:
        expected_parent = self.credential_root.resolve()
        self.assertEqual(expected_parent, self.credential_path.parent.resolve())
        if self.credential_path.exists():
            self.credential_path.unlink()

    def _run_save(self, set_acl_override: str = "") -> subprocess.CompletedProcess[str]:
        command = (
            "function global:Read-Host {"
            "param([Parameter(Position=0)][string]$Prompt,[switch]$AsSecureString);"
            "if(-not $AsSecureString){throw 'fixture requires a secure prompt'};"
            "ConvertTo-SecureString 'fixture-only-password' -AsPlainText -Force};"
            f"{set_acl_override}"
            "& $env:MT5_SAVE_CREDENTIAL -AccountAlias $env:MT5_TEST_ALIAS "
            "-Login 12345678 -Server 'Fixture-Demo' "
            "-CredentialPath $env:MT5_TEST_CREDENTIAL_PATH"
        )
        return subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
            env={
                **os.environ,
                "MT5_SAVE_CREDENTIAL": str(SAVE_CREDENTIAL),
                "MT5_TEST_ALIAS": self.alias,
                "MT5_TEST_CREDENTIAL_PATH": str(self.credential_path),
            },
        )

    def _run_prompt_save(
        self,
        *,
        login: str = "12345678",
        server: str = "Fixture-Demo",
        demo_confirmation: str = "DEMO",
    ) -> subprocess.CompletedProcess[str]:
        command = (
            "$global:fixtureLogin=" + json.dumps(login) + ";"
            "$global:fixtureServer=" + json.dumps(server) + ";"
            "$global:fixtureDemo=" + json.dumps(demo_confirmation) + ";"
            "function global:Read-Host {"
            "param([Parameter(Position=0)][string]$Prompt,[switch]$AsSecureString);"
            "if($AsSecureString){"
            "return ConvertTo-SecureString 'fixture-only-password' -AsPlainText -Force};"
            "switch -Exact ($Prompt){"
            "'Enter the disposable MT5 demo login' {return $global:fixtureLogin};"
            "'Enter the exact MT5 server' {return $global:fixtureServer};"
            "'Type DEMO to confirm this is a disposable demo account' {"
            "return $global:fixtureDemo};"
            "default {throw ('unexpected prompt: '+$Prompt)}}};"
            "& $env:MT5_SAVE_CREDENTIAL -AccountAlias $env:MT5_TEST_ALIAS "
            "-PromptForIdentity -CredentialPath $env:MT5_TEST_CREDENTIAL_PATH"
        )
        return subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
            env={
                **os.environ,
                "MT5_SAVE_CREDENTIAL": str(SAVE_CREDENTIAL),
                "MT5_TEST_ALIAS": self.alias,
                "MT5_TEST_CREDENTIAL_PATH": str(self.credential_path),
            },
        )

    def _read_decrypted_payload(self) -> dict[str, object]:
        command = (
            "$outer=Get-Content -LiteralPath $env:MT5_TEST_CREDENTIAL_PATH -Raw|"
            "ConvertFrom-Json;"
            "$secure=ConvertTo-SecureString -String $outer.encrypted_payload;"
            "$pointer=[IntPtr]::Zero;try{"
            "$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);"
            "$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer);"
            "$plain}finally{if($pointer -ne [IntPtr]::Zero){"
            "[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}}"
        )
        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                command,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
            env={**os.environ, "MT5_TEST_CREDENTIAL_PATH": str(self.credential_path)},
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        return json.loads(completed.stdout)

    def _read_acl(self) -> dict[str, object]:
        command = (
            "$acl=Get-Acl -LiteralPath $env:MT5_TEST_CREDENTIAL_PATH;"
            "$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;"
            "$owner=([Security.Principal.NTAccount]$acl.Owner).Translate("
            "[Security.Principal.SecurityIdentifier]).Value;"
            "$rules=@($acl.Access|ForEach-Object{"
            "$sid=$_.IdentityReference.Translate("
            "[Security.Principal.SecurityIdentifier]).Value;"
            "[pscustomobject]@{sid=$sid;rights=$_.FileSystemRights.ToString();"
            "type=$_.AccessControlType.ToString();inherited=$_.IsInherited}});"
            "[pscustomobject]@{current_sid=$current;owner_sid=$owner;"
            "protected=$acl.AreAccessRulesProtected;rules=$rules}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                command,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
            env={
                **os.environ,
                "MT5_TEST_CREDENTIAL_PATH": str(self.credential_path),
            },
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        return json.loads(completed.stdout)

    def test_save_succeeds_only_with_exact_acl_postcondition(self) -> None:
        completed = self._run_save()

        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertIn("Saved DPAPI-protected disposable demo credential.", completed.stdout)
        self.assertNotIn("fixture-only-password", completed.stdout + completed.stderr)
        acl = self._read_acl()
        self.assertEqual(acl["current_sid"], acl["owner_sid"])
        self.assertTrue(acl["protected"])
        self.assertEqual(
            [
                {
                    "sid": "S-1-5-18",
                    "rights": "FullControl",
                    "type": "Allow",
                    "inherited": False,
                },
                {
                    "sid": acl["current_sid"],
                    "rights": "FullControl",
                    "type": "Allow",
                    "inherited": False,
                },
            ],
            sorted(acl["rules"], key=lambda rule: str(rule["sid"])),
        )

    def test_prompt_identity_mode_keeps_identity_out_of_invocation_and_output(self) -> None:
        completed = self._run_prompt_save()

        self.assertEqual(0, completed.returncode, completed.stderr)
        invocation = str(completed.args[-1])
        self.assertNotIn("-Login ", invocation)
        self.assertNotIn("-Server ", invocation)
        output = completed.stdout + completed.stderr
        for secret in ("12345678", "Fixture-Demo", "fixture-only-password"):
            self.assertNotIn(secret, output)
        self.assertEqual(
            {
                "schema_version": 1,
                "login": "12345678",
                "server": "Fixture-Demo",
                "password": "fixture-only-password",
            },
            self._read_decrypted_payload(),
        )

    def test_prompt_identity_mode_rejects_non_demo_confirmation_before_write(self) -> None:
        completed = self._run_prompt_save(demo_confirmation="LIVE")

        self.assertNotEqual(0, completed.returncode)
        self.assertFalse(self.credential_path.exists())
        self.assertNotIn("Saved DPAPI-protected", completed.stdout)

    def test_prompt_identity_mode_rejects_invalid_login_before_write(self) -> None:
        completed = self._run_prompt_save(login="not-a-login")

        self.assertNotEqual(0, completed.returncode)
        self.assertFalse(self.credential_path.exists())
        self.assertNotIn("Saved DPAPI-protected", completed.stdout)

    def test_non_privilege_acl_error_fails_closed(self) -> None:
        completed = self._run_save(
            "function global:Set-Acl {"
            "param([string]$LiteralPath,[object]$AclObject);"
            "throw [UnauthorizedAccessException]::new('simulated non-privilege failure')};"
        )

        self.assertNotEqual(0, completed.returncode)
        self.assertNotIn("Saved DPAPI-protected", completed.stdout)

    def test_non_privilege_error_after_exact_acl_still_fails_closed(self) -> None:
        completed = self._run_save(
            "function global:Set-Acl {"
            "param([string]$LiteralPath,[object]$AclObject);"
            "Microsoft.PowerShell.Security\\Set-Acl "
            "-LiteralPath $LiteralPath -AclObject $AclObject;"
            "throw [UnauthorizedAccessException]::new("
            "'simulated non-privilege failure after applying ACL')};"
        )

        self.assertNotEqual(0, completed.returncode)
        self.assertNotIn("Saved DPAPI-protected", completed.stdout)

    def test_privilege_error_after_exact_acl_is_verified_and_accepted(self) -> None:
        completed = self._run_save(
            "function global:Set-Acl {"
            "param([string]$LiteralPath,[object]$AclObject);"
            "Microsoft.PowerShell.Security\\Set-Acl "
            "-LiteralPath $LiteralPath -AclObject $AclObject;"
            "throw [Security.AccessControl.PrivilegeNotHeldException]::new("
            "'simulated privilege failure after applying ACL')};"
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertIn("Saved DPAPI-protected disposable demo credential.", completed.stdout)
        acl = self._read_acl()
        self.assertEqual(acl["current_sid"], acl["owner_sid"])
        self.assertTrue(acl["protected"])
        self.assertEqual(2, len(acl["rules"]))

    def test_privilege_error_without_exact_acl_fails_closed(self) -> None:
        completed = self._run_save(
            "function global:Set-Acl {"
            "param([string]$LiteralPath,[object]$AclObject);"
            "throw [Security.AccessControl.PrivilegeNotHeldException]::new("
            "'simulated privilege failure before applying ACL')};"
        )

        self.assertNotEqual(0, completed.returncode)
        self.assertNotIn("Saved DPAPI-protected", completed.stdout)


if __name__ == "__main__":
    unittest.main()
