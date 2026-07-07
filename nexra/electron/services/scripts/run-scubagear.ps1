param([string]$Tenant)
$ErrorActionPreference = 'Stop'

# Prerequisite check — exit 3 (UNAVAILABLE_EXIT_CODE) so the app reports
# 'unavailable' with an install hint rather than a false-green success.
if (-not (Get-Module -ListAvailable -Name ScubaGear)) {
  [Console]::Error.WriteLine('ScubaGear module not installed. Install-Module ScubaGear -Scope CurrentUser')
  exit 3
}

$appId    = $env:M365_APP_ID
$cert     = $env:M365_CERT   # thumbprint (Windows store) or PFX path — resolved by the Task 7 spike

Import-Module ScubaGear
$out = Join-Path ([System.IO.Path]::GetTempPath()) ("scuba-" + [System.Guid]::NewGuid().ToString('N'))

try {
  # App-only certificate auth. On Windows a thumbprint against the cert store works;
  # cross-platform uses a PFX-backed certificate object (Task 7). Invoke-SCuBA drives
  # the connection from these parameters.
  Invoke-SCuBA -ProductNames '*' -OrganizationName $Tenant -AppID $appId `
    -CertificateThumbprint $cert -OutPath $out -Quiet | Out-Null

  $results = Get-ChildItem -Path $out -Recurse -Filter 'ScubaResults*.json' | Select-Object -First 1
  if (-not $results) {
    [Console]::Error.WriteLine('ScubaGear run failed or produced no results')
    exit 3
  }

  $data = Get-Content $results.FullName -Raw | ConvertFrom-Json
  Write-Output "SCUBA_RESULTS_PATH=$($results.FullName)"
  Write-Output ($data.Summary | ConvertTo-Json -Depth 6 -Compress)
} catch {
  [Console]::Error.WriteLine('ScubaGear run failed or produced no results')
  exit 3
}
