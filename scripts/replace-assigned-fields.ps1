$srcRoot = "src"
$excludeFiles = @("driver-swap", "missed-bus", "useMissedBus")

# Ordered replacements — most specific first
$patterns = @(
    # Property access on objects
    @{ From = '([a-zA-Z_$][a-zA-Z0-9_$]*)\.assignedBusId\b';  To = '$1.busId' },
    @{ From = '([a-zA-Z_$][a-zA-Z0-9_$]*)\.assignedRouteId\b';To = '$1.routeId' },
    # DB column names (bare, in strings, etc.)
    @{ From = '\bassigned_bus_id\b';                            To = 'bus_id' },
    @{ From = '\bassigned_route_id\b';                          To = 'route_id' },
    # Object key definitions (with optional ?)
    @{ From = 'assignedBusIds\?:';                              To = 'busIds?:' },
    @{ From = 'assignedRouteIds\?:';                            To = 'routeIds?:' },
    @{ From = 'assignedBusId\?:';                               To = 'busId?:' },
    @{ From = 'assignedRouteId\?:';                             To = 'routeId?:' },
    @{ From = 'assignedBusIds:';                                To = 'busIds:' },
    @{ From = 'assignedRouteIds:';                              To = 'routeIds:' },
    @{ From = 'assignedBusId:';                                 To = 'busId:' },
    @{ From = 'assignedRouteId:';                               To = 'routeId:' },
    # Bare identifiers (variable names, destructuring, params)
    @{ From = '\bassignedBusIds\b';                             To = 'busIds' },
    @{ From = '\bassignedRouteIds\b';                           To = 'routeIds' },
    @{ From = '\bassignedBusId\b';                              To = 'busId' },
    @{ From = '\bassignedRouteId\b';                            To = 'routeId' }
)

$files = Get-ChildItem -Recurse -Include "*.ts","*.tsx" $srcRoot | Where-Object {
    $name = $_.FullName
    $skip = $false
    foreach ($ex in $excludeFiles) { if ($name -match $ex) { $skip = $true; break } }
    -not $skip
}

$count = 0
foreach ($f in $files) {
    $content = [System.IO.File]::ReadAllText($f.FullName)
    if ($content -match "assignedBusId|assignedRouteId|assigned_bus_id|assigned_route_id") {
        $updated = $content
        foreach ($p in $patterns) {
            $updated = [regex]::Replace($updated, $p.From, $p.To)
        }
        if ($updated -ne $content) {
            [System.IO.File]::WriteAllText($f.FullName, $updated, [System.Text.Encoding]::UTF8)
            $count++
            Write-Host "Patched: $($f.Name)"
        }
    }
}
Write-Host "`nTotal patched: $count"
