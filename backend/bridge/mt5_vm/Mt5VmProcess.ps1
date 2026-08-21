function Start-MT5VmProcessWithUtf8NoBomStandardInput {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [System.Diagnostics.Process]$Process
  )

  if (-not $Process.StartInfo.RedirectStandardInput) {
    throw 'RedirectStandardInput must be enabled before configuring its encoding.'
  }

  $previousInputEncoding = [Console]::InputEncoding
  try {
    [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
    return $Process.Start()
  } finally {
    [Console]::InputEncoding = $previousInputEncoding
  }
}
