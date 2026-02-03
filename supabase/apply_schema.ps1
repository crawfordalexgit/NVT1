$u = $env:BASE_DB_URL
# Load variables from .env.local if present and env vars not already set
if (Test-Path '.env.local') {
  Get-Content '.env.local' | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#')) {
      $parts = $line -split '=',2
      if ($parts.Count -eq 2) {
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if (-not [System.Environment]::GetEnvironmentVariable($name, 'Process')) {
          [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
      }
    }
  }
}

$u = $env:BASE_DB_URL
if (-not $u) {
  Write-Error "BASE_DB_URL is not set in environment or .env.local. Aborting."
  exit 2
}

if ($u -match '\/\/[^:]+:([^@]+)@') {
  $env:PGPASSWORD = $matches[1]
}

$psql = 'C:\Program Files\PostgreSQL\16\bin\psql.exe'
if (-not (Test-Path $psql)) {
  Write-Error "psql not found at $psql"
  exit 3
}

try {
  # Parse BASE_DB_URL into components for reliable psql invocation
  $tmp = $env:BASE_DB_URL -replace '^postgresql:', 'http:'
  $uri = [System.Uri]$tmp
  $pgHost = $uri.Host
  $pgPort = $uri.Port
  $userinfo = $uri.UserInfo -split ':'
  $pgUser = $userinfo[0]
  $pgPass = if ($userinfo.Count -gt 1) { $userinfo[1] } else { '' }
  $pgDb = $uri.AbsolutePath.TrimStart('/')

  if ($pgPass) { $env:PGPASSWORD = $pgPass }

  Write-Output "Applying schema to ${pgHost}:${pgPort}/${pgDb} as user ${pgUser}"
  & $psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -f supabase/schema.sql -v ON_ERROR_STOP=1

  Write-Output "Verifying tables"
  & $psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('snapshot_runs','snapshot_entries','top50_rankings','swimmer_personal_bests','report_cache');"
  & $psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -c "SELECT count(*) FROM snapshot_runs;"
} catch {
  Write-Error "Schema application failed: $_"
  exit 4
}

Write-Output "Done"
