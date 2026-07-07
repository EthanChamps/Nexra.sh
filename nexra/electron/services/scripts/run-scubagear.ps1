param(
  [string]$Tenant,
  # 'interactive' (primary): the operator signs in with the account the client
  # provided for the engagement — ScubaGear prompts once and drives the
  # per-product connections. 'app' (fallback): app-only certificate / service
  # principal, fully unattended, creds from the injected child env.
  [ValidateSet('interactive', 'app')]
  [string]$Auth = 'interactive'
)
$ErrorActionPreference = 'Stop'

# Prerequisite check — exit 3 (UNAVAILABLE_EXIT_CODE) so the app reports
# 'unavailable' with an install hint rather than a false-green success.
if (-not (Get-Module -ListAvailable -Name ScubaGear)) {
  [Console]::Error.WriteLine('ScubaGear module not installed. Install-Module ScubaGear -Scope CurrentUser')
  exit 3
}

try {
  # Everything below runs inside the try so ANY failure — a module-load error,
  # a bad param, a run failure, an auth failure, or empty results — routes
  # through exit 3 rather than pwsh's default exit 1, which runSkill would map
  # to a false-green success. The stderr line is streamed to the operator.
  Import-Module ScubaGear
  $out = Join-Path ([System.IO.Path]::GetTempPath()) ("scuba-" + [System.Guid]::NewGuid().ToString('N'))

  if ($Auth -eq 'app') {
    # App-only certificate auth (fallback). On Windows a thumbprint against the
    # cert store works; cross-platform uses a PFX-backed certificate object
    # (Task 7). Invoke-SCuBA drives the connection from these parameters.
    $appId = $env:M365_APP_ID
    $cert  = $env:M365_CERT   # thumbprint (Windows store) or PFX path
    Invoke-SCuBA -ProductNames '*' -OrganizationName $Tenant -AppID $appId `
      -CertificateThumbprint $cert -OutPath $out -Quiet | Out-Null
  } else {
    # Interactive delegated auth (primary). Omitting the app-only parameters
    # makes ScubaGear prompt the operator to sign in with the client-provided
    # account; one sign-in drives the per-product connections. No app
    # registration or certificate is required — this matches how M365 audits
    # actually start (the client hands over an account, not a service principal).
    Invoke-SCuBA -ProductNames '*' -OutPath $out -Quiet | Out-Null
  }

  $results = Get-ChildItem -Path $out -Recurse -Filter 'ScubaResults*.json' | Select-Object -First 1
  if (-not $results) {
    [Console]::Error.WriteLine('ScubaGear run failed or produced no results')
    exit 3
  }

  $data = Get-Content $results.FullName -Raw | ConvertFrom-Json
  Write-Output "SCUBA_RESULTS_PATH=$($results.FullName)"
  Write-Output ($data.Summary | ConvertTo-Json -Depth 6 -Compress)
} catch {
  [Console]::Error.WriteLine("ScubaGear run failed: $($_.Exception.Message)")
  exit 3
}
