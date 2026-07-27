
# Remove duplicate consecutive busId/routeId lines within object literals
# The rename of assignedBusId->busId produced lines like:
#   busId: X,
#   routeId: Y,
#   busId: X,   <-- duplicate from renamed assignedBusId
#   routeId: Y, <-- duplicate from renamed assignedRouteId

$srcRoot = "src"
$excludeFiles = @("driver-swap", "missed-bus", "useMissedBus")

$files = Get-ChildItem -Recurse -Include "*.ts","*.tsx" $srcRoot | Where-Object {
    $name = $_.FullName
    $skip = $false
    foreach ($ex in $excludeFiles) { if ($name -match $ex) { $skip = $true; break } }
    -not $skip
}

$count = 0
foreach ($f in $files) {
    $content = [System.IO.File]::ReadAllText($f.FullName)
    $changed = $false
    
    # Remove back-to-back duplicate "busId: ..." lines (within 8 lines of each other)
    # Strategy: find "busId: VALUE\n...stuff...\n        busId: VALUE" and remove second
    
    # Pattern for duplicate busId within 0-3 intervening lines
    $patterns = @(
        # Exact duplicate consecutive lines (same key, any value)
        @{ Regex = '(\s+busId\s*:[^\n]+)\n(\s+routeId\s*:[^\n]+)\n(\s+busId\s*:[^\n]+)\n(\s+routeId\s*:[^\n]+)'; Replace = '$1$2' },
        @{ Regex = '(\s+routeId\s*:[^\n]+)\n(\s+busId\s*:[^\n]+)\n(\s+routeId\s*:[^\n]+)\n(\s+busId\s*:[^\n]+)'; Replace = '$1$2' },
        # busId dup without routeId in between
        @{ Regex = '(\s+busId\s*:[^\n]+)\n(\s+busId\s*:[^\n]+)'; Replace = '$1' },
        # routeId dup without other in between
        @{ Regex = '(\s+routeId\s*:[^\n]+)\n(\s+routeId\s*:[^\n]+)'; Replace = '$1' }
    )

    $newContent = $content
    foreach ($p in $patterns) {
        $replaced = [regex]::Replace($newContent, $p.Regex, $p.Replace)
        if ($replaced -ne $newContent) {
            $newContent = $replaced
            $changed = $true
        }
    }
    
    if ($changed -and $newContent -ne $content) {
        [System.IO.File]::WriteAllText($f.FullName, $newContent, [System.Text.Encoding]::UTF8)
        $count++
        Write-Host "Fixed: $($f.Name)"
    }
}
Write-Host "`nTotal fixed: $count"
